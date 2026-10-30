// A small, seeded generator (mulberry32), so generated draw ops are the same on every run and a failing case reproduces from its seed alone.
const MULBERRY_INCREMENT = 0x6d2b79f5;
const FIRST_SHIFT = 15;
const SECOND_SHIFT = 7;
const SECOND_MULTIPLIER_BITS = 61;
const THIRD_SHIFT = 14;
const UINT32_RANGE = 2 ** 32;

export function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + MULBERRY_INCREMENT) | 0;
    let mixed = Math.imul(state ^ (state >>> FIRST_SHIFT), 1 | state);
    mixed =
      (mixed +
        Math.imul(
          mixed ^ (mixed >>> SECOND_SHIFT),
          SECOND_MULTIPLIER_BITS | mixed,
        )) ^
      mixed;
    return ((mixed ^ (mixed >>> THIRD_SHIFT)) >>> 0) / UINT32_RANGE;
  };
}
