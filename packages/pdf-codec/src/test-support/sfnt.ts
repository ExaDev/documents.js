// Hand-built sfnt (TrueType/OpenType) fixtures: a table directory wrapping whichever synthetic tables a test needs, plus emitters for the two tables a font's own built-in encoding is recovered through — 'cmap' (character code -> glyph ID) and 'post' (glyph ID -> glyph name). Built by literal byte layout against ISO/IEC 14496-22, deliberately importing nothing from this package's own sfnt readers, so a reader bug cannot cancel itself out against a fixture built by the same code.

import {
  CMAP_ENCODING_RECORD_OFFSET_FIELD,
  CMAP_FORMAT_4,
  type CMAP_FORMAT_6,
  CMAP_FORMAT_12,
  CMAP_TABLE_HEADER_SIZE,
  CMAP_ENCODING_RECORD_SIZE,
} from "./sfnt-cmap";
import {
  buildFormat0,
  buildFormat12,
  buildFormat4,
  buildFormat6,
} from "./sfnt-cmap";

const DIRECTORY_HEADER_SIZE = 12;
const RECORD_SIZE = 16;
const SFNT_VERSION_TRUETYPE = 0x00010000;
// The sfnt table directory header's own numTables field offset (spec clause 5.1.1: sfntVersion is 4 bytes, numTables follows at 4).
const SFNT_NUM_TABLES_OFFSET = 4;
// A table record's own offset and length field offsets (spec clause 5.1.1: tag 4 bytes, checkSum 4 bytes at 4, offset 4 bytes at 8, length 4 bytes at 12).
const TABLE_RECORD_OFFSET_FIELD = 8;
const TABLE_RECORD_LENGTH_FIELD = 12;

export function buildSfnt(
  tables: ReadonlyMap<string, Uint8Array<ArrayBuffer>>,
): Uint8Array<ArrayBuffer> {
  const entries = [...tables.entries()];
  const directorySize = DIRECTORY_HEADER_SIZE + entries.length * RECORD_SIZE;
  const totalLength = entries.reduce(
    (total, [, bytes]) => total + bytes.length,
    directorySize,
  );
  const font = new Uint8Array(totalLength);
  const view = new DataView(font.buffer);
  view.setUint32(0, SFNT_VERSION_TRUETYPE);
  view.setUint16(SFNT_NUM_TABLES_OFFSET, entries.length);
  let offset = directorySize;
  entries.forEach(([tag, bytes], index) => {
    const recordOffset = DIRECTORY_HEADER_SIZE + index * RECORD_SIZE;
    font.set(new TextEncoder().encode(tag), recordOffset);
    view.setUint32(recordOffset + TABLE_RECORD_OFFSET_FIELD, offset);
    view.setUint32(recordOffset + TABLE_RECORD_LENGTH_FIELD, bytes.length);
    font.set(bytes, offset);
    offset += bytes.length;
  });
  return font;
}

// One 'cmap' subtable: the platform/encoding pair identifying what its codes mean, the subtable format to emit it in, and the code -> glyph ID mapping itself.
export interface CmapSubtableSpec {
  readonly platformId: number;
  readonly encodingId: number;
  readonly format:
    0 | typeof CMAP_FORMAT_4 | typeof CMAP_FORMAT_6 | typeof CMAP_FORMAT_12;
  readonly mappings: ReadonlyMap<number, number>;
}

// Format 0 header: format(2) + length(2) + language(2) = 6 bytes, immediately followed by the 256-entry glyphIdArray (clause 5.2.4).

export function buildCmapTable(
  subtables: readonly CmapSubtableSpec[],
): Uint8Array<ArrayBuffer> {
  const encoded = subtables.map((spec) => ({
    spec,
    bytes:
      spec.format === 0
        ? buildFormat0(spec.mappings)
        : spec.format === CMAP_FORMAT_4
          ? buildFormat4(spec.mappings)
          : spec.format === CMAP_FORMAT_12
            ? buildFormat12(spec.mappings)
            : buildFormat6(spec.mappings),
  }));
  const headerSize =
    CMAP_TABLE_HEADER_SIZE + subtables.length * CMAP_ENCODING_RECORD_SIZE;
  const total = encoded.reduce(
    (sum, { bytes }) => sum + bytes.length,
    headerSize,
  );
  const table = new Uint8Array(total);
  const view = new DataView(table.buffer);
  view.setUint16(2, subtables.length);
  let offset = headerSize;
  encoded.forEach(({ spec, bytes }, index) => {
    const recordOffset =
      CMAP_TABLE_HEADER_SIZE + index * CMAP_ENCODING_RECORD_SIZE;
    view.setUint16(recordOffset, spec.platformId);
    view.setUint16(recordOffset + 2, spec.encodingId);
    view.setUint32(recordOffset + CMAP_ENCODING_RECORD_OFFSET_FIELD, offset);
    table.set(bytes, offset);
    offset += bytes.length;
  });
  return table;
}

