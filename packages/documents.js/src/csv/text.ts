// decodeCsvText/encodeCsvText: the byte <-> text boundary for csv, exactly mirroring src/markdown/text.ts's own pair for markdown. csv has no upstream codec package (unlike markdown-codec), so both the decode/encode pair and the undecodable-bytes error live here. A fresh TextEncoder is constructed per call, never module-level cached: this package's own sideEffects:false convention (package.json) means nothing here creates shared mutable state at import time.
//
// decodeCsvText works the encoding out from the bytes rather than assuming UTF-8, through byte-codec's decodeText. Excel's own "CSV (Comma delimited)" export writes the Windows ANSI code page and PowerShell 5.1's redirection operator writes UTF-16 with a byte order mark, so a csv boundary that accepted UTF-8 alone turned away two of the most common ways a spreadsheet actually reaches a caller. What has not changed is that it never mangles: bytes that are not text, and bytes matching none of the supported encodings, still fail here, at the boundary, rather than putting U+FFFD replacement characters into every downstream cell value. The encoding a caller cares about, and the confidence behind it, are byte-codec's decodeText to ask directly; this function is the string-in-hand form the rest of the csv pipeline consumes.
//
// This is the enforcement point for the ergonomic conversions (csvToPdf/csvToXlsx/csvToOds/csvToMarkdown) that bypass the schema and call readCsvContent directly on already-checked bytes. encodeCsvText always writes UTF-8, whatever the input was decoded from, so a windows-1252 csv converted to csv comes back out as UTF-8 by design.
import type { DecodeTextOptions } from "byte-codec";
import { decodeText, UndecodableTextError } from "byte-codec";

/** Thrown when csv bytes cannot be decoded as text at all: they are binary, they contradict an encoding the caller declared or a byte order mark named, or they match none of the encodings byte-codec's decodeText supports. */
export class CsvUndecodableTextError extends Error {
  /** Which of those three it was, carried through from byte-codec so a caller can branch on it without unwrapping `cause`. */
  readonly reason: UndecodableTextError["reason"];

  constructor(cause: UndecodableTextError) {
    super(`csv bytes could not be decoded as text: ${cause.message}`, {
      cause,
    });
    this.name = "CsvUndecodableTextError";
    this.reason = cause.reason;
  }
}

/**
 * Decodes csv bytes to text, working the character encoding out from the bytes.
 * @param bytes - The csv bytes.
 * @param options - An explicit `encoding` to decode under, skipping detection. Reach for it when the bytes are in an encoding detection cannot see, a mark-less UTF-16 file holding CJK text being the case that occurs.
 * @throws CsvUndecodableTextError When the bytes are not text, or match none of the supported encodings.
 * @returns The csv text.
 */
export function decodeCsvText(
  bytes: Uint8Array,
  options?: DecodeTextOptions,
): string {
  try {
    return decodeText(bytes, options).text;
  } catch (error) {
    if (error instanceof UndecodableTextError) {
      throw new CsvUndecodableTextError(error);
    }
    throw error;
  }
}

/**
 * Encodes csv text as UTF-8 bytes.
 * @param text - The csv text.
 * @returns The UTF-8 bytes, whatever encoding the text was originally decoded from.
 */
export function encodeCsvText(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}
