import { readFile } from "node:fs/promises";
import {
  base64ToBytes,
  type DocumentFormat,
  DocumentFormatSchema,
} from "documents.js";
import { z } from "zod";

// Ported from document-cli's src/format.ts (`EXTENSION_TO_FORMAT`/`inferFormatFromExtension`) so both entry points classify a path identically. 'md' and 'markdown' both read as the 'markdown' DocumentFormat, and every ODF/OOXML template and macro-enabled variant reads as its base format -- the many-to-one entries in this table. A template (.ott/.ots/.otp/.otg/.otf) is the same package as its non-template sibling with only the mimetype's "-template" suffix differing, and a macro-enabled OOXML file (.docm/.xlsm/.pptm) is the same package with a vbaProject part this library reads past (macros are never executed or re-emitted); both read through the base codec unchanged.
const EXTENSION_TO_FORMAT: Readonly<Record<string, DocumentFormat>> = {
  docx: "docx",
  dotx: "docx",
  docm: "docx",
  pptx: "pptx",
  potx: "pptx",
  pptm: "pptx",
  xlsx: "xlsx",
  xltx: "xlsx",
  xlsm: "xlsx",
  odt: "odt",
  ott: "odt",
  odp: "odp",
  otp: "odp",
  ods: "ods",
  ots: "ods",
  odg: "odg",
  otg: "odg",
  odf: "odf",
  otf: "odf",
  markdown: "markdown",
  md: "markdown",
  rtf: "rtf",
  wpd: "wpd",
  csv: "csv",
  svg: "svg",
  pdf: "pdf",
};

// Reads the extension after the last '.' in the final path segment (so 'a.b/c.docx' -> 'docx', '.gitignore' -> undefined -- a leading dot with no further '.' is not an extension). Returns undefined for no recognised extension, an unrecognised one, or a path with none at all -- callers decide how to react to an unresolved format, this function only classifies.
export function inferFormatFromExtension(
  path: string,
): DocumentFormat | undefined {
  const lastSegment = path.split(/[/\\]/).pop() ?? path;
  const dotIndex = lastSegment.lastIndexOf(".");
  if (dotIndex <= 0) {
    return undefined;
  }
  const extension = lastSegment.slice(dotIndex + 1).toLowerCase();
  return EXTENSION_TO_FORMAT[extension];
}

/**
 * The hybrid input shape every MCP tool that accepts a document accepts: either a filesystem path (format inferred from its extension) or inline base64-encoded bytes (format required, since there is no filename to infer it from).
 */
export const DocumentInputSchema = z.union([
  z.object({
    path: z
      .string()
      .describe(
        "Filesystem path to the document to read. The document format is inferred from the file extension.",
      ),
  }),
  z.object({
    bytesBase64: z.string().describe("Base64-encoded document bytes."),
    format: DocumentFormatSchema.describe(
      "The document format of bytesBase64 -- required, since inline bytes carry no filename to infer it from.",
    ),
  }),
]);

export type DocumentInput = z.infer<typeof DocumentInputSchema>;

export interface ResolvedDocumentInput {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly format: DocumentFormat;
}

/**
 * Resolves the hybrid DocumentInput union to concrete bytes and a format: for the path shape, reads the file from disk and infers its format from the extension (throwing if the extension is unrecognised); for the bytesBase64 shape, decodes the inline payload and uses the caller-supplied format directly.
 */
export async function resolveDocumentInput(
  input: DocumentInput,
  options?: { readonly signal?: AbortSignal },
): Promise<ResolvedDocumentInput> {
  if ("path" in input) {
    const format = inferFormatFromExtension(input.path);
    if (format === undefined) {
      throw new Error(
        `Could not infer a document format from the file extension of "${input.path}". Recognised extensions: ${Object.keys(EXTENSION_TO_FORMAT).join(", ")}. Pass an explicit format via the bytesBase64 input shape instead.`,
      );
    }
    const buffer = await readFile(input.path, { signal: options?.signal });
    return { bytes: new Uint8Array(buffer), format };
  }
  return { bytes: base64ToBytes(input.bytesBase64), format: input.format };
}