// 'post' table version numbers (16.16 fixed-point, clause 5.2.9): version 2.0 names every glyph explicitly; version 3.0 carries no glyph names at all.
const POST_VERSION_2_0 = 0x00020000;
const POST_VERSION_3_0 = 0x00030000;
const POST_HEADER_SIZE = 32;
const POST_MAC_STANDARD_NAME_COUNT = 258;

// A version 2.0 'post' table (clause 5.2.9) naming every glyph explicitly: each glyph's index points past the 258 standard Macintosh names into this table's own Pascal-string array. An empty name leaves that glyph pointing at the standard `.notdef` instead.
export function buildPostV2Table(
  glyphNames: readonly string[],
): Uint8Array<ArrayBuffer> {
  const custom = glyphNames.filter((name) => name !== "");
  const stringBytes = custom.flatMap((name) => [
    name.length,
    ...[...name].map((character) => character.charCodeAt(0)),
  ]);
  const table = new Uint8Array(
    POST_HEADER_SIZE + 2 + glyphNames.length * 2 + stringBytes.length,
  );
  const view = new DataView(table.buffer);
  view.setUint32(0, POST_VERSION_2_0);
  view.setUint16(POST_HEADER_SIZE, glyphNames.length);
  let customIndex = 0;
  glyphNames.forEach((name, glyphId) => {
    const index =
      name === "" ? 0 : POST_MAC_STANDARD_NAME_COUNT + customIndex++;
    view.setUint16(POST_HEADER_SIZE + 2 + glyphId * 2, index);
  });
  table.set(
    Uint8Array.from(stringBytes),
    POST_HEADER_SIZE + 2 + glyphNames.length * 2,
  );
  return table;
}

// A version 3.0 'post' table: the header alone, declaring that the font carries no glyph names at all — what a subsetting tool emits when it strips them, and the case a reader must recover a glyph's identity some other way for.
export function buildPostV3Table(): Uint8Array<ArrayBuffer> {
  const table = new Uint8Array(POST_HEADER_SIZE);
  new DataView(table.buffer).setUint32(0, POST_VERSION_3_0);
  return table;
}
// ---- OpenType Layout common structures and the 'GSUB'/'GDEF' tables ----
//
// The emitters below exist for gsub-table.test.ts and gdef-table.test.ts: the vendored Carlito/Caladea faces exercise only part of the GSUB lookup matrix (Chaining Contextual format 3, Single and Ligature Substitution), and a reader whose only tests come from fonts that happen to ship one format is a reader whose format 1/2 paths are untested. Every table is laid out by literal bytes against the spec, never assembled through this package's own readers, so a reader bug cannot cancel itself out against a fixture built by the same code — the discipline the cmap/post emitters above state.

// A fixed-layout byte builder: every GSUB structure is a sequence of uint16s with computed offset slots, and spelling each write as setU16(at, value) keeps the byte arithmetic auditable against the spec's own tables.
class TableBuilder {
  readonly bytes: Uint8Array<ArrayBuffer>;
  private readonly view: DataView;
  constructor(length: number) {
    this.bytes = new Uint8Array(length);
    this.view = new DataView(this.bytes.buffer);
  }
  setU16(at: number, value: number): this {
    this.view.setUint16(at, value);
    return this;
  }
  setU32(at: number, value: number): this {
    this.view.setUint32(at, value);
    return this;
  }
  put(at: number, bytes: Uint8Array): this {
    this.bytes.set(bytes, at);
    return this;
  }
}

// Assembles a container of the shape [uint16 count][Offset16 per blob][blobs], offsets measured from the container's own start — the shape every GSUB rule set, ligature set, and the LookupList itself uses.
function buildOffsetTableContainer(
  blobs: readonly Uint8Array[],
): Uint8Array<ArrayBuffer> {
  const container = new Uint8Array(
    2 + blobs.length * 2 + blobs.reduce((n, blob) => n + blob.length, 0),
  );
  const view = new DataView(container.buffer);
  view.setUint16(0, blobs.length);
  let at = 2 + blobs.length * 2;
  blobs.forEach((blob, index) => {
    view.setUint16(2 + index * 2, at);
    container.set(blob, at);
    at += blob.length;
  });
  return container;
}

// Shared byte-layout shapes used across many GSUB/GDEF subtable formats below: a plain two-field header (format(2) + count(2), or equivalently any other pair of uint16 fields before an array starts), and a plain three-field header or record (three uint16 fields in a row, e.g. start/end/value).
const U16_HEADER_SIZE = 4;
const U16_TRIPLE_SIZE = 6;
// The third field's own offset within a U16_TRIPLE_SIZE header/record (the first two fields occupy offsets 0 and 2).
const U16_TRIPLE_THIRD_FIELD_OFFSET = 4;
// Contextual / Chaining Contextual Substitution format 3's own format number.
const CONTEXT_FORMAT_3 = 3;

// Coverage format 1: an ascending glyph list.
export function buildCoverageFormat1(
  glyphIds: readonly number[],
): Uint8Array<ArrayBuffer> {
  const sorted = [...glyphIds].sort((a, b) => a - b);
  const table = new TableBuilder(U16_HEADER_SIZE + sorted.length * 2);
  table.setU16(0, 1).setU16(2, sorted.length);
  sorted.forEach((glyphId, index) => {
    table.setU16(U16_HEADER_SIZE + index * 2, glyphId);
  });
  return table.bytes;
}

