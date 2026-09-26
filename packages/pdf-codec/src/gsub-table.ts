import {
  GLYPH_CLASS_BASE,
  GLYPH_CLASS_LIGATURE,
  GLYPH_CLASS_MARK,
  parseGdefTable,
} from "./gdef-table";
import type { GdefTable } from "./gdef-table";
import type { ClassDefTable } from "./ot-layout-common";
import { parseCoverage } from "./ot-layout-common";
import type { SfntFont } from "./sfnt";
import { hasBytes, i16, sfntTableBytes, u16 } from "./sfnt";
import { applyLookupAtSlot, parseSubtable } from "./gsub-context";

// A ClassDef that assigns class 0 to every glyph: the meaning of a NULL ClassDef offset in a format 2 subtable — nothing is listed, so everything falls to the catch-all class — rather than an absent table.
export const constantZeroClassDef: ClassDefTable = () => 0;

// 'GSUB' (The OpenType spec, "GSUB - Glyph Substitution Table"; ISO/IEC 14496-22 clause 6.2): the substitution-side twin of the 'GPOS' pair-kerning table gpos-table.ts reads. This package applies the features an OpenType shaper turns on for text it has been told nothing else about — 'liga' (standard ligatures), 'rlig' (required ligatures), 'calt' (contextual alternates), and 'clig' (contextual ligatures) — because this package's layout carries no shaping properties beyond family/weight/style, and those four are the default-on set every real shaper (HarfBuzz among them) applies to unattributed horizontal text. The opt-in features stay opt-in rather than half-applied: 'smcp' (small caps) and 'dlig' (discretionary ligatures) reach through the same single- and ligature-substitution machinery the default features use, so a caller may enable them through GsubShaperOptions, but no real shaper turns them on until asked and neither does the default here. The README states this scope.
//
// The contextual features are why this module reads 'GDEF' (gdef-table.ts): a lookup's lookupFlag states skip conditions — ignore marks, ignore glyphs outside mark attachment class N, ignore marks outside filtering set S — that quantify over glyph classes only GDEF declares, and a Chaining Contextual rule's backtrack, input, and lookahead sequences are matched against the glyphs that remain visible after those skips. Caladea Italic is the concrete reason the flags cannot stay refused: its one 'liga' lookup carries the ignore-marks flag (0x0008), so before GDEF was read its fi/fl ligatures never applied at all.
//
// Structurally this module deliberately mirrors gpos-table.ts where the two tables genuinely agree — header, ScriptList, FeatureList, LookupList, and the Extension wrapper are the shared Common Table Formats — so a reader who knows one already knows the other. Every read is bounds-checked and a malformed table yields `undefined` rather than throwing, the same untrusted-font policy ot-layout-common.ts states.
//
// One honest narrowing, stated rather than hidden: a SubstLookupRecord nested inside a contextual match is applied against the matched window alone, not the whole glyph buffer, so a nested contextual lookup whose own backtrack or lookahead reaches past the window sees less than a full-buffer shaper would. Nested single and ligature substitutions — the only kinds the fonts in this package's corpus actually carry — never look past their own input sequence, so the narrowing cannot arise for real calt/clig data.

// The feature tags applied by default, in the sense of the module comment. Application ORDER is the font's own feature-index order (collectLookupIndices below), not this list's.
export const DEFAULT_GSUB_FEATURE_TAGS = [
  "liga",
  "rlig",
  "calt",
  "clig",
] as const;

// The opt-in feature tags GsubShaperOptions can enable alongside the defaults. Both reach through lookup types the default features already use (small caps through Single Substitution, discretionary ligatures through Ligature Substitution), so enabling them costs nothing but the decision to.
export const GSUB_OPT_IN_FEATURE_TAGS = ["smcp", "dlig"] as const;

export type GsubOptInFeatureTag = (typeof GSUB_OPT_IN_FEATURE_TAGS)[number];

export interface GsubShaperOptions {
  // Additional opt-in feature tags to apply alongside DEFAULT_GSUB_FEATURE_TAGS — the named switch a real shaper's caller flips, defaulting off.
  readonly optInFeatures?: readonly GsubOptInFeatureTag[];
}

