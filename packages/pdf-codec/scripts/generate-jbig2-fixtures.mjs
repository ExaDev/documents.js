#!/usr/bin/env node
// Regenerates src/test-support/jbig2.ts: real JBIG2 embedded streams for src/image/jbig2.test.ts, src/filters.test.ts and src/images-read.test.ts to decode back.
//
// Run with `node scripts/generate-jbig2-fixtures.mjs`, which requires jbig2enc, jbig2dec, and libtiff on PATH (`brew install jbig2enc jbig2dec libtiff netpbm`). Not part of `pnpm build`/`pnpm test` -- the generated .ts file is committed like any other checked-in generated artifact, so the test suite needs neither those tools nor a filesystem read to run.
//
// Two independent producers back the fixtures, for the reason scripts/generate-encrypted-pdf-fixtures.mjs states about its own: a stream this package encoded itself would let a mistake in the arithmetic coder or the template context ordering cancel out between an encoder and a decoder that shared it, and pass anyway.
//
//   1. jbig2enc (Adam Langley's encoder, the one that produces essentially every JBIG2-in-PDF in the wild) writes the generic-region and symbol/text-region fixtures. Nothing in this repository influences those bytes.
//   2. libtiff's own Group 4 coder, via tiffcp, writes the MMR-coded generic region's payload -- the same producer src/test-support/ccitt-fax.ts already uses.
//
// jbig2enc only ever emits GBTEMPLATE 0, so templates 1-3 (and a non-nominal AT placement) are encoded here by a hand-written MQ *encoder*, restated from T.88 Annex E's own CODEMPS/CODELPS/BYTEOUT/FLUSH procedures. That is deliberately NOT trusted on its own: every stream this script produces, hand-encoded ones included, is decoded by jbig2dec (Ghostscript's independent JBIG2 implementation) and must reproduce the source bitmap exactly before it is written out, and the bitmap recorded as each fixture's expected output is jbig2dec's, not this script's.
//
// What that cross-check does and does not establish, stated precisely because it is easy to overclaim. It pins the SET of template positions and their offsets: a decoder reading a different set of neighbours cannot track the encoder's adaptive state at all. It does NOT pin the ORDER those positions are concatenated in, and no differential test can -- a context index is just a label for a neighbourhood pattern, and any consistent permutation of the labels cancels out between any encoder and decoder that each use their own consistently. The same caveat applies to the fixed typical-prediction pseudo-contexts, which share one adaptive state array with the real pattern contexts: a wrong constant still round-trips whenever it happens not to collide with a pattern the test image produces. Only the fixtures produced by jbig2enc itself (which uses the specification's own constants) genuinely pin those, and only for the template jbig2enc emits, GBTEMPLATE 0.
//
// This script is deliberately outside tsconfig.json's "include" and eslint.config.ts's linted set (see the "scripts" entry in both), matching scripts/generate-encrypted-pdf-fixtures.mjs.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outputPath = join(here, '..', 'src', 'test-support', 'jbig2.ts');

// --- The source bitmaps every fixture is built from. ---

const SOURCE_BITMAPS = [
  { name: 'checker', width: 16, height: 8, isBlack: (x, y) => (((x / 2) | 0) + ((y / 2) | 0)) % 2 === 0 },
  { name: 'diagonal', width: 24, height: 12, isBlack: (x, y) => x === y || x === y + 1 || x + y === 20 },
  { name: 'box', width: 32, height: 16, isBlack: (x, y) => x === 0 || x === 31 || y === 0 || y === 15 || (x >= 8 && x <= 20 && y >= 5 && y <= 9) },
  { name: 'sparse', width: 64, height: 6, isBlack: (x, y) => x % 17 === y % 3 },
  { name: 'oddwidth', width: 13, height: 7, isBlack: (x, y) => (x * y) % 5 < 2 },
  { name: 'stripes', width: 40, height: 24, isBlack: (x, y) => y % 3 === 0 || (x > 10 && x < 30 && y > 8 && y < 16) },
  { name: 'wide', width: 200, height: 5, isBlack: (x, y) => (((x / 7) | 0) + y) % 3 === 0 },
  { name: 'text', width: 96, height: 26, isBlack: letterShapes },
];

// Three block letters at three different x positions, two of them the same shape -- so jbig2enc's symbol mode has a genuine repeated symbol to put in a dictionary and place twice.
function letterShapes(x, y) {
  const glyph = (ox) => {
    const lx = x - ox;
    return lx >= 0 && lx < 18 && y >= 3 && y < 23 && (lx < 4 || lx >= 14 || (y >= 11 && y < 15));
  };
  const bar = (ox) => {
    const lx = x - ox;
    return lx >= 0 && lx < 18 && y >= 3 && y < 23 && (y < 7 || y >= 19 || (lx >= 7 && lx < 11));
  };
  return glyph(2) || bar(30) || glyph(58);
}

function bitmapOf(source) {
  const rows = [];
  for (let y = 0; y < source.height; y++) {
    let row = '';
    for (let x = 0; x < source.width; x++) {
      row += source.isBlack(x, y) ? '#' : '.';
    }
    rows.push(row);
  }
  return rows;
}

// --- Portable bitmap (P4) input for jbig2enc and pnmtotiff: 1 bit per pixel, MSB first, 1 meaning black. ---

