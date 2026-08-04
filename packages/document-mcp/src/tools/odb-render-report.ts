import { readFile } from 'node:fs/promises';
import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import {
  base64ToBytes,
  decodeOdbPackage,
  type FontSubstitution,
  type OmmlDiagnostic,
  OdbReportNotSpecifiedError,
  odbReportToDocx,
  odbReportToOdt,
  odbReportToPdf,
  readOdbReportContent,
} from 'documents.js';
import { z } from 'zod';
import { DocumentInputSchema, type DocumentInput } from '../io/document-input';
import { DocumentOutputSchema, resolveDocumentOutput } from '../io/document-output';

// `source` here is a .odb database, not a document with a DocumentFormat -- resolveDocumentInput's own format inference (io/document-input.ts) has no '.odb' entry and would throw for the ordinary 'path' shape a caller most naturally reaches for. This reads the hybrid DocumentInput's raw bytes directly instead, so no document format is ever inferred from -- the 'bytesBase64' shape's own `format` field stays part of the schema only so `source` keeps the identical hybrid shape every other tool's document input accepts, and goes unused here. Mirrors odb.ts's own resolveOdbBytes exactly (each tool module stays self-contained -- see this repo's own tool-registration convention).
async function resolveOdbBytes(source: DocumentInput): Promise<Uint8Array<ArrayBuffer>> {
  if ('path' in source) {
    const buffer = await readFile(source.path);
    return new Uint8Array(buffer);
  }
  return base64ToBytes(source.bytesBase64);
}

// The same caller-declares-family/bold/italic shape convert_document's own FontInputSchema (src/tools/convert.ts) uses for its `fonts` option -- both feed the identical documents.js DocumentFontRegistryOptions.fonts: ProvidedFont[] (pdf-codec's ProvidedFont, re-exported by documents.js), so a caller supplying extra faces to a pdf-targeting tool gets one consistent shape across this whole MCP server rather than a different convention per tool.
const FontInputSchema = z.object({
  family: z.string().describe('The font family name this face provides.'),
  bold: z.boolean().describe('Whether this face is the bold weight.'),
  italic: z.boolean().describe('Whether this face is the italic slope.'),
  bytesBase64: z.string().describe('Base64-encoded font program bytes (TrueType/OpenType/CFF) for this family/weight/style combination.'),
});

// readOdbReportContent always produces a wordprocessing ContentDocument (a report's printed bands, one ContentTable per band -- see documents.js's own src/odb/report/render.ts), so docx/odt/pdf are the only three formats with a wordprocessing counterpart to build one into -- the same restriction document-cli's own ODB_REPORT_TARGET_FORMATS/isOdbReportTargetFormat (src/commands/odb.ts) enforces for its own odb-render-report command.
const OdbRenderReportTargetFormatSchema = z.enum(['docx', 'odt', 'pdf']);

const OdbRenderReportInputSchema = z.object({
  source: DocumentInputSchema.describe(
    ".odb database to render a report from. 'path' points at the .odb file on disk -- its extension is never used to infer a document format, since documents.js deliberately excludes 'odb' from DocumentFormat (an embedded database front end has no single natural target format -- tables, saved queries, and reports are three unrelated output shapes -- see that package's own README). 'bytesBase64' carries the .odb bytes inline; its 'format' field is required by the shared hybrid input shape but unused by this tool.",
  ),
  report: z.string().optional().describe('The name of the report to render. Required only when the .odb declares more than one report -- omitting it when exactly one is declared renders that one automatically.'),
  targetFormat: OdbRenderReportTargetFormatSchema.describe('The format to render the report into.'),
  output: DocumentOutputSchema.optional().describe('Where to write the rendered report. Omit entirely (or omit outputPath within it) to receive the bytes inline instead.'),
  fonts: z
    .array(FontInputSchema)
    .optional()
    .describe("Extra font faces to make available, for a family the rendered report's own text otherwise falls back on. Only consulted when targetFormat is 'pdf' -- docx and odt output is genuine editable text with no font-embedding step of its own, so fonts is ignored for those two targets."),
});

// Mirrors documents.js's own OmmlDiagnostic (kind/detail), plus the sourcePath its onMathDiagnostic callback context carries separately -- reported for every formula construct that degraded or was approximated crossing into OMML (docx) or that this rendering path could not typeset (pdf).
const MathDiagnosticSchema = z.object({
  kind: z.enum(['unsupported-element', 'approximated-element']),
  detail: z.string(),
  sourcePath: z.string().optional(),
});

// Mirrors pdf-codec's own FontSubstitution, re-exported as a type-only FontSubstitution from documents.js -- the same shape convert_document's own FontSubstitutionSchema (src/tools/convert.ts) reports, for the identical event (a requested family/weight/style resolved to a different face).
const FontSubstitutionSchema = z.object({
  requestedFamily: z.string(),
  requestedBold: z.boolean(),
  requestedItalic: z.boolean(),
  reason: z.enum(['missing-face', 'vendored-substitute']),
  resolvedFamily: z.string(),
});

// Mirrors pdf-codec's own WinAnsiSubstitution (from/to), plus the pageIndex its onSubstitution callback context carries separately -- reported once per character not representable in a standard-14 font, the character-level counterpart to a FontSubstitution's whole-face-level event.
const CharSubstitutionSchema = z.object({
  from: z.string(),
  to: z.string(),
  pageIndex: z.number(),
});