const GSUB_HEADER_SIZE = 10; // uint16 majorVersion + uint16 minorVersion + three Offset16s (ScriptList, FeatureList, LookupList) — the identical layout GPOS's own header carries
// The three Offset16 fields within the GSUB header, following its 4-byte majorVersion + minorVersion.
const GSUB_HEADER_SCRIPT_LIST_OFFSET = 4;
const GSUB_HEADER_FEATURE_LIST_OFFSET = 6;
const GSUB_HEADER_LOOKUP_LIST_OFFSET = 8;
const SCRIPT_RECORD_SIZE = 6; // Tag scriptTag + Offset16 scriptOffset
// The scriptOffset field within one ScriptRecord, following its 4-byte Tag.
const SCRIPT_RECORD_OFFSET_FIELD_OFFSET = 4;
const FEATURE_RECORD_SIZE = 6; // Tag featureTag + Offset16 featureOffset
// The featureOffset field within one FeatureRecord, following its 4-byte Tag.
const FEATURE_RECORD_OFFSET_FIELD_OFFSET = 4;
const LANG_SYS_HEADER_SIZE = 6; // Offset16 lookupOrderOffset (reserved, always NULL) + uint16 requiredFeatureIndex + uint16 featureIndexCount
// The featureIndexCount field within a LangSys record, following its 2-byte lookupOrderOffset and 2-byte requiredFeatureIndex.
const LANG_SYS_FEATURE_INDEX_COUNT_OFFSET = 4;
const FEATURE_HEADER_SIZE = 4; // Offset16 featureParamsOffset + uint16 lookupIndexCount
const LOOKUP_HEADER_SIZE = 6; // uint16 lookupType + uint16 lookupFlag + uint16 subTableCount
// The subTableCount field within the Lookup Table header, following its 2-byte lookupType and 2-byte lookupFlag.
const LOOKUP_HEADER_SUBTABLE_COUNT_OFFSET = 4;

// GSUB lookup types this module reads (the spec's own numbering): 1 Single Substitution, 4 Ligature Substitution, 5 Contextual Substitution, 6 Chaining Contextual Substitution, 7 Extension Substitution.
export const LOOKUP_TYPE_SINGLE_SUBST = 1;
export const LOOKUP_TYPE_LIGATURE_SUBST = 4;
export const LOOKUP_TYPE_CONTEXT_SUBST = 5;
export const LOOKUP_TYPE_CHAIN_CONTEXT_SUBST = 6;
export const LOOKUP_TYPE_EXTENSION_SUBST = 7;

export const EXTENSION_SUBST_HEADER_SIZE = 8; // uint16 substFormat + uint16 extensionLookupType + Offset32 extensionOffset
// The extensionOffset field within an Extension Substitution subtable (right after its 4-byte substFormat + extensionLookupType prefix).
export const EXTENSION_SUBST_OFFSET_FIELD_OFFSET = 4;

// Bits in one byte, and the byte mask/shift readTag and glyphSkipper below use to split a uint16 tag/flag byte apart.
const BITS_PER_BYTE = 8;
const BYTE_MASK = 0xff;

// Nearly every subtable format below opens with the same 4-byte prefix, uint16 substFormat + Offset16 coverageOffset (SINGLE_SUBST_FORMAT_1_SIZE, SINGLE_SUBST_FORMAT_2_HEADER_SIZE, LIGATURE_SUBST_FORMAT_1_HEADER_SIZE, and the contextual format 1/2 headers below all state this explicitly), so the field immediately following it always starts here.
export const SUBST_FORMAT_AND_COVERAGE_SIZE = 4;

// The lookupFlag bits that name glyph classes to skip while matching (OpenType spec, "Lookup Table"): the three ignore bits, the mark-filtering-set selector, and the high byte carrying a mark attachment class. The rightToLeft bit (0x0001) concerns GPOS cursive attachment only and is deliberately not read.
const LOOKUP_FLAG_IGNORE_BASE_GLYPHS = 0x0002;
const LOOKUP_FLAG_IGNORE_LIGATURES = 0x0004;
const LOOKUP_FLAG_IGNORE_MARKS = 0x0008;
const LOOKUP_FLAG_USE_MARK_FILTERING_SET = 0x0010;
const LOOKUP_FLAG_MARK_ATTACHMENT_TYPE = 0xff00;

