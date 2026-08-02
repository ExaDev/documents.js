import { concatBytes } from '../bytes/writer';

// A hand-written CCITT Group 3/Group 4 fax decoder (ITU-T T.4 one-dimensional Modified Huffman and two-dimensional Modified READ coding; ITU-T T.6 Modified Modified READ, i.e. pure 2D with no EOLs), producing a packed 1-bit-per-pixel bitmap. This module has zero PDF knowledge, exactly like its src/image/ siblings: PDF's own /CCITTFaxDecode parameter dictionary is read in src/filters.ts and handed here as plain options, and TIFF's Group3Options/Group4Options describe the identical bitstreams.
//
// The code tables below are transcribed from T.4 Tables 2/3 (terminating and make-up codes for white and black runs), T.4 Table 4 (the extended make-up codes shared by both colours), and T.4 4.2.1.3.1/T.6 2.2.1 (the two-dimensional mode codes). They are written out as literal bit strings rather than pre-packed integers so each entry can be checked against the specification by eye.

const WHITE_TERMINATING_AND_MAKEUP: readonly (readonly [string, number])[] = [
  // Terminating codes, run lengths 0-63 (T.4 Table 2).
  ['00110101', 0],
  ['000111', 1],
  ['0111', 2],
  ['1000', 3],
  ['1011', 4],
  ['1100', 5],
  ['1110', 6],
  ['1111', 7],
  ['10011', 8],
  ['10100', 9],
  ['00111', 10],
  ['01000', 11],
  ['001000', 12],
  ['000011', 13],
  ['110100', 14],
  ['110101', 15],
  ['101010', 16],
  ['101011', 17],
  ['0100111', 18],
  ['0001100', 19],
  ['0001000', 20],
  ['0010111', 21],
  ['0000011', 22],
  ['0000100', 23],
  ['0101000', 24],
  ['0101011', 25],
  ['0010011', 26],
  ['0100100', 27],
  ['0011000', 28],
  ['00000010', 29],
  ['00000011', 30],
  ['00011010', 31],
  ['00011011', 32],
  ['00010010', 33],
  ['00010011', 34],
  ['00010100', 35],
  ['00010101', 36],
  ['00010110', 37],
  ['00010111', 38],
  ['00101000', 39],
  ['00101001', 40],
  ['00101010', 41],
  ['00101011', 42],
  ['00101100', 43],
  ['00101101', 44],
  ['00000100', 45],
  ['00000101', 46],
  ['00001010', 47],
  ['00001011', 48],
  ['01010010', 49],
  ['01010011', 50],
  ['01010100', 51],
  ['01010101', 52],
  ['00100100', 53],
  ['00100101', 54],
  ['01011000', 55],
  ['01011001', 56],
  ['01011010', 57],
  ['01011011', 58],
  ['01001010', 59],
  ['01001011', 60],
  ['00110010', 61],
  ['00110011', 62],
  ['00110100', 63],
  // Make-up codes, run lengths 64-1728 (T.4 Table 3).
  ['11011', 64],
  ['10010', 128],
  ['010111', 192],
  ['0110111', 256],
  ['00110110', 320],
  ['00110111', 384],
  ['01100100', 448],
  ['01100101', 512],
  ['01101000', 576],
  ['01100111', 640],
  ['011001100', 704],
  ['011001101', 768],
  ['011010010', 832],
  ['011010011', 896],
  ['011010100', 960],
  ['011010101', 1024],
  ['011010110', 1088],
  ['011010111', 1152],
  ['011011000', 1216],
  ['011011001', 1280],
  ['011011010', 1344],
  ['011011011', 1408],
  ['010011000', 1472],
  ['010011001', 1536],
  ['010011010', 1600],
  ['011000', 1664],
  ['010011011', 1728],
];

