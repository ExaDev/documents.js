import { describe, expect, it } from "vitest";
import {
  OrderKeyBudgetExhaustedError,
  orderKeyAfter,
  orderKeyBefore,
  orderKeyBetween,
  orderKeyForIndex,
  renumberedOrderKeys,
} from "./order-keys";

// Mirrors order-keys.ts's own private constants, so the boundary tests below stay tied to the algorithm's real parameters rather than restating a derived boundary as an independent literal.
const ORDER_KEY_WIDTH = 8;
const ORDER_KEY_GAP = 1000;
const ORDER_KEY_MAX_LENGTH = 16;
const BASE36_RADIX = 36;
const MAX_ENCODABLE_SCALED_VALUE = BASE36_RADIX ** ORDER_KEY_WIDTH - 1;
// The largest index whose scaled value (index * ORDER_KEY_GAP) still fits in ORDER_KEY_WIDTH base-36 digits.
const MAX_INDEX_FITTING_WIDTH = Math.floor(
  MAX_ENCODABLE_SCALED_VALUE / ORDER_KEY_GAP,
);
// A generous safety bound for a loop this test expects to converge in the low hundreds; not itself part of the algorithm, only a guard against an infinite loop if it regresses.
const ITERATION_SAFETY_BOUND = 1000;

// Unit-level coverage of the #660 fractional order-key primitive, independent of graph.test.ts's own single integration-style property test: every branch of orderKeyBetween's digit walk (a direct single-step midpoint, a step that needs one extra digit of precision because its neighbours are adjacent, repeated bisection into an already-narrow interval until the width cap refuses, and the different-length/implicit-zero-pad case), the two minting functions' own guarantees, and the unbounded-end pair — front-insert below a drifted minimum, append above a drifted maximum, each op's exhaustion handing off to a renumberedOrderKeys rebalance.
describe("orderKeyForIndex", () => {
  it("produces strictly increasing, equal-width keys for a run of consecutive indices", () => {
    const thirdIndex = 3;
    const tenthIndex = 10;
    const hundredthIndex = 100;
    const keys = [0, 1, 2, thirdIndex, tenthIndex, hundredthIndex].map(
      orderKeyForIndex,
    );
    for (let i = 1; i < keys.length; i += 1) {
      expect(keys[i - 1]!.length).toBe(keys[i]!.length);
      expect(keys[i - 1]! < keys[i]!).toBe(true);
    }
  });

  it('is deterministic and zero-indexed at "00000000"', () => {
    expect(orderKeyForIndex(0)).toBe("00000000");
    expect(orderKeyForIndex(0)).toBe(orderKeyForIndex(0));
  });

  // The exact boundary between the widest index that still fits in ORDER_KEY_WIDTH base-36 digits and the smallest that does not — computed directly (BASE36_RADIX**ORDER_KEY_WIDTH - 1 is the largest ORDER_KEY_WIDTH-digit base-36 value, and ORDER_KEY_GAP scales every index before encoding).
  it("accepts the largest index whose scaled value still fits in 8 base-36 digits", () => {
    expect(() => orderKeyForIndex(MAX_INDEX_FITTING_WIDTH)).not.toThrow();
  });

  it("refuses the smallest index whose scaled value needs a 9th base-36 digit, naming both in the message", () => {
    const firstOverflowingIndex = MAX_INDEX_FITTING_WIDTH + 1;
    expect(() => orderKeyForIndex(firstOverflowingIndex)).toThrow(
      new RegExp(
        `orderKeyForIndex: index ${String(firstOverflowingIndex)} does not fit in ${String(ORDER_KEY_WIDTH)} base-36 digits`,
      ),
    );
  });
});

describe("renumberedOrderKeys", () => {
  it("equals the index-minted key list for several counts, including the empty and singleton cases", () => {
    const threeSiblings = 3;
    const sevenSiblings = 7;
    for (const count of [0, 1, threeSiblings, sevenSiblings]) {
      expect(renumberedOrderKeys(count)).toEqual(
        Array.from({ length: count }, (_, index) => orderKeyForIndex(index)),
      );
    }
  });
});

describe("OrderKeyBudgetExhaustedError", () => {
  it("names itself OrderKeyBudgetExhaustedError", () => {
    expect(new OrderKeyBudgetExhaustedError("x").name).toBe(
      "OrderKeyBudgetExhaustedError",
    );
  });
});