// Mirrors ../io/document-output's ResolvedDocumentOutput return shape as a real Zod schema, matching this repo's own src/tools/convert.ts and src/tools/odm.ts convention (ResolvedDocumentOutputSchema/OdmToPdfOutputSchema), extended with this tool's own diagnostics arrays -- lets registerTool validate/type a successful result via outputSchema, and lets a caller (this file's own test included) parse result.structuredContent without an unsafe cast. Output validation is skipped by the SDK whenever a result carries isError: true (see McpServer.validateToolOutput), so this schema describes only the success shape -- the OdbReportNotSpecifiedError branch below returns a differently-shaped structuredContent and is unaffected by it.
const diagnosticsShape = {
  mathDiagnostics: z.array(MathDiagnosticSchema),
  fontSubstitutions: z.array(FontSubstitutionSchema),
  charSubstitutions: z.array(CharSubstitutionSchema),
};

export const OdbRenderReportOutputSchema = z.union([
  z.object({ path: z.string(), byteLength: z.number(), ...diagnosticsShape }),
  z.object({ bytesBase64: z.string(), byteLength: z.number(), large: z.literal(true).optional(), ...diagnosticsShape }),
]);

// The one place OdbReportNotSpecifiedError is turned into a tool result rather than left to propagate: readOdbReportContent throws it when the .odb declares no report at all, or declares more than one and the caller named none -- mirroring odm.ts's own handling of OdmUnresolvedSectionError (catch the one named error a caller can usefully react to, structure its own data into structuredContent, and rethrow everything else), and document-cli's own reportOdbReportError (src/commands/odb.ts), which special-cases exactly this error to name every available report rather than let a bare "no such report" message through. error.message already lists every available report by name (see documents.js's own src/odb/report/content.ts), and availableReports is surfaced again in structuredContent so a caller can pick one programmatically without re-parsing the message text. Every other error this tool can throw (a bad path, a malformed .odb, an unrecognised report name, an unsupported embedded engine) is left to propagate: the SDK's own registerTool dispatch catches a thrown error and converts it into an { isError: true, content: [...] } result automatically, using the error's own message -- see https://ts.sdk.modelcontextprotocol.io/v2/servers/errors. Exported (rather than kept private) so this file's own test can exercise the exact isError shape directly against a real OdbReportNotSpecifiedError instance, without needing a multi-report or zero-report .odb fixture (the one real fixture this repo checks in declares exactly one report, so this branch is otherwise unreachable through the full client/server round trip).
export function odbReportNotSpecifiedResult(error: OdbReportNotSpecifiedError): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: error.message }],
    structuredContent: { availableReports: error.availableReports },
  };
}

export function registerOdbRenderReportTools(server: McpServer): void {
  server.registerTool(
    'odb_render_report',
    {
      title: 'Render .odb report',
      description:
        "Resolves one of an .odb database's own reports -- its data-bound command run through the bounded SQL engine, its rpt: formulas evaluated, its bands laid out -- and renders the result to docx, odt, or pdf.",
      inputSchema: OdbRenderReportInputSchema,
      outputSchema: OdbRenderReportOutputSchema,
    },
    async ({ source, report, targetFormat, output, fonts }, ctx) => {
      const { signal } = ctx.mcpReq;
      const inputBytes = await resolveOdbBytes(source);
      const pkg = decodeOdbPackage(inputBytes);

      let content;
      try {
        content = readOdbReportContent(pkg, { report });
      } catch (error) {
        if (error instanceof OdbReportNotSpecifiedError) {
          return odbReportNotSpecifiedResult(error);
        }
        throw error;
      }

      const mathDiagnostics: z.infer<typeof MathDiagnosticSchema>[] = [];
      const recordMathDiagnostic = (diagnostic: OmmlDiagnostic, diagnosticContext: { readonly sourcePath?: string }): void => {
        mathDiagnostics.push({ kind: diagnostic.kind, detail: diagnostic.detail, sourcePath: diagnosticContext.sourcePath });
      };

      const fontSubstitutions: FontSubstitution[] = [];
      const charSubstitutions: z.infer<typeof CharSubstitutionSchema>[] = [];

      let bytes: Uint8Array<ArrayBuffer>;
      if (targetFormat === 'docx') {
        bytes = odbReportToDocx(content, { signal, onMathDiagnostic: recordMathDiagnostic });
      } else if (targetFormat === 'odt') {
        bytes = odbReportToOdt(content, { signal });
      } else {
        bytes = odbReportToPdf(content, {
          signal,
          fonts: fonts?.map((font) => ({ family: font.family, bold: font.bold, italic: font.italic, bytes: base64ToBytes(font.bytesBase64) })),
          onFontSubstitution: (substitution) => fontSubstitutions.push(substitution),
          onSubstitution: (substitution, substitutionContext) => {
            charSubstitutions.push({ from: substitution.from, to: substitution.to, pageIndex: substitutionContext.pageIndex });
          },
          onMathDiagnostic: recordMathDiagnostic,
        });
      }

      const resolvedOutput = await resolveDocumentOutput(bytes, output ?? {});
      const structuredContent: z.infer<typeof OdbRenderReportOutputSchema> = { ...resolvedOutput, mathDiagnostics, fontSubstitutions, charSubstitutions };

      return {
        content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
        structuredContent,
      };
    },
  );
}
