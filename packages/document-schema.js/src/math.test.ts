import { describe, expect, it } from 'vitest';
import {
  DimensionVectorSchema,
  ExactRationalSchema,
  isMathExpression,
  MathExpressionSchema,
  MathMatrixSchema,
  MathNormalisationContextSchema,
  MathNumSchema,
  MathPresentationSchema,
  MathProvenanceSchema,
  MathQtySchema,
  MathSumSchema,
  MathSymbolEntrySchema,
  MathSymSchema,
  MathUncertaintySchema,
  MathUnitSchema,
  MathUnparsedSchema,
  type MathExpression,
  SymbolTableSchema,
  type SymbolTable,
} from './math';

describe('ExactRationalSchema', () => {
  it('accepts canonical integer-string halves, including the integer-as-over-one and exact-negative cases', () => {
    expect(ExactRationalSchema.safeParse({ numerator: '0', denominator: '1' }).success).toBe(true);
    expect(ExactRationalSchema.safeParse({ numerator: '-381', denominator: '1250' }).success).toBe(true);
    expect(ExactRationalSchema.safeParse({ numerator: '196133', denominator: '20000' }).success).toBe(true);
  });

  it('rejects every non-canonical spelling: float text, leading zeros, negative zero, and zero or negative denominators', () => {
    for (const numerator of ['1.5', '007', '-0', '1e3', '']) {
      expect(ExactRationalSchema.safeParse({ numerator, denominator: '2' }).success).toBe(false);
    }
    for (const denominator of ['0', '-2', '00', '2.5', '']) {
      expect(ExactRationalSchema.safeParse({ numerator: '1', denominator }).success).toBe(false);
    }
  });
});

describe('DimensionVectorSchema', () => {
  it('accepts a sparse vector over any subset of the SI bases, exponents negative included', () => {
    // Speed and force in their standard SI decompositions, plus the empty dimensionless vector.
    expect(DimensionVectorSchema.safeParse({ length: 1, time: -1 }).success).toBe(true);
    expect(DimensionVectorSchema.safeParse({ length: 1, mass: 1, time: -2 }).success).toBe(true);
    expect(DimensionVectorSchema.safeParse({}).success).toBe(true);
  });

  it('rejects dimensions outside the seven SI bases and non-integer exponents', () => {
    expect(DimensionVectorSchema.safeParse({ information: 1 }).success).toBe(false);
    expect(DimensionVectorSchema.safeParse({ length: 1.5 }).success).toBe(false);
    expect(DimensionVectorSchema.safeParse({ length: '1' }).success).toBe(false);
  });
});

describe('MathUnitSchema', () => {
  it('accepts a linear unit with its exact SI conversion (the foot is exactly 381/1250 m)', () => {
    expect(
      MathUnitSchema.safeParse({
        id: 'imperial:foot',
        symbol: 'ft',
        name: 'foot',
        dimension: { length: 1 },
        factorToSi: { numerator: '381', denominator: '1250' },
      }).success,
    ).toBe(true);
  });

  it('accepts an affine unit whose zero differs from SI (degree Celsius: factor 1, offset 5463/20 K)', () => {
    expect(
      MathUnitSchema.safeParse({
        id: 'si:degree-celsius',
        symbol: '°C',
        dimension: { thermodynamicTemperature: 1 },
        factorToSi: { numerator: '1', denominator: '1' },
        offsetToSi: { numerator: '5463', denominator: '20' },
      }).success,
    ).toBe(true);
  });

  it('rejects a unit with no dimension or no exact conversion factor', () => {
    expect(MathUnitSchema.safeParse({ id: 'si:metre', symbol: 'm', factorToSi: { numerator: '1', denominator: '1' } }).success).toBe(false);
    expect(MathUnitSchema.safeParse({ id: 'si:metre', symbol: 'm', dimension: { length: 1 } }).success).toBe(false);
  });
});

