// Isomorphic base64 helpers (no Node Buffer, no atob/btoa) -- this package cannot import ooxml.js's or doc-codec's own identical table-based helpers directly (ppt-codec depends on archive-codec, byte-codec and document-schema.js only, never a sibling codec, per the monorepo README's package-layering rule), so the same proven technique is carried here rather than reached for via a runtime global, keeping this package's own Worker-isomorphism independent of every other codec's. drawing/blips.ts (a picture blip's raw file bytes, encode) and drawing/blips-write through the same module (decode) share this one implementation rather than each carrying a private copy.

const TABLE =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const DECODE: Uint8Array<ArrayBuffer> = (() => {
  const map = new Uint8Array(256).fill(255);
  for (let index = 0; index < TABLE.length; index += 1) {
    map[TABLE.charCodeAt(index)] = index;
  }
  return map;
})();

export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  const len = bytes.length;
  for (let index = 0; index < len; index += 3) {
    // A length check ahead of each of these would be redundant: reading a Uint8Array past its own end already yields undefined, so `?? 0` alone already produces the identical fallback the check would have -- there is no index for which the two ever disagree.
    const b0 = bytes[index] ?? 0;
    const b1 = bytes[index + 1] ?? 0;
    const b2 = bytes[index + 2] ?? 0;
    out += TABLE.charAt(b0 >> 2);
    out += TABLE.charAt(((b0 & 0x03) << 4) | (b1 >> 4));
    out += index + 1 < len ? TABLE.charAt(((b1 & 0x0f) << 2) | (b2 >> 6)) : "=";
    out += index + 2 < len ? TABLE.charAt(b2 & 0x3f) : "=";
  }
  return out;
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, "");
  const len = clean.length;
  // A generous upper bound rather than the exact len*3/4 decoded byte count: base64 can only ever decode to at most as many bytes as input characters (every 4 characters decode to at most 3 bytes, always fewer), and the exact figure is never observable anyway -- the function always returns a subarray trimmed to the real `position` reached, so an oversized allocation here changes nothing a caller can see.
  const out = new Uint8Array(len);
  let position = 0;
  for (let index = 0; index < len; index += 4) {
    const c0 = DECODE[clean.charCodeAt(index)] ?? 255;
    const c1 = DECODE[clean.charCodeAt(index + 1)] ?? 255;
    const c2 = clean.charCodeAt(index + 2);
    const c3 = clean.charCodeAt(index + 3);
    if (c0 === 255 || c1 === 255) {
      throw new Error("invalid base64 input");
    }
    out[position++] = (c0 << 2) | (c1 >> 4);
    if (c2 !== 61) {
      const d2 = DECODE[c2] ?? 255;
      out[position++] = ((c1 & 0x0f) << 4) | (d2 >> 2);
      if (c3 !== 61) {
        const d3 = DECODE[c3] ?? 255;
        out[position++] = ((d2 & 0x03) << 6) | d3;
      }
    }
  }
  return out.subarray(0, position);
}