// HarfBuzz's own nesting limit (HB_MAX_NESTING_LEVEL), borrowed for the same reason it exists there: a contextual lookup's records may legally reference another contextual lookup, including one that references back, and no spec rule bounds the depth.
export const MAX_LOOKUP_NESTING_DEPTH = 6;

const PREFERRED_SCRIPT_TAGS = ["latn", "DFLT"] as const;

export function readTag(
  bytes: Uint8Array<ArrayBuffer>,
  offset: number,
): string {
  return String.fromCharCode(
    u16(bytes, offset) >> BITS_PER_BYTE,
    u16(bytes, offset) & BYTE_MASK,
    u16(bytes, offset + 2) >> BITS_PER_BYTE,
    u16(bytes, offset + 2) & BYTE_MASK,
  );
}

// The result of shaping one glyph sequence: `glyphIds` is the sequence actually drawn after substitution, and `spans[i]` is how many glyphs of the input sequence output glyph `i` replaced — 1 for a glyph that passed through (or was single-substituted), the ligature's own raw input width for a ligature glyph. A span of 0 marks an output glyph whose input text was absorbed by an earlier output glyph's span: a combining mark an ignore-flag lookup skipped over sits between a ligature's components, is drawn after the ligature glyph, and its text belongs to the ligature's span — the same cluster merge a real shaper performs. The spans partition the input exactly: they sum to the input length, in order. A caller that aligned its input sequence with something per-glyph (characters, in embedded-font.ts's case) slices that by `spans`, which is how a ligature glyph's ToUnicode text — the characters it consumed — is recovered.
export interface GsubShaping {
  readonly glyphIds: number[];
  readonly spans: number[];
}

// The shaping function this module hands back: one glyph sequence in, the substituted sequence and its per-glyph input spans out.
export type GsubShaper = (glyphIds: readonly number[]) => GsubShaping;

// One entry of the shaping buffer: the glyph that will be drawn, plus how many raw input glyphs' text it claims. Substitution runs are expressed as replacements over this buffer rather than as an input array plus an output array because contextual rules match against backtrack — the glyphs an earlier lookup already substituted — so a lookup's matching must observe the sequence as the previous lookup left it, exactly as a real shaper iterates one lookup over the whole buffer before starting the next.
export interface ShapingSlot {
  glyphId: number;
  span: number;
}

// What one subtable application does at one buffer position: `consumed` buffer slots (the matched window, skipped-interior glyphs included) are replaced by `replacement`, and the walk resumes after the replacement. `replacement` never outgrows `consumed` — substitutions replace 1-for-1 or merge — so a walk always advances.
export interface SlotApplication {
  readonly consumed: number;
  readonly replacement: readonly ShapingSlot[];
}

// One SubstLookupRecord from a contextual rule (OpenType spec, "Subst Lookup Record"): apply lookup `lookupIndex` at the `sequenceIndex`-th glyph of the matched input sequence.
export interface SubstLookupRecord {
  readonly sequenceIndex: number;
  readonly lookupIndex: number;
}

// One parsed subtable: a function that either applies at `index` in `slots` or returns `undefined` for "this subtable does not describe a match here", which is what moves the caller on to the next subtable of the lookup.
export type GsubSubtable = (
  slots: readonly ShapingSlot[],
  index: number,
  depth: number,
) => SlotApplication | undefined;

// Every subtable of one lookup, sharing that lookup's lookupFlag-derived glyph skip. The flag never appears here because it has already been compiled into each subtable's closure.
export interface GsubLookup {
  readonly subtables: readonly GsubSubtable[];
}

