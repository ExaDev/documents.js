import { describe, expect, it } from "vitest";
import { PptFormatError } from "../errors";
import { readRecordAt } from "../record/tree";
import { RT_StyleTextPropAtom } from "../record/types";
import {
  atom,
  concatBytes,
  i16le,
  u8,
  u16le,
  u32le,
} from "../test-support/records";
import { ALIGN_CENTER, ALIGN_RIGHT, readStyleTextPropAtom } from "./style";

// Mask bit positions written as raw shifts here, straight from the spec's own bit tables, rather than imported from the implementation: a test asserting against the constants the parser reads would pass even if both were wrong together. PFMasks ([MS-PPT] 2.9.x): https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/2a02831a-088b-44e7-84c9-c185ab314a71
const PF_LEFT_MARGIN = 1 << 8;
const PF_INDENT = 1 << 10;
const PF_ALIGN = 1 << 11;
const PF_LINE_SPACING = 1 << 12;
const PF_TAB_STOPS = 1 << 20;
// CFMasks ([MS-PPT] 2.9.x): https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/bbca8581-d011-4293-a375-b209523cf962
const CF_BOLD = 1 << 0;
const CF_ITALIC = 1 << 1;
const CF_UNDERLINE = 1 << 2;
const CF_TYPEFACE = 1 << 16;
const CF_SIZE = 1 << 17;
const CF_COLOR = 1 << 18;
const CF_ANSI_TYPEFACE = 1 << 22;
// CFStyle ([MS-PPT] 2.9.x), the value bits the CFMasks bits gate: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/3ea010b9-0ef9-4c05-9982-618130ca66cd
const STYLE_BOLD = 1 << 0;
const STYLE_ITALIC = 1 << 1;
const STYLE_UNDERLINE = 1 << 2;

function pfRun(
  count: number,
  indentLevel: number,
  masks: number,
  ...optionalFields: readonly Uint8Array<ArrayBuffer>[]
): Uint8Array<ArrayBuffer> {
  return concatBytes(
    u32le(count),
    u16le(indentLevel),
    u32le(masks),
    ...optionalFields,
  );
}

function cfRun(
  count: number,
  masks: number,
  ...optionalFields: readonly Uint8Array<ArrayBuffer>[]
): Uint8Array<ArrayBuffer> {
  return concatBytes(u32le(count), u32le(masks), ...optionalFields);
}

function styleTextPropAtom(
  pfRuns: readonly Uint8Array<ArrayBuffer>[],
  cfRuns: readonly Uint8Array<ArrayBuffer>[],
): Uint8Array<ArrayBuffer> {
  return atom(RT_StyleTextPropAtom, concatBytes(...pfRuns, ...cfRuns));
}

// ColorIndexStruct ([MS-PPT] 2.12.2): red, green, blue, then an index whose 0xFE means the three components are a literal sRGB value. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/5d6b0509-f3c7-435f-9bf4-6f1fc5f8293c
function colorIndex(
  red: number,
  green: number,
  blue: number,
  index: number,
): Uint8Array<ArrayBuffer> {
  return concatBytes(u8(red), u8(green), u8(blue), u8(index));
}

function read(
  bytes: Uint8Array<ArrayBuffer>,
  characterCount: number,
): ReturnType<typeof readStyleTextPropAtom> {
  return readStyleTextPropAtom(readRecordAt(bytes, 0), characterCount);
}

describe("readStyleTextPropAtom paragraph runs", () => {
  it("reads a run's character count and indent level", () => {
    const bytes = styleTextPropAtom([pfRun(6, 2, 0)], [cfRun(6, 0)]);
    expect(read(bytes, 6).paragraphRuns).toEqual([
      { count: 6, properties: { indentLevel: 2, alignment: undefined } },
    ]);
  });

  it("reads textAlignment only when masks.align is set", () => {
    const aligned = styleTextPropAtom(
      [pfRun(6, 0, PF_ALIGN, u16le(ALIGN_CENTER))],
      [cfRun(6, 0)],
    );
    expect(read(aligned, 6).paragraphRuns[0]?.properties.alignment).toBe(
      ALIGN_CENTER,
    );
    const unaligned = styleTextPropAtom([pfRun(6, 0, 0)], [cfRun(6, 0)]);
    expect(
      read(unaligned, 6).paragraphRuns[0]?.properties.alignment,
    ).toBeUndefined();
  });

  it("reads optional fields in the spec's declared field order, not its mask-bit order", () => {
    // masks.leftMargin (bit 8) and masks.indent (bit 10) precede masks.align (bit 11) as bits, and the fields appear in the opposite order on the wire: textAlignment is emitted before leftMargin and indent. Reading by mask-bit order would take leftMargin's bytes as the alignment.
    const bytes = styleTextPropAtom(
      [
        pfRun(
          6,
          0,
          PF_LEFT_MARGIN | PF_INDENT | PF_ALIGN,
          u16le(ALIGN_RIGHT),
          i16le(0x0100),
          i16le(0x0080),
        ),
      ],
      [cfRun(6, 0)],
    );
    expect(read(bytes, 6).paragraphRuns[0]?.properties.alignment).toBe(
      ALIGN_RIGHT,
    );
  });

  it("skips a variable-length tabStops field so the next run still starts in the right place", () => {
    // TabStops is a 2-byte count followed by count * 4 bytes, so a two-stop array occupies 10 bytes. Mis-sizing it would make the following run's count unreadable.
    const tabStops = concatBytes(
      u16le(2),
      u32le(0x00010002),
      u32le(0x00030004),
    );
    const bytes = styleTextPropAtom(
      [
        pfRun(3, 0, PF_TAB_STOPS | PF_LINE_SPACING, i16le(100), tabStops),
        pfRun(4, 1, 0),
      ],
      [cfRun(7, 0)],
    );
    expect(read(bytes, 7).paragraphRuns.map((r) => r.count)).toEqual([3, 4]);
  });

  it("stops once the runs account for every character, ignoring trailing bytes", () => {
    const bytes = styleTextPropAtom(
      [pfRun(4, 0, 0), pfRun(3, 1, 0)],
      [cfRun(7, 0)],
    );
    expect(read(bytes, 7).paragraphRuns).toHaveLength(2);
  });

  it("rejects runs whose counts overshoot the text's character count", () => {
    const bytes = styleTextPropAtom([pfRun(99, 0, 0)], [cfRun(7, 0)]);
    expect(() => read(bytes, 7)).toThrow(PptFormatError);
  });

  it("rejects a run truncated part way through its own fields", () => {
    const bytes = atom(RT_StyleTextPropAtom, concatBytes(u32le(6), u16le(0)));
    expect(() => read(bytes, 6)).toThrow(PptFormatError);
  });
});

