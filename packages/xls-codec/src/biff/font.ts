import type { Color, ContentFont } from "document-schema.js";

import { RecordBuilder } from "./builder";
import { BlockCursor } from "./cursor";
import { RECORD_FONT } from "./record-types";
import { writeRecord } from "./record-writer";
import { BiffWriteError } from "./write-errors";
import type { RecordGroup } from "./substreams";
import { readShortXLUnicodeString } from "./strings";
import { resolveIcvColor } from "./xf-colors";

// The Font record ([MS-XLS] 2.4.122, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/291a910c-cb69-4799-875e-a201845d4fd1) -- one entry of the workbook's font table, indexed by an XF record's own ifnt field and therefore the font every cell referencing that XF renders through. Read here into exactly the fields ContentSheetCell.font can express, and written back from the identical shape, so the two directions cannot disagree on what a given byte of the record means -- the same one-module-per-layout discipline biff/print-setup.ts applies to the Setup record. What the record states that the schema has no member for (superscript/subscript script, outline/shadow/condense/extend effects, font family and character set) is read past and written as its spec-default value rather than half-modelled: a round trip of such a font keeps every property the shared model carries and loses exactly the ones it has no field for, the identical scope limit the border reader already applies to diagonal borders.

/** dyHeight's own unit: a twentieth of a point, the same twip the docx side of this family measures character heights in. */
const TWIPS_PER_POINT = 20;

/** grbit's fItalic bit ([MS-XLS] 2.4.122's own field layout: fItalic is the second bit). */
const FONT_FLAG_ITALIC = 0x0002;
/** grbit's fStrikeOut bit, three bits above fItalic in the same field. */
const FONT_FLAG_STRIKEOUT = 0x0008;
/** [MS-XLS] 2.4.122's own bls table names exactly two weights -- 400 normal and 700 bold -- but the field only MUST be "0, or greater than or equal to 100 and less than or equal to 1000", so a third-party file can carry an intermediate GDI weight. 700 is the threshold rather than an equality test so such a weight still resolves one way; this package's own writer always states one of the two named values. */
const FONT_WEIGHT_BOLD = 700;
const FONT_WEIGHT_NORMAL = 400;
/** uls's "no underline" value; 0x01 single, 0x02 double, and the two accounting styles all state underline=true, since ContentFont's underline is a boolean with no double spelling -- the same collapse the border reader applies to the dash-family BorderStyle tokens. */
const FONT_UNDERLINE_NONE = 0x00;
const FONT_UNDERLINE_SINGLE = 0x01;
/** icv's own "Automatic"/System Window Text special value ([MS-XLS] "IcvFont": the one value outside the 0x08-0x3F palette range a font colour may legally carry) -- the colour a font that states none of its own carries, and the one this package's writer emits for a ContentFont leaving color absent. Deliberately NOT resolved on read: "automatic" means "whatever the display settings say", a moving target with no fixed RGB triple, matching how the fill reader treats an Automatic icv as no colour at all. */
export const FONT_COLOR_AUTOMATIC = 0x7fff;

/**
 * The font-table entry a ContentFont resolves to, for every property it leaves absent or false: the Normal style's own value, Excel 97-2003's classic Arial 10pt with no flags and an Automatic colour. Entry 0 of every font table this package writes carries exactly these fields, so a cell whose ContentFont normalises back to them references font 0 and needs no entry of its own -- the write-side mirror of the read side diffing every cell font against entry 0.
 */
export const NORMAL_FONT_FIELDS: XfFontFields = {
  name: "Arial",
  heightTwips: 200,
  bold: false,
  italic: false,
  strikeout: false,
  underline: false,
  colorIcv: FONT_COLOR_AUTOMATIC,
};

/**
 * One Font record's own fields, in the record's own vocabulary. A cell-level font is derived from it by diffing against the workbook's own first font (contentFontOf below), never by reading the fields off as absolute: BIFF8 gives a cell no way to say "no font", only an index into the font table, so the table's entry 0 (the Normal style's font, [MS-XLS] 2.1.7.20.3's own FORMATTING production) is what "the format's default" concretely means for a given file.
 */
