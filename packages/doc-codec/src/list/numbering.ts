import {
  readInt16LE,
  readInt32LE,
  readUint16LE,
  readUint8,
  slice,
} from "../bytes";
import { DocFormatError } from "../errors";
import type { Fib } from "../fib/fib";

// Resolves what a paragraph's own sprmPIlfo (prop/pap.ts's listId, an index into PlfLfo.rgLfo) actually means: the glyph/format, level-text template, and start-at value a consumer needs to render the paragraph's list marker. A paragraph's listId/listLevel membership alone (already read, unchanged by this module) says only WHICH list and WHAT DEPTH; PlfLst and PlfLfo are what say what that list looks like.
//
// NumberingDefinitions is deliberately a separate, top-level structure returned alongside ContentDocument rather than folded into ContentListMembership itself -- the identical reasoning and shape ooxml.js's own typed/docx/numbering.ts states for word/numbering.xml's abstractNum/num tables: (1) ContentListMembership is document-schema.js's own schema, shared verbatim across every codec -- widening it with a doc-codec-specific numbering-definition payload would leak this package's own model into a schema the sibling packages also depend on; (2) a definition is a genuinely document-level resource referenced by listId, not a per-paragraph one, so a keyed-map-once, referenced-by-id-many-times shape avoids every paragraph sharing a listId carrying an identical copy of its full level table. NumberingLevel.format/text deliberately reuse ooxml.js's own vocabulary -- MSONFC's own values ([MS-OSHARED] 2.2.1.3) are individually documented as "mapped to the ST_NumberFormat... equivalents", so format is the identical ECMA-376 string ("decimal", "upperRoman", "bullet", ...) ooxml.js's NumberingLevel.format already carries, and text is the identical '%1.'-style placeholder convention -- so a consumer that already knows how to render one already knows how to render the other.
//
// THIS MODULE stays read-only, but writeDocContent no longer stops at reading: list/numbering-write.ts is this module's own inverse, deriving a NumberingDefinitions-shaped structure from the document's own paragraphs (ContentListMembership carries no full level table of its own, only numId/level/format per paragraph -- see that module's own top comment for how it reconstructs one) and encoding it into real PlfLst/PlfLfo bytes. ooxml.js's own docx writer is unaffected and still does not write word/numbering.xml back (typed/docx/write.ts's own stated scope) -- that is a separate package's separate decision, not something this change touches. What list/numbering-write.ts does NOT do, matching this reader's own gaps below: a level's own grpprlPapx/grpprlChpx Prl streams are always written empty (cb 0), since NumberingLevel carries no per-level direct formatting to encode back out -- there was never anything decoded here for a writer to round-trip.
//
// WHAT THIS DOES NOT RESOLVE, each a genuine layer of the format rather than an oversight: LFOLVL overrides (PlfLfo's own rgLfoData, [MS-DOC] "LFOData"/"LFOLVL") -- an LFO can restate one or more of its LSTF's own levels with different formatting, and this reader always resolves straight through to the LSTF's own LVL, ignoring any override the LFO itself carries; grpprlPapx/grpprlChpx (a level's own paragraph/character formatting Prl streams) -- parsed past by length, never decoded, since ContentListMembership has nowhere to carry per-level indent/font direct formatting; and legal numbering (LVLF.fLegal), which overrides an inherited placeholder's own format rather than the level's own -- text still carries the placeholder verbatim, uninterpreted by fLegal.

const LSTF_SIZE = 28;
const LVLF_SIZE = 28;
const LFO_SIZE = 16;

/** LSTF's own flags byte ([MS-DOC] 2.9.191), bit 0: "this LSTF represents a simple (one-level) list that has one corresponding LVL. Otherwise... a multi-level list that has nine corresponding LVLs." */
const LSTF_FLAG_SIMPLE_LIST = 0x01;

