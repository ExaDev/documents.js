import { describe, expect, it } from "vitest";
import { DocFormatError } from "../errors";
import { applySectionSprms } from "./sep";
import { buildPlcfSed, buildSepx, encodeSectionGrpprl } from "./sep-write";
import { readGrpprl } from "./sprm";

function roundTrip(section: Parameters<typeof encodeSectionGrpprl>[0]) {
  const bytes = encodeSectionGrpprl(section);
  return applySectionSprms(readGrpprl(new Uint8Array(bytes)), {});
}

const SECTION = {
  pageSize: { widthPt: 612, heightPt: 792 },
  margins: { leftPt: 72, rightPt: 72, topPt: 72, bottomPt: 72 },
};

describe("encodeSectionGrpprl", () => {
  it("round-trips a section's page size and every margin", () => {
    const result = roundTrip(SECTION);
    expect(result.pageWidthPt).toBe(612);
    expect(result.pageHeightPt).toBe(792);
    expect(result.marginLeftPt).toBe(72);
    expect(result.marginRightPt).toBe(72);
    expect(result.marginTopPt).toBe(72);
    expect(result.marginBottomPt).toBe(72);
  });

  it("accepts a page dimension at exactly the format's own minimum (144 twips = 7.2pt)", () => {
    const result = roundTrip({
      ...SECTION,
      pageSize: { widthPt: 7.2, heightPt: 7.2 },
    });
    expect(result.pageWidthPt).toBe(7.2);
  });

  it("rejects a page dimension one twip below the format's own minimum", () => {
    expect(() =>
      encodeSectionGrpprl({
        ...SECTION,
        pageSize: { widthPt: 7.15, heightPt: 792 },
      }),
    ).toThrow(DocFormatError);
    expect(() =>
      encodeSectionGrpprl({
        ...SECTION,
        pageSize: { widthPt: 7.15, heightPt: 792 },
      }),
    ).toThrow(/section pageSize\.widthPt is 143 twips/);
  });

  it("accepts a page dimension at exactly the format's own maximum (31680 twips = 1584pt)", () => {
    const result = roundTrip({
      ...SECTION,
      pageSize: { widthPt: 1584, heightPt: 1584 },
    });
    expect(result.pageHeightPt).toBe(1584);
  });

  it("rejects a page dimension past the format's own maximum", () => {
    expect(() =>
      encodeSectionGrpprl({
        ...SECTION,
        pageSize: { widthPt: 612, heightPt: 1584.1 },
      }),
    ).toThrow(/section pageSize\.heightPt is 31682 twips/);
  });

  it("accepts a left/right margin of exactly 0", () => {
    const result = roundTrip({
      ...SECTION,
      margins: { ...SECTION.margins, leftPt: 0, rightPt: 0 },
    });
    expect(result.marginLeftPt).toBe(0);
    expect(result.marginRightPt).toBe(0);
  });

  it("rejects a negative left/right margin", () => {
    expect(() =>
      encodeSectionGrpprl({
        ...SECTION,
        margins: { ...SECTION.margins, leftPt: -1 },
      }),
    ).toThrow(/section margins\.leftPt is -20 twips/);
  });

  it("rejects a right margin past the unsigned 2-byte operand's own maximum", () => {
    const tooLarge = (0xffff + 20) / 20;
    expect(() =>
      encodeSectionGrpprl({
        ...SECTION,
        margins: { ...SECTION.margins, rightPt: tooLarge },
      }),
    ).toThrow(DocFormatError);
  });

  it("accepts a top/bottom margin of exactly 0", () => {
    const result = roundTrip({
      ...SECTION,
      margins: { ...SECTION.margins, topPt: 0, bottomPt: 0 },
    });
    expect(result.marginTopPt).toBe(0);
    expect(result.marginBottomPt).toBe(0);
  });

  it("accepts a top/bottom margin at exactly the format's own 31665-twip maximum", () => {
    const maxPt = 31665 / 20;
    const result = roundTrip({
      ...SECTION,
      margins: { ...SECTION.margins, topPt: maxPt, bottomPt: maxPt },
    });
    expect(result.marginTopPt).toBeCloseTo(maxPt, 5);
  });

  it("rejects a top margin past the format's own 31665-twip maximum", () => {
    const tooLarge = 31666 / 20;
    expect(() =>
      encodeSectionGrpprl({
        ...SECTION,
        margins: { ...SECTION.margins, topPt: tooLarge },
      }),
    ).toThrow(/section margins\.topPt is 31666 twips/);
  });

  it("rejects a bottom margin past the format's own 31665-twip maximum, naming margins.bottomPt", () => {
    const tooLarge = 31666 / 20;
    expect(() =>
      encodeSectionGrpprl({
        ...SECTION,
        margins: { ...SECTION.margins, bottomPt: tooLarge },
      }),
    ).toThrow(/section margins\.bottomPt is 31666 twips/);
  });
});

describe("buildSepx", () => {
  it("prefixes the grpprl with its own 2-byte length", () => {
    const grpprl = [1, 2, 3];
    const sepx = buildSepx(grpprl);
    expect(sepx.length).toBe(5);
    expect(new DataView(sepx.buffer).getUint16(0, true)).toBe(3);
    expect(Array.from(sepx.subarray(2))).toEqual(grpprl);
  });
});

describe("buildPlcfSed", () => {
  it("rejects a mismatched number of start CPs and Sepx offsets", () => {
    expect(() => buildPlcfSed([0], 10, [0, 5])).toThrow(
      /buildPlcfSed was given 1 section start CPs but 2 Sepx offsets/,
    );
  });

  it("builds a single-section PlcfSed whose bytes read back through parsePlc-shaped fields correctly", () => {
    const bytes = buildPlcfSed([0], 100, [40]);
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0); // aCp[0].
    expect(view.getUint32(4, true)).toBe(100); // aCp[1] = ccpText.
    expect(view.getUint16(8, true)).toBe(0); // sed.fn.
    expect(view.getUint32(10, true)).toBe(40); // sed.fcSepx.
    expect(view.getUint16(14, true)).toBe(0); // sed.fnMpr.
    expect(view.getUint32(16, true)).toBe(0xffffffff); // sed.fcMpr.
    expect(bytes.length).toBe(20);
  });

  it("builds a multi-section PlcfSed with one Sed per section, each naming its own Sepx offset", () => {
    const bytes = buildPlcfSed([0, 50], 100, [10, 30]);
    const view = new DataView(bytes.buffer);
    // Three keys (12 bytes), then two 12-byte Seds.
    expect(bytes.length).toBe(12 + 24);
    expect(view.getUint32(0, true)).toBe(0);
    expect(view.getUint32(4, true)).toBe(50);
    expect(view.getUint32(8, true)).toBe(100);
    expect(view.getUint32(12 + 2, true)).toBe(10); // first Sed's fcSepx.
    expect(view.getUint32(12 + 12 + 2, true)).toBe(30); // second Sed's fcSepx.
  });
});
