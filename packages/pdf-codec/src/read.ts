import { bytesToBase64 } from './util/base64';
import { crc32 } from './bytes/crc32';
import { concatBytes } from './bytes/writer';
import type { LayoutDocument, LayoutEllipse, LayoutImageAsset, LayoutItem, LayoutLine, LayoutLink, LayoutMetadata, LayoutPage, LayoutPath, LayoutPathSegment, LayoutRect, LayoutSubpath, LayoutText } from 'document-schema.js';
import { LAYOUT_FORMAT_VERSION } from 'document-schema.js';
import type { Color as LayoutColor, LayoutFont } from 'document-schema.js';
import { openPdfDocument } from './document';
import type { PdfDiagnosticSink } from './diagnostics';
import { NOOP_DIAGNOSTIC_SINK, PdfParseError } from './diagnostics';
import { decodeStream } from './filters';
import { throwIfAborted } from './util/abort';
import type { FontResolverService } from './font-read';
import { createFontResolver } from './font-read';
import { readImageXObject } from './images-read';
import type { ExtractedEllipse, ExtractedImage, ExtractedInlineImage, ExtractedItem, ExtractedLine, ExtractedPaint, ExtractedPath, ExtractedRect, ExtractedSubpath, ExtractedTextRun, PdfObjectResolver } from './interpret';
import { interpretContentStream } from './interpret';
import type { Matrix } from './matrix';
import { applyMatrix, matrixRotationDegrees, matrixScaleX, matrixScaleY, multiplyMatrices, translationMatrix } from './matrix';
import type { PdfDict, PdfObject } from './objects';
import { asArray, asName, asNumber, dictGet } from './objects';
import { NOTES_ANNOTATION_AUTHOR } from './write';

// readPdf(bytes, options?) -> LayoutDocument: the top of the read pipeline, assembling every other src/pdf/* read module (document.ts's object store and page tree, interpret.ts's graphics/text extraction, font-read.ts's width/decode, images-read.ts's PNG/JPEG recovery) into the same pivot model src/pdf/write.ts consumes on the way out, so a document round-trips through readPdf -> writePdf structurally even though neither claims byte- or content-fidelity.

export interface ReadPdfOptions {
  readonly sink?: PdfDiagnosticSink;
  readonly signal?: AbortSignal;
}

const PDF_HEADER_BYTES = new TextEncoder().encode('%PDF-');
// Real producers occasionally prepend a small amount of junk (a UTF-8 BOM, blank lines) before the header -- ISO 32000-1 7.5.2 itself permits leading bytes before "%PDF-", so this scans a window rather than requiring it at offset 0.
const HEADER_SEARCH_WINDOW = 1024;
// US Letter (ISO 32000-1's own example default, and the overwhelming common fallback in practice): used only when a page has no /MediaBox at all, even after page-tree inheritance -- a genuinely malformed file.
const DEFAULT_PAGE_WIDTH_PT = 612;
const DEFAULT_PAGE_HEIGHT_PT = 792;

function hasPdfHeader(bytes: Uint8Array<ArrayBuffer>): boolean {
  const window = bytes.subarray(0, Math.min(HEADER_SEARCH_WINDOW, bytes.length));
  outer: for (let i = 0; i <= window.length - PDF_HEADER_BYTES.length; i++) {
    for (let j = 0; j < PDF_HEADER_BYTES.length; j++) {
      if (window[i + j] !== PDF_HEADER_BYTES[j]) {
        continue outer;
      }
    }
    return true;
  }
  return false;
}

export function readPdf(bytes: Uint8Array<ArrayBuffer>, options?: ReadPdfOptions): LayoutDocument {
  const sink = options?.sink ?? NOOP_DIAGNOSTIC_SINK;
  const signal = options?.signal;
  if (!hasPdfHeader(bytes)) {
    throw new PdfParseError('pdf/no-header', 'no "%PDF-" header found within the first bytes of the file; this does not look like a PDF at all');
  }
  const doc = openPdfDocument(bytes, sink);
  const fontResolver = createFontResolver({ resolver: doc, sink });
  const images: Record<string, LayoutImageAsset> = {};
  const imageIdCache = new Map<PdfDict, string | null>();

  const pages = doc.pages().map((pageDict) => {
    throwIfAborted(signal);
    return readPage(pageDict, doc, fontResolver, images, imageIdCache, sink);
  });

  return {
    formatVersion: LAYOUT_FORMAT_VERSION,
    metadata: readMetadata(doc.trailer, doc),
    pages,
    images,
  };
}

