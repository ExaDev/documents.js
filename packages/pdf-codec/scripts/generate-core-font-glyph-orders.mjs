#!/usr/bin/env node
// Regenerates src/glyph-data/core-font-glyph-orders.ts: the glyph id -> text order and the advance widths of each core face listed below, read from installed copies of those faces.
//
// Run with `node scripts/generate-core-font-glyph-orders.mjs <font directory>...` after `pnpm build` (it reads the sfnt tables through this package's own dist/ readers). Every .ttf file in the given directories is read, and for each face below the file with the highest 'head' fontRevision wins, so the data covers the most glyphs any installed release numbers. Not part of `pnpm build`/`pnpm test`; the generated module is committed like the src/assets/ font modules. It lives in src/glyph-data/ rather than src/assets/ because the read path needs it, and src/read-graph.test.ts keeps every src/assets/ module (the write path's font binaries) out of the read path's module graph. The faces themselves are not vendored and nothing of their outlines is copied: what is recorded is the order in which each face numbers its glyphs, what each glyph draws, and each glyph's advance width (from its 'hmtx' table), the same kind of metric data the standard-14 AFM tables in src/afm-widths.ts hold.
//
// What a glyph draws comes from the face's own tables. A glyph the Windows Unicode 'cmap' subtable reaches records the lowest code point reaching it outside the private-use areas (U+0020 rather than U+00A0 for the space glyph), since every code point a face maps to one glyph is a reading of that glyph. A glyph no code point reaches but a 'GSUB' ligature substitution produces records the text of its components (the "ffi" ligature, f f i), when every component draws known text and every substitution producing the glyph agrees. Any other glyph records nothing.
//
// Binary layout, before raw DEFLATE (fflate's deflateSync, RFC 1951) and base64: a uint16 face count, then per face a uint8 name length, the PostScript name in ASCII, a uint16 unitsPerEm, a uint16 glyph count, and per glyph a uint8 code point count n, n uint24 code points, and a uint16 advance width, all big-endian. src/core-font-glyph-orders.ts reads it.

import { deflateSync } from 'fflate';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');
const load = (name) => import(pathToFileURL(join(dist, `${name}.js`)).href);
const { parseSfnt, sfntTableBytes, u16, u32 } = await load('sfnt');
const { readCmapSubtables } = await load('cmap-table');
const { parseHmtx } = await load('hmtx-table');
const { parseHead, parseName } = await load('font-tables');

// The faces producers commonly embed as composite subsets that keep the face's own glyph numbering while dropping 'cmap' and 'post'. A reader applies a face's order to a glyph only where the embedded program's advance width for that glyph equals the one recorded here (see src/core-font-glyph-orders.ts).
const FACES = [
  'ArialMT',
  'Arial-BoldMT',
  'Arial-ItalicMT',
  'Arial-BoldItalicMT',
  'TimesNewRomanPSMT',
  'TimesNewRomanPS-BoldMT',
  'TimesNewRomanPS-ItalicMT',
  'TimesNewRomanPS-BoldItalicMT',
  'CourierNewPSMT',
  'CourierNewPS-BoldMT',
  'CourierNewPS-ItalicMT',
  'CourierNewPS-BoldItalicMT',
];

const directories = process.argv.slice(2);
if (directories.length === 0) {
  console.error('usage: node scripts/generate-core-font-glyph-orders.mjs <font directory>...');
  process.exit(1);
}

const isPrivateUse = (cp) => (cp >= 0xe000 && cp <= 0xf8ff) || (cp >= 0xf0000 && cp <= 0x10fffd);
const WINDOWS_PLATFORM = 3;
const WINDOWS_UNICODE_BMP = 1;
const MAXP_NUM_GLYPHS_OFFSET = 4;
const HEAD_FONT_REVISION_OFFSET = 4;
const FIXED_16_16 = 65536;

// The newest installed release of each face, keyed by PostScript name.
const newest = new Map();
for (const directory of directories) {
  for (const file of readdirSync(directory).filter((name) => name.toLowerCase().endsWith('.ttf'))) {
    const path = join(directory, file);
    const font = parseSfnt(new Uint8Array(readFileSync(path)));
    const name = font === undefined ? undefined : parseName(font)?.postScriptName;
    if (!FACES.includes(name)) {
      continue;
    }
    const revision = u32(sfntTableBytes(font, 'head'), HEAD_FONT_REVISION_OFFSET) / FIXED_16_16;
    if ((newest.get(name)?.revision ?? -1) < revision) {
      newest.set(name, { path, font, revision });
    }
  }
}
const missing = FACES.filter((face) => !newest.has(face));
if (missing.length > 0) {
  console.error(`no installed copy of: ${missing.join(', ')}`);
  process.exit(1);
}

