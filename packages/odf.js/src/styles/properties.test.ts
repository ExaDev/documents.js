import { describe, expect, it } from "vitest";
import { el, txt } from "../xml/fragment";
import { parseOdfLength as parseLength } from "../typed/shared/units";
import {
  formatPercentageMultiplier,
  formatPt,
  paragraphPropertiesToAttributes,
  parseParagraphProperties,
  parseStyleElementProperties,
  parseTextProperties,
  textPropertiesToAttributes,
  type StyleProperties,
} from "./properties";

// The style:style/style:text-properties/style:paragraph-properties fixtures below marked "real LibreOffice output" are copied verbatim (attribute-for-attribute) from content.xml produced by `soffice --headless --convert-to odt` (LibreOffice 26.2.5.2) against a hand-written HTML fixture exercising bold/italic/underline/strikethrough runs and left/center/right/justify paragraphs with custom spacing, indent, colour, font and size -- not retyped from memory. See registry.ts's own prefix-verification comment for the equivalent note on style:name prefixes.

describe("parseLength", () => {
  it("parses every ODF length unit into points", () => {
    expect(parseLength("12pt")).toBe(12);
    expect(parseLength("1in")).toBe(72);
    expect(parseLength("1pc")).toBe(12);
    expect(parseLength("100px")).toBe(75);
    expect(parseLength("2.54cm")).toBeCloseTo(72, 10);
    expect(parseLength("25.4mm")).toBeCloseTo(72, 10);
  });

  it("parses negative and fractional lengths", () => {
    expect(parseLength("-0.5pt")).toBe(-0.5);
    expect(parseLength(".5pt")).toBe(0.5);
  });

  it("returns undefined for a malformed or unitless length", () => {
    expect(parseLength("12")).toBeUndefined();
    expect(parseLength("12em")).toBeUndefined();
    expect(parseLength("auto")).toBeUndefined();
    expect(parseLength("")).toBeUndefined();
  });

  it("round-trips real LibreOffice cm-based margins to the same points formatPt would produce for the CSS source value", () => {
    // The fixture's CSS source was margin-top:12pt/margin-bottom:6pt/text-indent:18pt; LibreOffice re-expressed them in cm.
    expect(parseLength("0.423cm")).toBeCloseTo(12, 1);
    expect(parseLength("0.212cm")).toBeCloseTo(6, 1);
    expect(parseLength("0.635cm")).toBeCloseTo(18, 1);
  });
});

describe("formatPt / formatPercentageMultiplier", () => {
  it('formats a point value with a bare "pt" suffix', () => {
    expect(formatPt(12)).toBe("12pt");
    expect(formatPt(-4.5)).toBe("-4.5pt");
  });

  it("formats a line-spacing multiplier as a percentage", () => {
    expect(formatPercentageMultiplier(1.5)).toBe("150%");
    expect(formatPercentageMultiplier(1)).toBe("100%");
  });
});