// --- Page geometry: MediaBox origin shift + /Rotate, composed into one matrix applied to every extracted item on the page. ---

interface MediaBoxRect {
  readonly llx: number;
  readonly lly: number;
  readonly urx: number;
  readonly ury: number;
}

function readMediaBox(page: PdfDict): MediaBoxRect {
  const arr = asArray(dictGet(page, 'MediaBox'));
  if (arr === undefined) {
    return { llx: 0, lly: 0, urx: DEFAULT_PAGE_WIDTH_PT, ury: DEFAULT_PAGE_HEIGHT_PT };
  }
  const a = asNumber(arr[0]) ?? 0;
  const b = asNumber(arr[1]) ?? 0;
  const c = asNumber(arr[2]) ?? DEFAULT_PAGE_WIDTH_PT;
  const d = asNumber(arr[3]) ?? DEFAULT_PAGE_HEIGHT_PT;
  return { llx: Math.min(a, c), lly: Math.min(b, d), urx: Math.max(a, c), ury: Math.max(b, d) };
}

type PageRotation = 0 | 90 | 180 | 270;

export function normalizeRotation(rotate: number | undefined): PageRotation {
  if (rotate === undefined) {
    return 0;
  }
  const normalized = (((Math.round(rotate / 90) * 90) % 360) + 360) % 360;
  return normalized === 90 || normalized === 180 || normalized === 270 ? normalized : 0;
}

interface PageRotationResult {
  readonly matrix: Matrix;
  readonly widthPt: number;
  readonly heightPt: number;
}

// Each case derived and verified independently by tracking where all four MediaBox corners land after physically rotating the rendered page clockwise by the given angle (ISO 32000-1 7.7.3.3's own definition of /Rotate) -- e.g. for 90, the original bottom-left corner (0,0) becomes the new page's top-left corner (0, w), and solving the resulting four-corner system gives (x,y) -> (y, w-x).
export function pageRotationTransform(rotation: PageRotation, w: number, h: number): PageRotationResult {
  if (rotation === 90) {
    return { matrix: [0, -1, 1, 0, 0, w], widthPt: h, heightPt: w };
  }
  if (rotation === 180) {
    return { matrix: [-1, 0, 0, -1, w, h], widthPt: w, heightPt: h };
  }
  if (rotation === 270) {
    return { matrix: [0, 1, -1, 0, h, 0], widthPt: h, heightPt: w };
  }
  return { matrix: [1, 0, 0, 1, 0, 0], widthPt: w, heightPt: h };
}

// --- Page content: /Contents (single stream or array), interpretation, and per-item conversion into LayoutItem. ---

function readPageContentBytes(page: PdfDict, resolver: PdfObjectResolver, sink: PdfDiagnosticSink): Uint8Array<ArrayBuffer> {
  const contentsObj = resolver.resolve(dictGet(page, 'Contents'));
  if (contentsObj?.kind === 'stream') {
    return decodeStream(contentsObj.raw, contentsObj.dict, sink).bytes;
  }
  if (contentsObj?.kind === 'array') {
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    for (const item of contentsObj.items) {
      const streamObj = resolver.resolve(item);
      if (streamObj?.kind === 'stream') {
        chunks.push(decodeStream(streamObj.raw, streamObj.dict, sink).bytes, new Uint8Array([0x0a]));
      }
    }
    return concatBytes(chunks);
  }
  return new Uint8Array(0);
}

