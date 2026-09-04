import type { ContentBlock } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { buildTextBody, collectFontFamilies } from "./content-write";
import { ALIGN_CENTER, ALIGN_LEFT } from "./text/style";

const noFonts = (): never => {
  throw new Error("no font family expected in this test");
};

describe("buildTextBody", () => {
  it("joins several paragraphs' text with the carriage-return separator", () => {
    const blocks: ContentBlock[] = [
      { kind: "paragraph", runs: [{ text: "one" }] },
      { kind: "paragraph", runs: [{ text: "two" }] },
    ];
    expect(buildTextBody(blocks, noFonts).text).toBe("one\rtwo");
  });

  it("silently excludes a non-paragraph block from the text body", () => {
    const blocks: ContentBlock[] = [
      { kind: "paragraph", runs: [{ text: "kept" }] },
      { kind: "pageBreak" },
    ];
    expect(buildTextBody(blocks, noFonts).text).toBe("kept");
  });

  it("gives each paragraph a PFRun whose count covers its own text plus one terminator character", () => {
    const blocks: ContentBlock[] = [
      { kind: "paragraph", runs: [{ text: "abc" }] },
      { kind: "paragraph", runs: [{ text: "de" }] },
    ];
    const { style } = buildTextBody(blocks, noFonts);
    expect(style.paragraphRuns.map((run) => run.count)).toEqual([4, 3]);
  });

  it("sums every character run's count to exactly the text body's own character count", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [{ text: "bold", bold: true }, { text: "plain" }],
      },
      { kind: "paragraph", runs: [{ text: "next" }] },
    ];
    const { text, style } = buildTextBody(blocks, noFonts);
    const total = style.characterRuns.reduce((sum, run) => sum + run.count, 0);
    // +1 for the implicit trailing terminator character [MS-PPT]'s own worked example states every text body carries.
    expect(total).toBe(text.length + 1);
  });

  it("emits a single zero-property character run for a paragraph with no runs", () => {
    const blocks: ContentBlock[] = [{ kind: "paragraph", runs: [] }];
    const { style } = buildTextBody(blocks, noFonts);
    expect(style.characterRuns).toEqual([
      {
        count: 1,
        properties: {
          bold: undefined,
          italic: undefined,
          underline: undefined,
          shadow: undefined,
          emboss: undefined,
          fontRef: undefined,
          sizePt: undefined,
          color: undefined,
        },
      },
    ]);
  });

  it("maps alignment and list level onto the paragraph run's properties", () => {
    const blocks: ContentBlock[] = [
      { kind: "paragraph", runs: [{ text: "x" }], alignment: "center" },
      { kind: "paragraph", runs: [{ text: "y" }], list: { level: 3 } },
    ];
    const { style } = buildTextBody(blocks, noFonts);
    expect(style.paragraphRuns[0]?.properties).toEqual({
      indentLevel: 0,
      alignment: ALIGN_CENTER,
    });
    expect(style.paragraphRuns[1]?.properties).toEqual({
      indentLevel: 3,
      alignment: undefined,
    });
  });

  it("leaves alignment undefined for a paragraph that states none", () => {
    const blocks: ContentBlock[] = [
      { kind: "paragraph", runs: [{ text: "x" }] },
    ];
    expect(
      buildTextBody(blocks, noFonts).style.paragraphRuns[0]?.properties,
    ).toEqual({ indentLevel: 0, alignment: undefined });
  });

  it("resolves a run's fontFamily through the supplied index resolver", () => {
    const blocks: ContentBlock[] = [
      { kind: "paragraph", runs: [{ text: "x", fontFamily: "Arial" }] },
    ];
    const { style } = buildTextBody(blocks, (family) => {
      expect(family).toBe("Arial");
      return 4;
    });
    expect(style.characterRuns[0]?.properties.fontRef).toBe(4);
  });

  it("converts a colour's 0-1 float components to 0-255 integer bytes", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [
          { text: "x", color: { r: 0x33 / 255, g: 0x66 / 255, b: 0x99 / 255 } },
        ],
      },
    ];
    const { style } = buildTextBody(blocks, noFonts);
    expect(style.characterRuns[0]?.properties.color).toEqual({
      red: 0x33,
      green: 0x66,
      blue: 0x99,
    });
  });

  it("maps 'left' to the zero-valued alignment enumerant", () => {
    const blocks: ContentBlock[] = [
      { kind: "paragraph", runs: [{ text: "x" }], alignment: "left" },
    ];
    expect(
      buildTextBody(blocks, noFonts).style.paragraphRuns[0]?.properties
        .alignment,
    ).toBe(ALIGN_LEFT);
  });

  it("converts the schema's line-height multiplier into ParaSpacing's percentage form", () => {
    const blocks: ContentBlock[] = [
      { kind: "paragraph", runs: [{ text: "x" }], lineSpacing: 1.5 },
    ];
    expect(
      buildTextBody(blocks, noFonts).style.paragraphRuns[0]?.properties
        .lineSpacing,
    ).toBe(150);
  });

  it("converts spacingBeforePt/spacingAfterPt into ParaSpacing's negative absolute-master-units form", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [{ text: "x" }],
        spacingBeforePt: 10,
        spacingAfterPt: 5,
      },
    ];
    const { properties } = buildTextBody(blocks, noFonts).style
      .paragraphRuns[0] ?? { properties: undefined };
    expect(properties?.spaceBefore).toBe(-80);
    expect(properties?.spaceAfter).toBe(-40);
  });

  it("converts indentLeftPt/indentFirstLinePt into MarginOrIndent master units, including a hanging indent", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [{ text: "x" }],
        indentLeftPt: 36,
        indentFirstLinePt: -18,
      },
    ];
    const { properties } = buildTextBody(blocks, noFonts).style
      .paragraphRuns[0] ?? { properties: undefined };
    expect(properties?.leftMargin).toBe(288);
    expect(properties?.indent).toBe(-144);
  });

  it("leaves lineSpacing/spaceBefore/spaceAfter/leftMargin/indent undefined when a paragraph states none", () => {
    const blocks: ContentBlock[] = [
      { kind: "paragraph", runs: [{ text: "x" }] },
    ];
    const { properties } = buildTextBody(blocks, noFonts).style
      .paragraphRuns[0] ?? { properties: undefined };
    expect(properties?.lineSpacing).toBeUndefined();
    expect(properties?.spaceBefore).toBeUndefined();
    expect(properties?.spaceAfter).toBeUndefined();
    expect(properties?.leftMargin).toBeUndefined();
    expect(properties?.indent).toBeUndefined();
  });
});

describe("collectFontFamilies", () => {
  it("collects every distinct family in first-seen order across several block lists", () => {
    const first: ContentBlock[] = [
      { kind: "paragraph", runs: [{ text: "a", fontFamily: "Arial" }] },
    ];
    const second: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [
          { text: "b", fontFamily: "Verdana" },
          { text: "c", fontFamily: "Arial" },
        ],
      },
    ];
    expect(collectFontFamilies([first, second])).toEqual(["Arial", "Verdana"]);
  });

  it("returns an empty list when no run names a font", () => {
    const blocks: ContentBlock[] = [
      { kind: "paragraph", runs: [{ text: "x" }] },
    ];
    expect(collectFontFamilies([blocks])).toEqual([]);
  });
});
