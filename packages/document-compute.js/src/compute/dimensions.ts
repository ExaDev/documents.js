import {
  SI_BASE_DIMENSIONS,
  type DimensionVector,
  type SiBaseDimension,
} from "document-schema.js";

// Dimension-vector arithmetic over document-schema.js's own DimensionVector (exponents over the seven SI base quantities, an omitted key meaning exponent zero -- see that package's src/math.ts). This module deliberately does not redefine the vector shape: it only adds the operations a units-typed evaluator needs over it (equality, multiply/divide by exponent add/subtract, scale for pow/sqrt) that document-schema.js has no reason to own, since it never evaluates anything.

export function dimensionExponent(
  dimension: DimensionVector,
  base: SiBaseDimension,
): number {
  return dimension[base] ?? 0;
}

export function dimensionsEqual(
  a: DimensionVector,
  b: DimensionVector,
): boolean {
  return SI_BASE_DIMENSIONS.every(
    (base) => dimensionExponent(a, base) === dimensionExponent(b, base),
  );
}

export function isDimensionless(dimension: DimensionVector): boolean {
  return SI_BASE_DIMENSIONS.every(
    (base) => dimensionExponent(dimension, base) === 0,
  );
}

function combine(
  a: DimensionVector,
  b: DimensionVector,
  op: (x: number, y: number) => number,
): DimensionVector {
  const result: DimensionVector = {};
  for (const base of SI_BASE_DIMENSIONS) {
    const value = op(dimensionExponent(a, base), dimensionExponent(b, base));
    if (value !== 0) {
      result[base] = value;
    }
  }
  return result;
}

// Multiplying two quantities multiplies their dimensions by adding exponents (length^1 * length^1 = length^2; length^1 * time^-1 stays length^1 time^-1).
export function multiplyDimensions(
  a: DimensionVector,
  b: DimensionVector,
): DimensionVector {
  return combine(a, b, (x, y) => x + y);
}

// Dividing two quantities subtracts the divisor's exponents from the dividend's (length^1 / time^1 = length^1 time^-1, the dimension of speed).
export function divideDimensions(
  a: DimensionVector,
  b: DimensionVector,
): DimensionVector {
  return combine(a, b, (x, y) => x - y);
}

// Scales every exponent by k, used for pow (k = the exponent, always an integer once evaluate.ts has checked it) and sqrt (k = 1/2). DimensionVectorSchema requires integer exponents, so a scale that would land on a non-integer (an odd exponent under sqrt, a non-integer pow exponent applied to a dimensioned base) has no representable result -- callers must reject that case themselves before calling this with a fractional k, and this throws rather than silently rounding so a caller that forgets to check fails loudly instead of producing a wrong dimension.
export function scaleDimension(
  dimension: DimensionVector,
  k: number,
): DimensionVector {
  const result: DimensionVector = {};
  for (const base of SI_BASE_DIMENSIONS) {
    const exponent = dimensionExponent(dimension, base);
    if (exponent === 0) continue;
    const scaled = exponent * k;
    if (!Number.isInteger(scaled)) {
      throw new RangeError(
        `dimensions.ts: scaling '${base}' by ${k} does not land on an integer exponent`,
      );
    }
    result[base] = scaled;
  }
  return result;
}

export function dimensionToString(dimension: DimensionVector): string {
  const parts = SI_BASE_DIMENSIONS.filter(
    (base) => dimensionExponent(dimension, base) !== 0,
  ).map((base) => `${base}^${dimensionExponent(dimension, base)}`);
  return parts.length === 0 ? "dimensionless" : parts.join("·");
}