function readPage(page: PdfDict, resolver: PdfObjectResolver, fontResolver: FontResolverService, images: Record<string, LayoutImageAsset>, imageIdCache: Map<PdfDict, string | null>, sink: PdfDiagnosticSink): LayoutPage {
  const resources = resolver.resolveDict(dictGet(page, 'Resources'));
  const mediaBox = readMediaBox(page);
  const rotation = normalizeRotation(asNumber(dictGet(page, 'Rotate')));
  const rotationResult = pageRotationTransform(rotation, mediaBox.urx - mediaBox.llx, mediaBox.ury - mediaBox.lly);
  const pageMatrix = multiplyMatrices(translationMatrix(-mediaBox.llx, -mediaBox.lly), rotationResult.matrix);

  const items: LayoutItem[] = [];
  if (resources !== undefined) {
    const contentBytes = readPageContentBytes(page, resolver, sink);
    const extracted = interpretContentStream(contentBytes, resources, { fontMetrics: fontResolver.metrics, resolver, sink });
    for (const item of extracted) {
      const converted = convertExtractedItem(item, pageMatrix, fontResolver, images, imageIdCache, resolver, sink);
      if (converted !== undefined) {
        items.push(converted);
      }
    }
  } else {
    sink({ code: 'pdf/object-missing-value', severity: 'warning', message: 'page has no /Resources dict; its content stream cannot be interpreted' });
  }
  items.push(...readLinkAnnotations(page, pageMatrix, resolver));

  const notes = readPageNotes(page, resolver);

  return { widthPt: rotationResult.widthPt, heightPt: rotationResult.heightPt, items, ...(notes !== undefined ? { notes } : {}) };
}

function convertExtractedItem(item: ExtractedItem, pageMatrix: Matrix, fontResolver: FontResolverService, images: Record<string, LayoutImageAsset>, imageIdCache: Map<PdfDict, string | null>, resolver: PdfObjectResolver, sink: PdfDiagnosticSink): LayoutItem | undefined {
  if (item.kind === 'text') {
    return convertText(item, pageMatrix, fontResolver);
  }
  if (item.kind === 'rect') {
    return convertRect(item, pageMatrix);
  }
  if (item.kind === 'ellipse') {
    return convertEllipse(item, pageMatrix);
  }
  if (item.kind === 'line') {
    return convertLine(item, pageMatrix);
  }
  if (item.kind === 'path') {
    return convertPath(item, pageMatrix);
  }
  if (item.kind === 'image') {
    return convertImage(item, pageMatrix, images, imageIdCache, resolver, sink);
  }
  return convertInlineImage(item, pageMatrix, images, resolver, sink);
}

function convertText(item: ExtractedTextRun, pageMatrix: Matrix, fontResolver: FontResolverService): LayoutText | undefined {
  const font = fontResolver.resolve(item.fontResourceName, item.resources);
  const text = font?.decodeToUnicode(item.codes) ?? '';
  if (text.length === 0) {
    return undefined;
  }
  const startTrm = multiplyMatrices(item.startMatrix, pageMatrix);
  const endTrm = multiplyMatrices(item.endMatrix, pageMatrix);
  const widthPt = Math.hypot(endTrm[4] - startTrm[4], endTrm[5] - startTrm[5]);
  // hypot(Trm[0], Trm[1]): the device-space length of one unit of text-space X under the composed matrix -- wrong under rotation if taken from Trm[3] alone, and the same quantity the write path's own text placement is built from in reverse.
  const sizePt = matrixScaleX(startTrm);
  const rotationDeg = matrixRotationDegrees(startTrm);
  const layoutFont: LayoutFont = {
    family: font?.family ?? 'Helvetica',
    weight: font?.bold === true ? 'bold' : 'normal',
    style: font?.italic === true ? 'italic' : 'normal',
  };
  return {
    kind: 'text',
    text,
    xPt: startTrm[4],
    yPt: startTrm[5],
    font: layoutFont,
    sizePt: sizePt > 0 ? sizePt : item.sizePt,
    color: item.color,
    widthPt,
    rotationDeg: rotationDeg !== 0 ? rotationDeg : undefined,
  };
}

// fill/stroke are each omitted rather than written as an explicit `undefined`, matching convertPath's own convention and keeping a recovered item structurally identical to the LayoutRect/LayoutEllipse a caller would have written by hand.
function paintFields(paint: ExtractedPaint): { fill?: LayoutColor; stroke?: { readonly color: LayoutColor; readonly widthPt: number } } {
  return {
    ...(paint.fill !== undefined ? { fill: paint.fill } : {}),
    ...(paint.stroke !== undefined ? { stroke: paint.stroke } : {}),
  };
}

