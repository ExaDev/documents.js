import type { ExactRational } from "document-schema.js";

// Exact rational arithmetic over document-schema.js's ExactRational (numerator/denominator as canonical decimal-integer strings -- see that package's src/math.ts). This module exists for one job: unit-conversion arithmetic (MathUnit.factorToSi/offsetToSi combined with a 'qty' node's own value) done end to end in BigInt, so a chain of registry conversions never compounds floating-point rounding the way repeated `Number` multiplication would. evaluate.ts is the only caller: it resolves a 'qty' leaf's exact value and its unit's exact factor/offset entirely as Rational, and calls rationalToNumber (below) exactly once, at the point the resolved SI-coherent magnitude enters this package's own Quantity as a plain JS number. Every arithmetic step upstream of that single call is bit-exact; nothing downstream of it claims to be -- see quantity.ts's header comment for why the boundary is drawn there and not further out.
export interface Rational {
  readonly n: bigint; // numerator, carries the sign
  readonly d: bigint; // denominator, always > 0
}

function bigintOfCanonicalDigits(digits: string): bigint {
  return BigInt(digits);
}

export function toRational(value: ExactRational): Rational {
  return {
    n: bigintOfCanonicalDigits(value.numerator),
    d: bigintOfCanonicalDigits(value.denominator),
  };
}

// Only ever called from reduce() below with (num, den) where den is already sign-normalised to be strictly positive (reduce's own `sign` calculation guarantees d * sign > 0 whenever d !== 0, which reduce has already checked by the time it calls gcd) -- so b is never negative here, and this is a plain non-negative-b Euclidean gcd, not a general-purpose one. a can still be negative (num carries the numerator's sign), so it alone needs the absolute-value step.
function gcd(a: bigint, b: bigint): bigint {
  // Stryker disable next-line EqualityOperator: BigInt has no negative zero (-0n === 0n), so at a === 0n both `<` and `<=` take a branch that evaluates to the same value (0n via -a, or 0n via a) -- the operators are behaviourally identical at every input, not just the ones exercised by a test.
  let x = a < 0n ? -a : a;
  let y = b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x;
}

// Reduces to lowest terms and canonicalises to document-schema.js's own spelling (ExactRationalSchema in that package's src/math.ts): '0'/'1' for zero, otherwise the sign carried on the numerator and a strictly positive denominator with no leading zeros -- which a reduced BigInt's decimal .toString() already produces. There is no n === 0n fast path: gcd(0n, den) is den itself (standard Euclidean identity), so the general path below already reduces 0/den to 0/1 on its own, for either sign of den, without a special case.
function reduce(n: bigint, d: bigint): Rational {
  if (d === 0n) {
    throw new RangeError("rational.ts: denominator must not be zero");
  }
  // Stryker disable next-line EqualityOperator: d === 0n has already thrown above, so d < 0n and d <= 0n are never distinguishable here -- both take the same branch for every reachable d.
  const sign = d < 0n ? -1n : 1n;
  // Stryker disable next-line ArithmeticOperator: sign is always exactly 1n or -1n, and BigInt division by either value is bit-identical to multiplication by it (n / 1n === n / 1n === n * 1n, and n / -1n === -n === n * -1n) -- `*` and `/` are indistinguishable here for every reachable sign value.
  const num = n * sign;
  // Stryker disable next-line ArithmeticOperator: same reasoning as the line above -- sign is always exactly +-1n.
  const den = d * sign;
  const g = gcd(num, den);
  return { n: num / g, d: den / g };
}

export function toExactRational(value: Rational): ExactRational {
  const reduced = reduce(value.n, value.d);
  return { numerator: reduced.n.toString(), denominator: reduced.d.toString() };
}

export function addRational(a: Rational, b: Rational): Rational {
  return reduce(a.n * b.d + b.n * a.d, a.d * b.d);
}

export function subtractRational(a: Rational, b: Rational): Rational {
  return reduce(a.n * b.d - b.n * a.d, a.d * b.d);
}

export function multiplyRational(a: Rational, b: Rational): Rational {
  return reduce(a.n * b.n, a.d * b.d);
}

export function divideRational(a: Rational, b: Rational): Rational {
  if (b.n === 0n) {
    throw new RangeError("rational.ts: division by zero");
  }
  return reduce(a.n * b.d, a.d * b.n);
}

// The one controlled float boundary this module exposes. Number(bigint) loses precision above 2^53 exactly like any other float conversion, but here it happens once, on an already-exact result, rather than being compounded across a chain of conversions performed in floating point from the start.
export function rationalToNumber(value: Rational): number {
  return Number(value.n) / Number(value.d);
}