describe("parseTextProperties", () => {
  it('parses fo:font-weight="bold" as bold: true (real LibreOffice output, style T1)', () => {
    const element = el("style:text-properties", { "fo:font-weight": "bold" });
    expect(parseTextProperties(element)).toEqual({
      properties: { bold: true },
      hasUnknown: false,
    });
  });

  it('parses fo:font-style="italic" as italic: true (real LibreOffice output, style T2)', () => {
    const element = el("style:text-properties", { "fo:font-style": "italic" });
    expect(parseTextProperties(element)).toEqual({
      properties: { italic: true },
      hasUnknown: false,
    });
  });

  it("parses the canonical three-attribute underline-on shape as underline: true (real LibreOffice output, style T3)", () => {
    const element = el("style:text-properties", {
      "style:text-underline-style": "solid",
      "style:text-underline-width": "auto",
      "style:text-underline-color": "font-color",
    });
    expect(parseTextProperties(element)).toEqual({
      properties: { underline: true },
      hasUnknown: false,
    });
  });

  it("parses the canonical two-attribute strike-through-on shape as strike: true (real LibreOffice output, style T4)", () => {
    const element = el("style:text-properties", {
      "style:text-line-through-style": "solid",
      "style:text-line-through-type": "single",
    });
    expect(parseTextProperties(element)).toEqual({
      properties: { strike: true },
      hasUnknown: false,
    });
  });

  it('parses fo:font-weight="normal"/fo:font-style="normal" as explicit false, not absent', () => {
    const element = el("style:text-properties", {
      "fo:font-weight": "normal",
      "fo:font-style": "normal",
    });
    expect(parseTextProperties(element)).toEqual({
      properties: { bold: false, italic: false },
      hasUnknown: false,
    });
  });

  it('parses style:text-underline-style="none" as underline: false, and the line-through equivalent as strike: false', () => {
    const element = el("style:text-properties", {
      "style:text-underline-style": "none",
      "style:text-line-through-style": "none",
    });
    expect(parseTextProperties(element)).toEqual({
      properties: { underline: false, strike: false },
      hasUnknown: false,
    });
  });

  it('parses fo:font-size="18pt" and fo:color="#ff0000" (real LibreOffice output, style P2)', () => {
    const element = el("style:text-properties", {
      "fo:color": "#ff0000",
      "style:font-name": "ignored-for-this-test",
      "fo:font-size": "18pt",
    });
    // style:font-name is deliberately not modelled (see the top-of-file note in properties.ts on fo:font-family vs style:font-name), so this real-world snippet also exercises hasUnknown.
    const result = parseTextProperties(element);
    expect(result.properties.color).toEqual({ r: 1, g: 0, b: 0 });
    expect(result.properties.sizePt).toBe(18);
    expect(result.hasUnknown).toBe(true);
  });

  it("parses fo:font-family and fo:color/fo:font-size cleanly with no unknown attributes when only modelled attributes are present", () => {
    const element = el("style:text-properties", {
      "fo:font-family": "Courier New",
      "fo:font-size": "18pt",
      "fo:color": "#ff0000",
    });
    expect(parseTextProperties(element)).toEqual({
      properties: {
        fontFamily: "Courier New",
        sizePt: 18,
        color: { r: 1, g: 0, b: 0 },
      },
      hasUnknown: false,
    });
  });

  it("flags hasUnknown for an attribute name it does not model at all", () => {
    const element = el("style:text-properties", {
      "fo:font-weight": "bold",
      "style:font-name-asian": "Songti SC",
    });
    const result = parseTextProperties(element);
    expect(result.properties.bold).toBe(true);
    expect(result.hasUnknown).toBe(true);
  });

  it("flags hasUnknown for a value it cannot interpret on an otherwise-recognised attribute (numeric font-weight)", () => {
    const element = el("style:text-properties", { "fo:font-weight": "700" });
    const result = parseTextProperties(element);
    expect(result.properties.bold).toBeUndefined();
    expect(result.hasUnknown).toBe(true);
  });

  it("flags hasUnknown for a non-canonical underline (custom colour), leaving underline unset rather than guessing", () => {
    const element = el("style:text-properties", {
      "style:text-underline-style": "solid",
      "style:text-underline-color": "#00ff00",
    });
    const result = parseTextProperties(element);
    expect(result.properties.underline).toBeUndefined();
    expect(result.hasUnknown).toBe(true);
  });

  it("returns an empty, non-unknown result for an element with no attributes at all", () => {
    const element = el("style:text-properties");
    expect(parseTextProperties(element)).toEqual({
      properties: {},
      hasUnknown: false,
    });
  });

  it("flags hasUnknown for an unparseable value on every other recognised text attribute individually: fo:font-style, strike, fo:font-size, fo:color", () => {
    expect(
      parseTextProperties(
        el("style:text-properties", { "fo:font-style": "oblique" }),
      ).hasUnknown,
    ).toBe(true);
    expect(
      parseTextProperties(
        el("style:text-properties", {
          "style:text-line-through-style": "dashed",
        }),
      ).hasUnknown,
    ).toBe(true);
    expect(
      parseTextProperties(
        el("style:text-properties", { "fo:font-size": "huge" }),
      ).hasUnknown,
    ).toBe(true);
    expect(
      parseTextProperties(el("style:text-properties", { "fo:color": "red" }))
        .hasUnknown,
    ).toBe(true);
  });
});