// Whether `glyphId` is invisible to a lookup carrying `lookupFlag` (+ `markFilteringSet` when the flag selects one), evaluated against the font's GDEF. A font that sets a class-skipping flag without a GDEF skips nothing — every glyph is unclassified, so there is nothing the flag's sentence is true of — which is the spec's own class-0 catch-all, not a fallback.
export function glyphSkipper(
  lookupFlag: number,
  markFilteringSet: number,
  gdef: GdefTable | undefined,
): (glyphId: number) => boolean {
  if (gdef === undefined || lookupFlag === 0) {
    return () => false;
  }
  const ignoreBase = (lookupFlag & LOOKUP_FLAG_IGNORE_BASE_GLYPHS) !== 0;
  const ignoreLigatures = (lookupFlag & LOOKUP_FLAG_IGNORE_LIGATURES) !== 0;
  const ignoreMarks = (lookupFlag & LOOKUP_FLAG_IGNORE_MARKS) !== 0;
  // The high byte names the ONE mark attachment class that stays visible; every other mark is skipped. A zero high byte means no class filter at all.
  const markAttachmentType =
    (lookupFlag & LOOKUP_FLAG_MARK_ATTACHMENT_TYPE) >> BITS_PER_BYTE;
  const useMarkFilteringSet =
    (lookupFlag & LOOKUP_FLAG_USE_MARK_FILTERING_SET) !== 0;
  return (glyphId: number): boolean => {
    const glyphClass = gdef.glyphClass(glyphId);
    if (ignoreBase && glyphClass === GLYPH_CLASS_BASE) {
      return true;
    }
    if (ignoreLigatures && glyphClass === GLYPH_CLASS_LIGATURE) {
      return true;
    }
    if (glyphClass !== GLYPH_CLASS_MARK) {
      return false; // the mark filters below quantify over marks only; every other class decision has been made
    }
    if (ignoreMarks) {
      return true;
    }
    if (
      markAttachmentType !== 0 &&
      gdef.markAttachClass(glyphId) !== markAttachmentType
    ) {
      return true;
    }
    return (
      useMarkFilteringSet &&
      !gdef.markFilteringSetCovers(markFilteringSet, glyphId)
    );
  };
}

// The first slot at or after `from` that `skip` leaves visible, or `undefined` past the buffer's end. Slot stepping, not glyph stepping: a mark skipped by one lookup is still a slot in the buffer — it is drawn, it carries text — it is simply invisible to lookups whose flag hides it.
export function nextVisibleSlot(
  slots: readonly ShapingSlot[],
  from: number,
  skip: (glyphId: number) => boolean,
): number | undefined {
  for (let i = Math.max(from, 0); i < slots.length; i++) {
    if (!skip(slots[i]!.glyphId)) {
      return i;
    }
  }
  return undefined;
}

// The last slot strictly before `before` that `skip` leaves visible, or `undefined` past the buffer's start — the backtrack direction, which walks the same visibility rule backwards.
export function prevVisibleSlot(
  slots: readonly ShapingSlot[],
  before: number,
  skip: (glyphId: number) => boolean,
): number | undefined {
  for (let i = Math.min(before, slots.length) - 1; i >= 0; i--) {
    if (!skip(slots[i]!.glyphId)) {
      return i;
    }
  }
  return undefined;
}

// Single Substitution format 1: every covered glyph shifted by one delta (the compact spelling of "these N glyphs become the N glyphs delta positions later").
const SINGLE_SUBST_FORMAT_1_SIZE = 6; // uint16 substFormat + Offset16 coverageOffset + int16 deltaGlyphID
export function parseSingleSubstFormat1(
  bytes: Uint8Array<ArrayBuffer>,
  subtableOffset: number,
  skip: (glyphId: number) => boolean,
): GsubSubtable | undefined {
  if (!hasBytes(bytes, subtableOffset, SINGLE_SUBST_FORMAT_1_SIZE)) {
    return undefined;
  }
  const coverage = parseCoverage(
    bytes,
    subtableOffset + u16(bytes, subtableOffset + 2),
  );
  if (coverage === undefined) {
    return undefined;
  }
  const delta = i16(bytes, subtableOffset + SUBST_FORMAT_AND_COVERAGE_SIZE);
  return (slots, index): SlotApplication | undefined => {
    const slot = slots[index]!;
    if (skip(slot.glyphId)) {
      return undefined;
    }
    if (coverage.coverageIndex(slot.glyphId) === undefined) {
      return undefined;
    }
    return {
      consumed: 1,
      replacement: [{ glyphId: slot.glyphId + delta, span: slot.span }],
    };
  };
}

