// The inverse of piece-table.ts's parseClx: builds a Clx ([MS-DOC] 2.9.4) describing the logical text stream as a SINGLE uncompressed (16-bit) piece. One piece is the simplest genuinely-conformant Clx a producer can write -- [MS-DOC] never requires more than one, "fast save" (fComplex) incremental edits are what fragment a real document's text into many, and this package never performs one -- and uncompressed characters sidestep characters.ts's own COMPRESSED_CHARACTER_MAP entirely: every UTF-16 code unit round-trips through a 16-bit piece with no byte-mapping table to invert, where a compressed (8-bit) piece could not represent a code unit outside Windows-1252's own range at all.
//
// clxt-Prc (a leading property-modification array) is never written: [MS-DOC] 2.9.4 permits "zero, 1, or more Prcs" before the Pcdt, and this package's writer applies no piece-scoped property beyond what its own PAPX/CHPX bin tables already carry.

import { DocFormatError } from "../errors";

/** Pcdt's own marker byte, [MS-DOC] 2.9.19. */
const CLXT_PCDT = 0x02;
/** Pcd is 8 bytes: a 2-byte bit field, a 4-byte FcCompressed, and a 2-byte Prm. */
const PCD_SIZE = 8;

function push32(bytes: number[], value: number): void {
  bytes.push(
    value & 0xff,
    (value >> 8) & 0xff,
    (value >> 16) & 0xff,
    (value >>> 24) & 0xff,
  );
}

// Builds a Clx whose one Pcd covers character positions [0, characterCount) as uncompressed 16-bit text starting at `textFc` in the WordDocument stream. characterCount must be at least 1: [MS-DOC] 2.4.2 requires the Main Document's own text to end in a paragraph mark, so an empty piece table would describe a document that cannot exist.
export function buildTextClx(
  characterCount: number,
  textFc: number,
): Uint8Array {
  if (!Number.isInteger(characterCount) || characterCount < 1) {
    throw new DocFormatError(
      `a Clx must cover at least one character position (the mandatory closing paragraph mark); got characterCount ${characterCount}`,
    );
  }

  const plcPcd: number[] = [];
  push32(plcPcd, 0); // aCp[0].
  push32(plcPcd, characterCount); // aCp[1].
  plcPcd.push(0x00, 0x00); // Pcd bit field: fNoParaLast clear (the text does contain paragraph marks), fDirty clear.
  push32(plcPcd, textFc); // FcCompressed: bit 30 (fCompressed) clear, so fc is used as-is for 16-bit text.
  plcPcd.push(0x00, 0x00); // Prm: no additional property modifications.
  if ((plcPcd.length - 4) / (4 + PCD_SIZE) !== 1) {
    throw new DocFormatError(
      "buildTextClx's own PlcPcd does not describe exactly one piece; this is an internal defect, not an input error",
    );
  }

  const clx = [CLXT_PCDT];
  push32(clx, plcPcd.length);
  clx.push(...plcPcd);
  return new Uint8Array(clx);
}
