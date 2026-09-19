// Isomorphic base64 helpers (no Node Buffer, no atob/btoa) -- this package cannot import ooxml.js's own identical util/base64.ts directly (doc-codec depends on archive-codec and document-schema.js only, never a sibling codec, per the README's own Architecture section), so the same proven table-based technique is duplicated here rather than reached for via a runtime global, keeping this package's own Worker-isomorphism independent of every other codec's. pictures.ts's own inline picture bytes (base64 encode) and pictures-write.ts's own inverse (base64 decode) share this one implementation rather than each carrying a private copy.

const TABLE =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const PADDING_CODE = "=".charCodeAt(0);

const DECODE: Uint8Array<ArrayBuffer> = (() => {
  const map = new Uint8Array(256).fill(255);
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
 * Output characters are collected as character codes and turned into a string one chunk at a time rather than appended to a string one character at a time, which is what made encoding a few megabytes take seconds under instrumentation. Pure typed-array and string arithmetic: no Buffer, atob or btoa, so it runs unchanged in a Worker.
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

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, "");
  // Collected rather than written into a pre-sized Uint8Array: the exact final length depends on how many quartets end in padding, known only once every quartet has been walked, so a pre-sized buffer would need its own capacity arithmetic that nothing here would ever actually observe (Uint8Array.from below sizes itself exactly from what was pushed).
  const out: number[] = [];
  for (let index = 0; index < clean.length; index += 4) {
    const c0 = DECODE[clean.charCodeAt(index)] ?? 255;
    const c1 = DECODE[clean.charCodeAt(index + 1)] ?? 255;
    const c2 = clean.charCodeAt(index + 2);
    const c3 = clean.charCodeAt(index + 3);
    if (c0 === 255 || c1 === 255) {
      throw new Error("invalid base64 input");
    }
    out.push((c0 << 2) | (c1 >> 4));
    if (c2 !== 61) {
      const d2 = DECODE[c2] ?? 255;
      out.push(((c1 & 0x0f) << 4) | (d2 >> 2));
      if (c3 !== 61) {
        const d3 = DECODE[c3] ?? 255;
        out.push(((d2 & 0x03) << 6) | d3);
      }
    }
  }
  return Uint8Array.from(out);
}