describe('SymbolTableSchema', () => {
  it('accepts a table with symbols, their unit registry, and a per-unit normalisation context', () => {
    const table: SymbolTable = {
      symbols: [
        {
          glyph: 'U',
          scope: 'document',
          id: 'symbols:voltage',
          quantityKind: 'si:voltage',
          preferredUnit: 'si:volt',
          definitionSource: 'prose:sections/2/paragraph-1',
        },
      ],
      units: [
        {
          id: 'si:volt',
          symbol: 'V',
          dimension: { length: 2, mass: 1, time: -3, electricCurrent: -1 },
          factorToSi: { numerator: '1', denominator: '1' },
        },
        {
          id: 'psu:pu-power',
          symbol: 'p.u.',
          dimension: {},
          factorToSi: { numerator: '1', denominator: '1' },
          context: 'psu:100mva-11kv',
        },
      ],
      contexts: [
        {
          id: 'psu:100mva-11kv',
          bases: [
            { unit: 'si:volt-ampere', value: { numerator: '100000000', denominator: '1' } },
            { unit: 'si:volt', value: { numerator: '11000', denominator: '1' } },
          ],
        },
      ],
    };
    const parsed = SymbolTableSchema.parse(table);
    expect(parsed.symbols[0]?.id).toBe('symbols:voltage');
    expect(parsed.contexts?.[0]?.bases).toHaveLength(2);
  });

  it('requires symbols and units outright, with contexts the only optional array', () => {
    expect(SymbolTableSchema.safeParse({ symbols: [], units: [] }).success).toBe(true);
    expect(SymbolTableSchema.safeParse({ symbols: [] }).success).toBe(false);
    expect(SymbolTableSchema.safeParse({ units: [] }).success).toBe(false);
  });

  it('rejects a symbol entry missing the (glyph, scope, id) key it is looked up by', () => {
    expect(MathSymbolEntrySchema.safeParse({ glyph: 'U', id: 'symbols:voltage' }).success).toBe(false);
    expect(MathSymbolEntrySchema.safeParse({ glyph: 'U', scope: 'document', id: 'symbols:voltage' }).success).toBe(true);
  });

  it('accepts a normalisation context with exact rational bases', () => {
    expect(
      MathNormalisationContextSchema.safeParse({
        id: 'psu:100mva-11kv',
        bases: [{ unit: 'si:volt', value: { numerator: '11000', denominator: '1' } }],
      }).success,
    ).toBe(true);
    expect(MathNormalisationContextSchema.safeParse({ id: 'psu:100mva-11kv', bases: [{ unit: 'si:volt' }] }).success).toBe(false);
  });
});

describe('MathPresentationSchema and MathProvenanceSchema', () => {
  it('carries the verbatim LaTeX as the presentation layer in full', () => {
    expect(MathPresentationSchema.parse({ latex: '\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}' }).latex).toBe(
      '\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}',
    );
  });

  it('requires the provenance source and edit trail, with the page reference optional', () => {
    expect(MathProvenanceSchema.safeParse({ source: 'odf:content.xml#Object1', editTrail: [] }).success).toBe(true);
    expect(
      MathProvenanceSchema.safeParse({ source: 'lowered:latex', pageRef: 'page 4', editTrail: ['value corrected against the ledger'] }).success,
    ).toBe(true);
    expect(MathProvenanceSchema.safeParse({ source: 'odf:content.xml#Object1' }).success).toBe(false);
  });
});

describe('MathUncertaintySchema', () => {
  it('accepts an exact magnitude with optional unit override and coverage factor', () => {
    expect(MathUncertaintySchema.safeParse({ magnitude: { numerator: '1', denominator: '4' } }).success).toBe(true);
    expect(
      MathUncertaintySchema.safeParse({
        magnitude: { numerator: '196', denominator: '100' },
        unit: 'si:percent',
        coverageFactor: 2,
      }).success,
    ).toBe(true);
  });

  it('rejects a non-positive coverage factor and a float-text magnitude', () => {
    expect(MathUncertaintySchema.safeParse({ magnitude: { numerator: '1', denominator: '4' }, coverageFactor: 0 }).success).toBe(false);
    expect(MathUncertaintySchema.safeParse({ magnitude: { numerator: '0.25', denominator: '1' } }).success).toBe(false);
  });
});

// Pythagoras as the shared deep example: c = sqrt(a^2 + b^2), every recursive kind exercised on the way down.
const pythagoras: MathExpression = {
  kind: 'app',
  operator: 'math:sqrt',
  args: [
    {
      kind: 'app',
      operator: 'math:add',
      args: [
        { kind: 'app', operator: 'math:pow', args: [{ kind: 'sym', id: 'a' }, { kind: 'num', numerator: '2', denominator: '1' }] },
        { kind: 'app', operator: 'math:pow', args: [{ kind: 'sym', id: 'b' }, { kind: 'num', numerator: '2', denominator: '1' }] },
      ],
    },
  ],
};

