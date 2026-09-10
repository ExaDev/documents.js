import { RecordBuilder } from "./builder";
import {
  RECORD_FORMAT,
  RECORD_PALETTE,
  RECORD_STYLE,
  RECORD_XF,
} from "./record-types";
import { writeRecord } from "./record-writer";
import { writeXLUnicodeString } from "./string-writer";
import {
  horizAlignTokenFor,
  longRgbBytesOf,
  packXfDecorationWords,
  vertAlignTokenFor,
  type XfDecorationFields,
} from "./xf-colors";
import type { Alignment, Color } from "document-schema.js";

// The formatting record family this writer emits: Format ([MS-XLS] 2.4.126), XF ([MS-XLS] 2.4.353) with its trailing CellXF ([MS-XLS] 2.4.353's own "Data" field, fStyle=0) or StyleXF (fStyle=1) payload, Style ([MS-XLS] 2.4.269), and Palette ([MS-XLS] 2.4.188). The Font record lives next door in biff/font.ts, beside its own reader, so the one layout has the one home.
//
// A cell XF's own fill/border decoration and horizontal/vertical alignment are modelled from document-schema.js's ContentSheetCell.background/borders/alignment/verticalAlignment, and its font index from ContentSheetCell.font through the font table globals-writer.ts builds: this writer's own reader reads all of them back in full (workbook/globals.ts's readCellFormat, biff/font.ts's readFontRecord), so each round-trips -- see xls-codec's README, "Cell decoration" and "Cell alignment". Every CellXF/StyleXF field below still defaults to the same spec-legal, undecorated values for anything writeCellXfRecord's caller does not supply: general alignment, bottom vertical alignment, no border, no fill -- exactly what a genuinely undecorated Excel-written cell also carries. The bit-level packing of the trailing payload's leading alignment word and its border/fill words lives in xf-colors.ts, shared with workbook/globals.ts's own unpacking of the identical layout on read.

/** Packs the shared trot/indent/fJustLast/fShrinkToFit/iReadOrder word every CellXF and StyleXF opens with, at whatever alc/alcV tokens the caller resolved (xf-colors.ts's horizAlignTokenFor/vertAlignTokenFor -- ALC_GENERAL(0)/ALCV_BOTTOM(2) for a caller passing neither, the identical bytes this word always carried before alignment was modelled). fWrap=0, fJustLast=0, trot=0, cIndent=0, fShrinkToFit=0, reserved1=0, iReadOrder=0: this writer never sets any of them, since ContentSheetCell has no field for wrap/rotation/indent/shrink-to-fit/reading-order. Returns the low 24 bits (alc..iReadOrder); the caller ORs in whatever the next 8 bits mean for its own shape (CellXF's fAtr* flags, or StyleXF's all-zero unused byte). */
function packAlignmentPrefix(alc: number, alcV: number): number {
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
    ((alcV & 0x7) << 4) |
    ((fJustLast & 0x1) << 7) |
    ((trot & 0xff) << 8) |
    ((cIndent & 0xf) << 16) |
    ((fShrinkToFit & 0x1) << 20) |
    ((reserved1 & 0x1) << 21) |
    ((iReadOrder & 0x3) << 22)
  );
}

/** CellXF ([MS-XLS] section under XF, fStyle=0's own "Data" payload): 14 bytes -- the given alignment (general/bottom when omitted) plus whatever border/fill decoration is given (undecorated when omitted), with every fAtr* bit set so the format is explicit rather than inherited from its parent style XF. The alignment word and the border/fill words themselves are packed by xf-colors.ts's horizAlignTokenFor/vertAlignTokenFor and packXfDecorationWords, shared with workbook/globals.ts's inverse unpacking on read. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/671c8577-901f-4215-9ebf-6f5890e5896d */
function packCellXf(options: {
  readonly alignment?: Alignment;
  readonly verticalAlignment?: "top" | "middle" | "bottom";
  readonly decoration?: XfDecorationFields;
}): Uint8Array<ArrayBuffer> {
  const fAtrNum = 1;
  const fAtrFnt = 1;
  const fAtrAlc = 1;
  const fAtrBdr = 1;
  const fAtrPat = 1;
  const fAtrProt = 1;
  const word1 =
    packAlignmentPrefix(
      horizAlignTokenFor(options.alignment),
      vertAlignTokenFor(options.verticalAlignment),
    ) |
    ((fAtrNum & 0x1) << 26) |
    ((fAtrFnt & 0x1) << 27) |
    ((fAtrAlc & 0x1) << 28) |
    ((fAtrBdr & 0x1) << 29) |
    ((fAtrPat & 0x1) << 30) |
    ((fAtrProt & 0x1) << 31);
  const { word2, word3, word4 } = packXfDecorationWords(options.decoration);
  return new RecordBuilder()
    .u32(word1)
    .u32(word2)
    .u32(word3)
    .u16(word4)
    .build();
}

/** StyleXF ([MS-XLS] 2.4.353's fStyle=1 "Data" payload): 14 bytes, the same general-alignment/bottom-vertical-alignment/undecorated defaults with the trailing byte of word1 unused rather than carrying fAtr* flags. Never carries real alignment or decoration -- the fifteen built-in cell styles this writer emits (BUILTIN_STYLES in globals-writer.ts) are templates a cell XF's own ixfParent points at, not something a cell's own formatting is written onto. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/38cad019-5977-49bf-a55a-6e2e9feaca74 */
function packStyleXf(): Uint8Array<ArrayBuffer> {
  const word1 = packAlignmentPrefix(
    horizAlignTokenFor(undefined),
    vertAlignTokenFor(undefined),
  ); // top 8 bits (the "unused" byte) stay 0
  const { word2, word3, word4 } = packXfDecorationWords();
  return new RecordBuilder()
    .u32(word1)
    .u32(word2)
    .u32(word3)
    .u16(word4)
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

/** Writes one cell-format XF record (fStyle=0): ifnt/ifmt as given, ixfParent pointing at the Normal cell-style XF (index 0), a CellXF payload carrying `alignment`/`verticalAlignment`/`decoration`'s own fields -- general alignment, bottom vertical alignment, and no fill/border (the same bytes this always wrote before either existed) for whatever is omitted. Twenty bytes total ([MS-XLS] 2.4.353). */
export function writeCellXfRecord(options: {
  readonly fontIndex: number;
  readonly formatId: number;
  readonly alignment?: Alignment;
  readonly verticalAlignment?: "top" | "middle" | "bottom";
  readonly decoration?: XfDecorationFields;
}): Uint8Array<ArrayBuffer> {
  const data = new RecordBuilder()
    .u16(options.fontIndex)
    .u16(options.formatId)
    .u16(packXfFlags({ fStyle: false, ixfParent: 0 }))
    .bytes(
      packCellXf({
        alignment: options.alignment,
        verticalAlignment: options.verticalAlignment,
        decoration: options.decoration,
      }),
    )
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

/** Palette ([MS-XLS] 2.4.188): ccv (MUST be 56) then that many LongRGB colour entries -- write.ts's own colour-interning pass decides whether a workbook needs this record at all, and hands it exactly 56 colours (icv 8 first) when it does. */
export function writePaletteRecord(
  colors: readonly Color[],
): Uint8Array<ArrayBuffer> {
  const builder = new RecordBuilder().u16(colors.length);
  for (const color of colors) {
    const [r, g, b, reserved] = longRgbBytesOf(color);
    builder.u8(r).u8(g).u8(b).u8(reserved);
  }
  return writeRecord(RECORD_PALETTE, builder.build());
}
