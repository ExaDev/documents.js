// Builders for hand-constructed BIFF8 byte sequences, so every reader test states its input as the field layout [MS-XLS] specifies rather than as an opaque blob captured from some producer. A test failure then points at this package's reading of the specification, which is the thing under test.
//
// Test-support only: excluded from the published dist by tsdown.config.ts, and exempt from the Worker-isomorphism lint rule.

import {
  RECORD_CONTINUE,
  RECORD_NOTE,
  RECORD_OBJ,
  RECORD_TXO,
} from "../biff/record-types";

const BYTE_MASK = 0xff;
const BYTE_SHIFT = 8;
const WORD_SHIFT = 16;
const TRIPLE_BYTE_SHIFT = 24;

/** A record's three-component framing ([MS-XLS] 2.1.4): a little-endian type, a little-endian size, then the data. */
export function record(
  type: number,
  data: readonly number[],
): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    type & BYTE_MASK,
    (type >> BYTE_SHIFT) & BYTE_MASK,
    data.length & BYTE_MASK,
    (data.length >> BYTE_SHIFT) & BYTE_MASK,
    ...data,
  ]);
}

export function concat(
  ...parts: readonly Uint8Array<ArrayBuffer>[]
): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function u16(value: number): number[] {
  return [value & BYTE_MASK, (value >> BYTE_SHIFT) & BYTE_MASK];
}

export function u32(value: number): number[] {
  return [
    value & BYTE_MASK,
    (value >>> BYTE_SHIFT) & BYTE_MASK,
    (value >>> WORD_SHIFT) & BYTE_MASK,
    (value >>> TRIPLE_BYTE_SHIFT) & BYTE_MASK,
  ];
}

const DOUBLE_BYTES = 8;

/** An Xnum ([MS-XLS] 2.5.342): a little-endian IEEE 754 double. */
export function f64(value: number): number[] {
  const buffer = new ArrayBuffer(DOUBLE_BYTES);
  new DataView(buffer).setFloat64(0, value, true);
  return [...new Uint8Array(buffer)];
}

/** An XLUnicodeString ([MS-XLS] 2.5.294), written compressed when every character fits in a low byte and uncompressed otherwise — the same choice a real producer makes. */
export function xlUnicodeString(text: string): number[] {
  const { flags, rgb } = encodeCharacters(text);
  return [...u16(text.length), flags, ...rgb];
}

/** An XLUnicodeStringNoCch ([MS-XLS] 2.5.296): as XLUnicodeString, but with no character-count field of its own — the containing structure states the count separately (SupBook's own `cch`, for its `virtPath` field). */
export function xlUnicodeStringNoCch(text: string): number[] {
  const { flags, rgb } = encodeCharacters(text);
  return [flags, ...rgb];
}

/** A ShortXLUnicodeString ([MS-XLS] 2.5.240): as above with a one-byte character count. */
export function shortXlUnicodeString(text: string): number[] {
  const { flags, rgb } = encodeCharacters(text);
  return [text.length & BYTE_MASK, flags, ...rgb];
}

/** An XLUnicodeRichExtendedString ([MS-XLS] 2.5.293) carrying neither formatting runs nor phonetic data — the shape a plain SST entry has. */
export function richExtendedString(text: string): number[] {
  const { flags, rgb } = encodeCharacters(text);
  return [...u16(text.length), flags, ...rgb];
}

function encodeCharacters(text: string): { flags: number; rgb: number[] } {
  const needsHighByte = [...text].some(
    (char) => char.charCodeAt(0) > BYTE_MASK,
  );
  if (!needsHighByte) {
    return {
      flags: 0x00,
      rgb: [...text].map((char) => char.charCodeAt(0)),
    };
  }
  const rgb = Array.from({ length: text.length }, (_, index) =>
    text.charCodeAt(index),
  ).flatMap((unit) => [unit & BYTE_MASK, (unit >> BYTE_SHIFT) & BYTE_MASK]);
  return { flags: 0x01, rgb };
}

