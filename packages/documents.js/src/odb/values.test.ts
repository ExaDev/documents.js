import type { ContentCellValue } from "document-schema.js";
import { describe, expect, it } from "vitest";
import {
  aggregateCellValues,
  CELL_NULL,
  cellComparisonKey,
  cellValuesEqual,
  compareCellValues,
} from "./values";

// Direct coverage for the value semantics src/odb/sql/ and src/odb/formula/ now share. Both engines exercise these indirectly through their own suites; this file pins the contract itself, so a change made to satisfy one engine cannot quietly alter the other's behaviour without a test here failing first.

function fail(message: string): Error {
  return new Error(message);
}

const NUMERIC: readonly ContentCellValue[] = [
  { kind: "number", value: 1 },
  { kind: "percentage", value: 1 },
  { kind: "currency", value: 1, currency: "GBP" },
];

describe("cellComparisonKey", () => {
  it("sorts every value kind into one of three classes, with NULL in none of them", () => {
    expect(
      NUMERIC.map((value) => cellComparisonKey(value)?.valueClass),
    ).toEqual(["numeric", "numeric", "numeric"]);
    expect(
      cellComparisonKey({ kind: "boolean", value: true })?.valueClass,
    ).toBe("boolean");
    for (const kind of [
      "date",
      "time",
      "dateTime",
      "string",
      "error",
    ] as const) {
      expect(cellComparisonKey({ kind, value: "x" })?.valueClass).toBe("text");
    }
    expect(cellComparisonKey(CELL_NULL)).toBeUndefined();
  });
});

describe("compareCellValues", () => {
  it("orders within a class", () => {
    expect(
      compareCellValues(
        { kind: "number", value: 1 },
        { kind: "number", value: 2 },
        fail,
      ),
    ).toBeLessThan(0);
    expect(
      compareCellValues(
        { kind: "string", value: "b" },
        { kind: "string", value: "a" },
        fail,
      ),
    ).toBeGreaterThan(0);
    // false sorts before true.
    expect(
      compareCellValues(
        { kind: "boolean", value: false },
        { kind: "boolean", value: true },
        fail,
      ),
    ).toBeLessThan(0);
  });

  it("compares a percentage or currency against a plain number, since all three are one numeric class", () => {
    expect(
      compareCellValues(
        { kind: "currency", value: 5, currency: "GBP" },
        { kind: "number", value: 5 },
        fail,
      ),
    ).toBe(0);
  });

  it("throws across classes rather than coercing, and builds the error the caller asked for", () => {
    expect(() =>
      compareCellValues(
        { kind: "number", value: 1 },
        { kind: "string", value: "1" },
        fail,
      ),
    ).toThrow("cannot compare a numeric value with a text value");
    expect(() =>
      compareCellValues({ kind: "number", value: 1 }, CELL_NULL, fail),
    ).toThrow(/already ruled NULL out/);
  });
});

describe("cellValuesEqual", () => {
  it("is total where compareCellValues is partial: a cross-class pair is unequal rather than an error", () => {
    expect(
      cellValuesEqual(
        { kind: "number", value: 1 },
        { kind: "string", value: "1" },
      ),
    ).toBe(false);
    expect(
      cellValuesEqual(
        { kind: "boolean", value: true },
        { kind: "number", value: 1 },
      ),
    ).toBe(false);
  });

  it("makes two NULLs equal to each other and to nothing else", () => {
    expect(cellValuesEqual(CELL_NULL, CELL_NULL)).toBe(true);
    expect(cellValuesEqual(CELL_NULL, { kind: "string", value: "" })).toBe(
      false,
    );
  });

  it("agrees with compareCellValues wherever both apply", () => {
    const comparable: readonly ContentCellValue[] = [
      { kind: "number", value: 1 },
      { kind: "number", value: 2 },
      { kind: "string", value: "a" },
      { kind: "string", value: "b" },
      { kind: "boolean", value: true },
      { kind: "boolean", value: false },
    ];
    for (const left of comparable) {
      for (const right of comparable) {
        if (
          cellComparisonKey(left)?.valueClass !==
          cellComparisonKey(right)?.valueClass
        ) {
          continue;
        }
        expect(cellValuesEqual(left, right)).toBe(
          compareCellValues(left, right, fail) === 0,
        );
      }
    }
  });
});

describe("aggregateCellValues", () => {
  const VALUES: readonly ContentCellValue[] = [
    { kind: "number", value: 1 },
    { kind: "number", value: 2 },
    CELL_NULL,
    { kind: "number", value: 6 },
  ];

  it("skips NULLs in all five aggregates", () => {
    expect(aggregateCellValues("COUNT", VALUES, fail)).toEqual({
      kind: "number",
      value: 3,
    });
    expect(aggregateCellValues("SUM", VALUES, fail)).toEqual({
      kind: "number",
      value: 9,
    });
    expect(aggregateCellValues("AVG", VALUES, fail)).toEqual({
      kind: "number",
      value: 3,
    });
    expect(aggregateCellValues("MIN", VALUES, fail)).toEqual({
      kind: "number",
      value: 1,
    });
    expect(aggregateCellValues("MAX", VALUES, fail)).toEqual({
      kind: "number",
      value: 6,
    });
  });

  it("returns NULL from everything but COUNT when nothing non-NULL is present", () => {
    for (const values of [[], [CELL_NULL, CELL_NULL]]) {
      expect(aggregateCellValues("COUNT", values, fail)).toEqual({
        kind: "number",
        value: 0,
      });
      for (const aggregate of ["SUM", "AVG", "MIN", "MAX"] as const) {
        expect(aggregateCellValues(aggregate, values, fail)).toEqual(CELL_NULL);
      }
    }
  });

  it("lets MIN and MAX order text, which SUM and AVG refuse", () => {
    const words: readonly ContentCellValue[] = [
      { kind: "string", value: "b" },
      { kind: "string", value: "a" },
    ];
    expect(aggregateCellValues("MIN", words, fail)).toEqual({
      kind: "string",
      value: "a",
    });
    expect(aggregateCellValues("MAX", words, fail)).toEqual({
      kind: "string",
      value: "b",
    });
    expect(() => aggregateCellValues("SUM", words, fail)).toThrow(
      "SUM requires numeric values, but found a string value",
    );
  });
});