function writePbm(path, source) {
  const bytesPerRow = Math.ceil(source.width / 8);
  const data = new Uint8Array(bytesPerRow * source.height);
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      if (source.isBlack(x, y)) {
        data[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }
  writeFileSync(path, Buffer.concat([Buffer.from(`P4\n${source.width} ${source.height}\n`, 'ascii'), Buffer.from(data)]));
}

function readPbm(path) {
  const bytes = readFileSync(path);
  if (bytes[0] !== 0x50 || bytes[1] !== 0x34) {
    throw new Error(`${path} is not a binary PBM`);
  }
  // Header: "P4", whitespace, width, whitespace, height, one whitespace byte, then the packed rows. Comment lines are not emitted by anything this script drives.
  let position = 2;
  const nextNumber = () => {
    while (position < bytes.length && /\s/.test(String.fromCharCode(bytes[position]))) position++;
    let value = 0;
    while (position < bytes.length && /[0-9]/.test(String.fromCharCode(bytes[position]))) {
      value = value * 10 + (bytes[position] - 0x30);
      position++;
    }
    return value;
  };
  const width = nextNumber();
  const height = nextNumber();
  position++;
  const bytesPerRow = Math.ceil(width / 8);
  const rows = [];
  for (let y = 0; y < height; y++) {
    let row = '';
    for (let x = 0; x < width; x++) {
      row += ((bytes[position + y * bytesPerRow + (x >> 3)] >> (7 - (x & 7))) & 1) === 1 ? '#' : '.';
    }
    rows.push(row);
  }
  return { width, height, rows };
}

// --- A hand-written MQ encoder (ITU-T T.88 Annex E), used only for the templates jbig2enc will not emit. ---

const QE_STATES = [
  [0x5601, 1, 1, 1], [0x3401, 2, 6, 0], [0x1801, 3, 9, 0], [0x0ac1, 4, 12, 0], [0x0521, 5, 29, 0], [0x0221, 38, 33, 0],
  [0x5601, 7, 6, 1], [0x5401, 8, 14, 0], [0x4801, 9, 14, 0], [0x3801, 10, 14, 0], [0x3001, 11, 17, 0], [0x2401, 12, 18, 0],
  [0x1c01, 13, 20, 0], [0x1601, 29, 21, 0], [0x5601, 15, 14, 1], [0x5401, 16, 14, 0], [0x5101, 17, 15, 0], [0x4801, 18, 16, 0],
  [0x3801, 19, 17, 0], [0x3401, 20, 18, 0], [0x3001, 21, 19, 0], [0x2801, 22, 19, 0], [0x2401, 23, 20, 0], [0x2201, 24, 21, 0],
  [0x1c01, 25, 22, 0], [0x1801, 26, 23, 0], [0x1601, 27, 24, 0], [0x1401, 28, 25, 0], [0x1201, 29, 26, 0], [0x1101, 30, 27, 0],
  [0x0ac1, 31, 28, 0], [0x09c1, 32, 29, 0], [0x08a1, 33, 30, 0], [0x0521, 34, 31, 0], [0x0441, 35, 32, 0], [0x02a1, 36, 33, 0],
  [0x0221, 37, 34, 0], [0x0141, 38, 35, 0], [0x0111, 39, 36, 0], [0x0085, 40, 37, 0], [0x0049, 41, 38, 0], [0x0025, 42, 39, 0],
  [0x0015, 43, 40, 0], [0x0009, 44, 41, 0], [0x0005, 45, 42, 0], [0x0001, 45, 43, 0], [0x5601, 46, 46, 0],
];

class MqEncoder {
  constructor() {
    this.out = [];
    this.bp = -1; // T.88 INITENC starts one byte before the output, so the first BYTEOUT lands on index 0.
    this.a = 0x8000;
    this.c = 0;
    this.ct = 12;
  }

  b() {
    return this.bp < 0 ? 0 : this.out[this.bp];
  }

  setB(value) {
    if (this.bp >= 0) this.out[this.bp] = value & 0xff;
  }

  byteOut() {
    if (this.b() === 0xff) {
      this.bp++;
      this.setB(this.c >>> 20);
      this.c &= 0xfffff;
      this.ct = 7;
      return;
    }
    if (this.c > 0x7ffffff) {
      this.setB(this.b() + 1);
      if (this.b() === 0xff) {
        this.c &= 0x7ffffff;
        this.bp++;
        this.setB(this.c >>> 20);
        this.c &= 0xfffff;
        this.ct = 7;
        return;
      }
    }
    this.bp++;
    this.setB(this.c >>> 19);
    this.c &= 0x7ffff;
    this.ct = 8;
  }

  renorm() {
    do {
      this.a = (this.a << 1) & 0xffff;
      this.c = (this.c << 1) >>> 0;
      this.ct--;
      if (this.ct === 0) this.byteOut();
    } while ((this.a & 0x8000) === 0);
  }

  encode(states, contextIndex, decision) {
    const state = states[contextIndex];
    let index = state >> 1;
    let mps = state & 1;
    const [qe, nmps, nlps, sw] = QE_STATES[index];
    if (decision === mps) {
      // CODEMPS (T.88 Figure E.6).
      this.a -= qe;
      if ((this.a & 0x8000) === 0) {
        if (this.a < qe) this.a = qe;
        else this.c = (this.c + qe) >>> 0;
        index = nmps;
        states[contextIndex] = (index << 1) | mps;
        this.renorm();
      } else {
        this.c = (this.c + qe) >>> 0;
      }
      return;
    }
    // CODELPS (T.88 Figure E.7).
    this.a -= qe;
    if (this.a < qe) this.c = (this.c + qe) >>> 0;
    else this.a = qe;
    if (sw === 1) mps = 1 - mps;
    index = nlps;
    states[contextIndex] = (index << 1) | mps;
    this.renorm();
  }

  // FLUSH (T.88 Figure E.11), including the 0xFF 0xAC terminator every real encoder's output ends with.
  flush() {
    const tempC = (this.c + this.a) >>> 0;
    this.c = (this.c | 0xffff) >>> 0;
    if (this.c >= tempC) this.c = (this.c - 0x8000) >>> 0;
    this.c = (this.c << this.ct) >>> 0;
    this.byteOut();
    this.c = (this.c << this.ct) >>> 0;
    this.byteOut();
    if (this.b() !== 0xff) {
      this.bp++;
      this.setB(0xff);
    }
    this.bp++;
    this.setB(0xac);
    return Uint8Array.from(this.out.slice(0, this.bp + 1));
  }
}

// The same template orderings src/image/jbig2-generic.ts uses, restated independently here (most-significant context bit first) so the encoder and the decoder under test are not reading one shared table.
const GENERIC_TEMPLATES = [
  [['a', 3], [-1, -2], [0, -2], [1, -2], ['a', 2], ['a', 1], [-2, -1], [-1, -1], [0, -1], [1, -1], [2, -1], ['a', 0], [-4, 0], [-3, 0], [-2, 0], [-1, 0]],
  [[-1, -2], [0, -2], [1, -2], [2, -2], [-2, -1], [-1, -1], [0, -1], [1, -1], [2, -1], ['a', 0], [-3, 0], [-2, 0], [-1, 0]],
  [[-1, -2], [0, -2], [1, -2], [-2, -1], [-1, -1], [0, -1], [1, -1], ['a', 0], [-2, 0], [-1, 0]],
  [[-3, -1], [-2, -1], [-1, -1], [0, -1], [1, -1], ['a', 0], [-4, 0], [-3, 0], [-2, 0], [-1, 0]],
];
const GENERIC_SLTP_CONTEXT = [0x9b25, 0x0795, 0x00e5, 0x0195];

function encodeGenericBitmapInto(mq, states, source, template, at, tpgdon) {
  const pixel = (x, y) => (x < 0 || x >= source.width || y < 0 || y >= source.height ? 0 : source.isBlack(x, y) ? 1 : 0);
  const positions = GENERIC_TEMPLATES[template];
  let ltp = 0;
  for (let y = 0; y < source.height; y++) {
    if (tpgdon) {
      // A row identical to the one above it is coded as a single "typical" flag rather than as pixels.
      let typical = y > 0;
      for (let x = 0; typical && x < source.width; x++) {
        if (pixel(x, y) !== pixel(x, y - 1)) typical = false;
      }
      const sltp = typical === (ltp === 1) ? 0 : 1;
      mq.encode(states, GENERIC_SLTP_CONTEXT[template], sltp);
      ltp ^= sltp;
      if (ltp === 1) continue;
    }
    for (let x = 0; x < source.width; x++) {
      let context = 0;
      for (const position of positions) {
        const [dx, dy] = position[0] === 'a' ? [at[position[1]].x, at[position[1]].y] : position;
        context = (context << 1) | pixel(x + dx, y + dy);
      }
      mq.encode(states, context, pixel(x, y));
    }
  }
}

function encodeGenericRegion(source, template, at, tpgdon) {
  const mq = new MqEncoder();
  encodeGenericBitmapInto(mq, new Uint8Array(1 << 16), source, template, at, tpgdon);
  return mq.flush();
}

// --- The refinement template orderings, again restated independently of src/image/jbig2-generic.ts. 'd' reads the bitmap being coded, 'r' the reference. ---

const REFINEMENT_TEMPLATES = [
  [
    ['d', 0, -1], ['d', 1, -1], ['d', -1, 0], ['da', 0],
    ['r', 0, -1], ['r', 1, -1], ['r', -1, 0], ['r', 0, 0], ['r', 1, 0], ['r', -1, 1], ['r', 0, 1], ['r', 1, 1], ['ra', 1],
  ],
  [
    ['d', -1, -1], ['d', 0, -1], ['d', 1, -1], ['d', -1, 0],
    ['r', 0, -1], ['r', -1, 0], ['r', 0, 0], ['r', 1, 0], ['r', 0, 1], ['r', 1, 1],
  ],
];
const NOMINAL_REFINEMENT_AT = [{ x: -1, y: -1 }, { x: -1, y: -1 }];

// Codes `target` as a refinement of `reference`, both plain arrays of rows of 0/1. `dx`/`dy` are the reference's own offset within the target, matching T.88's GRREFERENCEDX/DY.
function encodeRefinementInto(mq, states, target, reference, template, at, dx, dy) {
  const width = target[0].length;
  const height = target.length;
  const refWidth = reference[0].length;
  const refHeight = reference.length;
  const targetPixel = (x, y) => (x < 0 || x >= width || y < 0 || y >= height ? 0 : target[y][x]);
  const refPixel = (x, y) => (x < 0 || x >= refWidth || y < 0 || y >= refHeight ? 0 : reference[y][x]);
  const positions = REFINEMENT_TEMPLATES[template];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let context = 0;
      for (const position of positions) {
        if (position[0] === 'd') context = (context << 1) | targetPixel(x + position[1], y + position[2]);
        else if (position[0] === 'r') context = (context << 1) | refPixel(x - dx + position[1], y - dy + position[2]);
        else if (position[0] === 'da') context = (context << 1) | targetPixel(x + at[position[1]].x, y + at[position[1]].y);
        else context = (context << 1) | refPixel(x - dx + at[position[1]].x, y - dy + at[position[1]].y);
      }
      mq.encode(states, context, targetPixel(x, y));
    }
  }
}

