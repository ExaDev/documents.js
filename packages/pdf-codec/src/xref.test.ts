import { describe, expect, it } from 'vitest';
import {
  brokenStartxrefPdf,
  incrementalUpdatePdf,
  minimalClassicXrefPdf,
  xrefStreamWithObjectStreamPdf,
} from './test-support/pdf';
import type { PdfDiagnostic, PdfDiagnosticSink } from './diagnostics';
import { dictGet } from './objects';
import { readXref } from './xref';

function collectDiagnostics(): { sink: PdfDiagnosticSink; diagnostics: PdfDiagnostic[] } {
  const diagnostics: PdfDiagnostic[] = [];
  return { sink: (d) => diagnostics.push(d), diagnostics };
}

// Replaces the digit run after the last "startxref\n" with a bogus offset, entirely at the byte level -- the fixture's compressed streams are binary and a UTF-8 text round-trip (decode/replace/re-encode) would silently mangle every byte >=0x80 in them.
function corruptTrailingStartxrefOffset(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const marker = new TextEncoder().encode('startxref\n');
  let markerStart = -1;
  outer: for (let i = bytes.length - marker.length; i >= 0; i--) {
    for (let j = 0; j < marker.length; j++) {
      if (bytes[i + j] !== marker[j]) {
        continue outer;
      }
    }
    markerStart = i;
    break;
  }
  if (markerStart === -1) {
    throw new Error('fixture has no "startxref" marker');
  }
  const digitsStart = markerStart + marker.length;
  let digitsEnd = digitsStart;
  while (digitsEnd < bytes.length && (bytes[digitsEnd] ?? 0) >= 0x30 && (bytes[digitsEnd] ?? 0) <= 0x39) {
    digitsEnd++;
  }
  const replacement = new TextEncoder().encode('999999');
  const out = new Uint8Array(digitsStart + replacement.length + (bytes.length - digitsEnd));
  out.set(bytes.subarray(0, digitsStart), 0);
  out.set(replacement, digitsStart);
  out.set(bytes.subarray(digitsEnd), digitsStart + replacement.length);
  return out;
}

describe('readXref: classic table', () => {
  it('reads every object offset from a minimal classic xref table', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const table = readXref(minimalClassicXrefPdf(), sink);
    for (let num = 1; num <= 5; num++) {
      const entry = table.entries.get(num);
      expect(entry?.type).toBe('offset');
    }
    expect(dictGet(table.trailer, 'Root')).toEqual({ kind: 'ref', num: 1, gen: 0 });
    expect(diagnostics).toEqual([]);
  });
});

describe('readXref: xref stream + object stream', () => {
  it('resolves compressed entries for objects packed in an ObjStm and direct entries for the rest', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const table = readXref(xrefStreamWithObjectStreamPdf(), sink);
    for (const num of [1, 2, 3]) {
      const entry = table.entries.get(num);
      expect(entry).toEqual({ type: 'compressed', streamObjNum: 4, indexInStream: num - 1 });
    }
    expect(table.entries.get(5)?.type).toBe('offset'); // the content stream, a direct top-level object
    expect(table.entries.get(6)?.type).toBe('offset'); // the xref stream itself
    expect(dictGet(table.trailer, 'Root')).toEqual({ kind: 'ref', num: 1, gen: 0 });
    expect(diagnostics).toEqual([]);
  });
});

describe('readXref: incremental update', () => {
  it('takes the newest revision for an overridden object and keeps untouched objects from the original section', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const table = readXref(incrementalUpdatePdf(), sink);
    for (const num of [1, 2, 3, 4, 5]) {
      expect(table.entries.get(num)?.type).toBe('offset');
    }
    expect(diagnostics).toEqual([]);
  });

  it('chains through /Prev to the first section\'s trailer for keys the second section does not redefine', () => {
    const { sink } = collectDiagnostics();
    const table = readXref(incrementalUpdatePdf(), sink);
    expect(dictGet(table.trailer, 'Root')).toEqual({ kind: 'ref', num: 1, gen: 0 });
  });
});

describe('readXref: recovery', () => {
  it('recovers every object via a linear scan when startxref points nowhere useful, with a diagnostic', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const table = readXref(brokenStartxrefPdf(), sink);
    for (let num = 1; num <= 5; num++) {
      expect(table.entries.get(num)?.type).toBe('offset');
    }
    expect(dictGet(table.trailer, 'Root')).toEqual({ kind: 'ref', num: 1, gen: 0 });
    expect(diagnostics.some((d) => d.code === 'pdf/xref-recovered')).toBe(true);
  });

  it('recovers compressed entries from a scanned /Type /ObjStm when the whole table needed rebuilding', () => {
    const { sink, diagnostics } = collectDiagnostics();
    // Force recovery on an otherwise-valid xref-stream file by corrupting startxref's target -- purely at the byte level, since the file's compressed streams are binary and would be mangled by any UTF-8 text round-trip.
    const corrupted = corruptTrailingStartxrefOffset(xrefStreamWithObjectStreamPdf());
    const table = readXref(corrupted, sink);
    for (const num of [1, 2, 3]) {
      expect(table.entries.get(num)).toEqual({ type: 'compressed', streamObjNum: 4, indexInStream: num - 1 });
    }
    expect(dictGet(table.trailer, 'Root')).toEqual({ kind: 'ref', num: 1, gen: 0 });
    expect(diagnostics.some((d) => d.code === 'pdf/xref-recovered')).toBe(true);
  });
});