describe("orderKeyBetween", () => {
  it("mints a key strictly between two far-apart neighbours in a single step", () => {
    const low = orderKeyForIndex(0);
    const high = orderKeyForIndex(1);
    const mid = orderKeyBetween(low, high);
    expect(low < mid && mid < high).toBe(true);
  });

  it("extends precision by one digit when the two neighbours are truly adjacent", () => {
    // Two keys that differ only in their final digit, with nothing between them at that width: the walk must grow a 9th digit to find room.
    const low = "00000000";
    const high = "00000001";
    const mid = orderKeyBetween(low, high);
    expect(low < mid && mid < high).toBe(true);
    expect(mid.length).toBeGreaterThan(low.length);
  });

  it("treats a shorter key as implicitly right-padded with zero digits", () => {
    const low = "0000000";
    const high = "00000001";
    const mid = orderKeyBetween(low, high);
    expect(low < mid && mid < high).toBe(true);
  });

  it("bisects repeatedly into the same shrinking interval until the width cap refuses with the named rebalance signal, rather than silently duplicating a key", () => {
    const low = orderKeyForIndex(0);
    let high = orderKeyForIndex(1);
    let iterations = 0;
    expect(() => {
      for (;;) {
        const mid = orderKeyBetween(low, high);
        expect(low < mid && mid < high).toBe(true);
        high = mid;
        iterations += 1;
        if (iterations > ITERATION_SAFETY_BOUND)
          throw new Error("orderKeyBetween never refused — unbounded growth");
      }
    }).toThrow(OrderKeyBudgetExhaustedError);
  });

  it("refuses when low does not sort strictly before high", () => {
    expect(() => orderKeyBetween("5", "5")).toThrow(
      /low must sort strictly before high/,
    );
    expect(() => orderKeyBetween("6", "5")).toThrow(
      /low must sort strictly before high/,
    );
  });

  it("refuses immediately once the shared prefix reaches the width cap, rather than growing one digit past it", () => {
    // low and high share their first ORDER_KEY_MAX_LENGTH - 1 digits, then differ by exactly one at the last position — the adjacent-digit case extends the prefix to exactly ORDER_KEY_MAX_LENGTH at that point, which must refuse right there rather than growing one digit further.
    const low = "0".repeat(ORDER_KEY_MAX_LENGTH);
    const high = "0".repeat(ORDER_KEY_MAX_LENGTH - 1) + "1";
    expect(() => orderKeyBetween(low, high)).toThrow(
      /no room left between these keys/,
    );
  });

  it("takes the large-gap branch at a gap of exactly two, not merely more than two", () => {
    expect(orderKeyBetween("0", "2")).toBe("1");
  });

  it("ignores high's own digits once adjacent-neighbour exhaustion kicks in, treating everything past it as unbounded", () => {
    // Both highs share the identical prefix through the digit that triggers exhaustion (a gap of exactly one at position 7); everything after that position must never be consulted, so the two calls must mint the identical key despite the two highs' wildly different tails.
    const low = "00000000";
    const highA = "0000000199999999";
    const highB = "0000000100000000";
    expect(orderKeyBetween(low, highA)).toBe(orderKeyBetween(low, highB));
  });
});

