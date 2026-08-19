import type { ByteReader } from './bytes/reader';
import type { PdfDiagnosticSink } from './diagnostics';
import { nextToken } from './lexer';
import type { PdfDict, PdfObject } from './objects';
import { dictGet, pdfArray, pdfBool, pdfDict, pdfHexString, pdfLiteralString, pdfName, pdfNull, pdfNum, pdfRef, pdfStream } from './objects';

// tokens (lexer.ts) -> PdfObject (objects.ts): array/dict nesting, the "N G R" reference vs bare-number disambiguation, and indirect-object/stream-body assembly. Every recoverable malformation here reports through the caller's PdfDiagnosticSink and degrades gracefully (an empty array, a null value, a best-effort stream length) rather than throwing -- the throw tier is reserved for document.ts/xref.ts, which know whether a given malformed object is actually load-bearing.

// Reads one PDF value at the reader's current position: null/true/false, a number (or an "N G R" reference, resolved via lookahead), a name, a literal or hex string, a nested array, or a nested dict (or the stream it introduces). Returns undefined only at end of input.
export function parseValue(reader: ByteReader, sink: PdfDiagnosticSink): PdfObject | undefined {
  const token = nextToken(reader);
  if (token === undefined) {
    return undefined;
  }
  switch (token.kind) {
    case 'number':
      return parseNumberOrReference(reader, token.value);
    case 'name':
      return pdfName(token.value);
    case 'literalString':
      return pdfLiteralString(token.value);
    case 'hexString':
      return pdfHexString(token.value);
    case 'arrayStart':
      return parseArrayBody(reader, sink);
    case 'dictStart':
      return parseDictOrStreamBody(reader, sink);
    case 'keyword':
      return parseKeywordValue(token.value, sink);
    case 'arrayEnd':
    case 'dictEnd':
      sink({ code: 'pdf/unexpected-delimiter', severity: 'warning', message: `unexpected "${token.kind === 'arrayEnd' ? ']' : '>>'}" where a value was expected` });
      return pdfNull();
  }
}

function parseKeywordValue(keyword: string, sink: PdfDiagnosticSink): PdfObject {
  if (keyword === 'true') {
    return pdfBool(true);
  }
  if (keyword === 'false') {
    return pdfBool(false);
  }
  if (keyword === 'null') {
    return pdfNull();
  }
  sink({ code: 'pdf/unexpected-keyword', severity: 'warning', message: `unexpected keyword "${keyword}" where a value was expected` });
  return pdfNull();
}

// Only a non-negative integer can start an "N G R" reference -- floats and negative numbers skip the lookahead entirely, since ECMA-376's own grammar never allows them there and attempting it would just cost a wasted mark/reset on every ordinary float in a Widths array or a coordinate array.
function parseNumberOrReference(reader: ByteReader, first: number): PdfObject {
  if (!Number.isInteger(first) || first < 0) {
    return pdfNum(first);
  }
  const mark = reader.mark();
  const second = nextToken(reader);
  if (second?.kind === 'number' && Number.isInteger(second.value) && second.value >= 0) {
    const third = nextToken(reader);
    if (third?.kind === 'keyword' && third.value === 'R') {
      return pdfRef(first, second.value);
    }
  }
  reader.reset(mark);
  return pdfNum(first);
}

function parseArrayBody(reader: ByteReader, sink: PdfDiagnosticSink): PdfObject {
  const items: PdfObject[] = [];
  for (;;) {
    const mark = reader.mark();
    const token = nextToken(reader);
    if (token === undefined) {
      sink({ code: 'pdf/unterminated-array', severity: 'warning', message: 'array not closed before end of input' });
      break;
    }
    if (token.kind === 'arrayEnd') {
      break;
    }
    reader.reset(mark);
    const beforeOffset = reader.offset;
    const value = parseValue(reader, sink);
    if (value === undefined || reader.offset === beforeOffset) {
      break;
    }
    items.push(value);
  }
  return pdfArray(items);
}

