import { z } from 'zod';
import { DimensionVectorSchema, type DimensionVector } from 'document-schema.js';
import { dimensionsEqual, divideDimensions, multiplyDimensions } from './dimensions';
import { DivisionByZeroError, IncompatibleDimensionsError } from './errors';

// Interval is compute.js's bounded-value counterpart to Quantity, over the identical dimension model, for exactly the case the source issue names: a formula whose stated fact is a compliance region rather than a point, e.g. `0.87 <= cos(phi) <= 1`. The evaluator (evaluate.ts) is the same tree-walker for both -- a binding can hold a Quantity or an Interval, arithmetic dispatches to the interval rules below the moment either operand is one, and a bare Quantity mixed into interval arithmetic promotes to a degenerate point interval via pointInterval() -- so this is "the same evaluator, run over intervals rather than points," not a second parallel implementation.
//
// min/max are both inclusive; the refinement below is the schema-level half of the invariant, min() (the constructor) is the code-path half for values assembled outside z.parse.
export const IntervalSchema = z
  .object({
    kind: z.literal('interval'),
    min: z.number(),
    max: z.number(),
    dimension: DimensionVectorSchema,
  })
  .refine((value) => value.min <= value.max, { message: 'interval min must not exceed max' });
export type Interval = z.infer<typeof IntervalSchema>;

export function interval(min: number, max: number, dimension: DimensionVector = {}): Interval {
  if (min > max) {
    throw new RangeError(`interval: min (${min}) must not exceed max (${max})`);
  }
  return { kind: 'interval', min, max, dimension };
}

// Lifts a plain point value into a degenerate (min === max) interval -- how evaluate.ts lets a Quantity operand mix into interval arithmetic.
export function pointInterval(magnitude: number, dimension: DimensionVector = {}): Interval {
  return { kind: 'interval', min: magnitude, max: magnitude, dimension };
}

export function addIntervals(a: Interval, b: Interval): Interval {
  if (!dimensionsEqual(a.dimension, b.dimension)) {
    throw new IncompatibleDimensionsError('math:add', a.dimension, b.dimension);
  }
  return interval(a.min + b.min, a.max + b.max, a.dimension);
}

// a - b's extremes are the smallest possible left-hand value minus the largest possible right-hand value (the new minimum) and the largest left-hand value minus the smallest right-hand value (the new maximum) -- equivalently a + (-b), with -b's bounds negated and swapped.
export function subtractIntervals(a: Interval, b: Interval): Interval {
  if (!dimensionsEqual(a.dimension, b.dimension)) {
    throw new IncompatibleDimensionsError('math:subtract', a.dimension, b.dimension);
  }
  return interval(a.min - b.max, a.max - b.min, a.dimension);
}

// Standard interval multiplication: for any two reals x in [a.min, a.max] and y in [b.min, b.max], x*y is jointly monotonic in each orthant of sign, so its extremes over the whole rectangle are always attained at one of the four corners (a.min*b.min, a.min*b.max, a.max*b.min, a.max*b.max) -- true regardless of which interval is positive, negative, or straddles zero. Taking the overall min/max of those four corner products is therefore the general rule (the textbook sign-case table -- positive*positive, negative*negative, straddling*straddling, and the mixed cases -- is exactly this formula specialised per sign combination; see interval.test.ts for a case exercising each).
export function multiplyIntervals(a: Interval, b: Interval): Interval {
  const corners = [a.min * b.min, a.min * b.max, a.max * b.min, a.max * b.max];
  return interval(Math.min(...corners), Math.max(...corners), multiplyDimensions(a.dimension, b.dimension));
}

// Division is defined only when the divisor interval does not touch zero -- otherwise 1/[b.min, b.max] would pass through +-Infinity, which this package treats as a real failure (DivisionByZeroError) rather than letting Infinity/NaN flow silently into the rest of a computation. When it is defined, a / b is a * (1/b): the reciprocal of an interval that is entirely positive or entirely negative is [1/b.max, 1/b.min] in both cases (1/x is monotonically decreasing away from zero on either side, so the corner that was the largest magnitude denominator gives the reciprocal's smallest value), and the four-corner rule above then combines it with a correctly for every sign combination.
export function divideIntervals(a: Interval, b: Interval): Interval {
  if (b.min <= 0 && b.max >= 0) {
    throw new DivisionByZeroError('math:divide', `divisor interval [${b.min}, ${b.max}] contains zero`);
  }
  const reciprocalMin = 1 / b.max;
  const reciprocalMax = 1 / b.min;
  const corners = [a.min * reciprocalMin, a.min * reciprocalMax, a.max * reciprocalMin, a.max * reciprocalMax];
  return interval(Math.min(...corners), Math.max(...corners), divideDimensions(a.dimension, b.dimension));
}

export function negateInterval(a: Interval): Interval {
  return interval(-a.max, -a.min, a.dimension);
}

export function absInterval(a: Interval): Interval {
  if (a.min >= 0) return a;
  if (a.max <= 0) return negateInterval(a);
  return interval(0, Math.max(-a.min, a.max), a.dimension);
}
