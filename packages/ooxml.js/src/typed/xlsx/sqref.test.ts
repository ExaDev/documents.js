import { describe, expect, it } from "vitest";
import { formatSqref, formatSqrefRange, parseSqref } from "./sqref";

describe("parseSqref", () => {
  it("returns an empty array for an absent sqref", () => {
    expect(parseSqref(undefined)).toEqual([]);
  });

  it("returns an empty array for an empty string", () => {
    expect(parseSqref("")).toEqual([]);
  });

  it("parses a single bare cell as a zero-width range", () => {
    expect(parseSqref("A1")).toEqual([
      { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 },
    ]);
  });

  it("parses a real span", () => {
    expect(parseSqref("A1:B2")).toEqual([
      { startRow: 0, startColumn: 0, endRow: 1, endColumn: 1 },
    ]);
  });

  it("parses several ranges separated by a single space", () => {
    expect(parseSqref("A1 C1")).toEqual([
      { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 },
      { startRow: 0, startColumn: 2, endRow: 0, endColumn: 2 },
    ]);
  });

  it("parses several ranges separated by a run of more than one whitespace character, exactly as it would a single one", () => {
    expect(parseSqref("A1  C1")).toEqual(parseSqref("A1 C1"));
    expect(parseSqref("A1\t\tC1")).toEqual(parseSqref("A1 C1"));
  });

  it("skips a malformed token, keeping the well-formed ranges either side of it", () => {
    expect(parseSqref("A1 not-a-range C1")).toEqual([
      { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 },
      { startRow: 0, startColumn: 2, endRow: 0, endColumn: 2 },
    ]);
  });

  it("returns an empty array when every token is malformed", () => {
    expect(parseSqref("not a range")).toEqual([]);
  });
});

describe("formatSqrefRange", () => {
  it("formats a zero-width range as a bare cell reference", () => {
    expect(
      formatSqrefRange({
        startRow: 0,
        startColumn: 0,
        endRow: 0,
        endColumn: 0,
      }),
    ).toBe("A1");
  });

  it("formats a real span as a colon-separated range reference", () => {
    expect(
      formatSqrefRange({
        startRow: 0,
        startColumn: 0,
        endRow: 1,
        endColumn: 1,
      }),
    ).toBe("A1:B2");
  });

  it("formats a range that spans rows but not columns as a real span, not a bare cell", () => {
    expect(
      formatSqrefRange({
        startRow: 0,
        startColumn: 0,
        endRow: 1,
        endColumn: 0,
      }),
    ).toBe("A1:A2");
  });

  it("formats a range that spans columns but not rows as a real span, not a bare cell", () => {
    expect(
      formatSqrefRange({
        startRow: 0,
        startColumn: 0,
        endRow: 0,
        endColumn: 1,
      }),
    ).toBe("A1:B1");
  });
});

describe("formatSqref", () => {
  it("formats an empty range list as an empty string", () => {
    expect(formatSqref([])).toBe("");
  });

  it("joins several ranges with a single space, each in its own bare/span form", () => {
    expect(
      formatSqref([
        { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 },
        { startRow: 0, startColumn: 2, endRow: 1, endColumn: 3 },
      ]),
    ).toBe("A1 C1:D2");
  });
});