// --- The arithmetic integer and symbol-ID encoding procedures (T.88 Annex A), mirrors of the decoding procedures. ---

const INTEGER_RANGES = [
  [2, 0], [4, 4], [6, 20], [8, 84], [12, 340], [32, 4436],
];

// `value` is null for the out-of-band symbol A.2 step 5 defines.
function encodeInteger(mq, states, value) {
  let prev = 1;
  const putBit = (bit) => {
    mq.encode(states, prev, bit);
    prev = prev < 256 ? (prev << 1) | bit : ((((prev << 1) | bit) & 511) | 256);
  };
  const sign = value === null || value < 0 ? 1 : 0;
  const magnitude = value === null ? 0 : Math.abs(value);
  putBit(sign);
  // The ranges are contiguous and increasing (0-3, 4-19, 20-83, 84-339, 340-4435, then the 32-bit tail), so the first whose window ends past the magnitude is the shortest encoding of it.
  const range = INTEGER_RANGES.findIndex(([bits, offset]) => magnitude < offset + 2 ** bits);
  if (range < 0) throw new Error(`integer ${String(value)} is outside every T.88 A.2 range`);
  for (let i = 0; i < range; i++) putBit(1);
  if (range < INTEGER_RANGES.length - 1) putBit(0);
  const [bits, offset] = INTEGER_RANGES[range];
  const suffix = magnitude - offset;
  for (let i = bits - 1; i >= 0; i--) putBit(Math.floor(suffix / 2 ** i) % 2);
}

