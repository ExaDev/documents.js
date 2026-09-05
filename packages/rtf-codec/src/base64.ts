// Base64 and hexadecimal conversion for picture payloads, hand-written for the same reason every other byte-level routine in this family is: this package is Worker-isomorphic, so Node's Buffer is banned outright (the root eslint.shared.ts enforces it), and the two globals that would otherwise do the job -- btoa/atob -- are not universally present and operate on latin-1 strings rather than bytes anyway, which makes them the wrong shape for a picture's payload even where they exist.
//
// ContentImageBlock states its payload as base64, and RTF states a picture's payload as either #SDATA (an even-length run of ASCII hex digits, the default) or #BDATA (raw bytes after \binN). So the read path is hex-or-bytes to base64, and the write path is base64 back to hex, which is what a \pict destination emits.

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const HEX_DIGITS = "0123456789abcdef";

// Indexed reads below go through charAt rather than [] on purpose: under noUncheckedIndexedAccess a bracket read is typed string | undefined, and every index here is already masked into the alphabet's own range by the bit operations that produce it (>> 2 and & 0b111111 for base64, >> 4 and & 0x0f for hex), so charAt's total signature states what the arithmetic already guarantees instead of a ?? "" fallback pretending an unreachable case is real.
export function bytesToBase64(input: Uint8Array): string {
  let out = "";
  for (let index = 0; index < input.length; index += 3) {
    const first = input[index] ?? 0;
    const second = input[index + 1];
    const third = input[index + 2];
    out += BASE64_ALPHABET.charAt(first >> 2);
    out += BASE64_ALPHABET.charAt(((first & 0b11) << 4) | ((second ?? 0) >> 4));
    out +=
      second === undefined
        ? "="
        : BASE64_ALPHABET.charAt(
            ((second & 0b1111) << 2) | ((third ?? 0) >> 6),
          );
    out += third === undefined ? "=" : BASE64_ALPHABET.charAt(third & 0b111111);
  }
  return out;
}

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
    accumulator = (accumulator << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((accumulator >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

export function bytesToHex(input: Uint8Array): string {
  let out = "";
  for (const byte of input) {
    out += HEX_DIGITS.charAt(byte >> 4);
    out += HEX_DIGITS.charAt(byte & 0x0f);
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
    out.push(high * 16 + value);
    high = undefined;
  }
  return Uint8Array.from(out);
}
