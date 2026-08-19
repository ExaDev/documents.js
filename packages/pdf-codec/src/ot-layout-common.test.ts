import { describe, expect, it } from 'vitest';
import { parseClassDef, parseCoverage } from './ot-layout-common';

// Both tables are built here to the spec's own byte layout (Microsoft's OpenType spec, "Common Table Formats") rather than through this module's parser, so a test that passes proves the parser agrees with the format rather than with itself. The real-font exercise of both tables lives in gpos-table.test.ts, which drives them through the actual vendored Carlito/Caladea GPOS tables; what these cases add is the malformed and boundary input no well-formed font contains.

function bytesOf(values: readonly number[], leadingPadding = 0): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(leadingPadding + values.length * 2);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => {
    view.setUint16(leadingPadding + index * 2, value);
  });
  return bytes;
}

describe('parseCoverage format 1', () => {
  it('maps each listed glyph to its own position in the list', () => {
    // format 1, glyphCount 4, then the glyph IDs: deliberately non-contiguous, so a parser that assumed a run would misindex the tail.
    const coverage = parseCoverage(bytesOf([1, 4, 10, 11, 20, 40]), 0);
    expect(coverage).toBeDefined();
    expect(coverage!.coverageIndex(10)).toBe(0);
    expect(coverage!.coverageIndex(11)).toBe(1);
    expect(coverage!.coverageIndex(20)).toBe(2);
    expect(coverage!.coverageIndex(40)).toBe(3);
  });

  it('reports an uncovered glyph as undefined rather than as index 0', () => {
    const coverage = parseCoverage(bytesOf([1, 2, 10, 20]), 0);
    expect(coverage!.coverageIndex(9)).toBeUndefined();
    expect(coverage!.coverageIndex(15)).toBeUndefined();
    expect(coverage!.coverageIndex(21)).toBeUndefined();
  });

  it('enumerates every covered glyph with its index, ascending', () => {
    const coverage = parseCoverage(bytesOf([1, 3, 7, 8, 30]), 0);
    expect([...coverage!.entries()]).toStrictEqual([
      [7, 0],
      [8, 1],
      [30, 2],
    ]);
  });

  it('reads a table that does not start at offset 0', () => {
    // The real call site always passes an offset into a whole GPOS/MATH table, never a table sliced to start at 0.
    const coverage = parseCoverage(bytesOf([1, 2, 5, 6], 6), 6);
    expect(coverage!.coverageIndex(5)).toBe(0);
    expect(coverage!.coverageIndex(6)).toBe(1);
  });
});

describe('parseCoverage format 2', () => {
  it('climbs the coverage index across each range', () => {
    // format 2, rangeCount 2, then (start, end, startCoverageIndex) per range.
    const coverage = parseCoverage(bytesOf([2, 2, 10, 12, 0, 40, 41, 3]), 0);
    expect(coverage!.coverageIndex(10)).toBe(0);
    expect(coverage!.coverageIndex(11)).toBe(1);
    expect(coverage!.coverageIndex(12)).toBe(2);
    expect(coverage!.coverageIndex(40)).toBe(3);
    expect(coverage!.coverageIndex(41)).toBe(4);
    expect(coverage!.coverageIndex(13)).toBeUndefined();
    expect(coverage!.coverageIndex(39)).toBeUndefined();
  });

  it('enumerates a range glyph by glyph', () => {
    const coverage = parseCoverage(bytesOf([2, 1, 10, 12, 5]), 0);
    expect([...coverage!.entries()]).toStrictEqual([
      [10, 5],
      [11, 6],
      [12, 7],
    ]);
  });

  it('finds a glyph in a range list the font left out of order', () => {
    // The spec requires records ordered by start glyph; nothing obliges a font from an arbitrary source document to comply, and the bisection would silently miss entries if the parser trusted the order.
    const coverage = parseCoverage(bytesOf([2, 2, 40, 41, 3, 10, 12, 0]), 0);
    expect(coverage!.coverageIndex(11)).toBe(1);
    expect(coverage!.coverageIndex(41)).toBe(4);
  });

  it('drops a range whose end precedes its start', () => {
    const coverage = parseCoverage(bytesOf([2, 2, 20, 10, 0, 40, 41, 3]), 0);
    expect(coverage!.coverageIndex(15)).toBeUndefined();
    expect(coverage!.coverageIndex(40)).toBe(3);
  });
});

