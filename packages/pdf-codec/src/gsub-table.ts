import { parseGdefTable } from "./gdef-table";
import type { GdefTable } from "./gdef-table";
import type { ClassDefTable, CoverageTable } from "./ot-layout-common";
import { parseClassDef, parseCoverage } from "./ot-layout-common";
import type { SfntFont } from "./sfnt";
import { hasBytes, i16, sfntTableBytes, u16, u32 } from "./sfnt";

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
const SCRIPT_RECORD_SIZE = 6; // Tag scriptTag + Offset16 scriptOffset
const FEATURE_RECORD_SIZE = 6; // Tag featureTag + Offset16 featureOffset
const LANG_SYS_HEADER_SIZE = 6; // Offset16 lookupOrderOffset (reserved, always NULL) + uint16 requiredFeatureIndex + uint16 featureIndexCount
const FEATURE_HEADER_SIZE = 4; // Offset16 featureParamsOffset + uint16 lookupIndexCount
const LOOKUP_HEADER_SIZE = 6; // uint16 lookupType + uint16 lookupFlag + uint16 subTableCount

// GSUB lookup types this module reads (the spec's own numbering): 1 Single Substitution, 4 Ligature Substitution, 5 Contextual Substitution, 6 Chaining Contextual Substitution, 7 Extension Substitution.
const LOOKUP_TYPE_SINGLE_SUBST = 1;
const LOOKUP_TYPE_LIGATURE_SUBST = 4;
const LOOKUP_TYPE_CONTEXT_SUBST = 5;
const LOOKUP_TYPE_CHAIN_CONTEXT_SUBST = 6;
const LOOKUP_TYPE_EXTENSION_SUBST = 7;

const EXTENSION_SUBST_HEADER_SIZE = 8; // uint16 substFormat + uint16 extensionLookupType + Offset32 extensionOffset

// The lookupFlag bits that name glyph classes to skip while matching (OpenType spec, "Lookup Table"): the three ignore bits, the mark-filtering-set selector, and the high byte carrying a mark attachment class. The rightToLeft bit (0x0001) concerns GPOS cursive attachment only and is deliberately not read.
const LOOKUP_FLAG_IGNORE_BASE_GLYPHS = 0x0002;
const LOOKUP_FLAG_IGNORE_LIGATURES = 0x0004;
const LOOKUP_FLAG_IGNORE_MARKS = 0x0008;
const LOOKUP_FLAG_USE_MARK_FILTERING_SET = 0x0010;
const LOOKUP_FLAG_MARK_ATTACHMENT_TYPE = 0xff00;

// HarfBuzz's own nesting limit (HB_MAX_NESTING_LEVEL), borrowed for the same reason it exists there: a contextual lookup's records may legally reference another contextual lookup, including one that references back, and no spec rule bounds the depth.
const MAX_LOOKUP_NESTING_DEPTH = 6;

const PREFERRED_SCRIPT_TAGS = ["latn", "DFLT"] as const;