// A CTM composed only of 90-degree-multiple rotations (the only kind pageMatrix ever carries) maps an axis-aligned box to another axis-aligned box -- transforming just the two opposite corners and re-deriving min/max is enough, no general polygon handling needed. An ellipse's bounding box transforms by exactly the same rule (a 90-degree rotation swaps its two radii and leaves it axis-aligned), so both kinds share this helper.
function transformBox(item: { xPt: number; yPt: number; widthPt: number; heightPt: number }, pageMatrix: Matrix): { xPt: number; yPt: number; widthPt: number; heightPt: number } {
  const p1 = applyMatrix(pageMatrix, { x: item.xPt, y: item.yPt });
  const p2 = applyMatrix(pageMatrix, { x: item.xPt + item.widthPt, y: item.yPt + item.heightPt });
  return {
    xPt: Math.min(p1.x, p2.x),
    yPt: Math.min(p1.y, p2.y),
    widthPt: Math.abs(p2.x - p1.x),
    heightPt: Math.abs(p2.y - p1.y),
  };
}

function convertRect(item: ExtractedRect, pageMatrix: Matrix): LayoutRect {
  return { kind: 'rect', ...transformBox(item, pageMatrix), ...paintFields(item) };
}

function convertEllipse(item: ExtractedEllipse, pageMatrix: Matrix): LayoutEllipse {
  return { kind: 'ellipse', ...transformBox(item, pageMatrix), ...paintFields(item) };
}

// Both endpoints transform individually: unlike a box, a line has no axis-alignment to preserve, and its two ends are exactly the two points that define it.
function convertLine(item: ExtractedLine, pageMatrix: Matrix): LayoutLine {
  const p1 = applyMatrix(pageMatrix, { x: item.x1Pt, y: item.y1Pt });
  const p2 = applyMatrix(pageMatrix, { x: item.x2Pt, y: item.y2Pt });
  return { kind: 'line', x1Pt: p1.x, y1Pt: p1.y, x2Pt: p2.x, y2Pt: p2.y, color: item.color, widthPt: item.widthPt };
}

// Unlike convertRect, a general path carries no axis-aligned-only assumption, so every point of every subpath (start point, and each segment's own endpoint plus, for a cubic, both control points) is transformed individually through pageMatrix -- correct under rotation because an affine transform distributes over a Bezier curve's control points exactly as it does over a straight line's endpoints.
function transformSubpath(subpath: ExtractedSubpath, pageMatrix: Matrix): LayoutSubpath {
  const start = applyMatrix(pageMatrix, { x: subpath.startXPt, y: subpath.startYPt });
  const segments: LayoutPathSegment[] = subpath.segments.map((segment) => {
    if (segment.kind === 'line') {
      const p = applyMatrix(pageMatrix, { x: segment.xPt, y: segment.yPt });
      return { kind: 'line', xPt: p.x, yPt: p.y };
    }
    const c1 = applyMatrix(pageMatrix, { x: segment.c1xPt, y: segment.c1yPt });
    const c2 = applyMatrix(pageMatrix, { x: segment.c2xPt, y: segment.c2yPt });
    const p = applyMatrix(pageMatrix, { x: segment.xPt, y: segment.yPt });
    return { kind: 'cubic', c1xPt: c1.x, c1yPt: c1.y, c2xPt: c2.x, c2yPt: c2.y, xPt: p.x, yPt: p.y };
  });
  return { startXPt: start.x, startYPt: start.y, segments, closed: subpath.closed };
}

// fillRule is only kept when there's actually a fill to apply it to -- a stroke-only path's fillRule (always 'nonzero', see interpret.ts's paintFillRuleFor) is real but meaningless, so it's dropped here rather than round-tripped as noise, mirroring content-write.ts's own "fillRule only ever matters when fill is set" convention.
function convertPath(item: ExtractedPath, pageMatrix: Matrix): LayoutPath {
  return {
    kind: 'path',
    subpaths: item.subpaths.map((subpath) => transformSubpath(subpath, pageMatrix)),
    ...(item.fill !== undefined ? { fill: item.fill } : {}),
    ...(item.fill !== undefined && item.fillRule === 'evenodd' ? { fillRule: 'evenodd' as const } : {}),
    ...(item.stroke !== undefined ? { stroke: item.stroke } : {}),
  };
}

