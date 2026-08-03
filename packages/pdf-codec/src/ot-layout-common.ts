import { hasBytes, u16 } from './sfnt';

// The two OpenType Common Table Formats every OpenType Layout table is built out of (Microsoft's OpenType spec, "Common Table Formats"; ISO/IEC 14496-22 clause 6.1): a Coverage table, which answers "does this subtable apply to this glyph, and if so where does it sit in the subtable's own parallel value array", and a ClassDef table, which answers "which class does this glyph belong to". Both are shared vocabulary rather than any one table's private business -- 'GPOS' (gpos-table.ts) and 'MATH' (math-table.ts) both index glyphs through the identical Coverage layout -- which is why they live here rather than being parsed twice.
//
// Both are stored as a sorted range list and searched by bisection rather than expanded into a glyph-keyed Map. That is the on-disk shape of each table's own format 2 (a run of start/end records), and keeping it avoids the one real memory hazard these tables carry for untrusted input: six bytes of a format 2 record can legitimately declare a 65536-glyph range, so materialising every glyph of every range across every subtable of a font extracted from an arbitrary source document turns a small file into a large allocation. Format 1, whose size is inherently bounded by the file (one uint16 per listed glyph), is coalesced into the same representation so one search path serves both.
//
// Every read is bounds-checked and a malformed or truncated table yields `undefined` rather than throwing, matching cmap-table.ts's own policy for the same reason: these tables are read from fonts embedded in arbitrary input documents, where an unreadable optional table must cost the caller that one table's worth of information, not the document around it.

// A half-open-free, inclusive glyph range: `[startGlyphId, endGlyphId]`. `value` means different things to the two tables built on it -- a Coverage range's value is the coverage index of its FIRST glyph and climbs by one per glyph across the range, whereas a ClassDef range's value is one class shared by every glyph in it -- so the two resolve it differently rather than sharing a single accessor.
interface GlyphRange {
  readonly startGlyphId: number;
  readonly endGlyphId: number;
  readonly value: number;
}

// The range covering `glyphId`, by bisection over a list sorted on `startGlyphId`. Ranges are sorted at parse time rather than trusted to arrive sorted: the spec requires both tables' format 2 records to be in glyph order, but a font from an arbitrary source document is not obliged to be correct, and an unsorted list would otherwise make this search silently miss real entries.
function findRange(ranges: readonly GlyphRange[], glyphId: number): GlyphRange | undefined {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const range = ranges[mid]!;
    if (glyphId < range.startGlyphId) {
      high = mid - 1;
    } else if (glyphId > range.endGlyphId) {
      low = mid + 1;
    } else {
      return range;
    }
  }
  return undefined;
}

// Appends `[glyphId, glyphId] -> value` to `ranges`, extending the previous range instead when this glyph continues it. Whether a glyph continues the previous range depends on which table is being built: a Coverage index climbs by one per glyph (`valueStep` 1), a ClassDef class stays flat across its range (`valueStep` 0).
function pushGlyph(ranges: GlyphRange[], glyphId: number, value: number, valueStep: number): void {
  const previous = ranges[ranges.length - 1];
  if (previous !== undefined && glyphId === previous.endGlyphId + 1 && value === previous.value + (previous.endGlyphId - previous.startGlyphId + 1) * valueStep) {
    ranges[ranges.length - 1] = { startGlyphId: previous.startGlyphId, endGlyphId: glyphId, value: previous.value };
    return;
  }
  ranges.push({ startGlyphId: glyphId, endGlyphId: glyphId, value });
}

const RANGE_RECORD_SIZE = 6; // uint16 startGlyphID + uint16 endGlyphID + uint16 (startCoverageIndex | class) -- the identical record layout Coverage format 2 and ClassDef format 2 both use

// Reads the shared start/end/value record array both format 2 tables store, at `recordsOffset`, and returns it sorted by start glyph. A record whose end precedes its start is dropped rather than treated as empty or inverted: it describes no glyphs either way, and keeping it would only put an unsearchable entry in the bisection list.
function parseRangeRecords(bytes: Uint8Array<ArrayBuffer>, recordsOffset: number, recordCount: number): GlyphRange[] | undefined {
  if (!hasBytes(bytes, recordsOffset, recordCount * RANGE_RECORD_SIZE)) {
    return undefined;
  }
  const ranges: GlyphRange[] = [];
  for (let i = 0; i < recordCount; i++) {
    const recordOffset = recordsOffset + i * RANGE_RECORD_SIZE;
    const startGlyphId = u16(bytes, recordOffset);
    const endGlyphId = u16(bytes, recordOffset + 2);
    if (endGlyphId < startGlyphId) {
      continue;
    }
    ranges.push({ startGlyphId, endGlyphId, value: u16(bytes, recordOffset + 4) });
  }
  ranges.sort((a, b) => a.startGlyphId - b.startGlyphId);
  return ranges;
}

