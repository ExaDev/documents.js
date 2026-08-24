// decodeCsvText/encodeCsvText: the byte <-> text boundary for csv, exactly mirroring src/markdown/text.ts's own pair for markdown. csv has no upstream codec package (unlike markdown-codec), so both the decode/encode pair and the invalid-UTF-8 error live here. A fresh TextDecoder/TextEncoder is constructed per call, never module-level cached -- this package's own sideEffects:false convention (package.json) means nothing here creates shared mutable state at import time.
//
// decodeCsvText uses a fatal-mode TextDecoder specifically so a non-UTF-8 input throws here, at the boundary, rather than silently producing U+FFFD replacement characters that would then corrupt every downstream cell value the read path produces -- the identical reasoning src/model/bytes.ts's own CsvBytesSchema documents for the schema-validation path. This function is the enforcement point for the ergonomic conversions (csvToPdf/csvToXlsx/csvToOds/csvToMarkdown) that bypass the schema and call readCsvContent directly on already-checked bytes.
export class CsvInvalidUtf8Error extends Error {
  constructor() {
    super("csv text must be well-formed UTF-8");
    this.name = "CsvInvalidUtf8Error";
  }
}

export function decodeCsvText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new CsvInvalidUtf8Error();
  }
}

export function encodeCsvText(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}
