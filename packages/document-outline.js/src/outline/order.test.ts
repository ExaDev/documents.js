import { describe, expect, it } from 'vitest';
import { initialOrderKeys, keyBetween, OrderKeyBudgetExhaustedError, rebalanceOrderKeys, type OrderKey } from './order';

describe('keyBetween', () => {
  it('mints a first key with no neighbours at all', () => {
    const first = keyBetween(undefined, undefined);
    expect(typeof first).toBe('string');
    expect(first.length).toBeGreaterThan(0);
  });

  it('mints a key strictly after a given lower bound with no upper bound', () => {
    const a = keyBetween(undefined, undefined);
    const b = keyBetween(a, undefined);
    expect(a < b).toBe(true);
    const c = keyBetween(b, undefined);
    expect(b < c).toBe(true);
  });

  it('mints a key strictly before a given upper bound with no lower bound', () => {
    const a = keyBetween(undefined, undefined);
    const before = keyBetween(undefined, a);
    expect(before < a).toBe(true);
    const beforeThat = keyBetween(undefined, before);
    expect(beforeThat < before).toBe(true);
  });

  it('mints a key strictly between two given keys', () => {
    const lower = keyBetween(undefined, undefined);
    const upper = keyBetween(lower, undefined);
    const middle = keyBetween(lower, upper);
    expect(lower < middle).toBe(true);
    expect(middle < upper).toBe(true);
  });

  it('supports repeated bisection between the same two neighbours without exhausting immediately', () => {
    const lower = keyBetween(undefined, undefined);
    let upper = keyBetween(lower, undefined);
    for (let i = 0; i < 10; i++) {
      const middle = keyBetween(lower, upper);
      expect(lower < middle).toBe(true);
      expect(middle < upper).toBe(true);
      upper = middle; // keep bisecting the lower half, the adversarial repeated-same-spot case
    }
  });

  it('refuses a lower bound that does not sort strictly before the upper bound', () => {
    const a = keyBetween(undefined, undefined);
    const b = keyBetween(a, undefined);
    expect(() => keyBetween(b, a)).toThrowError(/must sort strictly before/);
    expect(() => keyBetween(a, a)).toThrowError(/must sort strictly before/);
  });

  it('treats "0" as an ordinary, legitimately minimal key rather than a value to avoid', () => {
    // Comparison here is plain string/prefix-rule, not a decimal-fraction reading -- so a key that happens to be (or end in) '0' is unremarkable, and before() can legitimately produce it as the smallest single-character key.
    const upper = keyBetween(undefined, undefined);
    let key = upper;
    let reachedZero = false;
    for (let i = 0; i < 30 && !reachedZero; i++) {
      key = keyBetween(undefined, key);
      if (key === '0') reachedZero = true;
    }
    expect(reachedZero).toBe(true);
    expect(key < upper).toBe(true);
  });
});

describe('initialOrderKeys', () => {
  it('returns an empty array for a non-positive count', () => {
    expect(initialOrderKeys(0)).toEqual([]);
    expect(initialOrderKeys(-1)).toEqual([]);
  });

  it('returns exactly one key for a single sibling', () => {
    expect(initialOrderKeys(1)).toHaveLength(1);
  });

  it('returns count strictly increasing keys for a range of counts', () => {
    for (const count of [2, 3, 5, 7, 10, 36, 37, 100]) {
      const keys = initialOrderKeys(count);
      expect(keys).toHaveLength(count);
      for (let i = 1; i < keys.length; i++) expect(keys[i - 1]! < keys[i]!).toBe(true);
    }
  });

  it('leaves room to insert before the first key and after the last key of a batch', () => {
    const keys = initialOrderKeys(5);
    const before = keyBetween(undefined, keys[0]);
    const after = keyBetween(keys.at(-1), undefined);
    expect(before < keys[0]!).toBe(true);
    expect(keys.at(-1)! < after).toBe(true);
  });

  it('leaves room to insert strictly between every adjacent pair of a batch', () => {
    const keys = initialOrderKeys(6);
    for (let i = 1; i < keys.length; i++) {
      const middle = keyBetween(keys[i - 1], keys[i]);
      expect(keys[i - 1]! < middle).toBe(true);
      expect(middle < keys[i]!).toBe(true);
    }
  });
});