// Single Substitution format 2: every covered glyph mapped to its own explicit substitute, in coverage order.
const SINGLE_SUBST_FORMAT_2_HEADER_SIZE = 6; // uint16 substFormat + Offset16 coverageOffset + uint16 glyphCount
export function parseSingleSubstFormat2(
  bytes: Uint8Array<ArrayBuffer>,
  subtableOffset: number,
  skip: (glyphId: number) => boolean,
): GsubSubtable | undefined {
  if (!hasBytes(bytes, subtableOffset, SINGLE_SUBST_FORMAT_2_HEADER_SIZE)) {
    return undefined;
  }
  const coverage = parseCoverage(
    bytes,
    subtableOffset + u16(bytes, subtableOffset + 2),
  );
  if (coverage === undefined) {
    return undefined;
  }
  const glyphCount = u16(
    bytes,
    subtableOffset + SUBST_FORMAT_AND_COVERAGE_SIZE,
  );
  const substitutesOffset = subtableOffset + SINGLE_SUBST_FORMAT_2_HEADER_SIZE;
  if (!hasBytes(bytes, substitutesOffset, glyphCount * 2)) {
    return undefined;
  }
  return (slots, index): SlotApplication | undefined => {
    const slot = slots[index]!;
    if (skip(slot.glyphId)) {
      return undefined;
    }
    const coverageIndex = coverage.coverageIndex(slot.glyphId);
    if (coverageIndex === undefined || coverageIndex >= glyphCount) {
      return undefined;
    }
    return {
      consumed: 1,
      replacement: [
        {
          glyphId: u16(bytes, substitutesOffset + coverageIndex * 2),
          span: slot.span,
        },
      ],
    };
  };
}

// Ligature Substitution format 1: coverage over the FIRST glyph of every ligature, one LigatureSet per covered glyph, one Ligature record per ligature that glyph can begin. A Ligature record states the ligature glyph, the component count (first glyph included), and the remaining components in order — so matching is "covered first glyph, then the next componentCount-1 visible glyphs equal the record's components", where VISIBLE is the lookup's own skip rule: a mark between a ligature's components is stepped over, stays in the buffer after the ligature glyph with a span of 0, and its text joins the ligature's span.
const LIGATURE_SUBST_FORMAT_1_HEADER_SIZE = 6; // uint16 substFormat + Offset16 coverageOffset + uint16 ligSetCount
const LIGATURE_SET_HEADER_SIZE = 2; // uint16 ligatureCount
const LIGATURE_HEADER_PREFIX_SIZE = 4; // uint16 ligatureGlyph + uint16 componentCount — the component array follows

