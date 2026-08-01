import { describe, expect, it } from 'vitest';
import type { PdfDiagnostic, PdfDiagnosticSink } from './diagnostics';
import { readContentStream } from './content-read';
import { dictGet } from './objects';

function collectDiagnostics(): { sink: PdfDiagnosticSink; diagnostics: PdfDiagnostic[] } {
  const diagnostics: PdfDiagnostic[] = [];
  return { sink: (d) => diagnostics.push(d), diagnostics };
}

function textBytes(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

function concatBytes(...chunks: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

describe('readContentStream: operations', () => {
  it('reads an operator with no operands', () => {
    const { sink } = collectDiagnostics();
    expect(readContentStream(textBytes('Q'), sink)).toEqual([{ kind: 'operation', operation: { operands: [], operator: 'Q' } }]);
  });

  it('reads a matrix operator with six numeric operands', () => {
    const { sink } = collectDiagnostics();
    const [token] = readContentStream(textBytes('1 0 0 1 10 20 cm'), sink);
    expect(token).toEqual({
      kind: 'operation',
      operation: {
        operands: [1, 0, 0, 1, 10, 20].map((value) => ({ kind: 'number', value })),
        operator: 'cm',
      },
    });
  });

  it('reads a sequence of operations in order', () => {
    const { sink } = collectDiagnostics();
    const tokens = readContentStream(textBytes('q 1 0 0 rg Q'), sink);
    expect(tokens.map((t) => (t.kind === 'operation' ? t.operation.operator : t.kind))).toEqual(['q', 'rg', 'Q']);
  });

  it('reads a literal-string operand', () => {
    const { sink } = collectDiagnostics();
    const [token] = readContentStream(textBytes('(Hello) Tj'), sink);
    if (token?.kind !== 'operation') {
      throw new Error('expected an operation');
    }
    expect(token.operation.operator).toBe('Tj');
    const [operand] = token.operation.operands;
    expect(operand?.kind).toBe('string');
  });

  it('reads a name operand', () => {
    const { sink } = collectDiagnostics();
    const [token] = readContentStream(textBytes('/F1 12 Tf'), sink);
    if (token?.kind !== 'operation') {
      throw new Error('expected an operation');
    }
    expect(token.operation.operands[0]).toEqual({ kind: 'name', name: 'F1' });
  });

  it('reads an array operand', () => {
    const { sink } = collectDiagnostics();
    const [token] = readContentStream(textBytes('[2 1] 0 d'), sink);
    if (token?.kind !== 'operation') {
      throw new Error('expected an operation');
    }
    expect(token.operation.operator).toBe('d');
    expect(token.operation.operands[0]).toEqual({ kind: 'array', items: [{ kind: 'number', value: 2 }, { kind: 'number', value: 1 }] });
  });

  it('does not treat true/false/null as operators -- they accumulate as operands', () => {
    const { sink } = collectDiagnostics();
    const [token] = readContentStream(textBytes('true BDC'), sink);
    if (token?.kind !== 'operation') {
      throw new Error('expected an operation');
    }
    expect(token.operation.operator).toBe('BDC');
    expect(token.operation.operands[0]).toEqual({ kind: 'bool', value: true });
  });

  it('reads a realistic BT...Tj...ET sequence', () => {
    const { sink } = collectDiagnostics();
    const tokens = readContentStream(textBytes('BT /F1 12 Tf 10 50 Td (Hi) Tj ET'), sink);
    expect(tokens.map((t) => (t.kind === 'operation' ? t.operation.operator : t.kind))).toEqual(['BT', 'Tf', 'Td', 'Tj', 'ET']);
  });
});

describe('readContentStream: inline images', () => {
  const pixelData = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]); // 2x2 RGB, raw

  it('reads an inline image bounded by a scanned "EI" (no /L present)', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const content = concatBytes(textBytes('q 100 0 0 100 10 0 cm BI /W 2 /H 2 /CS /RGB /BPC 8 ID '), pixelData, textBytes(' EI Q'));
    const tokens = readContentStream(content, sink);
    const inlineToken = tokens.find((t) => t.kind === 'inlineImage');
    if (inlineToken?.kind !== 'inlineImage') {
      throw new Error('expected an inline image token');
    }
    expect(dictGet(inlineToken.image.dict, 'W')).toEqual({ kind: 'number', value: 2 });
    expect(Array.from(inlineToken.image.data)).toEqual(Array.from(pixelData));
    expect(diagnostics).toEqual([]);
  });

  it('reads an inline image bounded by an explicit /L', () => {
    const { sink } = collectDiagnostics();
    const content = concatBytes(textBytes(`BI /W 2 /H 2 /CS /RGB /BPC 8 /L ${String(pixelData.length)} ID `), pixelData, textBytes(' EI'));
    const tokens = readContentStream(content, sink);
    const inlineToken = tokens.find((t) => t.kind === 'inlineImage');
    if (inlineToken?.kind !== 'inlineImage') {
      throw new Error('expected an inline image token');
    }
    expect(Array.from(inlineToken.image.data)).toEqual(Array.from(pixelData));
  });

  it('continues reading operations after an inline image', () => {
    const { sink } = collectDiagnostics();
    const content = concatBytes(textBytes('BI /W 2 /H 2 /CS /RGB /BPC 8 ID '), pixelData, textBytes(' EI Q'));
    const tokens = readContentStream(content, sink);
    expect(tokens[tokens.length - 1]).toEqual({ kind: 'operation', operation: { operands: [], operator: 'Q' } });
  });

  it('reports a diagnostic and stops at end of input when "EI" is never found', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const content = concatBytes(textBytes('BI /W 2 /H 2 ID '), pixelData);
    readContentStream(content, sink);
    expect(diagnostics.some((d) => d.code === 'pdf/inline-image-truncated')).toBe(true);
  });
});