// Coverage format 2: start/end ranges, each carrying the coverage index of its FIRST glyph — the running count of glyphs the earlier ranges covered, which the caller must not have to compute.
export function buildCoverageFormat2(
  ranges: readonly (readonly [number, number])[],
): Uint8Array<ArrayBuffer> {
  const table = new TableBuilder(
    U16_HEADER_SIZE + ranges.length * U16_TRIPLE_SIZE,
  );
  table.setU16(0, 2).setU16(2, ranges.length);
  let coverageIndex = 0;
  ranges.forEach(([start, end], index) => {
    table
      .setU16(U16_HEADER_SIZE + index * U16_TRIPLE_SIZE, start)
      .setU16(U16_HEADER_SIZE + index * U16_TRIPLE_SIZE + 2, end)
      .setU16(
        U16_HEADER_SIZE +
          index * U16_TRIPLE_SIZE +
          U16_TRIPLE_THIRD_FIELD_OFFSET,
        coverageIndex,
      );
    coverageIndex += end - start + 1;
  });
  return table.bytes;
}

// ClassDef format 1: one contiguous glyph run with an explicit class each.
export function buildClassDefFormat1(
  startGlyphId: number,
  classes: readonly number[],
): Uint8Array<ArrayBuffer> {
  const table = new TableBuilder(U16_TRIPLE_SIZE + classes.length * 2);
  table
    .setU16(0, 1)
    .setU16(2, startGlyphId)
    .setU16(U16_TRIPLE_THIRD_FIELD_OFFSET, classes.length);
  classes.forEach((klass, index) => {
    table.setU16(U16_TRIPLE_SIZE + index * 2, klass);
  });
  return table.bytes;
}

// ClassDef format 2: start/end ranges, one class per range.
export function buildClassDefFormat2(
  ranges: readonly (readonly [number, number, number])[],
): Uint8Array<ArrayBuffer> {
  const table = new TableBuilder(
    U16_HEADER_SIZE + ranges.length * U16_TRIPLE_SIZE,
  );
  table.setU16(0, 2).setU16(2, ranges.length);
  ranges.forEach(([start, end, klass], index) => {
    table
      .setU16(U16_HEADER_SIZE + index * U16_TRIPLE_SIZE, start)
      .setU16(U16_HEADER_SIZE + index * U16_TRIPLE_SIZE + 2, end)
      .setU16(
        U16_HEADER_SIZE +
          index * U16_TRIPLE_SIZE +
          U16_TRIPLE_THIRD_FIELD_OFFSET,
        klass,
      );
  });
  return table.bytes;
}

// Single Substitution format 2: each covered glyph to its own substitute, substitutes in coverage order (the pairs are sorted by covered glyph here, which IS coverage order).
export function buildSingleSubstFormat2(
  mappings: readonly (readonly [number, number])[],
): Uint8Array<ArrayBuffer> {
  const sorted = [...mappings].sort((a, b) => a[0] - b[0]);
  const coverage = buildCoverageFormat1(sorted.map(([from]) => from));
  const substitutesAt = U16_TRIPLE_SIZE + sorted.length * 2;
  const table = new TableBuilder(substitutesAt + coverage.length);
  table
    .setU16(0, 2)
    .setU16(2, substitutesAt)
    .setU16(U16_TRIPLE_THIRD_FIELD_OFFSET, sorted.length);
  sorted.forEach(([, to], index) => {
    table.setU16(U16_TRIPLE_SIZE + index * 2, to);
  });
  return table.put(substitutesAt, coverage).bytes;
}

// One Ligature record: the ligature glyph, the component count (first included), the remaining components.
function buildLigatureRecord(
  ligatureGlyph: number,
  components: readonly number[],
): Uint8Array<ArrayBuffer> {
  const table = new TableBuilder(U16_HEADER_SIZE + components.length * 2);
  table.setU16(0, ligatureGlyph).setU16(2, components.length + 1);
  components.forEach((component, index) => {
    table.setU16(U16_HEADER_SIZE + index * 2, component);
  });
  return table.bytes;
}

// Ligature Substitution format 1: coverage over each set's first glyph, one LigatureSet per first glyph (a set's records list the components AFTER the first).
export interface GsubLigatureSpec {
  readonly firstGlyph: number;
  readonly ligatures: readonly {
    readonly ligatureGlyph: number;
    readonly components: readonly number[];
  }[];
}

