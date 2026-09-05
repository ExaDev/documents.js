import type { ContentListMembership } from "document-schema.js";
import { DocFormatError } from "../errors";
import {
  LVLF_FLAG_NO_RESTART,
  NFC_NONE,
  NUMBER_FORMAT_BY_NFC,
  type NumberingDefinition,
  type NumberingDefinitions,
  type NumberingLevel,
} from "./numbering";

// The inverse of numbering.ts: PlfLst/PlfLfo did not exist for writeDocContent to emit at all until this module, because ContentListMembership -- unlike NumberingDefinitions -- carries no full level table of its own, only one paragraph's own numId/level/format. gatherListUsage reconstructs a genuine NumberingDefinitions (numbering.ts's own reader-side type, reused rather than reinvented, matching the issue's own framing: encode from "whatever in-memory numbering representation the reader already produces") by walking every paragraph's own list membership in document order and minting a fresh one-based ilfo per distinct numId, in first-occurrence order -- exactly the value numbering.ts's own readNumberingDefinitions would assign it back on a re-read (that function's own numId IS the ilfo, stringified: see its own top comment), which is what makes a round trip through this package alone stable. A numId string minted by a DIFFERENT producer or codec (an arbitrary string, not already a small positive integer matching its own ilfo) is NOT preserved verbatim -- it is renumbered to whichever ilfo this document happens to mint it, since [MS-DOC] has no field to carry an opaque identifier through unchanged.
//
// buildNumberingTables then encodes a NumberingDefinitions into real bytes, independently of how gatherListUsage produced it -- a hand-built NumberingDefinitions round-trips its own startAt/restart/format/text values too, since every one of those LVLF-and-Xst fields is written from the definition's own NumberingLevel rather than a synthesized default (buildLevelXst below inverts numbering.ts's own readLevelText rather than fabricating placeholder text from the level's index, and NFC_BY_FORMAT states "none" by hand alongside every MSONFC value the reader itself decodes). What it can never write is a level's own grpprlPapx/grpprlChpx (a level's direct paragraph/character formatting) -- NumberingLevel has no field for either, since numbering.ts's own reader never decodes them (see that module's top comment), so every LVL this writer emits states cbGrpprlChpx/cbGrpprlPapx as 0: a real, valid, minimal LVL, just one carrying no per-level direct formatting a real Word list might otherwise have.

