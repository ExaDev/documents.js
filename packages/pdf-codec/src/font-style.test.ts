import { describe, expect, it } from "vitest";
import { styleFromBaseFontName } from "./font-style";

describe("styleFromBaseFontName", () => {
  it("strips a subset tag", () => {
    expect(styleFromBaseFontName("ABCDEF+Arial").baseFamily).toBe("Arial");
  });

  it("does not strip a subset-tag-shaped substring that isn't anchored at the very start of the name", () => {
    // The subset tag marker is only ever the name's own first six characters (ISO 32000-1 9.6.4); a "letters+" run appearing later in the name is just part of the family name and must survive untouched.
    expect(styleFromBaseFontName("Foo-ABCDEF+Bar").baseFamily).toBe(
      "Foo-ABCDEF+Bar",
    );
  });

  it("does not strip a shorter or longer run of uppercase letters before the '+' as if it were a six-letter subset tag", () => {
    expect(styleFromBaseFontName("A+Arial").baseFamily).toBe("A+Arial");
    expect(styleFromBaseFontName("ABCDEFG+Arial").baseFamily).toBe(
      "ABCDEFG+Arial",
    );
  });

  it("detects bold/italic from a hyphenated suffix and strips it from the family", () => {
    expect(styleFromBaseFontName("Arial-BoldItalic")).toEqual({
      baseFamily: "Arial",
      bold: true,
      italic: true,
    });
    expect(styleFromBaseFontName("Arial-Bold")).toEqual({
      baseFamily: "Arial",
      bold: true,
      italic: false,
    });
    expect(styleFromBaseFontName("Times-Italic")).toEqual({
      baseFamily: "Times",
      bold: false,
      italic: true,
    });
  });

  it("detects bold/italic from a comma-separated suffix", () => {
    expect(styleFromBaseFontName("Arial,BoldItalic")).toEqual({
      baseFamily: "Arial",
      bold: true,
      italic: true,
    });
    expect(styleFromBaseFontName("Times New Roman,Bold")).toEqual({
      baseFamily: "Times New Roman",
      bold: true,
      italic: false,
    });
  });

  it('treats "Oblique" as italic', () => {
    expect(styleFromBaseFontName("Helvetica-Oblique")).toEqual({
      baseFamily: "Helvetica",
      bold: false,
      italic: true,
    });
  });

  it('strips a hyphenated "BoldOblique" suffix from the family, distinctly from the shorter "Bold"/"Oblique" suffixes it contains', () => {
    expect(styleFromBaseFontName("Helvetica-BoldOblique")).toEqual({
      baseFamily: "Helvetica",
      bold: true,
      italic: true,
    });
  });

  it("leaves a plain regular name untouched", () => {
    expect(styleFromBaseFontName("Helvetica")).toEqual({
      baseFamily: "Helvetica",
      bold: false,
      italic: false,
    });
  });

  it("both strips a subset tag and detects a style suffix together", () => {
    expect(styleFromBaseFontName("XYZABC+Calibri-Bold")).toEqual({
      baseFamily: "Calibri",
      bold: true,
      italic: false,
    });
  });

  it("falls back to /FontDescriptor flags when the name gives no signal", () => {
    expect(
      styleFromBaseFontName("CustomFont", { forceBold: true }),
    ).toMatchObject({ bold: true });
    expect(
      styleFromBaseFontName("CustomFont", { italicFlag: true }),
    ).toMatchObject({ italic: true });
  });

  it("treats a nonzero /ItalicAngle as italic", () => {
    expect(
      styleFromBaseFontName("CustomFont", { italicAngle: -12 }),
    ).toMatchObject({ italic: true });
    expect(
      styleFromBaseFontName("CustomFont", { italicAngle: 0 }),
    ).toMatchObject({ italic: false });
  });

  it("strips a hyphenated or comma-separated style suffix regardless of its letter case", () => {
    expect(styleFromBaseFontName("Arial-bold").baseFamily).toBe("Arial");
    expect(styleFromBaseFontName("Arial,BOLD").baseFamily).toBe("Arial");
  });

  it("combines a name-based signal with flags rather than letting one override the other", () => {
    // The name alone says bold; flags alone say italic -- both should be honoured.
    expect(styleFromBaseFontName("Arial-Bold", { italicFlag: true })).toEqual({
      baseFamily: "Arial",
      bold: true,
      italic: true,
    });
  });
});