export function buildLigatureSubstFormat1(
  sets: readonly GsubLigatureSpec[],
): Uint8Array<ArrayBuffer> {
  const sorted = [...sets].sort((a, b) => a.firstGlyph - b.firstGlyph);
  const coverage = buildCoverageFormat1(sorted.map((set) => set.firstGlyph));
  const ligSets = sorted.map((set) =>
    buildOffsetTableContainer(
      set.ligatures.map((ligature) =>
        buildLigatureRecord(ligature.ligatureGlyph, ligature.components),
      ),
    ),
  );
  const coverageAt = U16_TRIPLE_SIZE + ligSets.length * 2;
  let at = coverageAt + coverage.length;
  const setOffsets = ligSets.map((ligSet) => {
    const offset = at;
    at += ligSet.length;
    return offset;
  });
  const table = new TableBuilder(at);
  table
    .setU16(0, 1)
    .setU16(2, coverageAt)
    .setU16(U16_TRIPLE_THIRD_FIELD_OFFSET, ligSets.length);
  setOffsets.forEach((offset, index) => {
    table.setU16(U16_TRIPLE_SIZE + index * 2, offset);
  });
  table.put(coverageAt, coverage);
  ligSets.forEach((ligSet, index) => {
    table.put(setOffsets[index]!, ligSet);
  });
  return table.bytes;
}

// One SubstLookupRecord as the contextual builders state it.
export interface GsubRecordSpec {
  readonly sequenceIndex: number;
  readonly lookupIndex: number;
}

// A SubstLookupRecord is two uint16 fields (sequenceIndex, lookupIndex): the same two-field shape as U16_HEADER_SIZE, reused here as a per-record size.
const SUBST_LOOKUP_RECORD_SIZE = 4;

function buildRecords(
  records: readonly GsubRecordSpec[],
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(records.length * SUBST_LOOKUP_RECORD_SIZE);
  const view = new DataView(bytes.buffer);
  records.forEach((record, index) => {
    view.setUint16(index * SUBST_LOOKUP_RECORD_SIZE, record.sequenceIndex);
    view.setUint16(index * SUBST_LOOKUP_RECORD_SIZE + 2, record.lookupIndex);
  });
  return bytes;
}

// A plain (non-chaining) SequenceRule body: glyphCount+input (glyphCount includes the implied first glyph, so the caller lists only the components after it), then substCount+records. The Contextual Substitution format carries no backtrack or lookahead fields at all, so this writes only what format 1/2 lookups ever need.
function buildSequenceRuleBytes(
  rule: { readonly input: readonly number[] },
  records: readonly GsubRecordSpec[],
): Uint8Array<ArrayBuffer> {
  const words = 1 + rule.input.length + 1 + records.length * 2;
  const table = new TableBuilder(words * 2);
  table.setU16(0, rule.input.length + 1);
  let cursor = 2;
  rule.input.forEach((value) => {
    table.setU16(cursor, value);
    cursor += 2;
  });
  table.setU16(cursor, records.length);
  table.put(cursor + 2, buildRecords(records));
  return table.bytes;
}

// A ChainSequenceRule body: backtrack count+values, input count+values (glyphCount includes the implied first glyph, so the caller lists only the components after it), lookahead count+values, then substCount+records.
function buildChainSequenceRuleBytes(
  rule: {
    readonly backtrack: readonly number[];
    readonly input: readonly number[];
    readonly lookahead: readonly number[];
  },
  records: readonly GsubRecordSpec[],
): Uint8Array<ArrayBuffer> {
  const words =
    1 +
    rule.backtrack.length +
    1 +
    rule.input.length +
    1 +
    rule.lookahead.length +
    1 +
    records.length * 2;
  const table = new TableBuilder(words * 2);
  // Writes a plain count+values array (backtrack, lookahead) starting at `at`, returning the offset just past it.
  const putArray = (at: number, values: readonly number[]): number => {
    table.setU16(at, values.length);
    let cursor = at + 2;
    values.forEach((value) => {
      table.setU16(cursor, value);
      cursor += 2;
    });
    return cursor;
  };
  const afterBacktrack = putArray(0, rule.backtrack);
  table.setU16(afterBacktrack, rule.input.length + 1);
  let cursor = afterBacktrack + 2;
  rule.input.forEach((value) => {
    table.setU16(cursor, value);
    cursor += 2;
  });
  const afterLookahead = putArray(cursor, rule.lookahead);
  table.setU16(afterLookahead, records.length);
  table.put(afterLookahead + 2, buildRecords(records));
  return table.bytes;
}

export interface GsubContextRuleSpec {
  readonly backtrack: readonly number[];
  readonly input: readonly number[];
  readonly lookahead: readonly number[];
  readonly records: readonly GsubRecordSpec[];
}

// The shared body of the four format 1/2 subtable builders: a header the caller writes through a callback (each format's field layout differs), an offset array over rule sets, the auxiliary blobs (coverage, class defs) the header points at, and the rule sets — every offset measured from the subtable start.
function assembleRuleSetSubtable(
  headerSize: number,
  writeHeader: (builder: TableBuilder, blobOffsets: readonly number[]) => void,
  blobs: readonly Uint8Array[],
  ruleSets: readonly (readonly Uint8Array[])[],
): Uint8Array<ArrayBuffer> {
  const blobRegionAt = headerSize + ruleSets.length * 2;
  const blobOffsets: number[] = [];
  let blobAt = blobRegionAt;
  for (const blob of blobs) {
    blobOffsets.push(blobAt);
    blobAt += blob.length;
  }
  const assembledSets = ruleSets.map((rules) =>
    buildOffsetTableContainer(rules),
  );
  let setAt = blobAt;
  const setOffsets: number[] = [];
  for (const set of assembledSets) {
    setOffsets.push(setAt);
    setAt += set.length;
  }
  const table = new TableBuilder(setAt);
  writeHeader(table, blobOffsets);
  blobs.forEach((blob, index) => {
    table.put(blobOffsets[index]!, blob);
  });
  setOffsets.forEach((offset, index) => {
    table.setU16(headerSize + index * 2, offset);
    table.put(offset, assembledSets[index]!);
  });
  return table.bytes;
}

