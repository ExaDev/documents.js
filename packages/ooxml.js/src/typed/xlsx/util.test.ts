import { describe, expect, it } from "vitest";
import { PAGE_SIZE_A4, PAGE_SIZE_LETTER } from "document-schema.js";
import {
  pageSizeToPaperSizeCode,
  paperSizeCodeToPageSize,
  parseUniversalMeasureToPt,
  ptToUniversalMeasure,
  readXmlBool,
  writeXmlBool,
} from "./util";

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
    expect(parseUniversalMeasureToPt("72pt")).toBe(72);
    expect(parseUniversalMeasureToPt("1in")).toBeCloseTo(72, 9);
    expect(parseUniversalMeasureToPt("2.54cm")).toBeCloseTo(72, 9);
    expect(parseUniversalMeasureToPt("25.4mm")).toBeCloseTo(72, 9);
    expect(parseUniversalMeasureToPt("6pc")).toBeCloseTo(72, 9);
    expect(parseUniversalMeasureToPt("6pi")).toBeCloseTo(72, 9);
  });

  it("rejects a malformed or unsupported-unit value", () => {
    expect(parseUniversalMeasureToPt("12furlongs")).toBeUndefined();
    expect(parseUniversalMeasureToPt("abc")).toBeUndefined();
    expect(parseUniversalMeasureToPt("")).toBeUndefined();
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseUniversalMeasureToPt(" 72pt ")).toBe(72);
  });
});

describe("ptToUniversalMeasure", () => {
  it("formats as a centimetre-suffixed string to two decimal places", () => {
    expect(ptToUniversalMeasure(72)).toBe("2.54cm");
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
    expect(
      pageSizeToPaperSizeCode({
        widthPt: PAGE_SIZE_A4.widthPt + 0.1,
        heightPt: PAGE_SIZE_A4.heightPt - 0.1,
      }),
    ).toBe("9");
  });
});
