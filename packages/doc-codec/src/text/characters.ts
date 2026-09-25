import { readUint16LE, readUint8 } from "../bytes";
import { DocFormatError } from "../errors";
import { findLargestAtMost } from "../plc";
import { characterOffset, type PieceTable } from "./piece-table";

// Reconstruction of the logical text stream from the piece table: the step that turns a range of character positions into actual characters, and the only place in this package where a CP becomes a byte.
//
// One character position is one UTF-16 code unit, in both piece encodings. An uncompressed piece stores each CP as a 16-bit little-endian code unit directly; a compressed piece stores each CP as one byte, mapped through the table below. A character outside the Basic Multilingual Plane therefore occupies two consecutive CPs as a surrogate pair, which is exactly how JavaScript's own strings are indexed — so a CP offset into the reconstructed string is the same number as the CP in the file, with no conversion, and every formatting range keyed on CPs lines up without an index map.

// [MS-DOC] 2.8.25 (FcCompressed): "the text starts at offset fc/2 and is an array of 8-bit Unicode characters, except for the values which are mapped to Unicode characters as follows". Every byte not listed maps to itself.
//
// This is Windows-1252's high range, but NOT identically: 0x80 (euro), 0x8E (Z with caron), 0x9E (z with caron) and 0x9D are assigned by Windows-1252 and absent from the specification's own table, so this reader leaves them mapping to themselves. Reaching for a Windows-1252 codec instead of the published table would silently substitute four different characters for four the specification does not define — a small, plausible, and permanent divergence from the format it claims to implement.
// Each pair as a numbered spec entry, [MS-DOC] 2.8.25's own table: the compressed byte and the Unicode code point it maps to.
interface CompressedCharacterMapping {
  readonly byte: number;
  readonly codePoint: number;
}
const COMPRESSED_CHARACTER_ENTRIES: readonly CompressedCharacterMapping[] = [
  { byte: 0x82, codePoint: 0x201a },
  { byte: 0x83, codePoint: 0x0192 },
  { byte: 0x84, codePoint: 0x201e },
  { byte: 0x85, codePoint: 0x2026 },
  { byte: 0x86, codePoint: 0x2020 },
  { byte: 0x87, codePoint: 0x2021 },
  { byte: 0x88, codePoint: 0x02c6 },
  { byte: 0x89, codePoint: 0x2030 },
  { byte: 0x8a, codePoint: 0x0160 },
  { byte: 0x8b, codePoint: 0x2039 },
  { byte: 0x8c, codePoint: 0x0152 },
  { byte: 0x91, codePoint: 0x2018 },
  { byte: 0x92, codePoint: 0x2019 },
  { byte: 0x93, codePoint: 0x201c },
  { byte: 0x94, codePoint: 0x201d },
  { byte: 0x95, codePoint: 0x2022 },
  { byte: 0x96, codePoint: 0x2013 },
  { byte: 0x97, codePoint: 0x2014 },
  { byte: 0x98, codePoint: 0x02dc },
  { byte: 0x99, codePoint: 0x2122 },
  { byte: 0x9a, codePoint: 0x0161 },
  { byte: 0x9b, codePoint: 0x203a },
  { byte: 0x9c, codePoint: 0x0153 },
  { byte: 0x9f, codePoint: 0x0178 },
];
export const COMPRESSED_CHARACTER_MAP: ReadonlyMap<number, number> = new Map(
  COMPRESSED_CHARACTER_ENTRIES.map(
    ({ byte, codePoint }) => [byte, codePoint] as const,
  ),
);

export interface TextRange {
  /** The reconstructed characters, one UTF-16 code unit per character position. */
  readonly text: string;
  /** The WordDocument byte offset of each character, parallel to `text`. This is the key every formatting lookup is performed on. */
  readonly fcs: readonly number[];
  /** The character position `text[0]` and `fcs[0]` correspond to, so a caller can convert an index in this range back to a document-wide CP. */
  readonly cpStart: number;
}

// Reads the characters at [cpStart, cpEnd) out of the WordDocument stream, following [MS-DOC] 2.4.1's Retrieving Text algorithm for each: find the piece containing the CP, compute the byte offset from the piece's own encoding, and read one or two bytes there.
//
// The per-character byte offset is returned alongside the text rather than recomputed later, because it is the key both formatting bin tables are indexed by ([MS-DOC] 2.4.6.1 and 2.4.6.2 both begin by turning a CP into an fc), and recomputing it at each lookup would mean the character stream and the property stream could disagree about where a character lives.
export function readTextRange(
  wordDocument: Uint8Array,
  table: PieceTable,
  cpStart: number,
  cpEnd: number,
): TextRange {
  if (!Number.isInteger(cpStart) || !Number.isInteger(cpEnd) || cpStart < 0) {
    throw new DocFormatError(
      `text range [${cpStart}, ${cpEnd}) is not a pair of non-negative integer character positions`,
    );
  }
  if (cpEnd < cpStart) {
    throw new DocFormatError(
      `text range [${cpStart}, ${cpEnd}) ends before it begins`,
    );
  }
  if (cpEnd > table.lastCp) {
    throw new DocFormatError(
      `text range [${cpStart}, ${cpEnd}) extends past character position ${table.lastCp}, the last the piece table defines`,
    );
  }

  const codeUnits: number[] = [];
  const fcs: number[] = [];
  let cp = cpStart;
  while (cp < cpEnd) {
    const index = findLargestAtMost(table.cpKeys, cp);
    if (index === undefined) {
      throw new DocFormatError(
        `character position ${cp} falls outside every piece in the piece table`,
      );
    }
    const piece = table.pieces[index];
    if (piece === undefined) {
      throw new DocFormatError(
        `piece ${index} is absent from a piece table of ${table.pieces.length} pieces`,
      );
    }
    // Read to the end of this piece or the end of the requested range, whichever comes first, rather than re-locating the piece per character: a piece routinely covers thousands of characters, and the lookup is a binary search.
    const stop = Math.min(cpEnd, piece.cpEnd);
    for (; cp < stop; cp += 1) {
      const fc = characterOffset(piece, cp);
      fcs.push(fc);
      if (piece.compressed) {
        const byte = readUint8(wordDocument, fc);
        codeUnits.push(COMPRESSED_CHARACTER_MAP.get(byte) ?? byte);
      } else {
        codeUnits.push(readUint16LE(wordDocument, fc));
      }
    }
  }

  return {
    // Mapped one code unit at a time rather than spread into a single variadic String.fromCharCode call: that call's argument count would grow with the document's own character count, and a document of hundreds of thousands of characters would exceed the argument-count limit of every engine.
    text: fromCodeUnits(codeUnits),
    fcs,
    cpStart,
  };
}

function fromCodeUnits(codeUnits: readonly number[]): string {
  return codeUnits.map((codeUnit) => String.fromCharCode(codeUnit)).join("");
}