export function parseLigatureSubstFormat1(
  bytes: Uint8Array<ArrayBuffer>,
  subtableOffset: number,
  skip: (glyphId: number) => boolean,
): GsubSubtable | undefined {
  if (!hasBytes(bytes, subtableOffset, LIGATURE_SUBST_FORMAT_1_HEADER_SIZE)) {
    return undefined;
  }
  const coverage = parseCoverage(
    bytes,
    subtableOffset + u16(bytes, subtableOffset + 2),
  );
  if (coverage === undefined) {
    return undefined;
  }
  const ligSetCount = u16(
    bytes,
    subtableOffset + SUBST_FORMAT_AND_COVERAGE_SIZE,
  );
  const ligSetOffsetsOffset =
    subtableOffset + LIGATURE_SUBST_FORMAT_1_HEADER_SIZE;
  if (!hasBytes(bytes, ligSetOffsetsOffset, ligSetCount * 2)) {
    return undefined;
  }
  return (slots, index): SlotApplication | undefined => {
    const first = slots[index]!;
    if (skip(first.glyphId)) {
      return undefined;
    }
    const coverageIndex = coverage.coverageIndex(first.glyphId);
    if (coverageIndex === undefined || coverageIndex >= ligSetCount) {
      return undefined;
    }
    const ligSetOffset =
      subtableOffset + u16(bytes, ligSetOffsetsOffset + coverageIndex * 2);
    if (!hasBytes(bytes, ligSetOffset, LIGATURE_SET_HEADER_SIZE)) {
      return undefined;
    }
    const ligatureCount = u16(bytes, ligSetOffset);
    const ligatureOffsetsOffset = ligSetOffset + LIGATURE_SET_HEADER_SIZE;
    if (!hasBytes(bytes, ligatureOffsetsOffset, ligatureCount * 2)) {
      return undefined;
    }
    for (let i = 0; i < ligatureCount; i++) {
      const ligatureOffset =
        ligSetOffset + u16(bytes, ligatureOffsetsOffset + i * 2);
      if (!hasBytes(bytes, ligatureOffset, LIGATURE_HEADER_PREFIX_SIZE)) {
        continue;
      }
      const ligatureGlyph = u16(bytes, ligatureOffset);
      const componentCount = u16(bytes, ligatureOffset + 2);
      if (componentCount === 0) {
        continue; // a ligature of zero components describes nothing; the spec's own minimum is 2 (a first glyph plus at least one component)
      }
      const componentsOffset = ligatureOffset + LIGATURE_HEADER_PREFIX_SIZE;
      if (!hasBytes(bytes, componentsOffset, (componentCount - 1) * 2)) {
        continue;
      }
      // Walk the buffer's visible slots collecting the matched component positions; a glyph the flag hides between components is stepped over and retained.
      const matchedSlots: number[] = [index];
      let cursor = index;
      let matches = true;
      for (let c = 1; c < componentCount; c++) {
        const next = nextVisibleSlot(slots, cursor + 1, skip);
        if (
          next === undefined ||
          slots[next]!.glyphId !== u16(bytes, componentsOffset + (c - 1) * 2)
        ) {
          matches = false;
          break;
        }
        matchedSlots.push(next);
        cursor = next;
      }
      if (!matches) {
        continue;
      }
      const lastSlot = matchedSlots[matchedSlots.length - 1]!;
      let windowSpan = 0;
      const retained: ShapingSlot[] = [];
      for (let s = index; s <= lastSlot; s++) {
        windowSpan += slots[s]!.span;
        if (skip(slots[s]!.glyphId)) {
          retained.push({ glyphId: slots[s]!.glyphId, span: 0 });
        }
      }
      return {
        consumed: lastSlot - index + 1,
        replacement: [
          { glyphId: ligatureGlyph, span: windowSpan },
          ...retained,
        ],
      };
    }
    return undefined;
  };
}

// A per-position glyph test for one contextual sequence position: glyph-id equality (format 1), class equality (format 2), or coverage membership (format 3).
export type ContextualGlyphTest = (glyphId: number) => boolean;

// The ScriptList walk, identical in shape to gpos-table.ts's own: Latin if the font has it, the script-independent default if not, otherwise the first script.
function findScriptOffset(
  bytes: Uint8Array<ArrayBuffer>,
  scriptListOffset: number,
): number | undefined {
  if (!hasBytes(bytes, scriptListOffset, 2)) {
    return undefined;
  }
  const scriptCount = u16(bytes, scriptListOffset);
  const recordsOffset = scriptListOffset + 2;
  if (
    !hasBytes(bytes, recordsOffset, scriptCount * SCRIPT_RECORD_SIZE) ||
    scriptCount === 0
  ) {
    return undefined;
  }
  for (const wanted of PREFERRED_SCRIPT_TAGS) {
    for (let i = 0; i < scriptCount; i++) {
      const recordOffset = recordsOffset + i * SCRIPT_RECORD_SIZE;
      if (readTag(bytes, recordOffset) === wanted) {
        return (
          scriptListOffset +
          u16(bytes, recordOffset + SCRIPT_RECORD_OFFSET_FIELD_OFFSET)
        );
      }
    }
  }
  return (
    scriptListOffset +
    u16(bytes, recordsOffset + SCRIPT_RECORD_OFFSET_FIELD_OFFSET)
  );
}

