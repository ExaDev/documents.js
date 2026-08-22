import { z } from 'zod';
import { DimensionVectorSchema, type DimensionVector } from 'document-schema.js';
import { dimensionsEqual, divideDimensions, isDimensionless, multiplyDimensions, scaleDimension } from './dimensions';
import { DivisionByZeroError, IncompatibleDimensionsError, NumericDomainError } from './errors';

// Quantity is compute.js's own schema, not document-schema.js's -- see this package's README ("Why Quantity and FormulaBindings live here, not in document-schema.js") for the coordination note (ExaDev/documents.js#573, ExaDev/document-schema.js#15). It is deliberately not the same shape as that package's MathQty: MathQty is a document-authored *expression-tree leaf* (an exact value plus a unit-registry id, meaningless until resolved against a SymbolTable), while Quantity is this evaluator's *runtime result* -- a magnitude already resolved into the SI-coherent base units for its dimension, so every arithmetic rule below can compare/combine two Quantities by their dimension vectors directly, with no registry lookup in the loop.
//
// magnitude is a plain JS number, not an ExactRational. That is a deliberate, judgement-based choice, not an oversight: sin/cos/sqrt results, and every solveFor root, have no exact rational representation in general, so holding every Quantity to bit-exactness would be false precision dressed up as rigour. Exactness is spent where it actually buys something instead -- unit-conversion factors, computed end to end in rational.ts's BigInt arithmetic and converted to a float exactly once, at the single boundary where a document-authored 'qty' leaf's value enters this evaluator (see evaluate.ts's evaluateQty). Ordinary arithmetic on a Quantity's magnitude from that point on is plain floating point, same as any other numeric evaluator -- see rational.ts's header comment for the conversion this boundary replaces.
export const QuantitySchema = z.object({
  kind: z.literal('quantity'),
  magnitude: z.number(),
  dimension: DimensionVectorSchema,
});
export type Quantity = z.infer<typeof QuantitySchema>;

export function quantity(magnitude: number, dimension: DimensionVector = {}): Quantity {
  return { kind: 'quantity', magnitude, dimension };
}

export function addQuantities(a: Quantity, b: Quantity): Quantity {
  if (!dimensionsEqual(a.dimension, b.dimension)) {
    throw new IncompatibleDimensionsError('math:add', a.dimension, b.dimension);
  }
  return quantity(a.magnitude + b.magnitude, a.dimension);
}

export function subtractQuantities(a: Quantity, b: Quantity): Quantity {
  if (!dimensionsEqual(a.dimension, b.dimension)) {
    throw new IncompatibleDimensionsError('math:subtract', a.dimension, b.dimension);
  }
  return quantity(a.magnitude - b.magnitude, a.dimension);
}

// Multiplication and division are always dimensionally defined -- unlike add/subtract, there is no compatibility check to fail, only the resulting dimension to compute (see dimensions.ts).
export function multiplyQuantities(a: Quantity, b: Quantity): Quantity {
  return quantity(a.magnitude * b.magnitude, multiplyDimensions(a.dimension, b.dimension));
}

export function divideQuantities(a: Quantity, b: Quantity): Quantity {
  if (b.magnitude === 0) {
    throw new DivisionByZeroError('math:divide', `divisor magnitude is exactly zero (dividend magnitude ${a.magnitude})`);
  }
  return quantity(a.magnitude / b.magnitude, divideDimensions(a.dimension, b.dimension));
}

export function negateQuantity(a: Quantity): Quantity {
  return quantity(-a.magnitude, a.dimension);
}

export function absQuantity(a: Quantity): Quantity {
  return quantity(Math.abs(a.magnitude), a.dimension);
}

// A dimensioned base can only be raised to an integer power (the result dimension is each exponent times the power, and DimensionVectorSchema requires integer exponents); a dimensionless base can be raised to any real power, since the result stays dimensionless regardless.
export function powQuantity(base: Quantity, exponent: Quantity): Quantity {
  if (!isDimensionless(exponent.dimension)) {
    throw new IncompatibleDimensionsError('math:pow', exponent.dimension, {}, 'the exponent must be dimensionless');
  }
  if (isDimensionless(base.dimension)) {
    return quantity(Math.pow(base.magnitude, exponent.magnitude), {});
  }
  if (!Number.isInteger(exponent.magnitude)) {
    throw new IncompatibleDimensionsError(
      'math:pow',
      base.dimension,
      {},
      'a dimensioned base can only be raised to an integer power',
    );
  }
  return quantity(Math.pow(base.magnitude, exponent.magnitude), scaleDimension(base.dimension, exponent.magnitude));
}

export function sqrtQuantity(a: Quantity): Quantity {
  if (a.magnitude < 0) {
    throw new NumericDomainError('math:sqrt', `magnitude must be non-negative, got ${a.magnitude}`);
  }
  let dimension: DimensionVector;
  try {
    dimension = scaleDimension(a.dimension, 0.5);
  } catch {
    throw new IncompatibleDimensionsError(
      'math:sqrt',
      a.dimension,
      {},
      'every exponent must be even for the dimension to have an exact square root',
    );
  }
  return quantity(Math.sqrt(a.magnitude), dimension);
}

function requireDimensionless(a: Quantity, operator: string): void {
  if (!isDimensionless(a.dimension)) {
    throw new IncompatibleDimensionsError(operator, a.dimension, {}, 'trigonometric functions take a dimensionless (radian) argument');
  }
}

export function sinQuantity(a: Quantity): Quantity {
  requireDimensionless(a, 'math:sin');
  return quantity(Math.sin(a.magnitude), {});
}

export function cosQuantity(a: Quantity): Quantity {
  requireDimensionless(a, 'math:cos');
  return quantity(Math.cos(a.magnitude), {});
}

export function tanQuantity(a: Quantity): Quantity {
  requireDimensionless(a, 'math:tan');
  return quantity(Math.tan(a.magnitude), {});
}
