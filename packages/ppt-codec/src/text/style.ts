import { PptFormatError } from "../errors";
import { type PptRecord } from "../record/tree";
import { RT_StyleTextPropAtom, RT_TextMasterStyleAtom } from "../record/types";

// StyleTextPropAtom: the paragraph-level and character-level formatting for one text body, expressed as two run arrays measured in characters rather than as properties attached to the text. A run's own length is what says where it ends, so the whole atom is only parseable against the character count of the text body it accompanies -- which is why every function here takes that count rather than deriving it. [MS-PPT] 2.9.x StyleTextPropAtom: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/a9a5fa71-238d-491e-acc7-fa1fffd5f100 [MS-PPT] TextPFRun: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/4e95a4f9-a9af-42b5-b81a-f8f991cb1418 [MS-PPT] TextCFRun: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/426f313a-a4f3-4ffb-a041-9a74ccf23f17 [MS-PPT] TextPFException: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/c15a13b3-db2c-4b50-a7e6-08045581a663 [MS-PPT] TextCFException: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/c75024a2-14cb-4d7d-9964-bdab2fcd9d93

// TextAlignmentEnum ([MS-PPT] 2.13.x): https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/5fe09a4e-204e-41dd-a1e6-83ea729e0f25
export const ALIGN_LEFT = 0x0000;
export const ALIGN_CENTER = 0x0001;
export const ALIGN_RIGHT = 0x0002;
export const ALIGN_JUSTIFY = 0x0003;
export const ALIGN_DISTRIBUTED = 0x0004;
export const ALIGN_THAI_DISTRIBUTED = 0x0005;
export const ALIGN_JUSTIFY_LOW = 0x0006;

// PFMasks bit positions, in the spec's own A-to-Z order. Each bit says whether its field is present in the TextPFException that follows -- never what the field's value is. Exported (rather than kept private to this module) because style-write.ts's writeTextPFException sets the identical bits when serialising a property back to bytes -- one definition read and written by both directions rather than a second copy that could drift from this one.
export const PF_HAS_BULLET = 1 << 0;
export const PF_BULLET_HAS_FONT = 1 << 1;
export const PF_BULLET_HAS_COLOR = 1 << 2;
export const PF_BULLET_HAS_SIZE = 1 << 3;
export const PF_BULLET_FONT = 1 << 4;
export const PF_BULLET_COLOR = 1 << 5;
export const PF_BULLET_SIZE = 1 << 6;
export const PF_BULLET_CHAR = 1 << 7;
export const PF_LEFT_MARGIN = 1 << 8;
export const PF_INDENT = 1 << 10;
export const PF_ALIGN = 1 << 11;
export const PF_LINE_SPACING = 1 << 12;
export const PF_SPACE_BEFORE = 1 << 13;
export const PF_SPACE_AFTER = 1 << 14;
export const PF_DEFAULT_TAB_SIZE = 1 << 15;
export const PF_FONT_ALIGN = 1 << 16;
export const PF_CHAR_WRAP = 1 << 17;
export const PF_WORD_WRAP = 1 << 18;
export const PF_OVERFLOW = 1 << 19;
export const PF_TAB_STOPS = 1 << 20;
export const PF_TEXT_DIRECTION = 1 << 21;

// CFMasks bit positions, in the spec's own A-to-Z order. fHasStyle occupies bits 10-13 and unused4 bits 14-15, which is why the typeface group starts at bit 16 rather than 14. Exported for the same reason the PFMasks bits above are: style-write.ts's writeTextCFException is the write-side mirror of readTextCFException and sets these identical bits.
export const CF_BOLD = 1 << 0;
export const CF_ITALIC = 1 << 1;
export const CF_UNDERLINE = 1 << 2;
export const CF_SHADOW = 1 << 4;
export const CF_FEHINT = 1 << 5;
export const CF_KUMI = 1 << 7;
export const CF_EMBOSS = 1 << 9;
export const CF_HAS_STYLE = 0xf << 10;
export const CF_TYPEFACE = 1 << 16;
export const CF_SIZE = 1 << 17;
export const CF_COLOR = 1 << 18;
export const CF_POSITION = 1 << 19;
export const CF_OLD_EA_TYPEFACE = 1 << 21;
export const CF_ANSI_TYPEFACE = 1 << 22;
export const CF_SYMBOL_TYPEFACE = 1 << 23;