function encodeSymbolId(mq, states, id, codeLength) {
  let prev = 1;
  for (let i = codeLength - 1; i >= 0; i--) {
    const bit = (id >> i) & 1;
    mq.encode(states, prev, bit);
    prev = (prev << 1) | bit;
  }
}

function symbolCodeLength(count) {
  let bits = 1;
  while (1 << bits < count) bits++;
  return bits;
}

function integerStates() {
  return new Uint8Array(1 << 9);
}

// --- Symbol dictionary and text region encoders (T.88 6.5 and 6.4), arithmetic form. ---

// A symbol is a plain array of rows of 0/1. `sourceOf` adapts one to the {width, height, isBlack} shape the generic bitmap coder above takes.
function sourceOf(rows) {
  return { width: rows[0].length, height: rows.length, isBlack: (x, y) => rows[y][x] === 1 };
}

// Codes a symbol dictionary whose symbols are grouped into height classes, exporting all of them. T.88 6.5.5's own loop: one IADH delta per height class, one IADW delta per symbol, an OOB IADW to close the class, then the export runs.
function encodeSymbolDictionary(symbols, template, at) {
  const mq = new MqEncoder();
  const iadh = integerStates();
  const iadw = integerStates();
  const iaex = integerStates();
  const generic = new Uint8Array(1 << 16);

  // Height classes must be transmitted in increasing height order, and within a class in increasing width order.
  const byHeight = new Map();
  for (const symbol of symbols) {
    const height = symbol.length;
    if (!byHeight.has(height)) byHeight.set(height, []);
    byHeight.get(height).push(symbol);
  }
  const heights = [...byHeight.keys()].sort((a, b) => a - b);
  const order = [];
  let previousHeight = 0;
  for (const height of heights) {
    encodeInteger(mq, iadh, height - previousHeight);
    previousHeight = height;
    const classSymbols = byHeight.get(height).slice().sort((a, b) => a[0].length - b[0].length);
    let previousWidth = 0;
    for (const symbol of classSymbols) {
      encodeInteger(mq, iadw, symbol[0].length - previousWidth);
      previousWidth = symbol[0].length;
      encodeGenericBitmapInto(mq, generic, sourceOf(symbol), template, at, false);
      order.push(symbol);
    }
    encodeInteger(mq, iadw, null); // OOB closes the height class.
  }

  // Export every symbol: a zero-length "not exported" run, then one run covering them all.
  encodeInteger(mq, iaex, 0);
  encodeInteger(mq, iaex, order.length);
  return { coded: mq.flush(), order };
}

// Codes a text region placing `instances` (each {id, s, t}) from `symbols`. Mirrors T.88 6.4.5 exactly, including which side of the placement CURS advances on.
function encodeTextRegion(symbols, instances, options) {
  const { stripSize, referenceCorner, transposed, dsOffset, refine } = options;
  const mq = new MqEncoder();
  const iadt = integerStates();
  const iafs = integerStates();
  const iads = integerStates();
  const iait = integerStates();
  const iari = integerStates();
  const iardw = integerStates();
  const iardh = integerStates();
  const iardx = integerStates();
  const iardy = integerStates();
  const refinement = new Uint8Array(1 << 13);
  const codeLength = symbolCodeLength(symbols.length);
  const iaid = new Uint8Array(1 << (codeLength + 1));

  const strips = new Map();
  for (const instance of instances) {
    const base = Math.floor(instance.t / stripSize) * stripSize;
    if (!strips.has(base)) strips.set(base, []);
    strips.get(base).push(instance);
  }
  const bases = [...strips.keys()].sort((a, b) => a - b);

  // T.88 6.4.5 advances CURS by the instance's own extent BEFORE naming the placement coordinate for a right-hand (or, transposed, bottom) reference corner, and after it otherwise. Each instance's own `s` below is the corner coordinate itself, so the CURS value the decoder will reconstruct has to be derived back from it the same way.
  const advanceBefore = transposed ? referenceCorner === 0 || referenceCorner === 2 : referenceCorner === 2 || referenceCorner === 3;

  encodeInteger(mq, iadt, 0); // STRIPT starts at 0.
  let stripT = 0;
  let firstS = 0;
  for (const base of bases) {
    encodeInteger(mq, iadt, (base - stripT) / stripSize);
    stripT = base;
    const strip = strips.get(base).slice().sort((a, b) => a.s - b.s);
    let previousCursorOut = 0;
    for (let i = 0; i < strip.length; i++) {
      const instance = strip[i];
      const bitmap = instance.refined ?? symbols[instance.id];
      const advance = (transposed ? bitmap.length : bitmap[0].length) - 1;
      const cursorIn = advanceBefore ? instance.s - advance : instance.s;
      if (i === 0) {
        encodeInteger(mq, iafs, cursorIn - firstS);
        firstS = cursorIn;
      } else {
        encodeInteger(mq, iads, cursorIn - previousCursorOut - dsOffset);
      }
      previousCursorOut = cursorIn + advance;

      if (stripSize > 1) encodeInteger(mq, iait, instance.t - base);
      encodeSymbolId(mq, iaid, instance.id, codeLength);
      if (refine) {
        encodeInteger(mq, iari, instance.refined === undefined ? 0 : 1);
        if (instance.refined !== undefined) {
          const original = symbols[instance.id];
          const deltaWidth = instance.refined[0].length - original[0].length;
          const deltaHeight = instance.refined.length - original.length;
          encodeInteger(mq, iardw, deltaWidth);
          encodeInteger(mq, iardh, deltaHeight);
          encodeInteger(mq, iardx, 0);
          encodeInteger(mq, iardy, 0);
          encodeRefinementInto(mq, refinement, instance.refined, original, 0, NOMINAL_REFINEMENT_AT, Math.floor(deltaWidth / 2), Math.floor(deltaHeight / 2));
        }
      }
    }
    encodeInteger(mq, iads, null); // OOB closes the strip.
  }
  return mq.flush();
}

