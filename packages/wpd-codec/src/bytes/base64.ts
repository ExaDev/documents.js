// Standard base64 (RFC 4648, with padding), hand-written because this package carries no dependency that offers it and its published src/ must stay Worker-isomorphic -- no Buffer polyfill, no atob round trip through binary strings. Consumed by the image-box lift (read.ts), which hands an embedded PNG/JPEG payload to the shared schema's ContentImageBlock.base64 field.

import { byteAt } from "./view";

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = byteAt(bytes, i);
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += ALPHABET.charAt(b0 >>> 2);
    out += ALPHABET.charAt(((b0 & 0x03) << 4) | ((b1 ?? 0) >>> 4));
    if (b1 === undefined) {
      return out + "==";
    }
    out += ALPHABET.charAt(((b1 & 0x0f) << 2) | ((b2 ?? 0) >>> 6));
    if (b2 === undefined) {
      return out + "=";
    }
    out += ALPHABET.charAt(b2 & 0x3f);
  }
  return out;
}
