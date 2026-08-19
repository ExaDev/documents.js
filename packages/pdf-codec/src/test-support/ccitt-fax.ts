import { base64ToBytes } from '../util/base64';

// Real CCITT Group 3/Group 4 bitstreams, encoded by libtiff (LIBTIFF 4.7.2, driven through Pillow 12.1.0 and tiffcp) rather than by anything in this package -- the same "independent implementation on purpose" rationale test-support/encrypted-pdfs.ts states for its own fixtures: a stream this package encoded itself would let a mistake in the T.4 code tables cancel out between an encoder and a decoder that shared it, and pass anyway. Embedded as base64 so the suite needs no filesystem access.
//
// How each stream was produced, reproducibly:
//   1. Build the bitmap from `isBlack` below and write it as a 1-bit TIFF via Pillow.
//   2. `tiffcp -c <g4|g3|g3:2d|g3:2d:fill> -r <rows> src.tif out.tif` (one strip, so the strip's own bytes are one continuous bitstream).
//   3. Concatenate the strip bytes named by out.tif's /StripOffsets and /StripByteCounts -- that concatenation is what is stored here.
//   4. Confirm libtiff itself decodes out.tif back to the original bitmap before the stream is kept.
//
// One polarity trap worth stating, since it silently inverts every fixture otherwise: Pillow writes a 1-bit TIFF with PhotometricInterpretation = 1 (BlackIsZero), while libtiff's fax codec is photometric-blind and always codes 0-bit samples as WHITE runs. The generator therefore writes the sample bit equal to the fax colour (sample 1 where `isBlack` is true), so these streams carry exactly the black/white runs `isBlack` describes -- which is also PDF's own convention once /BlackIs1 is left at its default false (black pixels decode to 0 bits).

export interface CcittFaxFixture {
  readonly name: string;
  readonly columns: number;
  readonly rows: number;
  readonly isBlack: (x: number, y: number) => boolean;
  readonly encodings: {
    // K < 0: pure two-dimensional T.6 coding (tiffcp -c g4).
    readonly group4: string;
    // K = 0: one-dimensional T.4 Modified Huffman, one EOL per line (tiffcp -c g3).
    readonly group3OneDimensional: string;
    // K > 0: mixed T.4 coding, an EOL plus a 1D/2D tag bit per line (tiffcp -c g3:2d).
    readonly group3TwoDimensional: string;
    // As above, plus GROUP3OPT_FILLBITS: zero fill in front of each EOL so the EOL ends on a byte boundary (tiffcp -c g3:2d:fill).
    readonly group3TwoDimensionalFilled: string;
  };
}

export function ccittFixtureBytes(encoded: string): Uint8Array<ArrayBuffer> {
  return base64ToBytes(encoded);
}

// The bitmap a fixture describes, as one entry per pixel in row-major order, true meaning black.
export function ccittFixtureBitmap(fixture: CcittFaxFixture): boolean[] {
  const out: boolean[] = [];
  for (let y = 0; y < fixture.rows; y++) {
    for (let x = 0; x < fixture.columns; x++) {
      out.push(fixture.isBlack(x, y));
    }
  }
  return out;
}

