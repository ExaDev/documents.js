import { describe, expect, it } from "vitest";
import {
  CELL_FILL_COLORS_SUBFUNCTION,
  CELL_INFORMATION_SUBFUNCTION,
  CELL_SPANNING_SUBFUNCTION,
  findEmbeddedSubfunction,
  readCellFill,
  readCellInformation,
  readCellSpanning,
  readEmbeddedSubfunctions,
  readRowInformation,
  readTableColumnWidthPt,
  ROW_INFORMATION_SUBFUNCTION,
} from "./table";

function word(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

// An embedded subfunction, gated by its own code at both ends the way every multi-byte function is.
function gated(code: number, payload: readonly number[]): number[] {
  return [code, ...payload, code];
}

// An End-of-Line function's non-deletable region: "[size of deletable subfunction data]", then the deletable subfunctions, then the non-deletable ones this package reads.
function eolNonDeletable(options: {
  readonly deletable?: readonly number[];
  readonly nonDeletable?: readonly number[];
}): Uint8Array {
  const deletable = options.deletable ?? [];
  return new Uint8Array([
    ...word(deletable.length),
    ...deletable,
    ...(options.nonDeletable ?? []),
  ]);
}

describe("readTableColumnWidthPt", () => {
  // "[size of non-deletable information = 17]": <flags> then [width], so the width is the word at offset 1. Two inches is 2400 WordPerfect Units and 144 points.
  it("reads the column width out of the Table Column function", () => {
    const nonDeletable = new Uint8Array(17);
    nonDeletable.set(word(2400), 1);
    expect(readTableColumnWidthPt(nonDeletable)).toBe(144);
  });

  it("declines a Table Column function shorter than its own field list", () => {
    expect(readTableColumnWidthPt(new Uint8Array(8))).toBeUndefined();
  });

  it("declines a column that states no width", () => {
    expect(readTableColumnWidthPt(new Uint8Array(17))).toBeUndefined();
  });
});

describe("readEmbeddedSubfunctions", () => {
  it("walks past the deletable half to the documented subfunctions after it", () => {
    const { subfunctions, truncated } = readEmbeddedSubfunctions(
      eolNonDeletable({
        deletable: [0xaa, 0xbb, 0xcc],
        nonDeletable: [...gated(CELL_SPANNING_SUBFUNCTION, [2, 1])],
      }),
    );
    expect(truncated).toBe(false);
    expect(subfunctions.map((subfunction) => subfunction.code)).toEqual([
      CELL_SPANNING_SUBFUNCTION,
    ]);
  });

  it("reads several subfunctions in one function", () => {
    const { subfunctions } = readEmbeddedSubfunctions(
      eolNonDeletable({
        nonDeletable: [
          ...gated(ROW_INFORMATION_SUBFUNCTION, [0x02, ...word(1200)]),
          ...gated(CELL_INFORMATION_SUBFUNCTION, [
            0x02,
            0x02,
            0x00,
            ...word(0),
            ...word(0),
          ]),
          ...gated(CELL_SPANNING_SUBFUNCTION, [3, 1]),
        ],
      }),
    );
    expect(subfunctions.map((subfunction) => subfunction.code)).toEqual([
      ROW_INFORMATION_SUBFUNCTION,
      CELL_INFORMATION_SUBFUNCTION,
      CELL_SPANNING_SUBFUNCTION,
    ]);
  });

  // "New Cell Formula Embedded Subfunction ... <129 (0x81)> [size = variable] [length of formula] <tokenized formula> [length] <129 (0x81)>" -- the only member whose length is stated in the record rather than in the SDK's own size column.
  it("steps over the variable-length cell formula by its own length word", () => {
    const { subfunctions, truncated } = readEmbeddedSubfunctions(
      eolNonDeletable({
        nonDeletable: [
          0x81,
          ...word(3),
          0x11,
          0x22,
          0x33,
          ...word(3),
          0x81,
          ...gated(CELL_SPANNING_SUBFUNCTION, [1, 1]),
        ],
      }),
    );
    expect(truncated).toBe(false);
    expect(subfunctions.map((subfunction) => subfunction.code)).toEqual([
      0x81,
      CELL_SPANNING_SUBFUNCTION,
    ]);
  });

  // "Don't End a Paragraph Style for this Hard Return ... <141 (0x8D)> (size = 1)" -- one byte, no payload, and no closing gate, unlike every other member.
  it("reads the one gateless subfunction as a single byte", () => {
    const { subfunctions, truncated } = readEmbeddedSubfunctions(
      eolNonDeletable({
        nonDeletable: [0x8d, ...gated(CELL_SPANNING_SUBFUNCTION, [1, 1])],
      }),
    );
    expect(truncated).toBe(false);
    expect(subfunctions.map((subfunction) => subfunction.code)).toEqual([
      0x8d,
      CELL_SPANNING_SUBFUNCTION,
    ]);
  });

  // A record whose size the SDK does not state cannot be stepped over, so the walk stops rather than guessing a length and decoding the rest as rubbish. 0x8A is the reserved member.
  it("stops at a subfunction of undocumented length and reports the truncation", () => {
    const { subfunctions, truncated } = readEmbeddedSubfunctions(
      eolNonDeletable({
        nonDeletable: [
          ...gated(CELL_SPANNING_SUBFUNCTION, [1, 1]),
          0x8a,
          0x00,
          0x8a,
          ...gated(ROW_INFORMATION_SUBFUNCTION, [0x00, ...word(0)]),
        ],
      }),
    );
    expect(truncated).toBe(true);
    expect(subfunctions.map((subfunction) => subfunction.code)).toEqual([
      CELL_SPANNING_SUBFUNCTION,
    ]);
  });

  // Every member but the gateless one repeats its own code as an end gate, exactly as the enclosing function does; a mismatch means the walk is out of step.
  it("stops when an end gate does not match its own begin gate", () => {
    const { subfunctions, truncated } = readEmbeddedSubfunctions(
      eolNonDeletable({
        nonDeletable: [CELL_SPANNING_SUBFUNCTION, 1, 1, 0x99],
      }),
    );
    expect(truncated).toBe(true);
    expect(subfunctions).toHaveLength(0);
  });

  it("reports a deletable size that overruns its own function", () => {
    const { truncated } = readEmbeddedSubfunctions(
      new Uint8Array([...word(64), 0x00]),
    );
    expect(truncated).toBe(true);
  });
});

describe("readRowInformation", () => {
  // "<row flags> bit 1: 0 = automatic height, 1 = fixed height" then "[row height if fixed (WPU)]".
  it("reads a fixed row height", () => {
    expect(readRowInformation(new Uint8Array([0x02, ...word(1200)]))).toEqual({
      headerRow: false,
      heightPt: 72,
    });
  });

  it("reports no height for an automatic-height row", () => {
    expect(readRowInformation(new Uint8Array([0x00, ...word(1200)]))).toEqual({
      headerRow: false,
      heightPt: undefined,
    });
  });

  // "bit 2: 0 = not a header row, 1 = this is a header row".
  it("reads the header-row flag", () => {
    expect(
      readRowInformation(new Uint8Array([0x04, ...word(0)]))?.headerRow,
    ).toBe(true);
  });
});

describe("readCellInformation", () => {
  // "<flag> bit 1: 1 = use cell justification" then "<justification> bits 0-2: 0 = left, 1 = full, 2 = center, 3 = right".
  it("reads a cell's own justification when its flag claims one", () => {
    expect(
      readCellInformation(
        new Uint8Array([0x02, 0x02, 0x00, ...word(0), ...word(0)]),
      ),
    ).toEqual({ alignment: "center" });
  });

  it("states no alignment for a cell that inherits its justification", () => {
    expect(
      readCellInformation(
        new Uint8Array([0x00, 0x03, 0x00, ...word(0), ...word(0)]),
      ),
    ).toEqual({ alignment: undefined });
  });
});

describe("readCellSpanning", () => {
  it("reads a horizontal span", () => {
    expect(readCellSpanning(new Uint8Array([3, 1]))).toEqual({
      columnSpan: 3,
      rowSpan: 1,
      coveredFromLeft: false,
      coveredFromAbove: false,
    });
  });

  // "bit 7 is set if spanned from left" / "bit 7 is set if spanned from above" -- the high bit marks a cell COVERED by a neighbour's merge rather than the cell doing the merging.
  it("marks a cell covered from the left", () => {
    expect(
      readCellSpanning(new Uint8Array([0x81, 0x01]))?.coveredFromLeft,
    ).toBe(true);
  });

  it("marks a cell covered from above", () => {
    expect(
      readCellSpanning(new Uint8Array([0x01, 0x82]))?.coveredFromAbove,
    ).toBe(true);
  });
});

describe("readCellFill", () => {
  // "<foreground color (RGBS)> x 4, <background color (RGBS)> x 4" -- red, green, blue, and a shading percentage per colour, "where 255 is 100%".
  it("reads the background colour of a fully-shaded fill", () => {
    expect(
      readCellFill(new Uint8Array([0, 0, 0, 255, 255, 0, 0, 255])),
    ).toEqual({ background: { r: 1, g: 0, b: 0 }, blended: false });
  });

  it("reports a partially-shaded fill as a blend the schema cannot express", () => {
    expect(
      readCellFill(new Uint8Array([255, 255, 255, 255, 0, 0, 255, 128]))
        ?.blended,
    ).toBe(true);
  });
});

describe("findEmbeddedSubfunction", () => {
  it("answers undefined for a subfunction the list does not carry", () => {
    const { subfunctions } = readEmbeddedSubfunctions(
      eolNonDeletable({
        nonDeletable: [...gated(CELL_SPANNING_SUBFUNCTION, [1, 1])],
      }),
    );
    expect(
      findEmbeddedSubfunction(subfunctions, CELL_FILL_COLORS_SUBFUNCTION),
    ).toBeUndefined();
  });
});