function readTag(bytes: Uint8Array<ArrayBuffer>, offset: number): string {
  return String.fromCharCode(
    u16(bytes, offset) >> 8,
    u16(bytes, offset) & 0xff,
    u16(bytes, offset + 2) >> 8,
    u16(bytes, offset + 2) & 0xff,
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
interface ShapingSlot {
  glyphId: number;
  span: number;
}

// What one subtable application does at one buffer position: `consumed` buffer slots (the matched window, skipped-interior glyphs included) are replaced by `replacement`, and the walk resumes after the replacement. `replacement` never outgrows `consumed` — substitutions replace 1-for-1 or merge — so a walk always advances.
interface SlotApplication {
  readonly consumed: number;
  readonly replacement: readonly ShapingSlot[];
}

// One SubstLookupRecord from a contextual rule (OpenType spec, "Subst Lookup Record"): apply lookup `lookupIndex` at the `sequenceIndex`-th glyph of the matched input sequence.
interface SubstLookupRecord {
  readonly sequenceIndex: number;
  readonly lookupIndex: number;
}

// One parsed subtable: a function that either applies at `index` in `slots` or returns `undefined` for "this subtable does not describe a match here", which is what moves the caller on to the next subtable of the lookup.
type GsubSubtable = (
  slots: readonly ShapingSlot[],
  index: number,
  depth: number,
) => SlotApplication | undefined;

// Every subtable of one lookup, sharing that lookup's lookupFlag-derived glyph skip. The flag never appears here because it has already been compiled into each subtable's closure.
interface GsubLookup {
  readonly subtables: readonly GsubSubtable[];
}

// Whether `glyphId` is invisible to a lookup carrying `lookupFlag` (+ `markFilteringSet` when the flag selects one), evaluated against the font's GDEF. A font that sets a class-skipping flag without a GDEF skips nothing — every glyph is unclassified, so there is nothing the flag's sentence is true of — which is the spec's own class-0 catch-all, not a fallback.
function glyphSkipper(
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
    (lookupFlag & LOOKUP_FLAG_MARK_ATTACHMENT_TYPE) >> 8;
  const useMarkFilteringSet =
    (lookupFlag & LOOKUP_FLAG_USE_MARK_FILTERING_SET) !== 0;
  return (glyphId: number): boolean => {
    const glyphClass = gdef.glyphClass(glyphId);
    if (ignoreBase && glyphClass === 1) {
      return true;
    }
    if (ignoreLigatures && glyphClass === 2) {
      return true;
    }
    if (glyphClass !== 3) {
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
function nextVisibleSlot(
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
function prevVisibleSlot(
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
function parseSingleSubstFormat1(
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
  const delta = i16(bytes, subtableOffset + 4);
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
function parseSingleSubstFormat2(
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
  const glyphCount = u16(bytes, subtableOffset + 4);
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

function parseLigatureSubstFormat1(
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
  const ligSetCount = u16(bytes, subtableOffset + 4);
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
type ContextualGlyphTest = (glyphId: number) => boolean;

// Walks one contextual rule's three sequences against the buffer at `index` and returns the slot indices of the matched input glyphs, or `undefined` when any position fails. `inputTests` EXCLUDES the entry glyph (every format's rule lists the input's remainder; the entry glyph's own test already ran to select the rule set); `backtrack` is in logical order — its last element matches the nearest preceding visible glyph — and both look-around directions step the same visibility rule the input walk does.
function matchContextualRule(
  slots: readonly ShapingSlot[],
  index: number,
  skip: (glyphId: number) => boolean,
  backtrack: readonly ContextualGlyphTest[],
  inputTests: readonly ContextualGlyphTest[],
  lookahead: readonly ContextualGlyphTest[],
): number[] | undefined {
  const inputSlots: number[] = [index];
  let cursor = index;
  for (const test of inputTests) {
    const next = nextVisibleSlot(slots, cursor + 1, skip);
    if (next === undefined || !test(slots[next]!.glyphId)) {
      return undefined;
    }
    inputSlots.push(next);
    cursor = next;
  }
  let back = index;
  for (let b = backtrack.length - 1; b >= 0; b--) {
    const previous = prevVisibleSlot(slots, back, skip);
    if (previous === undefined || !backtrack[b]!(slots[previous]!.glyphId)) {
      return undefined;
    }
    back = previous;
  }
  let ahead = inputSlots[inputSlots.length - 1]!;
  for (const test of lookahead) {
    const next = nextVisibleSlot(slots, ahead + 1, skip);
    if (next === undefined || !test(slots[next]!.glyphId)) {
      return undefined;
    }
    ahead = next;
  }
  return inputSlots;
}

// Applies a matched contextual rule's SubstLookupRecords over the matched window and returns the window's replacement. The records are applied in order against a working copy of the window; each record targets the slot currently standing at the `sequenceIndex`-th matched input position, located by re-walking the window's visible slots — which is how a length-changing nested substitution (a ligature inside the rule) keeps later records aimed at the right glyph, the same match-position tracking a full-buffer shaper performs.
function applyContextualRule(
  slots: readonly ShapingSlot[],
  inputSlots: readonly number[],
  records: readonly SubstLookupRecord[],
  lookupOf: (lookupIndex: number) => GsubLookup | undefined,
  skip: (glyphId: number) => boolean,
  depth: number,
): SlotApplication | undefined {
  const first = inputSlots[0]!;
  const last = inputSlots[inputSlots.length - 1]!;
  const window: ShapingSlot[] = [];
  for (let s = first; s <= last; s++) {
    window.push({ glyphId: slots[s]!.glyphId, span: slots[s]!.span });
  }
  for (const record of records) {
    const lookup = lookupOf(record.lookupIndex);
    if (
      lookup === undefined ||
      record.sequenceIndex >= inputSlots.length ||
      depth >= MAX_LOOKUP_NESTING_DEPTH
    ) {
      // A record whose lookup this module cannot read, whose sequenceIndex aims past the matched input, or whose nesting exceeds the depth bound cannot be applied — and applying the remaining records would apply half a rule, so the whole match is withdrawn and the walk moves on to the next rule.
      return undefined;
    }
    const target = visibleInputSlot(window, record.sequenceIndex, skip);
    if (target !== undefined) {
      applyLookupAtSlot(window, target, lookup, depth + 1);
    }
  }
  return { consumed: last - first + 1, replacement: window };
}

// The window-relative slot index of the `position`-th input glyph of a contextual match, counting the window's slots the same visibility rule the match itself used. `undefined` when an earlier nested substitution merged that position away — the record then has no glyph to act on and is a no-op, not a failure.
function visibleInputSlot(
  window: readonly ShapingSlot[],
  position: number,
  skip: (glyphId: number) => boolean,
): number | undefined {
  let seen = 0;
  for (let i = 0; i < window.length; i++) {
    if (skip(window[i]!.glyphId)) {
      continue;
    }
    if (seen === position) {
      return i;
    }
    seen += 1;
  }
  return undefined;
}

// Applies one lookup's subtables, in order, at buffer position `index` — the first subtable that matches and applies wins, the order the LookupList itself states. Mutates `slots` in place and returns how many slots the replacement occupies (0 when nothing applied); the top-level per-lookup pass and a contextual rule's nested records share this one path, which is what keeps nested substitutions and top-level ones the same machinery.
function applyLookupAtSlot(
  slots: ShapingSlot[],
  index: number,
  lookup: GsubLookup,
  depth: number,
): number {
  for (const subtable of lookup.subtables) {
    const application = subtable(slots, index, depth);
    if (application !== undefined) {
      slots.splice(index, application.consumed, ...application.replacement);
      return application.replacement.length;
    }
  }
  return 0;
}

const SUBST_LOOKUP_RECORD_SIZE = 4; // uint16 sequenceIndex + uint16 lookupListIndex

// Reads one rule's SubstLookupRecord array, bounds-checked; `undefined` makes the whole subtable or rule unreadable rather than silently truncating a rule's substitution list.
function readSubstLookupRecords(
  bytes: Uint8Array<ArrayBuffer>,
  offset: number,
  count: number,
): SubstLookupRecord[] | undefined {
  if (!hasBytes(bytes, offset, count * SUBST_LOOKUP_RECORD_SIZE)) {
    return undefined;
  }
  const records: SubstLookupRecord[] = [];
  for (let i = 0; i < count; i++) {
    const recordOffset = offset + i * SUBST_LOOKUP_RECORD_SIZE;
    records.push({
      sequenceIndex: u16(bytes, recordOffset),
      lookupIndex: u16(bytes, recordOffset + 2),
    });
  }
  return records;
}

// Contextual Substitution format 3 and Chaining Contextual Substitution format 3 share this record shape: the sequences are arrays of Coverage tables rather than glyph ids or classes, stated eagerly at parse time because a format 3 subtable is one rule.
interface Format3Rule {
  readonly backtrack: readonly CoverageTable[];
  readonly input: readonly CoverageTable[];
  readonly lookahead: readonly CoverageTable[];
  readonly records: readonly SubstLookupRecord[];
}

// Reads a format 3 subtable's offset arrays. The chain layout (OpenType spec, "Chain Context Substitution Format 3") is backtrack offsets, input offsets, lookahead offsets, then records; the plain Contextual format 3 carries input offsets then records only. Every section header is bounds-checked before it is read — a u16 past the table's end must cost this subtable, not throw.
function parseFormat3Rule(
  bytes: Uint8Array<ArrayBuffer>,
  subtableOffset: number,
  chained: boolean,
): Format3Rule | undefined {
  let offset = subtableOffset + 2; // past substFormat
  const backtrack: CoverageTable[] = [];
  const input: CoverageTable[] = [];
  const lookahead: CoverageTable[] = [];
  const readCoverageArray = (): CoverageTable[] | undefined => {
    if (!hasBytes(bytes, offset, 2)) {
      return undefined;
    }
    const count = u16(bytes, offset);
    offset += 2;
    if (!hasBytes(bytes, offset, count * 2)) {
      return undefined;
    }
    const coverages: CoverageTable[] = [];
    for (let i = 0; i < count; i++) {
      const coverageOffset = u16(bytes, offset + i * 2);
      if (coverageOffset === 0) {
        return undefined; // a NULL entry among the offsets is not a coverage table; the subtable is malformed (the spec's own format 3 example marks unused slots NULL, and no rule can be built from one)
      }
      const coverage = parseCoverage(bytes, subtableOffset + coverageOffset);
      if (coverage === undefined) {
        return undefined;
      }
      coverages.push(coverage);
    }
    offset += count * 2;
    return coverages;
  };
  if (chained) {
    const backtracks = readCoverageArray();
    if (backtracks === undefined) {
      return undefined;
    }
    backtrack.push(...backtracks);
  }
  {
    const inputs = readCoverageArray();
    if (inputs === undefined || inputs.length === 0) {
      return undefined; // a rule with no input coverage matches nothing and describes no substitution
    }
    input.push(...inputs);
  }
  if (chained) {
    const lookaheads = readCoverageArray();
    if (lookaheads === undefined) {
      return undefined;
    }
    lookahead.push(...lookaheads);
  }
  if (!hasBytes(bytes, offset, 2)) {
    return undefined;
  }
  const substCount = u16(bytes, offset);
  const records = readSubstLookupRecords(bytes, offset + 2, substCount);
  if (records === undefined) {
    return undefined;
  }
  return { backtrack, input, lookahead, records };
}

// The matcher for a format 3 rule: the entry glyph must sit in the first input coverage, each further input position in its own, and the look-arounds in theirs.
function format3Subtable(
  rule: Format3Rule,
  skip: (glyphId: number) => boolean,
  lookupOf: (lookupIndex: number) => GsubLookup | undefined,
): GsubSubtable {
  const inputRest: ContextualGlyphTest[] = [];
  for (let i = 1; i < rule.input.length; i++) {
    const coverage = rule.input[i]!;
    inputRest.push((glyphId) => coverage.coverageIndex(glyphId) !== undefined);
  }
  const backtrack: ContextualGlyphTest[] = rule.backtrack.map(
    (coverage) => (glyphId: number) =>
      coverage.coverageIndex(glyphId) !== undefined,
  );
  const lookahead: ContextualGlyphTest[] = rule.lookahead.map(
    (coverage) => (glyphId: number) =>
      coverage.coverageIndex(glyphId) !== undefined,
  );
  return (slots, index, depth): SlotApplication | undefined => {
    const slot = slots[index]!;
    if (skip(slot.glyphId)) {
      return undefined;
    }
    if (rule.input[0]!.coverageIndex(slot.glyphId) === undefined) {
      return undefined;
    }
    const inputSlots = matchContextualRule(
      slots,
      index,
      skip,
      backtrack,
      inputRest,
      lookahead,
    );
    if (inputSlots === undefined) {
      return undefined;
    }
    return applyContextualRule(
      slots,
      inputSlots,
      rule.records,
      lookupOf,
      skip,
      depth,
    );
  };
}

// The glyph-sequence rule shape formats 1 and 2 share (both as Contextual and Chaining Contextual): backtrack, input (first glyph implied), lookahead, and the nested records. Format 1 carries glyph ids; format 2 carries classes against the subtable's own ClassDefs.
interface SequenceRule {
  readonly backtrack: readonly number[];
  readonly input: readonly number[]; // the components AFTER the entry glyph; the entry glyph's own match is the coverage/classDef test that selected the rule set
  readonly lookahead: readonly number[];
  readonly records: readonly SubstLookupRecord[];
}

// Reads one glyph-id or class sequence rule at `ruleOffset`. `chained` selects the chain layout (backtrack and lookahead sections around the input); the plain Contextual layout carries input and records only. Every section header is bounds-checked before it is read.
function readSequenceRule(
  bytes: Uint8Array<ArrayBuffer>,
  ruleOffset: number,
  chained: boolean,
): SequenceRule | undefined {
  let offset = ruleOffset;
  const readU16 = (): number | undefined => {
    if (!hasBytes(bytes, offset, 2)) {
      return undefined;
    }
    const value = u16(bytes, offset);
    offset += 2;
    return value;
  };
  const readArray = (): number[] | undefined => {
    const count = readU16();
    if (count === undefined || !hasBytes(bytes, offset, count * 2)) {
      return undefined;
    }
    const values: number[] = [];
    for (let i = 0; i < count; i++) {
      values.push(u16(bytes, offset + i * 2));
    }
    offset += count * 2;
    return values;
  };
  const backtrack = chained ? readArray() : [];
  const glyphCount = readU16();
  if (
    backtrack === undefined ||
    glyphCount === undefined ||
    glyphCount === 0 ||
    !hasBytes(bytes, offset, (glyphCount - 1) * 2)
  ) {
    return undefined; // the spec's own minimum input is 1 (the entry glyph); a rule stating less matches nothing
  }
  const input: number[] = [];
  for (let i = 0; i < glyphCount - 1; i++) {
    input.push(u16(bytes, offset + i * 2));
  }
  offset += (glyphCount - 1) * 2;
  const lookahead = chained ? readArray() : [];
  const substCount = readU16();
  if (lookahead === undefined || substCount === undefined) {
    return undefined;
  }
  const records = readSubstLookupRecords(bytes, offset, substCount);
  if (records === undefined) {
    return undefined;
  }
  return { backtrack, input, lookahead, records };
}

// The two format-1/2 differences, as one small surface: how an entry glyph selects its rule set, and how a rule position's expected value tests a glyph. Format 1 indexes the set array by COVERAGE index and tests glyph-id equality; format 2 indexes it by the entry glyph's input CLASSDEF class and tests class equality — the spec's own worked example spells the class indexing out ("classSeqRuleSetOffsets[2] ... for contexts that begin with Class 2 glyphs"), and its backtrack/lookahead tests run against their own separate ClassDefs.
interface SequenceRuleAccess {
  readonly setIndexOf: (entryGlyphId: number) => number | undefined;
  readonly backtrackTest: (expected: number) => ContextualGlyphTest;
  readonly inputTest: (expected: number) => ContextualGlyphTest;
  readonly lookaheadTest: (expected: number) => ContextualGlyphTest;
}

// Iterates one format 1/2 subtable's rule sets, matching each rule in turn. A zero offset in the set array is the spec's NULL, meaning no rules for that index.
function sequenceSubtable(
  bytes: Uint8Array<ArrayBuffer>,
  subtableOffset: number,
  coverage: CoverageTable,
  setCount: number,
  setOffsetsOffset: number,
  chained: boolean,
  access: SequenceRuleAccess,
  skip: (glyphId: number) => boolean,
  lookupOf: (lookupIndex: number) => GsubLookup | undefined,
): GsubSubtable {
  const readSet = (entryGlyphId: number): SequenceRule[] => {
    const setIndex = access.setIndexOf(entryGlyphId);
    if (setIndex === undefined || setIndex >= setCount) {
      return [];
    }
    const setOffset = u16(bytes, setOffsetsOffset + setIndex * 2);
    if (setOffset === 0) {
      return []; // NULL set offset: the spec's own "no contexts begin with this coverage index / class"
    }
    const ruleSetOffset = subtableOffset + setOffset;
    if (!hasBytes(bytes, ruleSetOffset, 2)) {
      return [];
    }
    const ruleCount = u16(bytes, ruleSetOffset);
    if (!hasBytes(bytes, ruleSetOffset + 2, ruleCount * 2)) {
      return [];
    }
    const rules: SequenceRule[] = [];
    for (let i = 0; i < ruleCount; i++) {
      const rule = readSequenceRule(
        bytes,
        ruleSetOffset + u16(bytes, ruleSetOffset + 2 + i * 2),
        chained,
      );
      if (rule !== undefined) {
        rules.push(rule);
      }
    }
    return rules;
  };
  return (slots, index, depth): SlotApplication | undefined => {
    const slot = slots[index]!;
    if (skip(slot.glyphId)) {
      return undefined;
    }
    if (coverage.coverageIndex(slot.glyphId) === undefined) {
      return undefined; // coverage gates entry for both formats: a glyph the coverage omits starts no rule, whatever its class
    }
    for (const rule of readSet(slot.glyphId)) {
      const inputSlots = matchContextualRule(
        slots,
        index,
        skip,
        rule.backtrack.map(access.backtrackTest),
        rule.input.map(access.inputTest),
        rule.lookahead.map(access.lookaheadTest),
      );
      if (inputSlots !== undefined) {
        return applyContextualRule(
          slots,
          inputSlots,
          rule.records,
          lookupOf,
          skip,
          depth,
        );
      }
    }
    return undefined;
  };
}

// One subtable of one lookup, resolving LookupType 7 (Extension Substitution) transparently — the identical Offset32 wrapper GPOS lookups use, existing so a subtable can sit beyond an Offset16's reach, and the wrapper a font with a large contextual table reaches for.
function parseSubtable(
  bytes: Uint8Array<ArrayBuffer>,
  lookupType: number,
  subtableOffset: number,
  skip: (glyphId: number) => boolean,
  lookupOf: (lookupIndex: number) => GsubLookup | undefined,
): GsubSubtable | undefined {
  if (lookupType === LOOKUP_TYPE_EXTENSION_SUBST) {
    if (
      !hasBytes(bytes, subtableOffset, EXTENSION_SUBST_HEADER_SIZE) ||
      u16(bytes, subtableOffset) !== 1
    ) {
      return undefined;
    }
    const extensionLookupType = u16(bytes, subtableOffset + 2);
    if (extensionLookupType === LOOKUP_TYPE_EXTENSION_SUBST) {
      return undefined; // an Extension subtable may not wrap another one; refusing rather than recursing keeps a malformed font from looping
    }
    return parseSubtable(
      bytes,
      extensionLookupType,
      subtableOffset + u32(bytes, subtableOffset + 4),
      skip,
      lookupOf,
    );
  }
  if (lookupType === LOOKUP_TYPE_SINGLE_SUBST) {
    if (!hasBytes(bytes, subtableOffset, 2)) {
      return undefined;
    }
    const substFormat = u16(bytes, subtableOffset);
    if (substFormat === 1) {
      return parseSingleSubstFormat1(bytes, subtableOffset, skip);
    }
    if (substFormat === 2) {
      return parseSingleSubstFormat2(bytes, subtableOffset, skip);
    }
    return undefined;
  }
  if (lookupType === LOOKUP_TYPE_LIGATURE_SUBST) {
    if (!hasBytes(bytes, subtableOffset, 2)) {
      return undefined;
    }
    if (u16(bytes, subtableOffset) !== 1) {
      return undefined; // Ligature Substitution has the one format
    }
    return parseLigatureSubstFormat1(bytes, subtableOffset, skip);
  }
  if (
    lookupType === LOOKUP_TYPE_CONTEXT_SUBST ||
    lookupType === LOOKUP_TYPE_CHAIN_CONTEXT_SUBST
  ) {
    return parseContextualSubtable(
      bytes,
      lookupType === LOOKUP_TYPE_CHAIN_CONTEXT_SUBST,
      subtableOffset,
      skip,
      lookupOf,
    );
  }
  return undefined; // a feature is free to reference a lookup type this module does not read (multiple, alternate); nothing here can use one
}

// The Contextual (5) and Chaining Contextual (6) lookup subtable dispatch. Each type carries formats 1 (coverage + glyph rules), 2 (coverage + class rules), and 3 (one coverage-array rule); the chain forms add backtrack and lookahead sections to the format 1/2 rule bodies and to the format 3 layout.
function parseContextualSubtable(
  bytes: Uint8Array<ArrayBuffer>,
  chained: boolean,
  subtableOffset: number,
  skip: (glyphId: number) => boolean,
  lookupOf: (lookupIndex: number) => GsubLookup | undefined,
): GsubSubtable | undefined {
  if (!hasBytes(bytes, subtableOffset, 2)) {
    return undefined;
  }
  const substFormat = u16(bytes, subtableOffset);
  if (substFormat === 3) {
    const rule = parseFormat3Rule(bytes, subtableOffset, chained);
    return rule === undefined
      ? undefined
      : format3Subtable(rule, skip, lookupOf);
  }
  // Formats 1 and 2 open with a shared prefix: substFormat, coverage offset, then the rule-set count and offsets; format 2 inserts its ClassDef offset(s) between coverage and the set count, which is why the two are read separately rather than as one header.
  if (substFormat === 1) {
    const prefixSize = 6; // uint16 substFormat + Offset16 coverageOffset + uint16 (chainSubRuleSetCount | subRuleSetCount)
    if (!hasBytes(bytes, subtableOffset, prefixSize)) {
      return undefined;
    }
    const coverage = parseCoverage(
      bytes,
      subtableOffset + u16(bytes, subtableOffset + 2),
    );
    if (coverage === undefined) {
      return undefined;
    }
    const setCount = u16(bytes, subtableOffset + 4);
    const setOffsetsOffset = subtableOffset + prefixSize;
    if (!hasBytes(bytes, setOffsetsOffset, setCount * 2)) {
      return undefined;
    }
    const glyphEquality = (expected: number) => (glyphId: number) =>
      glyphId === expected;
    return sequenceSubtable(
      bytes,
      subtableOffset,
      coverage,
      setCount,
      setOffsetsOffset,
      chained,
      {
        setIndexOf: (entryGlyphId) => coverage.coverageIndex(entryGlyphId),
        backtrackTest: glyphEquality,
        inputTest: glyphEquality,
        lookaheadTest: glyphEquality,
      },
      skip,
      lookupOf,
    );
  }
  if (substFormat === 2) {
    // Chaining format 2 carries three ClassDefs (backtrack, input, lookahead); plain format 2 carries the input one only, which is why the chain header is two bytes wider per extra ClassDef. A zero ClassDef offset is the spec's NULL — every glyph then falls to the catch-all class 0 — but a nonzero offset to an unreadable table makes the whole subtable unreadable rather than silently reclassifying its glyphs.
    const prefixSize = chained ? 12 : 8; // uint16 substFormat + Offset16 coverageOffset + [Offset16 backtrackClassDefOffset + Offset16 inputClassDefOffset + Offset16 lookaheadClassDefOffset | Offset16 classDefOffset] + uint16 setCount
    if (!hasBytes(bytes, subtableOffset, prefixSize)) {
      return undefined;
    }
    const coverage = parseCoverage(
      bytes,
      subtableOffset + u16(bytes, subtableOffset + 2),
    );
    if (coverage === undefined) {
      return undefined;
    }
    const inputClassDefOffset = chained
      ? u16(bytes, subtableOffset + 6)
      : u16(bytes, subtableOffset + 4);
    const inputClassDef =
      inputClassDefOffset === 0
        ? constantZeroClassDef
        : parseClassDef(bytes, subtableOffset + inputClassDefOffset);
    const readAuxClassDef = (offset: number): ClassDefTable | undefined =>
      offset === 0
        ? constantZeroClassDef
        : parseClassDef(bytes, subtableOffset + offset);
    const backtrackClassDef = chained
      ? readAuxClassDef(u16(bytes, subtableOffset + 4))
      : constantZeroClassDef;
    const lookaheadClassDef = chained
      ? readAuxClassDef(u16(bytes, subtableOffset + 8))
      : constantZeroClassDef;
    if (
      inputClassDef === undefined ||
      backtrackClassDef === undefined ||
      lookaheadClassDef === undefined
    ) {
      return undefined;
    }
    const setCount = u16(bytes, subtableOffset + prefixSize - 2);
    const setOffsetsOffset = subtableOffset + prefixSize;
    if (!hasBytes(bytes, setOffsetsOffset, setCount * 2)) {
      return undefined;
    }
    const classEquality =
      (classDef: ClassDefTable, expected: number) => (glyphId: number) =>
        classDef(glyphId) === expected;
    return sequenceSubtable(
      bytes,
      subtableOffset,
      coverage,
      setCount,
      setOffsetsOffset,
      chained,
      {
        setIndexOf: (entryGlyphId) => inputClassDef(entryGlyphId),
        backtrackTest: (expected) => classEquality(backtrackClassDef, expected),
        inputTest: (expected) => classEquality(inputClassDef, expected),
        lookaheadTest: (expected) => classEquality(lookaheadClassDef, expected),
      },
      skip,
      lookupOf,
    );
  }
  return undefined;
}

// A ClassDef that assigns class 0 to every glyph: the meaning of a NULL ClassDef offset in a format 2 subtable — nothing is listed, so everything falls to the catch-all class — rather than an absent table.
const constantZeroClassDef: ClassDefTable = () => 0;

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
        return scriptListOffset + u16(bytes, recordOffset + 4);
      }
    }
  }
  return scriptListOffset + u16(bytes, recordsOffset + 4);
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
  const featureIndexCount = u16(bytes, langSysOffset + 4);
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
    const featureOffset = featureListOffset + u16(bytes, recordOffset + 4);
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
  const scriptOffset = findScriptOffset(bytes, u16(bytes, 4));
  if (scriptOffset === undefined) {
    return undefined;
  }
  const featureTags: readonly string[] = [
    ...DEFAULT_GSUB_FEATURE_TAGS,
    ...(options.optInFeatures ?? []),
  ];
  const lookupIndices = collectLookupIndices(
    bytes,
    u16(bytes, 6),
    parseDefaultLangSysFeatureIndices(bytes, scriptOffset),
    featureTags,
  );
  if (lookupIndices.length === 0) {
    return undefined;
  }

  const lookupListOffset = u16(bytes, 8);
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
    const subTableCount = u16(bytes, lookupOffset + 4);
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
        const advanced = applyLookupAtSlot(slots, slotIndex, lookup, 0);
        slotIndex += advanced !== 0 ? advanced : 1;
      }
    }
    return {
      glyphIds: slots.map((slot) => slot.glyphId),
      spans: slots.map((slot) => slot.span),
    };
  };
}