// --- JBIG2 segment framing (T.88 clause 7), for the hand-encoded streams. ---

function uint32(value) {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function segment(number, type, pageAssociation, data, referredTo = []) {
  const referredByte = referredTo.length << 5;
  return Uint8Array.from([...uint32(number), type, referredByte, ...referredTo, pageAssociation, ...uint32(data.length), ...data]);
}

// `flags` carries the page's own default pixel value (bit 2), default combination operator (bits 3-4), and whether a region may override that operator (bit 6).
function pageInformationSegment(number, width, height, flags = 0x00) {
  return segment(number, 48, 1, [...uint32(width), ...uint32(height), ...uint32(0), ...uint32(0), flags, 0x00, 0x00]);
}

function regionInfo(width, height, x = 0, y = 0, operator = 0) {
  return [...uint32(width), ...uint32(height), ...uint32(x), ...uint32(y), operator];
}

function signedByte(value) {
  return value < 0 ? value + 256 : value;
}

function genericRegionSegment(number, source, template, at, tpgdon, coded, placement = {}) {
  const flags = (template << 1) | (tpgdon ? 0x08 : 0x00);
  const atBytes = at.flatMap((pixel) => [signedByte(pixel.x), signedByte(pixel.y)]);
  return segment(number, 38, 1, [...regionInfo(source.width, source.height, placement.x ?? 0, placement.y ?? 0, placement.operator ?? 0), flags, ...atBytes, ...coded]);
}

function mmrGenericRegionSegment(number, source, coded) {
  return segment(number, 38, 1, [...regionInfo(source.width, source.height), 0x01, ...coded]);
}

function symbolDictionarySegment(number, template, at, exportedCount, newCount, coded) {
  const flags = template << 10;
  const atBytes = at.flatMap((pixel) => [signedByte(pixel.x), signedByte(pixel.y)]);
  return segment(number, 0, 0, [(flags >> 8) & 0xff, flags & 0xff, ...atBytes, ...uint32(exportedCount), ...uint32(newCount), ...coded]);
}

function textRegionSegment(number, dictionarySegment, width, height, instanceCount, options, coded) {
  // T.88 7.4.4.1.1's own bit layout: SBHUFF, SBREFINE, LOGSBSTRIPS, REFCORNER, TRANSPOSED, SBCOMBOP, SBDEFPIXEL, SBDSOFFSET (five bits, signed), SBRTEMPLATE.
  const flags =
    (options.refine ? 0x02 : 0x00) |
    (Math.log2(options.stripSize) << 2) |
    (options.referenceCorner << 4) |
    (options.transposed ? 0x40 : 0x00) |
    ((options.dsOffset & 0x1f) << 10);
  const refinementAt = options.refine ? NOMINAL_REFINEMENT_AT.flatMap((pixel) => [signedByte(pixel.x), signedByte(pixel.y)]) : [];
  return segment(number, 6, 1, [...regionInfo(width, height), (flags >> 8) & 0xff, flags & 0xff, ...refinementAt, ...uint32(instanceCount), ...coded], [dictionarySegment]);
}

function refinementRegionSegment(number, width, height, template, tpgron, coded) {
  // The region's own external combination operator is REPLACE (4), which is what T.88 7.4.7.6 requires when the reference is the page itself. GRTEMPLATE 1 carries no adaptive pixels at all.
  const at = template === 0 ? NOMINAL_REFINEMENT_AT.flatMap((pixel) => [signedByte(pixel.x), signedByte(pixel.y)]) : [];
  return segment(number, 42, 1, [...regionInfo(width, height, 0, 0, 4), template | (tpgron ? 0x02 : 0x00), ...at, ...coded]);
}

function concat(...parts) {
  return Buffer.concat(parts.map((part) => Buffer.from(part)));
}

// --- libtiff's Group 4 coder, for the MMR-coded generic region. ---

function encodeGroup4(dir, source) {
  const pbm = join(dir, 'mmr.pbm');
  writePbm(pbm, source);
  const tif = join(dir, 'mmr.tif');
  const plain = join(dir, 'mmr-plain.tif');
  writeFileSync(plain, execFileSync('pnmtotiff', ['-miniswhite', '-none', pbm], { maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }));
  execFileSync('tiffcp', ['-c', 'g4', '-r', String(source.height), plain, tif]);
  return extractSingleStrip(tif);
}

// Pulls the one strip's bytes out of a single-strip TIFF by reading its own /StripOffsets and /StripByteCounts tags.
function extractSingleStrip(path) {
  const bytes = readFileSync(path);
  const little = bytes[0] === 0x49;
  const u16 = (offset) => (little ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset));
  const u32 = (offset) => (little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset));
  const ifd = u32(4);
  const count = u16(ifd);
  let stripOffset;
  let stripLength;
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    const tag = u16(entry);
    const type = u16(entry + 2);
    const value = type === 3 ? u16(entry + 8) : u32(entry + 8);
    if (tag === 273) stripOffset = value;
    if (tag === 279) stripLength = value;
    if (tag === 278) {
      // RowsPerStrip: a multi-strip file would need concatenating, which -r above already prevents.
    }
  }
  if (stripOffset === undefined || stripLength === undefined) throw new Error(`${path} has no single-strip offset/length pair`);
  return Uint8Array.from(bytes.subarray(stripOffset, stripOffset + stripLength));
}

// --- jbig2dec: the independent oracle every fixture must survive. ---

function decodeWithJbig2dec(dir, name, streams) {
  const paths = streams.map((stream, index) => {
    const path = join(dir, `${name}.${String(index)}.jb2`);
    writeFileSync(path, Buffer.from(stream));
    return path;
  });
  const output = join(dir, `${name}.out.pbm`);
  execFileSync('jbig2dec', ['-e', '-q', '-t', 'pbm', '-o', output, ...paths]);
  return readPbm(output);
}

