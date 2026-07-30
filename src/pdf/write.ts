import { base64ToBytes } from 'ooxml.js';
import { deflate } from '../bytes/flate';
import { ByteWriter } from '../bytes/writer';
import { readJpegInfo } from '../image/jpeg-info';
import { decodePng } from '../image/png-decode';
import type { LayoutDocument, LayoutImageAsset, LayoutLink } from '../model/layout';
import type { FontMetrics, StandardFontName } from './afm-widths';
import { STANDARD_METRICS, widthOfCode } from './afm-widths';
import type { ContentWriteContext } from './content-write';
import { writeContentStream } from './content-write';
import { winAnsiGlyphName } from './encoding';
import { resolveStandardFont } from './fonts';
import { createStandardFontMeasurer } from './measure';
import type { PdfDict, PdfObject } from './objects';
import { pdfArray, pdfDict, pdfHexString, pdfName, pdfNum, pdfRef, pdfStream } from './objects';
import { throwIfAborted } from '../ports/abort';
import { writeObject } from './serialize';
import type { WinAnsiSubstitution } from './winansi';

// WinAnsiEncoding's assigned byte range starts at 32 (space, the first printable ASCII code) and this writer's fonts use exactly the encoding's full byte range up to 255.
const FIRST_CHAR = 32;
const LAST_CHAR = 255;

// The PDF spec requires /StemV on every FontDescriptor, but for a non-embedded standard-14 font every conforming reader already has this exact face's real metrics built in and never consults this value to render it -- these are nominal regular/bold values (heavier stroke weight for bold), included only to satisfy the spec's required-field rule.
const NOMINAL_STEM_V_REGULAR = 80;
const NOMINAL_STEM_V_BOLD = 120;

// FontDescriptor /Flags bit values (ISO 32000-1 Table 123).
const FLAG_FIXED_PITCH = 1;
const FLAG_SERIF = 2;
const FLAG_NONSYMBOLIC = 32;
const FLAG_ITALIC = 64;
const FLAG_FORCE_BOLD = 262144;

export interface WritePdfOptions {
  // Compresses content streams and PNG-sourced image data with FlateDecode. Defaults to true; false is an escape hatch for producing a human-auditable, uncompressed PDF (e.g. for a byte-golden test). JPEG-sourced images are embedded via DCTDecode regardless -- this option never touches them.
  readonly compress?: boolean;
  readonly signal?: AbortSignal;
  // Called once per WinAnsi character substitution made while emitting text (see src/pdf/winansi.ts). writePdf itself has no Diagnostic schema to translate these into -- a caller that wants diagnostics (e.g. the local DocumentConverter) supplies this and does the translation itself.
  readonly onSubstitution?: (substitution: WinAnsiSubstitution, context: { readonly pageIndex: number }) => void;
}

// PDF's UTF-16BE-with-BOM convention for text strings outside PDFDocEncoding's range (ISO 32000-1 7.9.2.2) -- JS strings are already UTF-16 internally, so this is a direct byte-pair re-encoding of each existing code unit (surrogate pairs included), not a decode/re-encode round trip.
function textToPdfString(text: string): PdfObject {
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes[0] = 0xfe;
  bytes[1] = 0xff;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    bytes[2 + i * 2] = (code >> 8) & 0xff;
    bytes[2 + i * 2 + 1] = code & 0xff;
  }
  return pdfHexString(bytes);
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

// PDF's date string convention (ISO 32000-1 7.9.4): "D:YYYYMMDDHHmmSS" plus a timezone suffix. Always formatted in UTC ("Z") regardless of host timezone, so output is deterministic and independent of where this code runs.
function formatPdfDate(iso: string): string {
  const date = new Date(iso);
  return `D:${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`;
}

