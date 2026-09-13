import { describe, expect, it } from "vitest";
import { buildParagraphs } from "./content";
import type { MasterStyleTable } from "./document/master";
import { TEXT_TYPE_BODY } from "./text/atoms";
import {
  ALIGN_CENTER,
  ALIGN_DISTRIBUTED,
  ALIGN_JUSTIFY,
  ALIGN_LEFT,
  ALIGN_RIGHT,
  type RgbColor,
  type StyleTextProps,
} from "./text/style";

const NO_STYLE: StyleTextProps = { paragraphRuns: [], characterRuns: [] };
// An empty table resolves nothing for any type/level -- these tests are about the paragraph/run-splitting logic buildParagraphs itself owns, not the master cascade (covered separately in document/master.test.ts and read.test.ts's own end-to-end fixture).
const NO_MASTER_STYLES: MasterStyleTable = { byType: new Map() };
const NO_COLOR_SCHEME: readonly RgbColor[] = [];
// Every CharacterProperties field left absent, for a test that only cares about overriding one or two of them.
const NO_RUN_FORMATTING = {
  bold: undefined,
  italic: undefined,
  underline: undefined,
  shadow: undefined,
  emboss: undefined,
  fontRef: undefined,
  sizePt: undefined,
  color: undefined,
};

function build(
  text: string,
  style: StyleTextProps,
  fontNames: readonly string[] = [],
) {
  return buildParagraphs(
    text,
    style,
    fontNames,
    NO_MASTER_STYLES,
    TEXT_TYPE_BODY,
    NO_COLOR_SCHEME,
  );
}

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
    expect(build("one\rtwo", NO_STYLE, [])).toEqual([
      { kind: "paragraph", runs: [{ text: "one" }] },
      { kind: "paragraph", runs: [{ text: "two" }] },
    ]);
  });

  it("drops an empty paragraph's runs rather than emitting an empty-text run", () => {
    expect(build("", NO_STYLE, [])).toEqual([{ kind: "paragraph", runs: [] }]);
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
    expect(build("boldeditalic", style, [])[0]?.runs).toEqual([
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
    expect(build("abc\rdefg", style, []).map((p) => p.runs)).toEqual([
      [{ text: "abc", bold: true }],
      [{ text: "defg", bold: true }],
    ]);
  });

  it("slices a non-first paragraph's own run at the run's real end, not past it", () => {
    // A second character run boundary landing inside a later paragraph: the first run's slice must stop at its own extent, not run on to the end of the paragraph's text -- a run of 9 chars into a 13-char paragraph must yield only its own 5 covered characters.
    const style = styleOf(
      [{ count: 17, properties: pfProps(0, undefined) }],
      [
        { count: 4, properties: { ...NO_RUN_FORMATTING } },
        { count: 5, properties: { ...NO_RUN_FORMATTING, bold: true } },
        { count: 8, properties: { ...NO_RUN_FORMATTING, italic: true } },
      ],
    );
    expect(build("abc\rdefghijklmnop", style, [])[1]?.runs).toEqual([
      { text: "defgh", bold: true },
      { text: "ijklmnop", italic: true },
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
    const paragraphs = build("abc\rdef", style, []);
    expect(paragraphs[0]?.alignment).toBe("center");
    expect(paragraphs[0]?.list).toBeUndefined();
    expect(paragraphs[1]?.alignment).toBe("justify");
    expect(paragraphs[1]?.list).toEqual({ level: 2 });
  });

  it.each([
    [ALIGN_LEFT, "left"],
    [ALIGN_RIGHT, "right"],
  ])("maps %i to the schema's %s alignment", (raw, expected) => {
    const style = styleOf([{ count: 3, properties: pfProps(0, raw) }], []);
    expect(build("abc", style, [])[0]?.alignment).toBe(expected);
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
    expect(build("abc", style, [])[0]?.alignment).toBeUndefined();
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
    expect(build("abc", style, [])[0]?.lineSpacing).toBe(1.5);
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
    expect(build("abc", style, [])[0]?.lineSpacing).toBeUndefined();
  });

  it("converts a ParaSpacing of exactly 0 -- the percentage form's own boundary -- to a line-height multiplier of 0, not undefined", () => {
    const style = styleOf(
      [
        {
          count: 3,
          properties: { ...pfProps(0, undefined), lineSpacing: 0 },
        },
      ],
      [],
    );
    expect(build("abc", style, [])[0]?.lineSpacing).toBe(0);
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
    const paragraph = build("abc", style, [])[0];
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
    const paragraph = build("abc", style, [])[0];
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
    const paragraph = build("abc", style, [])[0];
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
            color: { kind: "rgb", rgb: { red: 0x33, green: 0x66, blue: 0x99 } },
          },
        },
      ],
    );
    expect(build("abc", style, ["Arial", "Verdana"])[0]?.runs).toEqual([
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
    expect(build("abc", style, ["Arial"])[0]?.runs).toEqual([{ text: "abc" }]);
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
    expect(build("ab\rcd", style, [])[1]?.runs).toEqual([{ text: "cd" }]);
  });
});
