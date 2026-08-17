// Exact-rational arithmetic over the schema's canonical decimal-integer strings, shared by the lowering (decimal literals -> lowest-terms rationals) and the coherence lint (normalising stored rationals for comparison). BigInt throughout: Number loses integer exactness above 2^53 and exactness is the entire point of the string-encoded rational the schema defines.

function gcd(a: bigint, b: bigint): bigint {
  let x = a;
  let y = b;
  while (y !== 0n) {
    const next = x % y;
    x = y;
    y = next;
  }
  // gcd(0, 0) is defined as 1 here so 0/0-shaped degenerates reduce to 0/1 rather than dividing by zero -- the schema's patterns keep 0's denominator at '1', and this keeps the arithmetic total on the same convention.
  return x === 0n ? 1n : x;
}

// A decimal literal (digits with at most one point) as a lowest-terms rational: '3.14' -> 157/50, '42' -> 42/1. Undefined for a malformed literal (two points, empty digits), which the lowering degrades visibly rather than repair.
export function decimalToRational(literal: string): { numerator: string; denominator: string } | undefined {
  const point = literal.indexOf('.');
  const digits = point === -1 ? literal : literal.slice(0, point) + literal.slice(point + 1);
  if (!/^\d+$/.test(digits) || literal.includes('.', point + 1)) {
    return undefined;
  }
  const denominatorPower = point === -1 ? 0 : literal.length - point - 1;
  const numerator = BigInt(digits);
  const denominator = 10n ** BigInt(denominatorPower);
  return reduceRational(numerator, denominator);
}

// Reduce numerator/denominator to lowest terms as the schema's canonical producer convention, so string equality between two reduced forms is value equality.
export function reduceRational(numerator: bigint, denominator: bigint): { numerator: string; denominator: string } {
  const divisor = gcd(numerator, denominator);
  return { numerator: String(numerator / divisor), denominator: String(denominator / divisor) };
}
