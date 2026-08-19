import { ByteReader, isAsciiWhitespace } from './bytes/reader';
import type { PdfDiagnosticSink } from './diagnostics';
import { decodeStream } from './filters';
import { nextToken } from './lexer';
import type { PdfDict, PdfObject } from './objects';
import { asArray, asDict, asNumber, dictGet, isName, pdfDict, pdfRef } from './objects';
import { parseIndirectObject, parseValue } from './parse';

// Cross-reference resolution: the highest real-world compatibility surface in the whole parser. Most modern producers (Word, PowerPoint, Chrome, LibreOffice) default to PDF 1.5+ cross-reference *streams* with packed object streams, not the classic text-based table our own writer emits -- supporting only the classic form would fail to read the overwhelming majority of real-world, non-self-produced input.

export interface XrefOffsetEntry {
  readonly type: 'offset';
  readonly offset: number;
  readonly gen: number;
}

export interface XrefCompressedEntry {
  readonly type: 'compressed';
  readonly streamObjNum: number;
  readonly indexInStream: number;
}

export type XrefEntry = XrefOffsetEntry | XrefCompressedEntry;

export interface XrefTable {
  readonly entries: ReadonlyMap<number, XrefEntry>;
  readonly trailer: PdfDict;
}

const STARTXREF_BYTES = new TextEncoder().encode('startxref');
const OBJ_BYTES = new TextEncoder().encode('obj');
const TRAILER_BYTES = new TextEncoder().encode('trailer');
// A minimal local copy of the lexer's own delimiter set (ISO 32000-1 7.2.2), used only to boundary-check a recovered "obj" keyword occurrence during linear-scan recovery -- lexer.ts keeps its own copy private, and this is the one other place PDF syntax needs to know what counts as a token boundary.
const DELIMITER_BYTES = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

// Guards a looping /Prev chain (a corrupt or adversarial file pointing back at an already-visited offset) -- generous for any real-world incremental-update history, which rarely exceeds single digits of revisions.
const MAX_XREF_SECTIONS = 64;

export function readXref(bytes: Uint8Array<ArrayBuffer>, sink: PdfDiagnosticSink): XrefTable {
  const startxrefOffset = findStartxrefOffset(bytes);
  if (startxrefOffset !== undefined) {
    const { entries, trailer } = walkXrefChain(bytes, startxrefOffset, sink);
    if (isTableUsable(bytes, entries, trailer)) {
      return { entries, trailer };
    }
  }
  sink({
    code: 'pdf/xref-recovered',
    severity: 'warning',
    message: 'the document\'s own cross-reference data was missing, unreadable, or did not check out against the bytes it points at; rebuilt the table by scanning the file for "N G obj" headers',
  });
  return recoverXrefByLinearScan(bytes, sink);
}

function findLastOccurrence(bytes: Uint8Array<ArrayBuffer>, needle: Uint8Array<ArrayBuffer>): number | undefined {
  outer: for (let i = bytes.length - needle.length; i >= 0; i--) {
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) {
        continue outer;
      }
    }
    return i;
  }
  return undefined;
}

function findStartxrefOffset(bytes: Uint8Array<ArrayBuffer>): number | undefined {
  const at = findLastOccurrence(bytes, STARTXREF_BYTES);
  if (at === undefined) {
    return undefined;
  }
  const reader = new ByteReader(bytes);
  reader.seek(at + STARTXREF_BYTES.length);
  const token = nextToken(reader);
  return token?.kind === 'number' ? token.value : undefined;
}

// A /Root that resolves to a real object, and -- for a directly-located object -- whose recorded byte offset genuinely lands on that object's own "N G obj" header, is the whole table's fitness check: if the very entry every other lookup depends on is wrong, the rest almost certainly is too.
function isTableUsable(bytes: Uint8Array<ArrayBuffer>, entries: ReadonlyMap<number, XrefEntry>, trailer: PdfDict): boolean {
  const root = dictGet(trailer, 'Root');
  if (root?.kind !== 'ref') {
    return false;
  }
  const rootEntry = entries.get(root.num);
  if (rootEntry === undefined) {
    return false;
  }
  if (rootEntry.type === 'compressed') {
    return true; // validating would mean decompressing the containing object stream here; a wrong index just degrades later at resolve() time with its own diagnostic, not a crash
  }
  return looksLikeObjectHeaderAt(bytes, rootEntry.offset, root.num);
}

