// RC4, the stream cipher [MS-OFFCRYPTO] 2.3.6.1/2.3.6.2 names for legacy Office binary document (.doc/.xls/.ppt) encryption. Trivially small, symmetric (encryption and decryption are the same operation), and completely unavailable from any platform crypto API this package could portably reach -- WebCrypto has never offered it and `node:crypto` dropped it from its default provider with OpenSSL 3. Hand-writing it is the only option that works in both a Node and a browser bundle, which is what this package's `platform: 'neutral'` build requires.
//
// RC4 is comprehensively broken and must never be used to protect anything. It is implemented here solely to *read* files that already exist and whose format mandates it.
//
// Every byte read below goes through a DataView rather than plain indexed access: with noUncheckedIndexedAccess on, `arr[i]` types as possibly-undefined even where a loop bound already guarantees it is not, and DataView's own get/setUint8 sidestep that without a non-null assertion on every single swap.

const STATE_SIZE = 256;

export function rc4(
  key: Uint8Array<ArrayBuffer>,
  data: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  // Key-scheduling algorithm would divide by zero on the modulo below; there is no meaningful RC4 keystream for an empty key, so the input is returned untouched rather than producing garbage under a fabricated key.
  if (key.length === 0) {
    return Uint8Array.from(data);
  }
  const keyView = new DataView(key.buffer, key.byteOffset, key.byteLength);
  const state = new DataView(new ArrayBuffer(STATE_SIZE));
  for (let i = 0; i < STATE_SIZE; i++) {
    state.setUint8(i, i);
  }
  let j = 0;
  for (let i = 0; i < STATE_SIZE; i++) {
    j = (j + state.getUint8(i) + keyView.getUint8(i % key.length)) & 0xff;
    const swap = state.getUint8(i);
    state.setUint8(i, state.getUint8(j));
    state.setUint8(j, swap);
  }
  // Pseudo-random generation algorithm, XORed straight over the input.
  const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out = new Uint8Array(data.length);
  let x = 0;
  let y = 0;
  for (let n = 0; n < data.length; n++) {
    x = (x + 1) & 0xff;
    y = (y + state.getUint8(x)) & 0xff;
    const swap = state.getUint8(x);
    state.setUint8(x, state.getUint8(y));
    state.setUint8(y, swap);
    out[n] =
      dataView.getUint8(n) ^
      state.getUint8((state.getUint8(x) + state.getUint8(y)) & 0xff);
  }
  return out;
}
