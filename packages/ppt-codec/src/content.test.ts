import { describe, expect, it } from "vitest";
import { buildParagraphs } from "./content";
import {
  ALIGN_CENTER,
  ALIGN_DISTRIBUTED,
  ALIGN_JUSTIFY,
  type StyleTextProps,
} from "./text/style";

const NO_STYLE: StyleTextProps = { paragraphRuns: [], characterRuns: [] };

function styleOf(
  paragraphRuns: StyleTextProps["paragraphRuns"],
  characterRuns: StyleTextProps["characterRuns"],
): StyleTextProps {
  return { paragraphRuns, characterRuns };
}

function pfProps(indentLevel: number, alignment: number | undefined) {
  return {
    indentLevel,
    alignment,
    lineSpacing: undefined,
    spaceBefore: undefined,
    spaceAfter: undefined,
    leftMargin: undefined,
    indent: undefined,
  };
}

describe("buildParagraphs", () => {
  it("makes one paragraph per carriage-return-separated segment, each a single run when unstyled", () => {
    expect(buildParagraphs("one\rtwo", NO_STYLE, [])).toEqual([
      { kind: "paragraph", runs: [{ text: "one" }] },
      { kind: "paragraph", runs: [{ text: "two" }] },
    ]);
  });

  it("drops an empty paragraph's runs rather than emitting an empty-text run", () => {
    expect(buildParagraphs("", NO_STYLE, [])).toEqual([
      { kind: "paragraph", runs: [] },
    ]);
  });

  it("splits a paragraph into the character runs covering it", () => {
    const style = styleOf(
      [{ count: 12, properties: pfProps(0, undefined) }],
      [
        {
          count: 6,
          properties: {
            bold: true,
            italic: undefined,
            underline: undefined,
            shadow: undefined,
            emboss: undefined,
            fontRef: undefined,
            sizePt: undefined,
            color: undefined,
          },
        },
        {
          count: 6,
          properties: {
            bold: undefined,
            italic: true,
            underline: undefined,
            shadow: undefined,
            emboss: undefined,
            fontRef: undefined,
            sizePt: undefined,
            color: undefined,
          },
        },
      ],
    );
    expect(buildParagraphs("boldeditalic", style, [])[0]?.runs).toEqual([
      { text: "bolded", bold: true },
      { text: "italic", italic: true },
    ]);
  });

  it("keeps each paragraph's own slice of a run that spans a paragraph break", () => {
    // One character run covering the whole body, including the separator, must still produce a run per paragraph.
    const style = styleOf(
      [{ count: 8, properties: pfProps(0, undefined) }],
      [
        {
          count: 8,
          properties: {
            bold: true,
            italic: undefined,
            underline: undefined,
            shadow: undefined,
            emboss: undefined,
            fontRef: undefined,
            sizePt: undefined,
            color: undefined,
          },
        },
      ],
    );
    expect(buildParagraphs("abc\rdefg", style, []).map((p) => p.runs)).toEqual([
      [{ text: "abc", bold: true }],
      [{ text: "defg", bold: true }],
    ]);
  });

  it("takes each paragraph's alignment and indent level from the paragraph run covering it", () => {
    const style = styleOf(
      [
        {
          count: 4,
          properties: pfProps(0, ALIGN_CENTER),
        },
        {
          count: 4,
          properties: pfProps(2, ALIGN_JUSTIFY),
        },
      ],
      [],
    );
    const paragraphs = buildParagraphs("abc\rdef", style, []);
    expect(paragraphs[0]?.alignment).toBe("center");
    expect(paragraphs[0]?.list).toBeUndefined();
    expect(paragraphs[1]?.alignment).toBe("justify");
    expect(paragraphs[1]?.list).toEqual({ level: 2 });
  });

  it("leaves alignment undefined for a value the shared schema has no name for", () => {
    const style = styleOf(
      [
        {
          count: 4,
          properties: pfProps(0, ALIGN_DISTRIBUTED),
        },
      ],
      [],
    );
    expect(buildParagraphs("abc", style, [])[0]?.alignment).toBeUndefined();
  });

  it("converts a percentage-form ParaSpacing into the schema's line-height multiplier", () => {
    const style = styleOf(
      [
        {
          count: 3,
          properties: { ...pfProps(0, undefined), lineSpacing: 150 },
        },
      ],
      [],
    );
    expect(buildParagraphs("abc", style, [])[0]?.lineSpacing).toBe(1.5);
  });

  it("leaves lineSpacing undefined for an absolute-master-units ParaSpacing value", () => {
    const style = styleOf(
      [
        {
          count: 3,
          properties: { ...pfProps(0, undefined), lineSpacing: -160 },
        },
      ],
      [],
    );
    expect(buildParagraphs("abc", style, [])[0]?.lineSpacing).toBeUndefined();
  });

  it("converts an absolute-master-units ParaSpacing into spacingBeforePt/spacingAfterPt", () => {
    const style = styleOf(
      [
        {
          count: 3,
          properties: {
            ...pfProps(0, undefined),
            spaceBefore: -80,
            spaceAfter: -40,
          },
        },
      ],
      [],
    );
    const paragraph = buildParagraphs("abc", style, [])[0];
    expect(paragraph?.spacingBeforePt).toBe(10);
    expect(paragraph?.spacingAfterPt).toBe(5);
  });

  it("leaves spacingBeforePt/spacingAfterPt undefined for a percentage-form ParaSpacing value", () => {
    const style = styleOf(
      [
        {
          count: 3,
          properties: {
            ...pfProps(0, undefined),
            spaceBefore: 200,
            spaceAfter: 0,
          },
        },
      ],
      [],
    );
    const paragraph = buildParagraphs("abc", style, [])[0];
    expect(paragraph?.spacingBeforePt).toBeUndefined();
    expect(paragraph?.spacingAfterPt).toBeUndefined();
  });

  it("converts MarginOrIndent master units into indentLeftPt/indentFirstLinePt, including a hanging indent", () => {
    const style = styleOf(
      [
        {
          count: 3,
          properties: {
            ...pfProps(0, undefined),
            leftMargin: 288,
            indent: -144,
          },
        },
      ],
      [],
    );
    const paragraph = buildParagraphs("abc", style, [])[0];
    expect(paragraph?.indentLeftPt).toBe(36);
    expect(paragraph?.indentFirstLinePt).toBe(-18);
  });

  it("resolves a run's font reference against the document's font collection", () => {
    const style = styleOf(
      [{ count: 4, properties: pfProps(0, undefined) }],
      [
        {
          count: 4,
          properties: {
            bold: undefined,
            italic: undefined,
            underline: undefined,
            shadow: undefined,
            emboss: undefined,
            fontRef: 1,
            sizePt: 18,
            color: { red: 0x33, green: 0x66, blue: 0x99 },
          },
        },
      ],
    );
    expect(
      buildParagraphs("abc", style, ["Arial", "Verdana"])[0]?.runs,
    ).toEqual([
      {
        text: "abc",
        fontFamily: "Verdana",
        sizePt: 18,
        color: { r: 0x33 / 255, g: 0x66 / 255, b: 0x99 / 255 },
      },
    ]);
  });

  it("leaves the font family absent when the reference names no entry in the collection", () => {
    const style = styleOf(
      [{ count: 4, properties: pfProps(0, undefined) }],
      [
        {
          count: 4,
          properties: {
            bold: undefined,
            italic: undefined,
            underline: undefined,
            shadow: undefined,
            emboss: undefined,
            fontRef: 7,
            sizePt: undefined,
            color: undefined,
          },
        },
      ],
    );
    expect(buildParagraphs("abc", style, ["Arial"])[0]?.runs).toEqual([
      { text: "abc" },
    ]);
  });

  it("falls back to one unformatted run per paragraph when the runs do not reach it", () => {
    // A style atom covering only the first characters leaves later paragraphs with no run of their own; they still need their text.
    const style = styleOf(
      [{ count: 2, properties: pfProps(0, undefined) }],
      [
        {
          count: 2,
          properties: {
            bold: true,
            italic: undefined,
            underline: undefined,
            shadow: undefined,
            emboss: undefined,
            fontRef: undefined,
            sizePt: undefined,
            color: undefined,
          },
        },
      ],
    );
    expect(buildParagraphs("ab\rcd", style, [])[1]?.runs).toEqual([
      { text: "cd" },
    ]);
  });
});