export interface XfFontFields {
  readonly name: string;
  readonly heightTwips: number;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly strikeout: boolean;
  readonly underline: boolean;
  readonly colorIcv: number;
}

/** Font ([MS-XLS] 2.4.122): dyHeight, grbit, icv, bls, sss, uls, bFamily, bCharSet, unused3, then the name as a ShortXLUnicodeString whose fHighByte MUST be 1 regardless of the name's own content. */
export function readFontRecord(record: RecordGroup): XfFontFields {
  const cursor = new BlockCursor(record.blocks);
  const heightTwips = cursor.u16();
  const flags = cursor.u16();
  const colorIcv = cursor.u16();
  const weight = cursor.u16();
  cursor.skip(2); // sss: superscript/subscript script, no ContentFont member
  const underline = cursor.u8();
  cursor.skip(3); // bFamily, bCharSet, unused3 -- classification metadata the schema does not model
  return {
    name: readShortXLUnicodeString(cursor),
    heightTwips,
    bold: weight >= FONT_WEIGHT_BOLD,
    italic: (flags & FONT_FLAG_ITALIC) !== 0,
    strikeout: (flags & FONT_FLAG_STRIKEOUT) !== 0,
    underline: underline !== FONT_UNDERLINE_NONE,
    colorIcv,
  };
}

/**
 * The cell-level font one font-table entry resolves to, as ContentSheetCell.font carries it: only the properties that DIFFER from the workbook's own first font, or undefined when the entry is that font outright -- the format's default, which the schema models as the field being absent rather than an explicitly restated copy of it.
 *
 * The diff is per property, since a real cell font usually differs from the default in one or two respects and agrees in the rest: a Courier-bold cell font against an Arial default yields { fontFamily: "Courier", bold: true } and says nothing about size, which the default already settles. A colour that differs from the default's but does not resolve to a fixed RGB (the Automatic sentinel, a chart/tooltip display colour) is left unstated for the same reason resolveIcvColor declines it everywhere else: there is no honest triple to write. The icv comparison is on the raw index rather than the resolved colour, so a cell font carrying the SAME index as the default states no colour even where that index resolves -- the file said "the same colour as the default", not a colour that happens to coincide.
 */
