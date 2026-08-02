import { inflateSync } from 'fflate';
import { CALADEA_REGULAR_FONT_DEFLATED_BASE64 } from '../assets/caladea-regular';
import { CARLITO_BOLD_FONT_DEFLATED_BASE64 } from '../assets/carlito-bold';
import { CARLITO_ITALIC_FONT_DEFLATED_BASE64 } from '../assets/carlito-italic';
import { CARLITO_REGULAR_FONT_DEFLATED_BASE64 } from '../assets/carlito-regular';
import { base64ToBytes } from '../util/base64';

// The real, vendored text fonts as raw sfnt bytes, for tests that parse genuine font tables rather than a synthetic fixture. These are the exact bytes of assets/fonts/{carlito,caladea}/*.ttf: scripts/generate-text-font-assets.mjs DEFLATE-compresses and base64-encodes each vendored file into src/assets/, and inflating one here reverses that transform byte for byte (proved independently by src/assets/text-font-assets.test.ts). Going through the embedded asset rather than reading assets/ from disk keeps the suite filesystem-free, matching the convention test-support/ccitt-fax.ts states for its own fixtures.
//
// Each face is inflated at most once per process: a Carlito face is ~600 KB inflated, and several test files parse the same one.
const cache = new Map<string, Uint8Array<ArrayBuffer>>();

function loadFace(name: string, deflatedBase64: string): Uint8Array<ArrayBuffer> {
  const cached = cache.get(name);
  if (cached !== undefined) {
    return cached;
  }
  // The generator uses fflate's deflateSync (raw DEFLATE, RFC 1951), not the zlib framing src/bytes/flate.ts handles, so this is inflateSync rather than that module's own inflate(). Copying into a fresh Uint8Array gives the ArrayBuffer-backed type every sfnt reader in this package takes.
  const inflated = inflateSync(base64ToBytes(deflatedBase64));
  const bytes = new Uint8Array(inflated.length);
  bytes.set(inflated);
  cache.set(name, bytes);
  return bytes;
}

export function carlitoRegularBytes(): Uint8Array<ArrayBuffer> {
  return loadFace('Carlito-Regular', CARLITO_REGULAR_FONT_DEFLATED_BASE64);
}

export function carlitoBoldBytes(): Uint8Array<ArrayBuffer> {
  return loadFace('Carlito-Bold', CARLITO_BOLD_FONT_DEFLATED_BASE64);
}

export function carlitoItalicBytes(): Uint8Array<ArrayBuffer> {
  return loadFace('Carlito-Italic', CARLITO_ITALIC_FONT_DEFLATED_BASE64);
}

export function caladeaRegularBytes(): Uint8Array<ArrayBuffer> {
  return loadFace('Caladea-Regular', CALADEA_REGULAR_FONT_DEFLATED_BASE64);
}
