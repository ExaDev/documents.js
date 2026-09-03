import { RecordBuilder } from "./builder";
import {
  RECORD_FONT,
  RECORD_FORMAT,
  RECORD_STYLE,
  RECORD_XF,
} from "./record-types";
import { writeRecord } from "./record-writer";
import { writeXLUnicodeString } from "./string-writer";
import { BiffWriteError } from "./write-errors";

// The formatting record family this writer emits: Font ([MS-XLS] 2.4.122), Format ([MS-XLS] 2.4.126), XF ([MS-XLS] 2.4.353) with its trailing CellXF ([MS-XLS] 2.4.353's own "Data" field, fStyle=0) or StyleXF (fStyle=1) payload, and Style ([MS-XLS] 2.4.269).
//
// Cell decoration -- fill, borders, alignment -- is not modelled from document-schema.js's own ContentSheetCell fields: this writer's own reader does not read a cell's CellXF payload back (see xls-codec's README, "Cell decoration" under read-side gaps), so writing real values here would be unverifiable by round trip and is out of scope, matching the read side's own documented boundary. Every CellXF/StyleXF field below is instead a spec-legal, decoration-free default -- general alignment, bottom vertical alignment, no border, no fill -- which a real Excel file with a genuinely undecorated cell also carries. The two "Automatic" colour index constants below (icvFore/icvBack) are the ones a real Excel-written undecorated XF uses for a fill it does not apply.

/** IcvXF's two "Automatic" special values ([MS-XLS] 2.5.161-adjacent colour-index convention): the foreground/background pair a real Excel file writes on an XF with no explicit fill. */
const ICV_AUTOMATIC_FOREGROUND = 0x40;
const ICV_AUTOMATIC_BACKGROUND = 0x41;

/** VertAlign ([MS-XLS] 2.5.339-adjacent enumeration): bottom vertical alignment, the default this package's own schema documents for an absent `verticalAlignment`. */
const VERT_ALIGN_BOTTOM = 0x02;

/** Packs the shared "no decoration" alignment/trot/indent word every CellXF and StyleXF opens with: alc=General(0), fWrap=0, alcV=Bottom(2), fJustLast=0, trot=0, cIndent=0, fShrinkToFit=0, reserved1=0, iReadOrder=0 (context-dependent default). Returns the low 24 bits (alc..iReadOrder); the caller ORs in whatever the next 8 bits mean for its own shape (CellXF's fAtr* flags, or StyleXF's all-zero unused byte). */
function packAlignmentPrefix(): number {
  const alc = 0;
  const fWrap = 0;

  const fJustLast = 0;
  const trot = 0;
  const cIndent = 0;
  const fShrinkToFit = 0;
  const reserved1 = 0;
  const iReadOrder = 0;
  return (
    (alc & 0x7) |
    ((fWrap & 0x1) << 3) |
    ((VERT_ALIGN_BOTTOM & 0x7) << 4) |
    ((fJustLast & 0x1) << 7) |
    ((trot & 0xff) << 8) |
    ((cIndent & 0xf) << 16) |
    ((fShrinkToFit & 0x1) << 20) |
    ((reserved1 & 0x1) << 21) |
    ((iReadOrder & 0x3) << 22)
  );
}

/** Packs the shared "no border" word: dgLeft/dgRight/dgTop/dgBottom = 0 (BorderStyle none), icvLeft/icvRight = 0 (unspecified, legal only alongside dg*=0), grbitDiag = 0 (no diagonal border). Identical bit layout in CellXF and StyleXF. */
function packBorderWord(): number {
  const dgLeft = 0;
  const dgRight = 0;
  const dgTop = 0;
  const dgBottom = 0;
  const icvLeft = 0;
  const icvRight = 0;
  const grbitDiag = 0;
  return (
    (dgLeft & 0xf) |
    ((dgRight & 0xf) << 4) |
    ((dgTop & 0xf) << 8) |
    ((dgBottom & 0xf) << 12) |
    ((icvLeft & 0x7f) << 16) |
    ((icvRight & 0x7f) << 23) |
    ((grbitDiag & 0x3) << 30)
  );
}