function buildInfoDict(doc: LayoutDocument): PdfDict {
  const entries = new Map<string, PdfObject>();
  // Always this package's own identity, regardless of doc.metadata.producer (which describes whatever produced the *source* document this LayoutDocument came from, not this PDF) -- deliberately no version string, so byte-golden tests never need updating on a version bump.
  entries.set('Producer', textToPdfString('documents.js'));
  if (doc.metadata.title !== undefined) {
    entries.set('Title', textToPdfString(doc.metadata.title));
  }
  if (doc.metadata.author !== undefined) {
    entries.set('Author', textToPdfString(doc.metadata.author));
  }
  if (doc.metadata.subject !== undefined) {
    entries.set('Subject', textToPdfString(doc.metadata.subject));
  }
  if (doc.metadata.keywords !== undefined) {
    entries.set('Keywords', textToPdfString(doc.metadata.keywords.join(', ')));
  }
  if (doc.metadata.creator !== undefined) {
    entries.set('Creator', textToPdfString(doc.metadata.creator));
  }
  if (doc.metadata.createdIso !== undefined) {
    entries.set('CreationDate', textToPdfString(formatPdfDate(doc.metadata.createdIso)));
  }
  if (doc.metadata.modifiedIso !== undefined) {
    entries.set('ModDate', textToPdfString(formatPdfDate(doc.metadata.modifiedIso)));
  }
  return pdfDict(entries);
}

function computeFontFlags(standardName: StandardFontName, metrics: FontMetrics): number {
  let flags = FLAG_NONSYMBOLIC;
  if (standardName.startsWith('Courier')) {
    flags |= FLAG_FIXED_PITCH;
  }
  if (standardName.startsWith('Times')) {
    flags |= FLAG_SERIF;
  }
  if (metrics.italicAngle !== 0) {
    flags |= FLAG_ITALIC;
  }
  if (standardName.includes('Bold')) {
    flags |= FLAG_FORCE_BOLD;
  }
  return flags;
}

// The Widths array must cover FIRST_CHAR..LAST_CHAR without gaps. widthOfCode() throws for a code with no WinAnsi glyph mapping (a caller-invariant violation on the text-showing path, which is expected to sanitize first) -- but a handful of WinAnsi byte positions are simply unassigned by the encoding itself, and the Widths array still needs an entry for them. widthOfCode already special-cases fixed-width (Courier) faces before ever consulting the glyph name, so this only needs its own check for the proportional faces.
function widthForWidthsArray(standardName: StandardFontName, code: number): number {
  const metrics = STANDARD_METRICS[standardName];
  if (metrics.fixedWidth === undefined && winAnsiGlyphName(code) === undefined) {
    return 0;
  }
  return widthOfCode(standardName, code);
}

function buildFontObjects(standardName: StandardFontName, descriptorRef: PdfObject): { readonly font: PdfDict; readonly descriptor: PdfDict } {
  const metrics = STANDARD_METRICS[standardName];
  const widths: PdfObject[] = [];
  for (let code = FIRST_CHAR; code <= LAST_CHAR; code++) {
    widths.push(pdfNum(widthForWidthsArray(standardName, code)));
  }
  const font = pdfDict({
    Type: pdfName('Font'),
    Subtype: pdfName('Type1'),
    BaseFont: pdfName(standardName),
    Encoding: pdfName('WinAnsiEncoding'),
    FirstChar: pdfNum(FIRST_CHAR),
    LastChar: pdfNum(LAST_CHAR),
    Widths: pdfArray(widths),
    FontDescriptor: descriptorRef,
  });
  const descriptor = pdfDict({
    Type: pdfName('FontDescriptor'),
    FontName: pdfName(standardName),
    Flags: pdfNum(computeFontFlags(standardName, metrics)),
    FontBBox: pdfArray(metrics.fontBBox.map((n) => pdfNum(n))),
    ItalicAngle: pdfNum(metrics.italicAngle),
    Ascent: pdfNum(metrics.ascender),
    Descent: pdfNum(metrics.descender),
    CapHeight: pdfNum(metrics.capHeight),
    XHeight: pdfNum(metrics.xHeight),
    StemV: pdfNum(standardName.includes('Bold') ? NOMINAL_STEM_V_BOLD : NOMINAL_STEM_V_REGULAR),
  });
  return { font, descriptor };
}