const LSTF_SIZE = 28;
const LVLF_SIZE = 28;
const LFO_SIZE = 16;
/** LFOData's own cp field ([MS-DOC] 2.9.149): "This value is undefined and MUST be ignored." 0xFFFFFFFF is the spec's own worked example for an LFOData with no LFOLVL overrides, so this writer states the identical value rather than an arbitrary one of its own. */
const LFO_DATA_CP = 0xffffffff;
const LSTF_FLAG_SIMPLE_LIST = 0x01;
/** rgistdPara ([MS-DOC] 2.9.191's own LSTF field table): nine 2-byte ISTD entries, one per level, each "MUST be set to 0x0FFF to specify that this level is not linked to a style" when (as here) the writer links no per-level style cascade at all -- a genuine MUST this writer has to satisfy itself, unlike tplc/grfhic, which numbering.ts's own reader ignores outright. 0x0000 is not an available "unset" spelling: it names a real style (ISTD 0, "Normal"), so leaving the field zeroed states a link this writer never intended. */
const LSTF_RGISTD_PARA_UNLINKED = 0x0fff;
const LSTF_RGISTD_PARA_COUNT = 9;
/** A non-simple LSTF always carries exactly nine LVLs ([MS-DOC] 2.9.191), so no zero-based level this module writes or validates ever exceeds 8 -- two distinct fields share this same 0..8 ceiling: sprmPIlvl's own operand (this writer's caller, pap-write.ts, validates against the identical fact at the paragraph-property layer) and, below in buildLevelXst, the raw zero-based level VALUE a '%N' placeholder encodes into a level's own Xst text ([MS-DOC] 2.9.343's own Xst field text: "Each placeholder is an unsigned 2-byte integer that specifies the zero-based level"). */
const MAX_LIST_LEVEL = 8;
const LEVELS_PER_MULTI_LEVEL_LIST = 9;
/** rgbxchNums' own 8-bit entries ([MS-DOC] 2.9.148): each names a one-based character POSITION in the level's own Xst text, not a value, and that position has to fit a single unsigned byte -- a longer literal prefix before the first placeholder pushes it past this without complaint from anything but this check, since a plain JS number[] never clamps on its own and only silently truncates mod 256 once this module's bytes become a Uint8Array. Distinct from MAX_LIST_LEVEL above, which bounds a placeholder's own VALUE, not its character position. */
const MAX_UINT8 = 0xff;
/** The format every level this writer invents for a paragraph that leaves ContentListMembership.format unstated, and every level a multi-level list's own dense 0..8 run needs filling but no paragraph ever actually used -- an arbitrary but harmless choice, since an unused level's own appearance is never read back into a context that renders it. */
const DEFAULT_FORMAT = "decimal";
/** The glyph this writer states for format 'bullet'. A real Word-format producer typically uses a Private Use Area code point from a symbol font (the README's own "Numbering definitions" section records LibreOffice writing U+F0B7) -- this writer uses the plain, portable Unicode bullet instead, since this is a synthesised definition rather than a captured one, and it round-trips exactly through this package's own reader either way. */
const BULLET_GLYPH = "•";
/** The six format strings ContentListMembership.format's own Zod enum permits (document-schema.js's content.ts) -- named directly in buildLvlBytes' own refusal message rather than NFC_BY_FORMAT's full ~59-entry key list, since every one of those six always resolves and a refusal can only ever be reached through a hand-built NumberingDefinitions naming something else entirely (see that function's own comment). */
const CONTENT_LIST_MEMBERSHIP_FORMATS = [
  "bullet",
  "decimal",
  "lowerLetter",
  "upperLetter",
  "lowerRoman",
  "upperRoman",
] as const;
/** MSONFC values [MS-DOC] 2.9.148's own LVLF.nfc field text explicitly forbids ("This value MUST NOT be equal to 0x08, 0x09, 0x0F, or 0x13"), even though NUMBER_FORMAT_BY_NFC decodes all four for other contexts (word field codes) where MSONFC's wider vocabulary is legal: hex (0x08), chicago (0x09), decimalHalfWidth (0x0F), decimalFullWidth2 (0x13). None of CONTENT_LIST_MEMBERSHIP_FORMATS' own six values ever resolves to one of these, so reaching this set means a hand-built NumberingDefinitions named one of these four format strings directly. */
const LVLF_FORBIDDEN_NFC = new Set<number>([0x08, 0x09, 0x0f, 0x13]);
/** iStartAt's own [MS-DOC] 2.9.148 range: "MUST be in the range 0 to 0x7FFF, inclusive", despite the field occupying a full 4-byte slot. */
const MAX_START_AT = 0x7fff;

/** The inverse of numbering.ts's own NUMBER_FORMAT_BY_NFC, restricted to whichever of its entries a format string can actually reach -- built once by inverting the single source of truth rather than hand-maintaining a second table that could silently drift from it. Where two nfc values map to the same format string (0x00 and 0x28 both mean "decimal"), the lower one wins, because Object.entries on an object whose own keys are non-negative integer strings iterates in ascending numeric order regardless of insertion order (the one case JavaScript's own key-ordering rules give a numeric guarantee), so the first entry visited for "decimal" is 0x00. "none" is added by hand afterward: NUMBER_FORMAT_BY_NFC's own inversion never reaches it, since numbering.ts's own numberFormatFor special-cases nfc 0xFF as "none" before ever consulting that table. */
const NFC_BY_FORMAT: ReadonlyMap<string, number> = (() => {
  const byFormat = new Map<string, number>();
  for (const [nfcKey, format] of Object.entries(NUMBER_FORMAT_BY_NFC)) {
    if (!byFormat.has(format)) {
      byFormat.set(format, Number(nfcKey));
    }
  }
  byFormat.set("none", NFC_NONE);
  return byFormat;
})();

function push16(bytes: number[], value: number): void {
  bytes.push(value & 0xff, (value >> 8) & 0xff);
}

function push32(bytes: number[], value: number): void {
  const unsigned = value >>> 0;
  bytes.push(
    unsigned & 0xff,
    (unsigned >> 8) & 0xff,
    (unsigned >> 16) & 0xff,
    (unsigned >>> 24) & 0xff,
  );
}

function writeUint32LE(target: number[], offset: number, value: number): void {
  const unsigned = value >>> 0;
  target[offset] = unsigned & 0xff;
  target[offset + 1] = (unsigned >> 8) & 0xff;
  target[offset + 2] = (unsigned >> 16) & 0xff;
  target[offset + 3] = (unsigned >>> 24) & 0xff;
}

