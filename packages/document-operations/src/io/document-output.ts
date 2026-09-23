import { writeFile } from "node:fs/promises";
import { bytesToBase64 } from "documents.js";
import { z } from "zod";

/**
 * The hybrid output shape every MCP tool that produces a document accepts: an optional filesystem path to write the result to. Omitting it returns the bytes inline, base64-encoded, instead.
 */
export const DocumentOutputSchema = z.object({
  outputPath: z
    .string()
    .optional()
    .describe(
      "Filesystem path to write the resulting document to. Omit to receive the document bytes inline, base64-encoded, in the tool result instead.",
    ),
});

export type DocumentOutput = z.infer<typeof DocumentOutputSchema>;

/** Bytes per kibibyte, the base unit `LARGE_RESULT_THRESHOLD_BYTES` is derived from. */
const BYTES_PER_KIBIBYTE = 1024;

/** Bytes per mebibyte. */
const BYTES_PER_MEBIBYTE = BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE;

/** The threshold size, in mebibytes, above which an inline base64 result is flagged `large: true` — a reasonable default order of magnitude for "an LLM context probably wants to know before this lands inline", well under typical MCP stdio transport limits. */
const LARGE_RESULT_THRESHOLD_MEBIBYTES = 5;

/**
 * Above this many bytes, an inline base64 result is flagged `large: true` so a caller/LLM can see the response is sizeable before deciding whether to consume it directly. Purely advisory: `resolveDocumentOutput` never truncates or refuses to return large bytes, it only flags them — silently truncating a document would produce a corrupt file with no indication anything was lost.
 */
export const LARGE_RESULT_THRESHOLD_BYTES =
  LARGE_RESULT_THRESHOLD_MEBIBYTES * BYTES_PER_MEBIBYTE;

export interface WrittenDocumentOutput {
  readonly path: string;
  readonly byteLength: number;
}

export interface InlineDocumentOutput {
  readonly bytesBase64: string;
  readonly byteLength: number;
  readonly large?: true;
}

export type ResolvedDocumentOutput =
  WrittenDocumentOutput | InlineDocumentOutput;

/**
 * Resolves output bytes against the hybrid DocumentOutput shape: writes to `outputPath` and reports the path plus byte length when one is given, otherwise returns the bytes inline as base64 (flagged `large: true` above `LARGE_RESULT_THRESHOLD_BYTES`, never truncated or refused).
 */
export async function resolveDocumentOutput(
  bytes: Uint8Array<ArrayBuffer>,
  output: DocumentOutput,
): Promise<ResolvedDocumentOutput> {
  if (output.outputPath !== undefined) {
    await writeFile(output.outputPath, bytes);
    return { path: output.outputPath, byteLength: bytes.byteLength };
  }
  const bytesBase64 = bytesToBase64(bytes);
  if (bytes.byteLength > LARGE_RESULT_THRESHOLD_BYTES) {
    return { bytesBase64, byteLength: bytes.byteLength, large: true };
  }
  return { bytesBase64, byteLength: bytes.byteLength };
}