interface PreparedImage {
  readonly dict: PdfDict; // /SMask, if any, is added in place once the SMask object number is known
  readonly raw: Uint8Array<ArrayBuffer>;
  readonly alpha?: { readonly dict: PdfDict; readonly raw: Uint8Array<ArrayBuffer> };
}

function prepareJpegImage(bytes: Uint8Array<ArrayBuffer>): PreparedImage {
  const info = readJpegInfo(bytes);
  const colorSpace = info.components === 1 ? 'DeviceGray' : info.components === 4 ? 'DeviceCMYK' : 'DeviceRGB';
  const entries = new Map<string, PdfObject>([
    ['Type', pdfName('XObject')],
    ['Subtype', pdfName('Image')],
    ['Width', pdfNum(info.width)],
    ['Height', pdfNum(info.height)],
    ['ColorSpace', pdfName(colorSpace)],
    ['BitsPerComponent', pdfNum(info.precision)],
    ['Filter', pdfName('DCTDecode')],
  ]);
  // A 4-component JPEG is CMYK data; Adobe's APP14 transform 2 (YCCK) or an untagged 4-component stream almost always needs this inversion to render with correct colours (see src/image/jpeg-info.ts's own note on adobeTransform) -- transform 0 explicitly means "CMYK as-is", no inversion.
  if (info.components === 4 && (info.adobeTransform === 2 || info.adobeTransform === undefined)) {
    entries.set('Decode', pdfArray([1, 0, 1, 0, 1, 0, 1, 0].map((n) => pdfNum(n))));
  }
  return { dict: pdfDict(entries), raw: bytes };
}

function pngImageDict(width: number, height: number, colorSpace: 'DeviceGray' | 'DeviceRGB', compress: boolean): PdfDict {
  const entries = new Map<string, PdfObject>([
    ['Type', pdfName('XObject')],
    ['Subtype', pdfName('Image')],
    ['Width', pdfNum(width)],
    ['Height', pdfNum(height)],
    ['ColorSpace', pdfName(colorSpace)],
    ['BitsPerComponent', pdfNum(8)],
  ]);
  if (compress) {
    entries.set('Filter', pdfName('FlateDecode'));
  }
  return pdfDict(entries);
}

function preparePngImage(bytes: Uint8Array<ArrayBuffer>, compress: boolean): PreparedImage {
  const raw = decodePng(bytes);
  const colorSpace = raw.channels === 1 ? 'DeviceGray' : 'DeviceRGB';
  const dict = pngImageDict(raw.width, raw.height, colorSpace, compress);
  const data = compress ? deflate(raw.data) : raw.data;
  const alpha =
    raw.alpha === undefined
      ? undefined
      : { dict: pngImageDict(raw.width, raw.height, 'DeviceGray', compress), raw: compress ? deflate(raw.alpha) : raw.alpha };
  return { dict, raw: data, alpha };
}

function prepareImage(asset: LayoutImageAsset, compress: boolean): PreparedImage {
  const bytes = base64ToBytes(asset.base64);
  return asset.format === 'jpeg' ? prepareJpegImage(bytes) : preparePngImage(bytes, compress);
}

function buildLinkAnnotDict(link: LayoutLink): PdfObject {
  return pdfDict({
    Type: pdfName('Annot'),
    Subtype: pdfName('Link'),
    Rect: pdfArray([link.xPt, link.yPt, link.xPt + link.widthPt, link.yPt + link.heightPt].map((n) => pdfNum(n))),
    Border: pdfArray([0, 0, 0].map((n) => pdfNum(n))), // zero-width: an invisible clickable region, not a drawn box
    A: pdfDict({ Type: pdfName('Action'), S: pdfName('URI'), URI: pdfHexString(new TextEncoder().encode(link.uri)) }),
  });
}

function isLinkItem(item: { readonly kind: string }): item is LayoutLink {
  return item.kind === 'link';
}

interface AllocatedObject {
  readonly num: number;
  readonly value: PdfObject;
}