function parseDefaultLangSysFeatureIndices(
  bytes: Uint8Array<ArrayBuffer>,
  scriptOffset: number,
): number[] {
  if (!hasBytes(bytes, scriptOffset, 2)) {
    return [];
  }
  const defaultLangSysOffset = u16(bytes, scriptOffset);
  if (defaultLangSysOffset === 0) {
    return [];
  }
  const langSysOffset = scriptOffset + defaultLangSysOffset;
  if (!hasBytes(bytes, langSysOffset, LANG_SYS_HEADER_SIZE)) {
    return [];
  }
  const featureIndexCount = u16(
    bytes,
    langSysOffset + LANG_SYS_FEATURE_INDEX_COUNT_OFFSET,
  );
  const indicesOffset = langSysOffset + LANG_SYS_HEADER_SIZE;
  if (!hasBytes(bytes, indicesOffset, featureIndexCount * 2)) {
    return [];
  }
  const indices: number[] = [];
  for (let i = 0; i < featureIndexCount; i++) {
    indices.push(u16(bytes, indicesOffset + i * 2));
  }
  return indices;
}

// The lookup indices every applied feature the chosen script enables points at, in the font's own feature order and de-duplicated — the same once-only discipline gpos-table.ts applies to Carlito's seven 'kern' feature records.
function collectLookupIndices(
  bytes: Uint8Array<ArrayBuffer>,
  featureListOffset: number,
  featureIndices: readonly number[],
  featureTags: readonly string[],
): number[] {
  if (!hasBytes(bytes, featureListOffset, 2)) {
    return [];
  }
  const featureCount = u16(bytes, featureListOffset);
  const recordsOffset = featureListOffset + 2;
  if (!hasBytes(bytes, recordsOffset, featureCount * FEATURE_RECORD_SIZE)) {
    return [];
  }
  const lookupIndices: number[] = [];
  const seen = new Set<number>();
  for (const featureIndex of featureIndices) {
    if (featureIndex >= featureCount) {
      continue;
    }
    const recordOffset = recordsOffset + featureIndex * FEATURE_RECORD_SIZE;
    if (!featureTags.includes(readTag(bytes, recordOffset))) {
      continue;
    }
    const featureOffset =
      featureListOffset +
      u16(bytes, recordOffset + FEATURE_RECORD_OFFSET_FIELD_OFFSET);
    if (!hasBytes(bytes, featureOffset, FEATURE_HEADER_SIZE)) {
      continue;
    }
    const lookupIndexCount = u16(bytes, featureOffset + 2);
    const indicesOffset = featureOffset + FEATURE_HEADER_SIZE;
    if (!hasBytes(bytes, indicesOffset, lookupIndexCount * 2)) {
      continue;
    }
    for (let i = 0; i < lookupIndexCount; i++) {
      const lookupIndex = u16(bytes, indicesOffset + i * 2);
      if (!seen.has(lookupIndex)) {
        seen.add(lookupIndex);
        lookupIndices.push(lookupIndex);
      }
    }
  }
  return lookupIndices;
}

