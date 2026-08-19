#!/usr/bin/env node
// Regenerates src/test-support/jpeg2000.ts: real JPEG 2000 codestreams for src/image/jpeg2000.test.ts, src/filters.test.ts and src/images-read.test.ts to decode back.
//
// Run with `node scripts/generate-jpeg2000-fixtures.mjs`, which requires OpenJPEG's opj_compress and opj_decompress on PATH (`brew install openjpeg`). Not part of `pnpm build`/`pnpm test` -- the generated .ts file is committed like any other checked-in generated artifact, so the test suite needs neither that tool nor a filesystem read to run.
//
// The independence argument, which is what makes these fixtures worth anything. Nothing in this repository influences a single byte of the codestreams: OpenJPEG's own encoder writes them from ordinary PGM/PPM input this script generates. Then two separate checks are applied before a fixture is written out at all:
//
//   1. Every reversible (5-3) codestream is decoded by opj_decompress and its output must be byte-identical to the PGM/PPM handed to the encoder. That establishes the codestream really is lossless, so the source image is a legitimate exact oracle -- one produced by neither this package nor OpenJPEG's decoder, but by the definition of the transform.
//   2. The expected samples recorded for a reversible fixture are the SOURCE image's, not opj_decompress's and certainly not this package's. A JPEG 2000 decoder that reproduces them has reproduced the exact integers the encoder was given, which no shared mistake between an encoder and decoder can fake.
//
// The irreversible (9-7) codestreams have no exact oracle at all -- the transform is lossy by construction, so "the right answer" is only defined up to the rounding an implementation does in floating point. Their expected samples are opj_decompress's own output, and the test that consumes them asserts a tight per-sample tolerance rather than equality, with the honest consequence that they pin this decoder against OpenJPEG's arithmetic rather than against the specification in the absolute way the reversible fixtures do.
//
// This script is deliberately outside tsconfig.json's "include" and eslint.config.ts's linted set (see the "scripts" entry in both), matching scripts/generate-jbig2-fixtures.mjs.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outputPath = join(here, '..', 'src', 'test-support', 'jpeg2000.ts');

// --- The source images every fixture is built from. Deterministic, and varied enough that a wrong subband, a wrong context or a wrong wavelet boundary shows up as a mismatch rather than cancelling out on flat content. ---

const SOURCES = {
  // A steep linear ramp: every wavelet level carries real high-pass energy, and the wrap at 256 gives sharp edges the significance coder has to track.
  ramp: { kind: 'gray', width: 32, height: 24, maxValue: 255, sample: (x, y) => (x * 13 + y * 29) % 256 },
  // Deliberately non-power-of-two in both axes, so every resolution level's own ceil/floor split is exercised and an off-by-one in the subband coordinates cannot hide.
  odd: { kind: 'gray', width: 37, height: 23, maxValue: 255, sample: (x, y) => (x * x + y * 7 + ((x * y) >> 2)) % 256 },
  // One sample: the degenerate 1D_SR case where the whole signal is a single coefficient.
  dot: { kind: 'gray', width: 1, height: 1, maxValue: 255, sample: () => 200 },
  // Smaller than one code-block and smaller than several of the decomposition levels it is coded with.
  tiny: { kind: 'gray', width: 5, height: 3, maxValue: 255, sample: (x, y) => (x * 50 + y * 17) % 256 },
  // Smooth continuous tone: the case the wavelet is actually designed for, where most coefficients are small and the run-length mode of the cleanup pass fires constantly.
  photo: { kind: 'gray', width: 48, height: 32, maxValue: 255, sample: (x, y) => Math.round(127 + 120 * Math.sin(x / 7) * Math.cos(y / 5)) },
  // Twelve-bit samples, so the bit-plane count, the guard bits and the DC level shift are all exercised at a depth PGM's own 8-bit default never reaches.
  deep: { kind: 'gray', width: 24, height: 16, maxValue: 4095, sample: (x, y) => (x * 173 + y * 401) % 4096 },
  // Three components whose content is genuinely decorrelated between channels, so the reversible colour transform has something real to undo.
  colour: { kind: 'rgb', width: 32, height: 24, maxValue: 255, sample: (x, y) => [(x * 5) % 256, (y * 8) % 256, ((x + y) * 3) % 256] },
  colourPhoto: { kind: 'rgb', width: 40, height: 28, maxValue: 255, sample: (x, y) => [Math.round(127 + 120 * Math.sin(x / 9)), Math.round(127 + 120 * Math.cos(y / 6)), (x * y) % 256] },
};