// CFStyle value bits, which share the low ten positions of CFMasks by construction -- the mask says a property is stated, the style says what it is. Exported for the same reason the mask bits above are.
export const STYLE_BOLD = 1 << 0;
export const STYLE_ITALIC = 1 << 1;
export const STYLE_UNDERLINE = 1 << 2;
export const STYLE_SHADOW = 1 << 4;
export const STYLE_EMBOSS = 1 << 9;

// ColorIndexStruct.index ([MS-PPT] 2.12.2): 0x00-0x07 name one of the slide's own colour scheme slots (background, text, shadow, title text, fill, then Accent 1/2/3 -- see document/color-scheme.ts), 0xFE means the struct's own red/green/blue bytes are a literal colour, and 0xFF means the colour is genuinely unstated. Exported so style-write.ts's writeColorIndexStruct writes the identical sentinel readColorIndexStruct below checks for.
export const COLOR_INDEX_SRGB = 0xfe;
export const COLOR_INDEX_UNDEFINED = 0xff;
export const COLOR_SCHEME_SLOT_COUNT = 8;

export interface RgbColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

// A run's own colour reference, before any colour-scheme lookup: either a literal RGB triple, or an index into whichever colour scheme (the slide's own, or its master's, when the slide states none) ends up applying to that run. Modelling this as a union rather than collapsing a scheme reference straight to `undefined` is what makes scheme-colour resolution possible at all -- discarding the index at parse time, the way this module used to, would make the two cases ("no colour stated" and "a scheme colour that hasn't been resolved yet") indistinguishable.
export type RunColor =
  | { readonly kind: "rgb"; readonly rgb: RgbColor }
  | { readonly kind: "scheme"; readonly schemeIndex: number };

