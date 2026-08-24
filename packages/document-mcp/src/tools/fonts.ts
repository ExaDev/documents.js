import { readFile } from "node:fs/promises";
import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
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

// ProvidedFont (pdf-codec, re-exported by documents.js) carries `bytes` directly, with no `byteLength` field of its own -- reported here as a computed byte length rather than the raw embedded font bytes, which no caller of this tool has asked for and would bloat the response by however large the embedded face is. Mirrors document-cli's own FontFaceSummary (src/commands/fonts.ts) exactly, so the CLI and this server report identical shapes for identical input.
interface FontFaceSummary {
  readonly family: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly byteLength: number;
}

// describe_font_file inspects a standalone font FILE, not a document -- a .ttf/.otf is not one of DocumentFormat's members, so it deliberately does not reuse DocumentInputSchema (../io/document-input.ts), whose bytesBase64 shape requires a DocumentFormat. A bare path/bytesBase64 union instead, scoped to this one tool -- mirroring odm.ts's own OdmMasterSourceSchema for the identical "this input has no DocumentFormat to carry" problem.
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

/** A tool result reporting a problem: `isError: true` with the message as the sole content block, never a thrown exception -- a thrown error from a tool callback surfaces as a JSON-RPC protocol error rather than a result the caller can inspect and recover from. Matches odb.ts's own errorResult/toErrorResult/jsonResult convention. */
function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** errorResult's counterpart for a caught exception: UnsupportedFontSourceFormatError (extractSourceFontsForFormat rejecting a format with no source-embedded-font concept -- xlsx/pdf/markdown/odf) and FontFaceParseError (describeFontFace rejecting bytes that are not a recognised sfnt font, or a .ttc collection) both carry a self-contained, already-actionable message, so there is nothing to add beyond surfacing it verbatim. */
function toErrorResult(error: unknown): CallToolResult {
  return errorResult(error instanceof Error ? error.message : String(error));
}

/** A successful tool result: the value serialised as the text content block, and returned verbatim as structuredContent for a caller that wants the parsed value directly rather than re-parsing the text block. */
function jsonResult(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

export function registerFontTools(server: McpServer): void {
  server.registerTool(
    "fonts",
    {
      title: "List document fonts",
      description:
        "Lists every source-embedded font face a docx/pptx/odt/odp/ods/odg document carries (family, weight/style, byte length).",
      inputSchema: z.object({
        source: DocumentInputSchema.describe(
          "The docx/pptx/odt/odp/ods/odg document to extract source-embedded font faces from.",
        ),
      }),
    },
    async ({ source }) => {
      try {
        const { bytes, format } = await resolveDocumentInput(source);
        const faces = extractSourceFontsForFormat(format, bytes);
        const summaries: FontFaceSummary[] = faces.map((face) => ({
          family: face.family,
          bold: face.bold,
          italic: face.italic,
          byteLength: face.bytes.length,
        }));
        return jsonResult({ faces: summaries });
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  server.registerTool(
    "describe_font_file",
    {
      title: "Describe font file",
      description:
        "Reads a standalone TrueType/OpenType font file (.ttf/.otf) and reports the family/bold/italic triple it declares about itself.",
      inputSchema: z.object({
        // describe_font_file inspects a standalone font FILE, not a document -- documents.js's own extractSourceFontsForFormat covers extracting fonts a document already embeds (the `fonts` tool above), and describeFontFace is its standalone-file counterpart, re-exported from documents.js so this package needs no direct pdf-codec runtime dependency.
        source: FontFileInputSchema.describe(
          "The standalone .ttf/.otf font file to inspect -- not a document.",
        ),
      }),
    },
    async ({ source }) => {
      try {
        const { bytes, source: label } = await resolveFontFileInput(source);
        const face = describeFontFace(bytes, label);
        return jsonResult({
          family: face.family,
          bold: face.bold,
          italic: face.italic,
        });
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );
}