/** Packs the shared "no diagonal, no fill pattern" word: icvTop/icvBottom/icvDiag = 0, dgDiag = 0 (no diagonal border), the shape-specific bit (fHasXFExt for CellXF, reserved2 for StyleXF) = 0, fls = 0 (no fill pattern). */
function packFillPatternWord(): number {
  const icvTop = 0;
  const icvBottom = 0;
  const icvDiag = 0;
  const dgDiag = 0;
  const shapeSpecificBit = 0;
  const fls = 0;
  return (
    (icvTop & 0x7f) |
    ((icvBottom & 0x7f) << 7) |
    ((icvDiag & 0x7f) << 14) |
    ((dgDiag & 0xf) << 21) |
    ((shapeSpecificBit & 0x1) << 25) |
    ((fls & 0x3f) << 26)
  );
}

/** Packs the shared fill-colour halfword: icvFore/icvBack at the "Automatic" defaults a real undecorated XF carries, with the shape-specific trailing bits (fsxButton+reserved3 for CellXF, reserved3 for StyleXF) at 0. */
function packFillColourWord(): number {
  return (
    (ICV_AUTOMATIC_FOREGROUND & 0x7f) | ((ICV_AUTOMATIC_BACKGROUND & 0x7f) << 7)
  );
}

/** CellXF ([MS-XLS] section under XF, fStyle=0's own "Data" payload): 14 bytes -- undecorated alignment/border/fill defaults, with every fAtr* bit set so the format is explicit rather than inherited from its parent style XF. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/671c8577-901f-4215-9ebf-6f5890e5896d */
function packCellXf(): Uint8Array<ArrayBuffer> {
  const fAtrNum = 1;
  const fAtrFnt = 1;
  const fAtrAlc = 1;
  const fAtrBdr = 1;
  const fAtrPat = 1;
  const fAtrProt = 1;
  const word1 =
    packAlignmentPrefix() |
    ((fAtrNum & 0x1) << 26) |
    ((fAtrFnt & 0x1) << 27) |
    ((fAtrAlc & 0x1) << 28) |
    ((fAtrBdr & 0x1) << 29) |
    ((fAtrPat & 0x1) << 30) |
    ((fAtrProt & 0x1) << 31);
  return new RecordBuilder()
    .u32(word1)
    .u32(packBorderWord())
    .u32(packFillPatternWord())
    .u16(packFillColourWord())
    .build();
}

/** StyleXF ([MS-XLS] 2.4.353's fStyle=1 "Data" payload): 14 bytes, the same undecorated defaults with the trailing byte of word1 unused rather than carrying fAtr* flags. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/38cad019-5977-49bf-a55a-6e2e9feaca74 */
function packStyleXf(): Uint8Array<ArrayBuffer> {
  const word1 = packAlignmentPrefix(); // top 8 bits (the "unused" byte) stay 0
  return new RecordBuilder()
    .u32(word1)
    .u32(packBorderWord())
    .u32(packFillPatternWord())
    .u16(packFillColourWord())
    .build();
}

/** XF flags/ixfParent word ([MS-XLS] 2.4.353): fLocked, fHidden, fStyle, f123Prefix, then a 12-bit ixfParent. */
function packXfFlags(options: {
  readonly fStyle: boolean;
  readonly ixfParent: number;
}): number {
  const fLocked = options.fStyle ? 0 : 1; // a real Excel-written cell XF defaults to locked; a style XF carries no meaningful protection state of its own
  const fHidden = 0;
  const f123Prefix = 0;
  return (
    (fLocked & 0x1) |
    ((fHidden & 0x1) << 1) |
    ((options.fStyle ? 1 : 0) << 2) |
    ((f123Prefix & 0x1) << 3) |
    ((options.ixfParent & 0xfff) << 4)
  );
}

/** ixfParent's own "no inheritance" spelling for a cell style XF ([MS-XLS] 2.4.353: "If fStyle equals 1, this field SHOULD equal 0xFFF"). */
const STYLE_XF_NO_PARENT = 0xfff;

/** Writes one cell-format XF record (fStyle=0): ifnt/ifmt as given, ixfParent pointing at the Normal cell-style XF (index 0), an undecorated CellXF payload. Twenty bytes total ([MS-XLS] 2.4.353). */
export function writeCellXfRecord(options: {
  readonly fontIndex: number;
  readonly formatId: number;
}): Uint8Array<ArrayBuffer> {
  const data = new RecordBuilder()
    .u16(options.fontIndex)
    .u16(options.formatId)
    .u16(packXfFlags({ fStyle: false, ixfParent: 0 }))
    .bytes(packCellXf())
    .build();
  return writeRecord(RECORD_XF, data);
}