const BLACK_TERMINATING_AND_MAKEUP: readonly (readonly [string, number])[] = [
  // Terminating codes, run lengths 0-63 (T.4 Table 2).
  ['0000110111', 0],
  ['010', 1],
  ['11', 2],
  ['10', 3],
  ['011', 4],
  ['0011', 5],
  ['0010', 6],
  ['00011', 7],
  ['000101', 8],
  ['000100', 9],
  ['0000100', 10],
  ['0000101', 11],
  ['0000111', 12],
  ['00000100', 13],
  ['00000111', 14],
  ['000011000', 15],
  ['0000010111', 16],
  ['0000011000', 17],
  ['0000001000', 18],
  ['00001100111', 19],
  ['00001101000', 20],
  ['00001101100', 21],
  ['00000110111', 22],
  ['00000101000', 23],
  ['00000010111', 24],
  ['00000011000', 25],
  ['000011001010', 26],
  ['000011001011', 27],
  ['000011001100', 28],
  ['000011001101', 29],
  ['000001101000', 30],
  ['000001101001', 31],
  ['000001101010', 32],
  ['000001101011', 33],
  ['000011010010', 34],
  ['000011010011', 35],
  ['000011010100', 36],
  ['000011010101', 37],
  ['000011010110', 38],
  ['000011010111', 39],
  ['000001101100', 40],
  ['000001101101', 41],
  ['000011011010', 42],
  ['000011011011', 43],
  ['000001010100', 44],
  ['000001010101', 45],
  ['000001010110', 46],
  ['000001010111', 47],
  ['000001100100', 48],
  ['000001100101', 49],
  ['000001010010', 50],
  ['000001010011', 51],
  ['000000100100', 52],
  ['000000110111', 53],
  ['000000111000', 54],
  ['000000100111', 55],
  ['000000101000', 56],
  ['000001011000', 57],
  ['000001011001', 58],
  ['000000101011', 59],
  ['000000101100', 60],
  ['000001011010', 61],
  ['000001100110', 62],
  ['000001100111', 63],
  // Make-up codes, run lengths 64-1728 (T.4 Table 3).
  ['0000001111', 64],
  ['000011001000', 128],
  ['000011001001', 192],
  ['000001011011', 256],
  ['000000110011', 320],
  ['000000110100', 384],
  ['000000110101', 448],
  ['0000001101100', 512],
  ['0000001101101', 576],
  ['0000001001010', 640],
  ['0000001001011', 704],
  ['0000001001100', 768],
  ['0000001001101', 832],
  ['0000001110010', 896],
  ['0000001110011', 960],
  ['0000001110100', 1024],
  ['0000001110101', 1088],
  ['0000001110110', 1152],
  ['0000001110111', 1216],
  ['0000001010010', 1280],
  ['0000001010011', 1344],
  ['0000001010100', 1408],
  ['0000001010101', 1472],
  ['0000001011010', 1536],
  ['0000001011011', 1600],
  ['0000001100100', 1664],
  ['0000001100101', 1728],
];

// Extended make-up codes, run lengths 1792-2560, identical for white and black runs (T.4 Table 4).
const EXTENDED_MAKEUP: readonly (readonly [string, number])[] = [
  ['00000001000', 1792],
  ['00000001100', 1856],
  ['00000001101', 1920],
  ['000000010010', 1984],
  ['000000010011', 2048],
  ['000000010100', 2112],
  ['000000010101', 2176],
  ['000000010110', 2240],
  ['000000010111', 2304],
  ['000000011100', 2368],
  ['000000011101', 2432],
  ['000000011110', 2496],
  ['000000011111', 2560],
];

// A run length below this is a terminating code, which ends the run; anything at or above it is a make-up code, which must be followed by further codes until a terminating one arrives.
const TERMINATING_RUN_LIMIT = 64;

// The longest code in any table above is 13 bits (black make-up); one spare bit lets an invalid code be recognised as invalid rather than silently matching a shorter prefix.
const MAX_RUN_CODE_BITS = 14;

// The two-dimensional mode codes (T.4 4.2.1.3.1, reused unchanged by T.6). Vertical modes carry the signed offset of a1 from b1.
type ModeKind = 'pass' | 'horizontal' | 'vertical' | 'extension';

interface ModeCode {
  readonly kind: ModeKind;
  readonly delta: number;
}

const MODE_CODES: readonly (readonly [string, ModeCode])[] = [
  ['1', { kind: 'vertical', delta: 0 }],
  ['011', { kind: 'vertical', delta: 1 }],
  ['010', { kind: 'vertical', delta: -1 }],
  ['001', { kind: 'horizontal', delta: 0 }],
  ['0001', { kind: 'pass', delta: 0 }],
  ['000011', { kind: 'vertical', delta: 2 }],
  ['000010', { kind: 'vertical', delta: -2 }],
  ['0000011', { kind: 'vertical', delta: 3 }],
  ['0000010', { kind: 'vertical', delta: -3 }],
  ['0000001', { kind: 'extension', delta: 0 }],
];

const MAX_MODE_CODE_BITS = 7;

// An EOL is eleven or more 0 bits followed by a single 1 (T.4 4.1.2): exactly eleven in the code itself, with any number of extra 0 fill bits permitted in front of it so the following line can start on a byte boundary.
const EOL_MIN_ZEROS = 11;

