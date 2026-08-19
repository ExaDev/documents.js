import { inflateSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { CALADEA_BOLD_FONT_DEFLATED_BASE64 } from './caladea-bold';
import { CALADEA_BOLDITALIC_FONT_DEFLATED_BASE64 } from './caladea-bolditalic';
import { CALADEA_ITALIC_FONT_DEFLATED_BASE64 } from './caladea-italic';
import { CALADEA_REGULAR_FONT_DEFLATED_BASE64 } from './caladea-regular';
import { CARLITO_BOLD_FONT_DEFLATED_BASE64 } from './carlito-bold';
import { CARLITO_BOLDITALIC_FONT_DEFLATED_BASE64 } from './carlito-bolditalic';
import { CARLITO_ITALIC_FONT_DEFLATED_BASE64 } from './carlito-italic';
import { CARLITO_REGULAR_FONT_DEFLATED_BASE64 } from './carlito-regular';

// Each asset below is a real, vendored TrueType font (see assets/fonts/{carlito,caladea}/NOTICE.md for source and licence), DEFLATE-compressed and base64-encoded by scripts/generate-text-font-assets.mjs. This test proves the round trip end to end -- base64-decode, inflate, and check the result is a genuine sfnt with a sane table directory -- rather than merely asserting the exported string is non-empty.
const ASSETS = [
  { name: 'Carlito Regular', base64: CARLITO_REGULAR_FONT_DEFLATED_BASE64 },
  { name: 'Carlito Bold', base64: CARLITO_BOLD_FONT_DEFLATED_BASE64 },
  { name: 'Carlito Italic', base64: CARLITO_ITALIC_FONT_DEFLATED_BASE64 },
  { name: 'Carlito BoldItalic', base64: CARLITO_BOLDITALIC_FONT_DEFLATED_BASE64 },
  { name: 'Caladea Regular', base64: CALADEA_REGULAR_FONT_DEFLATED_BASE64 },
  { name: 'Caladea Bold', base64: CALADEA_BOLD_FONT_DEFLATED_BASE64 },
  { name: 'Caladea Italic', base64: CALADEA_ITALIC_FONT_DEFLATED_BASE64 },
  { name: 'Caladea BoldItalic', base64: CALADEA_BOLDITALIC_FONT_DEFLATED_BASE64 },
];

const TRUETYPE_SFNT_VERSION = 0x00010000;
// The core sfnt tables every one of these four-face TrueType families must declare for glyph rendering and text-layout metrics to work at all.
const REQUIRED_TABLES = ['cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post'];

function readSfntTableTags(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numTables = view.getUint16(4);
  const tags: string[] = [];
  for (let i = 0; i < numTables; i += 1) {
    const recordOffset = 12 + 16 * i;
    const tag = String.fromCharCode(
      bytes[recordOffset]!,
      bytes[recordOffset + 1]!,
      bytes[recordOffset + 2]!,
      bytes[recordOffset + 3]!,
    );
    tags.push(tag);
  }
  return tags;
}

describe('vendored text font assets', () => {
  for (const { name, base64 } of ASSETS) {
    it(`${name}: inflates back to a valid TrueType sfnt`, () => {
      const deflated = Buffer.from(base64, 'base64');
      const inflated = inflateSync(new Uint8Array(deflated));

      expect(inflated.length).toBeGreaterThan(0);

      const view = new DataView(inflated.buffer, inflated.byteOffset, inflated.byteLength);
      const sfntVersion = view.getUint32(0);
      expect(sfntVersion).toBe(TRUETYPE_SFNT_VERSION);

      const numTables = view.getUint16(4);
      expect(numTables).toBeGreaterThan(0);
      const tableDirectoryEnd = 12 + 16 * numTables;
      expect(tableDirectoryEnd).toBeLessThanOrEqual(inflated.length);

      const tags = readSfntTableTags(inflated);
      for (const required of REQUIRED_TABLES) {
        expect(tags).toContain(required);
      }
    });
  }
});