function looksLikeObjectHeaderAt(bytes: Uint8Array<ArrayBuffer>, offset: number, expectedNum: number): boolean {
  if (offset < 0 || offset >= bytes.length) {
    return false;
  }
  const reader = new ByteReader(bytes);
  reader.seek(offset);
  const numTok = nextToken(reader);
  const genTok = nextToken(reader);
  const objTok = nextToken(reader);
  return numTok?.kind === 'number' && numTok.value === expectedNum && genTok?.kind === 'number' && objTok?.kind === 'keyword' && objTok.value === 'obj';
}

interface XrefSection {
  readonly entries: ReadonlyMap<number, XrefEntry>;
  readonly trailer: PdfDict;
  readonly prevOffset: number | undefined;
}

function walkXrefChain(bytes: Uint8Array<ArrayBuffer>, startOffset: number, sink: PdfDiagnosticSink): { entries: Map<number, XrefEntry>; trailer: PdfDict } {
  const merged = new Map<number, XrefEntry>();
  const mergedTrailerEntries = new Map<string, PdfObject>();
  const visited = new Set<number>();
  let offset: number | undefined = startOffset;
  let sections = 0;
  while (offset !== undefined && !visited.has(offset) && sections < MAX_XREF_SECTIONS) {
    visited.add(offset);
    sections++;
    const section = readXrefSection(bytes, offset, sink);
    if (section === undefined) {
      sink({ code: 'pdf/xref-entry-invalid', severity: 'warning', message: `no readable cross-reference section at offset ${String(offset)}` });
      break;
    }
    for (const [num, entry] of section.entries) {
      if (!merged.has(num)) {
        merged.set(num, entry); // first (newest) definition wins -- sections are walked newest-first via /Prev
      }
    }
    for (const [key, value] of section.trailer.entries) {
      if (!mergedTrailerEntries.has(key)) {
        mergedTrailerEntries.set(key, value);
      }
    }
    offset = section.prevOffset;
  }
  return { entries: merged, trailer: pdfDict(mergedTrailerEntries) };
}

function readXrefSection(bytes: Uint8Array<ArrayBuffer>, offset: number, sink: PdfDiagnosticSink): XrefSection | undefined {
  const reader = new ByteReader(bytes);
  reader.seek(offset);
  const mark = reader.mark();
  const token = nextToken(reader);
  if (token?.kind === 'keyword' && token.value === 'xref') {
    return readClassicXrefSection(reader, sink);
  }
  reader.reset(mark);
  const indirect = parseIndirectObject(reader, sink);
  if (indirect?.value.kind === 'stream') {
    return readXrefStreamSection(indirect.value.dict, indirect.value.raw, sink);
  }
  return undefined;
}

function readClassicXrefSection(reader: ByteReader, sink: PdfDiagnosticSink): XrefSection {
  const entries = new Map<number, XrefEntry>();
  for (;;) {
    const mark = reader.mark();
    const startTok = nextToken(reader);
    if (startTok?.kind !== 'number') {
      reader.reset(mark);
      break;
    }
    const countTok = nextToken(reader);
    if (countTok?.kind !== 'number') {
      sink({ code: 'pdf/xref-entry-invalid', severity: 'warning', message: 'classic xref subsection header was not "start count"' });
      reader.reset(mark);
      break;
    }
    for (let i = 0; i < countTok.value; i++) {
      const offsetTok = nextToken(reader);
      const genTok = nextToken(reader);
      const typeTok = nextToken(reader);
      if (offsetTok?.kind !== 'number' || genTok?.kind !== 'number' || typeTok?.kind !== 'keyword') {
        sink({ code: 'pdf/xref-entry-invalid', severity: 'warning', message: `malformed classic xref entry for object ${String(startTok.value + i)}` });
        break;
      }
      if (typeTok.value === 'n') {
        entries.set(startTok.value + i, { type: 'offset', offset: offsetTok.value, gen: genTok.value });
      }
      // A 'f' (free) entry is simply not recorded -- resolving a free object number is diagnosed at fetch() time in document.ts, not here.
    }
  }
  const trailerTok = nextToken(reader);
  if (trailerTok?.kind !== 'keyword' || trailerTok.value !== 'trailer') {
    sink({ code: 'pdf/xref-entry-invalid', severity: 'warning', message: 'classic xref section was not followed by a "trailer" keyword' });
    return { entries, trailer: pdfDict({}), prevOffset: undefined };
  }
  const trailerValue = parseValue(reader, sink);
  const trailer = asDict(trailerValue) ?? pdfDict({});
  return { entries, trailer, prevOffset: asNumber(dictGet(trailer, 'Prev')) };
}

