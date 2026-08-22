import { describe, expect, it } from 'vitest';
import { FormulaBindingsSchema } from './bindings';
import { interval } from './interval';
import { quantity } from './quantity';

describe('FormulaBindingsSchema', () => {
  it('accepts a record of symbol ids to Quantity or Interval values', () => {
    const bindings = {
      m: quantity(2, { mass: 1 }),
      phi: interval(0.87, 1, {}),
    };
    expect(FormulaBindingsSchema.safeParse(bindings).success).toBe(true);
  });

  it('rejects a value that is neither a Quantity nor an Interval', () => {
    expect(FormulaBindingsSchema.safeParse({ m: { kind: 'nonsense', magnitude: 1 } }).success).toBe(false);
  });
});
