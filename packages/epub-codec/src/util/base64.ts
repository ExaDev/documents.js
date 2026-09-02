// Isomorphic base64 helpers (no Node Buffer): round-trip Uint8Array <-> base64 string. A third hand-written copy of the identical helper odf.js's src/util/base64.ts and pdf-codec's src/util/base64.ts already carry (pdf-codec's own is itself a verbatim copy of odf.js's) -- the same "each codec hand-duplicates this small utility" precedent zip.ts's own top-of-file note already applies to the OCF ZIP wrapper. Every position `? 0` falls back to (a padding byte past the input's own length, or a decode-table miss on real base64 input) is unreachable in a well-formed call, and the fallback is chosen to keep this file free of non-null assertions rather than to handle a case that can actually occur.

const TABLE =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const DECODE: Uint8Array<ArrayBuffer> = (() => {
  const map = new Uint8Array(256).fill(255);
  for (let i = 0; i < TABLE.length; i += 1) {
    map[TABLE.charCodeAt(i)] = i;
  }
  return map;
})();

export function bytesToBase64(bytes: Uint8Array<ArrayBuffer>): string {
  let out = "";
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    out += TABLE.charAt(b0 >> 2);
    out += TABLE.charAt(((b0 & 0x03) << 4) | (b1 >> 4));
    out += i + 1 < len ? TABLE.charAt(((b1 & 0x0f) << 2) | (b2 >> 6)) : "=";
    out += i + 2 < len ? TABLE.charAt(b2 & 0x3f) : "=";
  }
  return out;
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, "");
  const len = clean.length;
  const out = new Uint8Array(Math.floor((len * 3) / 4));
  let position = 0;
  for (let i = 0; i < len; i += 4) {
    const c0 = DECODE[clean.charCodeAt(i)] ?? 255;
    const c1 = DECODE[clean.charCodeAt(i + 1)] ?? 255;
    const code2 = clean.charCodeAt(i + 2);
    const code3 = clean.charCodeAt(i + 3);
    if (c0 === 255 || c1 === 255) {
      throw new Error("invalid base64 input");
    }
    out[position] = (c0 << 2) | (c1 >> 4);
    position += 1;
    if (code2 !== 61) {
      const d2 = DECODE[code2] ?? 255;
      out[position] = ((c1 & 0x0f) << 4) | (d2 >> 2);
      position += 1;
      if (code3 !== 61) {
        const d3 = DECODE[code3] ?? 255;
        out[position] = ((d2 & 0x03) << 6) | d3;
        position += 1;
      }
    }
  }
  return out.subarray(0, position);
}