/** [MS-XLS] 2.4.21's own BOF field values below vers/dt: rupBuild and rupYear (the producer's own build number and year, neither ever read), then bfh (file-history flags) and sfo (the lowest BIFF version able to read every record in the file) — history fields every real producer writes but this package's reader never consults. */
const BOF_VERSION_BIFF8 = 0x0600;
const BOF_RUP_BUILD = 0x0dbb;
const BOF_RUP_YEAR = 0x07cc;
const BOF_HISTORY_FLAGS = 0x00000041;
const BOF_LOWEST_READABLE_VERSION = 0x00000206;

/** A BOF record's data ([MS-XLS] 2.4.21), declaring BIFF8 and the given substream document type. The history fields carry values a real producer writes; none of them is read. */
export function bofData(documentType: number): number[] {
  return [
    ...u16(BOF_VERSION_BIFF8),
    ...u16(documentType),
    ...u16(BOF_RUP_BUILD),
    ...u16(BOF_RUP_YEAR),
    ...u32(BOF_HISTORY_FLAGS),
    ...u32(BOF_LOWEST_READABLE_VERSION),
  ];
}

/** RkNumber's own fInt flag ([MS-XLS] 2.5.217): bit 1 set means the 30 remaining bits are a signed integer payload rather than the top 30 bits of a double. */
const RK_INT_FLAG = 0x02;
/** RkNumber's own fX100 flag: the payload is the real value multiplied by 100, divided back out on read. */
const RK_TIMES_100_FLAG = 0x01;
/** The low 2 bits of an RkNumber's 32-bit word are its fX100/fInt flags, not part of the double's own top 30 bits — masked off before treating the word as raw double bits. */
const RK_FLAG_BITS_MASK = 0x03;

/** The 32-bit word of an RkNumber ([MS-XLS] 2.5.217) holding a signed integer payload. */
export function rkInteger(value: number, times100 = false): number[] {
  const payload = (value << 2) >>> 0;
  return u32(
    ((payload | RK_INT_FLAG | (times100 ? RK_TIMES_100_FLAG : 0)) >>> 0) >>> 0,
  );
}

/** The 32-bit word of an RkNumber holding the top 30 bits of a double. The low 34 bits of the double MUST be zero, which the caller's chosen value has to satisfy. */
export function rkDouble(value: number, times100 = false): number[] {
  const buffer = new ArrayBuffer(DOUBLE_BYTES);
  const view = new DataView(buffer);
  view.setFloat64(0, value, false);
  const high = view.getUint32(0, false);
  return u32(
    (((high & ~RK_FLAG_BITS_MASK) >>> 0) |
      (times100 ? RK_TIMES_100_FLAG : 0)) >>>
      0,
  );
}

/** A Cell structure ([MS-XLS] 2.5.19): row, column, and the index of the XF record giving its format. */
export function cell(row: number, column: number, xfIndex = 15): number[] {
  return [...u16(row), ...u16(column), ...u16(xfIndex)];
}

/** One border edge's own raw fields, for cellXfTrailer below — a BorderStyle line-style token (0 = no border) and a 7-bit icv colour index. */
export interface XfTestBorderEdge {
  readonly style: number;
  readonly icv: number;
}

/** The decoration and alignment fields cellXfTrailer packs, in the same shape src/biff/xf-colors.ts's own XfDecorationFields/XfAlignmentFields carry — kept as a separate, independently-written literal here rather than imported, so a test asserting against this fixture's own bytes is checking the reader's understanding of the spec, not agreement with the writer's packing code (see this module's own top comment). */
export interface XfTestDecoration {
  readonly fillPattern?: number;
  readonly fillForegroundIcv?: number;
  /** icvBack — meaningless for a solid fill ("only icvFore is rendered"), but a real colour for every other named FillPattern; ICV_AUTOMATIC_BACKGROUND (0x41) when omitted, matching a real Excel-written XF with no explicit background stated. */
  readonly fillBackgroundIcv?: number;
  readonly left?: XfTestBorderEdge;
  readonly right?: XfTestBorderEdge;
  readonly top?: XfTestBorderEdge;
  readonly bottom?: XfTestBorderEdge;
  /** HorizAlign's own alc token (0-7, [MS-XLS] "HorizAlign") — ALC_GENERAL (0) when omitted, matching a real Excel-written XF with no explicit alignment. */
  readonly alc?: number;
  /** VertAlign's own alcV token (0-4, [MS-XLS] "VertAlign") — ALCV_BOTTOM (2) when omitted, matching a real Excel-written XF with no explicit vertical alignment (this package's own writer default, xf-writer.ts's packAlignmentPrefix). */
  readonly alcV?: number;
}

