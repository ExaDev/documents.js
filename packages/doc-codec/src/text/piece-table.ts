import {
  readInt16LE,
  readUint16LE,
  readUint32LE,
  readUint8,
  slice,
} from "../bytes";
import { DocFormatError } from "../errors";
import { parsePlc } from "../plc";

// The piece table, [MS-DOC] 2.8.35 and 2.9.6 -- the mechanism the entire format hangs on. A .doc's logical text is not one contiguous run of bytes: it is assembled from pieces, each naming a byte range of the WordDocument stream and the character positions that range supplies. Every other structure in the format addresses text by character position (CP), and a CP only becomes a byte offset by passing through this table, so a piece table read wrongly does not fail -- it yields a document of real characters in the wrong order, from the wrong places, at the wrong sizes.
//
// Two details carry most of the risk, and both are encoded in one 32-bit field (FcCompressed, [MS-DOC] 2.8.25). The low 30 bits are a byte offset. Bit 30 says whether the piece's text is 16-bit (the flag clear, offset used as-is, two bytes per character) or 8-bit (the flag set, the REAL offset being that value halved, one byte per character). Halving is easy to forget and produces text from a plausible-looking but wrong place in the stream; the spec's own worked example makes the point directly -- "Because fCompressed is 1, the actual offset is fc/2, or 0x00000400" -- and is reproduced verbatim in this module's tests.

/** A Clx's leading Prc marker byte, [MS-DOC] 2.9.20: "This value MUST be 0x01." */
const CLXT_PRC = 0x01;
/** A Clx's Pcdt marker byte, [MS-DOC] 2.9.19: "This value MUST be 0x02." */
const CLXT_PCDT = 0x02;
/** Pcd is 8 bytes: a 2-byte bit field, a 4-byte FcCompressed, and a 2-byte Prm. */
const PCD_SIZE = 8;
/** FcCompressed's low 30 bits hold the offset; bit 30 is fCompressed and bit 31 a reserved bit the spec says MUST be zero and MUST be ignored. */
const FC_MASK = 0x3fffffff;
const FC_COMPRESSED_BIT = 0x40000000;
/** PrcData.cbGrpprl is a signed integer that "MUST be less than or equal to 0x3FA2". */
const MAX_CB_GRPPRL = 0x3fa2;

export interface Piece {
  /** The first character position this piece supplies, PlcPcd.aCp[i]. */
  readonly cpStart: number;
  /** One past the last character position this piece supplies, PlcPcd.aCp[i + 1]. */
  readonly cpEnd: number;
  /** FcCompressed's 30-bit offset field as stored -- NOT yet halved for a compressed piece. Use characterOffset() rather than this directly. */
  readonly fc: number;
  /** True when the piece's characters occupy one byte each and its real byte offset is `fc / 2`. */
  readonly compressed: boolean;
  /** Pcd's fNoParaLast: "If this bit is 1, the text MUST NOT contain a paragraph mark." */
  readonly noParaLast: boolean;
  /** Pcd.Prm, [MS-DOC] 2.8.36 -- further property modifications for this piece's text, carried verbatim and not yet applied (see README's scope note). */
  readonly prm: number;
}

export interface PieceTable {
  readonly pieces: readonly Piece[];
  /** PlcPcd.aCp itself: one more entry than there are pieces, so a lookup can bracket every piece and terminate at the document's end. */
  readonly cpKeys: readonly number[];
  /** The final aCp entry, one past the last character position the document defines. */
  readonly lastCp: number;
}