// --- Building the fixtures. ---

function run(dir) {
  const fixtures = [];

  for (const source of SOURCE_BITMAPS) {
    const pbm = join(dir, `${source.name}.pbm`);
    writePbm(pbm, source);
    const expected = bitmapOf(source);

    // 1. jbig2enc's own generic-region output (GBTEMPLATE 0, nominal AT), with and without typical prediction.
    for (const [suffix, args, description] of [
      ['generic', [], 'jbig2enc generic region, GBTEMPLATE 0, nominal AT pixels'],
      ['generic-tpgdon', ['-d'], 'jbig2enc generic region, GBTEMPLATE 0, TPGDON set'],
    ]) {
      const stream = execFileSync('jbig2', ['-p', ...args, pbm], { maxBuffer: 1 << 26 });
      fixtures.push(buildFixture(dir, `${source.name}-${suffix}`, description, source, [stream], expected, true));
    }

    // 2. Hand-encoded generic regions for the templates jbig2enc never emits, plus a non-nominal AT placement. All with TPGDON, which is what makes jbig2dec's agreement a statement about the context bit ordering rather than only about the template's pixel set.
    for (const [template, at, label] of [
      [1, [{ x: 3, y: -1 }], 'GBTEMPLATE 1'],
      [2, [{ x: 2, y: -1 }], 'GBTEMPLATE 2'],
      [3, [{ x: 2, y: -1 }], 'GBTEMPLATE 3'],
      [
        0,
        [
          { x: -2, y: -1 },
          { x: 1, y: -2 },
          { x: 4, y: -3 },
          { x: -3, y: -3 },
        ],
        'GBTEMPLATE 0 with non-nominal AT pixels',
      ],
    ]) {
      const coded = encodeGenericRegion(source, template, at, true);
      const stream = concat(pageInformationSegment(0, source.width, source.height), genericRegionSegment(1, source, template, at, true, coded));
      fixtures.push(buildFixture(dir, `${source.name}-template${String(template)}${label.includes('non-nominal') ? '-at' : ''}`, `hand-encoded generic region, ${label}, TPGDON set`, source, [stream], expected, true));
    }

    // 3. An MMR-coded generic region, whose payload is a real libtiff Group 4 bitstream.
    const mmr = mmrGenericRegionSegment(1, source, encodeGroup4(dir, source));
    fixtures.push(buildFixture(dir, `${source.name}-mmr`, 'generic region with MMR = 1, payload coded by libtiff as ITU-T T.6 Group 4', source, [concat(pageInformationSegment(0, source.width, source.height), mmr)], expected, true));
  }

  // 4. jbig2enc's symbol mode: a symbol dictionary in a separate globals stream plus a text region in the page stream, exactly the shape a PDF's /JBIG2Globals DecodeParms entry carries. Deliberately lossy (jbig2enc merges visually similar symbols), so the expected bitmap is jbig2dec's own output rather than the source.
  for (const source of SOURCE_BITMAPS.filter((candidate) => candidate.name === 'text' || candidate.name === 'stripes')) {
    const pbm = join(dir, `${source.name}.pbm`);
    const base = join(dir, `${source.name}-sym`);
    execFileSync('jbig2', ['-s', '-p', '-b', base, pbm]);
    const globals = readFileSync(`${base}.sym`);
    const page = readFileSync(`${base}.0000`);
    fixtures.push(buildFixture(dir, `${source.name}-symbols`, 'jbig2enc symbol mode: an arithmetic symbol dictionary in a globals stream plus a text region in the page stream', source, [globals, page], undefined, false));

    // 5. The same real jbig2enc text region with only its REFCORNER and TRANSPOSED bits rewritten. Those two fields sit in the segment header and change nothing about the arithmetic bitstream, so the patched stream stays a genuine jbig2enc encoding -- but every symbol instance lands somewhere different, which is what makes jbig2dec's output a real differential test of the placement rules for the corners jbig2enc itself never emits.
    for (const [corner, transposed, label] of [
      [1, false, 'TOPLEFT'],
      [2, false, 'BOTTOMRIGHT'],
      [3, false, 'TOPRIGHT'],
      [0, true, 'BOTTOMLEFT, transposed'],
      [1, true, 'TOPLEFT, transposed'],
      [3, true, 'TOPRIGHT, transposed'],
    ]) {
      const patched = patchTextRegionFlags(page, (flags) => (flags & ~0x0070) | (corner << 4) | (transposed ? 0x40 : 0x00));
      fixtures.push(buildFixture(dir, `${source.name}-symbols-${label.replace(/[^a-z]+/gi, '-').toLowerCase()}`, `jbig2enc symbol mode with the text region's own REFCORNER/TRANSPOSED rewritten to ${label}`, source, [globals, patched], undefined, false));
    }
  }

  // 6. Hand-encoded symbol dictionary and text region: the coding paths jbig2enc's own fixed choices never reach -- several strips with SBSTRIPS > 1, a non-zero SBDSOFFSET, and refined symbol instances.
  fixtures.push(...handEncodedTextFixtures(dir));

  // 7. Composition: two generic regions placed at different offsets on one page, and a standalone refinement region refining what a generic region already painted.
  fixtures.push(...compositionFixtures(dir));

  return fixtures;
}

