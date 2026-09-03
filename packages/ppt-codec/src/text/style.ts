import { PptFormatError } from "../errors";
import { type PptRecord } from "../record/tree";
import { RT_StyleTextPropAtom } from "../record/types";

// StyleTextPropAtom: the paragraph-level and character-level formatting for one text body, expressed as two run arrays measured in characters rather than as properties attached to the text. A run's own length is what says where it ends, so the whole atom is only parseable against the character count of the text body it accompanies -- which is why every function here takes that count rather than deriving it. [MS-PPT] 2.9.x StyleTextPropAtom: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/a9a5fa71-238d-491e-acc7-fa1fffd5f100 [MS-PPT] TextPFRun: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/4e95a4f9-a9af-42b5-b81a-f8f991cb1418 [MS-PPT] TextCFRun: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/426f313a-a4f3-4ffb-a041-9a74ccf23f17 [MS-PPT] TextPFException: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/c15a13b3-db2c-4b50-a7e6-08045581a663 [MS-PPT] TextCFException: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/c75024a2-14cb-4d7d-9964-bdab2fcd9d93

// TextAlignmentEnum ([MS-PPT] 2.13.x): https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/5fe09a4e-204e-41dd-a1e6-83ea729e0f25
export const ALIGN_LEFT = 0x0000;
export const ALIGN_CENTER = 0x0001;
export const ALIGN_RIGHT = 0x0002;
export const ALIGN_JUSTIFY = 0x0003;
export const ALIGN_DISTRIBUTED = 0x0004;
export const ALIGN_THAI_DISTRIBUTED = 0x0005;
export const ALIGN_JUSTIFY_LOW = 0x0006;

// PFMasks bit positions, in the spec's own A-to-Z order. Each bit says whether its field is present in the TextPFException that follows -- never what the field's value is.
const PF_HAS_BULLET = 1 << 0;
const PF_BULLET_HAS_FONT = 1 << 1;
const PF_BULLET_HAS_COLOR = 1 << 2;
const PF_BULLET_HAS_SIZE = 1 << 3;
const PF_BULLET_FONT = 1 << 4;
const PF_BULLET_COLOR = 1 << 5;
const PF_BULLET_SIZE = 1 << 6;
const PF_BULLET_CHAR = 1 << 7;
const PF_LEFT_MARGIN = 1 << 8;
const PF_INDENT = 1 << 10;
const PF_ALIGN = 1 << 11;
const PF_LINE_SPACING = 1 << 12;
const PF_SPACE_BEFORE = 1 << 13;
const PF_SPACE_AFTER = 1 << 14;
const PF_DEFAULT_TAB_SIZE = 1 << 15;
const PF_FONT_ALIGN = 1 << 16;
const PF_CHAR_WRAP = 1 << 17;
const PF_WORD_WRAP = 1 << 18;
const PF_OVERFLOW = 1 << 19;
const PF_TAB_STOPS = 1 << 20;
const PF_TEXT_DIRECTION = 1 << 21;

// CFMasks bit positions, in the spec's own A-to-Z order. fHasStyle occupies bits 10-13 and unused4 bits 14-15, which is why the typeface group starts at bit 16 rather than 14.
const CF_BOLD = 1 << 0;
const CF_ITALIC = 1 << 1;
const CF_UNDERLINE = 1 << 2;
const CF_SHADOW = 1 << 4;
const CF_FEHINT = 1 << 5;
const CF_KUMI = 1 << 7;
const CF_EMBOSS = 1 << 9;
const CF_HAS_STYLE = 0xf << 10;
const CF_TYPEFACE = 1 << 16;
const CF_SIZE = 1 << 17;
const CF_COLOR = 1 << 18;
const CF_POSITION = 1 << 19;
const CF_OLD_EA_TYPEFACE = 1 << 21;
const CF_ANSI_TYPEFACE = 1 << 22;
const CF_SYMBOL_TYPEFACE = 1 << 23;

// CFStyle value bits, which share the low ten positions of CFMasks by construction -- the mask says a property is stated, the style says what it is.
const STYLE_BOLD = 1 << 0;
const STYLE_ITALIC = 1 << 1;
const STYLE_UNDERLINE = 1 << 2;
const STYLE_SHADOW = 1 << 4;
const STYLE_EMBOSS = 1 << 9;

// ColorIndexStruct.index: the one value meaning the struct's red/green/blue bytes are a literal colour rather than a slot in the slide's colour scheme. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/5d6b0509-f3c7-435f-9bf4-6f1fc5f8293c
const COLOR_INDEX_SRGB = 0xfe;

export interface RgbColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