export interface ParagraphProperties {
  readonly indentLevel: number;
  readonly alignment: number | undefined;
  /** ParaSpacing ([MS-PPT]), raw and unconverted: 0-13200 is a percentage of line height (value/100 = percent), negative is the absolute value in master units. content.ts's own paraSpacingToLineSpacing/paraSpacingToPoints do the schema-facing conversion -- this module stays format-level, with no document-schema.js knowledge of its own. */
  readonly lineSpacing: number | undefined;
  readonly spaceBefore: number | undefined;
  readonly spaceAfter: number | undefined;
  /** MarginOrIndent ([MS-PPT]): a signed offset in master units, no percentage form -- leftMargin is the paragraph's own left margin, indent the first line's own offset relative to it (negative for a hanging/bullet indent), the identical relationship DrawingML's later marL/indent pair states for the same binary predecessor format. */
  readonly leftMargin: number | undefined;
  readonly indent: number | undefined;
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
  readonly color: RunColor | undefined;
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

function readColorIndexStruct(cursor: FieldCursor): RunColor | undefined {
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
  if (index === COLOR_INDEX_SRGB) {
    return { kind: "rgb", rgb: { red, green, blue } };
  }
  if (index === COLOR_INDEX_UNDEFINED) {
    return undefined;
  }
  if (index < COLOR_SCHEME_SLOT_COUNT) {
    return { kind: "scheme", schemeIndex: index };
  }
  throw new PptFormatError(
    `ColorIndexStruct index 0x${index.toString(16)} is none of a colour-scheme slot (0x00-0x07), the literal-colour sentinel (0x${COLOR_INDEX_SRGB.toString(16)}), or the undefined-colour sentinel (0x${COLOR_INDEX_UNDEFINED.toString(16)})`,
  );
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
  const lineSpacing =
    (masks & PF_LINE_SPACING) !== 0 ? cursor.i16() : undefined;
  const spaceBefore =
    (masks & PF_SPACE_BEFORE) !== 0 ? cursor.i16() : undefined;
  const spaceAfter = (masks & PF_SPACE_AFTER) !== 0 ? cursor.i16() : undefined;
  const leftMargin = (masks & PF_LEFT_MARGIN) !== 0 ? cursor.i16() : undefined;
  const indent = (masks & PF_INDENT) !== 0 ? cursor.i16() : undefined;
  if ((masks & PF_DEFAULT_TAB_SIZE) !== 0) {
    cursor.skip(2);
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
  return {
    indentLevel,
    alignment,
    lineSpacing,
    spaceBefore,
    spaceAfter,
    leftMargin,
    indent,
  };
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

// [MS-PPT] 2.9.35's own cap: "cLevels ... MUST be less than or equal to 0x0005."
const MASTER_STYLE_MAX_LEVELS = 5;
// [MS-PPT] 2.9.35: TextMasterStyleLevel's own optional `level` field is present "if the value of the TextMasterStyleAtom record that contains this TextMasterStyleLevel is 0x005, 0x006, 0x007, or 0x008" -- i.e. the containing atom's own recInstance (its TextTypeEnum) is at least CENTER_BODY. For TITLE/BODY/NOTES/OTHER, a level's own index within lstLvl1..lstLvl5 already states which outline level it is.
const MASTER_STYLE_TYPES_WITH_EXPLICIT_LEVEL = 0x005;

export interface MasterStyleLevel {
  readonly paragraph: ParagraphProperties;
  readonly character: CharacterProperties;
}

export interface MasterTextStyleAtom {
  // The TextTypeEnum member this atom's own formatting applies to -- the atom's own rh.recInstance, per [MS-PPT] 2.9.35.
  readonly textType: number;
  // Index 0 is the outermost outline level, matching lstLvl1; a shorter array than 5 means the remaining levels are not stated by this atom at all (see document/master.ts's own cascade, which walks this array from `min(indentLevel, levels.length - 1)` down to 0).
  readonly levels: readonly MasterStyleLevel[];
}

// TextMasterStyleAtom ([MS-PPT] 2.9.35): cLevels, then that many TextMasterStyleLevel entries -- each just a TextPFException/TextCFException pair (an optional `level` field first, for the four types that carry one), so this reuses readTextPFException/readTextCFException directly rather than re-deriving their byte layout. Read from either a MainMasterContainer (one recInstance-tagged atom per placeholder type the master carries) or the DocumentTextInfoContainer inside Environment (the single OTHER-typed document-wide default every type falls back to when its own master says nothing) -- both are the identical record shape, told apart only by where the caller found them.
export function readTextMasterStyleAtom(
  record: PptRecord,
): MasterTextStyleAtom {
  if (record.header.recType !== RT_TextMasterStyleAtom) {
    throw new PptFormatError(
      `expected RT_TextMasterStyleAtom (0x${RT_TextMasterStyleAtom.toString(16)}) at offset ${record.offset}, found record type 0x${record.header.recType.toString(16)}`,
    );
  }
  const textType = record.header.recInstance;
  const cursor = new FieldCursor(record.data, 0, "TextMasterStyleAtom");
  const cLevels = cursor.u16();
  if (cLevels > MASTER_STYLE_MAX_LEVELS) {
    throw new PptFormatError(
      `TextMasterStyleAtom at offset ${record.offset} declares cLevels ${cLevels}, more than the mandated maximum of ${MASTER_STYLE_MAX_LEVELS}`,
    );
  }
  const hasExplicitLevel = textType >= MASTER_STYLE_TYPES_WITH_EXPLICIT_LEVEL;
  const levels: MasterStyleLevel[] = [];
  for (let i = 0; i < cLevels; i += 1) {
    if (hasExplicitLevel) {
      // The level field's own value is redundant with this loop's own index for a well-formed file (both name the same outline level); it is consumed here purely to keep the cursor aligned for the pf/cf fields that follow, not read back out.
      cursor.u16();
    }
    const paragraph = readTextPFException(cursor, i);
    const character = readTextCFException(cursor);
    levels.push({ paragraph, character });
  }
  return { textType, levels };
}
