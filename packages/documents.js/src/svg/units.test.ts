import { describe, expect, it } from "vitest";
import { parseSvgLengthPt, parseSvgUserUnits, parseSvgViewBox } from "./units";

describe("parseSvgLengthPt", () => {
  it("resolves a bare number as one CSS px, at the exact 0.75pt ratio", () => {
    expect(parseSvgLengthPt("100")).toBe(75);
    expect(parseSvgLengthPt("100px")).toBe(75);
    expect(parseSvgLengthPt(".5")).toBe(0.375);
    expect(parseSvgLengthPt("1e2")).toBe(75);
  });

  it("converts each absolute unit by its exact factor", () => {
    expect(parseSvgLengthPt("72pt")).toBe(72);
    expect(parseSvgLengthPt("1in")).toBe(72);
    expect(parseSvgLengthPt("25.4mm")).toBeCloseTo(72, 9);
    expect(parseSvgLengthPt("2.54cm")).toBeCloseTo(72, 9);
    expect(parseSvgLengthPt("1pc")).toBe(12);
    // One q is a quarter millimetre, so 40q is 10mm -- not the 72pt of an inch.
    expect(parseSvgLengthPt("40q")).toBeCloseTo((10 / 25.4) * 72, 9);
  });

  it("returns undefined for em/ex/percent and malformed values, never a silent zero", () => {
    expect(parseSvgLengthPt("12em")).toBeUndefined();
    expect(parseSvgLengthPt("3ex")).toBeUndefined();
    expect(parseSvgLengthPt("50%")).toBeUndefined();
    expect(parseSvgLengthPt("wide")).toBeUndefined();
    expect(parseSvgLengthPt("10px5")).toBeUndefined();
    expect(parseSvgLengthPt("")).toBeUndefined();
    expect(parseSvgLengthPt(undefined)).toBeUndefined();
  });
});

describe("parseSvgUserUnits", () => {
  it("keeps a bare number the identity, since geometry attributes live in the user coordinate system the root map scales afterwards", () => {
    expect(parseSvgUserUnits("10")).toBe(10);
  });

  it("converts absolute units into user units through the exact px ratio", () => {
    // 100pt is 100/0.75 px; anything else would double-scale once the root viewBox map applies.
    expect(parseSvgUserUnits("100pt")).toBeCloseTo(100 / 0.75, 9);
    expect(parseSvgUserUnits("1in")).toBeCloseTo(96, 9);
  });

  it("returns undefined for the font-relative and percentage forms", () => {
    expect(parseSvgUserUnits("2em")).toBeUndefined();
    expect(parseSvgUserUnits("50%")).toBeUndefined();
  });
});

describe("parseSvgViewBox", () => {
  it("parses four whitespace or comma separated numbers", () => {
    expect(parseSvgViewBox("0 0 100 60")).toEqual({
      minX: 0,
      minY: 0,
      width: 100,
      height: 60,
    });
    expect(parseSvgViewBox("-10 -5,100,60")).toEqual({
      minX: -10,
      minY: -5,
      width: 100,
      height: 60,
    });
  });

  it("returns undefined for the wrong count and for negative dimensions", () => {
    expect(parseSvgViewBox("0 0 100")).toBeUndefined();
    expect(parseSvgViewBox("0 0 100 60 5")).toBeUndefined();
    expect(parseSvgViewBox("0 0 -100 60")).toBeUndefined();
    expect(parseSvgViewBox("0 0 100 abc")).toBeUndefined();
    expect(parseSvgViewBox(undefined)).toBeUndefined();
  });

  it("accepts a zero dimension as legal-but-degenerate, leaving the classification to the caller", () => {
    expect(parseSvgViewBox("0 0 0 60")).toEqual({
      minX: 0,
      minY: 0,
      width: 0,
      height: 60,
    });
  });
});