// The inverse of content-write.ts's writeImage: that function places the unit square via scale(w,h) x rotate(deg) x translate(x,y), so the composed CTM's own translation, scale, and rotation are exactly the placement this recovers -- x/y from the CTM's own e/f, width/height from its axis scales, rotation from its angle.
function imagePlacementFrom(matrix: Matrix): { xPt: number; yPt: number; widthPt: number; heightPt: number; rotationDeg: number | undefined } {
  const rotationDeg = matrixRotationDegrees(matrix);
  return { xPt: matrix[4], yPt: matrix[5], widthPt: matrixScaleX(matrix), heightPt: matrixScaleY(matrix), rotationDeg: rotationDeg !== 0 ? rotationDeg : undefined };
}

function registerExtractedImage(format: 'png' | 'jpeg', bytes: Uint8Array<ArrayBuffer>, widthPx: number, heightPx: number, images: Record<string, LayoutImageAsset>): string {
  const imageId = `img${crc32(bytes).toString(16)}`;
  if (!(imageId in images)) {
    images[imageId] = { format, base64: bytesToBase64(bytes), widthPx, heightPx };
  }
  return imageId;
}

function resolveCachedImageId(dict: PdfDict, raw: Uint8Array<ArrayBuffer>, images: Record<string, LayoutImageAsset>, cache: Map<PdfDict, string | null>, resolver: PdfObjectResolver, sink: PdfDiagnosticSink): string | undefined {
  if (cache.has(dict)) {
    return cache.get(dict) ?? undefined;
  }
  const decoded = readImageXObject(dict, raw, resolver, sink);
  if (decoded === undefined) {
    cache.set(dict, null);
    return undefined;
  }
  const imageId = registerExtractedImage(decoded.format, decoded.bytes, decoded.widthPx, decoded.heightPx, images);
  cache.set(dict, imageId);
  return imageId;
}

function convertImage(item: ExtractedImage, pageMatrix: Matrix, images: Record<string, LayoutImageAsset>, cache: Map<PdfDict, string | null>, resolver: PdfObjectResolver, sink: PdfDiagnosticSink) {
  const xobjects = resolver.resolveDict(dictGet(item.resources, 'XObject'));
  const xobj = xobjects !== undefined ? resolver.resolve(dictGet(xobjects, item.resourceName)) : undefined;
  if (xobj?.kind !== 'stream') {
    return undefined;
  }
  const imageId = resolveCachedImageId(xobj.dict, xobj.raw, images, cache, resolver, sink);
  if (imageId === undefined) {
    return undefined;
  }
  const composed = multiplyMatrices(item.matrix, pageMatrix);
  return { kind: 'image' as const, imageId, ...imagePlacementFrom(composed) };
}

function convertInlineImage(item: ExtractedInlineImage, pageMatrix: Matrix, images: Record<string, LayoutImageAsset>, resolver: PdfObjectResolver, sink: PdfDiagnosticSink) {
  const decoded = readImageXObject(item.dict, item.data, resolver, sink);
  if (decoded === undefined) {
    return undefined;
  }
  const imageId = registerExtractedImage(decoded.format, decoded.bytes, decoded.widthPx, decoded.heightPx, images);
  const composed = multiplyMatrices(item.matrix, pageMatrix);
  return { kind: 'image' as const, imageId, ...imagePlacementFrom(composed) };
}

// --- Link annotations: /Annots walk for /Subtype /Link with a /URI action -- the one annotation kind v1 recovers. ---

function readLinkAnnotations(page: PdfDict, pageMatrix: Matrix, resolver: PdfObjectResolver): LayoutLink[] {
  const annotsArr = asArray(dictGet(page, 'Annots'));
  if (annotsArr === undefined) {
    return [];
  }
  const links: LayoutLink[] = [];
  for (const annotRef of annotsArr) {
    const annot = resolver.resolveDict(annotRef);
    if (annot === undefined || asName(dictGet(annot, 'Subtype')) !== 'Link') {
      continue;
    }
    const uri = readLinkUri(annot, resolver);
    const rectArr = asArray(dictGet(annot, 'Rect'));
    if (uri === undefined || rectArr === undefined) {
      continue;
    }
    const x1 = asNumber(rectArr[0]) ?? 0;
    const y1 = asNumber(rectArr[1]) ?? 0;
    const x2 = asNumber(rectArr[2]) ?? 0;
    const y2 = asNumber(rectArr[3]) ?? 0;
    const p1 = applyMatrix(pageMatrix, { x: Math.min(x1, x2), y: Math.min(y1, y2) });
    const p2 = applyMatrix(pageMatrix, { x: Math.max(x1, x2), y: Math.max(y1, y2) });
    links.push({
      kind: 'link',
      uri,
      xPt: Math.min(p1.x, p2.x),
      yPt: Math.min(p1.y, p2.y),
      widthPt: Math.abs(p2.x - p1.x),
      heightPt: Math.abs(p2.y - p1.y),
    });
  }
  return links;
}

