import { describe, expect, it } from "vitest";
import { decodeCcittFax } from "./ccitt";
import { encodeCcittFax } from "./ccitt-encode";

function packed(rows: string[]): Uint8Array {
  // Each string is one row, "1" = white and "0" = black, MSB first; rows are padded to whole bytes like the decoder's own output.
  const rowBytes = Math.ceil((rows[0]?.length ?? 0) / 8);
  const bytes = new Uint8Array(rowBytes * rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === "1") {
        const index = y * rowBytes + (x >> 3);
        bytes[index] = (bytes[index] ?? 0) | (0x80 >> (x & 7));
      }
    }
  });
  return bytes;
}

function reread(bitmap: Uint8Array, columns: number, rowsCount: number) {
  const encoded = encodeCcittFax(bitmap, { columns, rows: rowsCount });
  if (encoded === undefined) {
    throw new Error("an unbudgeted encode can never abort");
  }
  return decodeCcittFax(encoded, {
    k: -1,
    columns,
    rows: rowsCount,
  });
}

// The decoded row equals the original in its first `columns` bits; renderRow pre-fills every row byte white (its own documented convention for pad bits past a non-byte-aligned width), so the pad bits carry no data and are masked out of the comparison.
function realPixelBytes(bytes: Uint8Array, columns: number, rowsCount: number) {
  const rowBytes = Math.ceil(columns / 8);
  const padMask =
    columns % 8 === 0 ? 0xff : (0xff << (8 - (columns % 8))) & 0xff;
  const out: number[] = [];
  for (let y = 0; y < rowsCount; y++) {
    for (let b = 0; b < rowBytes; b++) {
      out.push(
        (bytes[y * rowBytes + b] ?? 0) & (b === rowBytes - 1 ? padMask : 0xff),
      );
    }
  }
  return out;
}

describe("encodeCcittFax: exact bit strings", () => {
  it("codes an all-white row pair as one vertical-mode bit per row", () => {
    // Line 0 against the imaginary all-white reference: a1 = b1 = the sentinel columns, delta 0, so one "1" bit. Line 1 is identical against line 0. Two rows of one bit each = "11", zero-padded to 0xC0.
    const encoded = encodeCcittFax(packed(["11111111", "11111111"]), {
      columns: 8,
      rows: 2,
    });
    expect(encoded).toBeDefined();
    expect(Array.from(encoded!)).toEqual([0b11000000]);
  });

  it("codes a first black row horizontally with a zero-length leading white run", () => {
    // 8 black pixels on line 0 against the all-white reference: a1 = 0 (the a0-run is still white, a1 is its first black change), b1 = the sentinel columns = 8, delta -8 is outside vertical range, so horizontal mode codes run 0 white then run 8 black: "001" + white-0 "00110101" + black-8 "000101" -- 17 bits, the last landing alone in a third zero-padded byte.
    const encoded = encodeCcittFax(packed(["00000000"]), {
      columns: 8,
      rows: 1,
    });
    expect(encoded).toBeDefined();
    expect(Array.from(encoded!)).toEqual([0x26, 0xa2, 0x80]);
    expect(
      decodeCcittFax(encoded!, { k: -1, columns: 8, rows: 1 }).bytes[0],
    ).toBe(0b00000000);
  });
});

describe("encodeCcittFax: round trips through this package's own decoder", () => {
  const cases: readonly (readonly [string, string[]])[] = [
    ["all white", ["11111111", "11111111", "11111111"]],
    ["all black", ["00000000", "00000000"]],
    ["single black run", ["11000011", "11000011"]],
    ["checkerboard", ["10101010", "01010101", "10101010"]],
    ["non-byte-aligned width", ["1111111100011", "0000111111111"]],
    [
      "wide runs exercising make-up codes",
      ["1".repeat(300), "0".repeat(300), "1".repeat(150) + "0".repeat(150)],
    ],
    [
      "many changes",
      ["11001100110011001100110011001100", "00110011001100110011001100110011"],
    ],
  ];

  for (const [name, rows] of cases) {
    it(`round-trips ${name}`, () => {
      const columns = rows[0]!.length;
      const bitmap = packed(rows);
      const decoded = reread(bitmap, columns, rows.length);
      expect(decoded.columns).toBe(columns);
      expect(decoded.rows).toBe(rows.length);
      expect(realPixelBytes(decoded.bytes, columns, rows.length)).toEqual(
        realPixelBytes(bitmap, columns, rows.length),
      );
    });
  }

  it("round-trips a deterministic pseudo-random page of scan-like rows", () => {
    // Long alternating runs of random lengths -- the shape a dithered scan actually takes, exercising pass and every vertical offset.
    let state = 0x12345678;
    const random = (): number => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state;
    };
    const rowsCount = 40;
    const columns = 173;
    const rows: string[] = [];
    for (let y = 0; y < rowsCount; y++) {
      let row = "";
      while (row.length < columns) {
        const run = 1 + (random() % 12);
        row += (y + row.length) % 2 === 0 ? "1".repeat(run) : "0".repeat(run);
      }
      rows.push(row.slice(0, columns));
    }
    const bitmap = packed(rows);
    const decoded = reread(bitmap, columns, rowsCount);
    expect(realPixelBytes(decoded.bytes, columns, rowsCount)).toEqual(
      realPixelBytes(bitmap, columns, rowsCount),
    );
  });

  it("aborts as soon as the stream exceeds the budget, answering undefined", () => {
    // A checkerboard is G4's worst case (every run one pixel, coded horizontally); with a budget of 0 the encoder must stop on its first mode emission rather than emitting the whole losing stream.
    const rows = Array.from({ length: 64 }, (_, y) =>
      y % 2 === 0 ? "10101010" : "01010101",
    );
    expect(
      encodeCcittFax(packed(rows), { columns: 8, rows: 64, maxBytes: 0 }),
    ).toBeUndefined();
  });
});
