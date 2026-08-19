import { ByteReader, isAsciiWhitespace } from './bytes/reader';
import type { PdfDiagnosticSink } from './diagnostics';
import { nextToken } from './lexer';
import type { PdfDict, PdfObject } from './objects';
import { asNumber, dictGet, pdfDict } from './objects';
import { parseValue } from './parse';

// A content stream's own grammar is a sequence of operand values (numbers, names, strings, arrays, dicts -- the exact same value grammar parse.ts already implements for indirect objects) followed by an operator keyword that consumes them, e.g. "1 0 0 1 10 20 cm". This module turns that sequence into explicit (operands, operator) pairs; interpret.ts (the graphics/text state machine) is the only thing that knows what any particular operator means.

export interface ContentOperation {
  readonly operands: readonly PdfObject[];
  readonly operator: string;
}

// The BI...ID...EI inline-image form: not representable as ordinary operand/operator tokens, since the bytes between ID and EI are raw binary (possibly still filter-encoded), never PDF object syntax.
export interface InlineImage {
  readonly dict: PdfDict;
  readonly data: Uint8Array<ArrayBuffer>;
}

export type ContentToken = { readonly kind: 'operation'; readonly operation: ContentOperation } | { readonly kind: 'inlineImage'; readonly image: InlineImage };

export function readContentStream(bytes: Uint8Array<ArrayBuffer>, sink: PdfDiagnosticSink): ContentToken[] {
  const reader = new ByteReader(bytes);
  const tokens: ContentToken[] = [];
  let operands: PdfObject[] = [];
  for (;;) {
    const mark = reader.mark();
    const peeked = nextToken(reader);
    if (peeked === undefined) {
      break;
    }
    if (peeked.kind === 'keyword' && peeked.value === 'BI') {
      const image = readInlineImage(reader, sink);
      if (image !== undefined) {
        tokens.push({ kind: 'inlineImage', image });
      }
      operands = [];
      continue;
    }
    if (peeked.kind === 'keyword' && peeked.value !== 'true' && peeked.value !== 'false' && peeked.value !== 'null') {
      tokens.push({ kind: 'operation', operation: { operands, operator: peeked.value } });
      operands = [];
      continue;
    }
    reader.reset(mark);
    const value = parseValue(reader, sink);
    if (value === undefined) {
      break;
    }
    operands.push(value);
  }
  return tokens;
}

const EI_BYTES = new TextEncoder().encode('EI');

function looksLikeEiAt(reader: ByteReader, offset: number): boolean {
  if (offset < 0 || offset > reader.length) {
    return false;
  }
  const mark = reader.mark();
  reader.seek(offset);
  reader.skipWhitespace();
  const matches = reader.matchKeyword('EI');
  reader.reset(mark);
  return matches;
}

// "EI" must be boundary-checked (preceded and followed by whitespace) since raw inline-image data can coincidentally contain that exact byte pair -- the same heuristic real-world PDF interpreters use in the absence of an explicit /L, genuinely ambiguous only for adversarial input.
function findEiBoundary(reader: ByteReader, fromOffset: number): number | undefined {
  const haystack = reader.slice(fromOffset, reader.length);
  outer: for (let i = 0; i <= haystack.length - EI_BYTES.length; i++) {
    if (i > 0 && !isAsciiWhitespace(haystack[i - 1])) {
      continue;
    }
    for (let j = 0; j < EI_BYTES.length; j++) {
      if (haystack[i + j] !== EI_BYTES[j]) {
        continue outer;
      }
    }
    const after = haystack[i + EI_BYTES.length];
    if (after !== undefined && !isAsciiWhitespace(after)) {
      continue;
    }
    return fromOffset + i;
  }
  return undefined;
}

function readInlineImage(reader: ByteReader, sink: PdfDiagnosticSink): InlineImage | undefined {
  const entries = new Map<string, PdfObject>();
  for (;;) {
    const token = nextToken(reader);
    if (token === undefined) {
      sink({ code: 'pdf/inline-image-truncated', severity: 'warning', message: 'inline image dictionary was truncated before "ID"' });
      return undefined;
    }
    if (token.kind === 'keyword' && token.value === 'ID') {
      break;
    }
    if (token.kind !== 'name') {
      sink({ code: 'pdf/dict-key-not-name', severity: 'warning', message: 'inline image dictionary key was not a /Name' });
      continue;
    }
    const value = parseValue(reader, sink);
    if (value === undefined) {
      sink({ code: 'pdf/inline-image-truncated', severity: 'warning', message: 'inline image dictionary was truncated before "ID"' });
      return undefined;
    }
    entries.set(token.value, value);
  }
  reader.next(); // exactly one whitespace byte separates "ID" from the binary data (ISO 32000-1 8.9.7)
  const dataStart = reader.offset;
  const dict = pdfDict(entries);
  const explicitLength = asNumber(dictGet(dict, 'L') ?? dictGet(dict, 'Length'));
  let dataEnd: number;
  if (explicitLength !== undefined && looksLikeEiAt(reader, dataStart + explicitLength)) {
    dataEnd = dataStart + explicitLength;
  } else {
    const found = findEiBoundary(reader, dataStart);
    if (found === undefined) {
      sink({ code: 'pdf/inline-image-truncated', severity: 'warning', message: 'no "EI" boundary found for an inline image; treating the remainder of the content stream as its data' });
      dataEnd = reader.length;
    } else {
      // The single whitespace byte separating the data from "EI" (ISO 32000-1 8.9.7) is not part of the data -- trim it, when present, the same way parse.ts trims a stream's trailing EOL before a scanned "endstream".
      dataEnd = found > dataStart && isAsciiWhitespace(reader.slice(found - 1, found)[0]) ? found - 1 : found;
    }
  }
  const data = reader.slice(dataStart, dataEnd);
  reader.seek(dataEnd);
  reader.skipWhitespace();
  const eiTok = nextToken(reader);
  if (eiTok?.kind !== 'keyword' || eiTok.value !== 'EI') {
    sink({ code: 'pdf/inline-image-truncated', severity: 'warning', message: 'inline image data was not followed by "EI"' });
  }
  return { dict, data };
}