// 'GSUB' ligature substitutions (OpenType 'GSUB' LookupType 4, directly or inside a LookupType 7 extension): ligature glyph -> its component glyphs, every substitution producing a glyph listed.
function ligatures(font) {
  const gsub = sfntTableBytes(font, 'GSUB');
  const found = new Map();
  if (gsub === undefined) {
    return found;
  }
  const coverageGlyphs = (at) => {
    const format = u16(gsub, at);
    const count = u16(gsub, at + 2);
    const glyphs = [];
    for (let i = 0; i < count; i++) {
      if (format === 1) {
        glyphs.push(u16(gsub, at + 4 + i * 2));
      } else {
        const record = at + 4 + i * 6;
        for (let g = u16(gsub, record); g <= u16(gsub, record + 2); g++) {
          glyphs.push(g);
        }
      }
    }
    return glyphs;
  };
  const readLigatureSubtable = (at) => {
    const firsts = coverageGlyphs(at + u16(gsub, at + 2));
    const setCount = u16(gsub, at + 4);
    for (let s = 0; s < setCount; s++) {
      const set = at + u16(gsub, at + 6 + s * 2);
      for (let l = 0; l < u16(gsub, set); l++) {
        const ligature = set + u16(gsub, set + 2 + l * 2);
        const glyph = u16(gsub, ligature);
        const components = [firsts[s]];
        for (let c = 1; c < u16(gsub, ligature + 2); c++) {
          components.push(u16(gsub, ligature + 2 + c * 2));
        }
        found.set(glyph, [...(found.get(glyph) ?? []), components]);
      }
    }
  };
  const lookupList = u16(gsub, 8);
  for (let i = 0; i < u16(gsub, lookupList); i++) {
    const lookup = lookupList + u16(gsub, lookupList + 2 + i * 2);
    const type = u16(gsub, lookup);
    for (let s = 0; s < u16(gsub, lookup + 4); s++) {
      const subtable = lookup + u16(gsub, lookup + 6 + s * 2);
      if (type === 4) {
        readLigatureSubtable(subtable);
      } else if (type === 7 && u16(gsub, subtable + 2) === 4) {
        readLigatureSubtable(subtable + u32(gsub, subtable + 4));
      }
    }
  }
  return found;
}

const chunks = [];
const push = (bytes) => chunks.push(Uint8Array.from(bytes));
push([FACES.length >> 8, FACES.length & 0xff]);
for (const name of FACES) {
  const { path, font, revision } = newest.get(name);
  const unitsPerEm = parseHead(font).unitsPerEm;
  const glyphCount = u16(sfntTableBytes(font, 'maxp'), MAXP_NUM_GLYPHS_OFFSET);
  const unicode = readCmapSubtables(font).find((s) => s.platformId === WINDOWS_PLATFORM && s.encodingId === WINDOWS_UNICODE_BMP);
  const textOf = new Map();
  unicode.forEachMapping((codePoint, glyphId) => {
    if (isPrivateUse(codePoint)) {
      return;
    }
    const held = textOf.get(glyphId);
    if (held === undefined || codePoint < held[0]) {
      textOf.set(glyphId, [codePoint]);
    }
  });
  const fromCmap = textOf.size;
  // A ligature of ligatures resolves once its components have, so this repeats until a pass resolves nothing new.
  const pending = ligatures(font);
  for (let resolved = true; resolved; ) {
    resolved = false;
    for (const [glyph, sequences] of pending) {
      if (textOf.has(glyph)) {
        pending.delete(glyph);
        continue;
      }
      const texts = sequences.map((components) => (components.every((c) => textOf.has(c)) ? components.flatMap((c) => textOf.get(c)) : undefined));
      if (texts.some((text) => text === undefined)) {
        continue;
      }
      pending.delete(glyph);
      if (new Set(texts.map((text) => text.join(' '))).size === 1) {
        textOf.set(glyph, texts[0]);
        resolved = true;
      }
    }
  }
  const hmtx = parseHmtx(font);
  push([name.length, ...[...name].map((c) => c.charCodeAt(0))]);
  push([unitsPerEm >> 8, unitsPerEm & 0xff, glyphCount >> 8, glyphCount & 0xff]);
  for (let glyphId = 0; glyphId < glyphCount; glyphId++) {
    const codePoints = textOf.get(glyphId) ?? [];
    const advance = hmtx.advanceWidth(glyphId);
    push([codePoints.length, ...codePoints.flatMap((cp) => [cp >> 16, (cp >> 8) & 0xff, cp & 0xff]), advance >> 8, advance & 0xff]);
  }
  console.log(`${name}: revision ${revision.toFixed(2)} from ${path}, ${glyphCount} glyphs, ${fromCmap} from 'cmap', ${textOf.size - fromCmap} from ligatures`);
}

const raw = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
let offset = 0;
for (const c of chunks) {
  raw.set(c, offset);
  offset += c.length;
}
const base64 = Buffer.from(deflateSync(raw, { level: 9 })).toString('base64');
const outputPath = join(here, '..', 'src', 'glyph-data', 'core-font-glyph-orders.ts');
const header = `// AUTO-GENERATED by scripts/generate-core-font-glyph-orders.mjs from installed copies of the core faces it lists. Do not hand-edit.
// Regenerate with: node scripts/generate-core-font-glyph-orders.mjs <font directory>...
//
// Each face's glyph id -> text order and advance widths, DEFLATE-compressed (fflate's raw deflateSync) and base64-encoded; see the generator's header comment for the binary layout and src/core-font-glyph-orders.ts for the reader.
export const CORE_FONT_GLYPH_ORDERS_DEFLATED_BASE64 =
`;
writeFileSync(outputPath, `${header}  '${base64}';\n`, 'utf8');
console.log(`Wrote ${outputPath} (${raw.length} bytes raw -> ${base64.length} base64 chars)`);