// Header sizes and field offsets for the four assembleRuleSetSubtable callers below (format N, then N-1 further uint16 offset/count fields, per each format's own layout).
const CONTEXT_FORMAT2_HEADER_SIZE = 8;
const CONTEXT_FORMAT2_COUNT_OFFSET = 6;
const CHAIN_CONTEXT2_HEADER_SIZE = 12;
const CHAIN_CONTEXT2_INPUT_OFFSET = 6;
const CHAIN_CONTEXT2_LOOKAHEAD_OFFSET = 8;
const CHAIN_CONTEXT2_COUNT_OFFSET = 10;

// Contextual Substitution format 1: coverage over rule-set first glyphs; each rule lists input glyph ids (after the first) and records.
export function buildContextFormat1(
  firstGlyphs: readonly number[],
  ruleSets: readonly (readonly {
    readonly input: readonly number[];
    readonly records: readonly GsubRecordSpec[];
  }[])[],
): Uint8Array<ArrayBuffer> {
  return assembleRuleSetSubtable(
    U16_TRIPLE_SIZE,
    (table, [coverageAt]) => {
      table
        .setU16(0, 1)
        .setU16(2, coverageAt!)
        .setU16(U16_TRIPLE_THIRD_FIELD_OFFSET, ruleSets.length);
    },
    [buildCoverageFormat1(firstGlyphs)],
    ruleSets.map((rules) =>
      rules.map((rule) =>
        buildSequenceRuleBytes({ input: rule.input }, rule.records),
      ),
    ),
  );
}

// Contextual Substitution format 2: rule sets indexed by the entry glyph's class; each rule lists input classes (after the first) and records.
export function buildContextFormat2(
  firstGlyphs: readonly number[],
  classDef: Uint8Array,
  ruleSetsByClass: readonly (readonly {
    readonly input: readonly number[];
    readonly records: readonly GsubRecordSpec[];
  }[])[],
): Uint8Array<ArrayBuffer> {
  return assembleRuleSetSubtable(
    CONTEXT_FORMAT2_HEADER_SIZE,
    (table, [coverageAt, classDefAt]) => {
      table
        .setU16(0, 2)
        .setU16(2, coverageAt!)
        .setU16(U16_TRIPLE_THIRD_FIELD_OFFSET, classDefAt!)
        .setU16(CONTEXT_FORMAT2_COUNT_OFFSET, ruleSetsByClass.length);
    },
    [buildCoverageFormat1(firstGlyphs), classDef],
    ruleSetsByClass.map((rules) =>
      rules.map((rule) =>
        buildSequenceRuleBytes({ input: rule.input }, rule.records),
      ),
    ),
  );
}

// Chaining Contextual Substitution format 1: coverage over rule-set first glyphs; each rule lists backtrack and lookahead glyph ids around the input components.
export function buildChainContextFormat1(
  firstGlyphs: readonly number[],
  ruleSets: readonly (readonly GsubContextRuleSpec[])[],
): Uint8Array<ArrayBuffer> {
  return assembleRuleSetSubtable(
    U16_TRIPLE_SIZE,
    (table, [coverageAt]) => {
      table
        .setU16(0, 1)
        .setU16(2, coverageAt!)
        .setU16(U16_TRIPLE_THIRD_FIELD_OFFSET, ruleSets.length);
    },
    [buildCoverageFormat1(firstGlyphs)],
    ruleSets.map((rules) =>
      rules.map((rule) => buildChainSequenceRuleBytes(rule, rule.records)),
    ),
  );
}

// Chaining Contextual Substitution format 2: rule sets indexed by the entry glyph's input class; backtrack and lookahead positions test against their own class defs.
export function buildChainContextFormat2(
  firstGlyphs: readonly number[],
  classDefs: {
    readonly backtrack: Uint8Array;
    readonly input: Uint8Array;
    readonly lookahead: Uint8Array;
  },
  ruleSetsByClass: readonly (readonly GsubContextRuleSpec[])[],
): Uint8Array<ArrayBuffer> {
  return assembleRuleSetSubtable(
    CHAIN_CONTEXT2_HEADER_SIZE,
    (table, [coverageAt, backtrackAt, inputAt, lookaheadAt]) => {
      table
        .setU16(0, 2)
        .setU16(2, coverageAt!)
        .setU16(U16_TRIPLE_THIRD_FIELD_OFFSET, backtrackAt!)
        .setU16(CHAIN_CONTEXT2_INPUT_OFFSET, inputAt!)
        .setU16(CHAIN_CONTEXT2_LOOKAHEAD_OFFSET, lookaheadAt!)
        .setU16(CHAIN_CONTEXT2_COUNT_OFFSET, ruleSetsByClass.length);
    },
    [
      buildCoverageFormat1(firstGlyphs),
      classDefs.backtrack,
      classDefs.input,
      classDefs.lookahead,
    ],
    ruleSetsByClass.map((rules) =>
      rules.map((rule) => buildChainSequenceRuleBytes(rule, rule.records)),
    ),
  );
}

