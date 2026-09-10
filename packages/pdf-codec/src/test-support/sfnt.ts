// Hand-built sfnt (TrueType/OpenType) fixtures: a table directory wrapping whichever synthetic tables a test needs, plus emitters for the two tables a font's own built-in encoding is recovered through -- 'cmap' (character code -> glyph ID) and 'post' (glyph ID -> glyph name). Built by literal byte layout against ISO/IEC 14496-22, deliberately importing nothing from this package's own sfnt readers, so a reader bug cannot cancel itself out against a fixture built by the same code.

const DIRECTORY_HEADER_SIZE = 12;
const RECORD_SIZE = 16;
const SFNT_VERSION_TRUETYPE = 0x00010000;

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
  view.setUint16(4, entries.length);
  let offset = directorySize;
  entries.forEach(([tag, bytes], index) => {
    const recordOffset = DIRECTORY_HEADER_SIZE + index * RECORD_SIZE;
    for (let i = 0; i < 4; i++) {
      font[recordOffset + i] = tag.charCodeAt(i);
    }
    view.setUint32(recordOffset + 8, offset);
    view.setUint32(recordOffset + 12, bytes.length);
    font.set(bytes, offset);
    offset += bytes.length;
  });
  return font;
}

// One 'cmap' subtable: the platform/encoding pair identifying what its codes mean, the subtable format to emit it in, and the code -> glyph ID mapping itself.
export interface CmapSubtableSpec {
  readonly platformId: number;
  readonly encodingId: number;
  readonly format: 0 | 4 | 6;
  readonly mappings: ReadonlyMap<number, number>;
}

// Format 0 (byte encoding table, clause 5.2.4): a fixed 256-entry glyph-ID array, so only codes 0..255 can appear.
function buildFormat0(mappings: ReadonlyMap<number, number>): Uint8Array {
  const subtable = new Uint8Array(262);
  const view = new DataView(subtable.buffer);
  view.setUint16(0, 0);
  view.setUint16(2, subtable.length);
  for (const [code, glyphId] of mappings) {
    subtable[6 + code] = glyphId;
  }
  return subtable;
}

// Format 4 (segment mapping to delta values): emitted as one single-code segment per mapping plus the mandatory 0xFFFF terminator, which is a legal -- if deliberately unoptimised -- encoding of any mapping and exercises the idDelta path rather than the glyph-index-array one.
function buildFormat4(mappings: ReadonlyMap<number, number>): Uint8Array {
  const codes = [...mappings.keys()].sort((a, b) => a - b);
  const segCount = codes.length + 1;
  const length = 16 + segCount * 8;
  const subtable = new Uint8Array(length);
  const view = new DataView(subtable.buffer);
  const searchRange = 2 * 2 ** Math.floor(Math.log2(segCount));
  view.setUint16(0, 4);
  view.setUint16(2, length);
  view.setUint16(6, segCount * 2);
  view.setUint16(8, searchRange);
  view.setUint16(10, Math.log2(searchRange / 2));
  view.setUint16(12, segCount * 2 - searchRange);
  const endCodes = 14;
  const startCodes = endCodes + segCount * 2 + 2;
  const idDeltas = startCodes + segCount * 2;
  codes.forEach((code, index) => {
    view.setUint16(endCodes + index * 2, code);
    view.setUint16(startCodes + index * 2, code);
    view.setUint16(
      idDeltas + index * 2,
      ((mappings.get(code) ?? 0) - code) & 0xffff,
    );
  });
  view.setUint16(endCodes + codes.length * 2, 0xffff);
  view.setUint16(startCodes + codes.length * 2, 0xffff);
  view.setUint16(idDeltas + codes.length * 2, 1);
  return subtable;
}

// Format 6 (trimmed table mapping): one contiguous run of codes with an explicit glyph ID each.
function buildFormat6(mappings: ReadonlyMap<number, number>): Uint8Array {
  const codes = [...mappings.keys()].sort((a, b) => a - b);
  const firstCode = codes[0] ?? 0;
  const entryCount = (codes[codes.length - 1] ?? 0) - firstCode + 1;
  const subtable = new Uint8Array(10 + entryCount * 2);
  const view = new DataView(subtable.buffer);
  view.setUint16(0, 6);
  view.setUint16(2, subtable.length);
  view.setUint16(6, firstCode);
  view.setUint16(8, entryCount);
  for (const [code, glyphId] of mappings) {
    view.setUint16(10 + (code - firstCode) * 2, glyphId);
  }
  return subtable;
}

