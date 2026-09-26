// The contextual-substitution family, split from gsub-table.ts: format-3 rule parsing, sequence-rule reading, contextual subtable dispatch, and the rule-matching and application engine the GSUB shaper drives over a glyph run.
import type { ClassDefTable, CoverageTable } from "./ot-layout-common";
import { parseClassDef, parseCoverage } from "./ot-layout-common";
import { hasBytes, u16, u32 } from "./sfnt";
import {
  type ContextualGlyphTest,
  constantZeroClassDef,
  EXTENSION_SUBST_HEADER_SIZE,
  EXTENSION_SUBST_OFFSET_FIELD_OFFSET,
  LOOKUP_TYPE_EXTENSION_SUBST,
  LOOKUP_TYPE_CHAIN_CONTEXT_SUBST,
  MAX_LOOKUP_NESTING_DEPTH,
  SUBST_FORMAT_AND_COVERAGE_SIZE,
  LOOKUP_TYPE_CONTEXT_SUBST,
  LOOKUP_TYPE_LIGATURE_SUBST,
  LOOKUP_TYPE_SINGLE_SUBST,
  nextVisibleSlot,
  parseLigatureSubstFormat1,
  parseSingleSubstFormat1,
  parseSingleSubstFormat2,
  prevVisibleSlot,
  type GsubLookup,
  type GsubSubtable,
  type ShapingSlot,
  type SlotApplication,
  type SubstLookupRecord,
} from "./gsub-table";
// Walks one contextual rule's three sequences against the buffer at `index` and returns the slot indices of the matched input glyphs, or `undefined` when any position fails. `inputTests` EXCLUDES the entry glyph (every format's rule lists the input's remainder; the entry glyph's own test already ran to select the rule set); `backtrack` is in logical order — its last element matches the nearest preceding visible glyph — and both look-around directions step the same visibility rule the input walk does.
export function matchContextualRule(
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
export function applyContextualRule(
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
      const application = applyLookupAtSlot(window, target, lookup, depth + 1);
      if (application !== undefined) {
        window.splice(target, application.consumed, ...application.replacement);
      }
    }
  }
  return { consumed: last - first + 1, replacement: window };
}

// The window-relative slot index of the `position`-th input glyph of a contextual match, counting the window's slots the same visibility rule the match itself used. `undefined` when an earlier nested substitution merged that position away — the record then has no glyph to act on and is a no-op, not a failure.
export function visibleInputSlot(
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
// The first subtable of `lookup` that applies at `index`, or undefined when none does. The application is returned rather than spliced in here so the buffer is only ever rewritten by whichever function owns it.
export function applyLookupAtSlot(
  slots: readonly ShapingSlot[],
  index: number,
  lookup: GsubLookup,
  depth: number,
): SlotApplication | undefined {
  for (const subtable of lookup.subtables) {
    const application = subtable(slots, index, depth);
    if (application !== undefined) {
      return application;
    }
  }
  return undefined;
}

const SUBST_LOOKUP_RECORD_SIZE = 4; // uint16 sequenceIndex + uint16 lookupListIndex

// Reads one rule's SubstLookupRecord array, bounds-checked; `undefined` makes the whole subtable or rule unreadable rather than silently truncating a rule's substitution list.
export function readSubstLookupRecords(
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
export function parseFormat3Rule(
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
export function format3Subtable(
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
export function readSequenceRule(
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
export function sequenceSubtable(
  bytes: Uint8Array<ArrayBuffer>,
  subtableOffset: number,
  coverage: Readonly<CoverageTable>,
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
export function parseSubtable(
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
      subtableOffset +
        u32(bytes, subtableOffset + EXTENSION_SUBST_OFFSET_FIELD_OFFSET),
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
export function parseContextualSubtable(
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
  // The third contextual rule format (spec: a single coverage-array rule, no rule sets); formats 1 and 2 are matched as bare literals below since 1 is exempt from this rule as structurally self-evident.
  const CONTEXTUAL_FORMAT_3 = 3;
  if (substFormat === CONTEXTUAL_FORMAT_3) {
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
    const setCount = u16(
      bytes,
      subtableOffset + SUBST_FORMAT_AND_COVERAGE_SIZE,
    );
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
    // uint16 substFormat + Offset16 coverageOffset + [Offset16 backtrackClassDefOffset + Offset16 inputClassDefOffset + Offset16 lookaheadClassDefOffset | Offset16 classDefOffset] + uint16 setCount
    const CHAINED_FORMAT_2_PREFIX_SIZE = 12;
    const FORMAT_2_PREFIX_SIZE = 8;
    const prefixSize = chained
      ? CHAINED_FORMAT_2_PREFIX_SIZE
      : FORMAT_2_PREFIX_SIZE;
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
    // Within the chained layout, inputClassDefOffset follows backtrackClassDefOffset (at SUBST_FORMAT_AND_COVERAGE_SIZE); within the plain layout, classDefOffset (read into inputClassDef below) sits at SUBST_FORMAT_AND_COVERAGE_SIZE directly.
    const CHAINED_FORMAT_2_INPUT_CLASS_DEF_OFFSET = 6;
    const inputClassDefOffset = chained
      ? u16(bytes, subtableOffset + CHAINED_FORMAT_2_INPUT_CLASS_DEF_OFFSET)
      : u16(bytes, subtableOffset + SUBST_FORMAT_AND_COVERAGE_SIZE);
    const inputClassDef =
      inputClassDefOffset === 0
        ? constantZeroClassDef
        : parseClassDef(bytes, subtableOffset + inputClassDefOffset);
    const readAuxClassDef = (offset: number): ClassDefTable | undefined =>
      offset === 0
        ? constantZeroClassDef
        : parseClassDef(bytes, subtableOffset + offset);
    const backtrackClassDef = chained
      ? readAuxClassDef(
          u16(bytes, subtableOffset + SUBST_FORMAT_AND_COVERAGE_SIZE),
        )
      : constantZeroClassDef;
    const CHAINED_FORMAT_2_LOOKAHEAD_CLASS_DEF_OFFSET = 8;
    const lookaheadClassDef = chained
      ? readAuxClassDef(
          u16(
            bytes,
            subtableOffset + CHAINED_FORMAT_2_LOOKAHEAD_CLASS_DEF_OFFSET,
          ),
        )
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