describe("parseParagraphProperties", () => {
  it("parses fo:text-align to the matching Alignment value for all four values (left/center/right/justify all real LibreOffice output, styles P1/P2/P3/P4)", () => {
    for (const value of ["left", "center", "right", "justify"] as const) {
      const element = el("style:paragraph-properties", {
        "fo:text-align": value,
      });
      expect(parseParagraphProperties(element)).toEqual({
        properties: { alignment: value },
        hasUnknown: false,
      });
    }
  });

  it('flags hasUnknown for fo:text-align="start" (bidi-aware value this Alignment model does not cover)', () => {
    const element = el("style:paragraph-properties", {
      "fo:text-align": "start",
    });
    const result = parseParagraphProperties(element);
    expect(result.properties.alignment).toBeUndefined();
    expect(result.hasUnknown).toBe(true);
  });

  it("parses fo:margin-top/fo:margin-bottom/fo:margin-left/fo:text-indent/fo:line-height cleanly when nothing else is present", () => {
    const element = el("style:paragraph-properties", {
      "fo:margin-top": "12pt",
      "fo:margin-bottom": "6pt",
      "fo:margin-left": "36pt",
      "fo:text-indent": "18pt",
      "fo:line-height": "150%",
    });
    expect(parseParagraphProperties(element)).toEqual({
      properties: {
        spacingBeforePt: 12,
        spacingAfterPt: 6,
        indentLeftPt: 36,
        indentFirstLinePt: 18,
        lineSpacing: 1.5,
      },
      hasUnknown: false,
    });
  });

  it("extracts what it can from a real LibreOffice paragraph-properties element (style P3) while flagging hasUnknown for its unmodelled siblings", () => {
    // Real attributes from style P3: fo:margin-left="1.27cm" fo:margin-right="0cm" fo:margin-top="0.423cm" fo:margin-bottom="0.212cm" style:contextual-spacing="false" fo:line-height="150%" fo:text-align="right" style:justify-single-word="false" fo:text-indent="0.635cm" style:auto-text-indent="false"
    const element = el("style:paragraph-properties", {
      "fo:margin-left": "1.27cm",
      "fo:margin-right": "0cm",
      "fo:margin-top": "0.423cm",
      "fo:margin-bottom": "0.212cm",
      "style:contextual-spacing": "false",
      "fo:line-height": "150%",
      "fo:text-align": "right",
      "style:justify-single-word": "false",
      "fo:text-indent": "0.635cm",
      "style:auto-text-indent": "false",
    });
    const result = parseParagraphProperties(element);
    expect(result.properties.alignment).toBe("right");
    expect(result.properties.lineSpacing).toBe(1.5);
    expect(result.properties.spacingBeforePt).toBeCloseTo(12, 1);
    expect(result.properties.spacingAfterPt).toBeCloseTo(6, 1);
    expect(result.properties.indentFirstLinePt).toBeCloseTo(18, 1);
    // fo:margin-right has no corresponding field in this model at all -- unmodelled, so hasUnknown regardless of the other three siblings.
    expect(result.hasUnknown).toBe(true);
  });

  it("flags hasUnknown for a malformed length value on each of fo:margin-top/fo:margin-bottom/fo:margin-left/fo:text-indent individually, leaving that field unset", () => {
    for (const attributeName of [
      "fo:margin-top",
      "fo:margin-bottom",
      "fo:margin-left",
      "fo:text-indent",
    ]) {
      const result = parseParagraphProperties(
        el("style:paragraph-properties", { [attributeName]: "not-a-length" }),
      );
      expect(result.hasUnknown).toBe(true);
      expect(result.properties).toEqual({});
    }
  });

  it('flags hasUnknown for a non-percentage fo:line-height (absolute length, or "normal")', () => {
    expect(
      parseParagraphProperties(
        el("style:paragraph-properties", { "fo:line-height": "12pt" }),
      ).hasUnknown,
    ).toBe(true);
    expect(
      parseParagraphProperties(
        el("style:paragraph-properties", { "fo:line-height": "normal" }),
      ).hasUnknown,
    ).toBe(true);
  });

  // fo:break-before/fo:break-after are enumerated by the OASIS ODF 1.2 schema to exactly auto/column/page/even-page/odd-page (OpenDocument v1.3 part 3, section 20.185). "page" is the page break the boolean model carries; "auto" is its explicit absence (the same normal/false split fo:font-weight takes). "column" is not a page break at all, and "even-page"/"odd-page" carry a parity the boolean cannot hold -- each of those three stays hasUnknown so the element quarantines as residue rather than silently losing its extra meaning.
  it('parses fo:break-before="page" to pageBreakBefore: true, and "auto" to false, cleanly', () => {
    expect(
      parseParagraphProperties(
        el("style:paragraph-properties", { "fo:break-before": "page" }),
      ),
    ).toEqual({ properties: { pageBreakBefore: true }, hasUnknown: false });
    expect(
      parseParagraphProperties(
        el("style:paragraph-properties", { "fo:break-before": "auto" }),
      ),
    ).toEqual({ properties: { pageBreakBefore: false }, hasUnknown: false });
  });

  it("parses fo:break-after to pageBreakAfter identically", () => {
    expect(
      parseParagraphProperties(
        el("style:paragraph-properties", { "fo:break-after": "page" }),
      ),
    ).toEqual({ properties: { pageBreakAfter: true }, hasUnknown: false });
    expect(
      parseParagraphProperties(
        el("style:paragraph-properties", { "fo:break-after": "auto" }),
      ),
    ).toEqual({ properties: { pageBreakAfter: false }, hasUnknown: false });
  });

  it("flags hasUnknown for fo:break-before values the boolean model cannot hold (column, even-page, odd-page)", () => {
    for (const value of ["column", "even-page", "odd-page"]) {
      const result = parseParagraphProperties(
        el("style:paragraph-properties", { "fo:break-before": value }),
      );
      expect(result.properties.pageBreakBefore).toBeUndefined();
      expect(result.hasUnknown).toBe(true);
    }
  });
});

