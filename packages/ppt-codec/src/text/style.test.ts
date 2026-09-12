import { describe, expect, it } from "vitest";
import { PptFormatError } from "../errors";
import { readRecordAt } from "../record/tree";
import { RT_StyleTextPropAtom, RT_TextMasterStyleAtom } from "../record/types";
import {
  concatBytes,
  i16le,
  u8,
  u16le,
  u32le,
  writeAtom as atom,
} from "../record/write";
import {
  TEXT_TYPE_BODY,
  TEXT_TYPE_CENTER_BODY,
  TEXT_TYPE_OTHER,
  TEXT_TYPE_TITLE,
} from "./atoms";
import {
  ALIGN_CENTER,
  ALIGN_RIGHT,
  readStyleTextPropAtom,
  readTextMasterStyleAtom,
} from "./style";

// Mask bit positions written as raw shifts here, straight from the spec's own bit tables, rather than imported from the implementation: a test asserting against the constants the parser reads would pass even if both were wrong together. PFMasks ([MS-PPT] 2.9.x): https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/2a02831a-088b-44e7-84c9-c185ab314a71
const PF_HAS_BULLET = 1 << 0;
const PF_BULLET_FONT = 1 << 4;
const PF_BULLET_COLOR = 1 << 5;
const PF_BULLET_SIZE = 1 << 6;
const PF_BULLET_CHAR = 1 << 7;
const PF_LEFT_MARGIN = 1 << 8;
const PF_INDENT = 1 << 10;
const PF_ALIGN = 1 << 11;
const PF_LINE_SPACING = 1 << 12;
const PF_DEFAULT_TAB_SIZE = 1 << 15;
const PF_FONT_ALIGN = 1 << 16;
const PF_CHAR_WRAP = 1 << 17;
const PF_TAB_STOPS = 1 << 20;
const PF_TEXT_DIRECTION = 1 << 21;
// CFMasks ([MS-PPT] 2.9.x): https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/bbca8581-d011-4293-a375-b209523cf962
const CF_BOLD = 1 << 0;
const CF_ITALIC = 1 << 1;
const CF_UNDERLINE = 1 << 2;
const CF_TYPEFACE = 1 << 16;
const CF_SIZE = 1 << 17;
const CF_COLOR = 1 << 18;
const CF_POSITION = 1 << 19;
const CF_OLD_EA_TYPEFACE = 1 << 21;
const CF_ANSI_TYPEFACE = 1 << 22;
const CF_SYMBOL_TYPEFACE = 1 << 23;
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

  it("skips every unprojected optional field in the spec's own order, leaving the cursor correctly positioned for the fields that follow", () => {
    // bulletFlags, bulletChar, bulletFont, bulletSize, bulletColor, [alignment], defaultTabSize, fontAlign, wrapFlags, textDirection -- none of these except alignment itself is projected into ParagraphProperties, so the only way to prove each skip() actually advanced the cursor is to check that alignment (and the following run) still decode correctly with every one of them present.
    const masks =
      PF_HAS_BULLET |
      PF_BULLET_CHAR |
      PF_BULLET_FONT |
      PF_BULLET_SIZE |
      PF_BULLET_COLOR |
      PF_ALIGN |
      PF_DEFAULT_TAB_SIZE |
      PF_FONT_ALIGN |
      PF_CHAR_WRAP |
      PF_TEXT_DIRECTION;
    const bytes = styleTextPropAtom(
      [
        pfRun(
          3,
          0,
          masks,
          u16le(0), // bulletFlags
          u16le(0), // bulletChar
          u16le(0), // bulletFont
          u16le(0), // bulletSize
          u32le(0), // bulletColor (4 bytes)
          u16le(ALIGN_RIGHT), // alignment -- the one value this test can observe
          u16le(0), // defaultTabSize
          u16le(0), // fontAlign
          u16le(0), // wrapFlags
          u16le(0), // textDirection
        ),
        pfRun(4, 1, 0),
      ],
      [cfRun(7, 0)],
    );
    const result = read(bytes, 7);
    expect(result.paragraphRuns[0]?.properties.alignment).toBe(ALIGN_RIGHT);
    // A misaligned cursor from any dropped skip would either throw or make this second run's own count/indentLevel unreadable.
    expect(result.paragraphRuns.map((r) => r.count)).toEqual([3, 4]);
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
    expect(() => read(bytes, 7)).toThrow(
      "StyleTextPropAtom paragraph runs cover 99 characters, more than the 7 in the corresponding text body",
    );
  });

  it("rejects a run truncated part way through its own fields", () => {
    const bytes = atom(RT_StyleTextPropAtom, concatBytes(u32le(6), u16le(0)));
    expect(() => read(bytes, 6)).toThrow(PptFormatError);
    expect(() => read(bytes, 6)).toThrow(
      "StyleTextPropAtom needs 4 more bytes at offset 6 but the atom holds only 6",
    );
  });

  it("rejects a record whose type is not RT_StyleTextPropAtom", () => {
    const bytes = atom(RT_TextMasterStyleAtom, new Uint8Array(0), {
      recInstance: TEXT_TYPE_BODY,
    });
    expect(() => read(bytes, 0)).toThrow(PptFormatError);
    expect(() => read(bytes, 0)).toThrow(
      `expected RT_StyleTextPropAtom (0x${RT_StyleTextPropAtom.toString(16)}), found record type 0x${RT_TextMasterStyleAtom.toString(16)}`,
    );
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
      kind: "rgb",
      rgb: { red: 0xff, green: 0x80, blue: 0x00 },
    });
  });

  it("reads a ColorIndexStruct whose index is 0x00-0x07 as a colour-scheme slot reference, not yet resolved to RGB", () => {
    const bytes = styleTextPropAtom(
      [pfRun(6, 0, 0)],
      [cfRun(6, CF_COLOR, colorIndex(0x11, 0x22, 0x33, 0x01))],
    );
    expect(read(bytes, 6).characterRuns[0]?.properties.color).toEqual({
      kind: "scheme",
      schemeIndex: 1,
    });
  });

  it("leaves the colour undefined for the 0xFF undefined-colour sentinel", () => {
    const bytes = styleTextPropAtom(
      [pfRun(6, 0, 0)],
      [cfRun(6, CF_COLOR, colorIndex(0x11, 0x22, 0x33, 0xff))],
    );
    expect(read(bytes, 6).characterRuns[0]?.properties.color).toBeUndefined();
  });

  it("rejects a ColorIndexStruct index outside the scheme-slot/literal/undefined range", () => {
    const bytes = styleTextPropAtom(
      [pfRun(6, 0, 0)],
      [cfRun(6, CF_COLOR, colorIndex(0x11, 0x22, 0x33, 0x2a))],
    );
    expect(() => read(bytes, 6)).toThrow(PptFormatError);
    expect(() => read(bytes, 6)).toThrow(
      "ColorIndexStruct index 0x2a is none of a colour-scheme slot (0x00-0x07), the literal-colour sentinel (0xfe), or the undefined-colour sentinel (0xff)",
    );
  });

  it("accepts scheme slot 0x07, the last valid index below the literal/undefined sentinels", () => {
    const bytes = styleTextPropAtom(
      [pfRun(6, 0, 0)],
      [cfRun(6, CF_COLOR, colorIndex(0x11, 0x22, 0x33, 0x07))],
    );
    expect(read(bytes, 6).characterRuns[0]?.properties.color).toEqual({
      kind: "scheme",
      schemeIndex: 0x07,
    });
  });

  it("rejects index 0x08, one past the last valid scheme slot", () => {
    const bytes = styleTextPropAtom(
      [pfRun(6, 0, 0)],
      [cfRun(6, CF_COLOR, colorIndex(0x11, 0x22, 0x33, 0x08))],
    );
    expect(() => read(bytes, 6)).toThrow(PptFormatError);
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

  it("skips oldEAFontRef, symbolFontRef and position, none of which are projected, without disturbing the fields around them", () => {
    // fontRef (typeface) then oldEAFontRef (skipped), symbolFontRef (skipped), fontSize, color, then position (skipped) -- the spec's own field order. Only fontRef and fontSize are observable here, so setting every skip-only bit at once and checking both still decode correctly is the only way to prove none of the three skips was dropped.
    const bytes = styleTextPropAtom(
      [pfRun(6, 0, 0)],
      [
        cfRun(
          6,
          CF_TYPEFACE |
            CF_OLD_EA_TYPEFACE |
            CF_SYMBOL_TYPEFACE |
            CF_SIZE |
            CF_POSITION,
          u16le(3), // fontRef
          u16le(0), // oldEAFontRef
          u16le(0), // symbolFontRef
          i16le(18), // fontSize
          u16le(0), // position
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

// A TextMasterStyleLevel's own pf/cf fields are the identical TextPFException/TextCFException byte layout a run's own PFRun/CFRun carry, minus the leading count field a run has and a level does not -- so these builders are pfRun/cfRun above with that one field dropped, not a second independently-derived layout.
function pfLevel(
  masks: number,
  ...optionalFields: readonly Uint8Array<ArrayBuffer>[]
): Uint8Array<ArrayBuffer> {
  return concatBytes(u32le(masks), ...optionalFields);
}

function cfLevel(
  masks: number,
  ...optionalFields: readonly Uint8Array<ArrayBuffer>[]
): Uint8Array<ArrayBuffer> {
  return concatBytes(u32le(masks), ...optionalFields);
}

function masterStyleAtom(
  textType: number,
  levels: readonly Uint8Array<ArrayBuffer>[],
  cLevels: number = levels.length,
): Uint8Array<ArrayBuffer> {
  return atom(RT_TextMasterStyleAtom, concatBytes(u16le(cLevels), ...levels), {
    recInstance: textType,
  });
}

describe("readTextMasterStyleAtom", () => {
  it("reads the atom's own textType from its recInstance", () => {
    const bytes = masterStyleAtom(TEXT_TYPE_TITLE, []);
    expect(readTextMasterStyleAtom(readRecordAt(bytes, 0)).textType).toBe(
      TEXT_TYPE_TITLE,
    );
  });

  it("reads cLevels 0 as no levels at all", () => {
    const bytes = masterStyleAtom(TEXT_TYPE_BODY, []);
    expect(readTextMasterStyleAtom(readRecordAt(bytes, 0)).levels).toEqual([]);
  });

  it("reads each level's own pf/cf pair, in position order", () => {
    const bytes = masterStyleAtom(TEXT_TYPE_BODY, [
      concatBytes(
        pfLevel(PF_ALIGN, u16le(ALIGN_CENTER)),
        cfLevel(CF_BOLD, u16le(STYLE_BOLD)),
      ),
      concatBytes(pfLevel(0), cfLevel(CF_ITALIC, u16le(STYLE_ITALIC))),
    ]);
    const { levels } = readTextMasterStyleAtom(readRecordAt(bytes, 0));
    expect(levels).toHaveLength(2);
    expect(levels[0]?.paragraph.alignment).toBe(ALIGN_CENTER);
    expect(levels[0]?.character.bold).toBe(true);
    expect(levels[1]?.paragraph.alignment).toBeUndefined();
    expect(levels[1]?.character.italic).toBe(true);
  });

  it("stamps each level's own paragraph.indentLevel from its position, for a type with no explicit level field", () => {
    const bytes = masterStyleAtom(TEXT_TYPE_TITLE, [
      concatBytes(pfLevel(0), cfLevel(0)),
      concatBytes(pfLevel(0), cfLevel(0)),
      concatBytes(pfLevel(0), cfLevel(0)),
    ]);
    const { levels } = readTextMasterStyleAtom(readRecordAt(bytes, 0));
    expect(levels.map((l) => l.paragraph.indentLevel)).toEqual([0, 1, 2]);
  });

  it("consumes an explicit level field for a type at or above CENTER_BODY, without letting it affect the level's own position-derived indentLevel", () => {
    // TEXT_TYPE_CENTER_BODY levels carry a real level field ([MS-PPT] 2.9.35's own explicit-level types) ahead of pf/cf; this fixture states a level field that disagrees with the level's own position (2 at position 0) specifically to prove the byte offset consumed is the explicit field, not that this reader trusts its value over the position.
    const bytes = masterStyleAtom(TEXT_TYPE_CENTER_BODY, [
      concatBytes(u16le(2), pfLevel(0), cfLevel(CF_BOLD, u16le(STYLE_BOLD))),
    ]);
    const { levels } = readTextMasterStyleAtom(readRecordAt(bytes, 0));
    expect(levels).toHaveLength(1);
    expect(levels[0]?.character.bold).toBe(true);
    expect(levels[0]?.paragraph.indentLevel).toBe(0);
  });

  it("rejects cLevels greater than the mandated maximum of 5", () => {
    const bytes = atom(RT_TextMasterStyleAtom, u16le(6), {
      recInstance: TEXT_TYPE_BODY,
    });
    expect(() => readTextMasterStyleAtom(readRecordAt(bytes, 0))).toThrow(
      PptFormatError,
    );
    expect(() => readTextMasterStyleAtom(readRecordAt(bytes, 0))).toThrow(
      "TextMasterStyleAtom at offset 0 declares cLevels 6, more than the mandated maximum of 5",
    );
  });

  it("accepts cLevels exactly at the mandated maximum of 5", () => {
    const bytes = masterStyleAtom(
      TEXT_TYPE_BODY,
      Array.from({ length: 5 }, () => concatBytes(pfLevel(0), cfLevel(0))),
    );
    expect(readTextMasterStyleAtom(readRecordAt(bytes, 0)).levels).toHaveLength(
      5,
    );
  });

  it("rejects a record that is not RT_TextMasterStyleAtom", () => {
    const bytes = styleTextPropAtom([], []);
    expect(() => readTextMasterStyleAtom(readRecordAt(bytes, 0))).toThrow(
      PptFormatError,
    );
    expect(() => readTextMasterStyleAtom(readRecordAt(bytes, 0))).toThrow(
      `expected RT_TextMasterStyleAtom (0x${RT_TextMasterStyleAtom.toString(16)}) at offset 0, found record type 0x${RT_StyleTextPropAtom.toString(16)}`,
    );
  });

  it("treats textType one below CENTER_BODY as having no explicit level field", () => {
    // TEXT_TYPE_OTHER (0x004) is one below MASTER_STYLE_TYPES_WITH_EXPLICIT_LEVEL (0x005) -- the boundary an off-by-one on the >= comparison would blur.
    const bytes = masterStyleAtom(TEXT_TYPE_OTHER, [
      concatBytes(pfLevel(0), cfLevel(CF_BOLD, u16le(STYLE_BOLD))),
    ]);
    const { levels } = readTextMasterStyleAtom(readRecordAt(bytes, 0));
    expect(levels[0]?.character.bold).toBe(true);
    expect(levels[0]?.paragraph.indentLevel).toBe(0);
  });
});