// Xst ([MS-DOC] 2.9.343): a 2-byte cch then that many raw UTF-16 code units -- the exact inverse of numbering.ts's own readXst, iterated by code unit (not by code point, which for...of would give) since a placeholder position is a code-unit offset and this writer's own text is always within the Basic Multilingual Plane regardless.
function encodeXst(text: string): number[] {
  const bytes: number[] = [];
  push16(bytes, text.length);
  for (let index = 0; index < text.length; index += 1) {
    push16(bytes, text.charCodeAt(index));
  }
  return bytes;
}

const PLACEHOLDER_PATTERN = /%(\d+)/g;

/** The exact inverse of numbering.ts's own readLevelText: turns a level's own '%1.'-style text (or a literal glyph string, for a format with no placeholder at all) into an Xst plus the rgbxchNums positions its placeholders occupy. A '%N' match's own N (one-based, naming the zero-based level N-1) becomes a single raw code unit at that position -- exactly what [MS-DOC]'s own Xst field text describes ("Each placeholder is an unsigned 2-byte integer that specifies the zero-based level") -- and every other character passes through literally. Driven entirely by the level's own `text` field rather than by its format: a 'bullet' or 'none' level's text ordinarily carries no '%N' pattern at all, so it round-trips unchanged with no special case needed, exactly the way readLevelText itself never branches on format either. `level` is this LVL's own zero-based ilvl, needed only to bound how many placeholders [MS-DOC] 2.9.148 permits this particular level to name (one plus its own zero-based index) -- passed down from buildNumberingTables' own per-level loop, the one place that index is actually known. */
function buildLevelXst(
  text: string,
  level: number,
): {
  readonly xstText: string;
  readonly positions: readonly number[];
} {
  let xstText = "";
  const positions: number[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
    const levelDigits = match[1];
    if (levelDigits === undefined) {
      throw new DocFormatError(
        "internal defect: a global regex match from text.matchAll had no capture group",
      );
    }
    xstText += text.slice(lastIndex, match.index);
    const levelIndex = Number(levelDigits) - 1;
    if (levelIndex < 0 || levelIndex > MAX_LIST_LEVEL) {
      throw new DocFormatError(
        `numbering level text ${JSON.stringify(text)} names placeholder %${levelDigits}, which encodes to the zero-based level ${levelIndex}, outside the 0..${MAX_LIST_LEVEL} range [MS-DOC] 2.9.343's own Xst field text permits ("Each placeholder is an unsigned 2-byte integer that specifies the zero-based level") -- writing it anyway would silently wrap the value mod 65536 once String.fromCharCode encodes it, corrupting the encoded level text`,
      );
    }
    const position = xstText.length + 1;
    if (position > MAX_UINT8) {
      throw new DocFormatError(
        `numbering level text ${JSON.stringify(text)} places a placeholder at character position ${position}, outside the 0..${MAX_UINT8} range rgbxchNums' own 8-bit entries ([MS-DOC] 2.9.148) can hold -- writing it anyway would silently truncate the position mod 256 once these bytes become a Uint8Array, corrupting the encoded level text`,
      );
    }
    positions.push(position);
    xstText += String.fromCharCode(levelIndex);
    lastIndex = match.index + match[0].length;
  }
  xstText += text.slice(lastIndex);
  const maxPlaceholders = level + 1;
  if (positions.length > maxPlaceholders) {
    throw new DocFormatError(
      `numbering level text ${JSON.stringify(text)} at level ${level} names ${positions.length} placeholders, more than [MS-DOC] 2.9.148's own limit of ${maxPlaceholders} (one plus this LVL's own zero-based level) permits`,
    );
  }
  return { xstText, positions };
}

function levelText(level: number, format: string): string {
  return format === "bullet" ? BULLET_GLYPH : `%${level + 1}.`;
}

function defaultLevel(level: number, format: string): NumberingLevel {
  return { format, text: levelText(level, format), startAt: 1 };
}

