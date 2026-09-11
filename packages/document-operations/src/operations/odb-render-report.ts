import {
  base64ToBytes,
  decodeOdbPackage,
  type FontSubstitution,
  type OmmlDiagnostic,
  odbReportToDocx,
  odbReportToOdt,
  odbReportToPdf,
  readOdbReportContent,
} from "documents.js";
import { z } from "zod";
import { DocumentInputSchema } from "../io/document-input";
import {
  DocumentOutputSchema,
  resolveDocumentOutput,
} from "../io/document-output";
import { FontInputSchema } from "./convert";
import { defineOperation } from "../operation";
import { resolveOdbBytes } from "./odb";

// readOdbReportContent always produces a wordprocessing ContentDocument (a report's printed bands, one ContentTable per band -- see documents.js's own src/odb/report/render.ts), so docx/odt/pdf are the only three formats with a wordprocessing counterpart to build one into -- the same restriction document-cli's own ODB_REPORT_TARGET_FORMATS/isOdbReportTargetFormat (src/commands/odb.ts) enforces for its own odb-render-report command.
const OdbRenderReportTargetFormatSchema = z.enum(["docx", "odt", "pdf"]);

const OdbRenderReportInputSchema = z.object({
  source: DocumentInputSchema.describe(
    ".odb database to render a report from. 'path' points at the .odb file on disk -- its extension is never used to infer a document format, since documents.js deliberately excludes 'odb' from DocumentFormat (an embedded database front end has no single natural target format -- tables, saved queries, and reports are three unrelated output shapes -- see that package's own README). 'bytesBase64' carries the .odb bytes inline; its 'format' field is required by the shared hybrid input shape but unused by this operation.",
  ),
  report: z
    .string()
    .optional()
    .describe(
      "The name of the report to render. Required only when the .odb declares more than one report -- omitting it when exactly one is declared renders that one automatically.",
    ),
  targetFormat: OdbRenderReportTargetFormatSchema.describe(
    "The format to render the report into.",
  ),
  output: DocumentOutputSchema.optional().describe(
    "Where to write the rendered report. Omit entirely (or omit outputPath within it) to receive the bytes inline instead.",
  ),
  fonts: z
    .array(FontInputSchema)
    .optional()
    .describe(
      "Extra font faces to make available, for a family the rendered report's own text otherwise falls back on. Only consulted when targetFormat is 'pdf' -- docx and odt output is genuine editable text with no font-embedding step of its own, so fonts is ignored for those two targets.",
    ),
});

// Mirrors documents.js's own OmmlDiagnostic (kind/detail), plus the sourcePath its onMathDiagnostic callback context carries separately -- reported for every formula construct that degraded or was approximated crossing into OMML (docx) or that this rendering path could not typeset (pdf).
const MathDiagnosticSchema = z.object({
  kind: z.enum(["unsupported-element", "approximated-element"]),
  detail: z.string(),
  sourcePath: z.string().optional(),
});

// Mirrors pdf-codec's own FontSubstitution, re-exported as a type-only FontSubstitution from documents.js -- the same shape convert_document's own FontSubstitutionSchema reports, for the identical event (a requested family/weight/style resolved to a different face).
const FontSubstitutionSchema = z.object({
  requestedFamily: z.string(),
  requestedBold: z.boolean(),
  requestedItalic: z.boolean(),
  reason: z.enum(["missing-face", "vendored-substitute"]),
  resolvedFamily: z.string(),
});

// Mirrors pdf-codec's own WinAnsiSubstitution (from/to), plus the pageIndex its onSubstitution callback context carries separately -- reported once per character not representable in a standard-14 font, the character-level counterpart to a FontSubstitution's whole-face-level event.
const CharSubstitutionSchema = z.object({
  from: z.string(),
  to: z.string(),
  pageIndex: z.number(),
});

const diagnosticsShape = {
  mathDiagnostics: z.array(MathDiagnosticSchema),
  fontSubstitutions: z.array(FontSubstitutionSchema),
  charSubstitutions: z.array(CharSubstitutionSchema),
};

export const OdbRenderReportOutputSchema = z.union([
  z.object({ path: z.string(), byteLength: z.number(), ...diagnosticsShape }),
  z.object({
    bytesBase64: z.string(),
    byteLength: z.number(),
    large: z.literal(true).optional(),
    ...diagnosticsShape,
  }),
]);

// readOdbReportContent throws OdbReportNotSpecifiedError when the .odb declares no report at all, or declares more than one and the caller named none -- left to propagate, exactly like every other error this operation can throw (a bad path, a malformed .odb, an unrecognised report name, an unsupported embedded engine): each transport decides for itself how to enrich or present it (document-mcp's own adapter special-cases it into structuredContent.availableReports, mirroring document-cli's own reportOdbReportError).
export const odbRenderReportOperation = defineOperation({
  name: "odb_render_report",
  title: "Render .odb report",
  description:
    "Resolves one of an .odb database's own reports -- its data-bound command run through the bounded SQL engine, its rpt: formulas evaluated, its bands laid out -- and renders the result to docx, odt, or pdf.",
  inputSchema: OdbRenderReportInputSchema,
  outputSchema: OdbRenderReportOutputSchema,
  async run({ source, report, targetFormat, output, fonts }, context) {
    const signal = context?.signal;
    const inputBytes = await resolveOdbBytes(source);
    const pkg = decodeOdbPackage(inputBytes);
    const content = readOdbReportContent(pkg, { report });

    const mathDiagnostics: z.infer<typeof MathDiagnosticSchema>[] = [];
    const recordMathDiagnostic = (
      diagnostic: OmmlDiagnostic,
      diagnosticContext: { readonly sourcePath?: string },
    ): void => {
      mathDiagnostics.push({
        kind: diagnostic.kind,
        detail: diagnostic.detail,
        sourcePath: diagnosticContext.sourcePath,
      });
    };

    const fontSubstitutions: FontSubstitution[] = [];
    const charSubstitutions: z.infer<typeof CharSubstitutionSchema>[] = [];

    let bytes: Uint8Array<ArrayBuffer>;
    if (targetFormat === "docx") {
      bytes = odbReportToDocx(content, {
        signal,
        onMathDiagnostic: recordMathDiagnostic,
      });
    } else if (targetFormat === "odt") {
      bytes = odbReportToOdt(content, { signal });
    } else {
      bytes = odbReportToPdf(content, {
        signal,
        fonts: fonts?.map((font) => ({
          family: font.family,
          bold: font.bold,
          italic: font.italic,
          bytes: base64ToBytes(font.bytesBase64),
        })),
        onFontSubstitution: (substitution) =>
          fontSubstitutions.push(substitution),
        onSubstitution: (substitution, substitutionContext) => {
          charSubstitutions.push({
            from: substitution.from,
            to: substitution.to,
            pageIndex: substitutionContext.pageIndex,
          });
        },
        onMathDiagnostic: recordMathDiagnostic,
      });
    }

    const resolvedOutput = await resolveDocumentOutput(bytes, output ?? {});
    return {
      ...resolvedOutput,
      mathDiagnostics,
      fontSubstitutions,
      charSubstitutions,
    };
  },
});
