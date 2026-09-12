// Shared leading-bytes magic check for the format-detection modules: true when bytes begins with magic byte-for-byte. Deliberately not exported from the barrel -- it is an internal helper of the detectors, not package surface. No separate length pre-check: indexing a Uint8Array past its own end reads back `undefined`, which can never equal one of `magic`'s numeric entries, so a `bytes` shorter than `magic` already falls out of the loop as false on its own.
export function startsWithMagic(
  bytes: Uint8Array,
  magic: readonly number[],
): boolean {
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
}
