import { describe, expect, it } from "vitest";
import { DocFormatError } from "../errors";
import { applyParagraphSprms } from "./pap";
import { encodeParagraphGrpprl } from "./pap-write";
import { readGrpprl } from "./sprm";

function roundTrip(paragraph: Parameters<typeof encodeParagraphGrpprl>[0]) {
  const bytes = encodeParagraphGrpprl(paragraph, () => 1);
  return applyParagraphSprms(readGrpprl(new Uint8Array(bytes)), {});
}

describe("encodeParagraphGrpprl", () => {
  it("returns an empty grpprl for a paragraph with no direct formatting at all", () => {
    expect(encodeParagraphGrpprl({}, () => 1)).toEqual([]);
  });

  it("round-trips every alignment value through the logical sprmPJc", () => {
    expect(roundTrip({ alignment: "left" }).alignment).toBe("left");
    expect(roundTrip({ alignment: "center" }).alignment).toBe("center");
    expect(roundTrip({ alignment: "right" }).alignment).toBe("right");
    expect(roundTrip({ alignment: "justify" }).alignment).toBe("justify");
  });

  it("round-trips indentLeftPt, including a negative value", () => {
    expect(roundTrip({ indentLeftPt: 36 }).indentLeftPt).toBe(36);
    expect(roundTrip({ indentLeftPt: -18 }).indentLeftPt).toBe(-18);
  });

  it("round-trips indentRightPt", () => {
    expect(roundTrip({ indentRightPt: 18 }).indentRightPt).toBe(18);
  });

  it("round-trips indentFirstLinePt", () => {
    expect(roundTrip({ indentFirstLinePt: -12 }).indentFirstLinePt).toBe(-12);
  });

  it("rejects an indent whose twips value overflows the signed 2-byte operand", () => {
    // 0x7FFF twips is the signed maximum; one point further overflows it.
    const maxPt = 0x7fff / 20;
    expect(() =>
      encodeParagraphGrpprl({ indentLeftPt: maxPt + 1 }, () => 1),
    ).toThrow(DocFormatError);
    expect(() =>
      encodeParagraphGrpprl({ indentLeftPt: maxPt + 1 }, () => 1),
    ).toThrow(/outside the -32768\.\.32767 range/);
  });

  it("accepts an indent at exactly the signed 2-byte operand's own bounds", () => {
    const maxPt = 0x7fff / 20;
    const minPt = -0x8000 / 20;
    expect(roundTrip({ indentLeftPt: maxPt }).indentLeftPt).toBeCloseTo(
      maxPt,
      5,
    );
    expect(roundTrip({ indentLeftPt: minPt }).indentLeftPt).toBeCloseTo(
      minPt,
      5,
    );
  });

  it("round-trips spacingBeforePt and spacingAfterPt", () => {
    expect(roundTrip({ spacingBeforePt: 10 }).spacingBeforePt).toBe(10);
    expect(roundTrip({ spacingAfterPt: 5 }).spacingAfterPt).toBe(5);
  });

  it("rejects a spacing value that would be negative in twips, past the unsigned operand's own lower bound", () => {
    expect(() =>
      encodeParagraphGrpprl({ spacingBeforePt: -1 }, () => 1),
    ).toThrow(DocFormatError);
    expect(() =>
      encodeParagraphGrpprl({ spacingBeforePt: -1 }, () => 1),
    ).toThrow(/outside the 0\.\.65535 range/);
  });

  it("rejects a spacing value past the unsigned 2-byte operand's own maximum", () => {
    const tooLarge = (0xffff + 20) / 20;
    expect(() =>
      encodeParagraphGrpprl({ spacingAfterPt: tooLarge }, () => 1),
    ).toThrow(DocFormatError);
  });

  it("accepts a spacing value at exactly the unsigned operand's own maximum", () => {
    const maxPt = 0xffff / 20;
    expect(roundTrip({ spacingAfterPt: maxPt }).spacingAfterPt).toBeCloseTo(
      maxPt,
      5,
    );
  });

  it("round-trips lineSpacing as an LSPD multiplier", () => {
    expect(roundTrip({ lineSpacing: 1.5 }).lineSpacing).toBe(1.5);
  });

  it("rejects a negative lineSpacing", () => {
    expect(() => encodeParagraphGrpprl({ lineSpacing: -1 }, () => 1)).toThrow(
      /outside the 0\.\.31680 range/,
    );
  });

  it("rejects a lineSpacing whose dyaLine exceeds the multiplier form's own maximum", () => {
    // 0x7BC0 / 240 = 82.005...; one further multiple overflows it.
    const tooLarge = 0x7bc0 / 240 + 1;
    expect(() =>
      encodeParagraphGrpprl({ lineSpacing: tooLarge }, () => 1),
    ).toThrow(DocFormatError);
  });

  it("accepts a lineSpacing of exactly 0", () => {
    expect(roundTrip({ lineSpacing: 0 }).lineSpacing).toBeUndefined(); // dyaLine 0 resolves to a non-positive multiple on read, matching pap.ts's own rule.
  });

  it("writes sprmPFPageBreakBefore only when the paragraph states it as literally true", () => {
    expect(roundTrip({ pageBreakBefore: true }).pageBreakBefore).toBe(true);
    expect(encodeParagraphGrpprl({ pageBreakBefore: false }, () => 1)).toEqual(
      [],
    );
  });

  it("round-trips list membership through the caller's own ilfo resolver", () => {
    const result = applyParagraphSprms(
      readGrpprl(
        new Uint8Array(
          encodeParagraphGrpprl({ list: { numId: "3", level: 2 } }, (numId) =>
            numId === "3" ? 7 : 0,
          ),
        ),
      ),
      {},
    );
    expect(result.listId).toBe(7);
    expect(result.listLevel).toBe(2);
  });

  it("writes no list sprm at all when the paragraph names a level but no numId", () => {
    expect(encodeParagraphGrpprl({ list: { level: 1 } }, () => 1)).toEqual([]);
  });

  it("accepts a list level at exactly the format's own 0..8 bound", () => {
    const result = applyParagraphSprms(
      readGrpprl(
        new Uint8Array(
          encodeParagraphGrpprl({ list: { numId: "1", level: 8 } }, () => 1),
        ),
      ),
      {},
    );
    expect(result.listLevel).toBe(8);
  });

  it("rejects a list level past the format's own 0..8 bound", () => {
    expect(() =>
      encodeParagraphGrpprl({ list: { numId: "1", level: 9 } }, () => 1),
    ).toThrow(DocFormatError);
    expect(() =>
      encodeParagraphGrpprl({ list: { numId: "1", level: 9 } }, () => 1),
    ).toThrow(/outside the 0\.\.8 range/);
  });

  it("writes every stated property together, in one grpprl", () => {
    const result = roundTrip({
      alignment: "center",
      indentLeftPt: 10,
      indentRightPt: 10,
      indentFirstLinePt: 5,
      spacingBeforePt: 6,
      spacingAfterPt: 6,
      lineSpacing: 1,
      pageBreakBefore: true,
    });
    expect(result).toMatchObject({
      alignment: "center",
      indentLeftPt: 10,
      indentRightPt: 10,
      indentFirstLinePt: 5,
      spacingBeforePt: 6,
      spacingAfterPt: 6,
      lineSpacing: 1,
      pageBreakBefore: true,
    });
  });
});
