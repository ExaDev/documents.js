import { describe, expect, it } from "vitest";
import { applyParagraphSprms, type ParagraphProperties } from "./pap";
import { decodeSprm, SGC, type Prl } from "./sprm";

function prl(value: number, operand: readonly number[]): Prl {
  return { sprm: decodeSprm(value), operand: new Uint8Array(operand) };
}

function int16(value: number): number[] {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setInt16(0, value, true);
  return Array.from(bytes);
}

function uint16(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}

describe("applyParagraphSprms", () => {
  it("resolves sprmPIstd", () => {
    expect(applyParagraphSprms([prl(0x4600, uint16(7))], {}).istd).toBe(7);
  });

  it("resolves the four base alignment values, through both sprmPJc80 and sprmPJc", () => {
    expect(applyParagraphSprms([prl(0x2403, [0])], {}).alignment).toBe("left");
    expect(applyParagraphSprms([prl(0x2403, [1])], {}).alignment).toBe(
      "center",
    );
    expect(applyParagraphSprms([prl(0x2403, [2])], {}).alignment).toBe("right");
    expect(applyParagraphSprms([prl(0x2461, [3])], {}).alignment).toBe(
      "justify",
    );
  });

  it("resolves every justify-family Jc value (3, 4, 5, 7, 8, 9) to 'justify'", () => {
    for (const value of [3, 4, 5, 7, 8, 9]) {
      expect(applyParagraphSprms([prl(0x2461, [value])], {}).alignment).toBe(
        "justify",
      );
    }
  });

  it("leaves alignment unset for Jc 6 (indented) and any value past the table", () => {
    expect(
      applyParagraphSprms([prl(0x2461, [6])], {}).alignment,
    ).toBeUndefined();
    expect(
      applyParagraphSprms([prl(0x2461, [200])], {}).alignment,
    ).toBeUndefined();
  });

  it("resolves sprmPFPageBreakBefore from a non-zero Bool8, and clears it for zero", () => {
    expect(applyParagraphSprms([prl(0x2407, [1])], {}).pageBreakBefore).toBe(
      true,
    );
    expect(applyParagraphSprms([prl(0x2407, [0])], {}).pageBreakBefore).toBe(
      false,
    );
  });

  it("resolves indentLeftPt through both the 80 and logical sprmPDxaLeft spellings", () => {
    expect(
      applyParagraphSprms([prl(0x840f, int16(720))], {}).indentLeftPt,
    ).toBe(36);
    expect(
      applyParagraphSprms([prl(0x845e, int16(720))], {}).indentLeftPt,
    ).toBe(36);
  });

  it("resolves indentRightPt through both the 80 and logical sprmPDxaRight spellings", () => {
    expect(
      applyParagraphSprms([prl(0x840e, int16(360))], {}).indentRightPt,
    ).toBe(18);
    expect(
      applyParagraphSprms([prl(0x845d, int16(360))], {}).indentRightPt,
    ).toBe(18);
  });

  it("resolves indentFirstLinePt through both the 80 and logical sprmPDxaLeft1 spellings", () => {
    expect(
      applyParagraphSprms([prl(0x8411, int16(-240))], {}).indentFirstLinePt,
    ).toBe(-12);
    expect(
      applyParagraphSprms([prl(0x8460, int16(-240))], {}).indentFirstLinePt,
    ).toBe(-12);
  });

  it("resolves spacingBeforePt and spacingAfterPt", () => {
    expect(
      applyParagraphSprms([prl(0xa413, uint16(200))], {}).spacingBeforePt,
    ).toBe(10);
    expect(
      applyParagraphSprms([prl(0xa414, uint16(100))], {}).spacingAfterPt,
    ).toBe(5);
  });

  it("resolves lineSpacing from an LSPD in multiplier form", () => {
    // dyaLine 360 (1.5 lines: 360/240) with fMultLinespace 1.
    const operand = [...int16(360), 1, 0];
    expect(applyParagraphSprms([prl(0x6412, operand)], {}).lineSpacing).toBe(
      1.5,
    );
  });

  it("leaves lineSpacing unset when fMultLinespace is not the multiplier form", () => {
    const operand = [...int16(360), 0, 0];
    expect(
      applyParagraphSprms([prl(0x6412, operand)], {}).lineSpacing,
    ).toBeUndefined();
  });

  it("leaves lineSpacing unset when dyaLine is negative or past the multiplier form's own maximum", () => {
    expect(
      applyParagraphSprms([prl(0x6412, [...int16(-1), 1, 0])], {}).lineSpacing,
    ).toBeUndefined();
    expect(
      applyParagraphSprms([prl(0x6412, [...int16(0x7bc1), 1, 0])], {})
        .lineSpacing,
    ).toBeUndefined();
  });

  it("accepts a dyaLine of exactly the multiplier form's own maximum", () => {
    expect(
      applyParagraphSprms([prl(0x6412, [...int16(0x7bc0), 1, 0])], {})
        .lineSpacing,
    ).toBe(0x7bc0 / 240);
  });

  it("leaves lineSpacing unset when dyaLine resolves to a non-positive multiple", () => {
    expect(
      applyParagraphSprms([prl(0x6412, [...int16(0), 1, 0])], {}).lineSpacing,
    ).toBeUndefined();
  });

  it("resolves sprmPOutLvl to a real outline level, and to undefined for the body-text sentinel (0x9)", () => {
    expect(applyParagraphSprms([prl(0x2640, [2])], {}).outlineLevel).toBe(2);
    expect(
      applyParagraphSprms([prl(0x2640, [0x9])], {}).outlineLevel,
    ).toBeUndefined();
  });

  it("resolves sprmPFInTable and sprmPFTtp from non-zero/zero Bool8s", () => {
    expect(applyParagraphSprms([prl(0x2416, [1])], {}).inTable).toBe(true);
    expect(applyParagraphSprms([prl(0x2416, [0])], {}).inTable).toBe(false);
    expect(applyParagraphSprms([prl(0x2417, [1])], {}).tableRowEnd).toBe(true);
    expect(applyParagraphSprms([prl(0x2417, [0])], {}).tableRowEnd).toBe(false);
  });

  it("resolves sprmPIlvl to a real list level, and to undefined for the skipped sentinel (0xC)", () => {
    expect(applyParagraphSprms([prl(0x260a, [3])], {}).listLevel).toBe(3);
    expect(
      applyParagraphSprms([prl(0x260a, [0xc])], {}).listLevel,
    ).toBeUndefined();
  });

  it("resolves sprmPIlfo to a real listId, and to undefined for either 'not in a list' sentinel", () => {
    expect(applyParagraphSprms([prl(0x460b, uint16(5))], {}).listId).toBe(5);
    expect(
      applyParagraphSprms([prl(0x460b, uint16(0x0000))], {}).listId,
    ).toBeUndefined();
    expect(
      applyParagraphSprms([prl(0x460b, uint16(0xf801))], {}).listId,
    ).toBeUndefined();
  });

  it("resolves sprmPItap's own table depth", () => {
    const operand = [2, 0, 0, 0];
    expect(applyParagraphSprms([prl(0x6649, operand)], {}).tableDepth).toBe(2);
  });

  it("resolves sprmPFInnerTableCell and sprmPFInnerTtp from non-zero/zero Bool8s", () => {
    expect(applyParagraphSprms([prl(0x244b, [1])], {}).innerTableCellMark).toBe(
      true,
    );
    expect(applyParagraphSprms([prl(0x244b, [0])], {}).innerTableCellMark).toBe(
      false,
    );
    expect(applyParagraphSprms([prl(0x244c, [1])], {}).innerTtpMark).toBe(true);
    expect(applyParagraphSprms([prl(0x244c, [0])], {}).innerTtpMark).toBe(
      false,
    );
  });

  it("ignores a character-family sprm even at a colliding opcode value", () => {
    const characterSprm: Prl = {
      sprm: { ...decodeSprm(0x4600), sgc: SGC.character },
      operand: new Uint8Array(uint16(7)),
    };
    expect(applyParagraphSprms([characterSprm], {}).istd).toBeUndefined();
  });

  it("ignores a character-family sprm that never reaches the paragraph switch at all", () => {
    const result = applyParagraphSprms([prl(0x0000, [0])], { istd: 4 });
    expect(result.istd).toBe(4);
  });

  it("falls through the switch's own default case for a paragraph-family sprm this reader does not convert", () => {
    // sgc bits 10-12 of 0x0400 decode to SGC.paragraph (1), but the full value matches none of the SPRM_P_* opcodes this reader handles -- the one way to actually reach the switch's default case rather than the sgc guard above it.
    const result = applyParagraphSprms([prl(0x0400, [0])], { istd: 4 });
    expect(result.istd).toBe(4);
  });

  it("applies the last Prl's value when the same property is set twice", () => {
    expect(
      applyParagraphSprms([prl(0x4600, uint16(1)), prl(0x4600, uint16(2))], {})
        .istd,
    ).toBe(2);
  });

  it("mutates and returns the same accumulator object it was given", () => {
    const into: ParagraphProperties = {};
    expect(applyParagraphSprms([prl(0x4600, uint16(1))], into)).toBe(into);
  });
});
