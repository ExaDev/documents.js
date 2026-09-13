import { readFile } from "node:fs/promises";
import {
  base64ToBytes,
  describeFontFace,
  extractSourceFontsForFormat,
} from "documents.js";
import { z } from "zod";
import {
  DocumentInputSchema,
  resolveDocumentInput,
} from "../io/document-input";
import { defineOperation } from "../operation";

// ProvidedFont (pdf-codec, re-exported by documents.js) carries `bytes` directly, with no `byteLength` field of its own -- reported here as a computed byte length rather than the raw embedded font bytes, which no caller of this operation has asked for and would bloat the response by however large the embedded face is. Mirrors document-cli's own FontFaceSummary (src/commands/fonts.ts) exactly, so the CLI and every other consumer report identical shapes for identical input.
const FontFaceSummarySchema = z.object({
  family: z.string(),
  bold: z.boolean(),
  italic: z.boolean(),
  byteLength: z.number(),
});

const FontsInputSchema = z.object({
  source: DocumentInputSchema.describe(
    "The docx/pptx/odt/odp/ods/odg document to extract source-embedded font faces from.",
  ),
});

const FontsOutputSchema = z.object({ faces: z.array(FontFaceSummarySchema) });

export const fontsOperation = defineOperation({
  name: "fonts",
  title: "List document fonts",
  description:
    "Lists every source-embedded font face a docx/pptx/odt/odp/ods/odg document carries (family, weight/style, byte length).",
  inputSchema: FontsInputSchema,
  outputSchema: FontsOutputSchema,
  async run({ source }) {
    const { bytes, format } = await resolveDocumentInput(source);
    const faces = extractSourceFontsForFormat(format, bytes);
    return {
      faces: faces.map((face) => ({
        family: face.family,
        bold: face.bold,
        italic: face.italic,
        byteLength: face.bytes.length,
      })),
    };
  },
});

// describe_font_file inspects a standalone font FILE, not a document -- a .ttf/.otf is not one of DocumentFormat's members, so it deliberately does not reuse DocumentInputSchema, whose bytesBase64 shape requires a DocumentFormat. A bare path/bytesBase64 union instead, scoped to this one operation -- mirroring odm.ts's own OdmMasterSourceSchema for the identical "this input has no DocumentFormat to carry" problem.
const FontFileInputSchema = z.union([
  z.object({
    path: z
      .string()
      .describe("Filesystem path to the font file (.ttf/.otf) to read."),
  }),
  z.object({
    bytesBase64: z.string().describe("Base64-encoded font file bytes."),
  }),
]);

interface ResolvedFontFileInput {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly source: string;
}

// Resolves FontFileInputSchema to raw bytes plus a source label for describeFontFace's own error messages (which always name the file/label a parse failure came from) -- the path itself when given, or a generic label for inline bytes, which carry no filename of their own.
async function resolveFontFileInput(
  input: z.infer<typeof FontFileInputSchema>,
): Promise<ResolvedFontFileInput> {
  if ("path" in input) {
    const buffer = await readFile(input.path);
    return { bytes: new Uint8Array(buffer), source: input.path };
  }
  return {
    bytes: base64ToBytes(input.bytesBase64),
    source: "inline font bytes",
  };
}

const DescribeFontFileInputSchema = z.object({
  source: FontFileInputSchema.describe(
    "The standalone .ttf/.otf font file to inspect -- not a document.",
  ),
});

const DescribeFontFileOutputSchema = z.object({
  family: z.string(),
  bold: z.boolean(),
  italic: z.boolean(),
});

export const describeFontFileOperation = defineOperation({
  name: "describe_font_file",
  title: "Describe font file",
  description:
    "Reads a standalone TrueType/OpenType font file (.ttf/.otf) and reports the family/bold/italic triple it declares about itself.",
  inputSchema: DescribeFontFileInputSchema,
  outputSchema: DescribeFontFileOutputSchema,
  async run({ source }) {
    const { bytes, source: label } = await resolveFontFileInput(source);
    const face = describeFontFace(bytes, label);
    return { family: face.family, bold: face.bold, italic: face.italic };
  },
});
