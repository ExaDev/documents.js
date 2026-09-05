import type { ContentListMembership } from "document-schema.js";
import { DocFormatError } from "../errors";
import {
  NUMBER_FORMAT_BY_NFC,
  type NumberingDefinition,
  type NumberingDefinitions,
  type NumberingLevel,
} from "./numbering";

// The inverse of numbering.ts: PlfLst/PlfLfo did not exist for writeDocContent to emit at all until this module, because ContentListMembership -- unlike NumberingDefinitions -- carries no full level table of its own, only one paragraph's own numId/level/format. gatherListUsage reconstructs a genuine NumberingDefinitions (numbering.ts's own reader-side type, reused rather than reinvented, matching the issue's own framing: encode from "whatever in-memory numbering representation the reader already produces") by walking every paragraph's own list membership in document order and minting a fresh one-based ilfo per distinct numId, in first-occurrence order -- exactly the value numbering.ts's own readNumberingDefinitions would assign it back on a re-read (that function's own numId IS the ilfo, stringified: see its own top comment), which is what makes a round trip through this package alone stable. A numId string minted by a DIFFERENT producer or codec (an arbitrary string, not already a small positive integer matching its own ilfo) is NOT preserved verbatim -- it is renumbered to whichever ilfo this document happens to mint it, since [MS-DOC] has no field to carry an opaque identifier through unchanged.
//
// buildNumberingTables then encodes a NumberingDefinitions into real bytes, independently of how gatherListUsage produced it -- a hand-built NumberingDefinitions with its own startAt/restart values round-trips those too, since the LVLF fields they occupy are written from the definition's own fields rather than hardcoded. What it can never write is a level's own grpprlPapx/grpprlChpx (a level's direct paragraph/character formatting) -- NumberingLevel has no field for either, since numbering.ts's own reader never decodes them (see that module's top comment), so every LVL this writer emits states cbGrpprlChpx/cbGrpprlPapx as 0: a real, valid, minimal LVL, just one carrying no per-level direct formatting a real Word list might otherwise have.

const LSTF_SIZE = 28;
const LVLF_SIZE = 28;
const LFO_SIZE = 16;
const LSTF_FLAG_SIMPLE_LIST = 0x01;
/** rgistdPara ([MS-DOC] 2.9.191's own LSTF field table): nine 2-byte ISTD entries, one per level, each "MUST be set to 0x0FFF to specify that this level is not linked to a style" when (as here) the writer links no per-level style cascade at all -- a genuine MUST this writer has to satisfy itself, unlike tplc/grfhic, which numbering.ts's own reader ignores outright. 0x0000 is not an available "unset" spelling: it names a real style (ISTD 0, "Normal"), so leaving the field zeroed states a link this writer never intended. */
const LSTF_RGISTD_PARA_UNLINKED = 0x0fff;
const LSTF_RGISTD_PARA_COUNT = 9;
/** The LVLF flags-byte bit numbering.ts's own reader treats as fNoRestart -- restated here for the reason pap-write.ts's own top comment gives for restating pap.ts's opcodes: this module's own byte layout is coupled to the specification's field table, not to a sibling module's private constant name. */
const LVLF_FLAG_NO_RESTART = 0x02;
/** A non-simple LSTF always carries exactly nine LVLs ([MS-DOC] 2.9.191); sprmPIlvl's own operand range this writer's caller (pap-write.ts) validates against is the same fact restated at the paragraph-property layer. */
const MAX_LIST_LEVEL = 8;
const LEVELS_PER_MULTI_LEVEL_LIST = 9;
/** The format every level this writer invents for a paragraph that leaves ContentListMembership.format unstated, and every level a multi-level list's own dense 0..8 run needs filling but no paragraph ever actually used -- an arbitrary but harmless choice, since an unused level's own appearance is never read back into a context that renders it. */
const DEFAULT_FORMAT = "decimal";
/** The glyph this writer states for format 'bullet'. A real Word-format producer typically uses a Private Use Area code point from a symbol font (the README's own "Numbering definitions" section records LibreOffice writing U+F0B7) -- this writer uses the plain, portable Unicode bullet instead, since this is a synthesised definition rather than a captured one, and it round-trips exactly through this package's own reader either way. */
const BULLET_GLYPH = "•";