// Parses a Clx ([MS-DOC] 2.9.4): "an array of zero, 1, or more Prcs followed by a Pcdt". The Prcs carry property sets this reader does not yet apply, but they must still be walked to find where the Pcdt begins -- their sizes are the only way past them.
export function parseClx(clx: Uint8Array): PieceTable {
  let cursor = 0;
  for (;;) {
    const clxt = readUint8(clx, cursor);
    if (clxt === CLXT_PCDT) break;
    if (clxt !== CLXT_PRC) {
      throw new DocFormatError(
        `Clx element at offset ${cursor} begins with clxt 0x${clxt.toString(16).padStart(2, "0")}, which is neither a Prc (0x01) nor the Pcdt (0x02)`,
      );
    }
    const cbGrpprl = readInt16LE(clx, cursor + 1);
    if (cbGrpprl < 0 || cbGrpprl > MAX_CB_GRPPRL) {
      throw new DocFormatError(
        `Clx Prc at offset ${cursor} declares cbGrpprl ${cbGrpprl}, outside the 0..0x3FA2 range [MS-DOC] permits`,
      );
    }
    cursor += 3 + cbGrpprl;
    if (cursor > clx.length) {
      throw new DocFormatError(
        `Clx Prc at offset ${cursor - 3 - cbGrpprl} declares a ${cbGrpprl}-byte GrpPrl that runs past the end of the ${clx.length}-byte Clx`,
      );
    }
  }

  const lcb = readUint32LE(clx, cursor + 1);
  const plcPcd = slice(clx, cursor + 5, lcb, "Clx Pcdt PlcPcd");
  const plc = parsePlc(plcPcd, PCD_SIZE, "PlcPcd");

  const pieces: Piece[] = [];
  for (let index = 0; index < plc.count; index += 1) {
    const element = plc.element(index);
    const bits = readUint16LE(element, 0);
    const fcCompressed = readUint32LE(element, 2);
    const cpStart = plc.keys[index];
    const cpEnd = plc.keys[index + 1];
    if (cpStart === undefined || cpEnd === undefined) {
      throw new DocFormatError(
        `PlcPcd element ${index} has no bracketing character positions, so its text range is undefined`,
      );
    }
    pieces.push({
      cpStart,
      cpEnd,
      fc: fcCompressed & FC_MASK,
      compressed: (fcCompressed & FC_COMPRESSED_BIT) !== 0,
      noParaLast: (bits & 0x0001) !== 0,
      prm: readUint16LE(element, 6),
    });
  }

  const lastCp = plc.keys[plc.keys.length - 1];
  if (lastCp === undefined) {
    throw new DocFormatError("PlcPcd carries no character positions at all");
  }
  return { pieces, cpKeys: plc.keys, lastCp };
}

// The byte offset in the WordDocument stream of the character at `cp`, per [MS-DOC] 2.4.1 "Retrieving Text" steps 5 and 6: for an uncompressed piece "the character at position cp is a 16-bit Unicode character at offset FcCompressed.fc + 2(cp - PlcPcd.aCp[i])"; for a compressed one "an 8-bit ANSI character at offset (FcCompressed.fc / 2) + (cp - PlcPcd.aCp[i])".
//
// The same value serves the formatting lookups too: [MS-DOC] 2.4.2's Determining Paragraph Boundaries computes its own fc as `fcPcd + 2(cp - aCp[i])`, halved when fCompressed is one -- algebraically the identical result -- so a character's byte offset is one fact, computed once, and used for the piece table, the CHPX bin table, and the PAPX bin table alike.
export function characterOffset(piece: Piece, cp: number): number {
  if (!Number.isInteger(cp) || cp < piece.cpStart || cp >= piece.cpEnd) {
    throw new DocFormatError(
      `character position ${cp} is outside the piece covering [${piece.cpStart}, ${piece.cpEnd})`,
    );
  }
  const delta = cp - piece.cpStart;
  return piece.compressed
    ? Math.floor(piece.fc / 2) + delta
    : piece.fc + 2 * delta;
}

/** The number of bytes one character occupies in this piece: one for a compressed (8-bit) piece, two for an uncompressed (16-bit) one. */
export function characterSize(piece: Piece): 1 | 2 {
  return piece.compressed ? 1 : 2;
}