// Builds a GSUB shaper from a font's own 'GSUB' table, or returns `undefined` when the font has no GSUB, no applied feature reachable from the script it lays text out in, or nothing readable behind one. Shaping runs one lookup at a time over the whole glyph sequence, in the feature order the script enables — the OpenType model, and observable: a later lookup's backtrack sees the glyphs an earlier lookup already substituted.
export function buildGsubShaper(
  font: SfntFont,
  options: GsubShaperOptions = {},
): GsubShaper | undefined {
  const bytes = sfntTableBytes(font, "GSUB");
  if (
    bytes === undefined ||
    !hasBytes(bytes, 0, GSUB_HEADER_SIZE) ||
    u16(bytes, 0) !== 1
  ) {
    return undefined;
  }
  const scriptOffset = findScriptOffset(
    bytes,
    u16(bytes, GSUB_HEADER_SCRIPT_LIST_OFFSET),
  );
  if (scriptOffset === undefined) {
    return undefined;
  }
  const featureTags: readonly string[] = [
    ...DEFAULT_GSUB_FEATURE_TAGS,
    ...(options.optInFeatures ?? []),
  ];
  const lookupIndices = collectLookupIndices(
    bytes,
    u16(bytes, GSUB_HEADER_FEATURE_LIST_OFFSET),
    parseDefaultLangSysFeatureIndices(bytes, scriptOffset),
    featureTags,
  );
  if (lookupIndices.length === 0) {
    return undefined;
  }

  const lookupListOffset = u16(bytes, GSUB_HEADER_LOOKUP_LIST_OFFSET);
  if (!hasBytes(bytes, lookupListOffset, 2)) {
    return undefined;
  }
  const lookupCount = u16(bytes, lookupListOffset);
  const lookupOffsetsOffset = lookupListOffset + 2;
  if (!hasBytes(bytes, lookupOffsetsOffset, lookupCount * 2)) {
    return undefined;
  }

  // Every lookup of the LookupList is parsed, not only the feature-applied ones: a contextual rule's SubstLookupRecords may reference any index, including lookups no enabled feature names directly.
  const gdef = parseGdefTable(font);
  const lookups: (GsubLookup | undefined)[] = [];
  const lookupOf = (lookupIndex: number): GsubLookup | undefined =>
    lookups[lookupIndex];
  for (let i = 0; i < lookupCount; i++) {
    const lookupOffset =
      lookupListOffset + u16(bytes, lookupOffsetsOffset + i * 2);
    if (!hasBytes(bytes, lookupOffset, LOOKUP_HEADER_SIZE)) {
      lookups.push(undefined);
      continue;
    }
    const lookupFlag = u16(bytes, lookupOffset + 2);
    const lookupType = u16(bytes, lookupOffset);
    const subTableCount = u16(
      bytes,
      lookupOffset + LOOKUP_HEADER_SUBTABLE_COUNT_OFFSET,
    );
    const subtableOffsetsOffset = lookupOffset + LOOKUP_HEADER_SIZE;
    // When the flag selects a mark filtering set, a trailing uint16 naming it follows the subtable offset array (OpenType spec, "Lookup Table").
    const markFilteringSetWidth =
      (lookupFlag & LOOKUP_FLAG_USE_MARK_FILTERING_SET) !== 0 ? 2 : 0;
    if (
      !hasBytes(
        bytes,
        subtableOffsetsOffset,
        subTableCount * 2 + markFilteringSetWidth,
      )
    ) {
      lookups.push(undefined);
      continue;
    }
    const skip = glyphSkipper(
      lookupFlag,
      markFilteringSetWidth === 0
        ? 0
        : u16(bytes, subtableOffsetsOffset + subTableCount * 2),
      gdef,
    );
    const subtables: GsubSubtable[] = [];
    for (let s = 0; s < subTableCount; s++) {
      const subtable = parseSubtable(
        bytes,
        lookupType,
        lookupOffset + u16(bytes, subtableOffsetsOffset + s * 2),
        skip,
        lookupOf,
      );
      if (subtable !== undefined) {
        subtables.push(subtable);
      }
    }
    lookups.push({ subtables });
  }

  const appliedLookups: GsubLookup[] = [];
  for (const lookupIndex of lookupIndices) {
    const lookup = lookupOf(lookupIndex);
    if (lookup !== undefined) {
      appliedLookups.push(lookup);
    }
  }
  if (appliedLookups.every((lookup) => lookup.subtables.length === 0)) {
    return undefined; // the enabled features reference only lookups with nothing readable behind them, so there is nothing to apply — and `undefined` (not an identity shaper) is what lets embedded-font.ts skip the pass entirely
  }

  return (glyphIds: readonly number[]): GsubShaping => {
    const slots: ShapingSlot[] = glyphIds.map((glyphId) => ({
      glyphId,
      span: 1,
    }));
    for (const lookup of appliedLookups) {
      let slotIndex = 0;
      while (slotIndex < slots.length) {
        // One lookup is a pass over the whole buffer: at each position the first subtable that applies wins, and the pass resumes after the matched window rather than inside it — a chain like 'f','f','i' under an 'ff' then an 'ffi' ligature resolves as whichever the subtable order states first, exactly as a real shaper applies its lookups.
        const application = applyLookupAtSlot(slots, slotIndex, lookup, 0);
        if (application === undefined) {
          slotIndex += 1;
          continue;
        }
        slots.splice(
          slotIndex,
          application.consumed,
          ...application.replacement,
        );
        slotIndex +=
          application.replacement.length !== 0
            ? application.replacement.length
            : 1;
      }
    }
    return {
      glyphIds: slots.map((slot) => slot.glyphId),
      spans: slots.map((slot) => slot.span),
    };
  };
}