const NO_EDGE: XfTestBorderEdge = { style: 0, icv: 0 };

/** IcvXF's own "default foreground/background colour" special values (icv 0x40/0x41) — literals taken directly from [MS-XLS]'s Icv table, the values a genuinely undecorated real Excel-written XF carries in icvFore/icvBack. Kept as their own literals here rather than imported from src/biff/xf-colors.ts, for the same reason the rest of this fixture builder is independently written (see this module's own top comment). */
const ICV_DEFAULT_FOREGROUND = 0x40;
const ICV_DEFAULT_BACKGROUND = 0x41;

/** HorizAlign's ALCGEN (general) and VertAlign's ALCVBOT (bottom) — word1's own default alc/alcV tokens for an XF with no explicit alignment stated, matching what a real Excel-written cell also carries (xf-writer.ts's own packAlignmentPrefix default). Independently-written literals, for the same reason ICV_DEFAULT_FOREGROUND is. */
const ALC_GENERAL_DEFAULT = 0x0;
const ALCV_BOTTOM_DEFAULT = 0x2;

/** An XF record's own trailing CellXF/StyleXF "Data" payload ([MS-XLS] 2.4.353), 14 bytes: a leading alignment word (word1's own alc/alcV tokens, General/Bottom when the caller states neither — the identical default a real Excel-written XF with no explicit alignment carries), then the border word, fill-pattern word, and fill-colour word `decoration` packs — no borders and no fill pattern when omitted, with icvFore at its own real-file default (0x40, "Automatic") unless the caller states one — a legal payload every XF record needs regardless of whether a test cares about decoration or alignment. */
// The same word1/word2/word3/word4 bit layout src/biff/xf-colors.ts's own unpackXfAlignment/unpackXfDecoration/packXfDecorationWords pack and unpack ([MS-XLS] 2.4.353's own CellXF field table) — independently-written literals here, for the same reason ICV_DEFAULT_FOREGROUND is (see this module's own top comment).
const ALC_MASK = 0x7;
const ALCV_SHIFT = 4;
const ALCV_MASK = 0x7;
const DG_MASK = 0xf;
const DG_RIGHT_SHIFT = 4;
const DG_TOP_SHIFT = 8;
const DG_BOTTOM_SHIFT = 12;
const ICV_MASK = 0x7f;
const ICV_LEFT_SHIFT = 16;
const ICV_RIGHT_SHIFT = 23;
const ICV_BOTTOM_SHIFT = 7;
const FLS_MASK = 0x3f;
const FLS_SHIFT = 26;
const ICV_BACK_SHIFT = 7;

export function cellXfTrailer(decoration: XfTestDecoration = {}): number[] {
  const left = decoration.left ?? NO_EDGE;
  const right = decoration.right ?? NO_EDGE;
  const top = decoration.top ?? NO_EDGE;
  const bottom = decoration.bottom ?? NO_EDGE;
  const alc = decoration.alc ?? ALC_GENERAL_DEFAULT;
  const alcV = decoration.alcV ?? ALCV_BOTTOM_DEFAULT;
  const word1 = (alc & ALC_MASK) | ((alcV & ALCV_MASK) << ALCV_SHIFT);
  const word2 =
    (left.style & DG_MASK) |
    ((right.style & DG_MASK) << DG_RIGHT_SHIFT) |
    ((top.style & DG_MASK) << DG_TOP_SHIFT) |
    ((bottom.style & DG_MASK) << DG_BOTTOM_SHIFT) |
    ((left.icv & ICV_MASK) << ICV_LEFT_SHIFT) |
    ((right.icv & ICV_MASK) << ICV_RIGHT_SHIFT);
  const word3 =
    (top.icv & ICV_MASK) |
    ((bottom.icv & ICV_MASK) << ICV_BOTTOM_SHIFT) |
    (((decoration.fillPattern ?? 0) & FLS_MASK) << FLS_SHIFT);
  const icvFore =
    (decoration.fillForegroundIcv ?? ICV_DEFAULT_FOREGROUND) & ICV_MASK;
  const icvBack =
    (decoration.fillBackgroundIcv ?? ICV_DEFAULT_BACKGROUND) & ICV_MASK;
  const word4 = icvFore | (icvBack << ICV_BACK_SHIFT);
  return [...u32(word1), ...u32(word2), ...u32(word3), ...u16(word4)];
}

