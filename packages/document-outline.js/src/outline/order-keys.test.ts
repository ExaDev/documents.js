import { describe, expect, it } from 'vitest';
import { OrderKeyBudgetExhaustedError, orderKeyAfter, orderKeyBefore, orderKeyBetween, orderKeyForIndex, renumberedOrderKeys } from './order-keys';

// Unit-level coverage of the #660 fractional order-key primitive, independent of graph.test.ts's own single integration-style property test: every branch of orderKeyBetween's digit walk (a direct single-step midpoint, a step that needs one extra digit of precision because its neighbours are adjacent, repeated bisection into an already-narrow interval until the width cap refuses, and the different-length/implicit-zero-pad case), the two minting functions' own guarantees, and the unbounded-end pair -- front-insert below a drifted minimum, append above a drifted maximum, each op's exhaustion handing off to a renumberedOrderKeys rebalance.
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

  it('bisects repeatedly into the same shrinking interval until the width cap refuses with the named rebalance signal, rather than silently duplicating a key', () => {
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
    }).toThrowError(OrderKeyBudgetExhaustedError);
  });

  it('refuses when low does not sort strictly before high', () => {
    expect(() => orderKeyBetween('5', '5')).toThrowError(/low must sort strictly before high/);
    expect(() => orderKeyBetween('6', '5')).toThrowError(/low must sort strictly before high/);
  });
});

describe('orderKeyBefore', () => {
  it('mints a key strictly below a drifted front key, with room left between the mint and its upper neighbour', () => {
    // A front key of the shape repeated front inserts produce: no longer the index-minted '00000000', but a bisected/drifted low neighbour.
    const low = '00001eo';
    const minted = orderKeyBefore(low);
    expect(minted < low).toBe(true);
    expect(() => orderKeyBetween(minted, low)).not.toThrow(); // the mint is not jammed against its upper neighbour -- a further between-insert still fits
  });

  it('has no key before the all-zero floor and says so with the named error', () => {
    expect(() => orderKeyBefore('00000000')).toThrowError(OrderKeyBudgetExhaustedError);
    expect(() => orderKeyBefore('0')).toThrowError(OrderKeyBudgetExhaustedError);
  });

  it('walks toward the floor across repeated front inserts, then hands off to a renumberedOrderKeys rebalance', () => {
    let front = '0000zz'; // a roomy drifted front key, so the halving walk is visible before the floor
    const minted: string[] = [];
    for (;;) {
      try {
        front = orderKeyBefore(front);
      } catch (error) {
        // The exhaustion -> rebalance round trip: the floor refusal is the signal to re-mint the whole sibling list, and the fresh list is healthy again.
        expect(error).toBeInstanceOf(OrderKeyBudgetExhaustedError);
        break;
      }
      minted.push(front);
      if (minted.length > 1) expect(front < minted[minted.length - 2]!).toBe(true); // each front insert walks strictly down
    }
    expect(minted.length).toBeGreaterThan(1);
    const rebalanced = renumberedOrderKeys(4);
    for (let i = 1; i < rebalanced.length; i += 1) expect(rebalanced[i - 1]! < rebalanced[i]!).toBe(true);
    expect(() => orderKeyBetween(rebalanced[0]!, rebalanced[1]!)).not.toThrow();
    expect(orderKeyAfter(rebalanced[rebalanced.length - 1]!) > rebalanced[rebalanced.length - 1]!).toBe(true);
  });
});

describe('orderKeyAfter', () => {
  it('mints a key strictly above a drifted max key, with room left between it and the old max', () => {
    const high = '00001eo';
    const minted = orderKeyAfter(high);
    expect(minted > high).toBe(true);
    expect(() => orderKeyBetween(high, minted)).not.toThrow(); // a further between-insert still fits below the mint
  });

  it('grows monotonically without collision from the floor key until the width cap refuses', () => {
    const minted = new Set<string>();
    let key = orderKeyForIndex(0);
    for (let iterations = 0; ; iterations += 1) {
      expect(iterations).toBeLessThan(1000); // a bound only -- the halving walk converges in the low hundreds
      let next: string;
      try {
        next = orderKeyAfter(key);
      } catch (error) {
        expect(error).toBeInstanceOf(OrderKeyBudgetExhaustedError);
        expect(minted.size).toBeGreaterThan(0);
        return;
      }
      expect(next > key).toBe(true);
      expect(minted.has(next)).toBe(false); // no append ever re-mints a key the walk already produced
      minted.add(next);
      key = next;
    }
  });
});

describe('orderKeyBefore / orderKeyAfter at the ends of a minted list', () => {
  it('places each end mint at its exact splice position, comparing correctly against both adjacent keys', () => {
    // A drifted list -- the floor key gone to earlier front inserts, a between()-mint wedged into the first interval -- which is the shape the end ops exist for. The position invariant holds because the argument is the list's minimum/maximum: the truncated mint shares the argument's prefix, so every other key compares the same way at the stepped digit.
    const keys = [...renumberedOrderKeys(4).slice(1)];
    keys.splice(1, 0, orderKeyBetween(keys[0]!, keys[1]!));
    keys.sort();

    const front = orderKeyBefore(keys[0]!);
    const withFront = [front, ...keys].sort();
    expect(withFront.indexOf(front)).toBe(0);
    for (const key of keys) expect(front < key).toBe(true);

    const end = orderKeyAfter(keys[keys.length - 1]!);
    const withEnd = [...keys, end].sort();
    expect(withEnd.indexOf(end)).toBe(withEnd.length - 1);
    for (const key of keys) expect(end > key).toBe(true);
  });
});