function readLinkUri(annot: PdfDict, resolver: PdfObjectResolver): string | undefined {
  const action = resolver.resolveDict(dictGet(annot, 'A'));
  if (action === undefined || asName(dictGet(action, 'S')) !== 'URI') {
    return undefined;
  }
  const uriObj = dictGet(action, 'URI');
  return uriObj?.kind === 'string' ? decodePdfString(uriObj.bytes) : undefined;
}

// pptx speaker notes carried as a hidden /Subtype /Text annotation (see write.ts's buildNotesAnnotDict) -- the /T marker distinguishes an annotation this package's own writer produced from a genuine sticky note a human or another tool left on the page, which would also be /Subtype /Text but authored by someone/something else. Returns undefined (not '') when no such annotation exists, so reconstructPresentation's own page.notes ?? '' fallback is the one place that decides what "no notes" means for a ContentSlide.
function readPageNotes(page: PdfDict, resolver: PdfObjectResolver): string | undefined {
  const annotsArr = asArray(dictGet(page, 'Annots'));
  if (annotsArr === undefined) {
    return undefined;
  }
  for (const annotRef of annotsArr) {
    const annot = resolver.resolveDict(annotRef);
    if (annot === undefined || asName(dictGet(annot, 'Subtype')) !== 'Text') {
      continue;
    }
    const titleObj = dictGet(annot, 'T');
    const title = titleObj?.kind === 'string' ? decodePdfString(titleObj.bytes) : undefined;
    if (title !== NOTES_ANNOTATION_AUTHOR) {
      continue;
    }
    const contentsObj = dictGet(annot, 'Contents');
    if (contentsObj?.kind === 'string') {
      return decodePdfString(contentsObj.bytes);
    }
  }
  return undefined;
}

// --- PDF string decoding and /Info metadata: our own writer always emits UTF-16BE-with-BOM (write.ts's textToPdfString); a third-party producer's plain-ASCII PDFDocEncoding is approximated as a direct byte-per-character (Latin-1-ish) decode, correct for the overwhelming common ASCII-only case. ---

export function decodePdfString(bytes: Uint8Array<ArrayBuffer>): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let out = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      out += String.fromCharCode(((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0));
    }
    return out;
  }
  return Array.from(bytes, (b) => String.fromCharCode(b)).join('');
}

// ISO 32000-1 7.9.4: "D:YYYYMMDDHHmmSSOHH'mm'" with every field after the year optional and O one of +/-/Z.
const PDF_DATE_PATTERN = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([+\-Z])?(\d{2})?'?(\d{2})?'?$/;

export function parsePdfDate(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const match = PDF_DATE_PATTERN.exec(raw);
  if (match === null) {
    return undefined;
  }
  const [, year, month = '01', day = '01', hour = '00', minute = '00', second = '00', tzSign, tzHour = '00', tzMinute = '00'] = match;
  const offset = tzSign === undefined || tzSign === 'Z' ? 'Z' : `${tzSign}${tzHour}:${tzMinute}`;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`;
}

function readMetadata(trailer: PdfDict, resolver: PdfObjectResolver): LayoutMetadata {
  const info = resolver.resolveDict(dictGet(trailer, 'Info'));
  if (info === undefined) {
    return {};
  }
  const stringField = (key: string): string | undefined => {
    const obj: PdfObject | undefined = dictGet(info, key);
    return obj?.kind === 'string' ? decodePdfString(obj.bytes) : undefined;
  };
  const keywordsRaw = stringField('Keywords');
  const keywords = keywordsRaw
    ?.split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
  return {
    title: stringField('Title'),
    author: stringField('Author'),
    subject: stringField('Subject'),
    keywords: keywords !== undefined && keywords.length > 0 ? keywords : undefined,
    creator: stringField('Creator'),
    producer: stringField('Producer'),
    createdIso: parsePdfDate(stringField('CreationDate')),
    modifiedIso: parsePdfDate(stringField('ModDate')),
  };
}