/** MSONFC ([MS-OSHARED] 2.2.1.3), mapped to its own documented ST_NumberFormat equivalent -- the identical vocabulary ooxml.js's NumberingLevel.format carries verbatim from word/numbering.xml's own w:numFmt/@w:val. Every member through msonfcUCRus (0x3B) is a real numbered/lettered/ideograph format; 0x17 (msonfcBullet) is handled separately below since PlfLfo also treats it as the "no number sequence, but has bullets" case LVLF's own field text calls out by name. */
// Exported so numbering-write.ts can invert it (numbering-write.ts's own top comment) rather than hand-maintaining a second, independently-drifting copy of the same MSONFC vocabulary.
export const NUMBER_FORMAT_BY_NFC: Readonly<Record<number, string>> = {
  0x00: "decimal",
  0x01: "upperRoman",
  0x02: "lowerRoman",
  0x03: "upperLetter",
  0x04: "lowerLetter",
  0x05: "ordinal",
  0x06: "cardinalText",
  0x07: "ordinalText",
  0x08: "hex",
  0x09: "chicago",
  0x0a: "ideographDigital",
  0x0b: "japaneseCounting",
  0x0c: "Aiueo",
  0x0d: "Iroha",
  0x0e: "decimalFullWidth",
  0x0f: "decimalHalfWidth",
  0x10: "japaneseLegal",
  0x11: "japaneseDigitalTenThousand",
  0x12: "decimalEnclosedCircle",
  0x13: "decimalFullWidth2",
  0x14: "aiueoFullWidth",
  0x15: "irohaFullWidth",
  0x16: "decimalZero",
  0x17: "bullet",
  0x18: "ganada",
  0x19: "chosung",
  0x1a: "decimalEnclosedFullstop",
  0x1b: "decimalEnclosedParen",
  0x1c: "decimalEnclosedCircleChinese",
  0x1d: "ideographEnclosedCircle",
  0x1e: "ideographTraditional",
  0x1f: "ideographZodiac",
  0x20: "ideographZodiacTraditional",
  0x21: "taiwaneseCounting",
  0x22: "ideographLegalTraditional",
  0x23: "taiwaneseCountingThousand",
  0x24: "taiwaneseDigital",
  0x25: "chineseCounting",
  0x26: "chineseLegalSimplified",
  0x27: "chineseCountingThousand",
  0x28: "decimal",
  0x29: "koreanDigital",
  0x2a: "koreanCounting",
  0x2b: "koreanLegal",
  0x2c: "koreanDigital2",
  0x2d: "hebrew1",
  0x2e: "arabicAlpha",
  0x2f: "hebrew2",
  0x30: "arabicAbjad",
  0x31: "hindiVowels",
  0x32: "hindiConsonants",
  0x33: "hindiNumbers",
  0x34: "hindiCounting",
  0x35: "thaiLetters",
  0x36: "thaiNumbers",
  0x37: "thaiCounting",
  0x38: "vietnameseCounting",
  0x39: "numberInDash",
  0x3a: "russianLower",
  0x3b: "russianUpper",
};
/** MSONFC's own "Specifies that the sequence will not display any numbering" sentinel -- not itself an ST_NumberFormat value, so this reader's own spelling for it ("none") is a deliberate literal rather than a value MSONFC's table states. */
const NFC_NONE = 0xff;

/** LVLF's own info byte ([MS-DOC] 2.9.148), bit 3: fNoRestart -- "Specifies whether this level does not restart its numbering sequence when a level with a lower ilvl is encountered", the identical "restarts when a more significant level is encountered" default NumberingLevel.restart's own field comment already describes. The low two bits (0x01/0x02) are jc's own 2-bit justification field, not flag bits at all -- neither this reader nor NumberingLevel decodes jc, so only this one bit of the whole info byte is ever consulted. Exported so numbering-write.ts can state the identical bit rather than hand-maintaining a second, independently-drifting copy (this module's own top comment: the writer already does this for NUMBER_FORMAT_BY_NFC). */
export const LVLF_FLAG_NO_RESTART = 0x08;

function numberFormatFor(nfc: number): string {
  if (nfc === NFC_NONE) {
    return "none";
  }
  const format = NUMBER_FORMAT_BY_NFC[nfc];
  if (format === undefined) {
    throw new DocFormatError(
      `LVLF.nfc is 0x${nfc.toString(16).padStart(2, "0")}, not a recognised MSONFC value ([MS-OSHARED] 2.2.1.3)`,
    );
  }
  return format;
}