export const CCITT_FAX_FIXTURES: readonly CcittFaxFixture[] = [
  {
    name: 'checker8',
    columns: 16,
    rows: 8,
    isBlack: (x, y) => ((x / 2 | 0) + (y / 2 | 0)) % 2 === 0,
    encodings: {
      group4: 'Jrl8vl//wwgggggv+EEEEEEEF/4YQQQQQX/ABABA',
      group3OneDimensional: 'ABNd999wATXfffcAF9998AF9998AE13333ABNd999wAX333wAX333w==',
      group3TwoDimensional: 'ABmu+++4AL/gA3333wAX+ADNd999wAX/ABvvvvgAv8A=',
      group3TwoDimensionalFilled: 'AAGa7777gAF/wAG++++AAX+AAZrvvvuAAX/AAb7774ABf4A=',
    },
  },
  {
    name: 'diagonal',
    columns: 24,
    rows: 12,
    isBlack: (x, y) => x === y || x === y + 1 || x + y === 20,
    encodings: {
      group4: 'JrlOraVtK2lbStpW0raVtKw70ER+ACAC',
      group3OneDimensional: 'ABNdOoABH6lYAL+iwAGMhcADedeADnNTAB75UAB/tHABnukAA0iAAT5AANEPoA==',
      group3TwoDimensional: 'ABmunUAAm0oAN/RYACbSgA7zrwATaUAH3yoACbSgA57pAAJhwAZ8gAEgiPw=',
      group3TwoDimensionalFilled: 'AAGa6dQAATaUAAG/osABNpQAAd514AE2lAAB98qAATaUAAHPdIABMOABnyAAASCI/A==',
    },
  },
  {
    name: 'box',
    columns: 32,
    rows: 16,
    isBlack: (x, y) => x === 0 || x === 31 || y === 0 || y === 15 || (x >= 8 && x <= 20 && y >= 5 && y <= 9),
    encodings: {
      group4: 'JqDVKA//+fBP////H//+MAEAEA==',
      group3OneDimensional: 'ABNQagATVAaABNUBoAE1QGgATVAaABNV4IdAAmq8EOgATVeCHQAJqvBDoAE1Xgh0ACaoDQAJqgNAAmqA0ACaoDQAJqgNAAmoNQA=',
      group3TwoDimensional: 'ABmoNQAKUBwAZqgNAAvABmqA0ACz4JgAzVeCHQAL8AGarwQ6ABfgAzVAaABeADNUBoAF4AM1QGgAUYA=',
      group3TwoDimensionalFilled: 'AAGag1AAAUoDgAGaoDQAAXgAAZqgNAABZ8EwAZqvBDoAAX4AAZqvBDoAAX4AAZqgNAABeAABmqA0AAF4AAGaoDQAAUY=',
    },
  },
  {
    name: 'sparse',
    columns: 64,
    rows: 6,
    isBlack: (x, y) => x % 17 === y % 3,
    encodings: {
      group4: 'JqjUjUjUrKqKqKqKQyqiqiqijhBCEEIQQhBDZVRVRVRSGVUVUVUUcAEAEA==',
      group3OneDimensional: 'ABNVUqlUiAAR1UqlUkAAuqlUqkcAE1VSqVSIABHVSqVSQAC6qVSqRw==',
      group3TwoDimensional: 'ABmqqVSqRAAJlVFVFVFIABuqlUqkcAEEEIQQhBCEEMAGOqlUqkgAEyqiqiqijg==',
      group3TwoDimensionalFilled: 'AAGaqpVKpEAAATKqKqKqKQABuqlUqkcAAQQQhBCEEIQQwAGOqlUqkgABMqoqoqoo4A==',
    },
  },
  {
    name: 'solidblack',
    columns: 8,
    rows: 4,
    isBlack: () => true,
    encodings: {
      group4: 'JqL+ACAC',
      group3OneDimensional: 'ABNRQATUUAE1FABNRQ==',
      group3TwoDimensional: 'ABmooALABmooALA=',
      group3TwoDimensionalFilled: 'AAGaigABYAGaigABYA==',
    },
  },
  {
    name: 'solidwhite',
    columns: 8,
    rows: 4,
    isBlack: () => false,
    encodings: {
      group4: '8AEAEA==',
      group3OneDimensional: 'ABmADMAGYAMw',
      group3TwoDimensional: 'ABzABQAcwAU=',
      group3TwoDimensionalFilled: 'AAHMAAFAAcwAAUA=',
    },
  },
  {
    name: 'wide',
    columns: 200,
    rows: 5,
    isBlack: (x, y) => ((x / 7 | 0) + y) % 3 === 0,
    encodings: {
      group4: 'JqM6DOgzoM6DOgzoM6DOgzoOJ8Z0GdBnQZ0GdBnQZ0GdBz4zoM6DOgzoM6DOgzoM6DOjJqM6DOgzoM6DOgzoM6DOgzoOJ8Z0GdBnQZ0GdBnQZ0GdBwAQAQ==',
      group3OneDimensional: 'ABNR6D0HoPQeg9B6D0HoOwAdB6D0HoPQeg9B6D0GgAHx6D0HoPQeg9B6D0HowATUeg9B6D0HoPQeg9B6DsAHQeg9B6D0HoPQeg9BoA==',
      group3TwoDimensional: 'ABmo9B6D0HoPQeg9B6D0HYAIT4zoM6DOgzoM6DOgzoM6DgA/HoPQeg9B6D0HoPQejABE1GdBnQZ0GdBnQZ0GdBnQZ0HAB6D0HoPQeg9B6D0HoNA=',
      group3TwoDimensionalFilled: 'AAGaj0HoPQeg9B6D0HoPQdgAAQnxnQZ0GdBnQZ0GdBnQZ0HAAfj0HoPQeg9B6D0HoPRgARNRnQZ0GdBnQZ0GdBnQZ0GdBwAB6D0HoPQeg9B6D0HoNAA=',
    },
  },
  {
    name: 'oddwidth',
    columns: 13,
    rows: 7,
    isBlack: (x, y) => (x * y) % 5 < 2,
    encodings: {
      group4: 'JqCTweFoIFQQKulpa4qKuIhzweFABABA',
      group3OneDimensional: 'ABNQQAE144xwATVOh06HTgAmqHTodOh0ACaqONwATUEABNeOMcA=',
      group3TwoDimensional: 'ABmoIACng8KADNU6HTodOAC0tLUAGaqONwAURDABmvHGOA==',
      group3TwoDimensionalFilled: 'AAGaggABTweFAAGap0OnQ6cAAWlpagABmqjjcAFEQwABmvHGOA==',
    },
  },
  {
    name: 'shrink',
    columns: 40,
    rows: 9,
    isBlack: (x, y) => y % 3 === 0 && x >= 4 && x <= 34,
    encodings: {
      group4: 'Ng0xzYNMc2DTHABABA==',
      group3OneDimensional: 'ABsGnAASkAEpABsGnAASkAEpABsGnAASkAEp',
      group3TwoDimensional: 'AB2DTgAIYAMpABGwaYAMpABQAdg04ACGADKQ',
      group3TwoDimensionalFilled: 'AAHYNOAAAQwAAZSAARsGmAABlIABQAHYNOAAAQwAAZSA',
    },
  },
  {
    name: 'longruns',
    columns: 2600,
    rows: 3,
    isBlack: (x, y) => x % 1900 < 1300 - y * 400,
    encodings: {
      group4: 'JqBSDQWhQBKAskDk2oU5A1AkbSyQNQJF5gAgAg==',
      group3OneDimensional: 'ABNQKQaGhQBKAsABNQOTahSBKAsABNQNQJG0sgagSLzA',
      group3TwoDimensional: 'ABmoFINDQoAlAWAApA5NqFMAGagagSNpZA1AkXmA',
      group3TwoDimensionalFilled: 'AAGagUg0NCgCUBYAAUgcm1CmAAGagagSNpZA1AkXmA==',
    },
  },
];