export function buildCmapTable(
  subtables: readonly CmapSubtableSpec[],
): Uint8Array<ArrayBuffer> {
  const encoded = subtables.map((spec) =>
    spec.format === 0
      ? buildFormat0(spec.mappings)
      : spec.format === 4
        ? buildFormat4(spec.mappings)
        : buildFormat6(spec.mappings),
  );
  const headerSize = 4 + subtables.length * 8;
  const total = encoded.reduce((sum, bytes) => sum + bytes.length, headerSize);
  const table = new Uint8Array(total);
  const view = new DataView(table.buffer);
  view.setUint16(2, subtables.length);
  let offset = headerSize;
  subtables.forEach((spec, index) => {
    const recordOffset = 4 + index * 8;
    view.setUint16(recordOffset, spec.platformId);
    view.setUint16(recordOffset + 2, spec.encodingId);
    view.setUint32(recordOffset + 4, offset);
    const bytes = encoded[index];
    if (bytes === undefined) {
      throw new Error("cmap subtable was not encoded");
    }
    table.set(bytes, offset);
    offset += bytes.length;
  });
  return table;
}

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
  view.setUint32(0, 0x00020000);
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

// A version 3.0 'post' table: the header alone, declaring that the font carries no glyph names at all -- what a subsetting tool emits when it strips them, and the case a reader must recover a glyph's identity some other way for.
export function buildPostV3Table(): Uint8Array<ArrayBuffer> {
  const table = new Uint8Array(POST_HEADER_SIZE);
  new DataView(table.buffer).setUint32(0, 0x00030000);
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

// Coverage format 1: an ascending glyph list.
export function buildCoverageFormat1(
  glyphIds: readonly number[],
): Uint8Array<ArrayBuffer> {
  const sorted = [...glyphIds].sort((a, b) => a - b);
  const table = new TableBuilder(4 + sorted.length * 2);
  table.setU16(0, 1).setU16(2, sorted.length);
  sorted.forEach((glyphId, index) => table.setU16(4 + index * 2, glyphId));
  return table.bytes;
}

// Coverage format 2: start/end ranges, each carrying the coverage index of its FIRST glyph — the running count of glyphs the earlier ranges covered, which the caller must not have to compute.
export function buildCoverageFormat2(
  ranges: readonly (readonly [number, number])[],
): Uint8Array<ArrayBuffer> {
  const table = new TableBuilder(4 + ranges.length * 6);
  table.setU16(0, 2).setU16(2, ranges.length);
  let coverageIndex = 0;
  ranges.forEach(([start, end], index) => {
    table
      .setU16(4 + index * 6, start)
      .setU16(4 + index * 6 + 2, end)
      .setU16(4 + index * 6 + 4, coverageIndex);
    coverageIndex += end - start + 1;
  });
  return table.bytes;
}

// ClassDef format 1: one contiguous glyph run with an explicit class each.
export function buildClassDefFormat1(
  startGlyphId: number,
  classes: readonly number[],
): Uint8Array<ArrayBuffer> {
  const table = new TableBuilder(6 + classes.length * 2);
  table.setU16(0, 1).setU16(2, startGlyphId).setU16(4, classes.length);
  classes.forEach((klass, index) => table.setU16(6 + index * 2, klass));
  return table.bytes;
}

// ClassDef format 2: start/end ranges, one class per range.
export function buildClassDefFormat2(
  ranges: readonly (readonly [number, number, number])[],
): Uint8Array<ArrayBuffer> {
  const table = new TableBuilder(4 + ranges.length * 6);
  table.setU16(0, 2).setU16(2, ranges.length);
  ranges.forEach(([start, end, klass], index) => {
    table
      .setU16(4 + index * 6, start)
      .setU16(4 + index * 6 + 2, end)
      .setU16(4 + index * 6 + 4, klass);
  });
  return table.bytes;
}

// Single Substitution format 2: each covered glyph to its own substitute, substitutes in coverage order (the pairs are sorted by covered glyph here, which IS coverage order).
export function buildSingleSubstFormat2(
  mappings: readonly (readonly [number, number])[],
): Uint8Array<ArrayBuffer> {
  const sorted = [...mappings].sort((a, b) => a[0] - b[0]);
  const coverage = buildCoverageFormat1(sorted.map(([from]) => from));
  const substitutesAt = 6 + sorted.length * 2;
  const table = new TableBuilder(substitutesAt + coverage.length);
  table.setU16(0, 2).setU16(2, substitutesAt).setU16(4, sorted.length);
  sorted.forEach(([, to], index) => table.setU16(6 + index * 2, to));
  return table.put(substitutesAt, coverage).bytes;
}

// One Ligature record: the ligature glyph, the component count (first included), the remaining components.
function buildLigatureRecord(
  ligatureGlyph: number,
  components: readonly number[],
): Uint8Array<ArrayBuffer> {
  const table = new TableBuilder(4 + components.length * 2);
  table.setU16(0, ligatureGlyph).setU16(2, components.length + 1);
  components.forEach((component, index) =>
    table.setU16(4 + index * 2, component),
  );
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
  const coverageAt = 6 + ligSets.length * 2;
  let at = coverageAt + coverage.length;
  const setOffsets = ligSets.map((ligSet) => {
    const offset = at;
    at += ligSet.length;
    return offset;
  });
  const table = new TableBuilder(at);
  table.setU16(0, 1).setU16(2, coverageAt).setU16(4, ligSets.length);
  setOffsets.forEach((offset, index) => table.setU16(6 + index * 2, offset));
  table.put(coverageAt, coverage);
  ligSets.forEach((ligSet, index) => table.put(setOffsets[index]!, ligSet));
  return table.bytes;
}

// One SubstLookupRecord as the contextual builders state it.
export interface GsubRecordSpec {
  readonly sequenceIndex: number;
  readonly lookupIndex: number;
}

function buildRecords(
  records: readonly GsubRecordSpec[],
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(records.length * 4);
  const view = new DataView(bytes.buffer);
  records.forEach((record, index) => {
    view.setUint16(index * 4, record.sequenceIndex);
    view.setUint16(index * 4 + 2, record.lookupIndex);
  });
  return bytes;
}

// One (Chain)SequenceRule body: [chained] backtrack count+values, input count+values (glyphCount includes the implied first glyph, so the caller lists only the components after it), [chained] lookahead count+values, then substCount+records — the plain Contextual rule carries no backtrack or lookahead count fields at all, which is why `chained` gates them rather than an empty array doing it.
function buildSequenceRuleBytes(
  chained: boolean,
  rule: {
    readonly backtrack: readonly number[];
    readonly input: readonly number[];
    readonly lookahead: readonly number[];
  },
  records: readonly GsubRecordSpec[],
): Uint8Array<ArrayBuffer> {
  const words =
    1 +
    rule.input.length +
    1 +
    records.length * 2 +
    (chained ? 1 + rule.backtrack.length + 1 + rule.lookahead.length : 0);
  const table = new TableBuilder(words * 2);
  let at = 0;
  const putArray = (values: readonly number[]): void => {
    table.setU16(at, values.length);
    at += 2;
    values.forEach((value) => {
      table.setU16(at, value);
      at += 2;
    });
  };
  if (chained) {
    putArray(rule.backtrack);
  }
  table.setU16(at, rule.input.length + 1);
  at += 2;
  rule.input.forEach((value) => {
    table.setU16(at, value);
    at += 2;
  });
  if (chained) {
    putArray(rule.lookahead);
  }
  table.setU16(at, records.length);
  table.put(at + 2, buildRecords(records));
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
  blobs.forEach((blob, index) => table.put(blobOffsets[index]!, blob));
  setOffsets.forEach((offset, index) => {
    table.setU16(headerSize + index * 2, offset);
    table.put(offset, assembledSets[index]!);
  });
  return table.bytes;
}

// Contextual Substitution format 1: coverage over rule-set first glyphs; each rule lists input glyph ids (after the first) and records.
export function buildContextFormat1(
  firstGlyphs: readonly number[],
  ruleSets: readonly (readonly {
    readonly input: readonly number[];
    readonly records: readonly GsubRecordSpec[];
  }[])[],
): Uint8Array<ArrayBuffer> {
  return assembleRuleSetSubtable(
    6,
    (table, [coverageAt]) => {
      table.setU16(0, 1).setU16(2, coverageAt!).setU16(4, ruleSets.length);
    },
    [buildCoverageFormat1(firstGlyphs)],
    ruleSets.map((rules) =>
      rules.map((rule) =>
        buildSequenceRuleBytes(
          false,
          { backtrack: [], input: rule.input, lookahead: [] },
          rule.records,
        ),
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
    8,
    (table, [coverageAt, classDefAt]) => {
      table
        .setU16(0, 2)
        .setU16(2, coverageAt!)
        .setU16(4, classDefAt!)
        .setU16(6, ruleSetsByClass.length);
    },
    [buildCoverageFormat1(firstGlyphs), classDef],
    ruleSetsByClass.map((rules) =>
      rules.map((rule) =>
        buildSequenceRuleBytes(
          false,
          { backtrack: [], input: rule.input, lookahead: [] },
          rule.records,
        ),
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
    6,
    (table, [coverageAt]) => {
      table.setU16(0, 1).setU16(2, coverageAt!).setU16(4, ruleSets.length);
    },
    [buildCoverageFormat1(firstGlyphs)],
    ruleSets.map((rules) =>
      rules.map((rule) => buildSequenceRuleBytes(true, rule, rule.records)),
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
    12,
    (table, [coverageAt, backtrackAt, inputAt, lookaheadAt]) => {
      table
        .setU16(0, 2)
        .setU16(2, coverageAt!)
        .setU16(4, backtrackAt!)
        .setU16(6, inputAt!)
        .setU16(8, lookaheadAt!)
        .setU16(10, ruleSetsByClass.length);
    },
    [
      buildCoverageFormat1(firstGlyphs),
      classDefs.backtrack,
      classDefs.input,
      classDefs.lookahead,
    ],
    ruleSetsByClass.map((rules) =>
      rules.map((rule) => buildSequenceRuleBytes(true, rule, rule.records)),
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
  table.setU16(0, 3);
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
export function buildExtensionSubst(
  wrappedLookupType: number,
  wrapped: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const table = new TableBuilder(8 + wrapped.length);
  table.setU16(0, 1).setU16(2, wrappedLookupType).setU32(4, 8);
  return table.put(8, wrapped).bytes;
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

// A whole 'GSUB' table: one 'latn' script whose default LangSys enables every feature, a feature list in the order given, and a lookup list.
export function buildGsubTable(
  features: readonly GsubFeatureSpec[],
  lookups: readonly GsubLookupSpec[],
): Uint8Array<ArrayBuffer> {
  const langSys = new TableBuilder(6 + features.length * 2);
  langSys.setU16(0, 0).setU16(2, 0xffff).setU16(4, features.length);
  features.forEach((_, index) => langSys.setU16(6 + index * 2, index));
  const script = new TableBuilder(4 + langSys.bytes.length);
  script.setU16(0, 4).setU16(2, 0).put(4, langSys.bytes);
  const scriptList = new TableBuilder(8 + script.bytes.length);
  scriptList
    .setU16(0, 1)
    .setU16(2, 0x6c61) // 'la'
    .setU16(4, 0x746e) // 'tn'
    .setU16(6, 8)
    .put(8, script.bytes);
  const featureTables = features.map((feature) => {
    const table = new TableBuilder(4 + feature.lookupIndices.length * 2);
    table.setU16(0, 0).setU16(2, feature.lookupIndices.length);
    feature.lookupIndices.forEach((lookupIndex, index) =>
      table.setU16(4 + index * 2, lookupIndex),
    );
    return table.bytes;
  });
  const featureListSize =
    2 + features.length * 6 + featureTables.reduce((n, t) => n + t.length, 0);
  const featureList = new TableBuilder(featureListSize);
  featureList.setU16(0, features.length);
  let featureTableAt = 2 + features.length * 6;
  features.forEach((feature, index) => {
    for (let c = 0; c < 4; c++) {
      featureList.bytes[2 + index * 6 + c] = feature.tag.charCodeAt(c);
    }
    featureList
      .setU16(2 + index * 6 + 4, featureTableAt)
      .put(featureTableAt, featureTables[index]!);
    featureTableAt += featureTables[index]!.length;
  });
  const lookupTables = lookups.map((lookup) => {
    const markFilteringSetWidth =
      lookup.flag !== undefined && (lookup.flag & 0x0010) !== 0 ? 2 : 0;
    // The Lookup table's own layout: a 6-byte header, the subtable offset array, then — only when the flag selects one — the trailing markFilteringSet index the flag's set number refers to.
    let at = 6 + lookup.subtables.length * 2 + markFilteringSetWidth;
    const offsets = lookup.subtables.map((subtable) => {
      const offset = at;
      at += subtable.length;
      return offset;
    });
    const table = new TableBuilder(at);
    table
      .setU16(0, lookup.type)
      .setU16(2, lookup.flag ?? 0)
      .setU16(4, lookup.subtables.length);
    if (markFilteringSetWidth === 2) {
      table.setU16(
        6 + lookup.subtables.length * 2,
        lookup.markFilteringSet ?? 0,
      );
    }
    offsets.forEach((offset, index) => {
      table.setU16(6 + index * 2, offset);
      table.put(offset, lookup.subtables[index]!);
    });
    return table.bytes;
  });
  const lookupList = buildOffsetTableContainer(lookupTables);
  const scriptListAt = 10;
  const featureListAt = scriptListAt + scriptList.bytes.length;
  const lookupListAt = featureListAt + featureList.bytes.length;
  const table = new TableBuilder(lookupListAt + lookupList.length);
  table.setU16(0, 1).setU16(2, 0);
  table
    .setU16(4, scriptListAt)
    .setU16(6, featureListAt)
    .setU16(8, lookupListAt);
  table.put(scriptListAt, scriptList.bytes);
  table.put(featureListAt, featureList.bytes);
  table.put(lookupListAt, lookupList);
  return table.bytes;
}

// A 'GDEF' table: version 1.0 carrying the glyph-class and mark-attachment ClassDefs, or version 1.2 adding MarkGlyphSets (the coverage tables a useMarkFilteringSet flag selects between). AttachList and LigCaretList are always NULL — the reader under test ignores them.
export function buildGdefTable(classes: {
  readonly glyphClassDef?: Uint8Array;
  readonly markAttachClassDef?: Uint8Array;
  readonly markGlyphSets?: readonly Uint8Array[];
}): Uint8Array<ArrayBuffer> {
  const withSets = classes.markGlyphSets !== undefined;
  const sets = classes.markGlyphSets ?? [];
  const markGlyphSetsDef = withSets
    ? (() => {
        const defSize =
          4 + sets.length * 4 + sets.reduce((n, s) => n + s.length, 0);
        const def = new TableBuilder(defSize);
        def.setU16(0, 1).setU16(2, sets.length);
        let at = 4 + sets.length * 4;
        sets.forEach((coverage, index) => {
          def.setU32(4 + index * 4, at);
          at += coverage.length;
        });
        at = 4 + sets.length * 4;
        sets.forEach((coverage) => {
          def.put(at, coverage);
          at += coverage.length;
        });
        return def.bytes;
      })()
    : undefined;
  const headerSize = withSets ? 14 : 12;
  const blobs = [
    classes.glyphClassDef,
    classes.markAttachClassDef,
    markGlyphSetsDef,
  ].filter((blob): blob is Uint8Array => blob !== undefined);
  const table = new TableBuilder(
    headerSize + blobs.reduce((n, blob) => n + blob.length, 0),
  );
  table.setU16(0, 1).setU16(2, withSets ? 2 : 0);
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
  table.setU16(4, glyphClassOffset).setU16(6, 0).setU16(8, 0);
  table.setU16(10, markAttachOffset);
  if (withSets) {
    // the MarkGlyphSetsDef offset slot arrives with minor version 2; its value was already placed by the blob walk above
    const setsOffset =
      markGlyphSetsDef === undefined ? 0 : offsetOf(markGlyphSetsDef);
    table.setU16(12, setsOffset);
  }
  return table.bytes;
}
