import { describe, expect, it } from "vitest";
import {
  BINARY_DIGEST_FACTORS,
  CANONICALISATION_FACTORS,
  MemoryBudget,
  PROJECTION_FACTORS,
} from "./memory-budget";

const UNIT = { transientBytesPerByte: 1, retainedBytesPerByte: 1 };

describe("MemoryBudget", () => {
  it("admits a part whose transient and retained cost fit the allowance and refuses one that does not", () => {
    const budget = new MemoryBudget(100);
    expect(budget.admit(50, UNIT)).toBe(true);
    expect(new MemoryBudget(99).admit(50, UNIT)).toBe(false);
  });

  it("counts what earlier parts retained against later ones", () => {
    const budget = new MemoryBudget(100);
    expect(budget.admit(40, UNIT)).toBe(true);
    // 40 retained already, plus 40 retained and 40 transient for this part.
    expect(budget.admit(40, UNIT)).toBe(false);
  });

  it("reserves nothing for a part it refuses", () => {
    const budget = new MemoryBudget(100);
    expect(budget.admit(40, UNIT)).toBe(true);
    expect(budget.admit(40, UNIT)).toBe(false);
    expect(budget.admit(20, UNIT)).toBe(true);
  });

  it("does not hold a transient cost once the part is done", () => {
    const budget = new MemoryBudget(100);
    const transientOnly = { transientBytesPerByte: 2, retainedBytesPerByte: 0 };
    expect(budget.admit(50, transientOnly)).toBe(true);
    expect(budget.admit(50, transientOnly)).toBe(true);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses the allowance %s",
    (allowance) => {
      expect(() => new MemoryBudget(allowance)).toThrow(RangeError);
    },
  );
});

describe("the measured factors", () => {
  it("are whole, positive costs, with only projections retaining anything", () => {
    for (const factors of [
      CANONICALISATION_FACTORS,
      PROJECTION_FACTORS,
      BINARY_DIGEST_FACTORS,
    ]) {
      expect(Number.isInteger(factors.transientBytesPerByte)).toBe(true);
      expect(factors.transientBytesPerByte).toBeGreaterThan(0);
    }
    expect(PROJECTION_FACTORS.retainedBytesPerByte).toBeGreaterThan(0);
    expect(CANONICALISATION_FACTORS.retainedBytesPerByte).toBe(0);
    expect(BINARY_DIGEST_FACTORS.retainedBytesPerByte).toBe(0);
  });
});
