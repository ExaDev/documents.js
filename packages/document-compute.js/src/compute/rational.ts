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

// The greatest common divisor of |a| and |b|, carrying b's OWN sign rather than always coming back positive -- which is what lets reduce() below canonicalise in a single division step, with no separate sign-normalisation pass. Requires b !== 0n (reduce, its only caller, has already rejected that case by the time it calls here).
//
// The seed is the Euclidean (never-negative-for-positive-b) residue `((a % b) + b) % b` rather than a plain `a % b`, and that single expression is what makes both properties hold at once. JS's `%` takes the sign of its DIVIDEND, so `a % b` alone would carry a's sign into the chain and leave the result's sign depending on which step happened to terminate the loop; seeding with the residue instead puts the first remainder strictly between 0 and b (inclusive of 0, exclusive of b) on b's own side of zero, after which every subsequent `x % y` inherits x's sign and the whole chain -- and therefore the returned final x -- stays on that side. That removes the explicit absolute-value step a plain Euclidean gcd needs for a possibly-negative a, and simultaneously removes reduce()'s need to compare d against zero at all: dividing both parts by a gcd that already carries the denominator's sign lands the denominator positive by construction.
function gcd(a: bigint, b: bigint): bigint {
  let x = b;
  let y = ((a % b) + b) % b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x;
}

// Reduces to lowest terms and canonicalises to document-schema.js's own spelling (ExactRationalSchema in that package's src/math.ts): '0'/'1' for zero, otherwise the sign carried on the numerator and a strictly positive denominator with no leading zeros -- which a reduced BigInt's decimal .toString() already produces. Both canonicalisation steps fall out of the one division: gcd() above returns d's own sign, so n / g and d / g reduce the fraction and migrate a negative denominator's sign onto the numerator in the same operation. There is no n === 0n fast path either: gcd(0n, d) is d itself (standard Euclidean identity), so the general path already reduces 0/d to 0/1 for either sign of d.
function reduce(n: bigint, d: bigint): Rational {
  if (d === 0n) {
    throw new RangeError("rational.ts: denominator must not be zero");
  }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
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
