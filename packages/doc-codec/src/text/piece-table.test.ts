import { describe, expect, it } from "vitest";
import { DocFormatError } from "../errors";
import { characterOffset, parseClx } from "./piece-table";

// Assembles a Pcd's 8 bytes from [MS-DOC] 2.8.35's own field table: a 2-byte bit field (fNoParaLast, fR1, fDirty, fR2), then a 4-byte FcCompressed (fc in the low 30 bits, fCompressed at bit 30, r1 at bit 31), then a 2-byte Prm.
function pcd(options: {
  fc: number;
  compressed?: boolean;
  noParaLast?: boolean;
  prm?: number;
}): number[] {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, options.noParaLast === true ? 0x0001 : 0x0000, true);
  view.setUint32(
    2,
    (options.fc >>> 0) | (options.compressed === true ? 0x40000000 : 0),
    true,
  );
  view.setUint16(6, options.prm ?? 0, true);
  return Array.from(bytes);
}

function clxBytes(options: {
  prcs?: number[][];
  cps: number[];
  pcds: number[][];
}): Uint8Array {
  const out: number[] = [];
  for (const grpprl of options.prcs ?? []) {
    out.push(
      0x01,
      grpprl.length & 0xff,
      (grpprl.length >> 8) & 0xff,
      ...grpprl,
    );
  }
  const plc: number[] = [];
  for (const cp of options.cps) {
    plc.push(
      cp & 0xff,
      (cp >> 8) & 0xff,
      (cp >> 16) & 0xff,
      (cp >>> 24) & 0xff,
    );
  }
  for (const element of options.pcds) plc.push(...element);
  out.push(
    0x02,
    plc.length & 0xff,
    (plc.length >> 8) & 0xff,
    (plc.length >> 16) & 0xff,
    (plc.length >>> 24) & 0xff,
    ...plc,
  );
  return new Uint8Array(out);
}

// [MS-DOC] 2.9.6 "Example of a Clx" gives a complete Clx with real values: a 0x2D-byte Clx holding no Prc and one Pcdt whose PlcPcd has four CPs (0, 6, 0x0D, 0x0E) and three Pcds -- an uncompressed piece at fc 0x0C22 carrying "Hello ", a compressed piece at fc 0x0800 (so byte offset 0x400) carrying "World." and a paragraph mark, and a compressed piece at fc 0x080E (byte offset 0x407) carrying one further paragraph mark. Reproducing the published example is the strongest available check that this parser's arithmetic matches the specification's own.
const SPEC_EXAMPLE = clxBytes({
  cps: [0x00000000, 0x00000006, 0x0000000d, 0x0000000e],
  pcds: [
    pcd({ fc: 0x00000c22, noParaLast: true }),
    pcd({ fc: 0x00000800, compressed: true }),
    pcd({ fc: 0x0000080e, compressed: true }),
  ],
});

describe("parseClx against [MS-DOC] 2.9.6's published example", () => {
  it("is the example's own 0x2D bytes long", () => {
    expect(SPEC_EXAMPLE.length).toBe(0x2d);
  });

  it("recovers the example's three pieces and their character-position ranges", () => {
    const table = parseClx(SPEC_EXAMPLE);
    expect(table.pieces.map((piece) => [piece.cpStart, piece.cpEnd])).toEqual([
      [0, 6],
      [6, 13],
      [13, 14],
    ]);
  });

  it("reads the example's compression flags and un-flagged offsets", () => {
    const table = parseClx(SPEC_EXAMPLE);
    expect(table.pieces.map((piece) => piece.compressed)).toEqual([
      false,
      true,
      true,
    ]);
    expect(table.pieces.map((piece) => piece.fc)).toEqual([
      0x0c22, 0x0800, 0x080e,
    ]);
  });

  it("maps each piece's first character to the byte offset the example states", () => {
    const table = parseClx(SPEC_EXAMPLE);
    const [first, second, third] = table.pieces;
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error("the example's three pieces must all be present");
    }
    expect(characterOffset(first, 0)).toBe(0x0c22);
    // "Because fCompressed is 1, the actual offset is fc/2, or 0x00000400."
    expect(characterOffset(second, 6)).toBe(0x0400);
    expect(characterOffset(third, 13)).toBe(0x0407);
  });

  it("advances two bytes per character in an uncompressed piece and one in a compressed piece", () => {
    const table = parseClx(SPEC_EXAMPLE);
    const [first, second] = table.pieces;
    if (first === undefined || second === undefined) {
      throw new Error("the example's first two pieces must be present");
    }
    expect(characterOffset(first, 5)).toBe(0x0c22 + 2 * 5);
    expect(characterOffset(second, 12)).toBe(0x0400 + 6);
  });

  it("reads the example's fNoParaLast bit on the first piece only", () => {
    expect(
      parseClx(SPEC_EXAMPLE).pieces.map((piece) => piece.noParaLast),
    ).toEqual([true, false, false]);
  });
});

describe("parseClx", () => {
  it("skips any leading Prc array to reach the Pcdt", () => {
    const table = parseClx(
      clxBytes({
        prcs: [
          [0x35, 0x08, 0x01],
          [0x36, 0x08, 0x01],
        ],
        cps: [0, 4],
        pcds: [pcd({ fc: 0x200, compressed: true })],
      }),
    );
    expect(table.pieces).toHaveLength(1);
    expect(table.pieces[0]?.fc).toBe(0x200);
  });

  it("rejects a Clx whose first byte is neither a Prc nor the Pcdt marker", () => {
    expect(() => parseClx(new Uint8Array([0x03, 0, 0, 0, 0]))).toThrow(
      DocFormatError,
    );
  });

  it("rejects an empty Clx", () => {
    expect(() => parseClx(new Uint8Array(0))).toThrow(DocFormatError);
  });

  it("rejects a Pcdt whose declared lcb runs past the end of the Clx", () => {
    const bytes = new Uint8Array([0x02, 0xff, 0xff, 0x00, 0x00, 0, 0, 0, 0]);
    expect(() => parseClx(bytes)).toThrow(DocFormatError);
  });

  it("rejects a Prc whose declared cbGrpprl runs past the end of the Clx", () => {
    const bytes = new Uint8Array([0x01, 0xff, 0x7f, 0x00]);
    expect(() => parseClx(bytes)).toThrow(DocFormatError);
  });

  it("rejects a negative cbGrpprl, which the signed field permits and no valid file carries", () => {
    const bytes = new Uint8Array([
      0x01, 0x00, 0x80, 0x02, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(() => parseClx(bytes)).toThrow(DocFormatError);
  });

  it("exposes the character positions as a lookup key array covering every piece", () => {
    const table = parseClx(SPEC_EXAMPLE);
    expect(table.cpKeys).toEqual([0, 6, 13, 14]);
    expect(table.lastCp).toBe(14);
  });
});

describe("characterOffset", () => {
  it("rejects a character position outside the piece it is asked about", () => {
    const piece = parseClx(SPEC_EXAMPLE).pieces[0];
    if (piece === undefined) throw new Error("piece 0 must be present");
    expect(() => characterOffset(piece, 6)).toThrow(DocFormatError);
    expect(() => characterOffset(piece, -1)).toThrow(DocFormatError);
  });
});