// A generous ceiling on how much zero fill may precede an EOL before the run of zeros is treated as corrupt data rather than fill. T.4 allows fill only up to the line's own minimum transmission time, which no real encoder comes close to spending on a single line.
const MAX_FILL_ZERO_BITS = 512;

function codeKey(bitLength: number, code: number): number {
  return bitLength * 2 ** 16 + code;
}

function buildCodeTable(...groups: readonly (readonly (readonly [string, number])[])[]): ReadonlyMap<number, number> {
  const table = new Map<number, number>();
  for (const group of groups) {
    for (const [bits, run] of group) {
      table.set(codeKey(bits.length, Number.parseInt(bits, 2)), run);
    }
  }
  return table;
}

const WHITE_CODE_TABLE = buildCodeTable(WHITE_TERMINATING_AND_MAKEUP, EXTENDED_MAKEUP);
const BLACK_CODE_TABLE = buildCodeTable(BLACK_TERMINATING_AND_MAKEUP, EXTENDED_MAKEUP);

const MODE_CODE_TABLE: ReadonlyMap<number, ModeCode> = new Map(MODE_CODES.map(([bits, mode]) => [codeKey(bits.length, Number.parseInt(bits, 2)), mode]));

// --- The bit reader: MSB-first within each byte, the order every T.4/T.6 code is written in. ---

const BITS_PER_BYTE = 8;

class CcittBitReader {
  private position = 0;

  constructor(private readonly data: Uint8Array<ArrayBuffer>) {}

  get bitPosition(): number {
    return this.position;
  }

  set bitPosition(value: number) {
    this.position = value;
  }

  get exhausted(): boolean {
    return this.position >= this.data.length * BITS_PER_BYTE;
  }

  // Returns the next bit, or -1 once the data is exhausted.
  readBit(): number {
    if (this.exhausted) {
      return -1;
    }
    const byte = this.data[this.position >> 3] ?? 0;
    const bit = (byte >> (7 - (this.position & 7))) & 1;
    this.position++;
    return bit;
  }

  alignToByte(): void {
    this.position = Math.ceil(this.position / BITS_PER_BYTE) * BITS_PER_BYTE;
  }

  // True once what is left is the final byte's own zero padding: an encoded stream is always a whole number of bytes, so a sub-byte tail of 0 bits is the padding that ended it, not a truncated code.
  get atZeroPadding(): boolean {
    const remaining = this.data.length * BITS_PER_BYTE - this.position;
    if (remaining <= 0) {
      return true;
    }
    if (remaining >= BITS_PER_BYTE) {
      return false;
    }
    const lastByte = this.data[this.data.length - 1] ?? 0;
    return (lastByte & ((1 << remaining) - 1)) === 0;
  }
}

// --- Code decoding. ---

// One white or black code: a run length, or undefined for an unrecognised code or exhausted data.
function readSingleRunCode(reader: CcittBitReader, table: ReadonlyMap<number, number>): number | undefined {
  let code = 0;
  for (let bitLength = 1; bitLength <= MAX_RUN_CODE_BITS; bitLength++) {
    const bit = reader.readBit();
    if (bit < 0) {
      return undefined;
    }
    code = (code << 1) | bit;
    const run = table.get(codeKey(bitLength, code));
    if (run !== undefined) {
      return run;
    }
  }
  return undefined;
}

// A complete run: zero or more make-up codes followed by exactly one terminating code.
function readRunLength(reader: CcittBitReader, black: boolean): number | undefined {
  const table = black ? BLACK_CODE_TABLE : WHITE_CODE_TABLE;
  let total = 0;
  for (;;) {
    const run = readSingleRunCode(reader, table);
    if (run === undefined) {
      return undefined;
    }
    total += run;
    if (run < TERMINATING_RUN_LIMIT) {
      return total;
    }
  }
}

type ModeResult = ModeCode | { readonly kind: 'eol-prefix'; readonly delta: 0 } | { readonly kind: 'invalid'; readonly delta: 0 };

// Reads one two-dimensional mode code. A run of seven 0 bits is not a mode code at all but the start of an EOL/EOFB, which the caller handles from the rewound position.
function readModeCode(reader: CcittBitReader): ModeResult {
  let code = 0;
  for (let bitLength = 1; bitLength <= MAX_MODE_CODE_BITS; bitLength++) {
    const bit = reader.readBit();
    if (bit < 0) {
      return { kind: 'invalid', delta: 0 };
    }
    code = (code << 1) | bit;
    const mode = MODE_CODE_TABLE.get(codeKey(bitLength, code));
    if (mode !== undefined) {
      return mode;
    }
  }
  return code === 0 ? { kind: 'eol-prefix', delta: 0 } : { kind: 'invalid', delta: 0 };
}

