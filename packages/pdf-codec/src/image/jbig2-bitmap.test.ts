import { describe, expect, it } from 'vitest';
import type { Jbig2CombinationOperator } from './jbig2-bitmap';
import { Jbig2BitmapTooLargeError, combinationOperatorFromCode, combineBitmap, createBitmap, getPixel, packBitmapRows, unpackBitmapRows } from './jbig2-bitmap';

function bitmapFrom(rows: readonly string[]): ReturnType<typeof createBitmap> {
  const bitmap = createBitmap(rows[0]?.length ?? 0, rows.length);
  rows.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      bitmap.data[y * bitmap.width + x] = cell === '#' ? 1 : 0;
    });
  });
  return bitmap;
}

function render(bitmap: ReturnType<typeof createBitmap>): string[] {
  const rows: string[] = [];
  for (let y = 0; y < bitmap.height; y++) {
    let row = '';
    for (let x = 0; x < bitmap.width; x++) {
      row += bitmap.data[y * bitmap.width + x] === 1 ? '#' : '.';
    }
    rows.push(row);
  }
  return rows;
}

describe('combineBitmap', () => {
  // Every operator T.88 Table 12 defines, applied to the same overlapping pair so the four results can be read off against each other. Only OR, XOR and REPLACE are reachable through the encoder-produced fixtures in jbig2.test.ts, which is exactly why AND and XNOR need stating here.
  const destination = ['##..', '##..'];
  const source = ['#.#.', '#.#.'];
  const cases: readonly (readonly [Jbig2CombinationOperator, readonly string[]])[] = [
    ['or', ['###.', '###.']],
    ['and', ['#...', '#...']],
    ['xor', ['.##.', '.##.']],
    ['xnor', ['#..#', '#..#']],
    ['replace', ['#.#.', '#.#.']],
  ];

  for (const [operator, expected] of cases) {
    it(`applies the ${operator} operator`, () => {
      const target = bitmapFrom(destination);
      combineBitmap(target, bitmapFrom(source), 0, 0, operator);
      expect(render(target)).toEqual(expected);
    });
  }

  it('clips a source that overhangs the destination rather than wrapping or throwing', () => {
    const target = bitmapFrom(['....', '....']);
    combineBitmap(target, bitmapFrom(['##', '##']), 3, 1, 'or');
    expect(render(target)).toEqual(['....', '...#']);
    combineBitmap(target, bitmapFrom(['##', '##']), -1, -1, 'or');
    expect(render(target)).toEqual(['#...', '...#']);
  });
});

describe('combinationOperatorFromCode', () => {
  it('maps T.88 Table 12s own codes and rejects anything outside them', () => {
    expect([0, 1, 2, 3, 4].map((code) => combinationOperatorFromCode(code))).toEqual(['or', 'and', 'xor', 'xnor', 'replace']);
    expect(combinationOperatorFromCode(5)).toBeUndefined();
    expect(combinationOperatorFromCode(7)).toBeUndefined();
  });
});

describe('packBitmapRows and unpackBitmapRows', () => {
  it('round-trips a bitmap whose width is not a multiple of eight, padding each row to a whole byte', () => {
    const rows = ['#.#.#.#.#..#.', '.####...##..#', '#############'];
    const bitmap = bitmapFrom(rows);
    const packed = packBitmapRows(bitmap, bitmap.width, bitmap.height);
    expect(packed.length).toBe(2 * 3); // 13 columns -> two bytes per row
    expect(render(unpackBitmapRows(packed, bitmap.width, bitmap.height))).toEqual(rows);
  });

  it('reads a pixel outside the bitmap as 0, which is what every T.88 template relies on', () => {
    const bitmap = bitmapFrom(['##', '##']);
    expect([getPixel(bitmap, -1, 0), getPixel(bitmap, 0, -1), getPixel(bitmap, 2, 0), getPixel(bitmap, 0, 2), getPixel(bitmap, 1, 1)]).toEqual([0, 0, 0, 0, 1]);
  });

  it('pads past the decoded bitmap when the requested output is larger', () => {
    const bitmap = bitmapFrom(['##']);
    expect(Array.from(packBitmapRows(bitmap, 8, 2))).toEqual([0b11000000, 0b00000000]);
  });
});

describe('createBitmap', () => {
  it('refuses an allocation past its own pixel ceiling rather than exhausting memory on a corrupt header', () => {
    expect(() => createBitmap(0x10000, 0x10000)).toThrow(Jbig2BitmapTooLargeError);
  });

  it('fills with the requested default pixel value', () => {
    expect(render(createBitmap(3, 2, 1))).toEqual(['###', '###']);
  });
});
