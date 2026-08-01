import { describe, expect, it } from 'vitest';
import type { PdfDiagnostic, PdfDiagnosticSink } from './diagnostics';
import { parseToUnicodeCMap } from './cmap';

function collectDiagnostics(): { sink: PdfDiagnosticSink; diagnostics: PdfDiagnostic[] } {
  const diagnostics: PdfDiagnostic[] = [];
  return { sink: (d) => diagnostics.push(d), diagnostics };
}

function textBytes(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

describe('parseToUnicodeCMap: bfchar', () => {
  it('maps individual codes to their Unicode destination', () => {
    const { sink } = collectDiagnostics();
    const cmap = parseToUnicodeCMap(
      textBytes('1 beginbfchar\n<0003> <0041>\n<0004> <0042>\nendbfchar'),
      sink,
    );
    expect(cmap.lookup(3)).toBe('A');
    expect(cmap.lookup(4)).toBe('B');
    expect(cmap.lookup(5)).toBeUndefined();
  });

  it('decodes a multi-character (ligature) destination', () => {
    const { sink } = collectDiagnostics();
    // 'f','f','i' as three UTF-16BE code units.
    const cmap = parseToUnicodeCMap(textBytes('beginbfchar\n<0010> <00660066 0069>\nendbfchar'), sink);
    expect(cmap.lookup(0x10)).toBe('ffi');
  });

  it('reports a diagnostic and stops cleanly when truncated before endbfchar', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const cmap = parseToUnicodeCMap(textBytes('beginbfchar\n<0003> <0041>'), sink);
    expect(cmap.lookup(3)).toBe('A');
    expect(diagnostics.some((d) => d.code === 'pdf/cmap-truncated')).toBe(true);
  });
});

describe('parseToUnicodeCMap: bfrange', () => {
  it('maps a contiguous range via a single incrementing destination', () => {
    const { sink } = collectDiagnostics();
    const cmap = parseToUnicodeCMap(textBytes('beginbfrange\n<0005> <0007> <0043>\nendbfrange'), sink);
    expect(cmap.lookup(5)).toBe('C');
    expect(cmap.lookup(6)).toBe('D');
    expect(cmap.lookup(7)).toBe('E');
    expect(cmap.lookup(8)).toBeUndefined();
  });

  it('keeps a shared prefix fixed while only the final code unit increments', () => {
    const { sink } = collectDiagnostics();
    // Destination is 'X' (0058) + a base unit 0041 -- only the trailing unit increments across the range.
    const cmap = parseToUnicodeCMap(textBytes('beginbfrange\n<0000> <0002> <00580041>\nendbfrange'), sink);
    expect(cmap.lookup(0)).toBe('XA');
    expect(cmap.lookup(1)).toBe('XB');
    expect(cmap.lookup(2)).toBe('XC');
  });

  it('maps each code independently when the destination is an array', () => {
    const { sink } = collectDiagnostics();
    const cmap = parseToUnicodeCMap(textBytes('beginbfrange\n<0000> <0002> [<0041> <0058> <0059>]\nendbfrange'), sink);
    expect(cmap.lookup(0)).toBe('A');
    expect(cmap.lookup(1)).toBe('X');
    expect(cmap.lookup(2)).toBe('Y');
  });

  it('reports a diagnostic and stops cleanly when truncated before endbfrange', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const cmap = parseToUnicodeCMap(textBytes('beginbfrange\n<0005> <0007> <0043>'), sink);
    expect(cmap.lookup(5)).toBe('C');
    expect(diagnostics.some((d) => d.code === 'pdf/cmap-truncated')).toBe(true);
  });
});

describe('parseToUnicodeCMap: surrounding PostScript boilerplate', () => {
  it('ignores everything outside bfchar/bfrange sections, including codespacerange and dict/begin/end noise', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const cmap = parseToUnicodeCMap(
      textBytes(
        '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n1 beginbfchar\n<0003> <0041>\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend',
      ),
      sink,
    );
    expect(cmap.lookup(3)).toBe('A');
    expect(diagnostics).toEqual([]);
  });
});
