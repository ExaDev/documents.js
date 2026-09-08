// Cryptographically secure randomness for the standard security handler's write side: the file encryption key itself (revision 6), the O/U validation and key salts (revision 6), every string/stream's per-value initialisation vector (Algorithm 1 and 1.A), and the "arbitrary" trailing bytes the legacy /U value and revision-6 /Perms block both carry. `globalThis.crypto.getRandomValues` is the one CSPRNG surface this package's platform-neutral build can reach synchronously in both Node (a global since Node 19, well inside this package's >=20 engines requirement) and every browser/worker target -- `crypto.subtle` exists in both too but is asynchronous, and `node:crypto` would break the browser bundle exactly as it would for md5.ts/rc4.ts/aes.ts/sha2.ts.

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}
