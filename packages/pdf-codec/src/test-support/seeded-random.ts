// A seeded pseudo-random source (mulberry32), so a generated test case is the same on every run and a failure names a reproducible seed.
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Bytes drawn uniformly from the whole 0-255 range.
export function randomBytes(
  random: () => number,
  length: number,
): Uint8Array<ArrayBuffer> {
  return Uint8Array.from({ length }, () => Math.floor(random() * 256));
}