// Contextual / Chaining Contextual format 3: one rule whose sequences are coverage tables. Each glyph list becomes a Coverage format 1 table; the layout is the count+offsets array per sequence (the plain form carries input only).
export function buildFormat3Subtable(
  chained: boolean,
  sequences: {
    readonly backtrack: readonly (readonly number[])[];
    readonly input: readonly (readonly number[])[];
    readonly lookahead: readonly (readonly number[])[];
    readonly records: readonly GsubRecordSpec[];
  },
): Uint8Array<ArrayBuffer> {
  const backtrack = sequences.backtrack.map(buildCoverageFormat1);
  const input = sequences.input.map(buildCoverageFormat1);
  const lookahead = sequences.lookahead.map(buildCoverageFormat1);
  const records = buildRecords(sequences.records);
  const fixedSize =
    2 +
    (chained ? 2 + backtrack.length * 2 : 0) +
    2 +
    input.length * 2 +
    (chained ? 2 + lookahead.length * 2 : 0) +
    2 +
    records.length;
  const blobs = [...backtrack, ...input, ...lookahead];
  const table = new TableBuilder(
    fixedSize + blobs.reduce((n, blob) => n + blob.length, 0),
  );
  let fixedAt = 2;
  let blobAt = fixedSize;
  table.setU16(0, CONTEXT_FORMAT_3);
  const putCoverageArray = (coverages: readonly Uint8Array[]): void => {
    table.setU16(fixedAt, coverages.length);
    fixedAt += 2;
    for (const coverage of coverages) {
      table.setU16(fixedAt, blobAt);
      fixedAt += 2;
      table.put(blobAt, coverage);
      blobAt += coverage.length;
    }
  };
  if (chained) {
    putCoverageArray(backtrack);
    putCoverageArray(input);
    putCoverageArray(lookahead);
  } else {
    // the plain form is the one count+offsets section the chained form generalises: glyphCount where a chained section's own count sits, then the input offsets
    putCoverageArray(input);
  }
  table.setU16(fixedAt, sequences.records.length);
  table.put(fixedAt + 2, records);
  return table.bytes;
}

// Extension Substitution format 1 wrapping a subtable of another lookup type.
// ExtensionSubstFormat1 header: format(2) + extensionLookupType(2) + extensionOffset(4, always pointing right past this fixed header) = 8 bytes.
const EXTENSION_SUBST_HEADER_SIZE = 8;

export function buildExtensionSubst(
  wrappedLookupType: number,
  wrapped: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const table = new TableBuilder(EXTENSION_SUBST_HEADER_SIZE + wrapped.length);
  table
    .setU16(0, 1)
    .setU16(2, wrappedLookupType)
    .setU32(U16_TRIPLE_THIRD_FIELD_OFFSET, EXTENSION_SUBST_HEADER_SIZE);
  return table.put(EXTENSION_SUBST_HEADER_SIZE, wrapped).bytes;
}

// One lookup: type, flag, an optional trailing markFilteringSet (written exactly when the flag selects one, per the Lookup table layout), and its subtables.
export interface GsubLookupSpec {
  readonly type: number;
  readonly flag?: number;
  readonly markFilteringSet?: number;
  readonly subtables: readonly Uint8Array[];
}

export interface GsubFeatureSpec {
  readonly tag: string;
  readonly lookupIndices: readonly number[];
}

// LangSys's own "no required feature" sentinel (spec: 0xFFFF means the script has no required feature).
const LANG_SYS_NO_REQUIRED_FEATURE = 0xffff;
// ScriptList header: scriptCount(2) + one ScriptRecord's tag(4) + offset(2) = 8 bytes, for the single 'latn' script this builder always emits.
const SCRIPT_LIST_HEADER_SIZE = 8;
const SCRIPT_RECORD_OFFSET_FIELD_POSITION = 6;
// The 'latn' script tag's own two big-endian uint16 halves.
const LATN_TAG_HIGH = 0x6c61; // 'la'
const LATN_TAG_LOW = 0x746e; // 'tn'
// A FeatureRecord is a 4-byte tag plus a 2-byte offset = 6 bytes; the offset field sits right after the tag.
const FEATURE_RECORD_SIZE = 6;
const FEATURE_RECORD_OFFSET_FIELD = 4;
// Lookup Flag bit 4 (spec, LookupFlag enumeration): set when a trailing markFilteringSet index follows the subtable offset array.
const LOOKUP_FLAG_USE_MARK_FILTERING_SET = 0x0010;
// The GSUB table's own header: majorVersion(2) + minorVersion(2) + scriptListOffset(2) + featureListOffset(2) + lookupListOffset(2) = 10 bytes.
const GSUB_HEADER_SIZE = 10;
const GSUB_FEATURE_LIST_OFFSET_FIELD = 6;
const GSUB_LOOKUP_LIST_OFFSET_FIELD = 8;