describe('exhaustion and rebalancing', () => {
  it('throws OrderKeyBudgetExhaustedError under repeated same-spot insertion at the very front, and rebalancing restores order and headroom', () => {
    // The adversarial case the budget exists for: always inserting a new "first" sibling immediately before the current head, over and over. This particular pattern exhausts by driving the head all the way down to the alphabet's own minimum digit ('0'), a key with no headroom below it at all -- OrderKeyBudgetExhaustedError covers both that boundary case and the length-budget case below, because both mean the same thing to a caller: stop bisecting, rebalance instead.
    let keys: OrderKey[] = [keyBetween(undefined, undefined)];
    let exhausted = false;
    for (let i = 0; i < 500 && !exhausted; i++) {
      try {
        const inserted = keyBetween(undefined, keys[0]);
        expect(inserted < keys[0]!).toBe(true);
        keys = [inserted, ...keys];
      } catch (error) {
        expect(error).toBeInstanceOf(OrderKeyBudgetExhaustedError);
        exhausted = true;
      }
    }
    expect(exhausted).toBe(true); // proves exhaustion is reachable in bounded iterations, not merely theoretical
    expect(keys.length).toBeGreaterThan(1);

    const rebalanced = rebalanceOrderKeys(keys);
    expect(rebalanced).toHaveLength(keys.length);
    // Order preserved across the rebalance: rebalanced[i] still sorts before rebalanced[i + 1], matching the original list's own (index-preserved) relative order.
    for (let i = 1; i < rebalanced.length; i++) expect(rebalanced[i - 1]! < rebalanced[i]!).toBe(true);
    // Headroom restored: inserting before the new first key -- the exact operation that just got exhausted -- succeeds again immediately.
    expect(() => keyBetween(undefined, rebalanced[0])).not.toThrow();
    // Rebalancing actually produced fresh keys, not an echo of the exhausted ones.
    expect(rebalanced).not.toEqual(keys);
  });

  it('throws OrderKeyBudgetExhaustedError (the length-budget path, distinct from the boundary path above) under repeated same-spot insertion strictly between two fixed neighbours', () => {
    // Always inserting immediately after the same fixed lower bound, narrowing the upper bound to each new key in turn: this repeatedly lands in mid()'s "adjacent digits" branch, which extends the key by one character each time it recurses -- eventually exceeding ORDER_KEY_MAX_LENGTH rather than hitting either alphabet boundary.
    const lower = keyBetween(undefined, undefined);
    const outerUpper = keyBetween(lower, undefined);
    let upper: OrderKey = outerUpper;
    const inserted: OrderKey[] = [];
    let exhausted = false;
    for (let i = 0; i < 2000 && !exhausted; i++) {
      try {
        const next = keyBetween(lower, upper);
        expect(lower < next).toBe(true);
        expect(next < upper).toBe(true);
        inserted.push(next);
        upper = next;
      } catch (error) {
        expect(error).toBeInstanceOf(OrderKeyBudgetExhaustedError);
        exhausted = true;
      }
    }
    expect(exhausted).toBe(true);
    expect(inserted.length).toBeGreaterThan(1);

    const ordered = [lower, ...[...inserted].reverse(), outerUpper];
    const rebalanced = rebalanceOrderKeys(ordered);
    expect(rebalanced).toHaveLength(ordered.length);
    for (let i = 1; i < rebalanced.length; i++) expect(rebalanced[i - 1]! < rebalanced[i]!).toBe(true);
    expect(Math.max(...rebalanced.map((key) => key.length))).toBeLessThan(Math.max(...inserted.map((key) => key.length)));
  });
});