function writeSource(dir, name) {
  const source = SOURCES[name];
  const channels = source.kind === 'rgb' ? 3 : 1;
  const wide = source.maxValue > 255;
  const header = Buffer.from(`${source.kind === 'rgb' ? 'P6' : 'P5'}\n${source.width} ${source.height}\n${source.maxValue}\n`, 'ascii');
  const body = Buffer.alloc(source.width * source.height * channels * (wide ? 2 : 1));
  let offset = 0;
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const value = source.sample(x, y);
      const values = channels === 3 ? value : [value];
      for (const component of values) {
        if (wide) {
          body.writeUInt16BE(component, offset);
          offset += 2;
        } else {
          body.writeUInt8(component, offset);
          offset += 1;
        }
      }
    }
  }
  const path = join(dir, `${name}.${source.kind === 'rgb' ? 'ppm' : 'pgm'}`);
  writeFileSync(path, Buffer.concat([header, body]));
  return { path, source, channels, wide };
}

// Reads a PGM/PPM back into one flat array of samples in planar order (every sample of component 0, then component 1, ...), which is the shape a fixture's `expected` field records and the shape decodeJpeg2000 returns.
function readPnm(path) {
  const raw = readFileSync(path);
  const tokens = [];
  let i = 0;
  while (tokens.length < 4) {
    while (i < raw.length && (raw[i] === 0x20 || raw[i] === 0x0a || raw[i] === 0x0d || raw[i] === 0x09)) i++;
    if (raw[i] === 0x23) {
      while (raw[i] !== 0x0a) i++;
      continue;
    }
    let j = i;
    while (j < raw.length && raw[j] !== 0x20 && raw[j] !== 0x0a && raw[j] !== 0x0d && raw[j] !== 0x09) j++;
    tokens.push(raw.subarray(i, j).toString('ascii'));
    i = j;
  }
  i++;
  const channels = tokens[0] === 'P6' ? 3 : 1;
  const width = Number(tokens[1]);
  const height = Number(tokens[2]);
  const maxValue = Number(tokens[3]);
  const wide = maxValue > 255;
  const planes = Array.from({ length: channels }, () => new Array(width * height));
  for (let px = 0; px < width * height; px++) {
    for (let ch = 0; ch < channels; ch++) {
      const at = i + (px * channels + ch) * (wide ? 2 : 1);
      planes[ch][px] = wide ? raw.readUInt16BE(at) : raw.readUInt8(at);
    }
  }
  return { width, height, channels, maxValue, planes };
}

function samplesToBase64(planes, wide) {
  const total = planes.reduce((sum, plane) => sum + plane.length, 0);
  const buffer = Buffer.alloc(total * (wide ? 2 : 1));
  let offset = 0;
  for (const plane of planes) {
    for (const value of plane) {
      if (wide) {
        buffer.writeUInt16LE(value, offset);
        offset += 2;
      } else {
        buffer.writeUInt8(value, offset);
        offset += 1;
      }
    }
  }
  return buffer.toString('base64');
}

// --- The fixture set: one entry per encoder configuration worth pinning. ---

