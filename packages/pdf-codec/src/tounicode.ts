import type { PdfObject } from "./objects";
import { pdfDict, pdfStream } from "./objects";

// A /ToUnicode CMap (ISO 32000-1 9.10.3): a plain-text PostScript-syntax resource mapping each character code a composite font is shown with back to the Unicode text it represents, so copy/paste, text search, and screen readers recover real characters from an embedded font's own arbitrary glyph numbering rather than raw glyph indices.
//
// Shared by every embedded-font writer in this package -- the math font (math-font-write.ts) and the embedded text faces (embedded-font-write.ts) -- rather than duplicated in each: both show text through Identity-H, so both need exactly this resource, and both happen to number their CIDs by glyph ID. This module never needs to know that last part, though: it maps whatever code-to-code-point pairs it is handed.

// Adobe's CMap syntax caps a single bfchar block at 100 entries (Adobe Technical Note #5014, and the same limit restated for the PDF-embedded case in #5411). A subsetted text face routinely exceeds that -- a page of mixed-case prose with punctuation is already close to it -- so entries are emitted in blocks of at most this many rather than as one oversized block a strict consumer is entitled to reject.
const MAX_BFCHAR_ENTRIES_PER_BLOCK = 100;

// A code point above U+FFFF (every Mathematical Alphanumeric Symbols character this family's own mathvariant mapping produces, for instance) needs a genuine UTF-16BE surrogate pair as a bfchar destination -- JS's String.fromCodePoint + charCodeAt already performs exactly that encoding, so this reuses it rather than hand-rolling the surrogate arithmetic.
function codePointToUtf16BEHex(codePoint: number): string {
  const text = String.fromCodePoint(codePoint);
  let hex = "";
  for (let i = 0; i < text.length; i++) {
    hex += text.charCodeAt(i).toString(16).padStart(4, "0");
  }
  return hex;
}

// One bfchar destination: the UTF-16BE spelling of a Unicode TEXT string, which the bfchar syntax permits to be any length -- one code point for a glyph a character resolved to directly, the whole character run a ligature glyph consumed (ISO 32000-1 9.10.3's own worked example writes a two-character destination). Same concatenation the surrogate-pair case above performs, over however many code points the sequence holds.
function sequenceToUtf16BEHex(codePoints: readonly number[]): string {
  let hex = "";
  for (const codePoint of codePoints) {
    hex += codePointToUtf16BEHex(codePoint);
  }
  return hex;
}

// Builds the ToUnicode CMap stream for `codeToSequence`, a character code -> Unicode text mapping (one or more code points per code). Entries are emitted sorted by code, so identical input always produces byte-identical output -- the same determinism guarantee write.ts states for its own object allocation order.
export function buildToUnicodeCMap(
  codeToSequence: ReadonlyMap<number, readonly number[]>,
): PdfObject {
  const entries = [...codeToSequence].sort((a, b) => a[0] - b[0]);
  const lines: string[] = [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Adobe-Identity-UCS def",
    "/CMapType 2 def",
    "1 begincodespacerange",
    "<0000> <FFFF>",
    "endcodespacerange",
  ];
  for (
    let start = 0;
    start < entries.length;
    start += MAX_BFCHAR_ENTRIES_PER_BLOCK
  ) {
    const block = entries.slice(start, start + MAX_BFCHAR_ENTRIES_PER_BLOCK);
    lines.push(`${block.length} beginbfchar`);
    for (const [code, sequence] of block) {
      lines.push(
        `<${code.toString(16).padStart(4, "0")}> <${sequenceToUtf16BEHex(sequence)}>`,
      );
    }
    lines.push("endbfchar");
  }
  lines.push(
    "endcmap",
    "CMapName currentdict /CMap defineresource pop",
    "end",
    "end",
  );
  return pdfStream(
    pdfDict({}),
    new TextEncoder().encode(`${lines.join("\n")}\n`),
  );
}
