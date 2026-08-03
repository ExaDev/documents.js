import { STIX_TWO_MATH_FONT_BASE64 } from '../assets/stix-two-math-font';
import { parseSfnt, sfntTableBytes } from '../sfnt';
import { base64ToBytes } from '../util/base64';

// Fixtures for the two CFF readers (cff-probe.ts and cff-bounds.ts): the real vendored font's own 'CFF ' table, plus a builder for the small hand-made programs that font does not happen to contain (a CID-keyed Top DICT, and the malformed shapes).

// The real, vendored STIX Two Math font's own 'CFF ' table -- 691 KB of genuine CFF data produced by a real font toolchain, not a fixture written to satisfy these parsers.
export function stixMathCffBytes(): Uint8Array<ArrayBuffer> {
  const font = parseSfnt(base64ToBytes(STIX_TWO_MATH_FONT_BASE64));
  if (font === undefined) {
    throw new Error('the vendored STIX Two Math font failed to parse as an sfnt container');
  }
  const cff = sfntTableBytes(font, 'CFF ');
  if (cff === undefined) {
    throw new Error('the vendored STIX Two Math font has no CFF table');
  }
  return cff;
}

// A CFF INDEX (spec section 5), with offSize 1 -- every fixture built here is small enough for one-byte offsets, and the real font above already covers a larger offSize (its own Top DICT INDEX uses 3).
export function cffIndex(entries: readonly (readonly number[])[]): number[] {
  if (entries.length === 0) {
    return [0, 0];
  }
  const offsets = [1];
  for (const entry of entries) {
    offsets.push(offsets[offsets.length - 1]! + entry.length);
  }
  return [(entries.length >> 8) & 0xff, entries.length & 0xff, 1, ...offsets, ...entries.flat()];
}

export const CFF_HEADER = [1, 0, 4, 1]; // major 1, minor 0, hdrSize 4, offSize 1

// A minimal CFF program: header, a Name INDEX holding `name`, and a Top DICT INDEX holding `topDict`. Deliberately stops there -- the String and Global Subr INDEXes that a real program carries next are only reached by a reader that gets past the Top DICT, which is exactly what the fixtures built from this are testing does not happen.
export function cffFont(name: string, topDict: readonly number[], header: readonly number[] = CFF_HEADER): Uint8Array<ArrayBuffer> {
  return new Uint8Array([...header, ...cffIndex([[...new TextEncoder().encode(name)]]), ...cffIndex([topDict])]);
}

// The ROS operator with the three operands it really takes (registry SID, ordering SID, supplement): two 16-bit operands and one small integer, then the escaped operator 12 30.
export const ROS_OPERANDS_AND_OPERATOR = [28, 0x01, 0x87, 28, 0x01, 0x88, 139, 12, 30];
