import { describe, expect, it } from "vitest";
import type { ContentCellBorders } from "document-schema.js";
import { DocFormatError } from "../errors";
import { readGrpprl } from "../prop/sprm";
import { applyTableSprms, type TableRowProperties } from "./tap";
import {
  encodeTableRowGrpprl,
  MAX_TABLE_ROW_CELLS,
  type TableCellToWrite,
} from "./tap-write";

const PLAIN_CELL: TableCellToWrite = { vertMerge: 0, horzMerge: 0 };

// Reuses tap.ts's own Prl-folding logic (via applyTableSprms) as the reader half of a round trip -- exactly what table/write.ts's own real pipeline does, since the row mark's grpprl this writer builds is read back through the identical parser real documents use.
function decode(grpprl: readonly number[]): TableRowProperties {
  const prls = readGrpprl(Uint8Array.from(grpprl));
  return applyTableSprms(prls, {});
}

describe("encodeTableRowGrpprl", () => {
  it("rejects a column-boundary array not exactly one longer than the cell count", () => {
    expect(() =>
      encodeTableRowGrpprl([0, 100], [PLAIN_CELL, PLAIN_CELL], undefined),
    ).toThrow(/must carry exactly one more entry/);
  });

  it("rejects zero cells", () => {
    expect(() => encodeTableRowGrpprl([0], [], undefined)).toThrow(
      /must have between 1 and 63 cells, got 0/,
    );
  });

  it("rejects more cells than the format's own 63-cell ceiling", () => {
    const cells = Array.from(
      { length: MAX_TABLE_ROW_CELLS + 1 },
      () => PLAIN_CELL,
    );
    const boundaries = Array.from(
      { length: cells.length + 1 },
      (_u, i) => i * 100,
    );
    expect(() => encodeTableRowGrpprl(boundaries, cells, undefined)).toThrow(
      DocFormatError,
    );
  });

  it("accepts exactly 63 cells, the format's own ceiling", () => {
    const cells = Array.from({ length: MAX_TABLE_ROW_CELLS }, () => PLAIN_CELL);
    const boundaries = Array.from(
      { length: cells.length + 1 },
      (_u, i) => i * 100,
    );
    expect(() =>
      encodeTableRowGrpprl(boundaries, cells, undefined),
    ).not.toThrow();
  });

  it("round-trips column boundaries and cell count through applyTableSprms", () => {
    const grpprl = encodeTableRowGrpprl(
      [0, 100, 300],
      [PLAIN_CELL, PLAIN_CELL],
      undefined,
    );
    const decoded = decode(grpprl);
    expect(decoded.definition?.columnBoundariesTwips).toEqual([0, 100, 300]);
    expect(decoded.definition?.cells).toHaveLength(2);
  });

  it("writes no sprmTDyaRowHeight when heightPt is undefined", () => {
    const grpprl = encodeTableRowGrpprl([0, 100], [PLAIN_CELL], undefined);
    const decoded = decode(grpprl);
    expect(decoded.heightPt).toBeUndefined();
  });

  it("round-trips a given row heightPt", () => {
    const grpprl = encodeTableRowGrpprl([0, 100], [PLAIN_CELL], 36);
    const decoded = decode(grpprl);
    expect(decoded.heightPt).toBeCloseTo(36, 5);
  });

  it("throws for a column boundary outside the signed-16-bit range", () => {
    expect(() =>
      encodeTableRowGrpprl([0, 0x8000], [PLAIN_CELL], undefined),
    ).toThrow(/table column boundary/);
  });

  it("throws for a row height outside the signed-16-bit range", () => {
    expect(() =>
      encodeTableRowGrpprl([0, 100], [PLAIN_CELL], 0x8000 / 20),
    ).toThrow(/table row heightPt/);
  });

  it("throws for a column boundary below the signed-16-bit range's own minimum", () => {
    expect(() =>
      encodeTableRowGrpprl([0, -0x8001], [PLAIN_CELL], undefined),
    ).toThrow(/table column boundary/);
  });

  it("accepts a column boundary at exactly the signed-16-bit range's own minimum", () => {
    const grpprl = encodeTableRowGrpprl([0, -0x8000], [PLAIN_CELL], undefined);
    expect(decode(grpprl).definition?.columnBoundariesTwips).toEqual([
      0, -0x8000,
    ]);
  });

  it("accepts a column boundary at exactly the signed-16-bit range's own maximum", () => {
    const grpprl = encodeTableRowGrpprl([0, 0x7fff], [PLAIN_CELL], undefined);
    expect(decode(grpprl).definition?.columnBoundariesTwips).toEqual([
      0, 0x7fff,
    ]);
  });

  it("round-trips a negative column boundary", () => {
    const grpprl = encodeTableRowGrpprl([-100, 0], [PLAIN_CELL], undefined);
    expect(decode(grpprl).definition?.columnBoundariesTwips).toEqual([-100, 0]);
  });

  it("writes no shading sprm at all for a row where no cell has a background", () => {
    const grpprl = encodeTableRowGrpprl(
      [0, 100, 200],
      [PLAIN_CELL, PLAIN_CELL],
      undefined,
    );
    // sprmTDefTableShd's opcode (little-endian 0xD612 = 0x12, 0xD6) should not appear anywhere past the sprmTDefTable header.
    const shdOpcodeLow = 0x12;
    const shdOpcodeHigh = 0xd6;
    let found = false;
    for (let i = 0; i + 1 < grpprl.length; i += 1) {
      if (grpprl[i] === shdOpcodeLow && grpprl[i + 1] === shdOpcodeHigh) {
        found = true;
      }
    }
    expect(found).toBe(false);
  });

  it("writes a shading array that stops at the last shaded cell, not the whole window", () => {
    const shadedCell: TableCellToWrite = {
      vertMerge: 0,
      horzMerge: 0,
      background: { kind: "solid", color: { r: 1, g: 0, b: 0 } },
    };
    const grpprl = encodeTableRowGrpprl(
      [0, 100, 200, 300],
      [shadedCell, PLAIN_CELL, PLAIN_CELL],
      undefined,
    );
    const decoded = decode(grpprl);
    expect(decoded.definition?.cells[0]?.background).toBeDefined();
    expect(decoded.definition?.cells[1]?.background).toBeUndefined();
  });

  it("writes shd entries only through the window's own last shaded cell, not the whole 22-cell window", () => {
    const shadedCell: TableCellToWrite = {
      vertMerge: 0,
      horzMerge: 0,
      background: { kind: "solid", color: { r: 1, g: 0, b: 0 } },
    };
    const grpprl = encodeTableRowGrpprl(
      [0, 100, 200, 300],
      [shadedCell, PLAIN_CELL, PLAIN_CELL],
      undefined,
    );
    const shdOpcodeLow = 0x12;
    const shdOpcodeHigh = 0xd6;
    let shdLengthByte: number | undefined;
    for (let i = 0; i + 2 < grpprl.length; i += 1) {
      if (grpprl[i] === shdOpcodeLow && grpprl[i + 1] === shdOpcodeHigh) {
        shdLengthByte = grpprl[i + 2];
        break;
      }
    }
    // One Shd (10 bytes: two 4-byte COLORREFs plus a 2-byte ipat) for the single shaded cell -- not 30, which is what writing all three cells in the window (rather than stopping at the last shaded one) would declare instead.
    expect(shdLengthByte).toBe(10);
  });

  it("groups two sides sharing the identical exact-colour border into one sprmTSetBrc", () => {
    const borders: ContentCellBorders = {
      top: { widthPt: 1, color: { r: 0.12, g: 0.34, b: 0.56 } },
      left: { widthPt: 1, color: { r: 0.12, g: 0.34, b: 0.56 } },
    };
    const cell: TableCellToWrite = { vertMerge: 0, horzMerge: 0, borders };
    const grpprl = encodeTableRowGrpprl([0, 100], [cell], undefined);
    const decoded = decode(grpprl);
    const top = decoded.definition?.cells[0]?.borders?.top?.color;
    const left = decoded.definition?.cells[0]?.borders?.left?.color;
    // The exact-colour Brc round-trips through a single byte per channel, so compare to one decimal place rather than the un-quantised input.
    expect(top?.r).toBeCloseTo(0.12, 1);
    expect(top?.g).toBeCloseTo(0.34, 1);
    expect(top?.b).toBeCloseTo(0.56, 1);
    expect(left).toEqual(top);
  });

  it("writes separate sprmTSetBrc groups for two sides with different exact-colour borders", () => {
    const borders: ContentCellBorders = {
      top: { widthPt: 1, color: { r: 0.12, g: 0.34, b: 0.56 } },
      left: { widthPt: 1, color: { r: 0.99, g: 0.01, b: 0.5 } },
    };
    const cell: TableCellToWrite = { vertMerge: 0, horzMerge: 0, borders };
    const grpprl = encodeTableRowGrpprl([0, 100], [cell], undefined);
    const decoded = decode(grpprl);
    expect(decoded.definition?.cells[0]?.borders?.top?.color.r).toBeCloseTo(
      0.12,
      1,
    );
    expect(decoded.definition?.cells[0]?.borders?.left?.color.r).toBeCloseTo(
      0.99,
      1,
    );
  });

  it("does not group two sides whose only difference is widthPt", () => {
    const borders: ContentCellBorders = {
      top: { widthPt: 1, color: { r: 0.12, g: 0.34, b: 0.56 } },
      left: { widthPt: 3, color: { r: 0.12, g: 0.34, b: 0.56 } },
    };
    const cell: TableCellToWrite = { vertMerge: 0, horzMerge: 0, borders };
    const grpprl = encodeTableRowGrpprl([0, 100], [cell], undefined);
    const decoded = decode(grpprl);
    expect(decoded.definition?.cells[0]?.borders?.top?.widthPt).toBeCloseTo(
      1,
      1,
    );
    expect(decoded.definition?.cells[0]?.borders?.left?.widthPt).toBeCloseTo(
      3,
      1,
    );
  });

  it("does not group two sides whose only difference is style", () => {
    const borders: ContentCellBorders = {
      top: {
        widthPt: 1,
        style: "dashed",
        color: { r: 0.12, g: 0.34, b: 0.56 },
      },
      left: {
        widthPt: 1,
        style: "dotted",
        color: { r: 0.12, g: 0.34, b: 0.56 },
      },
    };
    const cell: TableCellToWrite = { vertMerge: 0, horzMerge: 0, borders };
    const grpprl = encodeTableRowGrpprl([0, 100], [cell], undefined);
    const decoded = decode(grpprl);
    expect(decoded.definition?.cells[0]?.borders?.top?.style).toBe("dashed");
    expect(decoded.definition?.cells[0]?.borders?.left?.style).toBe("dotted");
  });

  it("does not group two sides whose only difference is the red colour channel", () => {
    const borders: ContentCellBorders = {
      top: { widthPt: 1, color: { r: 0.1, g: 0.34, b: 0.56 } },
      left: { widthPt: 1, color: { r: 0.9, g: 0.34, b: 0.56 } },
    };
    const cell: TableCellToWrite = { vertMerge: 0, horzMerge: 0, borders };
    const grpprl = encodeTableRowGrpprl([0, 100], [cell], undefined);
    const decoded = decode(grpprl);
    expect(decoded.definition?.cells[0]?.borders?.top?.color.r).toBeCloseTo(
      0.1,
      1,
    );
    expect(decoded.definition?.cells[0]?.borders?.left?.color.r).toBeCloseTo(
      0.9,
      1,
    );
  });

  it("does not group two sides whose only difference is the green colour channel", () => {
    const borders: ContentCellBorders = {
      top: { widthPt: 1, color: { r: 0.12, g: 0.34, b: 0.56 } },
      left: { widthPt: 1, color: { r: 0.12, g: 0.9, b: 0.56 } },
    };
    const cell: TableCellToWrite = { vertMerge: 0, horzMerge: 0, borders };
    const grpprl = encodeTableRowGrpprl([0, 100], [cell], undefined);
    const decoded = decode(grpprl);
    expect(decoded.definition?.cells[0]?.borders?.top?.color.g).toBeCloseTo(
      0.34,
      1,
    );
    expect(decoded.definition?.cells[0]?.borders?.left?.color.g).toBeCloseTo(
      0.9,
      1,
    );
  });

  it("does not group two sides whose only difference is the blue colour channel", () => {
    const borders: ContentCellBorders = {
      top: { widthPt: 1, color: { r: 0.12, g: 0.34, b: 0.1 } },
      left: { widthPt: 1, color: { r: 0.12, g: 0.34, b: 0.9 } },
    };
    const cell: TableCellToWrite = { vertMerge: 0, horzMerge: 0, borders };
    const grpprl = encodeTableRowGrpprl([0, 100], [cell], undefined);
    const decoded = decode(grpprl);
    expect(decoded.definition?.cells[0]?.borders?.top?.color.b).toBeCloseTo(
      0.1,
      1,
    );
    expect(decoded.definition?.cells[0]?.borders?.left?.color.b).toBeCloseTo(
      0.9,
      1,
    );
  });

  it("attributes an exact-colour border to the correct cell when it is not the row's first", () => {
    const borders: ContentCellBorders = {
      top: { widthPt: 1, color: { r: 0.12, g: 0.34, b: 0.56 } },
    };
    const cellWithBorder: TableCellToWrite = {
      vertMerge: 0,
      horzMerge: 0,
      borders,
    };
    const grpprl = encodeTableRowGrpprl(
      [0, 100, 200],
      [PLAIN_CELL, cellWithBorder],
      undefined,
    );
    const decoded = decode(grpprl);
    expect(decoded.definition?.cells[0]?.borders?.top).toBeUndefined();
    expect(decoded.definition?.cells[1]?.borders?.top?.color.r).toBeCloseTo(
      0.12,
      1,
    );
  });
});