export interface NumberingLevel {
  /** The ST_NumberFormat-equivalent string MSONFC's own value maps to ("decimal", "upperRoman", "bullet", ...), or "none" for a level with no number sequence at all ([MS-DOC] 2.9.148's own nfc field text: "If this is equal to 0xFF..., this level does not have a number sequence"). */
  readonly format: string;
  /** The level's own text template: a placeholder pattern like '%1.' or '%2)' for a numbered format (the digit names which zero-based level's own counter substitutes at that position, one-based in the placeholder itself) -- the identical convention ooxml.js's own NumberingLevel.text carries verbatim from w:lvlText/@w:val -- or a literal bullet glyph string for format 'bullet'. Decoded from the level's own Xst (a raw UTF-16 string) plus its rgbxchNums array, which names which character POSITIONS in that string are placeholders rather than literal text -- see readLevelText below. */
  readonly text: string;
  /** iStartAt: the value this level's counter begins from. Meaningless (and not read as anything but 1) for a level with no number sequence. */
  readonly startAt: number;
  /** ilvlRestartLim ([MS-DOC] 2.9.148), only when fNoRestart is set: the first (most-significant) zero-based level after which this level's own number sequence does NOT restart. Absent (undefined) is the spec's own default behaviour -- "restarts when a more significant level is encountered" -- not "never restarts". */
  readonly restart?: number;
}

export interface NumberingDefinition {
  /** Keyed by the level's own zero-based ilvl, stringified -- the identical zero-based numbering ContentListMembership.level already uses, so `definitions[membership.numId]?.levels[String(membership.level)]` is the direct lookup path from a paragraph's own membership to its rendering definition. A record rather than a fixed-length array/tuple: a simple (fSimpleList) LSTF states only level 0. */
  readonly levels: Readonly<Record<string, NumberingLevel>>;
}

/** Keyed by a paragraph's own listId (ContentListMembership.numId, stringified) -- prop/pap.ts's own sprmPIlfo, a one-based index into PlfLfo.rgLfo. */
export type NumberingDefinitions = Readonly<
  Record<string, NumberingDefinition>
>;

interface Lstf {
  readonly lsid: number;
  readonly fSimpleList: boolean;
}

/** LSTF ([MS-DOC] 2.9.191): lsid(4) + tplc(4, ignored -- UI-only) + rgistdPara(18, ignored -- this reader has no per-level style cascade to link into) + a flags byte (only fSimpleList, bit 0, acted on) + grfhic(1, ignored -- HTML-export-only incompatibility flags). Fixed 28 bytes. */
function readLstf(bytes: Uint8Array, offset: number): Lstf {
  const lsid = readInt32LE(bytes, offset);
  const flags = readUint8(bytes, offset + 26);
  return { lsid, fSimpleList: (flags & LSTF_FLAG_SIMPLE_LIST) !== 0 };
}

/** Xst ([MS-DOC] 2.9.343): cch(2 bytes) then that many raw 16-bit code units, prefixed-length and not null-terminated. Decoded as a plain UTF-16 string -- readLevelText below re-inspects specific character positions afterward for placeholders, which round-trips exactly through String.fromCharCode/charCodeAt since every placeholder value (0-8) sits well within one UTF-16 code unit and never needs a surrogate pair. Returns the decoded text and the byte length consumed, since the caller must advance past it to reach grpprlPapx/grpprlChpx or the next LVL. */
function readXst(
  bytes: Uint8Array,
  offset: number,
): { readonly text: string; readonly byteLength: number } {
  const cch = readUint16LE(bytes, offset);
  let text = "";
  for (let index = 0; index < cch; index += 1) {
    text += String.fromCharCode(readUint16LE(bytes, offset + 2 + index * 2));
  }
  return { text, byteLength: 2 + cch * 2 };
}

/** rgbxchNums ([MS-DOC] 2.9.148's own LVLF field): nine 8-bit one-based character offsets into the LVL's own xst.rgtchar, zero-terminated (a 0 entry, or the end of the fixed 9-byte array, ends the list). Each offset it names is a POSITION in the string, not a value -- readLevelText is what turns a position into the placeholder it names. */
function readRgbxchNums(bytes: Uint8Array, offset: number): number[] {
  const positions: number[] = [];
  for (let index = 0; index < 9; index += 1) {
    const value = readUint8(bytes, offset + index);
    if (value === 0) {
      break;
    }
    positions.push(value);
  }
  return positions;
}

