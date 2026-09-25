// Hexadecimal conversion for picture payloads, and the one base64 decode this package's own write path needs, hand-written for the same reason every other byte-level routine in this family is: this package is Worker-isomorphic, so Node's Buffer is banned outright (the root eslint.shared.ts enforces it), and the two globals that would otherwise do the job — btoa/atob — are not universally present and operate on latin-1 strings rather than bytes anyway, which makes them the wrong shape for a picture's payload even where they exist.
//
// ContentImageBlock states its payload as base64, and RTF states a picture's payload as either #SDATA (an even-length run of ASCII hex digits, the default) or #BDATA (raw bytes after \binN). So the read path is hex-or-bytes to base64, and the write path is base64 back to hex, which is what a \pict destination emits. The read path's encode is byte-codec's bytesToBase64, the family's one implementation; the decode below stays here because it answers a different question from byte-codec's, returning undefined for an unmappable character so one malformed image degrades with a diagnostic instead of failing the whole write.

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const HEX_DIGITS = "0123456789abcdef";

const BASE64_BITS_PER_CHARACTER = 6; // log2(64) — each base64 character encodes this many bits.
const BITS_PER_BYTE = 8;
const BYTE_MASK = 0xff;
const NIBBLE_BITS = 4; // half a byte — bytesToHex's own high/low hex-digit split.
const NIBBLE_MASK = 0x0f;
const HEX_RADIX = 16;

function base64Value(character: string): number | undefined {
  const index = BASE64_ALPHABET.indexOf(character);
  return index === -1 ? undefined : index;
}

// Returns undefined rather than throwing on a character the alphabet does not contain, so a caller holding a ContentImageBlock whose base64 some other producer malformed can degrade that one image with a diagnostic instead of failing the whole write. Padding and ASCII whitespace are skipped; anything else ends the decode.
export function base64ToBytes(input: string): Uint8Array | undefined {
  const out: number[] = [];
  let accumulator = 0;
  let bits = 0;
  for (const character of input) {
    if (character === "=" || /\s/.test(character)) {
      continue;
    }
    const value = base64Value(character);
    if (value === undefined) {
      return undefined;
    }
    accumulator = (accumulator << BASE64_BITS_PER_CHARACTER) | value;
    bits += BASE64_BITS_PER_CHARACTER;
    if (bits >= BITS_PER_BYTE) {
      bits -= BITS_PER_BYTE;
      out.push((accumulator >> bits) & BYTE_MASK);
    }
  }
  return Uint8Array.from(out);
}

export function bytesToHex(input: Uint8Array): string {
  let out = "";
  for (const byte of input) {
    out += HEX_DIGITS.charAt(byte >> NIBBLE_BITS);
    out += HEX_DIGITS.charAt(byte & NIBBLE_MASK);
  }
  return out;
}

// Decodes a #SDATA run. Every character that is not a hex digit is skipped rather than rejected: a real \pict payload is wrapped across lines, and the spec's own advice to "insert a carriage-return/line feed pair without backslashes at least every 255 characters for better text transmission" means whitespace inside the run is expected, not exceptional. A trailing odd digit is dropped, since half a byte is not a byte.
export function hexToBytes(input: string): Uint8Array<ArrayBuffer> {
  const out: number[] = [];
  let high: number | undefined;
  for (const character of input) {
    const value = HEX_DIGITS.indexOf(character.toLowerCase());
    if (value === -1) {
      continue;
    }
    if (high === undefined) {
      high = value;
      continue;
    }
    out.push(high * HEX_RADIX + value);
    high = undefined;
  }
  return Uint8Array.from(out);
}