/** Writes one cell-style XF record (fStyle=1): ifnt/ifmt as given, ixfParent = 0xFFF (no further inheritance), an undecorated StyleXF payload. */
export function writeStyleXfRecord(options: {
  readonly fontIndex: number;
  readonly formatId: number;
}): Uint8Array<ArrayBuffer> {
  const data = new RecordBuilder()
    .u16(options.fontIndex)
    .u16(options.formatId)
    .u16(packXfFlags({ fStyle: true, ixfParent: STYLE_XF_NO_PARENT }))
    .bytes(packStyleXf())
    .build();
  return writeRecord(RECORD_XF, data);
}

/** Style ([MS-XLS] 2.4.269): a built-in cell style naming its own XF record by index, plus the BuiltInStyle structure ([MS-XLS] "BuiltInStyle") saying which built-in style it is. */
export function writeStyleRecord(options: {
  readonly xfIndex: number;
  readonly istyBuiltIn: number;
  readonly iLevel: number;
}): Uint8Array<ArrayBuffer> {
  const fBuiltIn = 1;
  const ixfeWord = (options.xfIndex & 0xfff) | ((fBuiltIn & 0x1) << 15);
  const data = new RecordBuilder()
    .u16(ixfeWord)
    .u8(options.istyBuiltIn)
    .u8(options.iLevel)
    .build();
  return writeRecord(RECORD_STYLE, data);
}

/** Font ([MS-XLS] 2.4.122): height in twips, colour/weight/script/underline defaults for an undecorated font, then the name as a ShortXLUnicodeString whose fHighByte MUST be 1 per the spec regardless of the name's own content ("The fontName.fHighByte field MUST equal 1") -- unlike every other ShortXLUnicodeString this package writes, so it is encoded uncompressed here directly rather than through writeShortXLUnicodeString, whose auto-compression would otherwise write 1-byte-per-character data under a flags byte that has to claim 2 bytes each. */
const FONT_FLAG_ITALIC_ETC = 0x0000; // fItalic/fStrikeOut/fOutline/fShadow/fCondense/fExtend all clear
const FONT_COLOUR_AUTOMATIC = 0x7fff; // icv's own "Automatic"/System Window Text special value
const FONT_WEIGHT_NORMAL = 400;
const FONT_SCRIPT_NORMAL = 0x0000;
const FONT_UNDERLINE_NONE = 0x00;
const FONT_FAMILY_SWISS = 0x02; // Arial's own family classification
const FONT_CHARSET_ANSI = 0x00;

/** Forces the uncompressed (fHighByte=1) ShortXLUnicodeString encoding a font name MUST use, writing every character as a full 16-bit code unit regardless of whether a narrower encoding would also fit. */
function writeFontNameString(name: string): Uint8Array<ArrayBuffer> {
  const builder = new RecordBuilder().u8(name.length).u8(0x01);
  for (let index = 0; index < name.length; index += 1) {
    builder.u16(name.charCodeAt(index));
  }
  return builder.build();
}

export function writeFontRecord(
  name: string,
  heightTwips: number,
): Uint8Array<ArrayBuffer> {
  if (name.length > 0xff) {
    throw new BiffWriteError(
      `font name ${JSON.stringify(name)} is ${name.length} UTF-16 code units, above the 255 a ShortXLUnicodeString cch can hold`,
    );
  }
  const data = new RecordBuilder()
    .u16(heightTwips)
    .u16(FONT_FLAG_ITALIC_ETC)
    .u16(FONT_COLOUR_AUTOMATIC)
    .u16(FONT_WEIGHT_NORMAL)
    .u16(FONT_SCRIPT_NORMAL)
    .u8(FONT_UNDERLINE_NONE)
    .u8(FONT_FAMILY_SWISS)
    .u8(FONT_CHARSET_ANSI)
    .u8(0) // unused3
    .bytes(writeFontNameString(name))
    .build();
  return writeRecord(RECORD_FONT, data);
}

/** Format ([MS-XLS] 2.4.126): a two-byte identifier then the format code as an XLUnicodeString. */
export function writeFormatRecord(
  id: number,
  code: string,
): Uint8Array<ArrayBuffer> {
  const data = new RecordBuilder()
    .u16(id)
    .bytes(writeXLUnicodeString(code))
    .build();
  return writeRecord(RECORD_FORMAT, data);
}
