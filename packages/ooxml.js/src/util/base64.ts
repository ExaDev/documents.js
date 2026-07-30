// Isomorphic base64 helpers (no Node Buffer): round-trip Uint8Array <-> base64 string.

const TABLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const DECODE: Uint8Array<ArrayBuffer> = (() => {
  const map = new Uint8Array(256).fill(255);
  for (let i = 0; i < TABLE.length; i = i + 1) {
    map[TABLE.charCodeAt(i)] = i;
  }
  return map;
})();

export function bytesToBase64(bytes: Uint8Array<ArrayBuffer>): string {
  let out = '';
  const len = bytes.length;
  for (let i = 0; i < len; i = i + 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < len ? bytes[i + 1]! : 0;
    const b2 = i + 2 < len ? bytes[i + 2]! : 0;
    out += TABLE[b0 >> 2];
    out += TABLE[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < len ? TABLE[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < len ? TABLE[b2 & 0x3f] : '=';
  }
  return out;
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, '');
  const len = clean.length;
  const out = new Uint8Array(((len * 3) / 4) | 0);
  let p = 0;
  for (let i = 0; i < len; i = i + 4) {
    const c0 = DECODE[clean.charCodeAt(i)]!;
    const c1 = DECODE[clean.charCodeAt(i + 1)]!;
    const c2 = clean.charCodeAt(i + 2);
    const c3 = clean.charCodeAt(i + 3);
    if (c0 === 255 || c1 === 255) {
      throw new Error('invalid base64 input');
    }
    out[p++] = (c0 << 2) | (c1 >> 4);
    if (c2 !== 61) {
      const d2 = DECODE[c2]!;
      out[p++] = ((c1 & 0x0f) << 4) | (d2 >> 2);
      if (c3 !== 61) {
        const d3 = DECODE[c3]!;
        out[p++] = ((d2 & 0x03) << 6) | d3;
      }
    }
  }
  return out.subarray(0, p);
}