describe("parseStyleElementProperties", () => {
  it("combines paragraph- and text-properties children into one bag", () => {
    const styleElement = el(
      "style:style",
      { "style:name": "X1", "style:family": "paragraph" },
      [
        el("style:paragraph-properties", { "fo:text-align": "center" }),
        el("style:text-properties", { "fo:font-weight": "bold" }),
      ],
    );
    expect(parseStyleElementProperties(styleElement)).toEqual({
      properties: { alignment: "center", bold: true },
      hasUnknown: false,
    });
  });

  it("flags hasUnknown for any property-bearing child it has no vocabulary for at all (style:table-properties)", () => {
    const styleElement = el(
      "style:style",
      { "style:name": "ta1", "style:family": "table" },
      [el("style:table-properties", { "style:width": "5cm" })],
    );
    const result = parseStyleElementProperties(styleElement);
    expect(result.properties).toEqual({});
    expect(result.hasUnknown).toBe(true);
  });

  it("flags hasUnknown for style:master-page-name even with otherwise fully-modelled properties (real LibreOffice output, style P1)", () => {
    // Real attributes: style:name="P1" style:family="paragraph" style:parent-style-name="Text_20_body" style:master-page-name="HTML", with paragraph-properties fo:text-align="left" (plus style:justify-single-word/fo:text-indent/style:auto-text-indent/style:page-number, themselves already unmodelled).
    const styleElement = el(
      "style:style",
      {
        "style:name": "P1",
        "style:family": "paragraph",
        "style:parent-style-name": "Text_20_body",
        "style:master-page-name": "HTML",
      },
      [el("style:paragraph-properties", { "fo:text-align": "left" })],
    );
    const result = parseStyleElementProperties(styleElement);
    expect(result.properties.alignment).toBe("left");
    expect(result.hasUnknown).toBe(true);
  });

  it("does not flag hasUnknown for style:display-name or style:class on the outer element (cosmetic, not behavioural)", () => {
    const styleElement = el(
      "style:style",
      {
        "style:name": "Horizontal_20_Line",
        "style:family": "paragraph",
        "style:display-name": "Horizontal Line",
        "style:class": "html",
      },
      [el("style:paragraph-properties", { "fo:text-align": "left" })],
    );
    expect(parseStyleElementProperties(styleElement).hasUnknown).toBe(false);
  });

  it("propagates a nested unknown attribute from a style:text-properties child up through hasUnknown", () => {
    const styleElement = el(
      "style:style",
      { "style:name": "T1", "style:family": "text" },
      [
        el("style:text-properties", {
          "fo:font-weight": "bold",
          "style:font-name-asian": "Songti SC",
        }),
      ],
    );
    const result = parseStyleElementProperties(styleElement);
    expect(result.properties.bold).toBe(true);
    expect(result.hasUnknown).toBe(true);
  });

  it("skips a non-element child (e.g. formatting whitespace between style:style elements) without affecting hasUnknown", () => {
    const styleElement = el(
      "style:style",
      { "style:name": "T1", "style:family": "text" },
      [txt("\n  "), el("style:text-properties", { "fo:font-weight": "bold" })],
    );
    expect(parseStyleElementProperties(styleElement)).toEqual({
      properties: { bold: true },
      hasUnknown: false,
    });
  });
});

