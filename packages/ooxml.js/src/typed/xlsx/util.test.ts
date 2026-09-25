import { describe, expect, it } from "vitest";
import { PAGE_SIZE_A4, PAGE_SIZE_LETTER } from "document-schema.js";
import {
  PAPER_SIZE_TOLERANCE_PT,
  pageSizeToPaperSizeCode,
  paperSizeCodeToPageSize,
  parseUniversalMeasureToPt,
  ptToUniversalMeasure,
  readXmlBool,
  writeXmlBool,
} from "./util";

// One inch in points (the universal-measure round-trip fixture value below), and the number of decimal places toBeCloseTo checks each conversion's agreement to.
const ONE_INCH_IN_PT = 72;
const CLOSE_TO_PRECISION_DIGITS = 9;
// How far outside PAPER_SIZE_TOLERANCE_PT a fixture dimension is deliberately pushed to prove the tolerance check actually rejects a genuinely different page size, not just a drifted one.
const OUTSIDE_TOLERANCE_PT = 50;

describe("readXmlBool / writeXmlBool", () => {
  it("accepts both spec-legal xsd:boolean spellings", () => {
    expect(readXmlBool("1")).toBe(true);
    expect(readXmlBool("true")).toBe(true);
  });

  it('treats "0", "false", and an absent attribute all as false', () => {
    expect(readXmlBool("0")).toBe(false);
    expect(readXmlBool("false")).toBe(false);
    expect(readXmlBool(undefined)).toBe(false);
  });

  it("rejects a nonsense value as false rather than throwing", () => {
    expect(readXmlBool("yes")).toBe(false);
  });

  it('always writes the "true"/"false" spelling', () => {
    expect(writeXmlBool(true)).toBe("true");
    expect(writeXmlBool(false)).toBe("false");
  });
});

describe("parseUniversalMeasureToPt", () => {
  it("parses every supported unit suffix", () => {
    expect(parseUniversalMeasureToPt("72pt")).toBe(ONE_INCH_IN_PT);
    expect(parseUniversalMeasureToPt("1in")).toBeCloseTo(
      ONE_INCH_IN_PT,
      CLOSE_TO_PRECISION_DIGITS,
    );
    expect(parseUniversalMeasureToPt("2.54cm")).toBeCloseTo(
      ONE_INCH_IN_PT,
      CLOSE_TO_PRECISION_DIGITS,
    );
    expect(parseUniversalMeasureToPt("25.4mm")).toBeCloseTo(
      ONE_INCH_IN_PT,
      CLOSE_TO_PRECISION_DIGITS,
    );
    expect(parseUniversalMeasureToPt("6pc")).toBeCloseTo(
      ONE_INCH_IN_PT,
      CLOSE_TO_PRECISION_DIGITS,
    );
    expect(parseUniversalMeasureToPt("6pi")).toBeCloseTo(
      ONE_INCH_IN_PT,
      CLOSE_TO_PRECISION_DIGITS,
    );
  });

  it("rejects a malformed or unsupported-unit value", () => {
    expect(parseUniversalMeasureToPt("12furlongs")).toBeUndefined();
    expect(parseUniversalMeasureToPt("abc")).toBeUndefined();
    expect(parseUniversalMeasureToPt("")).toBeUndefined();
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseUniversalMeasureToPt(" 72pt ")).toBe(ONE_INCH_IN_PT);
  });
});

describe("ptToUniversalMeasure", () => {
  it("formats as a centimetre-suffixed string to two decimal places", () => {
    expect(ptToUniversalMeasure(ONE_INCH_IN_PT)).toBe("2.54cm");
  });

  it("round-trips back through parseUniversalMeasureToPt within rounding tolerance", () => {
    const original = 300;
    const formatted = ptToUniversalMeasure(original);
    const parsed = parseUniversalMeasureToPt(formatted);
    expect(parsed).toBeCloseTo(original, 0);
  });
});

describe("paperSizeCodeToPageSize / pageSizeToPaperSizeCode", () => {
  it('maps ECMA-376 code "1" to Letter and "9" to A4', () => {
    expect(paperSizeCodeToPageSize("1")).toEqual(PAGE_SIZE_LETTER);
    expect(paperSizeCodeToPageSize("9")).toEqual(PAGE_SIZE_A4);
  });

  it('returns undefined for a code this module deliberately does not map (e.g. Legal = "5")', () => {
    expect(paperSizeCodeToPageSize("5")).toBeUndefined();
  });

  it("is a genuine round trip for both known page sizes", () => {
    expect(pageSizeToPaperSizeCode(PAGE_SIZE_LETTER)).toBe("1");
    expect(pageSizeToPaperSizeCode(PAGE_SIZE_A4)).toBe("9");
  });

  it("returns undefined for a page size that matches neither known constant", () => {
    expect(
      pageSizeToPaperSizeCode({ widthPt: 400, heightPt: 600 }),
    ).toBeUndefined();
  });

  it("tolerates a page size within half a point of a known constant (real-world floating-point drift)", () => {
    const WITHIN_TOLERANCE_DRIFT_PT = 0.1;
    expect(
      pageSizeToPaperSizeCode({
        widthPt: PAGE_SIZE_A4.widthPt + WITHIN_TOLERANCE_DRIFT_PT,
        heightPt: PAGE_SIZE_A4.heightPt - WITHIN_TOLERANCE_DRIFT_PT,
      }),
    ).toBe("9");
  });

  it("tolerates a difference of EXACTLY the half-point boundary, not just short of it", () => {
    expect(
      pageSizeToPaperSizeCode({
        widthPt: PAGE_SIZE_LETTER.widthPt + PAPER_SIZE_TOLERANCE_PT,
        heightPt: PAGE_SIZE_LETTER.heightPt,
      }),
    ).toBe("1");
  });

  it("rejects a page size matching Letter's width but not its height, proving both dimensions are checked", () => {
    expect(
      pageSizeToPaperSizeCode({
        widthPt: PAGE_SIZE_LETTER.widthPt,
        heightPt: PAGE_SIZE_LETTER.heightPt + OUTSIDE_TOLERANCE_PT,
      }),
    ).toBeUndefined();
  });

  it("rejects a page size matching Letter's height but not its width, proving both dimensions are checked", () => {
    expect(
      pageSizeToPaperSizeCode({
        widthPt: PAGE_SIZE_LETTER.widthPt + OUTSIDE_TOLERANCE_PT,
        heightPt: PAGE_SIZE_LETTER.heightPt,
      }),
    ).toBeUndefined();
  });

  it("rejects a page size matching A4's width but not its height, proving both dimensions are checked", () => {
    expect(
      pageSizeToPaperSizeCode({
        widthPt: PAGE_SIZE_A4.widthPt,
        heightPt: PAGE_SIZE_A4.heightPt + OUTSIDE_TOLERANCE_PT,
      }),
    ).toBeUndefined();
  });

  it("rejects a page size matching A4's height but not its width, proving both dimensions are checked", () => {
    expect(
      pageSizeToPaperSizeCode({
        widthPt: PAGE_SIZE_A4.widthPt + OUTSIDE_TOLERANCE_PT,
        heightPt: PAGE_SIZE_A4.heightPt,
      }),
    ).toBeUndefined();
  });
});