function parseDictOrStreamBody(reader: ByteReader, sink: PdfDiagnosticSink): PdfObject {
  const entries = new Map<string, PdfObject>();
  for (;;) {
    const token = nextToken(reader);
    if (token === undefined) {
      sink({ code: 'pdf/unterminated-dict', severity: 'warning', message: 'dictionary not closed before end of input' });
      break;
    }
    if (token.kind === 'dictEnd') {
      break;
    }
    if (token.kind !== 'name') {
      sink({ code: 'pdf/dict-key-not-name', severity: 'warning', message: `expected a /Name dictionary key, found "${token.kind}"` });
      continue;
    }
    const value = parseValue(reader, sink);
    if (value === undefined) {
      sink({ code: 'pdf/dict-missing-value', severity: 'warning', message: `dictionary key "/${token.value}" has no value before end of input` });
      break;
    }
    entries.set(token.value, value);
  }
  const dict = pdfDict(entries);
  const afterDictMark = reader.mark();
  const maybeStream = nextToken(reader);
  if (maybeStream?.kind === 'keyword' && maybeStream.value === 'stream') {
    return parseStreamBody(reader, sink, dict);
  }
  reader.reset(afterDictMark);
  return dict;
}

// Per ISO 32000-1 7.3.8.1, "stream" must be followed by CRLF or a bare LF (never a bare CR) before the stream's bytes begin. Real producers occasionally get this wrong; tolerate it with a diagnostic rather than throwing, since the /Length-driven read below doesn't actually depend on getting this exactly right.
function skipStreamDataStart(reader: ByteReader, sink: PdfDiagnosticSink): void {
  if (reader.peek() === 0x0d) {
    reader.next();
    if (reader.peek() === 0x0a) {
      reader.next();
    } else {
      sink({ code: 'pdf/stream-bad-eol', severity: 'warning', message: 'stream keyword followed by a bare CR, not CRLF or LF as required' });
    }
    return;
  }
  if (reader.peek() === 0x0a) {
    reader.next();
    return;
  }
  sink({ code: 'pdf/stream-bad-eol', severity: 'warning', message: 'stream keyword not followed by an end-of-line marker' });
}

const ENDSTREAM_BYTES = new TextEncoder().encode('endstream');

// A stream's /Length is very often an indirect reference (the producer doesn't know the compressed length until after the object is written) -- unresolvable at this layer, since there's no object store yet. This function only trusts a *direct* numeric /Length, and only after confirming it actually lands on "endstream"; every other case (missing, indirect, wrong) falls back to scanning forward for the literal "endstream" keyword, which is what real-world malformed/regenerated files need anyway.
function parseStreamBody(reader: ByteReader, sink: PdfDiagnosticSink, dict: PdfDict): PdfObject {
  skipStreamDataStart(reader, sink);
  const dataStart = reader.offset;
  const lengthObj = dictGet(dict, 'Length');
  let dataEnd = resolveDirectLength(reader, dataStart, lengthObj);
  if (dataEnd === undefined) {
    if (lengthObj !== undefined) {
      sink({ code: 'pdf/stream-length-invalid', severity: 'warning', message: 'stream /Length was missing, indirect, or did not land on "endstream"; falling back to a scan for "endstream"' });
    }
    const found = findEndstreamOffset(reader, dataStart);
    if (found === undefined) {
      sink({ code: 'pdf/stream-unterminated', severity: 'warning', message: 'no "endstream" found before end of input; treating the remainder of the file as stream data' });
      dataEnd = reader.length;
    } else {
      dataEnd = trimTrailingStreamEol(reader, dataStart, found);
    }
  }
  const raw = reader.slice(dataStart, dataEnd);
  reader.seek(dataEnd);
  reader.skipWhitespace();
  const endTok = nextToken(reader);
  if (endTok?.kind !== 'keyword' || endTok.value !== 'endstream') {
    sink({ code: 'pdf/missing-endstream', severity: 'warning', message: 'stream data was not followed by "endstream"' });
  }
  return pdfStream(dict, raw);
}

