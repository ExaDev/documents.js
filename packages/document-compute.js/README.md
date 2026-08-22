# document-compute.js

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/documents.js/tree/main/packages/document-compute.js) [![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/document-compute.js) [![npm version](https://img.shields.io/npm/v/document-compute.js)](https://www.npmjs.com/package/document-compute.js) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/documents.js/ci.yml?branch=main)](https://github.com/ExaDev/documents.js/actions)

> A units-typed, tree-walking evaluator for `document-schema.js`'s `MathExpression` — `evaluate()` for point values and bounded intervals over the same interpreter, `solveFor()` for numeric root-finding (bisection and Newton's method) on one unknown. Exact-rational arithmetic for unit-conversion factors, so a chain of registry conversions never accumulates floating-point drift. The compute package for the [documents.js family](https://github.com/ExaDev). Worker-isomorphic: the same code runs under Node and inside a Cloudflare Workers isolate.

Created for [ExaDev/documents.js#573](https://github.com/ExaDev/documents.js/issues/573): a document's formula is stored as a `MathExpression` tree (`document-schema.js`'s `src/math.ts`, [ExaDev/document-schema.js#15](https://github.com/ExaDev/document-schema.js/issues/15)) — the semantic half of a `ContentFormula`, alongside the LaTeX a renderer serialises verbatim. Storing that tree buys nothing on its own; a document that states a formula and then reports its computed answer needs something that actually walks the tree and produces a number, unit-aware, without silently mixing dimensions that don't belong together. This package is that something: one interpreter, reused unchanged across three shapes of the same problem — a point value, a bounded interval, and (via root-finding) an unknown to solve for.

## Getting started

Requires Node.js `>=20` and pnpm `11.6.0`.

```sh
pnpm install
pnpm build          # tsdown -> dist/ (ESM + CJS + .d.ts)
pnpm typecheck      # tsc -p tsconfig.json && tsc -p tsconfig.node.json (dual tsconfig)
pnpm lint           # eslint . --fix --cache --max-warnings 0
pnpm test           # vitest run
pnpm test:watch     # vitest
pnpm test:workers   # vitest run --config vitest.workers.config.ts, inside a real Cloudflare Workers (workerd) isolate
```

To run a single test file, pass its path to vitest directly, e.g. `pnpm exec vitest run src/compute/evaluate.test.ts`.

## What it provides

| Module | Exports |
|---|---|
| `compute/rational` | `Rational`, `toRational`, `toExactRational`, `addRational`, `subtractRational`, `multiplyRational`, `divideRational`, `rationalToNumber` |
| `compute/dimensions` | `dimensionExponent`, `dimensionsEqual`, `isDimensionless`, `multiplyDimensions`, `divideDimensions`, `scaleDimension`, `dimensionToString` |
| `compute/quantity` | `quantity`, `addQuantities`, `subtractQuantities`, `multiplyQuantities`, `divideQuantities`, `negateQuantity`, `absQuantity`, `powQuantity`, `sqrtQuantity`, `sinQuantity`, `cosQuantity`, `tanQuantity` |
| `compute/interval` | `interval`, `pointInterval`, `addIntervals`, `subtractIntervals`, `multiplyIntervals`, `divideIntervals`, `negateInterval`, `absInterval` |
| `compute/evaluate` | `evaluate`, `EvaluationResult`, `isInterval` |
| `compute/solve` | `solveFor`, `SolveMethod`, `SolveForOptions` |
| `compute/errors` | `IncompatibleDimensionsError`, `UnboundSymbolError`, `UnknownUnitError`, `DivisionByZeroError`, `UnsupportedExpressionError`, `NumericDomainError`, `NonConvergentSolveError` |

Every module in the table is re-exported from the package root, so its exports import from `'document-compute.js'` directly.

The value types this evaluator consumes and produces — `Quantity`, `Interval`, `EvaluationValue`, `FormulaBindings`, and their Zod schemas — are not defined here: they are typed contracts in `document-schema.js` itself (`src/math.ts`, beside `MathExpression`), so evaluation inputs are schema-validated shapes like everything else in that package. Import them from `'document-schema.js'` the same way this package does:

```ts
import { evaluate } from 'document-compute.js';
import type { FormulaBindings, MathExpression } from 'document-schema.js';

// F = m * a
const force: MathExpression = {
  kind: 'app',
  operator: 'math:multiply',
  args: [{ kind: 'sym', id: 'm' }, { kind: 'sym', id: 'a' }],
};

const bindings: FormulaBindings = {
  m: { kind: 'quantity', magnitude: 2, dimension: { mass: 1 } },
  a: { kind: 'quantity', magnitude: 3, dimension: { length: 1, time: -2 } },
};

const result = evaluate(force, bindings);
// { kind: 'quantity', magnitude: 6, dimension: { mass: 1, length: 1, time: -2 } }
```

`evaluate` never returns a failure inside its result: a successful call returns a plain `Quantity | Interval` (see below on why the return type is not literally `Quantity | Interval | error`), and every real failure throws one of `compute/errors`' own classes — the same idiom `document-schema.js`'s `schema-io.ts` and `archive-codec`'s `CompoundFileFormatError`/`ArchiveWalkLimitError` already use: a named, catchable `Error` subclass, never a `{ ok, error }` wrapper folded into the return type.

## Units as the type system

Every `Quantity` this evaluator produces carries a `dimension` — an SI exponent vector reusing `document-schema.js`'s own `DimensionVector` (`{ length: 1, time: -1 }` for speed, `{}` for dimensionless) — alongside a plain `magnitude`. Adding or subtracting two quantities whose dimensions don't match is not a number this package will produce: `addQuantities`/`subtractQuantities` (and the identical rule inside `evaluate` for `math:add`/`math:subtract`) throw `IncompatibleDimensionsError` rather than returning a value that happens to be wrong. Multiplication and division are always dimensionally defined — they combine dimension vectors by adding or subtracting exponents (`compute/dimensions.ts`'s `multiplyDimensions`/`divideDimensions`) — so there is nothing to reject there, only a resulting dimension to compute. `powQuantity`/`sqrtQuantity` extend the same rule to exponents: a dimensionless base tolerates any real exponent, a dimensioned one only an integer power whose scaled exponents stay integers (`DimensionVectorSchema` requires integers, so `sqrt` of `length^1` has no answer and throws — `IncompatibleDimensionsError` again, not a fractional dimension nobody asked for).

A `MathExpression`'s `'qty'` leaf carries an exact value plus a unit-registry id (`document-schema.js`'s `MathQty`/`MathUnit`, resolved against the `SymbolTable` passed as `evaluate`'s third argument); `evaluateQty` (`compute/evaluate.ts`) resolves that id, then computes `si_value = value * factorToSi + offsetToSi` — **entirely in exact BigInt rational arithmetic** (`compute/rational.ts`), converting to a plain JS `number` exactly once, at the moment the resolved SI-coherent magnitude enters the evaluator as a `Quantity`. That is the one deliberate exactness boundary in this package: a chain of unit-registry conversions (feet to metres, an affine temperature scale, a per-unit-normalised power-system quantity) never compounds floating-point rounding the way repeated `Number` multiplication would, because every step upstream of that single conversion is bit-exact BigInt arithmetic, reduced to lowest terms at every operation. Downstream of that boundary — ordinary `+`/`-`/`*`/`/` between already-resolved `Quantity` magnitudes, `sin`/`cos`/`sqrt`, a `solveFor` root — is plain floating point, because those results are not exact in general (there is no exact rational `sin(1)`), and holding them to bit-exactness would be false precision, not a stronger guarantee. `QuantitySchema`'s own field comment on `magnitude` states this trade-off; it is a judgement call this package makes deliberately, not an oversight.

## Interval arithmetic, over the same evaluator

The issue's own example is a compliance region: `0.87 <= cos(phi) <= 1`. Rather than adding a second evaluator for "a formula, but with ranges," `FormulaBindings` lets any symbol be bound to an `Interval` (`{ kind: 'interval', min, max, dimension }`) instead of a point `Quantity`, and `evaluate`'s `'app'` dispatch promotes a plain `Quantity` operand to a degenerate point interval (`pointInterval`) the moment either side of a binary operator is an `Interval` — the same tree walk, the same operator ids, just running over ranges instead of points once it notices one. `addIntervals`/`subtractIntervals` combine endpoints directly; `multiplyIntervals`/`divideIntervals` implement the standard rule that a product's or quotient's extremes are always attained at one of the four corner combinations of the two intervals' endpoints (`min*min, min*max, max*min, max*max`, or the equivalent via the reciprocal for division) — which is what actually resolves the textbook sign-case table (positive×positive, negative×negative, straddling×straddling, and every mixed case) into one formula that is correct regardless of which side of zero either interval sits on; `interval.test.ts` exercises each sign combination directly rather than trusting the closed form on faith. Division by an interval that touches or straddles zero has no defined result (it would pass through ±Infinity) and throws `DivisionByZeroError` instead of letting `Infinity`/`NaN` flow silently into the rest of a computation. Only the four arithmetic operators plus negate/abs have interval rules in this pass — `pow`/`sqrt`/the trig functions are `Quantity`-only and throw `UnsupportedExpressionError` on an `Interval` operand, since a correct general interval range for a non-monotonic or sign-dependent function needs more analysis than this pass's scope covers (see below).

## Numeric solve-for

`solveFor(expression, targetValue, unknownSymbol, bindings, options?, context?)` finds the magnitude for `unknownSymbol` that makes `expression` evaluate to `targetValue`, by root-finding over the same `evaluate` — never by rearranging the expression algebraically. It implements both algorithms the issue asks for and lets `options.method` pick between them (`'bisection'`, the default, or `'newton'`):

- **Bisection** needs `options.bracket: [low, high]` whose residuals have opposite signs (the intermediate-value theorem is its entire correctness argument), halves the bracket every iteration, and cannot diverge — the safe default.
- **Newton's method** needs `options.initialGuess` and estimates the derivative by central difference, `(f(x+h) - f(x-h)) / (2h)` (`options.derivativeStep`, default `1e-6`) — chosen over a one-sided forward/backward difference because its truncation error is `O(h²)` rather than `O(h)`. No symbolic derivative is available without a symbolic layer this pass deliberately does not build (see Out of scope), so a numeric one is the whole story here.

Both throw `NonConvergentSolveError` rather than returning a number they cannot vouch for: bisection when its bracket doesn't straddle a root or the iteration budget (`options.maxIterations`, default 100) runs out before the residual drops under `options.tolerance` (default `1e-9`); Newton when the numeric derivative vanishes or diverges, or the same budget/tolerance is exhausted. `options.unknownDimension` sets the `DimensionVector` the unknown is bound under at each trial point (default dimensionless) so a physically dimensioned unknown (a length, a mass) solves correctly against a formula that checks dimensions along the way.

```ts
import { solveFor } from 'document-compute.js';
import type { MathExpression } from 'document-schema.js';

// x^2 = 4, solve for x
const xSquared: MathExpression = {
  kind: 'app',
  operator: 'math:pow',
  args: [{ kind: 'sym', id: 'x' }, { kind: 'num', numerator: '2', denominator: '1' }],
};

solveFor(xSquared, 4, 'x', {}, { bracket: [0, 3] }); // 2, via bisection
solveFor(xSquared, 4, 'x', {}, { method: 'newton', initialGuess: 3 }); // 2, via Newton
```

## Deviations from the issue

Two things #573 asks for are not here in full. One was closed at adoption: `Quantity` and `FormulaBindings` (with `Interval` and `EvaluationValue`) are typed contracts in `document-schema.js`'s `src/math.ts`, beside `MathExpression` itself, exactly as the issue proposes — evaluation inputs are validated schemas like everything else in that package, and this package imports them from there the same way it imports `MathExpression`, `DimensionVector`, and `ExactRational`, rather than carrying package-local definitions.

The one that remains: **the worked-example test harness** the issue describes as its differentiator — measuring the fraction of a real document corpus's formulae whose evaluation reproduces the document's own stated answer. That harness needs real document corpora with stated formulae and answers, which this package has no access to build against; what ships here instead is thorough unit-level coverage of `evaluate`, the unit/dimension model, interval arithmetic, and `solveFor` in isolation (`src/compute/*.test.ts`). It is tracked as a follow-up to this package, not silently dropped.

## Out of scope

Quoting the issue's own scope line directly: **this is deliberately not a CAS in the Mathematica sense — units-typed evaluation and numeric solving are the 90% of "compute the result of a formula from a document" and are buildable natively now.** Concretely, this pass does not attempt, and this package carries no code toward:

- **Symbolic algebra** — exact rearrangement of an expression emitted back out as LaTeX, simplification, integration. `solveFor` finds a root numerically; it never isolates the unknown algebraically.
- **A SymPy sidecar or any other symbolic-engine adapter.** The issue names this as the eventual home for symbolic work, behind an evaluator interface this package does not define or stub.
- **The worked-example test harness** — see Deviations from the issue above.
- **Matrix-valued evaluation.** `MathExpression`'s `'matrix'` node exists in the grammar `document-schema.js` defines, but this evaluator only ever produces scalar `Quantity`/`Interval` values; a `'matrix'` node throws `UnsupportedExpressionError` rather than being silently misevaluated.
- **A general interval rule for `pow`/`sqrt`/the trigonometric operators.** These are implemented for `Quantity` only; applied to an `Interval` operand they throw `UnsupportedExpressionError` rather than guessing at a range a non-monotonic or sign-dependent function would need real analysis to get right.

## Conventions

- Worker-isomorphic (see the [family-wide convention](https://github.com/ExaDev/documents.js/blob/main/README.md#conventions)): runtime `src/` must not import `node:*`, a bare Node builtin, or use the `Buffer` global — enforced by a `no-restricted-imports`/`no-restricted-globals` ESLint rule and exercised in CI by running a test suite inside an actual `workerd` isolate (`pnpm test:workers`). Exact-rational arithmetic is plain `BigInt`, never `node:crypto` or any other Node-only primitive, precisely so this holds.
- Only `src/index.ts` may be named `index.*` — a custom ESLint rule (`local/no-non-barrel-index`) rejects any other module using an `index` basename, since that would be a hidden entry point the `exports` map in `package.json` doesn't advertise.
- Failure is always a thrown, named `Error` subclass (`compute/errors.ts`), never a `{ ok, error }` result wrapper — matching `document-schema.js`'s `schema-io.ts` and `archive-codec`'s own error classes rather than inventing a second convention for this package alone.
- Not wired into the conversion pipeline. This package is a standalone evaluator: it is not a dependency of `documents.js`, `document-cli`, `document-mcp`, or `documents`, and adding it as one is a separate, deliberate decision for whichever of those surfaces first needs a document's formula actually computed.
- Release, CI, and commit-message conventions are all workspace-wide, not package-local — see the [monorepo root README](../../README.md#releases) for the mechanism (topological per-package `semantic-release` via `@exadev/semantic-release-workspace`, OIDC trusted npm publishing, and the post-release republish/attestation jobs).

## Install

```sh
pnpm add document-compute.js
# or
npm install document-compute.js
```

## License

MIT