describe('the MathExpression grammar', () => {
  it('validates each non-recursive variant through its own named schema', () => {
    expect(MathNumSchema.safeParse({ kind: 'num', numerator: '-1', denominator: '6' }).success).toBe(true);
    expect(
      MathQtySchema.safeParse({
        kind: 'qty',
        value: { numerator: '196133', denominator: '20000' },
        unit: 'si:metre-per-square-second',
        uncertainty: { magnitude: { numerator: '1', denominator: '20000' } },
      }).success,
    ).toBe(true);
    expect(MathSymSchema.safeParse({ kind: 'sym', id: 'symbols:voltage' }).success).toBe(true);
    expect(MathUnparsedSchema.safeParse({ kind: 'unparsed', latex: '\\oint_C \\mathbf{B} \\cdot d\\mathbf{l}' }).success).toBe(true);
  });

  it('validates a deep recursive expression through the z.custom union', () => {
    expect(isMathExpression(pythagoras)).toBe(true);
    expect(MathExpressionSchema.safeParse(pythagoras).success).toBe(true);
  });

  it('validates the sum and prod binders with their bounds and lexically scoped binder symbol', () => {
    const sumOfSquares = {
      kind: 'sum',
      binder: 'i',
      lower: { kind: 'app', operator: 'math:equals', args: [{ kind: 'sym', id: 'i' }, { kind: 'num', numerator: '1', denominator: '1' }] },
      upper: { kind: 'sym', id: 'N' },
      body: { kind: 'app', operator: 'math:pow', args: [{ kind: 'sym', id: 'i' }, { kind: 'num', numerator: '2', denominator: '1' }] },
    } satisfies MathExpression;
    expect(MathSumSchema.safeParse(sumOfSquares).success).toBe(true);
    expect(MathExpressionSchema.safeParse(sumOfSquares).success).toBe(true);
    expect(
      MathExpressionSchema.safeParse({
        kind: 'prod',
        binder: 'k',
        lower: { kind: 'sym', id: 'k' },
        upper: { kind: 'sym', id: 'n' },
        body: { kind: 'sym', id: 'k' },
      }).success,
    ).toBe(true);
  });

  it('validates a matrix as rows of expressions and rejects a ragged one on both validation paths', () => {
    const identity = {
      kind: 'matrix',
      rows: [
        [
          { kind: 'num', numerator: '1', denominator: '1' },
          { kind: 'num', numerator: '0', denominator: '1' },
        ],
        [
          { kind: 'num', numerator: '0', denominator: '1' },
          { kind: 'num', numerator: '1', denominator: '1' },
        ],
      ],
    } satisfies MathExpression;
    expect(MathMatrixSchema.safeParse(identity).success).toBe(true);
    expect(MathExpressionSchema.safeParse(identity).success).toBe(true);

    const ragged = {
      kind: 'matrix',
      rows: [
        [{ kind: 'num', numerator: '1', denominator: '1' }, { kind: 'num', numerator: '0', denominator: '1' }],
        [{ kind: 'num', numerator: '0', denominator: '1' }],
      ],
    };
    expect(MathMatrixSchema.safeParse(ragged).success).toBe(false);
    expect(MathExpressionSchema.safeParse(ragged).success).toBe(false);
  });

  it('keeps unparsed a first-class fallback rather than a parse failure', () => {
    const partiallyLowered: MathExpression = {
      kind: 'app',
      operator: 'math:equals',
      args: [
        { kind: 'sym', id: 'c' },
        { kind: 'unparsed', latex: '\\int_0^\\infty e^{-x^2}\\,dx' },
      ],
    };
    expect(MathExpressionSchema.safeParse(partiallyLowered).success).toBe(true);
  });

  it('enforces the canonical-integer patterns through the recursive guard, at any depth', () => {
    expect(
      MathExpressionSchema.safeParse({ kind: 'app', operator: 'math:negate', args: [{ kind: 'num', numerator: '1', denominator: '0' }] })
        .success,
    ).toBe(false);
    expect(MathExpressionSchema.safeParse({ kind: 'num', numerator: '2.5', denominator: '1' }).success).toBe(false);
  });

  it('rejects unknown kinds and non-record inputs outright', () => {
    expect(isMathExpression(null)).toBe(false);
    expect(isMathExpression('num')).toBe(false);
    expect(isMathExpression(undefined)).toBe(false);
    expect(MathExpressionSchema.safeParse({ kind: 'integral', latex: '\\int x\\,dx' }).success).toBe(false);
  });

  it('survives a JSON round trip unchanged, exact rationals included', () => {
    const roundTripped: unknown = JSON.parse(JSON.stringify(pythagoras));
    expect(MathExpressionSchema.parse(roundTripped)).toEqual(pythagoras);
  });
});