// A default /W width of [1 1 1] only applies if /W is entirely absent (never valid in a real file, but a harmless fallback); each of /W's three fields defaults independently is NOT a spec behaviour -- /W is mandatory per-field when present, so a genuinely missing field is a malformed-file condition read as 0 (making that field's type default to 1, matching ISO 32000-1's own "if the first element is zero, the type field defaults to type 1" rule).
function readXrefStreamSection(dict: PdfDict, raw: Uint8Array<ArrayBuffer>, sink: PdfDiagnosticSink): XrefSection {
  const decoded = decodeStream(raw, dict, sink);
  const widths = asArray(dictGet(dict, 'W'));
  const w0 = widths !== undefined ? (asNumber(widths[0]) ?? 0) : 1;
  const w1 = widths !== undefined ? (asNumber(widths[1]) ?? 0) : 1;
  const w2 = widths !== undefined ? (asNumber(widths[2]) ?? 0) : 1;
  const rowLength = w0 + w1 + w2;
  const size = asNumber(dictGet(dict, 'Size')) ?? 0;
  const indexArray = asArray(dictGet(dict, 'Index'));
  const ranges: [number, number][] = [];
  if (indexArray !== undefined) {
    for (let i = 0; i + 1 < indexArray.length; i += 2) {
      const start = asNumber(indexArray[i]);
      const count = asNumber(indexArray[i + 1]);
      if (start !== undefined && count !== undefined) {
        ranges.push([start, count]);
      }
    }
  } else {
    ranges.push([0, size]);
  }
  const entries = new Map<number, XrefEntry>();
  let rowOffset = 0;
  for (const [start, count] of ranges) {
    for (let i = 0; i < count; i++) {
      rowOffset += rowLength;
      const base = rowOffset - rowLength;
      if (rowLength === 0 || base + rowLength > decoded.bytes.length) {
        sink({ code: 'pdf/xref-entry-invalid', severity: 'warning', message: `xref stream ran out of data before object ${String(start + i)}` });
        break;
      }
      const type = w0 === 0 ? 1 : readBigEndian(decoded.bytes, base, w0);
      const field2 = readBigEndian(decoded.bytes, base + w0, w1);
      const field3 = readBigEndian(decoded.bytes, base + w0 + w1, w2);
      const objNum = start + i;
      if (type === 0) {
        continue;
      } else if (type === 1) {
        entries.set(objNum, { type: 'offset', offset: field2, gen: field3 });
      } else if (type === 2) {
        entries.set(objNum, { type: 'compressed', streamObjNum: field2, indexInStream: field3 });
      } else {
        sink({ code: 'pdf/xref-entry-invalid', severity: 'warning', message: `xref stream row for object ${String(objNum)} has unrecognised type ${String(type)}` });
      }
    }
  }
  return { entries, trailer: dict, prevOffset: asNumber(dictGet(dict, 'Prev')) };
}

function readBigEndian(bytes: Uint8Array<ArrayBuffer>, offset: number, width: number): number {
  let value = 0;
  for (let i = 0; i < width; i++) {
    value = value * 256 + (bytes[offset + i] ?? 0);
  }
  return value;
}

// --- Linear-scan recovery: rebuilds the table from scratch by scanning the whole file for "N G obj" headers, for the case where startxref is missing/unusable or the section(s) it names don't check out. Also decodes any recovered /Type /ObjStm streams, since exactly the modern-producer files most likely to need recovery are also the ones packing their Catalog/Pages/Font dictionaries inside object streams -- a rebuilt table that only found top-level headers would still be missing the objects that matter most. ---

function isBoundaryByte(byte: number | undefined): boolean {
  return byte === undefined || isAsciiWhitespace(byte) || DELIMITER_BYTES.has(byte);
}

function findAllKeywordPositions(bytes: Uint8Array<ArrayBuffer>, needle: Uint8Array<ArrayBuffer>): number[] {
  const positions: number[] = [];
  outer: for (let i = 0; i <= bytes.length - needle.length; i++) {
    if (!isBoundaryByte(bytes[i - 1])) {
      continue;
    }
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) {
        continue outer;
      }
    }
    if (!isBoundaryByte(bytes[i + needle.length])) {
      continue;
    }
    positions.push(i);
  }
  return positions;
}

function isDigitByte(byte: number | undefined): boolean {
  return byte !== undefined && byte >= 0x30 && byte <= 0x39;
}

// Walks `bytes` backward from `end`, stopping at the first byte (from the right) that fails `predicate` -- e.g. skipping a run of trailing whitespace or trailing digits. Returns the index just past that stopping point, i.e. the start of the run that satisfied `predicate`.
function scanBackWhile(bytes: Uint8Array<ArrayBuffer>, end: number, predicate: (byte: number | undefined) => boolean): number {
  let i = end;
  while (i > 0 && predicate(bytes[i - 1])) {
    i--;
  }
  return i;
}

