import { describe, expect, it } from 'vitest';
import {
  DivisionByZeroError,
  IncompatibleDimensionsError,
  NonConvergentSolveError,
  NumericDomainError,
  UnboundSymbolError,
  UnknownUnitError,
  UnsupportedExpressionError,
} from './errors';

// Every error class is a real, named Error subclass a caller can catch and discriminate by `instanceof` or by `.name` -- exercised end to end by quantity.test.ts/interval.test.ts/evaluate.test.ts/solve.test.ts at the call sites that actually throw them; this file pins each constructor's own contract (name, structured fields, message content) directly.
describe('compute.js error classes', () => {
  it('IncompatibleDimensionsError carries the operation and both dimension vectors', () => {
    const error = new IncompatibleDimensionsError('math:add', { length: 1 }, { time: 1 }, 'extra detail');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('IncompatibleDimensionsError');
    expect(error.operation).toBe('math:add');
    expect(error.left).toEqual({ length: 1 });
    expect(error.right).toEqual({ time: 1 });
    expect(error.message).toContain('math:add');
    expect(error.message).toContain('extra detail');
  });

  it('UnboundSymbolError names the missing symbol', () => {
    const error = new UnboundSymbolError('phi');
    expect(error.name).toBe('UnboundSymbolError');
    expect(error.symbol).toBe('phi');
    expect(error.message).toContain('phi');
  });

  it('UnknownUnitError names the missing unit id', () => {
    const error = new UnknownUnitError('imperial:furlong');
    expect(error.name).toBe('UnknownUnitError');
    expect(error.unit).toBe('imperial:furlong');
  });

  it('DivisionByZeroError carries the operation', () => {
    const error = new DivisionByZeroError('math:divide', 'divisor is zero');
    expect(error.name).toBe('DivisionByZeroError');
    expect(error.operation).toBe('math:divide');
    expect(error.message).toContain('divisor is zero');
  });

  it('UnsupportedExpressionError carries its context', () => {
    const error = new UnsupportedExpressionError('evaluate', 'matrix nodes are out of scope');
    expect(error.name).toBe('UnsupportedExpressionError');
    expect(error.context).toBe('evaluate');
    expect(error.message).toBe('evaluate: matrix nodes are out of scope.');
  });

  it('NumericDomainError carries the operation', () => {
    const error = new NumericDomainError('math:sqrt', 'magnitude must be non-negative');
    expect(error.name).toBe('NumericDomainError');
    expect(error.operation).toBe('math:sqrt');
  });

  it('NonConvergentSolveError carries the method and iteration count', () => {
    const error = new NonConvergentSolveError('newton', 42, 'derivative vanished');
    expect(error.name).toBe('NonConvergentSolveError');
    expect(error.method).toBe('newton');
    expect(error.iterations).toBe(42);
    expect(error.message).toContain('newton');
    expect(error.message).toContain('42');
  });
});