// Writes a fixed 20-byte classic xref entry: 10-digit offset, space, 5-digit generation, space, 'n'/'f', space, LF -- exactly 10+1+5+1+1+1+1 = 20 bytes, one of the three EOL forms the spec permits (ISO 32000-1 7.5.4).
function xrefEntry(offset: number, generation: number, inUse: boolean): string {
  return `${offset.toString().padStart(10, '0')} ${generation.toString().padStart(5, '0')} ${inUse ? 'n' : 'f'} \n`;
}

// Assembles a LayoutDocument into a complete PDF file: the object graph (Catalog, Pages, Info, one Font+FontDescriptor pair per standard-14 face actually used, one Image XObject (+SMask) per image asset actually referenced, then each page's own Page dict, Contents stream, and optional Annots), a classic cross-reference table, and a trailer. Objects are allocated in this fixed order -- never derived from Map/object iteration order -- so identical input always produces byte-identical output (see the determinism tests).
export function writePdf(doc: LayoutDocument, options: WritePdfOptions = {}): Uint8Array<ArrayBuffer> {
  const compress = options.compress ?? true;
  const measurer = createStandardFontMeasurer();

  let nextObjNum = 1;
  const catalogNum = nextObjNum++;
  const pagesNum = nextObjNum++;
  const infoNum = nextObjNum++;

  const fontNames = new Set<StandardFontName>();
  const imageIds = new Set<string>();
  for (const page of doc.pages) {
    for (const item of page.items) {
      if (item.kind === 'text') {
        fontNames.add(resolveStandardFont(item.font.family, item.font.weight === 'bold', item.font.style === 'italic').standardName);
      } else if (item.kind === 'image') {
        imageIds.add(item.imageId);
      }
    }
  }

  const fontAllocs = new Map<StandardFontName, { readonly fontNum: number; readonly descNum: number; readonly resourceName: string }>();
  for (const [index, name] of [...fontNames].sort().entries()) {
    const fontNum = nextObjNum++;
    const descNum = nextObjNum++;
    fontAllocs.set(name, { fontNum, descNum, resourceName: `F${index + 1}` });
  }

  const imageAllocs = new Map<string, { readonly imageNum: number; readonly smaskNum: number | undefined; readonly resourceName: string; readonly prepared: PreparedImage }>();
  for (const [index, imageId] of [...imageIds].sort().entries()) {
    const asset = doc.images[imageId];
    if (asset === undefined) {
      throw new Error(`LayoutDocument references image "${imageId}" but it is not present in images`);
    }
    const prepared = prepareImage(asset, compress);
    const imageNum = nextObjNum++;
    const smaskNum = prepared.alpha === undefined ? undefined : nextObjNum++;
    imageAllocs.set(imageId, { imageNum, smaskNum, resourceName: `Im${index + 1}`, prepared });
  }

  const pageAllocs = doc.pages.map(() => ({ pageNum: nextObjNum++, contentsNum: nextObjNum++ }));

  const objects: AllocatedObject[] = [];
  objects.push({ num: catalogNum, value: pdfDict({ Type: pdfName('Catalog'), Pages: pdfRef(pagesNum, 0) }) });
  objects.push({
    num: pagesNum,
    value: pdfDict({
      Type: pdfName('Pages'),
      Kids: pdfArray(pageAllocs.map((p) => pdfRef(p.pageNum, 0))),
      Count: pdfNum(doc.pages.length),
    }),
  });
  objects.push({ num: infoNum, value: buildInfoDict(doc) });

  for (const [standardName, alloc] of fontAllocs) {
    const { font, descriptor } = buildFontObjects(standardName, pdfRef(alloc.descNum, 0));
    objects.push({ num: alloc.fontNum, value: font });
    objects.push({ num: alloc.descNum, value: descriptor });
  }

  for (const alloc of imageAllocs.values()) {
    if (alloc.smaskNum !== undefined && alloc.prepared.alpha !== undefined) {
      alloc.prepared.dict.entries.set('SMask', pdfRef(alloc.smaskNum, 0));
      objects.push({ num: alloc.smaskNum, value: pdfStream(alloc.prepared.alpha.dict, alloc.prepared.alpha.raw) });
    }
    objects.push({ num: alloc.imageNum, value: pdfStream(alloc.prepared.dict, alloc.prepared.raw) });
  }

  const resourceEntries = new Map<string, PdfObject>();
  if (fontAllocs.size > 0) {
    resourceEntries.set('Font', pdfDict(new Map([...fontAllocs.values()].map((alloc) => [alloc.resourceName, pdfRef(alloc.fontNum, 0)]))));
  }
  if (imageAllocs.size > 0) {
    resourceEntries.set('XObject', pdfDict(new Map([...imageAllocs.values()].map((alloc) => [alloc.resourceName, pdfRef(alloc.imageNum, 0)]))));
  }
  const resourcesDict = pdfDict(resourceEntries);

  const context: ContentWriteContext = {
    measurer,
    resolveFont: (font) => {
      const standardName = resolveStandardFont(font.family, font.weight === 'bold', font.style === 'italic').standardName;
      const alloc = fontAllocs.get(standardName);
      if (alloc === undefined) {
        throw new Error(`font "${standardName}" was not pre-allocated -- this is a writePdf internal invariant violation`);
      }
      return { resourceName: alloc.resourceName, standardName };
    },
    resolveImage: (imageId) => {
      const alloc = imageAllocs.get(imageId);
      if (alloc === undefined) {
        throw new Error(`image "${imageId}" was not pre-allocated -- this is a writePdf internal invariant violation`);
      }
      return { resourceName: alloc.resourceName };
    },
  };

  doc.pages.forEach((page, pageIndex) => {
    throwIfAborted(options.signal);
    const { pageNum, contentsNum } = pageAllocs[pageIndex]!;

    const { bytes: contentBytes, substitutions } = writeContentStream(page.items, context);
    for (const substitution of substitutions) {
      options.onSubstitution?.(substitution, { pageIndex });
    }

    const finalContentBytes = compress ? deflate(contentBytes) : contentBytes;
    const contentsDict = pdfDict(compress ? { Filter: pdfName('FlateDecode') } : {});
    objects.push({ num: contentsNum, value: pdfStream(contentsDict, finalContentBytes) });

    const annots = page.items.filter(isLinkItem).map((link) => buildLinkAnnotDict(link));

    const pageEntries = new Map<string, PdfObject>([
      ['Type', pdfName('Page')],
      ['Parent', pdfRef(pagesNum, 0)],
      ['MediaBox', pdfArray([0, 0, page.widthPt, page.heightPt].map((n) => pdfNum(n)))],
      ['Resources', resourcesDict],
      ['Contents', pdfRef(contentsNum, 0)],
    ]);
    if (annots.length > 0) {
      pageEntries.set('Annots', pdfArray(annots));
    }
    objects.push({ num: pageNum, value: pdfDict(pageEntries) });
  });

  const writer = new ByteWriter();
  writer.writeAscii('%PDF-1.7\n');
  const offsets = new Map<number, number>();
  for (const { num, value } of objects) {
    offsets.set(num, writer.length);
    writer.writeAscii(`${num} 0 obj\n`);
    writeObject(writer, value);
    writer.writeAscii('\nendobj\n');
  }

  const maxObjNum = nextObjNum - 1;
  const xrefOffset = writer.length;
  writer.writeAscii('xref\n');
  writer.writeAscii(`0 ${maxObjNum + 1}\n`);
  writer.writeAscii(xrefEntry(0, 65535, false));
  for (let num = 1; num <= maxObjNum; num++) {
    const offset = offsets.get(num);
    if (offset === undefined) {
      throw new Error(`object ${num} was allocated but never written -- this is a writePdf internal invariant violation`);
    }
    writer.writeAscii(xrefEntry(offset, 0, true));
  }

  writer.writeAscii('trailer\n');
  writeObject(writer, pdfDict({ Size: pdfNum(maxObjNum + 1), Root: pdfRef(catalogNum, 0), Info: pdfRef(infoNum, 0) }));
  writer.writeAscii('\nstartxref\n');
  writer.writeAscii(`${xrefOffset}\n`);
  writer.writeAscii('%%EOF');

  return writer.toBytes();
}