const FIXTURES = [
  { name: 'ramp-basic', source: 'ramp', args: ['-n', '3'], description: 'three resolution levels (two wavelet decompositions), everything else at OpenJPEG defaults' },
  { name: 'ramp-no-wavelet', source: 'ramp', args: ['-n', '1'], description: 'a single resolution level, i.e. no wavelet decomposition at all -- the samples are entropy coded directly' },
  { name: 'ramp-one-decomposition', source: 'ramp', args: ['-n', '2'], description: 'exactly one wavelet decomposition, so resolution 0 is half the image on each axis' },
  { name: 'odd-dimensions', source: 'odd', args: ['-n', '3'], description: 'a 37x23 image, odd on both axes at every resolution level' },
  { name: 'single-sample', source: 'dot', args: ['-n', '1'], description: 'a 1x1 image, the degenerate single-coefficient case of 1D_SR' },
  { name: 'tiny', source: 'tiny', args: ['-n', '2'], description: 'a 5x3 image smaller than its own code-block, whose subbands are one and two samples wide' },
  { name: 'photo-many-levels', source: 'photo', args: ['-n', '5'], description: 'five resolution levels (four wavelet decompositions) over smooth continuous tone' },
  { name: 'deep-12-bit', source: 'deep', args: ['-n', '3'], description: '12-bit samples, exercising the bit-plane count and the DC level shift past 8 bits' },
  { name: 'colour-rct', source: 'colour', args: ['-n', '3'], description: 'three components through the reversible colour transform' },
  { name: 'colour-no-mct', source: 'colour', args: ['-n', '3', '-mct', '0'], description: 'three components coded independently, no colour transform' },
  { name: 'colour-photo', source: 'colourPhoto', args: ['-n', '4'], description: 'four resolution levels over three continuous-tone components' },
  { name: 'multi-tile', source: 'photo', args: ['-n', '2', '-t', '16,16'], description: 'a 3x2 grid of 16x16 tiles, each coded and composed independently' },
  // An image whose origin on the reference grid is not (0, 0) makes every resolution level's own trx0/try0 non-zero, and odd at some of them -- the case that decides whether the subband coordinate split and the wavelet's own symmetric extension are anchored where the specification says rather than merely at zero.
  { name: 'origin-offset', source: 'photo', args: ['-n', '3', '-d', '3,5'], description: 'an image origin at (3, 5) on the reference grid, so resolution levels start at odd coordinates' },
  { name: 'origin-offset-tiles', source: 'photo', args: ['-n', '2', '-d', '3,5', '-t', '20,20'], description: 'a non-zero image origin combined with a tile grid, so tile coordinates are offset too' },
  { name: 'multi-layer', source: 'photo', args: ['-n', '3', '-r', '20,10,1'], description: 'three quality layers, the last lossless, so code-blocks span several packets' },
  { name: 'small-code-blocks', source: 'photo', args: ['-n', '3', '-b', '16,16'], description: '16x16 code-blocks, so every subband holds several of them' },
  // opj_compress takes its -c list highest-resolution-first, so a small FIRST entry is what actually subdivides the full-size level; a partition larger than the level it applies to leaves one precinct covering everything and exercises nothing.
  { name: 'precincts', source: 'photo', args: ['-n', '3', '-c', '[16,16],[16,16],[16,16]'], description: 'explicit precinct partitions that genuinely split the higher resolution levels into several precincts each' },
  { name: 'progression-rlcp', source: 'photo', args: ['-n', '3', '-p', 'RLCP'], description: 'resolution-major progression order' },
  { name: 'progression-rpcl', source: 'photo', args: ['-n', '3', '-p', 'RPCL'], description: 'position-driven RPCL progression with one precinct per resolution' },
  { name: 'progression-cprl', source: 'colourPhoto', args: ['-n', '3', '-p', 'CPRL'], description: 'component-major CPRL progression across three components' },
  // A position-driven progression order combined with precincts that genuinely subdivide a resolution level: the one case this decoder refuses among the five orders, kept as a fixture so the refusal is tested against a real codestream rather than a hand-built one.
  { name: 'progression-rpcl-subdivided', source: 'photo', args: ['-n', '3', '-p', 'RPCL', '-c', '[16,16],[16,16],[16,16]'], undecodable: true, description: 'RPCL progression with precincts subdividing a resolution level, which this decoder refuses by name' },
  { name: 'sop-eph', source: 'photo', args: ['-n', '3', '-SOP', '-EPH'], description: 'SOP and EPH markers delimiting every packet header' },
  { name: 'vertically-causal', source: 'photo', args: ['-n', '3', '-M', '8'], description: 'the vertically causal context code-block style' },
  { name: 'segmentation-symbols', source: 'photo', args: ['-n', '3', '-M', '32'], description: 'segmentation symbols at the end of every cleanup pass' },
  { name: 'reset-contexts', source: 'photo', args: ['-n', '3', '-M', '2'], description: 'arithmetic contexts reset at the start of every coding pass' },
  { name: 'jp2-container', source: 'colour', args: ['-n', '3'], container: 'jp2', description: 'the same content inside a full JP2 box structure rather than a bare codestream' },
  { name: 'irreversible-photo', source: 'photo', args: ['-n', '3', '-I', '-r', '1'], irreversible: true, description: 'the irreversible 9-7 wavelet at its highest quality setting' },
  { name: 'irreversible-lossy', source: 'photo', args: ['-n', '3', '-I', '-r', '10'], irreversible: true, description: 'the irreversible 9-7 wavelet at a 10:1 rate, so code-blocks are genuinely truncated' },
  { name: 'irreversible-colour', source: 'colourPhoto', args: ['-n', '4', '-I', '-r', '1'], irreversible: true, description: 'the irreversible 9-7 wavelet with the irreversible colour transform' },
  { name: 'irreversible-tiles', source: 'photo', args: ['-n', '2', '-I', '-t', '32,32', '-r', '1'], irreversible: true, description: 'the irreversible 9-7 wavelet across a multi-tile image' },
];

function samplesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].length !== b[i].length) return false;
    for (let k = 0; k < a[i].length; k++) if (a[i][k] !== b[i][k]) return false;
  }
  return true;
}

function run(dir) {
  const written = new Map();
  const results = [];
  for (const fixture of FIXTURES) {
    if (!written.has(fixture.source)) written.set(fixture.source, writeSource(dir, fixture.source));
    const { path: sourcePath, source, wide } = written.get(fixture.source);
    const extension = fixture.container === 'jp2' ? 'jp2' : 'j2k';
    const codestreamPath = join(dir, `${fixture.name}.${extension}`);
    execFileSync('opj_compress', ['-i', sourcePath, '-o', codestreamPath, ...fixture.args], { stdio: 'pipe' });

    const decodedPath = join(dir, `${fixture.name}.decoded.${source.kind === 'rgb' ? 'ppm' : 'pgm'}`);
    execFileSync('opj_decompress', ['-i', codestreamPath, '-o', decodedPath], { stdio: 'pipe' });
    const decoded = readPnm(decodedPath);
    const original = readPnm(sourcePath);

    if (!fixture.irreversible) {
      // Check 1: the codestream really is lossless, so the source image is a legitimate exact oracle.
      if (!samplesEqual(decoded.planes, original.planes)) {
        throw new Error(`${fixture.name}: a reversible configuration did not round-trip losslessly through OpenJPEG itself, so it cannot be used as an exact fixture`);
      }
    }
    if (fixture.undecodable) {
      // A fixture recorded only so the refusal can be tested against real encoder output. It still had to encode and decode cleanly through OpenJPEG above, which is what makes it evidence about this decoder's own scope rather than about a broken file.
      results.push({
        name: fixture.name,
        description: fixture.description,
        width: original.width,
        height: original.height,
        componentCount: original.channels,
        bitDepth: wide ? 12 : 8,
        lossless: false,
        undecodable: true,
        codestream: readFileSync(codestreamPath).toString('base64'),
        expected: '',
      });
      continue;
    }
    const expectedPlanes = fixture.irreversible ? decoded.planes : original.planes;
    results.push({
      name: fixture.name,
      description: fixture.description,
      width: original.width,
      height: original.height,
      componentCount: original.channels,
      bitDepth: wide ? 12 : 8,
      lossless: !fixture.irreversible,
      undecodable: false,
      codestream: readFileSync(codestreamPath).toString('base64'),
      expected: samplesToBase64(expectedPlanes, wide),
    });
  }
  return results;
}

