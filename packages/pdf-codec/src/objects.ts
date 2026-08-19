// The PDF object model: the shared currency between the hand-written writer (write.ts and friends) and the hand-written parser (parse.ts and friends) -- the direct analogue of ooxml.js's XmlNode.
//
// Deliberately tagged even for scalars (a PDF name and a PDF string are different objects; so are a bare number and the start of a reference), so narrowing is plain TypeScript control flow on the `kind` discriminant -- exactly what keeps the no-`as`-assertions ESLint rule satisfiable without a single guard function of our own writing.
//
// No Zod schema wraps this type: it never crosses a public boundary, never round-trips through JSON, and is constructed exclusively by our own parser -- validating it would be validating our own output. The same reasoning ooxml.js applies when it picks a hand-written isXmlNode guard over z.lazy for its own recursive type: pick the mechanism that fits, don't pay for validation you don't need.
export type PdfObject =
  | { kind: 'null' }
  | { kind: 'bool'; value: boolean }
  | { kind: 'number'; value: number }
  | { kind: 'name'; name: string } // stored without the leading '/'
  | { kind: 'string'; bytes: Uint8Array<ArrayBuffer>; hex: boolean } // raw bytes, never a decoded JS string -- see the module doc below
  | { kind: 'array'; items: PdfObject[] }
  | { kind: 'dict'; entries: Map<string, PdfObject> } // Map, not a plain object: dictionary keys are arbitrary byte sequences and could include '__proto__'
  | { kind: 'stream'; dict: PdfDict; raw: Uint8Array<ArrayBuffer> } // raw = still filter-encoded; decoding is lazy (src/pdf/filters.ts)
  | { kind: 'ref'; num: number; gen: number };

export type PdfDict = Extract<PdfObject, { kind: 'dict' }>;
export type PdfArray = Extract<PdfObject, { kind: 'array' }>;
export type PdfStream = Extract<PdfObject, { kind: 'stream' }>;

// A PDF string's byte-to-text interpretation depends entirely on context: PDFDocEncoding for /Info entries, UTF-16BE-with-BOM for some modern metadata, the current font's own encoding inside a content stream's Tj/TJ operands. Decoding a string's bytes into a JS string too early is how a bug becomes unrecoverable mojibake, so this model keeps every string as raw bytes and pushes decoding out to the specific boundary that knows the right encoding (src/pdf/font-read.ts for shown text, a dedicated PDFDocEncoding decoder for /Info, etc.).

export function pdfNull(): PdfObject {
  return { kind: 'null' };
}

export function pdfBool(value: boolean): PdfObject {
  return { kind: 'bool', value };
}

export function pdfNum(value: number): PdfObject {
  return { kind: 'number', value };
}

export function pdfName(name: string): PdfObject {
  return { kind: 'name', name };
}

export function pdfHexString(bytes: Uint8Array<ArrayBuffer>): PdfObject {
  return { kind: 'string', bytes, hex: true };
}

export function pdfLiteralString(bytes: Uint8Array<ArrayBuffer>): PdfObject {
  return { kind: 'string', bytes, hex: false };
}

export function pdfArray(items: PdfObject[]): PdfObject {
  return { kind: 'array', items };
}

export function pdfDict(entries: Record<string, PdfObject> | Map<string, PdfObject>): PdfDict {
  return { kind: 'dict', entries: entries instanceof Map ? entries : new Map(Object.entries(entries)) };
}

export function pdfStream(dict: PdfDict, raw: Uint8Array<ArrayBuffer>): PdfObject {
  return { kind: 'stream', dict, raw };
}

export function pdfRef(num: number, gen: number): PdfObject {
  return { kind: 'ref', num, gen };
}

// --- Resolution-free accessors: narrow a PdfObject without following references. Reference- following accessors live on PdfDocument (src/pdf/document.ts), since dereferencing needs the object store an individual PdfObject doesn't carry. ---

export function isName(obj: PdfObject | undefined, name: string): boolean {
  return obj?.kind === 'name' && obj.name === name;
}

export function asNumber(obj: PdfObject | undefined): number | undefined {
  return obj?.kind === 'number' ? obj.value : undefined;
}

export function asName(obj: PdfObject | undefined): string | undefined {
  return obj?.kind === 'name' ? obj.name : undefined;
}

export function asBool(obj: PdfObject | undefined): boolean | undefined {
  return obj?.kind === 'bool' ? obj.value : undefined;
}

export function asArray(obj: PdfObject | undefined): PdfObject[] | undefined {
  return obj?.kind === 'array' ? obj.items : undefined;
}

// A dictionary's own entries, whether `obj` is a plain dict or a stream (whose /-entries live on `dict`) -- the two are interchangeable for key lookup throughout the PDF spec.
export function asDict(obj: PdfObject | undefined): PdfDict | undefined {
  if (obj === undefined) {
    return undefined;
  }
  if (obj.kind === 'dict') {
    return obj;
  }
  if (obj.kind === 'stream') {
    return obj.dict;
  }
  return undefined;
}

export function dictGet(dict: PdfDict, key: string): PdfObject | undefined {
  return dict.entries.get(key);
}
