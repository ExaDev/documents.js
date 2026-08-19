import { ByteReader } from './bytes/reader';
import type { PdfDiagnosticSink } from './diagnostics';
import { nextToken } from './lexer';

// A /ToUnicode CMap (ISO 32000-1 9.10.3) is written in a PostScript-derived syntax, but the only two constructs that matter for text extraction -- bfchar (single-code mappings) and bfrange (contiguous-range mappings) -- use exactly PDF's own token vocabulary (hex strings, arrays, numbers, keywords), so the shared lexer tokenizes it directly. Everything else in the stream (begincmap/endcmap, codespacerange, the surrounding PostScript dict/findresource/defineresource boilerplate) is simply skipped rather than interpreted -- this is a CMap *reader*, not a PostScript interpreter.

export interface ToUnicodeCMap {
  lookup(code: number): string | undefined;
}

function hexBytesToNumber(bytes: Uint8Array<ArrayBuffer>): number {
  let value = 0;
  for (const byte of bytes) {
    value = value * 256 + byte;
  }
  return value;
}

// CMap destination values are UTF-16BE (ISO 32000-1 9.10.3); building the JS string directly from the raw 16-bit code units is correct even for surrogate pairs, since a JS string's own internal representation already is UTF-16.
function decodeUtf16BEString(bytes: Uint8Array<ArrayBuffer>): string {
  const units: number[] = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    units.push(((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0));
  }
  return String.fromCharCode(...units);
}

export function parseToUnicodeCMap(bytes: Uint8Array<ArrayBuffer>, sink: PdfDiagnosticSink): ToUnicodeCMap {
  const reader = new ByteReader(bytes);
  const map = new Map<number, string>();
  for (;;) {
    const token = nextToken(reader);
    if (token === undefined) {
      break;
    }
    if (token.kind === 'keyword' && token.value === 'beginbfchar') {
      readBfChar(reader, map, sink);
    } else if (token.kind === 'keyword' && token.value === 'beginbfrange') {
      readBfRange(reader, map, sink);
    }
  }
  return { lookup: (code) => map.get(code) };
}

function readBfChar(reader: ByteReader, map: Map<number, string>, sink: PdfDiagnosticSink): void {
  for (;;) {
    const srcTok = nextToken(reader);
    if (srcTok === undefined) {
      sink({ code: 'pdf/cmap-truncated', severity: 'warning', message: 'bfchar section was truncated before endbfchar' });
      return;
    }
    if (srcTok.kind === 'keyword' && srcTok.value === 'endbfchar') {
      return;
    }
    if (srcTok.kind !== 'hexString') {
      continue;
    }
    const dstTok = nextToken(reader);
    if (dstTok?.kind !== 'hexString') {
      sink({ code: 'pdf/cmap-entry-invalid', severity: 'warning', message: 'bfchar entry had no valid destination hex string' });
      continue;
    }
    map.set(hexBytesToNumber(srcTok.value), decodeUtf16BEString(dstTok.value));
  }
}

function readBfRange(reader: ByteReader, map: Map<number, string>, sink: PdfDiagnosticSink): void {
  for (;;) {
    const loTok = nextToken(reader);
    if (loTok === undefined) {
      sink({ code: 'pdf/cmap-truncated', severity: 'warning', message: 'bfrange section was truncated before endbfrange' });
      return;
    }
    if (loTok.kind === 'keyword' && loTok.value === 'endbfrange') {
      return;
    }
    if (loTok.kind !== 'hexString') {
      continue;
    }
    const hiTok = nextToken(reader);
    if (hiTok?.kind !== 'hexString') {
      sink({ code: 'pdf/cmap-entry-invalid', severity: 'warning', message: 'bfrange entry had no valid high-end hex string' });
      continue;
    }
    const lo = hexBytesToNumber(loTok.value);
    const hi = hexBytesToNumber(hiTok.value);
    const dstTok = nextToken(reader);
    if (dstTok?.kind === 'hexString') {
      registerBfRangeSingle(map, lo, hi, dstTok.value);
    } else if (dstTok?.kind === 'arrayStart') {
      readBfRangeArray(reader, map, lo, sink);
    } else {
      sink({ code: 'pdf/cmap-entry-invalid', severity: 'warning', message: 'bfrange entry had no valid destination' });
    }
  }
}

// A single-hex-string destination applies to every code in [lo, hi] by incrementing only the LAST UTF-16 code unit -- any preceding code units are a fixed prefix, per ISO 32000-1 9.7.5.3, which is what lets a range still express e.g. a shared-prefix ligature run.
function registerBfRangeSingle(map: Map<number, string>, lo: number, hi: number, dstBytes: Uint8Array<ArrayBuffer>): void {
  if (dstBytes.length < 2) {
    return;
  }
  const prefix = decodeUtf16BEString(dstBytes.subarray(0, dstBytes.length - 2));
  const baseUnit = ((dstBytes[dstBytes.length - 2] ?? 0) << 8) | (dstBytes[dstBytes.length - 1] ?? 0);
  for (let code = lo; code <= hi; code++) {
    map.set(code, prefix + String.fromCharCode(baseUnit + (code - lo)));
  }
}

// An array destination gives each code in the range its own independent, non-incrementing string.
function readBfRangeArray(reader: ByteReader, map: Map<number, string>, lo: number, sink: PdfDiagnosticSink): void {
  let code = lo;
  for (;;) {
    const token = nextToken(reader);
    if (token === undefined) {
      sink({ code: 'pdf/cmap-truncated', severity: 'warning', message: 'bfrange array destination was truncated' });
      return;
    }
    if (token.kind === 'arrayEnd') {
      return;
    }
    if (token.kind !== 'hexString') {
      continue;
    }
    map.set(code, decodeUtf16BEString(token.value));
    code++;
  }
}
