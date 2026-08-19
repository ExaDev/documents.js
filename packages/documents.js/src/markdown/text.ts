import { MarkdownInvalidUtf8Error } from 'markdown-codec';

// decodeMarkdownText/encodeMarkdownText: the byte <-> text boundary markdown-codec's own readMarkdownContent/writeMarkdownContent do NOT sit on -- those two operate on a JS string, never raw bytes (markdown has no package/zip structure the way docx/pptx/odt/odp/ods/odg do, so there is no Package to decode first) -- but this package's own bytes-in/bytes-out ergonomic conversions (markdownToPdf/pdfToMarkdown, markdownToDocx/docxToMarkdown, markdownToOdt/odtToMarkdown) all need exactly this decode/encode step, matching every other convert.ts function's own "bytes in, bytes out" shape. A fresh TextDecoder/TextEncoder is constructed per call, never module-level cached -- this package's own sideEffects:false convention (package.json) means nothing here creates shared mutable state at import time, mirroring every other TextDecoder/TextEncoder call site in this codebase (src/odb/read.ts, src/hsqldb/script.ts, src/test-support/*.ts).
//
// decodeMarkdownText uses a fatal-mode TextDecoder specifically so a non-UTF-8 input throws here, at the boundary, rather than silently producing U+FFFD replacement characters that would then corrupt every downstream line/column offset a diagnostic or a MarkdownParseError might report -- the identical reasoning src/model/bytes.ts's own MarkdownBytesSchema documents for the schema-validation path, and markdown-codec's own MarkdownBytesSchema (that package's src/codec.ts) for the z.codec() path. This function is the third place that same "fatal decode, never silent mangling" invariant is enforced, for the one entry point (markdownToPdf/markdownToDocx/markdownToOdt) that bypasses both schemas and calls readMarkdownContent directly on already-checked bytes.
export function decodeMarkdownText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new MarkdownInvalidUtf8Error();
  }
}

export function encodeMarkdownText(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}