// A whole 'GSUB' table: one 'latn' script whose default LangSys enables every feature, a feature list in the order given, and a lookup list.
export function buildGsubTable(
  features: readonly GsubFeatureSpec[],
  lookups: readonly GsubLookupSpec[],
): Uint8Array<ArrayBuffer> {
  const langSys = new TableBuilder(U16_TRIPLE_SIZE + features.length * 2);
  langSys
    .setU16(0, 0)
    .setU16(2, LANG_SYS_NO_REQUIRED_FEATURE)
    .setU16(U16_TRIPLE_THIRD_FIELD_OFFSET, features.length);
  features.forEach((_, index) => {
    langSys.setU16(U16_TRIPLE_SIZE + index * 2, index);
  });
  const script = new TableBuilder(U16_HEADER_SIZE + langSys.bytes.length);
  script
    .setU16(0, U16_HEADER_SIZE)
    .setU16(2, 0)
    .put(U16_HEADER_SIZE, langSys.bytes);
  const scriptList = new TableBuilder(
    SCRIPT_LIST_HEADER_SIZE + script.bytes.length,
  );
  scriptList
    .setU16(0, 1)
    .setU16(2, LATN_TAG_HIGH)
    .setU16(U16_TRIPLE_THIRD_FIELD_OFFSET, LATN_TAG_LOW)
    .setU16(SCRIPT_RECORD_OFFSET_FIELD_POSITION, SCRIPT_LIST_HEADER_SIZE)
    .put(SCRIPT_LIST_HEADER_SIZE, script.bytes);
  const featureTables = features.map((feature) => {
    const table = new TableBuilder(
      U16_HEADER_SIZE + feature.lookupIndices.length * 2,
    );
    table.setU16(0, 0).setU16(2, feature.lookupIndices.length);
    feature.lookupIndices.forEach((lookupIndex, index) => {
      table.setU16(U16_HEADER_SIZE + index * 2, lookupIndex);
    });
    return table.bytes;
  });
  const featureListSize =
    2 +
    features.length * FEATURE_RECORD_SIZE +
    featureTables.reduce((n, t) => n + t.length, 0);
  const featureList = new TableBuilder(featureListSize);
  featureList.setU16(0, features.length);
  let featureTableAt = 2 + features.length * FEATURE_RECORD_SIZE;
  features.forEach((feature, index) => {
    featureList.bytes.set(
      new TextEncoder().encode(feature.tag),
      2 + index * FEATURE_RECORD_SIZE,
    );
    featureList
      .setU16(
        2 + index * FEATURE_RECORD_SIZE + FEATURE_RECORD_OFFSET_FIELD,
        featureTableAt,
      )
      .put(featureTableAt, featureTables[index]!);
    featureTableAt += featureTables[index]!.length;
  });
  const lookupTables = lookups.map((lookup) => {
    // No separate "is flag even defined" check is needed: JS's bitwise `&` coerces `undefined` to 0 before operating, so `undefined & 0x0010` is already 0 — exactly the same as explicitly treating an absent flag as clearing every bit.
    const markFilteringSetWidth =
      ((lookup.flag ?? 0) & LOOKUP_FLAG_USE_MARK_FILTERING_SET) !== 0 ? 2 : 0;
    // The Lookup table's own layout: a 6-byte header, the subtable offset array, then — only when the flag selects one — the trailing markFilteringSet index the flag's set number refers to.
    let at =
      U16_TRIPLE_SIZE + lookup.subtables.length * 2 + markFilteringSetWidth;
    const offsets = lookup.subtables.map((subtable) => {
      const offset = at;
      at += subtable.length;
      return offset;
    });
    const table = new TableBuilder(at);
    table
      .setU16(0, lookup.type)
      .setU16(2, lookup.flag ?? 0)
      .setU16(U16_TRIPLE_THIRD_FIELD_OFFSET, lookup.subtables.length);
    if (markFilteringSetWidth === 2) {
      table.setU16(
        U16_TRIPLE_SIZE + lookup.subtables.length * 2,
        lookup.markFilteringSet ?? 0,
      );
    }
    offsets.forEach((offset, index) => {
      table.setU16(U16_TRIPLE_SIZE + index * 2, offset);
      table.put(offset, lookup.subtables[index]!);
    });
    return table.bytes;
  });
  const lookupList = buildOffsetTableContainer(lookupTables);

  const featureListAt = GSUB_HEADER_SIZE + scriptList.bytes.length;
  const lookupListAt = featureListAt + featureList.bytes.length;
  const table = new TableBuilder(lookupListAt + lookupList.length);
  table.setU16(0, 1).setU16(2, 0);
  table
    .setU16(U16_TRIPLE_THIRD_FIELD_OFFSET, GSUB_HEADER_SIZE)
    .setU16(GSUB_FEATURE_LIST_OFFSET_FIELD, featureListAt)
    .setU16(GSUB_LOOKUP_LIST_OFFSET_FIELD, lookupListAt);
  table.put(GSUB_HEADER_SIZE, scriptList.bytes);
  table.put(featureListAt, featureList.bytes);
  table.put(lookupListAt, lookupList);
  return table.bytes;
}

