// Test-only helpers for expressing RTF fixtures as source strings. RTF is a byte format -- a `\'hh` escape names a raw byte to be decoded through the document's own codepage, and `\binN` is followed by literally N arbitrary bytes -- so every entry point in this package takes bytes, and a fixture written as a TypeScript string literal has to be converted the one way that is actually lossless for RTF's own 7-bit-ASCII-plus-escapes alphabet: one code unit to one byte.
//
// Excluded from the published build (tsdown.config.ts's entry list drops src/test-support/**), so this is not part of the package's surface. A caller holding RTF as a string rather than bytes uses rtfBytesFromLatin1 from src/bytes.ts, which is the same conversion with the same refusal, exported and documented.

import { rtfBytesFromLatin1 } from "../bytes";

export function bytes(source: string): Uint8Array {
  return rtfBytesFromLatin1(source);
}

// The inverse, for asserting on writer output without decoding through a codepage: a writer's own output is 7-bit ASCII by construction (every non-ASCII character leaves as a \uN escape), so reading it back as one byte per code unit is exact.
export function text(value: Uint8Array): string {
  let out = "";
  for (const byte of value) {
    out += String.fromCharCode(byte);
  }
  return out;
}