const COVERAGE_HEADER_SIZE = 4; // uint16 coverageFormat + uint16 (glyphCount | rangeCount)

// A parsed Coverage table: the glyph-to-position indirection every glyph-keyed OpenType Layout subtable goes through.
export interface CoverageTable {
  // This glyph's own index into the subtable's parallel value array, or `undefined` when the table does not cover it at all.
  coverageIndex(glyphId: number): number | undefined;
  // Every covered glyph paired with its coverage index, ascending by glyph ID. For a consumer that needs to walk the whole coverage rather than probe it (math-table.ts builds its per-glyph value maps this way), since the range representation above is not itself enumerable.
  entries(): IterableIterator<readonly [number, number]>;
}

export function parseCoverage(bytes: Uint8Array<ArrayBuffer>, coverageOffset: number): CoverageTable | undefined {
  if (!hasBytes(bytes, coverageOffset, COVERAGE_HEADER_SIZE)) {
    return undefined;
  }
  const format = u16(bytes, coverageOffset);
  const count = u16(bytes, coverageOffset + 2);
  let ranges: GlyphRange[] | undefined;
  if (format === 1) {
    // Format 1: a plain ascending list of covered glyph IDs, each glyph's coverage index being its own position in that list.
    const glyphArrayOffset = coverageOffset + COVERAGE_HEADER_SIZE;
    if (!hasBytes(bytes, glyphArrayOffset, count * 2)) {
      return undefined;
    }
    ranges = [];
    for (let i = 0; i < count; i++) {
      pushGlyph(ranges, u16(bytes, glyphArrayOffset + i * 2), i, 1);
    }
    ranges.sort((a, b) => a.startGlyphId - b.startGlyphId);
  } else if (format === 2) {
    // Format 2: start/end ranges, each carrying the coverage index of its own first glyph.
    ranges = parseRangeRecords(bytes, coverageOffset + COVERAGE_HEADER_SIZE, count);
  }
  if (ranges === undefined) {
    return undefined;
  }
  const resolved = ranges;
  return {
    coverageIndex(glyphId: number): number | undefined {
      const range = findRange(resolved, glyphId);
      return range === undefined ? undefined : range.value + (glyphId - range.startGlyphId);
    },
    *entries(): IterableIterator<readonly [number, number]> {
      for (const range of resolved) {
        for (let glyphId = range.startGlyphId; glyphId <= range.endGlyphId; glyphId++) {
          yield [glyphId, range.value + (glyphId - range.startGlyphId)];
        }
      }
    },
  };
}

const CLASS_DEF_FORMAT_1_HEADER_SIZE = 6; // uint16 classFormat + uint16 startGlyphID + uint16 glyphCount
const CLASS_DEF_FORMAT_2_HEADER_SIZE = 4; // uint16 classFormat + uint16 classRangeCount

// A parsed ClassDef table. Class 0 is the spec's own catch-all for "every glyph the table does not otherwise assign", so this resolves to a class for any glyph rather than to `undefined` -- an unlisted glyph genuinely is in class 0, not absent.
export type ClassDefTable = (glyphId: number) => number;

export function parseClassDef(bytes: Uint8Array<ArrayBuffer>, classDefOffset: number): ClassDefTable | undefined {
  if (!hasBytes(bytes, classDefOffset, CLASS_DEF_FORMAT_2_HEADER_SIZE)) {
    return undefined;
  }
  const format = u16(bytes, classDefOffset);
  let ranges: GlyphRange[] | undefined;
  if (format === 1) {
    // Format 1: one contiguous run of glyphs starting at startGlyphID, with an explicit class per glyph.
    if (!hasBytes(bytes, classDefOffset, CLASS_DEF_FORMAT_1_HEADER_SIZE)) {
      return undefined;
    }
    const startGlyphId = u16(bytes, classDefOffset + 2);
    const glyphCount = u16(bytes, classDefOffset + 4);
    const classArrayOffset = classDefOffset + CLASS_DEF_FORMAT_1_HEADER_SIZE;
    if (!hasBytes(bytes, classArrayOffset, glyphCount * 2)) {
      return undefined;
    }
    ranges = [];
    for (let i = 0; i < glyphCount; i++) {
      pushGlyph(ranges, startGlyphId + i, u16(bytes, classArrayOffset + i * 2), 0);
    }
  } else if (format === 2) {
    // Format 2: start/end ranges, each assigning one class to every glyph it spans.
    ranges = parseRangeRecords(bytes, classDefOffset + CLASS_DEF_FORMAT_2_HEADER_SIZE, u16(bytes, classDefOffset + 2));
  }
  if (ranges === undefined) {
    return undefined;
  }
  const resolved = ranges;
  return (glyphId: number): number => findRange(resolved, glyphId)?.value ?? 0;
}