describe("orderKeyBefore", () => {
  it("mints a key strictly below a drifted front key, with room left between the mint and its upper neighbour", () => {
    // A front key of the shape repeated front inserts produce: no longer the index-minted '00000000', but a bisected/drifted low neighbour.
    const low = "00001eo";
    const minted = orderKeyBefore(low);
    expect(minted < low).toBe(true);
    expect(() => orderKeyBetween(minted, low)).not.toThrow(); // the mint is not jammed against its upper neighbour — a further between-insert still fits
  });

  it("returns at the first digit with room from the left, stepping it down by half its own value", () => {
    // digit 9 has half-its-own-value headroom of ceil(9/2)=5, distinct from both Math.min(1, 5)=1 and a doubled digit — this pins the exact minted value, not merely its ordering.
    expect(orderKeyBefore("9")).toBe("4");
  });

  it("has no key before the all-zero floor and says so with the named error", () => {
    expect(() => orderKeyBefore("00000000")).toThrow(
      OrderKeyBudgetExhaustedError,
    );
    expect(() => orderKeyBefore("00000000")).toThrow(
      /an all-zero key is the floor of the key space/,
    );
    expect(() => orderKeyBefore("0")).toThrow(OrderKeyBudgetExhaustedError);
  });

  it("refuses once accumulated leading zero digits reach the width cap, rather than growing one past it", () => {
    // ORDER_KEY_MAX_LENGTH leading zero digits (each contributing no room, digit === 0) fill the prefix before the trailing '1' is ever reached, which must refuse right there rather than reading one digit further.
    expect(() =>
      orderKeyBefore(`${"0".repeat(ORDER_KEY_MAX_LENGTH)}1`),
    ).toThrow(/no key sorts below this one within the width cap/);
  });

  it("walks toward the floor across repeated front inserts, then hands off to a renumberedOrderKeys rebalance", () => {
    let front = "0000zz"; // a roomy drifted front key, so the halving walk is visible before the floor
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
      if (minted.length > 1)
        expect(front < minted[minted.length - 2]!).toBe(true); // each front insert walks strictly down
    }
    expect(minted.length).toBeGreaterThan(1);
    const rebalancedSiblingCount = 4;
    const rebalanced = renumberedOrderKeys(rebalancedSiblingCount);
    for (let i = 1; i < rebalanced.length; i += 1)
      expect(rebalanced[i - 1]! < rebalanced[i]!).toBe(true);
    expect(() => orderKeyBetween(rebalanced[0]!, rebalanced[1]!)).not.toThrow();
    expect(
      orderKeyAfter(rebalanced[rebalanced.length - 1]!) >
        rebalanced[rebalanced.length - 1]!,
    ).toBe(true);
  });
});

describe("orderKeyAfter", () => {
  it("mints a key strictly above a drifted max key, with room left between it and the old max", () => {
    const high = "00001eo";
    const minted = orderKeyAfter(high);
    expect(minted > high).toBe(true);
    expect(() => orderKeyBetween(high, minted)).not.toThrow(); // a further between-insert still fits below the mint
  });

  it("returns at the first digit with room, stepping it up by half the remaining headroom — truncating there rather than walking the rest of the key", () => {
    // digit 0 has half-remaining-headroom of ceil(35/2)=18 ('i'), distinct from both Math.min(1, 18)=1 and a headroom computed from the wrong base — this pins the exact minted value (and its length), not merely its ordering.
    expect(orderKeyAfter("00001eo")).toBe("i");
  });

  it("returns the mid digit immediately for an empty high key", () => {
    expect(orderKeyAfter("")).toBe("i");
  });

  it("walks past a run of already-maximal 'z' digits by advancing forward, not backward", () => {
    expect(orderKeyAfter("zz")).toBe("zzi");
  });

  it("refuses once accumulated maximal digits reach the width cap, rather than growing one past it", () => {
    // ORDER_KEY_MAX_LENGTH 'z' digits (each contributing no room, digit === BASE - 1) fill the prefix before position ever reaches high.length, which must refuse right there rather than returning one digit longer.
    expect(() => orderKeyAfter("z".repeat(ORDER_KEY_MAX_LENGTH))).toThrow(
      OrderKeyBudgetExhaustedError,
    );
    expect(() => orderKeyAfter("z".repeat(ORDER_KEY_MAX_LENGTH))).toThrow(
      /no key sorts above this one within the width cap/,
    );
  });

  it("grows monotonically without collision from the floor key until the width cap refuses", () => {
    const minted = new Set<string>();
    let key = orderKeyForIndex(0);
    for (let iterations = 0; ; iterations += 1) {
      expect(iterations).toBeLessThan(ITERATION_SAFETY_BOUND); // a bound only — the halving walk converges in the low hundreds
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

describe("orderKeyBefore / orderKeyAfter at the ends of a minted list", () => {
  it("places each end mint at its exact splice position, comparing correctly against both adjacent keys", () => {
    // A drifted list — the floor key gone to earlier front inserts, a between()-mint wedged into the first interval — which is the shape the end ops exist for. The position invariant holds because the argument is the list's minimum/maximum: the truncated mint shares the argument's prefix, so every other key compares the same way at the stepped digit.
    const siblingCount = 4;
    const keys = [...renumberedOrderKeys(siblingCount).slice(1)];
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