// Scans backward from just before a recovered "obj" keyword occurrence to recover its "N G" header -- the header is always exactly two whitespace-separated non-negative integers immediately preceding "obj", so a dedicated backward scan is simpler and more direct here than pressing the forward-only tokenizer into service.
function scanObjectHeaderBackward(bytes: Uint8Array<ArrayBuffer>, objKeywordStart: number): { num: number; gen: number; headerStart: number } | undefined {
  const genEnd = scanBackWhile(bytes, objKeywordStart, isAsciiWhitespace);
  const genStart = scanBackWhile(bytes, genEnd, isDigitByte);
  if (genStart === genEnd) {
    return undefined;
  }
  const numEnd = scanBackWhile(bytes, genStart, isAsciiWhitespace);
  const numStart = scanBackWhile(bytes, numEnd, isDigitByte);
  if (numStart === numEnd) {
    return undefined;
  }
  const decoder = new TextDecoder('latin1');
  const num = Number(decoder.decode(bytes.subarray(numStart, numEnd)));
  const gen = Number(decoder.decode(bytes.subarray(genStart, genEnd)));
  return { num, gen, headerStart: numStart };
}

function recoverXrefByLinearScan(bytes: Uint8Array<ArrayBuffer>, sink: PdfDiagnosticSink): XrefTable {
  const entries = new Map<number, XrefEntry>();
  for (const objPos of findAllKeywordPositions(bytes, OBJ_BYTES)) {
    const header = scanObjectHeaderBackward(bytes, objPos);
    if (header === undefined) {
      continue;
    }
    entries.set(header.num, { type: 'offset', offset: header.headerStart, gen: header.gen }); // later (later-in-file) headers naturally override earlier ones for the same object number, mirroring newest-revision-wins without needing an explicit /Prev chain
  }

  let lastCatalogRef: PdfObject | undefined;
  let lastXrefTrailerDict: PdfDict | undefined;
  for (const [num, entry] of entries) {
    if (entry.type !== 'offset') {
      continue;
    }
    const reader = new ByteReader(bytes);
    reader.seek(entry.offset);
    const indirect = parseIndirectObject(reader, sink);
    if (indirect === undefined) {
      continue;
    }
    const dict = asDict(indirect.value);
    if (dict === undefined) {
      continue;
    }
    if (isName(dictGet(dict, 'Type'), 'Catalog')) {
      lastCatalogRef = pdfRef(num, entry.gen);
    }
    if (isName(dictGet(dict, 'Type'), 'XRef')) {
      lastXrefTrailerDict = dict;
    }
    if (indirect.value.kind === 'stream' && isName(dictGet(dict, 'Type'), 'ObjStm')) {
      registerObjStmContents(num, indirect.value.dict, indirect.value.raw, entries, sink);
    }
  }

  const trailer = findRecoveredTrailer(bytes, sink) ?? lastXrefTrailerDict ?? (lastCatalogRef !== undefined ? pdfDict({ Root: lastCatalogRef }) : pdfDict({}));
  return { entries, trailer };
}

function registerObjStmContents(streamObjNum: number, dict: PdfDict, raw: Uint8Array<ArrayBuffer>, entries: Map<number, XrefEntry>, sink: PdfDiagnosticSink): void {
  const decoded = decodeStream(raw, dict, sink);
  const n = asNumber(dictGet(dict, 'N')) ?? 0;
  const reader = new ByteReader(decoded.bytes);
  let index = 0;
  for (let i = 0; i < n; i++) {
    const numTok = nextToken(reader);
    const offTok = nextToken(reader);
    if (numTok?.kind !== 'number' || offTok?.kind !== 'number') {
      sink({ code: 'pdf/xref-entry-invalid', severity: 'warning', message: `recovered object stream ${String(streamObjNum)} header is truncated at entry ${String(i)}` });
      break;
    }
    if (!entries.has(numTok.value)) {
      entries.set(numTok.value, { type: 'compressed', streamObjNum, indexInStream: index });
    }
    index++;
  }
}

function findRecoveredTrailer(bytes: Uint8Array<ArrayBuffer>, sink: PdfDiagnosticSink): PdfDict | undefined {
  const at = findLastOccurrence(bytes, TRAILER_BYTES);
  if (at === undefined) {
    return undefined;
  }
  const reader = new ByteReader(bytes);
  reader.seek(at + TRAILER_BYTES.length);
  return asDict(parseValue(reader, sink));
}
