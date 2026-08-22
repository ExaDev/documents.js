import { describe, expect, it } from 'vitest';
import { IncompatibleDimensionsError, DivisionByZeroError } from './errors';
import { absInterval, addIntervals, divideIntervals, interval, IntervalSchema, multiplyIntervals, negateInterval, pointInterval, subtractIntervals } from './interval';

describe('interval constructor and schema', () => {
  it('accepts min <= max and rejects min > max', () => {
    expect(() => interval(1, 2)).not.toThrow();
    expect(() => interval(2, 1)).toThrow(RangeError);
    expect(IntervalSchema.safeParse({ kind: 'interval', min: 1, max: 2, dimension: {} }).success).toBe(true);
    expect(IntervalSchema.safeParse({ kind: 'interval', min: 2, max: 1, dimension: {} }).success).toBe(false);
  });

  it('promotes a point value to a degenerate interval', () => {
    expect(pointInterval(3, { length: 1 })).toEqual(interval(3, 3, { length: 1 }));
  });
});

describe('addIntervals / subtractIntervals', () => {
  it('adds bounds elementwise, representing a compliance region like 0.87 <= cos(phi) <= 1', () => {
    const cosPhi = interval(0.87, 1, {});
    const offset = interval(0.1, 0.1, {}); // a point interval mixed with a real one
    expect(addIntervals(cosPhi, offset)).toEqual(interval(0.97, 1.1, {}));
  });

  it('subtracts by combining the widest possible spread of endpoints', () => {
    expect(subtractIntervals(interval(1, 5), interval(1, 2))).toEqual(interval(-1, 4, {}));
  });

  it('throws IncompatibleDimensionsError on a dimension mismatch', () => {
    expect(() => addIntervals(interval(1, 2, { length: 1 }), interval(1, 2, { time: 1 }))).toThrow(IncompatibleDimensionsError);
  });
});

describe('multiplyIntervals -- sign-case coverage', () => {
  it('multiplies two positive intervals (corners at both maxima)', () => {
    expect(multiplyIntervals(interval(2, 3), interval(4, 5))).toEqual(interval(8, 15, {}));
  });

  it('multiplies two negative intervals (corners at both minima, in magnitude)', () => {
    expect(multiplyIntervals(interval(-4, -2), interval(-3, -1))).toEqual(interval(2, 12, {}));
  });

  it('multiplies a straddling interval by a straddling interval -- the sign-flip case', () => {
    // x in [-2, 3], y in [-1, 4]: extremes are x=-2,y=4 (-8) and x=3,y=4 (12).
    expect(multiplyIntervals(interval(-2, 3), interval(-1, 4))).toEqual(interval(-8, 12, {}));
  });

  it('multiplies a straddling interval by a strictly positive interval', () => {
    expect(multiplyIntervals(interval(-2, 3), interval(2, 4))).toEqual(interval(-8, 12, {}));
  });

  it('combines dimensions by adding exponents, same as multiplyQuantities', () => {
    const distance = interval(1, 2, { length: 1 });
    const inverseTime = interval(2, 3, { time: -1 });
    expect(multiplyIntervals(distance, inverseTime).dimension).toEqual({ length: 1, time: -1 });
  });
});

describe('divideIntervals', () => {
  it('divides two positive intervals', () => {
    // x in [4,6], y in [2,3]: extremes are 4/3 and 6/2=3.
    const result = divideIntervals(interval(4, 6), interval(2, 3));
    expect(result.min).toBeCloseTo(4 / 3, 12);
    expect(result.max).toBeCloseTo(3, 12);
  });

  it('divides by a strictly negative interval (the reciprocal sign-flip case)', () => {
    // x in [4,6], y in [-3,-2]: x/y ranges from 6/-2=-3 (max magnitude denominator, smallest divisor -> most negative... ) to 4/-3.
    const result = divideIntervals(interval(4, 6), interval(-3, -2));
    expect(result.min).toBeCloseTo(-3, 12);
    expect(result.max).toBeCloseTo(-4 / 3, 12);
  });

  it('throws DivisionByZeroError when the divisor interval contains zero', () => {
    expect(() => divideIntervals(interval(1, 2), interval(-1, 1))).toThrow(DivisionByZeroError);
    expect(() => divideIntervals(interval(1, 2), interval(0, 1))).toThrow(DivisionByZeroError);
  });
});

describe('negateInterval / absInterval', () => {
  it('negates by flipping and swapping the bounds', () => {
    expect(negateInterval(interval(1, 3))).toEqual(interval(-3, -1, {}));
  });

  it('takes abs correctly whether the interval is positive, negative, or straddling', () => {
    expect(absInterval(interval(1, 3))).toEqual(interval(1, 3, {}));
    expect(absInterval(interval(-5, -2))).toEqual(interval(2, 5, {}));
    expect(absInterval(interval(-3, 2))).toEqual(interval(0, 3, {}));
  });
});