// Consumes an EOL (with any leading zero fill) if one sits at the current position, leaving the reader untouched otherwise.
function tryReadEol(reader: CcittBitReader): boolean {
  const start = reader.bitPosition;
  let zeros = 0;
  for (;;) {
    const bit = reader.readBit();
    if (bit < 0) {
      reader.bitPosition = start;
      return false;
    }
    if (bit === 0) {
      zeros++;
      if (zeros > MAX_FILL_ZERO_BITS) {
        reader.bitPosition = start;
        return false;
      }
      continue;
    }
    if (zeros >= EOL_MIN_ZEROS) {
      return true;
    }
    reader.bitPosition = start;
    return false;
  }
}

// --- Row decoding. ---

// A decoded row is its list of changing element positions: transitions[0] is where the row turns from white to black, transitions[1] back to white, and so on. Every row starts white, so the colour after transition index i is black for even i and white for odd i.

// b1, per T.4 4.2.1.3.1: the first changing element on the reference line to the right of a0 and of opposite colour to a0's own colour. Returned as an index so the caller can take b2 as the element straight after it.
function findB1Index(reference: readonly number[], a0: number, color: number): number {
  let index = 0;
  while (index < reference.length && reference[index]! <= a0) {
    index++;
  }
  if (index < reference.length && (index & 1) !== color) {
    index++;
  }
  return index;
}

function elementAt(reference: readonly number[], index: number, columns: number): number {
  return index < reference.length ? reference[index]! : columns;
}

// One-dimensional (Modified Huffman) row: alternating white and black runs, starting white.
function decode1dRow(reader: CcittBitReader, columns: number): number[] | undefined {
  const transitions: number[] = [];
  let position = 0;
  let black = false;
  while (position < columns) {
    const run = readRunLength(reader, black);
    if (run === undefined) {
      return undefined;
    }
    position = Math.min(columns, position + run);
    transitions.push(position);
    black = !black;
  }
  return transitions;
}

// Two-dimensional (Modified READ) row, coded against the row above it.
function decode2dRow(reader: CcittBitReader, reference: readonly number[], columns: number): number[] | undefined {
  const transitions: number[] = [];
  let a0 = -1; // the imaginary white changing element just before the first pixel (T.4 4.2.1.3.1)
  let color = 0; // 0 = white, 1 = black
  // A row cannot hold more changing elements than it has pixels; exceeding that means the bitstream stopped making sense and is no longer advancing.
  const maxTransitions = columns + 2;
  while (a0 < columns) {
    if (transitions.length > maxTransitions) {
      return undefined;
    }
    const mode = readModeCode(reader);
    if (mode.kind === 'invalid' || mode.kind === 'extension') {
      return undefined;
    }
    if (mode.kind === 'eol-prefix') {
      return undefined;
    }
    const b1Index = findB1Index(reference, a0, color);
    const b1 = elementAt(reference, b1Index, columns);
    const b2 = elementAt(reference, b1Index + 1, columns);
    if (mode.kind === 'pass') {
      // The run of `color` extends past b2: no changing element is recorded and the colour does not flip.
      a0 = b2;
      continue;
    }
    if (mode.kind === 'horizontal') {
      const start = a0 < 0 ? 0 : a0;
      const firstRun = readRunLength(reader, color === 1);
      if (firstRun === undefined) {
        return undefined;
      }
      const secondRun = readRunLength(reader, color !== 1);
      if (secondRun === undefined) {
        return undefined;
      }
      const a1 = Math.min(columns, start + firstRun);
      const a2 = Math.min(columns, a1 + secondRun);
      transitions.push(a1, a2);
      a0 = a2;
      continue;
    }
    const a1 = Math.min(columns, Math.max(0, b1 + mode.delta));
    transitions.push(a1);
    a0 = a1;
    color ^= 1;
  }
  return transitions;
}

// --- Rendering. ---

function setBitRun(row: Uint8Array<ArrayBuffer>, from: number, to: number, bit: number): void {
  for (let x = from; x < to; x++) {
    const index = x >> 3;
    const mask = 0x80 >> (x & 7);
    if (bit === 1) {
      row[index] = (row[index] ?? 0) | mask;
    } else {
      row[index] = (row[index] ?? 0) & ~mask;
    }
  }
}