// Walks the segment headers of an embedded stream to find the immediate text region's own two flag bytes, and rewrites them. Written out longhand rather than with a hardcoded offset so a change in how jbig2enc frames its segments surfaces as a thrown error rather than as a silently mis-patched fixture.
function patchTextRegionFlags(stream, rewrite) {
  const bytes = Buffer.from(stream);
  let position = 0;
  while (position < bytes.length) {
    const number = bytes.readUInt32BE(position);
    const flags = bytes[position + 4];
    const type = flags & 0x3f;
    let cursor = position + 5;
    const countByte = bytes[cursor];
    let referredCount = countByte >> 5;
    if (referredCount === 7) {
      referredCount = bytes.readUInt32BE(cursor) & 0x1fffffff;
      cursor += 4 + Math.ceil((referredCount + 1) / 8);
    } else {
      cursor += 1;
    }
    cursor += referredCount * (number <= 256 ? 1 : number <= 65536 ? 2 : 4);
    cursor += (flags & 0x40) !== 0 ? 4 : 1;
    const length = bytes.readUInt32BE(cursor);
    cursor += 4;
    if (type === 6 || type === 7) {
      const flagsOffset = cursor + 17; // Past the region segment information field.
      const patched = Buffer.from(bytes);
      patched.writeUInt16BE(rewrite(bytes.readUInt16BE(flagsOffset)) & 0xffff, flagsOffset);
      return patched;
    }
    position = cursor + length;
  }
  throw new Error('no immediate text region segment found in the stream to patch');
}

// Three small symbols: two the same height (so one height class holds both) and one taller, exercising the height-class loop rather than a single trivial class.
const HAND_SYMBOLS = [
  ['####', '#..#', '#..#', '####'].map((row) => [...row].map((cell) => (cell === '#' ? 1 : 0))),
  ['.##.', '####', '####', '.##.'].map((row) => [...row].map((cell) => (cell === '#' ? 1 : 0))),
  ['#....#', '.#..#.', '..##..', '.#..#.', '#....#', '######'].map((row) => [...row].map((cell) => (cell === '#' ? 1 : 0))),
];

// The same symbol with one pixel flipped, used as a refined instance so the refinement decoding procedure is genuinely exercised rather than only declared.
const HAND_REFINED = HAND_SYMBOLS[0].map((row, y) => row.map((cell, x) => (x === 1 && y === 1 ? 1 : cell)));

function handEncodedTextFixtures(dir) {
  const fixtures = [];
  const template = 0;
  const at = [
    { x: 3, y: -1 },
    { x: -3, y: -1 },
    { x: 2, y: -2 },
    { x: -2, y: -2 },
  ];
  const { coded, order } = encodeSymbolDictionary(HAND_SYMBOLS, template, at);
  const globals = symbolDictionarySegment(0, template, at, order.length, order.length, coded);

  const cases = [
    { name: 'strips', options: { stripSize: 1, referenceCorner: 1, transposed: false, dsOffset: 0, refine: false }, description: 'hand-encoded symbol dictionary and text region, SBSTRIPS 1, REFCORNER TOPLEFT' },
    { name: 'multistrip', options: { stripSize: 4, referenceCorner: 1, transposed: false, dsOffset: 0, refine: false }, description: 'hand-encoded text region with SBSTRIPS 4, so each instance also codes its own CURT offset within the strip' },
    { name: 'dsoffset', options: { stripSize: 1, referenceCorner: 0, transposed: false, dsOffset: -3, refine: false }, description: 'hand-encoded text region with a negative SBDSOFFSET applied to every inter-symbol gap' },
    { name: 'refine', options: { stripSize: 1, referenceCorner: 1, transposed: false, dsOffset: 0, refine: true }, description: 'hand-encoded text region with SBREFINE set and one instance coded as a refinement of its dictionary symbol' },
  ];

  const width = 60;
  const height = 30;
  for (const testCase of cases) {
    const instances = [
      { id: 0, s: 2, t: 2 },
      { id: 1, s: 10, t: 3 },
      { id: 2, s: 20, t: 2 },
      { id: 0, s: 32, t: 2 },
      { id: 1, s: 4, t: 16 },
      { id: 2, s: 14, t: 17 },
      { id: 0, s: 30, t: 16, refined: testCase.options.refine ? HAND_REFINED : undefined },
    ];
    const codedRegion = encodeTextRegion(order, instances, testCase.options);
    const page = concat(pageInformationSegment(1, width, height), textRegionSegment(2, 0, width, height, instances.length, testCase.options, codedRegion));
    fixtures.push(buildFixture(dir, `hand-${testCase.name}`, testCase.description, { width, height }, [globals, page], undefined, false));
  }
  return fixtures;
}

function compositionFixtures(dir) {
  const width = 48;
  const height = 32;
  const tile = { width: 16, height: 12, isBlack: (x, y) => x === y || x + y === 15 || y === 0 };
  const at = [
    { x: 3, y: -1 },
    { x: -3, y: -1 },
    { x: 2, y: -2 },
    { x: -2, y: -2 },
  ];
  const codedTile = encodeGenericRegion(tile, 0, at, false);

  // Two copies of the same tile at different page offsets, the second XOR-ed onto the first where they overlap. The page flags set bit 6 so a region's own external combination operator is honoured at all.
  const composed = concat(
    pageInformationSegment(0, width, height, 0x40),
    genericRegionSegment(1, tile, 0, at, false, codedTile, { x: 4, y: 3 }),
    genericRegionSegment(2, tile, 0, at, false, codedTile, { x: 12, y: 9, operator: 2 }),
  );

  // A refinement region rewriting, in place, part of what a generic region already painted. The reference here is the page itself, which is what T.88 7.4.7.2 makes it when no intermediate buffers are in play.
  const base = { width: 24, height: 16, isBlack: (x, y) => (x + y) % 5 < 2 };
  const reference = Array.from({ length: base.height }, (_, y) => Array.from({ length: base.width }, (_, x) => (base.isBlack(x, y) ? 1 : 0)));
  // Two targets: one that differs from the reference everywhere (so typical prediction can never fire), and one that only differs in a band down the middle (so most rows ARE typical and TPGRON genuinely does the work it exists for).
  const scattered = Array.from({ length: base.height }, (_, y) => Array.from({ length: base.width }, (_, x) => ((x * 3 + y) % 7 < 3 ? 1 : 0)));
  const banded = reference.map((row, y) => row.map((cell, x) => (x >= 9 && x <= 14 ? ((x + y) % 3 === 0 ? 1 : 0) : cell)));

  // TPGRON is deliberately absent: see the comment on TPGRON_UNSUPPORTED in src/image/jbig2-generic.ts for why a fixture here could not verify it even if one were generated.
  const refinementCases = [
    { name: 'refinement-region', template: 0, target: scattered, description: 'a standalone refinement region rewriting what a generic region already painted on the page' },
    { name: 'refinement-region-template1', template: 1, target: banded, description: 'a standalone refinement region using GRTEMPLATE 1, which carries no adaptive pixels' },
  ];

  const fixtures = [buildFixture(dir, 'composed-regions', 'two generic regions on one page at different offsets, the second combined with XOR where they overlap', { width, height }, [composed], undefined, false)];
  for (const testCase of refinementCases) {
    const refinementMq = new MqEncoder();
    encodeRefinementInto(refinementMq, new Uint8Array(1 << 13), testCase.target, reference, testCase.template, NOMINAL_REFINEMENT_AT, 0, 0, false);
    const stream = concat(
      pageInformationSegment(0, base.width, base.height, 0x40),
      genericRegionSegment(1, base, 0, at, false, encodeGenericRegion(base, 0, at, false)),
      refinementRegionSegment(2, base.width, base.height, testCase.template, false, refinementMq.flush()),
    );
    fixtures.push(buildFixture(dir, testCase.name, testCase.description, base, [stream], testCase.target.map((row) => row.map((cell) => (cell === 1 ? '#' : '.')).join('')), true));
  }
  return fixtures;
}

