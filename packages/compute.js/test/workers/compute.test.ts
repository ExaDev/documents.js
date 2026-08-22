import { describe, expect, it } from 'vitest';
import type { MathExpression, SymbolTable } from 'document-schema.js';
import {
  DivisionByZeroError,
  IncompatibleDimensionsError,
  evaluate,
  interval,
  isInterval,
  quantity,
  solveFor,
} from '../../src';

// Proves compute.js's surface executes inside a Cloudflare Workers isolate (workerd, via @cloudflare/vitest-pool-workers) with no Node-only APIs. Every path here -- unit-aware evaluate() over num/qty/sym/app nodes, interval arithmetic reusing the same evaluator, and solveFor's bisection/Newton root-finding -- is deliberately Node-free (unit-conversion exactness comes from plain BigInt arithmetic in rational.ts, never node:crypto or any other Node-only primitive); if any touched code path in this module graph or its zod / document-schema.js dependencies reached for a Node-only API, the workerd isolate would throw rather than these passing. This is the runtime complement to the static ESLint Worker-isomorphism guard.
describe('compute.js under the Cloudflare Workers runtime', () => {
  const context: SymbolTable = {
    symbols: [],
    units: [
      { id: 'imperial:foot', symbol: 'ft', dimension: { length: 1 }, factorToSi: { numerator: '381', denominator: '1250' } },
      { id: 'si:second', symbol: 's', dimension: { time: 1 }, factorToSi: { numerator: '1', denominator: '1' } },
    ],
  };

  it('evaluates a units-typed formula inside the isolate', () => {
    const distance: MathExpression = { kind: 'qty', value: { numerator: '10', denominator: '1' }, unit: 'imperial:foot' };
    const time: MathExpression = { kind: 'qty', value: { numerator: '2', denominator: '1' }, unit: 'si:second' };
    const speed: MathExpression = { kind: 'app', operator: 'math:divide', args: [distance, time] };

    const result = evaluate(speed, {}, context);
    expect(isInterval(result)).toBe(false);
    if (isInterval(result)) throw new Error('expected a Quantity');
    expect(result.magnitude).toBeCloseTo(1.524, 12);
    expect(result.dimension).toEqual({ length: 1, time: -1 });
  });

  it('rejects incompatible-dimension addition inside the isolate', () => {
    const a = quantity(1, { length: 1 });
    const b = quantity(1, { time: 1 });
    const mismatched: MathExpression = {
      kind: 'app',
      operator: 'math:add',
      args: [{ kind: 'sym', id: 'a' }, { kind: 'sym', id: 'b' }],
    };
    expect(() => evaluate(mismatched, { a, b })).toThrow(IncompatibleDimensionsError);
  });

  it('runs interval arithmetic over the same evaluator inside the isolate', () => {
    const cosPhi = interval(0.87, 1, {});
    const result = evaluate(
      { kind: 'app', operator: 'math:multiply', args: [{ kind: 'sym', id: 'cosPhi' }, { kind: 'num', numerator: '2', denominator: '1' }] },
      { cosPhi },
    );
    expect(isInterval(result)).toBe(true);
  });

  it('rejects division by zero inside the isolate', () => {
    const divideByZero: MathExpression = {
      kind: 'app',
      operator: 'math:divide',
      args: [{ kind: 'num', numerator: '1', denominator: '1' }, { kind: 'num', numerator: '0', denominator: '1' }],
    };
    expect(() => evaluate(divideByZero, {})).toThrow(DivisionByZeroError);
  });

  it('solves for one unknown via bisection inside the isolate', () => {
    const xSquared: MathExpression = { kind: 'app', operator: 'math:pow', args: [{ kind: 'sym', id: 'x' }, { kind: 'num', numerator: '2', denominator: '1' }] };
    const root = solveFor(xSquared, 4, 'x', {}, { bracket: [0, 3] });
    expect(root).toBeCloseTo(2, 6);
  });

  it('solves for one unknown via Newton\'s method inside the isolate', () => {
    const xSquared: MathExpression = { kind: 'app', operator: 'math:pow', args: [{ kind: 'sym', id: 'x' }, { kind: 'num', numerator: '2', denominator: '1' }] };
    const root = solveFor(xSquared, 4, 'x', {}, { method: 'newton', initialGuess: 3 });
    expect(root).toBeCloseTo(2, 6);
  });
});
