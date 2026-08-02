// RC4, the stream cipher ISO 32000-1 7.6.2 names for /V 1 and /V 2 security handlers (and for a /CFM /V2 crypt filter under /V 4). Trivially small, symmetric (encryption and decryption are the same operation), and completely unavailable from any platform crypto API this package could portably reach -- WebCrypto has never offered it and `node:crypto` dropped it from its default provider with OpenSSL 3. Hand-writing it is the only option that works in both a Node and a browser bundle, which is what this package's `platform: 'neutral'` build requires.
//
// RC4 is comprehensively broken and must never be used to protect anything. It is implemented here solely to *read* files that already exist and whose format mandates it.

const STATE_SIZE = 256;

export function rc4(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const state = new Uint8Array(STATE_SIZE);
  for (let i = 0; i < STATE_SIZE; i++) {
    state[i] = i;
  }
  // Key-scheduling algorithm. A zero-length key would divide by zero on the modulo below; there is no meaningful RC4 keystream for one, so the input is returned untouched rather than producing garbage under a fabricated key.
  if (key.length === 0) {
    return Uint8Array.from(data);
  }
  let j = 0;
  for (let i = 0; i < STATE_SIZE; i++) {
    j = (j + state[i]! + key[i % key.length]!) & 0xff;
    const swap = state[i]!;
    state[i] = state[j]!;
    state[j] = swap;
  }
  // Pseudo-random generation algorithm, XORed straight over the input.
  const out = new Uint8Array(data.length);
  let x = 0;
  let y = 0;
  for (let n = 0; n < data.length; n++) {
    x = (x + 1) & 0xff;
    y = (y + state[x]!) & 0xff;
    const swap = state[x]!;
    state[x] = state[y]!;
    state[y] = swap;
    out[n] = data[n]! ^ state[(state[x]! + state[y]!) & 0xff]!;
  }
  return out;
}