function buildFixture(dir, name, description, source, streams, expectedFromSource, expectLossless) {
  const decoded = decodeWithJbig2dec(dir, name, streams);
  if (decoded.width !== source.width || decoded.height !== source.height) {
    throw new Error(`${name}: jbig2dec decoded ${decoded.width}x${decoded.height}, expected ${source.width}x${source.height}`);
  }
  if (expectLossless && expectedFromSource !== undefined && decoded.rows.join('\n') !== expectedFromSource.join('\n')) {
    throw new Error(`${name}: jbig2dec's decode does not match the source bitmap, so the stream is not the lossless encoding this fixture claims\n${decoded.rows.join('\n')}\n---\n${expectedFromSource.join('\n')}`);
  }
  const lossless = expectedFromSource !== undefined && decoded.rows.join('\n') === expectedFromSource.join('\n');
  return {
    name,
    description,
    width: source.width,
    height: source.height,
    globals: streams.length > 1 ? Buffer.from(streams[0]).toString('base64') : undefined,
    stream: Buffer.from(streams[streams.length - 1]).toString('base64'),
    expected: decoded.rows,
    lossless,
  };
}

function emit(fixtures) {
  const lines = [];
  lines.push("import { base64ToBytes } from '../util/base64';");
  lines.push('');
  lines.push(
    '// Real JBIG2 embedded streams -- the exact byte sequence a PDF /JBIG2Decode filter carries -- produced by jbig2enc 0.32 (Adam Langley\'s encoder, the one behind essentially every JBIG2 image in a real PDF), by libtiff 4.7.2 for the MMR-coded region, and, for the two generic-region templates jbig2enc never emits, by a hand-written T.88 Annex E arithmetic encoder in scripts/generate-jbig2-fixtures.mjs. Embedded as base64 so the suite needs no filesystem access.',
  );
  lines.push('//');
  lines.push(
    "// Every stream here, hand-encoded ones included, was decoded by jbig2dec (Ghostscript's own independent JBIG2 implementation) before being written out, and `expected` below is jbig2dec's decoded bitmap -- not this package's. See the generator script's header for why that matters and for how the TPGDON-bearing hand-encoded fixtures pin the template context bit ordering specifically.",
  );
  lines.push('//');
  lines.push("// `expected` is one string per row, '#' for a black pixel -- JBIG2's own 1 bit, and the inverse of what a PDF /DeviceGray image stores.");
  lines.push('');
  lines.push('export interface Jbig2Fixture {');
  lines.push('  readonly name: string;');
  lines.push('  readonly description: string;');
  lines.push('  readonly width: number;');
  lines.push('  readonly height: number;');
  lines.push("  // The /JBIG2Globals DecodeParms stream, present only for the symbol-mode fixtures where jbig2enc puts the dictionary in one.");
  lines.push('  readonly globals?: string;');
  lines.push('  readonly stream: string;');
  lines.push('  readonly expected: readonly string[];');
  lines.push('  // Whether `expected` is identical to the bitmap the encoder was handed. False for jbig2enc symbol mode, which merges visually similar symbols on purpose.');
  lines.push('  readonly lossless: boolean;');
  lines.push('}');
  lines.push('');
  lines.push('export function jbig2FixtureBytes(encoded: string): Uint8Array<ArrayBuffer> {');
  lines.push('  return base64ToBytes(encoded);');
  lines.push('}');
  lines.push('');
  lines.push('export const JBIG2_FIXTURES: readonly Jbig2Fixture[] = [');
  for (const fixture of fixtures) {
    lines.push('  {');
    lines.push(`    name: ${JSON.stringify(fixture.name)},`);
    lines.push(`    description: ${JSON.stringify(fixture.description)},`);
    lines.push(`    width: ${String(fixture.width)},`);
    lines.push(`    height: ${String(fixture.height)},`);
    if (fixture.globals !== undefined) {
      lines.push(`    globals: ${JSON.stringify(fixture.globals)},`);
    }
    lines.push(`    stream: ${JSON.stringify(fixture.stream)},`);
    lines.push('    expected: [');
    for (const row of fixture.expected) {
      lines.push(`      ${JSON.stringify(row)},`);
    }
    lines.push('    ],');
    lines.push(`    lossless: ${String(fixture.lossless)},`);
    lines.push('  },');
  }
  lines.push('];');
  lines.push('');
  writeFileSync(outputPath, lines.join('\n'));
}

const dir = mkdtempSync(join(tmpdir(), 'jbig2-fixtures-'));
try {
  const fixtures = run(dir);
  emit(fixtures);
  console.log(`wrote ${String(fixtures.length)} fixtures to ${outputPath}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