/** The inverse of numbering.ts's own NUMBER_FORMAT_BY_NFC, restricted to whichever of its entries a format string can actually reach -- built once by inverting the single source of truth rather than hand-maintaining a second table that could silently drift from it. Where two nfc values map to the same format string (0x00 and 0x28 both mean "decimal"), the lower one wins, because Object.entries on an object whose own keys are non-negative integer strings iterates in ascending numeric order regardless of insertion order (the one case JavaScript's own key-ordering rules give a numeric guarantee), so the first entry visited for "decimal" is 0x00. */
const NFC_BY_FORMAT: ReadonlyMap<string, number> = (() => {
  const byFormat = new Map<string, number>();
  for (const [nfcKey, format] of Object.entries(NUMBER_FORMAT_BY_NFC)) {
    if (!byFormat.has(format)) {
      byFormat.set(format, Number(nfcKey));
    }
  }
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

/** The exact inverse of numbering.ts's own readLevelText: for a numbered format, a single placeholder for the level's own zero-based index (encoded as a raw code unit, per Xst's own placeholder convention) followed by a literal '.', reproducing readLevelText's '%1.'-style output ('%N' where N = level+1) on a subsequent read; for 'bullet', the literal glyph with no placeholder at all. */
function buildLevelXst(
  level: number,
  format: string,
): { readonly xstText: string; readonly positions: readonly number[] } {
  if (format === "bullet") {
    return { xstText: BULLET_GLYPH, positions: [] };
  }
  return { xstText: `${String.fromCharCode(level)}.`, positions: [1] };
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

function buildLvlBytes(
  level: number,
  numberingLevel: NumberingLevel,
): number[] {
  const nfc = NFC_BY_FORMAT.get(numberingLevel.format);
  if (nfc === undefined) {
    throw new DocFormatError(
      `numbering level format ${JSON.stringify(numberingLevel.format)} has no [MS-OSHARED] 2.2.1.3 MSONFC mapping this writer can state -- only ${JSON.stringify([...NFC_BY_FORMAT.keys()])} round-trip through ContentListMembership.format`,
    );
  }
  const { xstText, positions } = buildLevelXst(level, numberingLevel.format);
  const lvlf = new Array<number>(LVLF_SIZE).fill(0);
  writeUint32LE(lvlf, 0, numberingLevel.startAt); // iStartAt.
  lvlf[4] = nfc;
  if (numberingLevel.restart !== undefined) {
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
      lvlBytes.push(...buildLvlBytes(level, numberingLevel));
    }
    const lfo = new Array<number>(LFO_SIZE).fill(0);
    writeUint32LE(lfo, 0, ilfo); // lsid -- the same value as this list's own ilfo, which is all buildLstfBytes above needs it to link back to (numbering.ts's own readNumberingDefinitions resolves an LFO to its LSTF purely by matching lsid).
    // The rest of LFO_SIZE (offset 4 onward, including clfolvl) stays 0: no rgLfoData entries follow, matching numbering.ts's own reader, which never writes -- reads -- past rgLfo either.
    rgLfoBytes.push(...lfo);
  }

  const plfLstHeader: number[] = [];
  push16(plfLstHeader, ilfos.length); // cLst.
  const plfLst = new Uint8Array([...plfLstHeader, ...lstfBytes, ...lvlBytes]);

  const plfLfoHeader: number[] = [];
  push32(plfLfoHeader, ilfos.length); // lfoMac.
  const plfLfo = new Uint8Array([...plfLfoHeader, ...rgLfoBytes]);

  return {
    plfLst,
    lcbPlfLst: plfLstHeader.length + lstfBytes.length,
    plfLfo,
  };
}