describe('parseCoverage rejects what it cannot read', () => {
  it('returns undefined for a truncated header', () => {
    expect(parseCoverage(bytesOf([1]), 0)).toBeUndefined();
    expect(parseCoverage(new Uint8Array(0), 0)).toBeUndefined();
  });

  it('returns undefined when the glyph array runs past the table', () => {
    expect(parseCoverage(bytesOf([1, 500, 10, 11]), 0)).toBeUndefined();
    expect(parseCoverage(bytesOf([2, 500, 10, 11, 0]), 0)).toBeUndefined();
  });

  it('returns undefined for a format it does not know', () => {
    expect(parseCoverage(bytesOf([3, 1, 10, 11, 0]), 0)).toBeUndefined();
    expect(parseCoverage(bytesOf([0, 1, 10, 11, 0]), 0)).toBeUndefined();
  });
});

describe('parseClassDef format 1', () => {
  it('assigns each glyph in the run its own class', () => {
    // format 1, startGlyphID 10, glyphCount 4, then one class per glyph.
    const classDef = parseClassDef(bytesOf([1, 10, 4, 2, 2, 0, 5]), 0);
    expect(classDef).toBeDefined();
    expect(classDef!(10)).toBe(2);
    expect(classDef!(11)).toBe(2);
    expect(classDef!(12)).toBe(0);
    expect(classDef!(13)).toBe(5);
  });

  it('puts every glyph outside the run in class 0', () => {
    // Class 0 is the spec's own catch-all, so an unlisted glyph is genuinely in a class rather than absent -- which is why this returns a number rather than undefined.
    const classDef = parseClassDef(bytesOf([1, 10, 2, 3, 4]), 0);
    expect(classDef!(9)).toBe(0);
    expect(classDef!(12)).toBe(0);
    expect(classDef!(9999)).toBe(0);
  });
});

describe('parseClassDef format 2', () => {
  it('assigns one class across each range', () => {
    // format 2, classRangeCount 2, then (start, end, class) per range.
    const classDef = parseClassDef(bytesOf([2, 2, 10, 12, 7, 40, 41, 1]), 0);
    expect(classDef!(10)).toBe(7);
    expect(classDef!(11)).toBe(7);
    expect(classDef!(12)).toBe(7);
    expect(classDef!(40)).toBe(1);
    expect(classDef!(41)).toBe(1);
  });

  it('puts a glyph between two ranges in class 0', () => {
    const classDef = parseClassDef(bytesOf([2, 2, 10, 12, 7, 40, 41, 1]), 0);
    expect(classDef!(13)).toBe(0);
    expect(classDef!(39)).toBe(0);
    expect(classDef!(42)).toBe(0);
  });

  it('finds a glyph in a range list the font left out of order', () => {
    const classDef = parseClassDef(bytesOf([2, 2, 40, 41, 1, 10, 12, 7]), 0);
    expect(classDef!(11)).toBe(7);
    expect(classDef!(40)).toBe(1);
  });
});

describe('parseClassDef rejects what it cannot read', () => {
  it('returns undefined for a truncated header or class array', () => {
    expect(parseClassDef(bytesOf([1]), 0)).toBeUndefined();
    expect(parseClassDef(bytesOf([1, 10]), 0)).toBeUndefined();
    expect(parseClassDef(bytesOf([1, 10, 500, 3]), 0)).toBeUndefined();
    expect(parseClassDef(bytesOf([2, 500, 10, 12, 7]), 0)).toBeUndefined();
  });

  it('returns undefined for a format it does not know', () => {
    expect(parseClassDef(bytesOf([3, 1, 10, 12, 7]), 0)).toBeUndefined();
  });
});
