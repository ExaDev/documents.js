import { readUint16LE, readUint8, slice } from "../bytes";
import { DocFormatError } from "../errors";

// The font table (SttbfFfn), [MS-DOC] 2.9.253 -- the STTB whose entries are FFN records naming the fonts sprmCRgFtc0 ([MS-DOC] 2.6.2) indexes into. Read and written together in one module, unlike the rest of this package's read/write split, because the structure is small, has no independent test-support fixture of its own, and both directions share the same field layout this module's own constants state once.
//
// [MS-DOC] 2.9.253 states SttbfFfn is a "non-extended character STTB" ([MS-DOC] 2.9.256's STTB, the generic string-table shape countless other structures reuse): no leading 0xFFFF fExtend marker, a 2-byte cData entry count, a 2-byte cbExtra that "MUST be 0" for this STTB, then cData entries of (1-byte cch, cch bytes of Data). For every OTHER non-extended STTB, Data is ANSI text and cch counts characters; SttbfFfn's own definition overrides that meaning -- Data is a raw FFN record's bytes, and cch is that record's total BYTE length, not a character count. That is why an FFN's own two variable-length names (xszFfn, and xszAlt when present) are still UTF-16, encoded as null-terminated Unicode, even though the STTB wrapping them is the "non-extended" 1-byte-length spelling: the "extended" bit describes the STTB's own length-prefix width, not what any one structure chooses to put in its Data field.
//
// [MS-DOC] 2.9.87 (FFN) gives the record's own fixed head: ffid (1 byte, the font family), wWeight (2 bytes signed, visual weight -- 400 normal, 700 bold), chs (1 byte, the font's character set), ixchSzAlt (1 byte, a zero-based index into xszFfn where an alternate-font name begins, zero meaning "no alternate"), panose (10 bytes) and fs (24 bytes, a FontSignature) both describing font substitution metadata this package neither reads nor writes meaningfully, then xszFfn itself (variable, null-terminated UTF-16) and, only when ixchSzAlt is nonzero, xszAlt (variable, null-terminated UTF-16, beginning immediately after xszFfn's own terminator).

/** FFN's fixed head before xszFfn: ffid(1) + wWeight(2) + chs(1) + ixchSzAlt(1) + panose(10) + fs(24). */
const FFN_FIXED_SIZE = 1 + 2 + 1 + 1 + 10 + 24;
/** wWeight's "400 corresponds to normal text" -- the only weight this package ever writes, since bold is carried by sprmCFBold rather than by selecting a differently-weighted font face. */
const FFN_WEIGHT_NORMAL = 400;
/** chs's ANSI_CHARSET, [MS-DOC] 2.9.87's own value 0 -- the character set every font this package writes is declared to use, since the document's own text is written as Unicode regardless (see text/piece-table-write.ts). */
const FFN_CHARSET_ANSI = 0x00;
/** A non-extended STTB's own per-entry length prefix is one byte, so one FFN record (fixed head plus a null-terminated name, each name character and terminator being 2 bytes) cannot exceed this. */
const MAX_ENTRY_BYTES = 0xff;

// Parses a SttbfFfn into the font name (FFN.xszFfn) at each index, in table order -- the vocabulary sprmCRgFtc0's operand indexes into. cbExtra is read and checked rather than assumed, the same "the field the spec constrains is worth checking" discipline every other MUST-clause in this package's read path already follows.
export function parseFontTable(sttbfFfn: Uint8Array): string[] {
  const cData = readUint16LE(sttbfFfn, 0);
  const cbExtra = readUint16LE(sttbfFfn, 2);
  if (cbExtra !== 0) {
    throw new DocFormatError(
      `SttbfFfn.cbExtra is ${cbExtra}, but [MS-DOC] 2.9.253 requires it to be 0`,
    );
  }
  const names: string[] = [];
  let cursor = 4;
  for (let index = 0; index < cData; index += 1) {
    const cch = readUint8(sttbfFfn, cursor);
    const record = slice(sttbfFfn, cursor + 1, cch, `SttbfFfn entry ${index}`);
    names.push(readFfnName(record, index));
    cursor += 1 + cch;
  }
  return names;
}

// FFN.xszFfn: "A null-terminated Unicode string that MUST contain the name of the font." Read directly out of the fixed-size head's own end rather than via ixchSzAlt/xszAlt, which this package does not use (see buildFontTable below) -- xszFfn always starts at the same fixed offset and the terminator is the first zero code unit, whether or not an xszAlt follows it.
function readFfnName(record: Uint8Array, index: number): string {
  if (record.length < FFN_FIXED_SIZE + 2) {
    throw new DocFormatError(
      `FFN record ${index} is ${record.length} bytes, shorter than the fixed ${FFN_FIXED_SIZE}-byte head plus xszFfn's own null terminator`,
    );
  }
  let name = "";
  for (let offset = FFN_FIXED_SIZE; offset + 2 <= record.length; offset += 2) {
    const unit = readUint16LE(record, offset);
    if (unit === 0) return name;
    name += String.fromCharCode(unit);
  }
  throw new DocFormatError(
    `FFN record ${index}'s xszFfn runs to the end of the record with no null terminator`,
  );
}

// Builds a SttbfFfn naming exactly `names`, in order, so a Chpx's sprmCRgFtc0 operand can be that name's own array index. Every FFN this package writes carries the same placeholder substitution metadata (ffid 0 -- FFID's "don't care" family, chs ANSI_CHARSET, a zeroed panose and FontSignature): this package writes a font NAME for round-tripping ContentRun.fontFamily, not a font-substitution profile, and every field this reader itself reads back is xszFfn alone. ixchSzAlt is always 0 (no xszAlt) for the same reason -- there is no second name to offer a substitution engine.
export function buildFontTable(names: readonly string[]): Uint8Array {
  const bytes: number[] = [];
  const push16 = (value: number): void => {
    bytes.push(value & 0xff, (value >> 8) & 0xff);
  };
  push16(names.length); // cData.
  push16(0); // cbExtra, which [MS-DOC] 2.9.253 requires to be 0.
  for (const name of names) {
    const record = buildFfnRecord(name);
    if (record.length > MAX_ENTRY_BYTES) {
      throw new DocFormatError(
        `font name ${JSON.stringify(name)} produces a ${record.length}-byte FFN record, past the ${MAX_ENTRY_BYTES}-byte limit a non-extended STTB's one-byte cch can address`,
      );
    }
    bytes.push(record.length, ...record);
  }
  return new Uint8Array(bytes);
}

function buildFfnRecord(name: string): number[] {
  const record: number[] = [
    0x00, // ffid: FFID's "don't care or don't know" family.
    FFN_WEIGHT_NORMAL & 0xff,
    (FFN_WEIGHT_NORMAL >> 8) & 0xff,
    FFN_CHARSET_ANSI,
    0x00, // ixchSzAlt: no xszAlt.
    ...new Array<number>(10).fill(0), // panose.
    ...new Array<number>(24).fill(0), // fs (FontSignature).
  ];
  for (const character of name) {
    const code = character.charCodeAt(0);
    record.push(code & 0xff, (code >> 8) & 0xff);
  }
  record.push(0x00, 0x00); // xszFfn's null terminator.
  return record;
}
