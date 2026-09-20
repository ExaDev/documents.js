// Standard-alphabet base64 (RFC 4648 section 4) over bytes, in both directions. The one implementation the documents.js family shares: every codec that has to put an image payload into a `data:` URI, an OOXML/ODF inline picture, or a ContentImageBlock.base64 field reaches for this rather than carrying its own alphabet indexing. Pure typed-array and string arithmetic, with no Buffer and no atob/btoa, so it runs unchanged in a Worker, a browser, and Node.

const TABLE =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const PADDING_CODE = "=".charCodeAt(0);

const BYTE_VALUES = 256;

/** What `DECODE` holds at every code point the alphabet does not cover. Any value outside the 0-63 range a real alphabet index occupies would serve; this one is the largest a byte can hold, so no arithmetic below can ever produce it by accident. */
const DECODE_MISS = 0xff;

const DECODE: Uint8Array<ArrayBuffer> = (() => {
  const map = new Uint8Array(BYTE_VALUES).fill(DECODE_MISS);
  for (let index = 0; index < TABLE.length; index += 1) {
    map[TABLE.charCodeAt(index)] = index;
  }
  return map;
})();

/**
 * JavaScriptCore rejects a call with more than this many arguments, a limit MDN documents as hard-coded (https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/apply). Other engines bound the same thing by stack size or throw once it is exceeded, so this is the one stated figure to stay under. `String.fromCharCode.apply` below passes one argument per output character.
 */
const MAX_CALL_ARGUMENTS = 65_536;

/** Output characters converted by one `String.fromCharCode.apply` call: half of MAX_CALL_ARGUMENTS, which is also the quantum MDN's own chunked-apply example uses, leaving the engine room for whatever else it puts on its argument stack. It is divisible by four, so every chunk holds whole four-character groups. Exported so the tests can place inputs on and around a chunk boundary without repeating the figure. */
export const BASE64_ENCODE_CHUNK_CHARS = MAX_CALL_ARGUMENTS / 2;

/**
 * Encodes bytes as padded standard-alphabet base64 (RFC 4648 section 4).
 *
 * Output characters are collected as character codes and turned into a string one chunk at a time rather than appended to a string one character at a time, which is what made encoding a few megabytes take seconds under instrumentation.
 * @param bytes - The bytes to encode; only the view's own bytes are read.
 * @returns The base64 text, four characters per three input bytes with `=` padding, and an empty string for empty input.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const len = bytes.length;
  // One buffer for every chunk, and the chunk size is read back from its length so the two cannot disagree. Only positions below `filled` hold the current chunk's characters; the slice below takes exactly those.
  const codes = new Array<number>(BASE64_ENCODE_CHUNK_CHARS);
  // Three input bytes per four output characters, so a chunk boundary never falls inside a three-byte group and only the final chunk can end in padding.
  const chunkBytes = (codes.length / 4) * 3;
  return Array.from(
    { length: Math.ceil(len / chunkBytes) },
    (_unused, chunk) => {
      const start = chunk * chunkBytes;
      const end = Math.min(start + chunkBytes, len);
      let filled = 0;
      for (let index = start; index < end; index += 3) {
        // No bounds check needed on top of the `?? 0` fallback: reading a TypedArray past its own length already yields `undefined`, the same as reading before this trailing group has actually begun, so a manual `index + 1 < len` guard would only ever duplicate what indexing out of range already does.
        const b0 = bytes[index] ?? 0;
        const b1 = bytes[index + 1] ?? 0;
        const b2 = bytes[index + 2] ?? 0;
        codes[filled++] = TABLE.charCodeAt(b0 >> 2);
        codes[filled++] = TABLE.charCodeAt(((b0 & 0x03) << 4) | (b1 >> 4));
        codes[filled++] =
          index + 1 < len
            ? TABLE.charCodeAt(((b1 & 0x0f) << 2) | (b2 >> 6))
            : PADDING_CODE;
        codes[filled++] =
          index + 2 < len ? TABLE.charCodeAt(b2 & 0x3f) : PADDING_CODE;
      }
      return String.fromCharCode.apply(null, codes.slice(0, filled));
    },
  ).join("");
}

/**
 * Decodes standard-alphabet base64 (RFC 4648 section 4) back to the bytes it was made from.
 *
 * Characters outside the alphabet and the padding character are removed before decoding, so text wrapped across lines, which several of the formats built on this deliberately emit, decodes the same as an unwrapped run of the same characters.
 * @param base64 - The base64 text to decode.
 * @throws Error `invalid base64 input` when a four-character group's first two characters are not both in the alphabet, which is the point at which no byte at all can be recovered from that group.
 * @returns The decoded bytes, and an empty array for input that holds no alphabet characters.
 */
export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, "");
  // Collected rather than written into a pre-sized Uint8Array: the exact final length depends on how many quartets end in padding, known only once every quartet has been walked, so a pre-sized buffer would need its own capacity arithmetic that nothing here would ever actually observe (Uint8Array.from below sizes itself exactly from what was pushed).
  const out: number[] = [];
  for (let index = 0; index < clean.length; index += 4) {
    const c0 = DECODE[clean.charCodeAt(index)] ?? DECODE_MISS;
    const c1 = DECODE[clean.charCodeAt(index + 1)] ?? DECODE_MISS;
    const c2 = clean.charCodeAt(index + 2);
    const c3 = clean.charCodeAt(index + 3);
    if (c0 === DECODE_MISS || c1 === DECODE_MISS) {
      throw new Error("invalid base64 input");
    }
    out.push((c0 << 2) | (c1 >> 4));
    if (c2 !== PADDING_CODE) {
      const d2 = DECODE[c2] ?? DECODE_MISS;
      out.push(((c1 & 0x0f) << 4) | (d2 >> 2));
      if (c3 !== PADDING_CODE) {
        const d3 = DECODE[c3] ?? DECODE_MISS;
        out.push(((d2 & 0x03) << 6) | d3);
      }
    }
  }
  return Uint8Array.from(out);
}