// Both row decoders above only stop once a0 has reached `columns`, and every mode that can take it there (vertical, horizontal, and the 1D run loop) records a changing element at the clamped position -- so a row's own last transition is always `columns` itself, and there is never a trailing run left to paint past the final one.
function renderRow(transitions: readonly number[], columns: number, blackBit: number): Uint8Array<ArrayBuffer> {
  const row = new Uint8Array(Math.ceil(columns / 8));
  if (blackBit === 0) {
    row.fill(0xff); // white is the 1 bit, so start the row (padding bits included) white
  }
  let position = 0;
  let black = false;
  for (const transition of transitions) {
    const end = Math.min(transition, columns);
    if (black && end > position) {
      setBitRun(row, position, end, blackBit);
    }
    position = Math.max(position, end);
    black = !black;
  }
  return row;
}

// --- The public entry point. ---

export interface CcittFaxOptions {
  // K < 0 selects pure two-dimensional coding (T.6, Group 4); K = 0 selects pure one-dimensional coding (T.4, Group 3 1D); K > 0 selects mixed coding where a tag bit after each EOL says whether the next line is 1D or 2D (T.4, Group 3 2D). Matches PDF's /K and TIFF's Group3Options bit 0.
  readonly k?: number;
  readonly columns?: number;
  // Zero (the default) means "decode until the data or an end-of-block marker runs out" rather than "no rows".
  readonly rows?: number;
  // False (the default) puts black pixels in 0 bits, which is what a /DeviceGray 1-bit image wants; true inverts that.
  readonly blackIs1?: boolean;
  readonly encodedByteAlign?: boolean;
  readonly onWarning?: (message: string) => void;
}

export interface CcittFaxImage {
  // Packed 1 bit per pixel, MSB first, each row padded out to a whole number of bytes -- the same layout a PDF image with /BitsPerComponent 1 expects.
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly columns: number;
  readonly rows: number;
}

const DEFAULT_COLUMNS = 1728; // ISO 32000-1 Table 11, and the standard fax scan line width T.4 is written around

export function decodeCcittFax(data: Uint8Array<ArrayBuffer>, options: CcittFaxOptions = {}): CcittFaxImage {
  const columns = options.columns ?? DEFAULT_COLUMNS;
  const requestedRows = options.rows ?? 0;
  const k = options.k ?? 0;
  const blackBit = options.blackIs1 === true ? 1 : 0;
  const encodedByteAlign = options.encodedByteAlign === true;
  const warn = options.onWarning;
  if (columns <= 0) {
    return { bytes: new Uint8Array(0), columns: 0, rows: 0 };
  }

  const reader = new CcittBitReader(data);
  const rows: Uint8Array<ArrayBuffer>[] = [];
  let reference: readonly number[] = []; // the imaginary all-white line above the first row
  let nextRowIs1d = k >= 0; // only meaningful for K > 0, where each EOL's tag bit overrides it

  while (requestedRows === 0 || rows.length < requestedRows) {
    if (encodedByteAlign) {
      reader.alignToByte();
    }
    // T.4 precedes every line with an EOL and T.6 ends the whole block with two of them; consuming any EOL sitting here covers both, and a second one straight after it is the end-of-block marker.
    if (tryReadEol(reader)) {
      if (k > 0) {
        const tag = reader.readBit();
        if (tag < 0) {
          break;
        }
        nextRowIs1d = tag === 1;
      }
      if (tryReadEol(reader)) {
        break; // EOFB / RTC
      }
    }
    if (reader.atZeroPadding) {
      break;
    }
    const transitions = nextRowIs1d ? decode1dRow(reader, columns) : decode2dRow(reader, reference, columns);
    if (transitions === undefined) {
      if (warn !== undefined) {
        warn(`CCITT fax data became undecodable at row ${String(rows.length)}; keeping the ${String(rows.length)} row(s) recovered so far`);
      }
      break;
    }
    rows.push(renderRow(transitions, columns, blackBit));
    reference = transitions;
  }

  if (requestedRows > 0 && rows.length < requestedRows) {
    if (warn !== undefined && rows.length > 0) {
      warn(`CCITT fax data ended after ${String(rows.length)} of ${String(requestedRows)} declared rows; padding the remainder white`);
    }
    const bytesPerRow = Math.ceil(columns / 8);
    while (rows.length < requestedRows) {
      const blank = new Uint8Array(bytesPerRow);
      if (blackBit === 0) {
        blank.fill(0xff);
      }
      rows.push(blank);
    }
  }

  return { bytes: concatBytes(rows), columns, rows: rows.length };
}
