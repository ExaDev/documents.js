import { describe, expect, it } from 'vitest';
import type { CcittFaxFixture } from '../test-support/ccitt-fax';
import { CCITT_FAX_FIXTURES, ccittFixtureBitmap, ccittFixtureBytes } from '../test-support/ccitt-fax';
import { decodeCcittFax } from './ccitt';

// Unpacks a decoded 1-bit-per-pixel bitmap into one boolean per pixel, true meaning black. With /BlackIs1 left false (the default), a black pixel is the 0 bit.
function toBlackPixels(bytes: Uint8Array<ArrayBuffer>, columns: number, rows: number, blackIs1 = false): boolean[] {
  const bytesPerRow = Math.ceil(columns / 8);
  const out: boolean[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const bit = ((bytes[y * bytesPerRow + (x >> 3)] ?? 0) >> (7 - (x & 7))) & 1;
      out.push(blackIs1 ? bit === 1 : bit === 0);
    }
  }
  return out;
}

function renderRows(pixels: readonly boolean[], columns: number): string[] {
  const lines: string[] = [];
  for (let i = 0; i < pixels.length; i += columns) {
    lines.push(
      pixels
        .slice(i, i + columns)
        .map((black) => (black ? '#' : '.'))
        .join(''),
    );
  }
  return lines;
}

interface EncodingCase {
  readonly name: keyof CcittFaxFixture['encodings'];
  readonly k: number;
}

const ENCODINGS: readonly EncodingCase[] = [
  { name: 'group4', k: -1 },
  { name: 'group3OneDimensional', k: 0 },
  { name: 'group3TwoDimensional', k: 1 },
  { name: 'group3TwoDimensionalFilled', k: 1 },
];

describe('decodeCcittFax: real libtiff-encoded streams', () => {
  for (const fixture of CCITT_FAX_FIXTURES) {
    for (const encoding of ENCODINGS) {
      it(`recovers the "${fixture.name}" bitmap exactly from its ${encoding.name} stream`, () => {
        const warnings: string[] = [];
        const result = decodeCcittFax(ccittFixtureBytes(fixture.encodings[encoding.name]), {
          k: encoding.k,
          columns: fixture.columns,
          rows: fixture.rows,
          onWarning: (message) => warnings.push(message),
        });
        expect(warnings).toEqual([]);
        expect(result.rows).toBe(fixture.rows);
        expect(result.bytes.length).toBe(Math.ceil(fixture.columns / 8) * fixture.rows);
        // Compared as rendered rows rather than raw booleans so a failure shows the actual bitmap rather than an index.
        expect(renderRows(toBlackPixels(result.bytes, fixture.columns, fixture.rows), fixture.columns)).toEqual(renderRows(ccittFixtureBitmap(fixture), fixture.columns));
      });
    }
  }

  it('stops at the end-of-block marker when the row count is not known in advance', () => {
    // Every stream here ends with its own terminator -- T.6's EOFB (two EOLs) for Group 4, T.4's RTC (six EOLs) for Group 3 -- so a decode given no /Rows must still land on exactly the encoded row count.
    for (const fixture of CCITT_FAX_FIXTURES) {
      for (const encoding of ENCODINGS) {
        const result = decodeCcittFax(ccittFixtureBytes(fixture.encodings[encoding.name]), { k: encoding.k, columns: fixture.columns });
        expect({ name: fixture.name, encoding: encoding.name, rows: result.rows }).toEqual({ name: fixture.name, encoding: encoding.name, rows: fixture.rows });
      }
    }
  });

  it('inverts the output bit for /BlackIs1', () => {
    const fixture = CCITT_FAX_FIXTURES.find((f) => f.name === 'box');
    expect(fixture).toBeDefined();
    const options = { k: -1, columns: fixture!.columns, rows: fixture!.rows };
    const normal = decodeCcittFax(ccittFixtureBytes(fixture!.encodings.group4), options);
    const inverted = decodeCcittFax(ccittFixtureBytes(fixture!.encodings.group4), { ...options, blackIs1: true });
    expect(Array.from(inverted.bytes)).toEqual(Array.from(normal.bytes, (byte) => byte ^ 0xff));
    // Same pixels either way once each is read under its own convention.
    expect(toBlackPixels(inverted.bytes, fixture!.columns, fixture!.rows, true)).toEqual(toBlackPixels(normal.bytes, fixture!.columns, fixture!.rows));
  });
});

