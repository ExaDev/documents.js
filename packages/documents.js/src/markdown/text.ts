// decodeMarkdownText/encodeMarkdownText: the byte <-> text boundary markdown-codec's own readMarkdownContent/writeMarkdownContent do NOT sit on (those two operate on a JS string, never raw bytes, since markdown has no package/zip structure the way docx/pptx/odt/odp/ods/odg do, so there is no Package to decode first), but this package's own bytes-in/bytes-out ergonomic conversions (markdownToPdf/pdfToMarkdown, markdownToDocx/docxToMarkdown, markdownToOdt/odtToMarkdown) all need exactly this decode/encode step, matching every other convert.ts function's own "bytes in, bytes out" shape. A fresh TextEncoder is constructed per call, never module-level cached: this package's own sideEffects:false convention (package.json) means nothing here creates shared mutable state at import time.
//
// decodeMarkdownText works the encoding out from the bytes rather than assuming UTF-8, through byte-codec's decodeText, so a markdown file saved by a Windows editor in the system code page or as UTF-16 reads rather than being turned away. What has not changed is that it never mangles: bytes that are not text, and bytes matching none of the supported encodings, still fail here, at the boundary, rather than putting U+FFFD replacement characters into text whose line and column offsets a MarkdownParseError would then misreport. markdown-codec's own MarkdownBytesSchema (that package's src/codec.ts) makes the same judgement for the schema-guarded path; this function is the one entry point (markdownToPdf/markdownToDocx/markdownToOdt) that bypasses both schemas and calls readMarkdownContent directly.
//
// encodeMarkdownText always writes UTF-8, whatever the input was decoded from, so a windows-1252 markdown file converted back to markdown comes back out as UTF-8 by design.
import type { DecodeTextOptions } from "byte-codec";
import { decodeText, UndecodableTextError } from "byte-codec";
import { MarkdownUndecodableTextError } from "markdown-codec";

/**
 * Decodes markdown bytes to text, working the character encoding out from the bytes.
 * @param bytes - The markdown bytes.
 * @param options - An explicit `encoding` to decode under, skipping detection. Reach for it when the bytes are in an encoding detection cannot see, a mark-less UTF-16 file holding CJK text being the case that occurs.
 * @throws MarkdownUndecodableTextError When the bytes are not text, or match none of the supported encodings.
 * @returns The markdown text.
 */
export function decodeMarkdownText(
  bytes: Uint8Array,
  options?: DecodeTextOptions,
): string {
  try {
    return decodeText(bytes, options).text;
  } catch (error) {
    if (error instanceof UndecodableTextError) {
      throw new MarkdownUndecodableTextError(error.message);
    }
    throw error;
  }
}

/**
 * Encodes markdown text as UTF-8 bytes.
 * @param text - The markdown text.
 * @returns The UTF-8 bytes, whatever encoding the text was originally decoded from.
 */
export function encodeMarkdownText(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}
