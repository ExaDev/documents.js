import { ByteReader } from './bytes/reader';
import { PdfEncryptedError, PdfParseError } from './diagnostics';
import type { PdfDiagnosticSink } from './diagnostics';
import { decodeStream } from './filters';
import { nextToken } from './lexer';
import type { PdfDict, PdfObject } from './objects';
import { asArray, asDict, asNumber, dictGet, isName, pdfNull } from './objects';
import { parseIndirectObject, parseValue } from './parse';
import type { XrefEntry } from './xref';
import { readXref } from './xref';

// The object store: resolves references (direct offset or ObjStm-compressed) against the cross-reference table xref.ts built, and walks the page tree with ISO 32000-1 7.7.3.4 inheritance (a Page node's /Resources, /MediaBox, /CropBox, /Rotate fall back to the nearest ancestor Pages node that defines them). Every fetched object is cached by object number; every decoded object stream is cached whole, since a single ObjStm is very often referenced by several of its own contained objects in short order.

export interface PdfDocument {
  readonly trailer: PdfDict;
  resolve(obj: PdfObject | undefined): PdfObject | undefined;
  resolveDict(obj: PdfObject | undefined): PdfDict | undefined;
  pages(): PdfDict[];
}

// Guards a reference cycle (object A pointing to B pointing back to A) -- a corrupt or adversarial file, not something a real producer emits.
const MAX_RESOLVE_DEPTH = 64;

// A Page node's own inheritable attributes, per ISO 32000-1 Table 30 -- the set every mainstream producer actually relies on (most titles/body text never repeat /MediaBox or /Resources on every single page, inheriting the deck-wide value from an ancestor Pages node instead).
const INHERITABLE_PAGE_KEYS = ['Resources', 'MediaBox', 'CropBox', 'Rotate'] as const;

