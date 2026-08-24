// Shared leading-bytes magic check for the format-detection modules: true when bytes begins with magic byte-for-byte. Deliberately not exported from the barrel -- it is an internal helper of the detectors, not package surface.
export function startsWithMagic(
  bytes: Uint8Array,
  magic: readonly number[],
): boolean {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
}