export function contentFontOf(
  font: XfFontFields,
  baseline: XfFontFields,
  resolveColor: (icv: number) => Color | undefined,
): ContentFont | undefined {
  const result: ContentFont = {};
  if (font.bold !== baseline.bold) {
    result.bold = font.bold;
  }
  if (font.italic !== baseline.italic) {
    result.italic = font.italic;
  }
  if (font.underline !== baseline.underline) {
    result.underline = font.underline;
  }
  if (font.strikeout !== baseline.strikeout) {
    result.strike = font.strikeout;
  }
  if (font.name !== baseline.name) {
    result.fontFamily = font.name;
  }
  if (font.heightTwips !== baseline.heightTwips) {
    result.sizePt = font.heightTwips / TWIPS_PER_POINT;
  }
  if (font.colorIcv !== baseline.colorIcv) {
    const color = resolveColor(font.colorIcv);
    if (color !== undefined) {
      result.color = color;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/** Resolves a font colour icv through the same Icv table machinery a fill or border colour already uses -- IcvFont ([MS-XLS] "IcvFont") is an Icv constrained to the palette range plus the Automatic sentinel, so the shared resolver covers it without a second copy. */
export function resolveFontColor(
  icv: number,
  palette: readonly Color[] | undefined,
): Color | undefined {
  return resolveIcvColor(icv, palette);
}

/** The write-side mirror of readFontRecord: the identical layout in the opposite direction, in the one place the read side already cites. dyHeight's own 20-8191 range and fontName's own 1-31 length are the record's stated MUSTs, so a ContentFont asking for something outside them is refused here rather than silently clipped into a spec-illegal byte sequence. */
export function writeFontRecord(fields: XfFontFields): Uint8Array<ArrayBuffer> {
  if (
    (fields.heightTwips < 20 || fields.heightTwips > 8191) &&
    fields.heightTwips !== 0
  ) {
    throw new BiffWriteError(
      `font height ${fields.heightTwips} twips is outside the 20-8191 range [MS-XLS] 2.4.122's own dyHeight field allows`,
    );
  }
  if (fields.name.length < 1 || fields.name.length > 31) {
    throw new BiffWriteError(
      `font name ${JSON.stringify(fields.name)} is ${fields.name.length} UTF-16 code units, outside the 1-31 fontName itself allows ([MS-XLS] 2.4.122: "String length MUST be greater than or equal to 1 and less than or equal to 31")`,
    );
  }
  const grbit =
    (fields.italic ? FONT_FLAG_ITALIC : 0) |
    (fields.strikeout ? FONT_FLAG_STRIKEOUT : 0);
  const data = new RecordBuilder()
    .u16(fields.heightTwips)
    .u16(grbit)
    .u16(fields.colorIcv)
    .u16(fields.bold ? FONT_WEIGHT_BOLD : FONT_WEIGHT_NORMAL)
    .u16(0) // sss: normal script, the only spelling a schema with no superscript/subscript font member can state
    .u8(fields.underline ? FONT_UNDERLINE_SINGLE : FONT_UNDERLINE_NONE)
    .u8(0) // bFamily: not applicable -- the name itself is what the schema carries, not its family classification
    .u8(0) // bCharSet: ANSI
    .u8(0) // unused3
    .bytes(fontNameBytes(fields.name))
    .build();
  return writeRecord(RECORD_FONT, data);
}

/** Forces the uncompressed (fHighByte=1) ShortXLUnicodeString encoding a font name MUST use ([MS-XLS] 2.4.122: "The fontName.fHighByte field MUST equal 1"), writing every character as a full 16-bit code unit -- unlike every other ShortXLUnicodeString this package writes. */
function fontNameBytes(name: string): Uint8Array<ArrayBuffer> {
  const builder = new RecordBuilder().u8(name.length).u8(0x01);
  for (let index = 0; index < name.length; index += 1) {
    builder.u16(name.charCodeAt(index));
  }
  return builder.build();
}

/**
 * The font-table entry a ContentSheetCell.font resolves to: every property it leaves absent or false takes the Normal font's own value, since the schema models an absent property as "the format's default" and entry 0 of the table is exactly that default. `icvOf` resolves a stated colour into the workbook's own colour plan, the identical resolution a fill or border colour already draws.
 */
export function xfFontFieldsOf(
  font: ContentFont | undefined,
  icvOf: (color: Color) => number,
): XfFontFields {
  if (font === undefined) {
    return NORMAL_FONT_FIELDS;
  }
  return {
    name: font.fontFamily ?? NORMAL_FONT_FIELDS.name,
    heightTwips:
      font.sizePt === undefined
        ? NORMAL_FONT_FIELDS.heightTwips
        : Math.round(font.sizePt * TWIPS_PER_POINT),
    bold: font.bold === true,
    italic: font.italic === true,
    strikeout: font.strike === true,
    underline: font.underline === true,
    colorIcv:
      font.color === undefined ? FONT_COLOR_AUTOMATIC : icvOf(font.color),
  };
}

/**
 * Whether a ContentSheetCell.font resolves to anything other than the Normal font's own fields -- the "does this font carry formatting at all" question every write-side pass shares (written-cells.ts's record predicate, write.ts's font-table and XF interning). Answered through the identical normalisation xfFontFieldsOf applies, so a font that merely restates a default value -- fontFamily "Arial" on a workbook whose default is Arial, or sizePt 10 -- counts as none, exactly as the read side's diff against font-table entry 0 already treats it.
 *
 * A stated colour always differs, because the Normal entry's own colour is the Automatic sentinel, which no palette resolution ever returns (a resolved icv is always a real table index), so the comparison needs no colour plan of its own.
 */
export function cellFontDiffersFromNormal(font: ContentFont): boolean {
  if (
    font.fontFamily !== undefined &&
    font.fontFamily !== NORMAL_FONT_FIELDS.name
  ) {
    return true;
  }
  if (
    font.sizePt !== undefined &&
    Math.round(font.sizePt * TWIPS_PER_POINT) !== NORMAL_FONT_FIELDS.heightTwips
  ) {
    return true;
  }
  if (
    font.bold === true ||
    font.italic === true ||
    font.underline === true ||
    font.strike === true
  ) {
    return true;
  }
  return font.color !== undefined;
}