describe("readStyleTextPropAtom character runs", () => {
  it("reads bold, italic and underline from fontStyle, gated by their own mask bits", () => {
    const bytes = styleTextPropAtom(
      [pfRun(6, 0, 0)],
      [
        cfRun(
          6,
          CF_BOLD | CF_ITALIC | CF_UNDERLINE,
          u16le(STYLE_BOLD | STYLE_UNDERLINE),
        ),
      ],
    );
    expect(read(bytes, 6).characterRuns[0]?.properties).toMatchObject({
      bold: true,
      italic: false,
      underline: true,
    });
  });

  it("leaves a property undefined when its mask bit is clear, even if the style bit is set", () => {
    // fontStyle exists because masks.bold is set; masks.italic is not, so the italic bit in fontStyle says nothing about this run and must not be read as false either.
    const bytes = styleTextPropAtom(
      [pfRun(6, 0, 0)],
      [cfRun(6, CF_BOLD, u16le(STYLE_BOLD | STYLE_ITALIC))],
    );
    const properties = read(bytes, 6).characterRuns[0]?.properties;
    expect(properties?.bold).toBe(true);
    expect(properties?.italic).toBeUndefined();
  });

  it("reads fontSize as a size in points", () => {
    const bytes = styleTextPropAtom(
      [pfRun(6, 0, 0)],
      [cfRun(6, CF_SIZE, i16le(28))],
    );
    expect(read(bytes, 6).characterRuns[0]?.properties.sizePt).toBe(28);
  });

  it("reads a ColorIndexStruct whose index is 0xFE as a literal sRGB colour", () => {
    const bytes = styleTextPropAtom(
      [pfRun(6, 0, 0)],
      [cfRun(6, CF_COLOR, colorIndex(0xff, 0x80, 0x00, 0xfe))],
    );
    expect(read(bytes, 6).characterRuns[0]?.properties.color).toEqual({
      red: 0xff,
      green: 0x80,
      blue: 0x00,
    });
  });

  it("leaves the colour undefined for a scheme-colour index, whose value lives in the colour scheme", () => {
    const bytes = styleTextPropAtom(
      [pfRun(6, 0, 0)],
      [cfRun(6, CF_COLOR, colorIndex(0x11, 0x22, 0x33, 0x01))],
    );
    expect(read(bytes, 6).characterRuns[0]?.properties.color).toBeUndefined();
  });

  it("reads fontRef, and the later ansiFontRef, in the spec's field order", () => {
    // fontRef (masks.typeface) precedes oldEAFontRef, ansiFontRef, symbolFontRef, fontSize, color and position on the wire. Skipping the absent oldEAFontRef is what keeps ansiFontRef aligned.
    const bytes = styleTextPropAtom(
      [pfRun(6, 0, 0)],
      [
        cfRun(
          6,
          CF_TYPEFACE | CF_ANSI_TYPEFACE | CF_SIZE,
          u16le(3),
          u16le(7),
          i16le(18),
        ),
      ],
    );
    expect(read(bytes, 6).characterRuns[0]?.properties).toMatchObject({
      fontRef: 3,
      sizePt: 18,
    });
  });

  it("partitions the text between several runs", () => {
    const bytes = styleTextPropAtom(
      [pfRun(22, 0, 0)],
      [
        cfRun(2, 0),
        cfRun(2, CF_BOLD, u16le(STYLE_BOLD)),
        cfRun(11, 0),
        cfRun(7, 0),
      ],
    );
    expect(read(bytes, 22).characterRuns.map((r) => r.count)).toEqual([
      2, 2, 11, 7,
    ]);
  });

  it("rejects character runs whose counts overshoot the text's character count", () => {
    const bytes = styleTextPropAtom([pfRun(6, 0, 0)], [cfRun(99, 0)]);
    expect(() => read(bytes, 6)).toThrow(PptFormatError);
  });
});