export interface ParagraphProperties {
  readonly indentLevel: number;
  readonly alignment: number | undefined;
}

export interface CharacterProperties {
  readonly bold: boolean | undefined;
  readonly italic: boolean | undefined;
  readonly underline: boolean | undefined;
  readonly shadow: boolean | undefined;
  readonly emboss: boolean | undefined;
  // A zero-based index into the document's FontCollectionContainer, not a typeface name: resolving it needs the Environment record, which this structure has no access to.
  readonly fontRef: number | undefined;
  readonly sizePt: number | undefined;
  // Present only when the colour is a literal sRGB value; a scheme-colour index resolves against the slide's own colour scheme, which this structure cannot see.
  readonly color: RgbColor | undefined;
}

export interface StyleRun<T> {
  readonly count: number;
  readonly properties: T;
}

export interface StyleTextProps {
  readonly paragraphRuns: readonly StyleRun<ParagraphProperties>[];
  readonly characterRuns: readonly StyleRun<CharacterProperties>[];
}

// A cursor over one record's data, so the two exception readers can consume optional fields in declaration order without each re-deriving its position.
class FieldCursor {
  private at: number;
  private readonly view: DataView;

  constructor(
    private readonly data: Uint8Array<ArrayBuffer>,
    start: number,
    private readonly describe: string,
  ) {
    this.at = start;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  get offset(): number {
    return this.at;
  }

  private require(size: number): number {
    if (this.at + size > this.data.length) {
      throw new PptFormatError(
        `${this.describe} needs ${size} more bytes at offset ${this.at} but the atom holds only ${this.data.length}`,
      );
    }
    const at = this.at;
    this.at += size;
    return at;
  }

  u16(): number {
    return this.view.getUint16(this.require(2), true);
  }

  i16(): number {
    return this.view.getInt16(this.require(2), true);
  }

  u32(): number {
    return this.view.getUint32(this.require(4), true);
  }

  bytes(size: number): Uint8Array<ArrayBuffer> {
    const at = this.require(size);
    return this.data.subarray(at, at + size);
  }

  skip(size: number): void {
    this.require(size);
  }
}

function readColorIndexStruct(cursor: FieldCursor): RgbColor | undefined {
  const bytes = cursor.bytes(4);
  const [red, green, blue, index] = bytes;
  if (
    red === undefined ||
    green === undefined ||
    blue === undefined ||
    index === undefined
  ) {
    throw new PptFormatError(
      "ColorIndexStruct read returned fewer than its four bytes",
    );
  }
  return index === COLOR_INDEX_SRGB ? { red, green, blue } : undefined;
}

// A TextPFException's optional fields, read strictly in the spec's declared field order. That order is not the mask-bit order -- bulletChar (bit 7) is emitted before bulletFontRef (bit 4), and textAlignment (bit 11) before leftMargin (bit 8) -- so iterating the mask bits in numeric order would misalign every field after the first divergence.
function readTextPFException(
  cursor: FieldCursor,
  indentLevel: number,
): ParagraphProperties {
  const masks = cursor.u32();
  if (
    (masks &
      (PF_HAS_BULLET |
        PF_BULLET_HAS_FONT |
        PF_BULLET_HAS_COLOR |
        PF_BULLET_HAS_SIZE)) !==
    0
  ) {
    cursor.skip(2); // bulletFlags
  }
  if ((masks & PF_BULLET_CHAR) !== 0) {
    cursor.skip(2);
  }
  if ((masks & PF_BULLET_FONT) !== 0) {
    cursor.skip(2);
  }
  if ((masks & PF_BULLET_SIZE) !== 0) {
    cursor.skip(2);
  }
  if ((masks & PF_BULLET_COLOR) !== 0) {
    cursor.skip(4);
  }
  const alignment = (masks & PF_ALIGN) !== 0 ? cursor.u16() : undefined;
  for (const mask of [
    PF_LINE_SPACING,
    PF_SPACE_BEFORE,
    PF_SPACE_AFTER,
    PF_LEFT_MARGIN,
    PF_INDENT,
    PF_DEFAULT_TAB_SIZE,
  ]) {
    if ((masks & mask) !== 0) {
      cursor.skip(2);
    }
  }
  if ((masks & PF_TAB_STOPS) !== 0) {
    // TabStops is a 2-byte count followed by count * 4 bytes ([MS-PPT] 2.9.x), the one variable-length field in the structure and so the only one whose mis-sizing desynchronises every following run.
    cursor.skip(cursor.u16() * 4);
  }
  if ((masks & PF_FONT_ALIGN) !== 0) {
    cursor.skip(2);
  }
  if ((masks & (PF_CHAR_WRAP | PF_WORD_WRAP | PF_OVERFLOW)) !== 0) {
    cursor.skip(2); // wrapFlags
  }
  if ((masks & PF_TEXT_DIRECTION) !== 0) {
    cursor.skip(2);
  }
  return { indentLevel, alignment };
}

// A mask bit gates whether its property is stated at all, and the corresponding CFStyle bit gives the value. A property whose mask bit is clear stays undefined rather than becoming false: the run simply says nothing about it, and the difference matters because an unstated property inherits from the master's text style rather than defaulting off.
function styleFlag(
  masks: number,
  maskBit: number,
  fontStyle: number | undefined,
  styleBit: number,
): boolean | undefined {
  if ((masks & maskBit) === 0 || fontStyle === undefined) {
    return undefined;
  }
  return (fontStyle & styleBit) !== 0;
}

function readTextCFException(cursor: FieldCursor): CharacterProperties {
  const masks = cursor.u32();
  const hasFontStyle =
    (masks &
      (CF_BOLD |
        CF_ITALIC |
        CF_UNDERLINE |
        CF_SHADOW |
        CF_FEHINT |
        CF_KUMI |
        CF_EMBOSS |
        CF_HAS_STYLE)) !==
    0;
  const fontStyle = hasFontStyle ? cursor.u16() : undefined;
  const fontRef = (masks & CF_TYPEFACE) !== 0 ? cursor.u16() : undefined;
  if ((masks & CF_OLD_EA_TYPEFACE) !== 0) {
    cursor.skip(2);
  }
  if ((masks & CF_ANSI_TYPEFACE) !== 0) {
    cursor.skip(2);
  }
  if ((masks & CF_SYMBOL_TYPEFACE) !== 0) {
    cursor.skip(2);
  }
  const sizePt = (masks & CF_SIZE) !== 0 ? cursor.i16() : undefined;
  const color =
    (masks & CF_COLOR) !== 0 ? readColorIndexStruct(cursor) : undefined;
  if ((masks & CF_POSITION) !== 0) {
    cursor.skip(2);
  }
  return {
    bold: styleFlag(masks, CF_BOLD, fontStyle, STYLE_BOLD),
    italic: styleFlag(masks, CF_ITALIC, fontStyle, STYLE_ITALIC),
    underline: styleFlag(masks, CF_UNDERLINE, fontStyle, STYLE_UNDERLINE),
    shadow: styleFlag(masks, CF_SHADOW, fontStyle, STYLE_SHADOW),
    emboss: styleFlag(masks, CF_EMBOSS, fontStyle, STYLE_EMBOSS),
    fontRef,
    sizePt,
    color,
  };
}

function readRuns<T>(
  cursor: FieldCursor,
  characterCount: number,
  describe: string,
  readProperties: (cursor: FieldCursor) => T,
): StyleRun<T>[] {
  const runs: StyleRun<T>[] = [];
  let covered = 0;
  // The spec's own termination rule: "The sum of the count fields ... MUST be equal to the number of characters in the corresponding text." There is no run count field, so the character total is the only thing that says where one array ends and the next begins.
  while (covered < characterCount) {
    const count = cursor.u32();
    const properties = readProperties(cursor);
    covered += count;
    if (covered > characterCount) {
      throw new PptFormatError(
        `${describe} cover ${covered} characters, more than the ${characterCount} in the corresponding text body`,
      );
    }
    runs.push({ count, properties });
  }
  return runs;
}

export function readStyleTextPropAtom(
  record: PptRecord,
  characterCount: number,
): StyleTextProps {
  if (record.header.recType !== RT_StyleTextPropAtom) {
    throw new PptFormatError(
      `expected RT_StyleTextPropAtom (0x${RT_StyleTextPropAtom.toString(16)}), found record type 0x${record.header.recType.toString(16)}`,
    );
  }
  const cursor = new FieldCursor(record.data, 0, "StyleTextPropAtom");
  const paragraphRuns = readRuns(
    cursor,
    characterCount,
    "StyleTextPropAtom paragraph runs",
    // A TextPFRun is count, then a 2-byte indentLevel, then the exception itself -- the indent level is the run's own field rather than one of the exception's masked ones, so it is read here before handing the cursor over.
    (at) => {
      const indentLevel = at.u16();
      return readTextPFException(at, indentLevel);
    },
  );
  const characterRuns = readRuns(
    cursor,
    characterCount,
    "StyleTextPropAtom character runs",
    readTextCFException,
  );
  return { paragraphRuns, characterRuns };
}