/** One document's own numbering, gathered from every paragraph's list membership (the caller passes the already-flattened sequence, table cells included, so a list used only inside a table cell is still resolved). */
export interface ListUsage {
  /** Keyed by the freshly-minted ilfo, stringified -- the identical shape and key convention numbering.ts's own readNumberingDefinitions produces (its own numId IS the ilfo; see this module's own top comment), so re-reading the bytes buildNumberingTables encodes from this reproduces it. */
  readonly definitions: NumberingDefinitions;
  /** A paragraph's own ContentListMembership.numId to the ilfo minted for it -- what pap-write.ts's own encodeParagraphGrpprl needs to write that paragraph's sprmPIlfo. */
  readonly ilfoByNumId: ReadonlyMap<string, number>;
}

export function gatherListUsage(
  memberships: readonly (ContentListMembership | undefined)[],
): ListUsage {
  const ilfoByNumId = new Map<string, number>();
  const usedLevelsByIlfo = new Map<number, Map<number, NumberingLevel>>();

  for (const membership of memberships) {
    if (membership?.numId === undefined) continue;
    if (membership.level > MAX_LIST_LEVEL) {
      throw new DocFormatError(
        `paragraph list numId ${JSON.stringify(membership.numId)} names level ${membership.level}, outside the 0..${MAX_LIST_LEVEL} range a non-simple LSTF's fixed nine LVLs ([MS-DOC] 2.9.191) can address`,
      );
    }
    let ilfo = ilfoByNumId.get(membership.numId);
    if (ilfo === undefined) {
      ilfo = ilfoByNumId.size + 1;
      ilfoByNumId.set(membership.numId, ilfo);
      usedLevelsByIlfo.set(ilfo, new Map());
    }
    const used = usedLevelsByIlfo.get(ilfo);
    if (used === undefined) {
      throw new DocFormatError(
        "internal defect: gatherListUsage minted an ilfo with no levels map of its own",
      );
    }
    if (!used.has(membership.level)) {
      used.set(
        membership.level,
        defaultLevel(membership.level, membership.format ?? DEFAULT_FORMAT),
      );
    }
  }

  const definitions: Record<string, NumberingDefinition> = {};
  for (const [ilfo, used] of usedLevelsByIlfo) {
    // A real PlfLst never states a partial LSTF: [MS-DOC]'s own fSimpleList flag means "exactly one LVL, for level 0" and its absence means "exactly nine, levels 0-8" -- there is no third shape, so every level in that dense range needs a definition, used or not (an unused one is never read back into a context that renders it).
    const maxLevelUsed = Math.max(...used.keys());
    const levelCount = maxLevelUsed === 0 ? 1 : LEVELS_PER_MULTI_LEVEL_LIST;
    const levels: Record<string, NumberingLevel> = {};
    for (let level = 0; level < levelCount; level += 1) {
      levels[String(level)] =
        used.get(level) ?? defaultLevel(level, DEFAULT_FORMAT);
    }
    definitions[String(ilfo)] = { levels };
  }

  return { definitions, ilfoByNumId };
}

function buildLstfBytes(lsid: number, fSimpleList: boolean): number[] {
  const lstf = new Array<number>(LSTF_SIZE).fill(0);
  writeUint32LE(lstf, 0, lsid);
  // tplc (offset 4, 4 bytes) stays 0 -- ignored by this package's own reader (numbering.ts's readLstf: "tplc... ignored -- UI-only"), and [MS-DOC] states no MUST of its own for it. rgistdPara (offset 8, 18 bytes) is a genuine MUST this writer has to satisfy itself, unlike tplc: numbering.ts's own reader ignores every entry ("this reader has no per-level style cascade to link into"), but [MS-DOC] 2.9.191 requires each of the nine ISTD entries to be 0x0FFF when, as here, the level links to no style -- 0x0000 is not an available "unset" spelling, since it names a real style (ISTD 0, "Normal"), so leaving the field zeroed would state a link this writer never intended, even though this package's own round trip can never detect the difference.
  for (let index = 0; index < LSTF_RGISTD_PARA_COUNT; index += 1) {
    lstf[8 + index * 2] = LSTF_RGISTD_PARA_UNLINKED & 0xff;
    lstf[8 + index * 2 + 1] = (LSTF_RGISTD_PARA_UNLINKED >> 8) & 0xff;
  }
  lstf[26] = fSimpleList ? LSTF_FLAG_SIMPLE_LIST : 0x00;
  // grfhic (offset 27) stays 0 -- "ignored -- HTML-export-only incompatibility flags" per numbering.ts's own readLstf.
  return lstf;
}

