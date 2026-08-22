import { describe, expect, it } from 'vitest';
import { orderKeyBetween, orderKeyForIndex, renumberedOrderKeys } from './order-keys';

// Unit-level coverage of the #660 fractional order-key primitive, independent of graph.test.ts's own single integration-style property test: every branch of orderKeyBetween's digit walk (a direct single-step midpoint, a step that needs one extra digit of precision because its neighbours are adjacent, repeated bisection into an already-narrow interval until the width cap refuses, and the different-length/implicit-zero-pad case), plus the two minting functions' own guarantees.
describe('orderKeyForIndex', () => {
  it('produces strictly increasing, equal-width keys for a run of consecutive indices', () => {
    const keys = [0, 1, 2, 3, 10, 100].map(orderKeyForIndex);
    for (let i = 1; i < keys.length; i += 1) {
      expect(keys[i - 1]!.length).toBe(keys[i]!.length);
      expect(keys[i - 1]! < keys[i]!).toBe(true);
    }
  });

  it('is deterministic and zero-indexed at "00000000"', () => {
    expect(orderKeyForIndex(0)).toBe('00000000');
    expect(orderKeyForIndex(0)).toBe(orderKeyForIndex(0));
  });
});

describe('renumberedOrderKeys', () => {
  it('equals the index-minted key list for several counts, including the empty and singleton cases', () => {
    for (const count of [0, 1, 3, 7]) {
      expect(renumberedOrderKeys(count)).toEqual(Array.from({ length: count }, (_, index) => orderKeyForIndex(index)));
    }
  });
});

describe('orderKeyBetween', () => {
  it('mints a key strictly between two far-apart neighbours in a single step', () => {
    const low = orderKeyForIndex(0);
    const high = orderKeyForIndex(1);
    const mid = orderKeyBetween(low, high);
    expect(low < mid && mid < high).toBe(true);
  });

  it('extends precision by one digit when the two neighbours are truly adjacent', () => {
    // Two keys that differ only in their final digit, with nothing between them at that width: the walk must grow a 9th digit to find room.
    const low = '00000000';
    const high = '00000001';
    const mid = orderKeyBetween(low, high);
    expect(low < mid && mid < high).toBe(true);
    expect(mid.length).toBeGreaterThan(low.length);
  });

  it('treats a shorter key as implicitly right-padded with zero digits', () => {
    const low = '0000000';
    const high = '00000001';
    const mid = orderKeyBetween(low, high);
    expect(low < mid && mid < high).toBe(true);
  });

  it('bisects repeatedly into the same shrinking interval until the width cap refuses, rather than silently duplicating a key', () => {
    const low = orderKeyForIndex(0);
    let high = orderKeyForIndex(1);
    let iterations = 0;
    expect(() => {
      for (;;) {
        const mid = orderKeyBetween(low, high);
        expect(low < mid && mid < high).toBe(true);
        high = mid;
        iterations += 1;
        if (iterations > 1000) throw new Error('orderKeyBetween never refused -- unbounded growth');
      }
    }).toThrowError(/no room left between these keys; rebalance with renumberedOrderKeys/);
  });

  it('refuses when low does not sort strictly before high', () => {
    expect(() => orderKeyBetween('5', '5')).toThrowError(/low must sort strictly before high/);
    expect(() => orderKeyBetween('6', '5')).toThrowError(/low must sort strictly before high/);
  });
});