/** Turns an Xst's own decoded text plus its rgbxchNums positions into the '%1.'-style placeholder text NumberingLevel.text states -- the mirror of readXst/readRgbxchNums together. [MS-DOC]'s own Xst field text: "Each placeholder is an unsigned 2-byte integer that specifies the zero-based level that the placeholder is for" -- so the character AT a named position is not a literal code point at all, but a raw level index (0-8) String.fromCharCode/charCodeAt round-trips losslessly; every other position is decoded as ordinary text. A one-based placeholder ('%1' for level 0) matches ooxml.js's own w:lvlText convention, so a consumer already resolving '%1.'/'%2)' style docx templates resolves this reader's templates identically. */
function readLevelText(
  xstText: string,
  placeholderPositions: readonly number[],
): string {
  const placeholders = new Set(placeholderPositions);
  let result = "";
  for (let index = 0; index < xstText.length; index += 1) {
    const oneBasedPosition = index + 1;
    if (placeholders.has(oneBasedPosition)) {
      const levelIndex = xstText.charCodeAt(index);
      result += `%${levelIndex + 1}`;
    } else {
      result += xstText.charAt(index);
    }
  }
  return result;
}

interface ParsedLvl {
  readonly level: NumberingLevel;
  readonly byteLength: number;
}

/** LVL ([MS-DOC] 2.9.196): a 28-byte LVLF, then grpprlPapx (cbGrpprlPapx bytes, skipped -- see this module's own top comment), grpprlChpx (cbGrpprlChpx bytes, skipped), then the level's own Xst. Every LVL is variable-length, so the caller must use byteLength to advance to the next one in the array -- there is no outer length field to skip by instead. */
function readLvl(bytes: Uint8Array, offset: number): ParsedLvl {
  if (offset + LVLF_SIZE > bytes.length) {
    throw new DocFormatError(
      `PlfLst's own appended LVL array runs past the end of its ${bytes.length}-byte buffer at offset ${offset}, ${LVLF_SIZE} bytes short of one LVLF`,
    );
  }
  const iStartAt = readInt32LE(bytes, offset);
  const nfc = readUint8(bytes, offset + 4);
  const flags = readUint8(bytes, offset + 5);
  const fNoRestart = (flags & LVLF_FLAG_NO_RESTART) !== 0;
  const rgbxchNums = readRgbxchNums(bytes, offset + 6);
  const cbGrpprlChpx = readUint8(bytes, offset + 24);
  const cbGrpprlPapx = readUint8(bytes, offset + 25);
  const ilvlRestartLim = readUint8(bytes, offset + 26);

  const xstOffset = offset + LVLF_SIZE + cbGrpprlPapx + cbGrpprlChpx;
  const { text: xstText, byteLength: xstByteLength } = readXst(
    bytes,
    xstOffset,
  );

  const level: NumberingLevel = {
    format: numberFormatFor(nfc),
    text: readLevelText(xstText, rgbxchNums),
    startAt: iStartAt,
  };
  return {
    level: fNoRestart ? { ...level, restart: ilvlRestartLim } : level,
    byteLength: LVLF_SIZE + cbGrpprlPapx + cbGrpprlChpx + xstByteLength,
  };
}

interface ParsedPlfLst {
  readonly lstfs: readonly Lstf[];
  /** One entry per LSTF, in the same order -- 9 levels (or 1, for a simple list), matching FibRgFcLcb97's own fcPlfLst field text: "This array of LVLs is in the same respective order as the LSTFs in PlfLst." */
  readonly levelsByLstf: readonly (readonly NumberingLevel[])[];
}