/** `level` is this LVL's own zero-based ilvl -- the caller's own per-level loop (buildNumberingTables) is the one place that index is actually known, since NumberingLevel itself carries no field naming its own position in the definition's `levels` map. */
function buildLvlBytes(
  numberingLevel: NumberingLevel,
  level: number,
): number[] {
  const nfc = NFC_BY_FORMAT.get(numberingLevel.format);
  if (nfc === undefined) {
    throw new DocFormatError(
      `numbering level format ${JSON.stringify(numberingLevel.format)} has no [MS-OSHARED] 2.2.1.3 MSONFC mapping this writer can state -- ContentListMembership.format itself only ever carries ${JSON.stringify(CONTENT_LIST_MEMBERSHIP_FORMATS)} (document-schema.js's own six-member enum), each of which always resolves here, so this failure means a NumberingDefinitions built by hand -- bypassing gatherListUsage entirely -- named a format string outside both that set and the wider MSONFC vocabulary this function otherwise accepts (itself narrower than MSONFC's full range -- see LVLF_FORBIDDEN_NFC just above)`,
    );
  }
  if (LVLF_FORBIDDEN_NFC.has(nfc)) {
    throw new DocFormatError(
      `numbering level format ${JSON.stringify(numberingLevel.format)} resolves to MSONFC 0x${nfc.toString(16).padStart(2, "0")}, one of the four values [MS-DOC] 2.9.148's own LVLF.nfc field explicitly forbids (0x08 hex, 0x09 chicago, 0x0F decimalHalfWidth, 0x13 decimalFullWidth2) even though the wider MSONFC vocabulary permits it in other contexts -- ContentListMembership's own six formats never reach one of these, so this failure means a NumberingDefinitions built by hand named one directly`,
    );
  }
  if (numberingLevel.startAt < 0 || numberingLevel.startAt > MAX_START_AT) {
    throw new DocFormatError(
      `numbering level ${level}'s own startAt ${numberingLevel.startAt} is outside the 0..${MAX_START_AT} range [MS-DOC] 2.9.148's own iStartAt permits`,
    );
  }
  const { xstText, positions } = buildLevelXst(numberingLevel.text, level);
  const lvlf = new Array<number>(LVLF_SIZE).fill(0);
  writeUint32LE(lvlf, 0, numberingLevel.startAt); // iStartAt.
  lvlf[4] = nfc;
  if (numberingLevel.restart !== undefined) {
    if (numberingLevel.restart < 0 || numberingLevel.restart > level) {
      throw new DocFormatError(
        `numbering level ${level}'s own restart value ${numberingLevel.restart} is outside the 0..${level} range [MS-DOC] 2.9.148's own ilvlRestartLim permits -- it MUST be less than or equal to this LVL's own zero-based level`,
      );
    }
    lvlf[5] = LVLF_FLAG_NO_RESTART;
    lvlf[26] = numberingLevel.restart; // ilvlRestartLim, meaningful only alongside the flag above.
  }
  positions.forEach((position, index) => {
    lvlf[6 + index] = position;
  });
  // Offsets 15-23 (9 bytes) and 27 (1 byte) are fields numbering.ts's own reader never consults -- left 0, matching this package's own "populate only what this package's reader needs back" convention (fib/write.ts's own top comment states the identical choice for the FIB). Offsets 24/25 (cbGrpprlChpx/cbGrpprlPapx) stay 0 too: a real, valid, minimal LVL with no per-level direct formatting -- see this module's own top comment for why there is nothing to encode there.
  return [...lvlf, ...encodeXst(xstText)];
}

export interface NumberingTables {
  /** The whole PlfLst -- cLst, the LSTF array, AND its appended LVL array, physically contiguous. lcbPlfLst below is shorter than this: [MS-DOC]'s own PlfLst declares a length covering only cLst+the LSTF array, with the LVL array read past it (numbering.ts's own parsePlfLst comment) -- so the caller places all of `plfLst` at fcPlfLst but records `lcbPlfLst`, not `plfLst.length`, as the FIB's own lcbPlfLst. */
  readonly plfLst: Uint8Array;
  readonly lcbPlfLst: number;
  readonly plfLfo: Uint8Array;
}

