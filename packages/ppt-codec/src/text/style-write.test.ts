import { describe, expect, it } from "vitest";
import { readRecordAt } from "../record/tree";
import {
  ALIGN_CENTER,
  type StyleTextProps,
  readStyleTextPropAtom,
} from "./style";
import { writeStyleTextPropAtom } from "./style-write";

// A direct round trip through this package's own reader: write a StyleTextPropAtom, read it back, and assert the recovered value equals the one written -- the same verification method write.test.ts uses at the whole-file level, applied here to the one record whose byte layout (masks, then fields in the spec's declared order rather than mask-bit order) is the most likely place a write/read mismatch would hide.

function roundTrip(
  style: StyleTextProps,
  characterCount: number,
): StyleTextProps {
  const bytes = writeStyleTextPropAtom(style);
  return readStyleTextPropAtom(readRecordAt(bytes, 0), characterCount);
}

// The spec's own termination rule (style.ts's readRuns: "The sum of the count fields ... MUST be equal to the number of characters") applies independently to BOTH run arrays -- a StyleTextPropAtom with paragraph runs covering the whole character count but no character runs at all is malformed, not merely incomplete. Tests that only care about the paragraph-run side still need a character run covering the same span.
function noCharacterProperties() {
  return {
    bold: undefined,
    italic: undefined,
    underline: undefined,
    shadow: undefined,
    emboss: undefined,
    fontRef: undefined,
    sizePt: undefined,
    color: undefined,
  };
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

describe("writeStyleTextPropAtom", () => {
  it("round-trips a paragraph run's alignment", () => {
    const style: StyleTextProps = {
      paragraphRuns: [{ count: 5, properties: pfProps(0, ALIGN_CENTER) }],
      characterRuns: [{ count: 5, properties: noCharacterProperties() }],
    };
    expect(roundTrip(style, 5).paragraphRuns).toEqual(style.paragraphRuns);
  });

  it("round-trips a paragraph run stating no alignment at all", () => {
    const style: StyleTextProps = {
      paragraphRuns: [{ count: 5, properties: pfProps(2, undefined) }],
      characterRuns: [{ count: 5, properties: noCharacterProperties() }],
    };
    expect(roundTrip(style, 5).paragraphRuns).toEqual(style.paragraphRuns);
  });

  it("round-trips several paragraph runs covering the whole character count", () => {
    const style: StyleTextProps = {
      paragraphRuns: [
        { count: 3, properties: pfProps(0, undefined) },
        { count: 4, properties: pfProps(1, undefined) },
      ],
      characterRuns: [{ count: 7, properties: noCharacterProperties() }],
    };
    expect(roundTrip(style, 7).paragraphRuns).toEqual(style.paragraphRuns);
  });

  it("round-trips a character run's bold/italic/underline flags", () => {
    const style: StyleTextProps = {
      paragraphRuns: [{ count: 4, properties: pfProps(0, undefined) }],
      characterRuns: [
        {
          count: 4,
          properties: {
            bold: true,
            italic: false,
            underline: true,
            shadow: undefined,
            emboss: undefined,
            fontRef: undefined,
            sizePt: undefined,
            color: undefined,
          },
        },
      ],
    };
    expect(roundTrip(style, 4).characterRuns).toEqual(style.characterRuns);
  });

  it("round-trips a character run stating no font-style flags at all", () => {
    const style: StyleTextProps = {
      paragraphRuns: [{ count: 3, properties: pfProps(0, undefined) }],
      characterRuns: [
        {
          count: 3,
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
      ],
    };
    expect(roundTrip(style, 3).characterRuns).toEqual(style.characterRuns);
  });

  it("round-trips a character run's font reference, size, and literal colour", () => {
    const style: StyleTextProps = {
      paragraphRuns: [{ count: 3, properties: pfProps(0, undefined) }],
      characterRuns: [
        {
          count: 3,
          properties: {
            bold: undefined,
            italic: undefined,
            underline: undefined,
            shadow: undefined,
            emboss: undefined,
            fontRef: 2,
            sizePt: 18,
            color: { red: 0x11, green: 0x22, blue: 0x33 },
          },
        },
      ],
    };
    expect(roundTrip(style, 3).characterRuns).toEqual(style.characterRuns);
  });

  it("round-trips several character runs covering the whole character count", () => {
    const style: StyleTextProps = {
      paragraphRuns: [{ count: 6, properties: pfProps(0, undefined) }],
      characterRuns: [
        {
          count: 3,
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
          count: 3,
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
    };
    expect(roundTrip(style, 6).characterRuns).toEqual(style.characterRuns);
  });
});