/** PlfLst ([MS-DOC] 2.9.226): cLst(2 bytes, signed) then that many 28-byte LSTF entries -- followed IMMEDIATELY by the appended LVL array FibRgFcLcb97's own fcPlfLst field describes, which lcbPlfLst does not account for and which this function therefore reads past the declared PlfLst length to reach. */
function parsePlfLst(table: Uint8Array, fc: number, lcb: number): ParsedPlfLst {
  const plfLst = slice(table, fc, lcb, "PlfLst");
  const cLst = readInt16LE(plfLst, 0);
  if (cLst < 0) {
    throw new DocFormatError(
      `PlfLst.cLst is ${cLst}, a negative LSTF count [MS-DOC] 2.9.226 never permits`,
    );
  }
  const lstfs: Lstf[] = [];
  for (let index = 0; index < cLst; index += 1) {
    lstfs.push(readLstf(plfLst, 2 + index * LSTF_SIZE));
  }

  let cursor = fc + lcb;
  const levelsByLstf: NumberingLevel[][] = [];
  for (const lstf of lstfs) {
    const count = lstf.fSimpleList ? 1 : 9;
    const levels: NumberingLevel[] = [];
    for (let index = 0; index < count; index += 1) {
      const { level, byteLength } = readLvl(table, cursor);
      levels.push(level);
      cursor += byteLength;
    }
    levelsByLstf.push(levels);
  }
  return { lstfs, levelsByLstf };
}

/** PlfLfo ([MS-DOC] 2.9.225): lfoMac(4 bytes) then that many 16-byte LFO entries (rgLfo), then rgLfoData -- this reader's own scope stops at rgLfo, since resolving ilfo to a list needs only each LFO's own lsid (rgLfoData carries LFOLVL overrides this reader deliberately does not apply; see this module's own top comment). rgLfo sits entirely before rgLfoData in the stream, so not reading rgLfoData at all is a real, not merely partial, saving -- no cursor needs to walk past it. */
function parseLfoLsids(
  table: Uint8Array,
  fc: number,
  lcb: number,
): readonly number[] {
  const plfLfo = slice(table, fc, lcb, "PlfLfo");
  const lfoMac = readInt32LE(plfLfo, 0);
  if (lfoMac < 0) {
    throw new DocFormatError(
      `PlfLfo.lfoMac is ${lfoMac}, a negative LFO count [MS-DOC] 2.9.225 never permits`,
    );
  }
  const lsids: number[] = [];
  for (let index = 0; index < lfoMac; index += 1) {
    const offset = 4 + index * LFO_SIZE;
    if (offset + LFO_SIZE > plfLfo.length) {
      throw new DocFormatError(
        `PlfLfo declares lfoMac=${lfoMac} LFO entries, but its own ${plfLfo.length}-byte buffer has room for only ${Math.floor((plfLfo.length - 4) / LFO_SIZE)}`,
      );
    }
    lsids.push(readInt32LE(plfLfo, offset));
  }
  return lsids;
}

/** Resolves PlfLst and PlfLfo into NumberingDefinitions, keyed by the one-based ilfo every listId already is (prop/pap.ts's own Math.abs(ilfo)) -- absent entirely when the file carries neither (fcPlfLst/fcPlfLfo both 0, a document with no lists at all, the common case this reader must not fail on). */
export function readNumberingDefinitions(
  table: Uint8Array,
  fib: Fib,
): NumberingDefinitions {
  if (fib.lcbPlfLst === 0 || fib.lcbPlfLfo === 0) {
    return {};
  }
  const { lstfs, levelsByLstf } = parsePlfLst(
    table,
    fib.fcPlfLst,
    fib.lcbPlfLst,
  );
  const lsids = parseLfoLsids(table, fib.fcPlfLfo, fib.lcbPlfLfo);

  const levelsByLsid = new Map<number, readonly NumberingLevel[]>();
  lstfs.forEach((lstf, index) => {
    const levels = levelsByLstf[index];
    if (levels !== undefined) {
      levelsByLsid.set(lstf.lsid, levels);
    }
  });

  const definitions: Record<string, NumberingDefinition> = {};
  lsids.forEach((lsid, index) => {
    const levels = levelsByLsid.get(lsid);
    if (levels === undefined) {
      return;
    }
    const ilfo = index + 1; // rgLfo is addressed one-based, [MS-DOC] 2.9.148's own sprmPIlfo field text.
    const byLevel: Record<string, NumberingLevel> = {};
    levels.forEach((level, levelIndex) => {
      byLevel[String(levelIndex)] = level;
    });
    definitions[String(ilfo)] = { levels: byLevel };
  });
  return definitions;
}