/** Encodes a NumberingDefinitions into real PlfLst/PlfLfo bytes -- undefined when it names no lists at all, so writeDocContent can skip both fc/lcb pairs entirely rather than writing an empty-but-present structure no paragraph ever references. Independent of gatherListUsage: any NumberingDefinitions this package's own numbering.ts could produce from a real .doc encodes here too, including a startAt other than 1 or a restart rule, since every LVLF field this function writes comes from the definition's own NumberingLevel rather than an assumed default. */
export function buildNumberingTables(
  definitions: NumberingDefinitions,
): NumberingTables | undefined {
  const ilfos = Object.keys(definitions)
    .map(Number)
    .sort((a, b) => a - b);
  if (ilfos.length === 0) return undefined;

  const lstfBytes: number[] = [];
  const lvlBytes: number[] = [];
  const rgLfoBytes: number[] = [];
  const rgLfoDataBytes: number[] = [];
  for (const ilfo of ilfos) {
    const definition = definitions[String(ilfo)];
    if (definition === undefined) {
      throw new DocFormatError(
        "internal defect: buildNumberingTables lost a definition for an ilfo its own key list just named",
      );
    }
    const levelKeys = Object.keys(definition.levels)
      .map(Number)
      .sort((a, b) => a - b);
    const fSimpleList = levelKeys.length === 1 && levelKeys[0] === 0;
    const isDenseMultiLevel =
      levelKeys.length === LEVELS_PER_MULTI_LEVEL_LIST &&
      levelKeys.every((level, index) => level === index);
    if (!fSimpleList && !isDenseMultiLevel) {
      throw new DocFormatError(
        `numbering definition for ilfo ${ilfo} names levels ${JSON.stringify(levelKeys)}, but [MS-DOC] 2.9.191's own LSTF states either exactly level 0 alone (a simple list) or a dense 0..${MAX_LIST_LEVEL} run of all nine -- there is no partial shape to write`,
      );
    }
    lstfBytes.push(...buildLstfBytes(ilfo, fSimpleList));
    for (const level of levelKeys) {
      const numberingLevel = definition.levels[String(level)];
      if (numberingLevel === undefined) {
        throw new DocFormatError(
          "internal defect: buildNumberingTables lost a level its own key list just named",
        );
      }
      lvlBytes.push(...buildLvlBytes(numberingLevel, level));
    }
    const lfo = new Array<number>(LFO_SIZE).fill(0);
    writeUint32LE(lfo, 0, ilfo); // lsid -- the same value as this list's own ilfo, which is all buildLstfBytes above needs it to link back to (numbering.ts's own readNumberingDefinitions resolves an LFO to its LSTF purely by matching lsid).
    // The rest of LFO_SIZE (offset 4 onward) stays 0, including clfolvl (offset 12): this writer states no LFOLVL overrides of its own. clfolvl 0 means the LFOData that MUST still follow this LFO in rgLfoData (built below) carries an empty rgLfoLvl -- it does NOT mean the LFOData record itself is skipped. [MS-DOC] 2.9.225: "The rgLfoData array MUST contain exactly the same number of elements as the rgLfo array, and are in the same respective order" -- omitting it would leave fcPlfLfo+lcbPlfLfo landing exactly at rgLfo's own end, with nothing left for a real consumer's own list-formatting algorithm to read past it.
    rgLfoBytes.push(...lfo);
    const lfoData = new Array<number>(4).fill(0);
    writeUint32LE(lfoData, 0, LFO_DATA_CP); // cp -- undefined and MUST be ignored ([MS-DOC] 2.9.149); no rgLfoLvl entries follow, since clfolvl is 0 above.
    rgLfoDataBytes.push(...lfoData);
  }

  const plfLstHeader: number[] = [];
  push16(plfLstHeader, ilfos.length); // cLst.
  const plfLst = new Uint8Array([...plfLstHeader, ...lstfBytes, ...lvlBytes]);

  const plfLfoHeader: number[] = [];
  push32(plfLfoHeader, ilfos.length); // lfoMac.
  // lfoMac + rgLfo + rgLfoData, physically contiguous and all counted in lcbPlfLfo -- unlike PlfLst's own lcbPlfLst, PlfLfo has no appended-past-the-declared-length convention, so the caller (write.ts) can derive lcbPlfLfo directly from plfLfo.length rather than tracking a second shorter figure the way lcbPlfLst needs.
  const plfLfo = new Uint8Array([
    ...plfLfoHeader,
    ...rgLfoBytes,
    ...rgLfoDataBytes,
  ]);

  return {
    plfLst,
    lcbPlfLst: plfLstHeader.length + lstfBytes.length,
    plfLfo,
  };
}
