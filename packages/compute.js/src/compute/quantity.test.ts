import { describe, expect, it } from 'vitest';
import { IncompatibleDimensionsError, DivisionByZeroError, NumericDomainError } from './errors';
import {
  absQuantity,
  addQuantities,
  cosQuantity,
  divideQuantities,
  multiplyQuantities,
  negateQuantity,
  powQuantity,
  quantity,
  QuantitySchema,
  sinQuantity,
  sqrtQuantity,
  subtractQuantities,
  tanQuantity,
} from './quantity';

describe('Quantity schema', () => {
  it('validates a magnitude plus dimension vector', () => {
    expect(QuantitySchema.safeParse(quantity(5, { length: 1 })).success).toBe(true);
    expect(QuantitySchema.safeParse({ kind: 'quantity', magnitude: 'five', dimension: {} }).success).toBe(false);
  });
});

describe('addQuantities / subtractQuantities', () => {
  it('adds and subtracts quantities of equal dimension', () => {
    const a = quantity(2, { length: 1 });
    const b = quantity(3, { length: 1 });
    expect(addQuantities(a, b)).toEqual(quantity(5, { length: 1 }));
    expect(subtractQuantities(b, a)).toEqual(quantity(1, { length: 1 }));
  });

  it('throws IncompatibleDimensionsError when dimensions differ -- never a silently wrong number', () => {
    const metres = quantity(2, { length: 1 });
    const seconds = quantity(3, { time: 1 });
    expect(() => addQuantities(metres, seconds)).toThrow(IncompatibleDimensionsError);
    expect(() => subtractQuantities(metres, seconds)).toThrow(IncompatibleDimensionsError);

    let caught: unknown;
    try {
      addQuantities(metres, seconds);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(IncompatibleDimensionsError);
    expect((caught as IncompatibleDimensionsError).operation).toBe('math:add');
  });
});

describe('multiplyQuantities / divideQuantities', () => {
  it('combines dimension vectors by adding/subtracting exponents', () => {
    const mass = quantity(2, { mass: 1 });
    const acceleration = quantity(3, { length: 1, time: -2 });
    // F = m * a
    expect(multiplyQuantities(mass, acceleration)).toEqual(quantity(6, { mass: 1, length: 1, time: -2 }));

    const distance = quantity(10, { length: 1 });
    const time = quantity(2, { time: 1 });
    // speed = distance / time
    expect(divideQuantities(distance, time)).toEqual(quantity(5, { length: 1, time: -1 }));
  });

  it('throws DivisionByZeroError on division by a zero magnitude', () => {
    expect(() => divideQuantities(quantity(5, {}), quantity(0, {}))).toThrow(DivisionByZeroError);
  });
});

describe('negateQuantity / absQuantity', () => {
  it('flips sign / takes magnitude without touching dimension', () => {
    expect(negateQuantity(quantity(4, { length: 1 }))).toEqual(quantity(-4, { length: 1 }));
    expect(absQuantity(quantity(-4, { length: 1 }))).toEqual(quantity(4, { length: 1 }));
  });
});

describe('powQuantity', () => {
  it('raises a dimensionless base to any real power', () => {
    expect(powQuantity(quantity(2, {}), quantity(3, {}))).toEqual(quantity(8, {}));
  });

  it('raises a dimensioned base to an integer power, scaling every exponent', () => {
    expect(powQuantity(quantity(2, { length: 1 }), quantity(3, {}))).toEqual(quantity(8, { length: 3 }));
  });

  it('rejects a dimensioned base raised to a non-integer power', () => {
    expect(() => powQuantity(quantity(4, { length: 1 }), quantity(0.5, {}))).toThrow(IncompatibleDimensionsError);
  });

  it('rejects a dimensioned exponent', () => {
    expect(() => powQuantity(quantity(2, {}), quantity(2, { length: 1 }))).toThrow(IncompatibleDimensionsError);
  });
});

describe('sqrtQuantity', () => {
  it('halves every exponent when they are all even', () => {
    expect(sqrtQuantity(quantity(4, { length: 2 }))).toEqual(quantity(2, { length: 1 }));
  });

  it('rejects a dimension with an odd exponent', () => {
    expect(() => sqrtQuantity(quantity(4, { length: 1 }))).toThrow(IncompatibleDimensionsError);
  });

  it('rejects a negative magnitude', () => {
    expect(() => sqrtQuantity(quantity(-1, {}))).toThrow(NumericDomainError);
  });
});

describe('trigonometric quantities', () => {
  it('operate on a dimensionless (radian) argument and return dimensionless results', () => {
    expect(cosQuantity(quantity(0, {})).magnitude).toBeCloseTo(1, 12);
    expect(sinQuantity(quantity(0, {})).magnitude).toBeCloseTo(0, 12);
    expect(tanQuantity(quantity(0, {})).magnitude).toBeCloseTo(0, 12);
    expect(cosQuantity(quantity(0, {})).dimension).toEqual({});
  });

  it('reject a dimensioned argument', () => {
    expect(() => cosQuantity(quantity(1, { length: 1 }))).toThrow(IncompatibleDimensionsError);
  });
});