function emit(fixtures) {
  const lines = [];
  lines.push("import { base64ToBytes } from '../util/base64';");
  lines.push('');
  lines.push('// Real JPEG 2000 codestreams -- the exact bytes a PDF /JPXDecode filter carries -- produced by OpenJPEG 2.5.4 (opj_compress) from deterministic source images, by scripts/generate-jpeg2000-fixtures.mjs. Embedded as base64 so the suite needs no filesystem access.');
  lines.push('//');
  lines.push("// For every `lossless: true` fixture, `expected` is the SOURCE image the encoder was handed, not any decoder's output: the generator first proves the configuration round-trips byte-identically through OpenJPEG's own decoder, which makes the source an exact oracle that neither this package nor OpenJPEG produced. A decoder reproducing it has reproduced the original integers.");
  lines.push('//');
  lines.push("// For a `lossless: false` fixture the transform is the irreversible 9-7 one, which has no exact answer to reproduce; `expected` is opj_decompress's own output and the test asserts a tight per-sample tolerance against it rather than equality. See the generator script's header for the full statement of what each kind of fixture does and does not establish.");
  lines.push('//');
  lines.push('// `expected` decodes to one sample per component in planar order (every sample of component 0, then component 1, ...), one byte per sample for an 8-bit fixture and one little-endian 16-bit word per sample for a deeper one.');
  lines.push('');
  lines.push('export interface Jpeg2000Fixture {');
  lines.push('  readonly name: string;');
  lines.push('  readonly description: string;');
  lines.push('  readonly width: number;');
  lines.push('  readonly height: number;');
  lines.push('  readonly componentCount: number;');
  lines.push('  readonly bitDepth: number;');
  lines.push('  // Whether `expected` is the encoder\'s own input (a reversible configuration) rather than OpenJPEG\'s decode of a lossy one.');
  lines.push('  readonly lossless: boolean;');
  lines.push('  // Set for a fixture recorded only so a scope refusal can be tested against real encoder output; its `expected` field is empty because there is nothing this decoder is meant to produce for it.');
  lines.push('  readonly undecodable: boolean;');
  lines.push('  readonly codestream: string;');
  lines.push('  readonly expected: string;');
  lines.push('}');
  lines.push('');
  lines.push('export function jpeg2000FixtureBytes(encoded: string): Uint8Array<ArrayBuffer> {');
  lines.push('  return base64ToBytes(encoded);');
  lines.push('}');
  lines.push('');
  lines.push('// Decodes a fixture\'s `expected` field into one array per component, matching what decodeJpeg2000 returns.');
  lines.push('export function jpeg2000FixtureSamples(fixture: Jpeg2000Fixture): number[][] {');
  lines.push('  const bytes = base64ToBytes(fixture.expected);');
  lines.push('  const wide = fixture.bitDepth > 8;');
  lines.push('  const perComponent = fixture.width * fixture.height;');
  lines.push('  const planes: number[][] = [];');
  lines.push('  for (let c = 0; c < fixture.componentCount; c++) {');
  lines.push('    const plane: number[] = [];');
  lines.push('    for (let i = 0; i < perComponent; i++) {');
  lines.push('      const at = (c * perComponent + i) * (wide ? 2 : 1);');
  lines.push('      plane.push(wide ? (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8) : (bytes[at] ?? 0));');
  lines.push('    }');
  lines.push('    planes.push(plane);');
  lines.push('  }');
  lines.push('  return planes;');
  lines.push('}');
  lines.push('');
  lines.push('export const JPEG2000_FIXTURES: readonly Jpeg2000Fixture[] = [');
  for (const fixture of fixtures) {
    lines.push('  {');
    lines.push(`    name: ${JSON.stringify(fixture.name)},`);
    lines.push(`    description: ${JSON.stringify(fixture.description)},`);
    lines.push(`    width: ${String(fixture.width)},`);
    lines.push(`    height: ${String(fixture.height)},`);
    lines.push(`    componentCount: ${String(fixture.componentCount)},`);
    lines.push(`    bitDepth: ${String(fixture.bitDepth)},`);
    lines.push(`    lossless: ${String(fixture.lossless)},`);
    lines.push(`    undecodable: ${String(fixture.undecodable)},`);
    lines.push(`    codestream: ${JSON.stringify(fixture.codestream)},`);
    lines.push(`    expected: ${JSON.stringify(fixture.expected)},`);
    lines.push('  },');
  }
  lines.push('];');
  lines.push('');
  writeFileSync(outputPath, lines.join('\n'));
}

const dir = mkdtempSync(join(tmpdir(), 'jpeg2000-fixtures-'));
try {
  const fixtures = run(dir);
  emit(fixtures);
  console.log(`wrote ${String(fixtures.length)} fixtures to ${outputPath}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