// --- Cell comments: Note/Obj/TxO ([MS-XLS] 2.4.179/2.4.181/2.4.329) — see workbook/comments.ts's own top comment for how the three join. ---

/** FtCmo's own reserved ft/cb tag values ([MS-XLS] 2.5.92), and the ot (object type) value that names a Note. */
const FT_CMO = 0x0015;
const FT_CMO_SIZE = 0x0012;
const OBJECT_TYPE_NOTE = 0x0019;

/** [MS-XLS] 2.5.92 FtCmo (22 bytes): ft (reserved 0x15), cb (reserved 0x12), ot (object type — 0x19 is Note), id, a 16-bit flags word workbook/comments.ts never reads, then three reserved 4-byte fields. */
export function ftCmo(ot: number, id: number): number[] {
  return [
    ...u16(FT_CMO),
    ...u16(FT_CMO_SIZE),
    ...u16(ot),
    ...u16(id),
    ...u16(0), // flags
    ...u32(0), // unused8
    ...u32(0), // unused9
    ...u32(0), // unused10
  ];
}

const FT_NTS = 0x000d;
const FT_NTS_SIZE = 0x0016;
const GUID_BYTES = 16;

/** [MS-XLS] 2.5.87 FtNts (26 bytes): ft (reserved 0x0D), cb (reserved 0x16), a 16-byte guid workbook/comments.ts never reads, fSharedNote, and a reserved 4-byte trailer. */
export function ftNts(): number[] {
  return [
    ...u16(FT_NTS),
    ...u16(FT_NTS_SIZE),
    ...new Array<number>(GUID_BYTES).fill(0),
    ...u16(0), // fSharedNote
    ...u32(0), // unused
  ];
}

/** An Obj record ([MS-XLS] 2.4.181) for a Note-type shape: cmo then nts, nothing else — the fields gated on any other cmo.ot value never apply to a comment's own Obj record. */
export function noteObjRecord(id: number): Uint8Array<ArrayBuffer> {
  return record(RECORD_OBJ, [...ftCmo(OBJECT_TYPE_NOTE, id), ...ftNts()]);
}

/** An Obj record for some OTHER shape type (e.g. ot 0x06, a text box), for a test proving a following TxO is never mistaken for a Note's own text just because some Obj record preceded it. */
export function otherObjRecord(
  ot: number,
  id: number,
): Uint8Array<ArrayBuffer> {
  return record(RECORD_OBJ, ftCmo(ot, id));
}

/**
 * A TxO record ([MS-XLS] 2.4.329) plus the Continue record carrying its text.
 *
 * cbRuns is left at 0 (no TxORuns bytes at all) rather than the `>=16`-and-a-multiple-of-8 a real producer always writes — workbook/comments.ts only ever skips cbRuns bytes verbatim, never validates the constraint, so a shorter run table exercises the same code path with a simpler fixture.
 */
const TXO_RESERVED_BYTES = 6;

export function noteTxoRecords(
  text: string,
): readonly Uint8Array<ArrayBuffer>[] {
  const fixed = [
    ...u16(0), // grbit
    ...u16(0), // rot
    ...new Array<number>(TXO_RESERVED_BYTES).fill(0), // reserved4 + reserved5
    ...u16(text.length), // cchText
    ...u16(0), // cbRuns
    ...u16(0), // ifntEmpty
    ...u16(0), // cbFmla — no formula
  ];
  return [
    record(RECORD_TXO, fixed),
    record(RECORD_CONTINUE, xlUnicodeStringNoCch(text)),
  ];
}

/** A Note record ([MS-XLS] 2.4.179, wrapping a NoteSh): row, col, a flags word workbook/comments.ts never reads, idObj, and stAuthor — omit author entirely by leaving it undefined. */
export function noteRecord(
  row: number,
  column: number,
  idObj: number,
  author?: string,
): Uint8Array<ArrayBuffer> {
  return record(RECORD_NOTE, [
    ...u16(row),
    ...u16(column),
    ...u16(0), // flags
    ...u16(idObj),
    ...xlUnicodeString(author ?? ""),
  ]);
}