export function openPdfDocument(bytes: Uint8Array<ArrayBuffer>, sink: PdfDiagnosticSink): PdfDocument {
  const xref = readXref(bytes, sink);
  if (dictGet(xref.trailer, 'Encrypt') !== undefined) {
    throw new PdfEncryptedError();
  }

  const objectCache = new Map<number, PdfObject>();
  const objStmCache = new Map<number, PdfObject[]>();

  function fetchDirect(num: number, entry: Extract<XrefEntry, { type: 'offset' }>): PdfObject {
    const reader = new ByteReader(bytes);
    reader.seek(entry.offset);
    const indirect = parseIndirectObject(reader, sink);
    if (indirect === undefined) {
      sink({ code: 'pdf/object-missing-value', severity: 'warning', message: `object ${String(num)} could not be parsed at its recorded offset` });
      return pdfNull();
    }
    return indirect.value;
  }

  function decodeObjectStream(streamObjNum: number): PdfObject[] {
    const cached = objStmCache.get(streamObjNum);
    if (cached !== undefined) {
      return cached;
    }
    const streamEntry = xref.entries.get(streamObjNum);
    const streamObj = streamEntry?.type === 'offset' ? fetchDirect(streamObjNum, streamEntry) : undefined;
    if (streamObj?.kind !== 'stream') {
      sink({ code: 'pdf/object-missing-value', severity: 'warning', message: `object ${String(streamObjNum)} referenced as an object stream is not directly-located, or is not actually a stream` });
      objStmCache.set(streamObjNum, []);
      return [];
    }
    const decoded = decodeStream(streamObj.raw, streamObj.dict, sink);
    const n = asNumber(dictGet(streamObj.dict, 'N')) ?? 0;
    const first = asNumber(dictGet(streamObj.dict, 'First')) ?? 0;
    const headerReader = new ByteReader(decoded.bytes);
    const relativeOffsets: number[] = [];
    for (let i = 0; i < n; i++) {
      const numTok = nextToken(headerReader);
      const offTok = nextToken(headerReader);
      if (numTok?.kind !== 'number' || offTok?.kind !== 'number') {
        sink({ code: 'pdf/object-missing-value', severity: 'warning', message: `object stream ${String(streamObjNum)} header is truncated at entry ${String(i)}` });
        break;
      }
      relativeOffsets.push(offTok.value);
    }
    const values = relativeOffsets.map((relativeOffset) => {
      const valueReader = new ByteReader(decoded.bytes);
      valueReader.seek(first + relativeOffset);
      return parseValue(valueReader, sink) ?? pdfNull();
    });
    objStmCache.set(streamObjNum, values);
    return values;
  }

  function fetch(num: number): PdfObject {
    const cached = objectCache.get(num);
    if (cached !== undefined) {
      return cached;
    }
    const entry = xref.entries.get(num);
    if (entry === undefined) {
      sink({ code: 'pdf/object-missing-value', severity: 'warning', message: `object ${String(num)} is referenced but not present in the cross-reference table` });
      return pdfNull();
    }
    const value = entry.type === 'offset' ? fetchDirect(num, entry) : (decodeObjectStream(entry.streamObjNum)[entry.indexInStream] ?? pdfNull());
    objectCache.set(num, value);
    return value;
  }

  function resolve(obj: PdfObject | undefined): PdfObject | undefined {
    let current = obj;
    let depth = 0;
    while (current?.kind === 'ref' && depth < MAX_RESOLVE_DEPTH) {
      current = fetch(current.num);
      depth++;
    }
    if (depth >= MAX_RESOLVE_DEPTH) {
      sink({ code: 'pdf/reference-cycle', severity: 'warning', message: 'a chain of indirect references did not resolve within the depth limit; treating it as null' });
      return pdfNull();
    }
    return current;
  }

  function resolveDict(obj: PdfObject | undefined): PdfDict | undefined {
    return asDict(resolve(obj));
  }

  const resolvedRoot = resolveDict(dictGet(xref.trailer, 'Root'));
  if (resolvedRoot === undefined || !isName(dictGet(resolvedRoot, 'Type'), 'Catalog')) {
    throw new PdfParseError('pdf/no-root', 'no resolvable /Root catalog was found, even after cross-reference recovery');
  }
  // A fresh, explicitly-typed binding: TypeScript's control-flow narrowing of `resolvedRoot` above does not persist into the nested `pages()` closure below, since the closure may be invoked long after this guard runs.
  const catalog: PdfDict = resolvedRoot;

  function pages(): PdfDict[] {
    const pagesRoot = resolveDict(dictGet(catalog, 'Pages'));
    if (pagesRoot === undefined) {
      return [];
    }
    const result: PdfDict[] = [];
    walkPageTree(pagesRoot, {}, new Set(), result);
    return result;
  }

  function walkPageTree(node: PdfDict, inherited: Record<string, PdfObject>, visited: Set<PdfDict>, result: PdfDict[]): void {
    if (visited.has(node)) {
      sink({ code: 'pdf/page-tree-cycle', severity: 'warning', message: 'the page tree contains a cycle; stopping descent at the repeated node' });
      return;
    }
    visited.add(node);
    const merged: Record<string, PdfObject> = { ...inherited };
    for (const key of INHERITABLE_PAGE_KEYS) {
      const own = dictGet(node, key);
      if (own !== undefined) {
        merged[key] = own;
      }
    }
    const kids = asArray(dictGet(node, 'Kids'));
    if (kids === undefined) {
      // A leaf (no /Kids) is a Page regardless of whether /Type /Page is actually present -- some malformed producers omit it, and presence-of-Kids is the more robust real-world discriminant.
      const entries = new Map(node.entries);
      for (const key of INHERITABLE_PAGE_KEYS) {
        if (!entries.has(key) && merged[key] !== undefined) {
          entries.set(key, merged[key]);
        }
      }
      result.push({ kind: 'dict', entries });
      return;
    }
    for (const kid of kids) {
      const kidDict = resolveDict(kid);
      if (kidDict !== undefined) {
        walkPageTree(kidDict, merged, visited, result);
      }
    }
  }

  return { trailer: xref.trailer, resolve, resolveDict, pages };
}