// A Group 4 stream small enough to trace against the specification by hand, which is what makes it useful for /EncodedByteAlign: libtiff writes T.4 fill bits IN FRONT of an EOL (so the EOL ends on a byte boundary) rather than PDF's "each line's own data starts on a byte boundary", so no libtiff-produced stream exercises this parameter.
//
// Two rows, eight columns, row 0 all white and row 1 black across x = 2..5. Row 0, coded against the imaginary all-white line above it: b1 = 8 (no changing element), so a single V0 code (1) puts a1 at 8 and ends the row. Row 1, coded against row 0 (still no changing elements, so b1 = b2 = 8): horizontal mode (001) + a white run of 2 (0111) + a black run of 4 (011) leaves a0 at 6, then V0 (1) puts a1 at 8 and ends the row. Unaligned that is 1 001 0111 011 1 -> 0x97 0x70. Byte-aligned, row 0's single bit is padded out to 0x80 and row 1's eleven bits start the next byte: 0x80 0x2E 0xE0.
const HAND_TRACED_UNALIGNED = new Uint8Array([0x97, 0x70]);
const HAND_TRACED_BYTE_ALIGNED = new Uint8Array([0x80, 0x2e, 0xe0]);
const HAND_TRACED_ROWS = ['........', '..####..'];

describe('decodeCcittFax: /EncodedByteAlign', () => {
  it('decodes a hand-traced Group 4 stream whose rows run straight on from each other', () => {
    const result = decodeCcittFax(HAND_TRACED_UNALIGNED, { k: -1, columns: 8, rows: 2 });
    expect(renderRows(toBlackPixels(result.bytes, 8, 2), 8)).toEqual(HAND_TRACED_ROWS);
  });

  it('decodes the same image when every row is padded out to a byte boundary', () => {
    const result = decodeCcittFax(HAND_TRACED_BYTE_ALIGNED, { k: -1, columns: 8, rows: 2, encodedByteAlign: true });
    expect(renderRows(toBlackPixels(result.bytes, 8, 2), 8)).toEqual(HAND_TRACED_ROWS);
  });

  it('misreads a byte-aligned stream when the parameter is not set, which is why it exists', () => {
    const result = decodeCcittFax(HAND_TRACED_BYTE_ALIGNED, { k: -1, columns: 8, rows: 2, onWarning: () => undefined });
    expect(renderRows(toBlackPixels(result.bytes, 8, 2), 8)).not.toEqual(HAND_TRACED_ROWS);
  });

  it('reads the row count off the end of the data when /Rows is not given', () => {
    expect(decodeCcittFax(HAND_TRACED_UNALIGNED, { k: -1, columns: 8 }).rows).toBe(2);
    expect(decodeCcittFax(HAND_TRACED_BYTE_ALIGNED, { k: -1, columns: 8, encodedByteAlign: true }).rows).toBe(2);
  });
});

describe('decodeCcittFax: degradation', () => {
  it('pads a stream that runs out early with white rows and says so', () => {
    const warnings: string[] = [];
    const result = decodeCcittFax(HAND_TRACED_UNALIGNED, { k: -1, columns: 8, rows: 4, onWarning: (message) => warnings.push(message) });
    expect(result.rows).toBe(4);
    expect(renderRows(toBlackPixels(result.bytes, 8, 4), 8)).toEqual([...HAND_TRACED_ROWS, '........', '........']);
    expect(warnings).toEqual(['CCITT fax data ended after 2 of 4 declared rows; padding the remainder white']);
  });

  it('keeps the rows it recovered when the bitstream stops making sense', () => {
    const warnings: string[] = [];
    // Row 0 decodes cleanly; the second byte is an extension code (0000001), which this decoder does not implement.
    const result = decodeCcittFax(new Uint8Array([0x80, 0x02, 0x00, 0x00]), { k: -1, columns: 8, rows: 3, encodedByteAlign: true, onWarning: (message) => warnings.push(message) });
    expect(result.rows).toBe(3);
    expect(renderRows(toBlackPixels(result.bytes, 8, 3), 8)).toEqual(['........', '........', '........']);
    expect(warnings[0]).toContain('became undecodable at row 1');
  });

  it('stops on a code that is in neither run-length table, whether or not the data runs out mid-code', () => {
    for (const truncated of [new Uint8Array([0x00]), new Uint8Array([0x00, 0x00])]) {
      const warnings: string[] = [];
      const result = decodeCcittFax(truncated, { k: 0, columns: 8, rows: 2, onWarning: (message) => warnings.push(message) });
      expect(renderRows(toBlackPixels(result.bytes, 8, 2), 8)).toEqual(['........', '........']);
      expect(warnings[0]).toContain('became undecodable at row 0');
    }
  });

  it('returns nothing at all for a zero-column image', () => {
    expect(decodeCcittFax(HAND_TRACED_UNALIGNED, { k: -1, columns: 0, rows: 2 })).toEqual({ bytes: new Uint8Array(0), columns: 0, rows: 0 });
  });

  it('leaves the padding bits of a row that does not fill its last byte white', () => {
    const fixture = CCITT_FAX_FIXTURES.find((f) => f.name === 'oddwidth');
    expect(fixture?.columns).toBe(13); // three bits of padding in each row's second byte
    const result = decodeCcittFax(ccittFixtureBytes(fixture!.encodings.group4), { k: -1, columns: 13, rows: fixture!.rows });
    for (let y = 0; y < fixture!.rows; y++) {
      expect((result.bytes[y * 2 + 1]! & 0b111) === 0b111).toBe(true);
    }
  });
});