function resolveDirectLength(reader: ByteReader, dataStart: number, lengthObj: PdfObject | undefined): number | undefined {
  if (lengthObj?.kind !== 'number' || !Number.isInteger(lengthObj.value) || lengthObj.value < 0) {
    return undefined;
  }
  const candidateEnd = dataStart + lengthObj.value;
  if (candidateEnd > reader.length || !looksLikeEndstreamAt(reader, candidateEnd)) {
    return undefined;
  }
  return candidateEnd;
}

function looksLikeEndstreamAt(reader: ByteReader, offset: number): boolean {
  const mark = reader.mark();
  reader.seek(offset);
  reader.skipWhitespace();
  const matches = reader.matchKeyword('endstream');
  reader.reset(mark);
  return matches;
}

function findEndstreamOffset(reader: ByteReader, fromOffset: number): number | undefined {
  const haystack = reader.slice(fromOffset, reader.length);
  outer: for (let i = 0; i <= haystack.length - ENDSTREAM_BYTES.length; i++) {
    for (let j = 0; j < ENDSTREAM_BYTES.length; j++) {
      if (haystack[i + j] !== ENDSTREAM_BYTES[j]) {
        continue outer;
      }
    }
    return fromOffset + i;
  }
  return undefined;
}

// The EOL immediately before "endstream" (per spec, CRLF or LF, and not part of the stream's own data) is trimmed when present; an omitted EOL (some producers skip it) leaves the boundary exactly at the scanned offset.
function trimTrailingStreamEol(reader: ByteReader, dataStart: number, endstreamOffset: number): number {
  const precedingTwo = reader.slice(Math.max(dataStart, endstreamOffset - 2), endstreamOffset);
  if (precedingTwo.length >= 2 && precedingTwo[precedingTwo.length - 2] === 0x0d && precedingTwo[precedingTwo.length - 1] === 0x0a) {
    return endstreamOffset - 2;
  }
  if (precedingTwo.length >= 1 && (precedingTwo[precedingTwo.length - 1] === 0x0a || precedingTwo[precedingTwo.length - 1] === 0x0d)) {
    return endstreamOffset - 1;
  }
  return endstreamOffset;
}

export interface ParsedIndirectObject {
  readonly num: number;
  readonly gen: number;
  readonly value: PdfObject;
}

// Reads "N G obj <value> endobj" at the reader's current position. Returns undefined, with the reader position unchanged, if the current position doesn't actually start an indirect object header -- the caller (xref.ts's recovery scan) relies on this to probe candidate offsets without committing to them.
export function parseIndirectObject(reader: ByteReader, sink: PdfDiagnosticSink): ParsedIndirectObject | undefined {
  const mark = reader.mark();
  const numTok = nextToken(reader);
  const genTok = nextToken(reader);
  const objTok = nextToken(reader);
  if (numTok?.kind !== 'number' || genTok?.kind !== 'number' || objTok?.kind !== 'keyword' || objTok.value !== 'obj') {
    reader.reset(mark);
    return undefined;
  }
  const value = parseValue(reader, sink);
  if (value === undefined) {
    sink({ code: 'pdf/object-missing-value', severity: 'warning', message: `object ${String(numTok.value)} ${String(genTok.value)} has no value before end of input` });
    return { num: numTok.value, gen: genTok.value, value: pdfNull() };
  }
  const endMark = reader.mark();
  const endTok = nextToken(reader);
  if (endTok?.kind !== 'keyword' || endTok.value !== 'endobj') {
    sink({ code: 'pdf/missing-endobj', severity: 'warning', message: `object ${String(numTok.value)} ${String(genTok.value)} is missing its "endobj" keyword` });
    reader.reset(endMark);
  }
  return { num: numTok.value, gen: genTok.value, value };
}
