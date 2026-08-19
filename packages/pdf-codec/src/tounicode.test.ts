import { describe, expect, it } from 'vitest';
import { parseToUnicodeCMap } from './cmap';
import { NOOP_DIAGNOSTIC_SINK } from './diagnostics';
import type { PdfObject } from './objects';
import { buildToUnicodeCMap } from './tounicode';

function cmapText(codeToCodePoint: ReadonlyMap<number, number>): string {
  const stream: PdfObject = buildToUnicodeCMap(codeToCodePoint);
  if (stream.kind !== 'stream') {
    throw new Error('buildToUnicodeCMap did not produce a stream');
  }
  return new TextDecoder().decode(stream.raw);
}

function bfcharBlockCounts(text: string): number[] {
  return [...text.matchAll(/^(\d+) beginbfchar$/gm)].map((match) => Number(match[1]));
}

describe('buildToUnicodeCMap', () => {
  it('writes the PostScript CMap boilerplate a conforming consumer needs', () => {
    const text = cmapText(new Map([[3, 0x41]]));
    for (const required of ['/CIDInit /ProcSet findresource begin', 'begincmap', '/CMapType 2 def', '1 begincodespacerange', '<0000> <FFFF>', 'endcodespacerange', 'endcmap']) {
      expect(text).toContain(required);
    }
    expect(text).toContain('1 beginbfchar\n<0003> <0041>\nendbfchar');
  });

  it('encodes a code point above U+FFFF as a genuine UTF-16BE surrogate pair', () => {
    // U+1D400 (mathematical bold capital A), one of the Mathematical Alphanumeric Symbols characters this family's own mathvariant mapping routinely produces. A bfchar destination is UTF-16BE, so a supplementary-plane code point occupies two 16-bit units, not one 32-bit one -- writing <0001d400> instead of <d835dc00> would make every reader recover the wrong character.
    expect(cmapText(new Map([[7, 0x1d400]]))).toContain('<0007> <d835dc00>');
  });

  it('splits into blocks of at most 100 entries, which is the limit the CMap syntax sets', () => {
    const entries = new Map<number, number>();
    for (let i = 0; i < 250; i++) {
      entries.set(i + 1, 0x41 + (i % 26));
    }
    const text = cmapText(entries);
    // A subsetted text face routinely carries more than 100 glyphs, so one oversized block is not a theoretical concern here -- it is the ordinary case.
    expect(bfcharBlockCounts(text)).toEqual([100, 100, 50]);
    expect(text.match(/beginbfchar/g)?.length).toBe(3);
    expect(text.match(/endbfchar/g)?.length).toBe(3);
    // Every declared block count really is the number of entries that follows it.
    const blocks = text.split('beginbfchar').slice(1);
    expect(blocks.map((block) => block.split('endbfchar')[0]!.trim().split('\n').length)).toEqual([100, 100, 50]);
  });

  it('round-trips through this package own CMap reader, across a block boundary', () => {
    const entries = new Map<number, number>();
    for (let i = 0; i < 250; i++) {
      entries.set(i + 1, 0x100 + i);
    }
    const parsed = parseToUnicodeCMap(new TextEncoder().encode(cmapText(entries)), NOOP_DIAGNOSTIC_SINK);
    // Read back with cmap.ts rather than only inspected as text: entries either side of every 100-entry boundary have to survive, not merely be present in the bytes.
    for (const [code, codePoint] of entries) {
      expect(parsed.lookup(code)).toBe(String.fromCodePoint(codePoint));
    }
    expect(parsed.lookup(0)).toBeUndefined();
    expect(parsed.lookup(251)).toBeUndefined();
  });

  it('emits entries sorted by code, so identical input yields byte-identical output', () => {
    const forwards = new Map([
      [3, 0x41],
      [9, 0x43],
      [5, 0x42],
    ]);
    const backwards = new Map([
      [9, 0x43],
      [5, 0x42],
      [3, 0x41],
    ]);
    expect(cmapText(forwards)).toBe(cmapText(backwards));
    expect(cmapText(forwards)).toContain('<0003> <0041>\n<0005> <0042>\n<0009> <0043>');
  });

  it('emits no bfchar block at all for an empty mapping', () => {
    const text = cmapText(new Map());
    expect(text).not.toContain('beginbfchar');
    expect(text).toContain('endcodespacerange');
    expect(text).toContain('endcmap');
  });
});