describe("textPropertiesToAttributes / paragraphPropertiesToAttributes: properties -> attributes", () => {
  it("produces the exact real-world attribute names and values for every field", () => {
    const properties: StyleProperties = {
      bold: true,
      italic: false,
      underline: true,
      strike: false,
      fontFamily: "Courier New",
      sizePt: 18,
      color: { r: 1, g: 0, b: 0 },
    };
    expect(textPropertiesToAttributes(properties)).toEqual([
      { name: "fo:font-weight", value: "bold" },
      { name: "fo:font-style", value: "normal" },
      { name: "style:text-underline-style", value: "solid" },
      { name: "style:text-underline-width", value: "auto" },
      { name: "style:text-underline-color", value: "font-color" },
      { name: "style:text-line-through-style", value: "none" },
      { name: "fo:font-family", value: "Courier New" },
      { name: "fo:font-size", value: "18pt" },
      { name: "fo:color", value: "#ff0000" },
    ]);
  });

  it("produces the exact real-world paragraph attribute names and values for every field", () => {
    const properties: StyleProperties = {
      alignment: "right",
      spacingBeforePt: 12,
      spacingAfterPt: 6,
      lineSpacing: 1.5,
      indentLeftPt: 36,
      indentFirstLinePt: 18,
      pageBreakBefore: true,
      pageBreakAfter: false,
    };
    expect(paragraphPropertiesToAttributes(properties)).toEqual([
      { name: "fo:text-align", value: "right" },
      { name: "fo:margin-top", value: "12pt" },
      { name: "fo:margin-bottom", value: "6pt" },
      { name: "fo:line-height", value: "150%" },
      { name: "fo:margin-left", value: "36pt" },
      { name: "fo:text-indent", value: "18pt" },
      { name: "fo:break-before", value: "page" },
      { name: "fo:break-after", value: "auto" },
    ]);
  });

  it("emits nothing for an empty property bag", () => {
    expect(textPropertiesToAttributes({})).toEqual([]);
    expect(paragraphPropertiesToAttributes({})).toEqual([]);
  });

  it("emits the two-attribute strike-through-on shape for strike: true", () => {
    expect(textPropertiesToAttributes({ strike: true })).toEqual([
      { name: "style:text-line-through-style", value: "solid" },
      { name: "style:text-line-through-type", value: "single" },
    ]);
  });

  it("round-trips a fully-modelled property bag through build then parse unchanged", () => {
    const properties: StyleProperties = {
      bold: true,
      italic: true,
      underline: false,
      strike: false,
      fontFamily: "Liberation Sans",
      sizePt: 11,
      color: { r: 0.2, g: 0.4, b: 0.6 },
      alignment: "justify",
      spacingBeforePt: 10,
      spacingAfterPt: 5,
      lineSpacing: 2,
      indentLeftPt: -6,
      indentFirstLinePt: 24,
      pageBreakBefore: true,
      pageBreakAfter: true,
    };
    const textAttrs: Record<string, string> = {};
    for (const attribute of textPropertiesToAttributes(properties))
      textAttrs[attribute.name] = attribute.value;
    const paragraphAttrs: Record<string, string> = {};
    for (const attribute of paragraphPropertiesToAttributes(properties))
      paragraphAttrs[attribute.name] = attribute.value;

    const parsedText = parseTextProperties(
      el("style:text-properties", textAttrs),
    );
    const parsedParagraph = parseParagraphProperties(
      el("style:paragraph-properties", paragraphAttrs),
    );

    expect(parsedText.hasUnknown).toBe(false);
    expect(parsedParagraph.hasUnknown).toBe(false);
    expect({ ...parsedParagraph.properties, ...parsedText.properties }).toEqual(
      properties,
    );
  });
});