// A MarkGlyphSetsDef Coverage offset is a 4-byte (Offset32) entry.
const MARK_GLYPH_SET_COVERAGE_OFFSET_SIZE = 4;
// 'GDEF' header sizes: version 1.0 is majorVersion(2) + minorVersion(2) + glyphClassDefOffset(2) + attachListOffset(2) + ligCaretListOffset(2) + markAttachClassDefOffset(2) = 12 bytes; version 1.2 adds a trailing markGlyphSetsDefOffset(2) = 14 bytes.
const GDEF_HEADER_SIZE_V1_0 = 12;
const GDEF_HEADER_SIZE_V1_2 = 14;
const GDEF_ATTACH_LIST_OFFSET_FIELD = 6;
const GDEF_LIG_CARET_LIST_OFFSET_FIELD = 8;
const GDEF_MARK_ATTACH_CLASS_DEF_OFFSET_FIELD = 10;
const GDEF_MARK_GLYPH_SETS_DEF_OFFSET_FIELD = 12;

// A 'GDEF' table: version 1.0 carrying the glyph-class and mark-attachment ClassDefs, or version 1.2 adding MarkGlyphSets (the coverage tables a useMarkFilteringSet flag selects between). AttachList and LigCaretList are always NULL — the reader under test ignores them.
export function buildGdefTable(classes: {
  readonly glyphClassDef?: Uint8Array;
  readonly markAttachClassDef?: Uint8Array;
  readonly markGlyphSets?: readonly Uint8Array[];
}): Uint8Array<ArrayBuffer> {
  const markGlyphSetsDef = classes.markGlyphSets
    ? ((sets: readonly Uint8Array[]) => {
        const defSize =
          U16_HEADER_SIZE +
          sets.length * MARK_GLYPH_SET_COVERAGE_OFFSET_SIZE +
          sets.reduce((n, s) => n + s.length, 0);
        const def = new TableBuilder(defSize);
        def.setU16(0, 1).setU16(2, sets.length);
        let at =
          U16_HEADER_SIZE + sets.length * MARK_GLYPH_SET_COVERAGE_OFFSET_SIZE;
        sets.forEach((coverage, index) => {
          def.setU32(
            U16_HEADER_SIZE + index * MARK_GLYPH_SET_COVERAGE_OFFSET_SIZE,
            at,
          );
          at += coverage.length;
        });
        at =
          U16_HEADER_SIZE + sets.length * MARK_GLYPH_SET_COVERAGE_OFFSET_SIZE;
        sets.forEach((coverage) => {
          def.put(at, coverage);
          at += coverage.length;
        });
        return def.bytes;
      })(classes.markGlyphSets)
    : undefined;
  const headerSize =
    markGlyphSetsDef === undefined
      ? GDEF_HEADER_SIZE_V1_0
      : GDEF_HEADER_SIZE_V1_2;
  const blobs = [
    classes.glyphClassDef,
    classes.markAttachClassDef,
    markGlyphSetsDef,
  ].filter((blob): blob is Uint8Array => blob !== undefined);
  const table = new TableBuilder(
    headerSize + blobs.reduce((n, blob) => n + blob.length, 0),
  );
  table.setU16(0, 1).setU16(2, markGlyphSetsDef === undefined ? 0 : 2);
  let blobAt = headerSize;
  const offsetOf = (blob: Uint8Array): number => {
    const offset = blobAt;
    table.put(blobAt, blob);
    blobAt += blob.length;
    return offset;
  };
  const glyphClassOffset =
    classes.glyphClassDef === undefined ? 0 : offsetOf(classes.glyphClassDef);
  const markAttachOffset =
    classes.markAttachClassDef === undefined
      ? 0
      : offsetOf(classes.markAttachClassDef);
  table
    .setU16(U16_TRIPLE_THIRD_FIELD_OFFSET, glyphClassOffset)
    .setU16(GDEF_ATTACH_LIST_OFFSET_FIELD, 0)
    .setU16(GDEF_LIG_CARET_LIST_OFFSET_FIELD, 0);
  table.setU16(GDEF_MARK_ATTACH_CLASS_DEF_OFFSET_FIELD, markAttachOffset);
  if (markGlyphSetsDef !== undefined) {
    // the MarkGlyphSetsDef offset slot arrives with minor version 2; its value was already placed by the blob walk above
    table.setU16(
      GDEF_MARK_GLYPH_SETS_DEF_OFFSET_FIELD,
      offsetOf(markGlyphSetsDef),
    );
  }
  return table.bytes;
}
