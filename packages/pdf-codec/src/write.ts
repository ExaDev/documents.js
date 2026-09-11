import { base64ToBytes } from "./util/base64";
import { deflate } from "./bytes/flate";
import { ByteWriter, concatBytes } from "./bytes/writer";
import { ByteReader } from "./bytes/reader";
import { randomBytes } from "./crypto/random";
import type { PdfEncryptionOptions } from "./encrypt-write";
import {
  createStandardEncryptor,
  encryptIndirectObject,
} from "./encrypt-write";
import { readJpegInfo } from "./image/jpeg-info";
import { encodeCcittFax } from "./image/ccitt-encode";
import { decodePng } from "./image/png-decode";
import type { LayoutFont, PositionedFormula } from "document-schema.js";
import type {
  LayoutDestinationTarget,
  LayoutDocument,
  LayoutFormField,
  LayoutImageAsset,
  LayoutInternalLink,
  LayoutLink,
  LayoutOutlineItem,
  LayoutStructureElement,
} from "./layout";
import type { SourceResidue } from "document-schema.js";
import type { FontMetrics, StandardFontName } from "./afm-widths";
import { STANDARD_METRICS, widthOfCode } from "./afm-widths";
import type { ContentWriteContext } from "./content-write";
import { writeContentStream } from "./content-write";
import { parseValue } from "./parse";
import type { EmbeddedFace, EmbeddedFaceSubstitution } from "./embedded-font";
import { collectEmbeddedGlyphs } from "./embedded-font";
import { NOTES_ANNOTATION_AUTHOR } from "./notes-annotation-author";
import { buildEmbeddedFontObjects } from "./embedded-font-write";
import { winAnsiGlyphName } from "./encoding";
import type { FontRegistry } from "./font-registry";
import { resolveFaceWithRegistry } from "./font-registry";
import {
  collectUsedGlyphs,
  writeFormulaContentStream,
} from "./math-content-write";
import { loadMathFont } from "./math-font";
import { buildMathFontObjects } from "./math-font-write";
import { createFontMeasurer } from "./measure";
import type { PdfDict, PdfObject } from "./objects";
import {
  pdfArray,
  pdfBool,
  pdfDict,
  pdfHexString,
  pdfName,
  pdfNull,
  pdfNum,
  pdfRef,
  pdfLiteralString,
  pdfStream,
} from "./objects";
import { subsetSfnt } from "./sfnt-subset";
import { throwIfAborted } from "./util/abort";
import { writeObject } from "./serialize";
import type { WinAnsiSubstitution } from "./winansi";

// A formula's own glyph runs are shown through an embedded CID composite font via Identity-H 2-byte CIDs (see math-content-write.ts's own module comment) -- a fundamentally different content-stream shape from an ordinary LayoutText item's single-byte WinAnsi string, and one this package's own LayoutItem union (src/layout.ts) has no member for (LayoutFont only ever names one of the 14 standard PDF faces -- see document-schema.js's style.ts comment -- with no room for "this run uses an embedded, non-standard font resource" at all). A formula therefore cannot travel through LayoutDocument.pages[].items the way every other kind of content this writer draws does; WritePdfOptions.formulas is this module's own, local side channel for it instead, positioned entirely outside the LayoutDocument schema itself.
const MATH_FONT_RESOURCE_NAME = "MF";

// The /Resources/Font key prefix for an embedded text face, deliberately distinct from both the standard-14 faces' own 'F' prefix and the math font's 'MF': all three share one /Font dict, so a collision would silently make one font's resource name resolve to another's object.
const EMBEDDED_FONT_RESOURCE_PREFIX = "E";

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
  // Called once per WinAnsi character substitution made while emitting text (see src/pdf/winansi.ts). writePdf itself has no Diagnostic schema to translate these into -- a caller that wants diagnostics (e.g. the local DocumentConverter) supplies this and does the translation itself. Only ever raised for text drawn in a standard-14 face; an embedded face reports through onMissingGlyph below instead.
  readonly onSubstitution?: (
    substitution: WinAnsiSubstitution,
    context: { readonly pageIndex: number },
  ) => void;
  // Called once per character drawn as .notdef because the EMBEDDED face resolved for it (see `fonts`) has no glyph for that character. The embedded-face counterpart to onSubstitution, kept separate because nothing visible was substituted -- see ContentStreamResult.missingGlyphs for why inventing a WinAnsiSubstitution's own `to` here would be a worse report than an honest one with no replacement to name.
  readonly onMissingGlyph?: (
    missing: EmbeddedFaceSubstitution,
    context: { readonly pageIndex: number },
  ) => void;
  // Resolves each text item's own LayoutFont to a real embeddable face where one is available, falling through to the standard-14 mapping otherwise (see src/font-registry.ts for the full five-step order). Omitted -- the default -- every font resolves through resolveStandardFont exactly as it always has, no font program is embedded, and output is byte-identical to a build with no embedded-font support at all: a registry only ever changes anything for a caller that explicitly constructs one.
  readonly fonts?: FontRegistry;
  // Every embedded formula to draw (src/mathml's own MathBox, already positioned per page) -- see this module's own top-of-file comment for why a formula can't travel through doc.pages[].items itself. The embedded STIX Two Math composite font (one Type0/CIDFontType0/FontDescriptor/FontFile3/ToUnicode object group) is allocated once for the whole document, only when this array is non-empty, and shared across every page that references it -- the same "allocate once, reuse via /Resources" pattern this writer already uses for every standard-14 font and image asset.
  readonly formulas?: readonly PositionedFormula[];
  // Encrypts the written PDF with the standard security handler under one of encrypt-write.ts's four schemes (default: aes-256). Omitted -- the default -- no /Encrypt dictionary is written at all and output is byte-identical to a build with no encryption support; see encrypt-write.ts's own module comment for the write-side algorithms and README.md's Gotchas section for this feature's scope.
  readonly encryption?: PdfEncryptionOptions;
}

// A PDF file identifier (trailer /ID) is only ever written when encryption is requested -- an unencrypted document has never needed one from this writer, and adding it unconditionally would change every existing golden-byte test's output. 16 bytes matches the ID this writer's own qpdf-produced test fixtures carry (src/test-support/encrypted-pdfs.ts).
const FILE_ID_BYTES = 16;

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
  return n.toString().padStart(2, "0");
}

// PDF's date string convention (ISO 32000-1 7.9.4): "D:YYYYMMDDHHmmSS" plus a timezone suffix. Always formatted in UTC ("Z") regardless of host timezone, so output is deterministic and independent of where this code runs.
function formatPdfDate(iso: string): string {
  const date = new Date(iso);
  return `D:${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`;
}

function buildInfoDict(doc: LayoutDocument): PdfDict {
  const entries = new Map<string, PdfObject>();
  // Always this package's own identity, regardless of doc.metadata.producer (which describes whatever produced the *source* document this LayoutDocument came from, not this PDF) -- deliberately no version string, so byte-golden tests never need updating on a version bump.
  entries.set("Producer", textToPdfString("documents.js"));
  if (doc.metadata.title !== undefined) {
    entries.set("Title", textToPdfString(doc.metadata.title));
  }
  if (doc.metadata.author !== undefined) {
    entries.set("Author", textToPdfString(doc.metadata.author));
  }
  if (doc.metadata.subject !== undefined) {
    entries.set("Subject", textToPdfString(doc.metadata.subject));
  }
  if (doc.metadata.keywords !== undefined) {
    entries.set("Keywords", textToPdfString(doc.metadata.keywords.join(", ")));
  }
  if (doc.metadata.creator !== undefined) {
    entries.set("Creator", textToPdfString(doc.metadata.creator));
  }
  if (doc.metadata.createdIso !== undefined) {
    entries.set(
      "CreationDate",
      textToPdfString(formatPdfDate(doc.metadata.createdIso)),
    );
  }
  if (doc.metadata.modifiedIso !== undefined) {
    entries.set(
      "ModDate",
      textToPdfString(formatPdfDate(doc.metadata.modifiedIso)),
    );
  }
  return pdfDict(entries);
}

function computeFontFlags(
  standardName: StandardFontName,
  metrics: FontMetrics,
): number {
  let flags = FLAG_NONSYMBOLIC;
  if (standardName.startsWith("Courier")) {
    flags |= FLAG_FIXED_PITCH;
  }
  if (standardName.startsWith("Times")) {
    flags |= FLAG_SERIF;
  }
  if (metrics.italicAngle !== 0) {
    flags |= FLAG_ITALIC;
  }
  if (standardName.includes("Bold")) {
    flags |= FLAG_FORCE_BOLD;
  }
  return flags;
}

// The Widths array must cover FIRST_CHAR..LAST_CHAR without gaps. widthOfCode() throws for a code with no WinAnsi glyph mapping (a caller-invariant violation on the text-showing path, which is expected to sanitize first) -- but a handful of WinAnsi byte positions are simply unassigned by the encoding itself, and the Widths array still needs an entry for them. widthOfCode already special-cases fixed-width (Courier) faces before ever consulting the glyph name, so this only needs its own check for the proportional faces.
function widthForWidthsArray(
  standardName: StandardFontName,
  code: number,
): number {
  const metrics = STANDARD_METRICS[standardName];
  if (
    metrics.fixedWidth === undefined &&
    winAnsiGlyphName(code) === undefined
  ) {
    return 0;
  }
  return widthOfCode(standardName, code);
}

function buildFontObjects(
  standardName: StandardFontName,
  descriptorRef: PdfObject,
): { readonly font: PdfDict; readonly descriptor: PdfDict } {
  const metrics = STANDARD_METRICS[standardName];
  const widths: PdfObject[] = [];
  for (let code = FIRST_CHAR; code <= LAST_CHAR; code++) {
    widths.push(pdfNum(widthForWidthsArray(standardName, code)));
  }
  const font = pdfDict({
    Type: pdfName("Font"),
    Subtype: pdfName("Type1"),
    BaseFont: pdfName(standardName),
    Encoding: pdfName("WinAnsiEncoding"),
    FirstChar: pdfNum(FIRST_CHAR),
    LastChar: pdfNum(LAST_CHAR),
    Widths: pdfArray(widths),
    FontDescriptor: descriptorRef,
  });
  const descriptor = pdfDict({
    Type: pdfName("FontDescriptor"),
    FontName: pdfName(standardName),
    Flags: pdfNum(computeFontFlags(standardName, metrics)),
    FontBBox: pdfArray(metrics.fontBBox.map((n) => pdfNum(n))),
    ItalicAngle: pdfNum(metrics.italicAngle),
    Ascent: pdfNum(metrics.ascender),
    Descent: pdfNum(metrics.descender),
    CapHeight: pdfNum(metrics.capHeight),
    XHeight: pdfNum(metrics.xHeight),
    StemV: pdfNum(
      standardName.includes("Bold")
        ? NOMINAL_STEM_V_BOLD
        : NOMINAL_STEM_V_REGULAR,
    ),
  });
  return { font, descriptor };
}

interface PreparedImage {
  readonly dict: PdfDict; // /SMask, if any, is added in place once the SMask object number is known
  readonly raw: Uint8Array<ArrayBuffer>;
  readonly alpha?: {
    readonly dict: PdfDict;
    readonly raw: Uint8Array<ArrayBuffer>;
  };
}

function prepareJpegImage(bytes: Uint8Array<ArrayBuffer>): PreparedImage {
  const info = readJpegInfo(bytes);
  const colorSpace =
    info.components === 1
      ? "DeviceGray"
      : info.components === 4
        ? "DeviceCMYK"
        : "DeviceRGB";
  const entries = new Map<string, PdfObject>([
    ["Type", pdfName("XObject")],
    ["Subtype", pdfName("Image")],
    ["Width", pdfNum(info.width)],
    ["Height", pdfNum(info.height)],
    ["ColorSpace", pdfName(colorSpace)],
    ["BitsPerComponent", pdfNum(info.precision)],
    ["Filter", pdfName("DCTDecode")],
  ]);
  // A 4-component JPEG is CMYK data; Adobe's APP14 transform 2 (YCCK) or an untagged 4-component stream almost always needs this inversion to render with correct colours (see src/image/jpeg-info.ts's own note on adobeTransform) -- transform 0 explicitly means "CMYK as-is", no inversion.
  if (
    info.components === 4 &&
    (info.adobeTransform === 2 || info.adobeTransform === undefined)
  ) {
    entries.set(
      "Decode",
      pdfArray([1, 0, 1, 0, 1, 0, 1, 0].map((n) => pdfNum(n))),
    );
  }
  return { dict: pdfDict(entries), raw: bytes };
}

function pngImageDict(
  width: number,
  height: number,
  colorSpace: "DeviceGray" | "DeviceRGB",
  compress: boolean,
): PdfDict {
  const entries = new Map<string, PdfObject>([
    ["Type", pdfName("XObject")],
    ["Subtype", pdfName("Image")],
    ["Width", pdfNum(width)],
    ["Height", pdfNum(height)],
    ["ColorSpace", pdfName(colorSpace)],
    ["BitsPerComponent", pdfNum(8)],
  ]);
  if (compress) {
    entries.set("Filter", pdfName("FlateDecode"));
  }
  return pdfDict(entries);
}

// A bilevel (every sample 0 or 255) 8-bit grayscale decode re-packed to the 1-bit-per-pixel layout the CCITT encoder consumes: 255 -> 1 (white), 0 -> 0 (black), MSB first, rows padded to whole bytes. Undefined when any sample is intermediate -- a genuinely greyscale image has no G4 spelling and stays on the Flate path.
function packBilevel(raw: {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}): Uint8Array | undefined {
  const rowBytes = (raw.width + 7) >> 3;
  const packed = new Uint8Array(rowBytes * raw.height);
  for (let y = 0; y < raw.height; y++) {
    for (let x = 0; x < raw.width; x++) {
      const sample = raw.data[y * raw.width + x] ?? 0;
      if (sample !== 0 && sample !== 255) {
        return undefined;
      }
      if (sample === 255) {
        const index = y * rowBytes + (x >> 3);
        packed[index] = (packed[index] ?? 0) | (0x80 >> (x & 7));
      }
    }
  }
  return packed;
}

function preparePngImage(
  bytes: Uint8Array<ArrayBuffer>,
  compress: boolean,
): PreparedImage {
  const raw = decodePng(bytes);
  const colorSpace = raw.channels === 1 ? "DeviceGray" : "DeviceRGB";
  // A bilevel grayscale image with no soft mask is the exact shape CCITT Group 4 was built for (a fax or a 1-bit scan): when the G4 encoding comes out smaller than Flate over the same pixels -- which for real bilevel content it does by an order of magnitude -- the image is written as /CCITTFaxDecode with K -1, recovering the compression a scanned-document source originally carried instead of regressing it to Flate (#975). Whichever encoding is smaller wins, deterministically, so noise-heavy bilevel images where Flate happens to win keep it.
  if (compress && raw.channels === 1 && raw.alpha === undefined) {
    const bilevel = packBilevel(raw);
    if (bilevel !== undefined) {
      // Flate first, and G4 under Flate's own byte count as an abort budget: the moment the G4 stream grows past the size it is being compared against, it can no longer win and the encoder stops -- an adversarial bilevel image (a checkerboard, G4's worst case) otherwise makes the encoder emit a losing multi-megabyte candidate in full before the caller discards it.
      const flate = deflate(raw.data);
      const g4 = encodeCcittFax(bilevel, {
        columns: raw.width,
        rows: raw.height,
        maxBytes: flate.length,
      });
      if (g4 !== undefined) {
        return {
          dict: pdfDict(
            new Map<string, PdfObject>([
              ["Type", pdfName("XObject")],
              ["Subtype", pdfName("Image")],
              ["Width", pdfNum(raw.width)],
              ["Height", pdfNum(raw.height)],
              ["ColorSpace", pdfName("DeviceGray")],
              ["BitsPerComponent", pdfNum(1)],
              ["Filter", pdfName("CCITTFaxDecode")],
              [
                "DecodeParms",
                pdfDict(
                  new Map<string, PdfObject>([
                    ["K", pdfNum(-1)],
                    ["Columns", pdfNum(raw.width)],
                    ["Rows", pdfNum(raw.height)],
                    ["BlackIs1", pdfBool(false)],
                  ]),
                ),
              ],
            ]),
          ),
          raw: g4,
          alpha: undefined,
        };
      }
      return {
        dict: pngImageDict(raw.width, raw.height, colorSpace, true),
        raw: flate,
        alpha: undefined,
      };
    }
  }
  const dict = pngImageDict(raw.width, raw.height, colorSpace, compress);
  const data = compress ? deflate(raw.data) : raw.data;
  const alpha =
    raw.alpha === undefined
      ? undefined
      : {
          dict: pngImageDict(raw.width, raw.height, "DeviceGray", compress),
          raw: compress ? deflate(raw.alpha) : raw.alpha,
        };
  return { dict, raw: data, alpha };
}

// Verbatim re-embedding of a no-encoder filter's original stream (JBIG2, JPEG 2000): the asset's own decoded canonical never reaches the file at all -- these bytes are the compressed stream as the source carried it, re-emitted under the same filter, so a pdf-to-pdf round trip pays zero generation loss for exactly the two filters this package cannot re-encode. Width/Height still come from the asset (a viewer needs them whatever the stream says). A JBIG2 image is 1-bit /DeviceGray by construction (T.88's bitmap inverted into PDF's 0-is-black convention at decode), stated explicitly; a JPEG 2000 stream's component count and sample depth are the codestream's own to state (ISO 32000-1 7.4.9: /BitsPerComponent "shall not be present", /ColorSpace optional), so neither is written. /DecodeParms with the /JBIG2Globals reference is added in place at emission, once the globals stream's own object number is known -- the identical late-binding the SMask reference already uses. A source soft mask still re-emits: the decoded canonical's alpha is extracted through the ordinary PNG prepare path and rides along as a generated /SMask, since the original compressed stream does not encode it.
function preparePassthroughImage(
  asset: LayoutImageAsset,
  compress: boolean,
): PreparedImage {
  if (asset.original === undefined) {
    throw new Error(
      "preparePassthroughImage: asset carries no original stream",
    );
  }
  const png = preparePngImage(base64ToBytes(asset.base64), compress);
  const entries = new Map<string, PdfObject>([
    ["Type", pdfName("XObject")],
    ["Subtype", pdfName("Image")],
    ["Width", pdfNum(asset.widthPx)],
    ["Height", pdfNum(asset.heightPx)],
    [
      "Filter",
      pdfName(asset.original.filter === "jbig2" ? "JBIG2Decode" : "JPXDecode"),
    ],
  ]);
  if (asset.original.filter === "jbig2") {
    entries.set("ColorSpace", pdfName("DeviceGray"));
    entries.set("BitsPerComponent", pdfNum(1));
  }
  return {
    dict: pdfDict(entries),
    raw: base64ToBytes(asset.original.base64),
    ...(png.alpha !== undefined ? { alpha: png.alpha } : {}),
  };
}

function prepareImage(
  asset: LayoutImageAsset,
  compress: boolean,
): PreparedImage {
  if (asset.original !== undefined) {
    return preparePassthroughImage(asset, compress);
  }
  const bytes = base64ToBytes(asset.base64);
  return asset.format === "jpeg"
    ? prepareJpegImage(bytes)
    : preparePngImage(bytes, compress);
}

function buildLinkAnnotDict(link: LayoutLink): PdfObject {
  return pdfDict({
    Type: pdfName("Annot"),
    Subtype: pdfName("Link"),
    Rect: pdfArray(
      [
        link.xPt,
        link.yPt,
        link.xPt + link.widthPt,
        link.yPt + link.heightPt,
      ].map((n) => pdfNum(n)),
    ),
    Border: pdfArray([0, 0, 0].map((n) => pdfNum(n))), // zero-width: an invisible clickable region, not a drawn box
    A: pdfDict({
      Type: pdfName("Action"),
      S: pdfName("URI"),
      URI: pdfHexString(new TextEncoder().encode(link.uri)),
    }),
  });
}

// A display destination array's view half (ISO 32000-1 Table 151) -- the inverse of navigation.ts's parseDestination, spelling the target back as the direct array form so the written link needs no /Dests or /Names tree to resolve. Absent coordinates are null, exactly as a producer that omitted them would write.
function destinationViewArray(target: LayoutDestinationTarget): PdfObject[] {
  const n = (value: number | undefined): PdfObject =>
    value === undefined ? pdfNull() : pdfNum(value);
  if (target.kind === "xyz") {
    return [pdfName("XYZ"), n(target.leftPt), n(target.topPt), n(target.zoom)];
  }
  if (target.kind === "fitH") {
    return [pdfName("FitH"), n(target.topPt)];
  }
  if (target.kind === "fitV") {
    return [pdfName("FitV"), n(target.leftPt)];
  }
  if (target.kind === "fitR") {
    return [
      pdfName("FitR"),
      n(target.leftPt),
      n(target.bottomPt),
      n(target.rightPt),
      n(target.topPt),
    ];
  }
  if (target.kind === "fitBH") {
    return [pdfName("FitBH"), n(target.topPt)];
  }
  if (target.kind === "fitBV") {
    return [pdfName("FitBV"), n(target.leftPt)];
  }
  return [pdfName(target.kind === "fitB" ? "FitB" : "Fit")];
}

// The direct destination array a destinations-table NAME resolves to -- [pageRef, view] -- shared by internal links and outline items so the two can never spell the same target differently. The error message names the referer (what) so a caller violating the destinations-table invariant knows which construct tripped it.
function resolveDestinationArray(
  doc: LayoutDocument,
  pageAllocs: readonly { pageNum: number }[],
  name: string,
  what: string,
): PdfObject[] {
  const destination = doc.destinations?.find((d) => d.name === name);
  if (destination === undefined) {
    throw new Error(
      `${what} names destination "${name}", which the document's destinations table does not carry -- this is a caller-invariant violation`,
    );
  }
  const targetPage = pageAllocs[destination.pageIndex];
  if (targetPage === undefined) {
    throw new Error(
      `destination "${destination.name}" names page index ${destination.pageIndex}, which is beyond the document's own pages -- this is a caller-invariant violation`,
    );
  }
  return [
    pdfRef(targetPage.pageNum, 0),
    ...destinationViewArray(destination.target),
  ];
}

function buildInternalLinkAnnotDict(
  link: LayoutInternalLink,
  doc: LayoutDocument,
  pageAllocs: readonly { pageNum: number }[],
): PdfObject {
  return pdfDict({
    Type: pdfName("Annot"),
    Subtype: pdfName("Link"),
    Rect: pdfArray(
      [
        link.xPt,
        link.yPt,
        link.xPt + link.widthPt,
        link.yPt + link.heightPt,
      ].map((v) => pdfNum(v)),
    ),
    Border: pdfArray([0, 0, 0].map((v) => pdfNum(v))),
    Dest: pdfArray(
      resolveDestinationArray(
        doc,
        pageAllocs,
        link.destination,
        "internal link",
      ),
    ),
  });
}

function isLinkItem(item: { readonly kind: string }): item is LayoutLink {
  return item.kind === "link";
}

function isInternalLinkItem(item: {
  readonly kind: string;
}): item is LayoutInternalLink {
  return item.kind === "internalLink";
}

// PDF has no native concept of hidden presenter notes, but it does have a standard construct for "a note attached to a page that isn't part of the page's visible content": a /Subtype /Text annotation (the same one Acrobat's own sticky-note tool creates), with the Hidden annotation flag (ISO 32000-1 Table 165, bit position 2, value 2 -- "do not display the annotation... regardless of its annotation flags... in any way") set so it never renders or prints. This is how pptx speaker notes survive pptxToPdf -> pdfToPptx: reusing a real, standard PDF construct that generic PDF tooling already knows to preserve in an Annots array, rather than a bespoke private dictionary key nothing else would recognise. /T marks authorship so read.ts's readPageNotes only ever treats an annotation genuinely written by this function as recovered notes, not a real sticky note a human or another tool happened to leave on the page.
const NOTES_ANNOTATION_HIDDEN_FLAG = 2;

function buildNotesAnnotDict(notes: string): PdfObject {
  return pdfDict({
    Type: pdfName("Annot"),
    Subtype: pdfName("Text"),
    Rect: pdfArray([0, 0, 0, 0].map((n) => pdfNum(n))),
    Contents: textToPdfString(notes),
    T: textToPdfString(NOTES_ANNOTATION_AUTHOR),
    F: pdfNum(NOTES_ANNOTATION_HIDDEN_FLAG),
  });
}

interface AllocatedObject {
  readonly num: number;
  readonly value: PdfObject;
}

// Writes a fixed 20-byte classic xref entry: 10-digit offset, space, 5-digit generation, space, 'n'/'f', space, LF -- exactly 10+1+5+1+1+1+1 = 20 bytes, one of the three EOL forms the spec permits (ISO 32000-1 7.5.4).
function xrefEntry(offset: number, generation: number, inUse: boolean): string {
  return `${offset.toString().padStart(10, "0")} ${generation.toString().padStart(5, "0")} ${inUse ? "n" : "f"} \n`;
}

// #967 residue parse-back: the inverse of serializeObjectToText the read side's readDocumentResidue used to quarantine each row. One object from the row's text through the ordinary lexer/parser; a row that does not parse at all restores as nothing (skip, never throw -- residue is opacity, not data this writer depends on).
function parseResidueRow(residue: SourceResidue): PdfObject | undefined {
  const reader = new ByteReader(new TextEncoder().encode(residue.xml));
  const ignored: unknown[] = [];
  return parseValue(reader, () => {
    // Parse diagnostics here describe the SOURCE producer's serialisation, not this writer's output -- nothing downstream can act on them, so they are collected and dropped rather than surfaced.
    void ignored;
  });
}

// True when the parsed object names an indirect object anywhere inside -- the marker that the row is tied to the source file's own object graph and cannot be restorable in this one.
function objectContainsReference(obj: PdfObject): boolean {
  if (obj.kind === "ref") {
    return true;
  }
  if (obj.kind === "array") {
    return obj.items.some(objectContainsReference);
  }
  if (obj.kind === "dict") {
    return [...obj.entries.values()].some(objectContainsReference);
  }
  if (obj.kind === "stream") {
    return [...obj.dict.entries.values()].some(objectContainsReference);
  }
  return false;
}

// One residue row restored, or undefined when absent, unparseable, or reference-carrying.
function restoreResidueRow(
  source: Record<string, SourceResidue> | undefined,
  key: string,
): PdfObject | undefined {
  const row = source?.[key];
  if (row === undefined) {
    return undefined;
  }
  const parsed = parseResidueRow(row);
  if (parsed === undefined || objectContainsReference(parsed)) {
    return undefined;
  }
  return parsed;
}

// Assembles a LayoutDocument into a complete PDF file: the object graph (Catalog, Pages, Info, one Font+FontDescriptor pair per standard-14 face actually used, one Image XObject (+SMask) per image asset actually referenced, one embedded math composite font group when options.formulas is non-empty (Type0/CIDFontType0/FontDescriptor/FontFile3/ToUnicode -- see math-font-write.ts), one embedded text font group per subsetted face when options.fonts resolved any (Type0/CIDFontType2/FontDescriptor/FontFile2/ToUnicode -- see embedded-font-write.ts), then each page's own Page dict, Contents stream (ordinary LayoutItem bytes followed by that page's own formula bytes, if any -- see math-content-write.ts), and optional Annots), a classic cross-reference table, and a trailer. Objects are allocated in this fixed order -- never derived from Map/object iteration order -- so identical input always produces byte-identical output (see the determinism tests).
//
// Without options.fonts, no embedded text face can exist, so that group consumes no object numbers and every other object is numbered exactly as it was before embedded-font support: output is byte-identical to a build with none of it (proved by the golden digests in write-embedded-font.test.ts).
export function writePdf(
  doc: LayoutDocument,
  options: WritePdfOptions = {},
): Uint8Array<ArrayBuffer> {
  const compress = options.compress ?? true;
  const registry = options.fonts;
  const measurer = createFontMeasurer(registry);
  // The measurer's own vertical-metric policy (see measure.ts's VerticalMetricPolicy) is deliberately not exposed as a WritePdfOptions field: nothing on this write path consults lineHeightAtSize/ascenderAtSize/descenderAtSize at all. Pagination and line breaking already happened in whichever layout engine produced this LayoutDocument, against its own measurer; the only measurements writePdf itself makes are horizontalScaleFor and (for a standard-14 face) underlineAtSize, neither of which the policy touches.

  let nextObjNum = 1;
  const catalogNum = nextObjNum++;
  const pagesNum = nextObjNum++;
  const infoNum = nextObjNum++;

  const fontNames = new Set<StandardFontName>();
  const imageIds = new Set<string>();
  // Keyed by the EmbeddedFace object itself rather than by family name: a FontRegistry memoises one face per (family, bold, italic), so two LayoutFonts that resolve to the same real font program (Calibri and Calibri Light both substituting to Carlito Regular, say) arrive here as the identical object and correctly share one embedded font group, while two genuinely different programs never collide however similarly they are named.
  const embeddedUses = new Map<
    EmbeddedFace,
    { readonly texts: string[]; readonly codePoints: Set<number> }
  >();
  for (const page of doc.pages) {
    for (const item of page.items) {
      if (item.kind === "text") {
        const resolved = resolveFaceWithRegistry(registry, item.font);
        if (resolved.kind === "embedded") {
          const use = embeddedUses.get(resolved.face) ?? {
            texts: [],
            codePoints: new Set<number>(),
          };
          use.texts.push(item.text);
          for (const character of item.text) {
            use.codePoints.add(character.codePointAt(0)!);
          }
          embeddedUses.set(resolved.face, use);
        } else {
          fontNames.add(resolved.standardName);
        }
      } else if (item.kind === "image") {
        imageIds.add(item.imageId);
      }
    }
  }

  const fontAllocs = new Map<
    StandardFontName,
    {
      readonly fontNum: number;
      readonly descNum: number;
      readonly resourceName: string;
    }
  >();
  for (const [index, name] of [...fontNames].sort().entries()) {
    const fontNum = nextObjNum++;
    const descNum = nextObjNum++;
    fontAllocs.set(name, { fontNum, descNum, resourceName: `F${index + 1}` });
  }

  const imageAllocs = new Map<
    string,
    {
      readonly imageNum: number;
      readonly smaskNum: number | undefined;
      readonly globalsNum: number | undefined;
      readonly globalsBase64: string | undefined;
      readonly resourceName: string;
      readonly prepared: PreparedImage;
    }
  >();
  for (const [index, imageId] of [...imageIds].sort().entries()) {
    const asset = doc.images[imageId];
    if (asset === undefined) {
      throw new Error(
        `LayoutDocument references image "${imageId}" but it is not present in images`,
      );
    }
    const prepared = prepareImage(asset, compress);
    const imageNum = nextObjNum++;
    const smaskNum = prepared.alpha === undefined ? undefined : nextObjNum++;
    const globalsBase64 =
      asset.original?.filter === "jbig2"
        ? asset.original.jbig2GlobalsBase64
        : undefined;
    const globalsNum = globalsBase64 !== undefined ? nextObjNum++ : undefined;
    imageAllocs.set(imageId, {
      imageNum,
      smaskNum,
      globalsNum,
      globalsBase64,
      resourceName: `Im${index + 1}`,
      prepared,
    });
  }

  const formulas = options.formulas ?? [];
  const mathFontAlloc =
    formulas.length === 0
      ? undefined
      : {
          type0Num: nextObjNum++,
          cidFontNum: nextObjNum++,
          descriptorNum: nextObjNum++,
          fontFileNum: nextObjNum++,
          toUnicodeNum: nextObjNum++,
          resourceName: MATH_FONT_RESOURCE_NAME,
        };

  // One five-object group per used embedded face, allocated in the same fixed order the math font's own group uses (Type0, descendant CIDFont, FontDescriptor, FontFile2, ToUnicode). Sorted by PostScript name so object numbering never depends on the order faces happened to be encountered in the page items; Array.prototype.sort is stable, so two distinct faces sharing one PostScript name keep first-encountered order and the ordering stays total. With no registry supplied this map is empty, no object number is consumed, and every allocation after this point is numbered exactly as it was before embedded fonts existed.
  const embeddedAllocs = new Map<
    EmbeddedFace,
    {
      readonly type0Num: number;
      readonly cidFontNum: number;
      readonly descriptorNum: number;
      readonly fontFileNum: number;
      readonly toUnicodeNum: number;
      readonly resourceName: string;
      readonly texts: readonly string[];
      readonly codePoints: ReadonlySet<number>;
    }
  >();
  const sortedEmbeddedUses = [...embeddedUses.entries()].sort(([a], [b]) =>
    a.postScriptName < b.postScriptName
      ? -1
      : a.postScriptName > b.postScriptName
        ? 1
        : 0,
  );
  for (const [index, [face, use]] of sortedEmbeddedUses.entries()) {
    embeddedAllocs.set(face, {
      type0Num: nextObjNum++,
      cidFontNum: nextObjNum++,
      descriptorNum: nextObjNum++,
      fontFileNum: nextObjNum++,
      toUnicodeNum: nextObjNum++,
      resourceName: `${EMBEDDED_FONT_RESOURCE_PREFIX}${index + 1}`,
      texts: use.texts,
      codePoints: use.codePoints,
    });
  }

  const pageAllocs = doc.pages.map(() => ({
    pageNum: nextObjNum++,
    contentsNum: nextObjNum++,
  }));

  const encryptDictNum =
    options.encryption === undefined ? undefined : nextObjNum++;

  // #967: the read side's embedded-file attachments (#721) write back as a /Names /EmbeddedFiles tree -- one /EmbeddedFile stream plus one /Filespec per attachment, the name-tree node listing them all, and a /Names entry on the Catalog. Allocation happens here, in document order, so the fixed-order determinism this writer is built around holds for attachments exactly as it does for fonts and images.
  const attachmentAllocs = (doc.attachments ?? []).map(() => ({
    fileNum: nextObjNum++,
    specNum: nextObjNum++,
  }));
  const attachmentsNamesNum =
    attachmentAllocs.length > 0 ? nextObjNum++ : undefined;

  // #967: the outline. One /Outlines root plus one item dict per bookmark node, allocated in the same pre-order walk that emits them, so sibling order and /Next chains are stable.
  const outlineRootNum =
    (doc.outline ?? []).length > 0 ? nextObjNum++ : undefined;
  const outlineItemNums: number[] = [];
  if (outlineRootNum !== undefined) {
    const countItems = (items: readonly LayoutOutlineItem[]): number => {
      let n = 0;
      for (const item of items) {
        n += 1 + countItems(item.children);
      }
      return n;
    };
    for (let i = 0; i < countItems(doc.outline ?? []); i += 1) {
      outlineItemNums.push(nextObjNum++);
    }
  }

  // #967: optional-content layers. One OCG object per layer, in doc.layers order, so the /OCProperties lists stay stable under the fixed-order determinism rule.
  const layerNumByName = new Map<string, number>();
  for (const layer of doc.layers ?? []) {
    layerNumByName.set(layer.name, nextObjNum++);
  }

  // #967: the AcroForm field tree. One object per field (terminal or group); a terminal field with more than one widget spends one further object per WIDGET (each is a separate /Subtype /Widget kid and must be an indirect object of its own, because a page's /Annots array references the same annotation object the field's /Kids does — the spelling Acrobat's own files carry, per ISO 32000-1 12.5.1's rule that an annotation appears in the /Annots array of exactly the one page it is associated with). A single-widget field still merges the widget into the field dict itself — the merged-field/widget spelling the reader's own comment names — with that one dict serving as its page's /Annots entry.
  const formObjectNums: number[] = [];
  const countFieldObjects = (fields: readonly LayoutFormField[]): number => {
    let n = 0;
    for (const field of fields) {
      n +=
        1 +
        (field.fieldType !== "group" && field.widgets.length > 1
          ? field.widgets.length
          : 0) +
        countFieldObjects(field.children);
    }
    return n;
  };
  for (let i = 0; i < countFieldObjects(doc.form ?? []); i += 1) {
    formObjectNums.push(nextObjNum++);
  }
  const formNumByField = new Map<LayoutFormField, number>();
  const formExtraWidgetNums = new Map<LayoutFormField, number[]>();
  let formNumCursor = 0;
  const claimFormNums = (fields: readonly LayoutFormField[]): void => {
    for (const field of fields) {
      formNumByField.set(field, formObjectNums[formNumCursor++]!);
      if (field.fieldType !== "group" && field.widgets.length > 1) {
        formExtraWidgetNums.set(
          field,
          field.widgets.map(() => formObjectNums[formNumCursor++]!),
        );
      }
      claimFormNums(field.children);
    }
  };
  claimFormNums(doc.form ?? []);
  const formNumOf = (field: LayoutFormField): number => {
    const num = formNumByField.get(field);
    if (num === undefined) {
      throw new Error(
        "AcroForm field object number was not claimed -- this is a writePdf internal invariant violation",
      );
    }
    return num;
  };

  // #967: the tagged structure tree. One object per element plus one for the /ParentTree number tree; element ids map to their object numbers in the same document-order walk that emits them.
  const structElementNumById = new Map<string, number>();
  const countElements = (
    elements: readonly LayoutStructureElement[],
  ): number => {
    let n = 0;
    for (const element of elements) {
      structElementNumById.set(element.id, nextObjNum++);
      n += 1 + countElements(element.children);
    }
    return n;
  };
  const structElementCount = countElements(doc.structure ?? []);
  const structRootNum = structElementCount > 0 ? nextObjNum++ : undefined;
  const structParentTreeNum = structElementCount > 0 ? nextObjNum++ : undefined;

  // #967: package-level residue. The XMP packet is the one row needing an object of its own (a /Metadata stream); every other restored row lands inline on the Catalog or the trailer, so no allocation.
  const residueXmpNum =
    doc.source?.xmp !== undefined ? nextObjNum++ : undefined;

  const objects: AllocatedObject[] = [];
  const catalogEntries: [string, PdfObject][] = [
    ["Type", pdfName("Catalog")],
    ["Pages", pdfRef(pagesNum, 0)],
  ];
  if (attachmentsNamesNum !== undefined) {
    catalogEntries.push(["Names", pdfRef(attachmentsNamesNum, 0)]);
  }
  if (outlineRootNum !== undefined) {
    catalogEntries.push(["Outlines", pdfRef(outlineRootNum, 0)]);
  }
  if (layerNumByName.size > 0) {
    const ocgRefs = [...layerNumByName.values()].map((num) => pdfRef(num, 0));
    const visible: PdfObject[] = [];
    const hidden: PdfObject[] = [];
    for (const layer of doc.layers ?? []) {
      const num = layerNumByName.get(layer.name)!;
      (layer.visible ? visible : hidden).push(pdfRef(num, 0));
    }
    // No /BaseState: the default is ON (the reader's own default), with each layer spelled explicitly into /ON or /OFF so its recovered state is exactly the model's, never an implicit default.
    const defaultConfigEntries: [string, PdfObject][] = [];
    if (visible.length > 0)
      defaultConfigEntries.push(["ON", pdfArray(visible)]);
    if (hidden.length > 0) defaultConfigEntries.push(["OFF", pdfArray(hidden)]);
    catalogEntries.push([
      "OCProperties",
      pdfDict({
        OCGs: pdfArray(ocgRefs),
        D: pdfDict(Object.fromEntries(defaultConfigEntries)),
      }),
    ]);
  }
  if (doc.form !== undefined && doc.form.length > 0) {
    catalogEntries.push([
      "AcroForm",
      pdfDict({
        Fields: pdfArray(doc.form.map((field) => pdfRef(formNumOf(field), 0))),
      }),
    ]);
  }
  if (structRootNum !== undefined) {
    catalogEntries.push(["StructTreeRoot", pdfRef(structRootNum, 0)]);
  }
  if (residueXmpNum !== undefined) {
    catalogEntries.push(["Metadata", pdfRef(residueXmpNum, 0)]);
  }
  // The restorable residue rows: each is re-parsed from its own serialised text back into a PdfObject and emitted inline under its original Catalog key (the trailer /ID is held for the trailer block below). A row whose parse names an indirect object of the SOURCE file cannot be restorable -- its "N 0 R" targets an object number that need not exist in this file -- so it is skipped rather than emitted as a dangling reference. The XMP packet (a standalone XML stream, never a reference-carrier) is restored as a /Metadata stream object; the page-boxes row is deliberately not restored at all -- it records the SOURCE file's page geometry, which this writer states itself from each page's own dimensions. The open-action row is deliberately not restored either: /OpenAction is ACTIVE content (an inline JavaScript, Launch, or URI action a viewer executes on open), and restoring it verbatim from an attacker-supplied source would re-arm that behaviour in the rewritten file -- an inert-destination allowlist is not worth the risk surface when the writer's own destinations and outline already carry navigation.
  const trailerIdRestore = restoreResidueRow(doc.source, "trailer-id");
  for (const [rowKey, catalogKey] of [
    ["viewer-preferences", "ViewerPreferences"],
    ["page-mode", "PageMode"],
    ["page-layout", "PageLayout"],
    ["output-intents", "OutputIntents"],
    ["piece-info", "PieceInfo"],
    ["legal", "Legal"],
    ["collection", "Collection"],
  ] as const) {
    const restored = restoreResidueRow(doc.source, rowKey);
    if (restored !== undefined) {
      catalogEntries.push([catalogKey, restored]);
    }
  }
  objects.push({
    num: catalogNum,
    value: pdfDict(Object.fromEntries(catalogEntries)),
  });
  objects.push({
    num: pagesNum,
    value: pdfDict({
      Type: pdfName("Pages"),
      Kids: pdfArray(pageAllocs.map((p) => pdfRef(p.pageNum, 0))),
      Count: pdfNum(doc.pages.length),
    }),
  });
  objects.push({ num: infoNum, value: buildInfoDict(doc) });

  for (const [index, attachment] of (doc.attachments ?? []).entries()) {
    const alloc = attachmentAllocs[index]!;
    // The embedded file stream: /Subtype carries the MIME type when the read side recovered one, spelled as the MIME value itself (the spec's own example uses "application/pdf" this way; a bare "text/plain" is equally legal).
    const fileEntries: [string, PdfObject][] = [
      ["Type", pdfName("EmbeddedFile")],
    ];
    if (attachment.mimeType !== undefined) {
      fileEntries.push(["Subtype", pdfName(attachment.mimeType)]);
    }
    objects.push({
      num: alloc.fileNum,
      value: pdfStream(
        pdfDict(Object.fromEntries(fileEntries)),
        base64ToBytes(attachment.base64),
      ),
    });
    // The filespec names the stream it wraps: /F is the file's own name, /Desc the human description, /EF the embedded-file reference itself. /UF is deliberately absent: this writer produces no Unicode file names to mirror, and a redundant /UF identical to /F resolves nothing a bare /F would not.
    const specEntries: [string, PdfObject][] = [
      ["Type", pdfName("Filespec")],
      ["F", pdfLiteralString(new TextEncoder().encode(attachment.name))],
      ["EF", pdfDict({ F: pdfRef(alloc.fileNum, 0) })],
    ];
    if (attachment.description !== undefined) {
      specEntries.push([
        "Desc",
        pdfLiteralString(new TextEncoder().encode(attachment.description)),
      ]);
    }
    objects.push({
      num: alloc.specNum,
      value: pdfDict(Object.fromEntries(specEntries)),
    });
  }
  if (attachmentsNamesNum !== undefined) {
    // The name-tree node: a flat /Names array of (name, filespec ref) pairs, the tree's own single-node shape -- small attachment sets need no intermediate kids, and a writer that always produces one node keeps output deterministic.
    const names: PdfObject[] = [];
    for (const [index, attachment] of (doc.attachments ?? []).entries()) {
      names.push(pdfLiteralString(new TextEncoder().encode(attachment.name)));
      names.push(pdfRef(attachmentAllocs[index]!.specNum, 0));
    }
    objects.push({
      num: attachmentsNamesNum,
      value: pdfDict({
        // The /Names dict the Catalog references holds ONE child, /EmbeddedFiles, whose own /Names array is the flat name tree -- the identical shape readAttachments walks (resolve catalog /Names, take its /EmbeddedFiles, walk that node's /Names) and the shape every real producer writes.
        EmbeddedFiles: pdfDict({ Names: pdfArray(names) }),
      }),
    });
  }

  if (outlineRootNum !== undefined && (doc.outline ?? []).length > 0) {
    // One shared pre-order cursor across the whole walk: allocation reserved every item's number by pre-order count, so emission must consume them in exactly that order -- a per-level cursor would hand children numbers already used by earlier siblings.
    let itemCursor = 0;
    const emitItems = (
      items: readonly LayoutOutlineItem[],
      parentNum: number,
    ): number[] => {
      const siblingNums: number[] = [];
      let prevNum: number | undefined;
      for (const item of items) {
        const ownNum = outlineItemNums[itemCursor]!;
        itemCursor += 1;
        siblingNums.push(ownNum);
        // Children are allocated contiguously AFTER this whole sibling run was pre-counted, so the recursive call consumes the remaining tail of the same pre-allocated run -- the counts were reserved by the identical pre-order walk at allocation time, keeping object numbering deterministic.
        const childNums = emitItems(item.children, ownNum);
        const entries: [string, PdfObject][] = [
          ["Title", pdfLiteralString(new TextEncoder().encode(item.title))],
          ["Parent", pdfRef(parentNum, 0)],
        ];
        if (item.destination !== undefined) {
          entries.push([
            "Dest",
            pdfArray(
              resolveDestinationArray(
                doc,
                pageAllocs,
                item.destination,
                `outline item "${item.title}"`,
              ),
            ),
          ]);
        }
        if (prevNum !== undefined) {
          entries.push(["Prev", pdfRef(prevNum, 0)]);
        }
        if (siblingNums.length < items.length) {
          entries.push(["Next", pdfRef(outlineItemNums[itemCursor]!, 0)]);
        }
        if (childNums.length > 0) {
          entries.push(["First", pdfRef(childNums[0]!, 0)]);
          entries.push(["Last", pdfRef(childNums[childNums.length - 1]!, 0)]);
          // Every child is an open descendant: /Count states them all positively, the Acrobat-default outline state, so a reader re-presenting this document shows the tree expanded exactly as the LayoutDocument modelled it (the flat model has no "collapsed" fact to preserve).
          entries.push(["Count", pdfNum(childNums.length)]);
        }
        objects.push({
          num: ownNum,
          value: pdfDict(Object.fromEntries(entries)),
        });
        prevNum = ownNum;
      }
      return siblingNums;
    };
    const topLevelNums = emitItems(doc.outline ?? [], outlineRootNum);
    objects.push({
      num: outlineRootNum,
      value: pdfDict({
        Type: pdfName("Outlines"),
        First: pdfRef(topLevelNums[0]!, 0),
        Last: pdfRef(topLevelNums[topLevelNums.length - 1]!, 0),
      }),
    });
  }

  // #967: optional-content groups. /Name as a text string exactly as the reader's own decodePdfString expects; visibility is stated only through the /OCProperties /D /ON and /OFF lists (no /BaseState), so a reader recovers each layer's state from the list it names, never from an implicit default.
  for (const layer of doc.layers ?? []) {
    const num = layerNumByName.get(layer.name)!;
    objects.push({
      num,
      value: pdfDict({
        Type: pdfName("OCG"),
        Name: pdfLiteralString(new TextEncoder().encode(layer.name)),
      }),
    });
  }

  // #967: the AcroForm field tree. A terminal field's FIRST widget merges into the field dict itself (/Subtype /Widget /Rect /P alongside /FT and friends) when it is the field's only one; a multi-widget field keeps every widget as a separate widget-kid object under /Kids, each also referenced from its page's /Annots. A group is a bare /T + /Kids node. Fully-qualified names decompose back into the /T chain: a root field carries its whole name, a nested field carries the segment beyond its parent's, exactly the join the reader re-applies (ISO 32000-1 12.7.3.2). Each widget's page /Annots entry, gathered during emission in field order: the merged field dict itself for a single-widget field (it IS the annotation), the widget kid object for the others. A viewer that renders only page-level /Annots — and the spec's own presentation model points it there (ISO 32000-1 12.5.1) — sees every widget without knowing the AcroForm tree at all.
  const widgetAnnotsByPage = new Map<number, PdfObject[]>();
  const noteWidgetAnnot = (
    widget: LayoutFormField["widgets"][number],
    ref: PdfObject,
  ): void => {
    const existing = widgetAnnotsByPage.get(widget.pageIndex);
    if (existing === undefined) {
      widgetAnnotsByPage.set(widget.pageIndex, [ref]);
    } else {
      existing.push(ref);
    }
  };
  const widgetRectArray = (
    widget: LayoutFormField["widgets"][number],
  ): PdfObject =>
    pdfArray(
      [
        widget.xPt,
        widget.yPt,
        widget.xPt + widget.widthPt,
        widget.yPt + widget.heightPt,
      ].map((n) => pdfNum(n)),
    );
  const widgetDict = (widget: LayoutFormField["widgets"][number]): PdfDict =>
    pdfDict({
      Subtype: pdfName("Widget"),
      Rect: widgetRectArray(widget),
      P: pdfRef(pageAllocs[widget.pageIndex]!.pageNum, 0),
    });
  const FIELD_TYPE_PDF_NAME: Record<
    Exclude<LayoutFormField["fieldType"], "group">,
    string
  > = {
    text: "Tx",
    checkbox: "Btn",
    radio: "Btn",
    button: "Btn",
    listbox: "Ch",
    combobox: "Ch",
    signature: "Sig",
  };
  const emitFormFieldObjects = (
    fields: readonly LayoutFormField[],
    parentName: string,
  ): void => {
    for (const field of fields) {
      const ownName =
        parentName.length > 0 && field.name.startsWith(`${parentName}.`)
          ? field.name.slice(parentName.length + 1)
          : field.name;
      const entries: [string, PdfObject][] = [];
      if (ownName.length > 0) {
        entries.push([
          "T",
          pdfLiteralString(new TextEncoder().encode(ownName)),
        ]);
      }
      if (field.alias !== undefined) {
        entries.push([
          "TU",
          pdfLiteralString(new TextEncoder().encode(field.alias)),
        ]);
      }
      if (field.fieldType === "group") {
        entries.push([
          "Kids",
          pdfArray(field.children.map((child) => pdfRef(formNumOf(child), 0))),
        ]);
      } else {
        entries.push(["FT", pdfName(FIELD_TYPE_PDF_NAME[field.fieldType])]);
        const FLAG_READ_ONLY = 1;
        const FLAG_PUSHBUTTON = 4;
        const FLAG_RADIO = 32768;
        const FLAG_COMBO = 131072;
        let flags = 0;
        if (field.readOnly === true) flags |= FLAG_READ_ONLY;
        if (field.fieldType === "button") flags |= FLAG_PUSHBUTTON;
        if (field.fieldType === "radio") flags |= FLAG_RADIO;
        if (field.fieldType === "combobox") flags |= FLAG_COMBO;
        if (flags !== 0) {
          entries.push(["Ff", pdfNum(flags)]);
        }
        if (
          field.fieldType === "text" ||
          field.fieldType === "listbox" ||
          field.fieldType === "combobox"
        ) {
          if (field.value !== undefined) {
            entries.push([
              "V",
              pdfLiteralString(new TextEncoder().encode(field.value)),
            ]);
          }
        } else if (
          field.fieldType === "checkbox" ||
          field.fieldType === "radio"
        ) {
          // The button family's checked state is a NAME export value: any name other than Off reads back as checked, so /Yes is the canonical spelling for a checked field the model left value-less and /Off the unchecked one.
          entries.push([
            "V",
            pdfName(
              field.checked === false || field.value === undefined
                ? (field.value ?? (field.checked === true ? "Yes" : "Off"))
                : field.value,
            ),
          ]);
        }
        if (field.options !== undefined) {
          entries.push([
            "Opt",
            pdfArray(
              field.options.map((option) =>
                pdfLiteralString(new TextEncoder().encode(option)),
              ),
            ),
          ]);
        }
        const firstWidget = field.widgets[0];
        if (field.widgets.length === 1 && firstWidget !== undefined) {
          entries.push(["Subtype", pdfName("Widget")]);
          entries.push(["Rect", widgetRectArray(firstWidget)]);
          entries.push([
            "P",
            pdfRef(pageAllocs[firstWidget.pageIndex]!.pageNum, 0),
          ]);
          // The merged field dict is the annotation: its page /Annots entry references this very object, not a copy of it.
          noteWidgetAnnot(firstWidget, pdfRef(formNumOf(field), 0));
        } else if (field.widgets.length > 1 && firstWidget !== undefined) {
          // Every widget is one of the extra objects the allocation walk reserved, referenced from /Kids and from its page's /Annots alike — the same annotation object in both places, never a copy.
          const extraNums = formExtraWidgetNums.get(field) ?? [];
          entries.push([
            "Kids",
            pdfArray(extraNums.map((num) => pdfRef(num, 0))),
          ]);
          for (const [index, num] of extraNums.entries()) {
            const widget = field.widgets[index];
            if (widget !== undefined) {
              noteWidgetAnnot(widget, pdfRef(num, 0));
            }
          }
        }
      }
      objects.push({
        num: formNumOf(field),
        value: pdfDict(Object.fromEntries(entries)),
      });
      const extraNums = formExtraWidgetNums.get(field) ?? [];
      for (const [index, num] of extraNums.entries()) {
        const widget = field.widgets[index];
        if (widget !== undefined) {
          objects.push({ num, value: widgetDict(widget) });
        }
      }
      emitFormFieldObjects(field.children, field.name);
    }
  };
  emitFormFieldObjects(doc.form ?? [], "");

  // #967: the tagged structure tree. One /StructElem per model element (/S the type, /P the parent -- the root for top-level elements, /K the child refs), and the /StructTreeRoot pointing at both the element roots and the /ParentTree number tree built after the page walk below (it depends on the per-page MCID assignments).
  if (structRootNum !== undefined && structParentTreeNum !== undefined) {
    const emitStructureElement = (
      element: LayoutStructureElement,
      parentNum: number,
    ): void => {
      const entries: [string, PdfObject][] = [
        ["Type", pdfName("StructElem")],
        ["S", pdfName(element.type)],
        ["P", pdfRef(parentNum, 0)],
      ];
      if (element.title !== undefined) {
        entries.push([
          "T",
          pdfLiteralString(new TextEncoder().encode(element.title)),
        ]);
      }
      if (element.language !== undefined) {
        entries.push([
          "Lang",
          pdfLiteralString(new TextEncoder().encode(element.language)),
        ]);
      }
      if (element.alt !== undefined) {
        entries.push([
          "Alt",
          pdfLiteralString(new TextEncoder().encode(element.alt)),
        ]);
      }
      if (element.actualText !== undefined) {
        entries.push([
          "ActualText",
          pdfLiteralString(new TextEncoder().encode(element.actualText)),
        ]);
      }
      if (element.children.length > 0) {
        entries.push([
          "K",
          pdfArray(
            element.children.map((child) => {
              const num = structElementNumById.get(child.id);
              if (num === undefined) {
                throw new Error(
                  `structure element "${child.id}" was not allocated -- this is a writePdf internal invariant violation`,
                );
              }
              return pdfRef(num, 0);
            }),
          ),
        ]);
      }
      const ownNum = structElementNumById.get(element.id);
      if (ownNum === undefined) {
        throw new Error(
          `structure element "${element.id}" was not allocated -- this is a writePdf internal invariant violation`,
        );
      }
      objects.push({
        num: ownNum,
        value: pdfDict(Object.fromEntries(entries)),
      });
      for (const child of element.children) {
        emitStructureElement(child, ownNum);
      }
    };
    for (const element of doc.structure ?? []) {
      emitStructureElement(element, structRootNum);
    }
  }

  // #967: the XMP packet restored as an uncompressed /Metadata stream -- the read side decodes it back verbatim.
  if (residueXmpNum !== undefined && doc.source?.xmp !== undefined) {
    objects.push({
      num: residueXmpNum,
      value: pdfStream(
        pdfDict({ Type: pdfName("Metadata"), Subtype: pdfName("XML") }),
        new TextEncoder().encode(doc.source.xmp.xml),
      ),
    });
  }

  for (const [standardName, alloc] of fontAllocs) {
    const { font, descriptor } = buildFontObjects(
      standardName,
      pdfRef(alloc.descNum, 0),
    );
    objects.push({ num: alloc.fontNum, value: font });
    objects.push({ num: alloc.descNum, value: descriptor });
  }

  for (const alloc of imageAllocs.values()) {
    if (alloc.smaskNum !== undefined && alloc.prepared.alpha !== undefined) {
      alloc.prepared.dict.entries.set("SMask", pdfRef(alloc.smaskNum, 0));
      objects.push({
        num: alloc.smaskNum,
        value: pdfStream(alloc.prepared.alpha.dict, alloc.prepared.alpha.raw),
      });
    }
    if (alloc.globalsNum !== undefined && alloc.globalsBase64 !== undefined) {
      // The verbatim /JBIG2Globals stream re-emitted as its own object, rebuilt from the decoded segments the reader captured: the globals are JBIG2 segment data, not a compressed image, so they travel under a plain (optionally Flate) transport the same way any producer writes them.
      const globalsRaw = base64ToBytes(alloc.globalsBase64);
      alloc.prepared.dict.entries.set(
        "DecodeParms",
        pdfDict({ JBIG2Globals: pdfRef(alloc.globalsNum, 0) }),
      );
      objects.push({
        num: alloc.globalsNum,
        value: pdfStream(
          pdfDict(
            compress
              ? new Map<string, PdfObject>([["Filter", pdfName("FlateDecode")]])
              : new Map<string, PdfObject>(),
          ),
          compress ? deflate(globalsRaw) : globalsRaw,
        ),
      });
    }
    objects.push({
      num: alloc.imageNum,
      value: pdfStream(alloc.prepared.dict, alloc.prepared.raw),
    });
  }

  const mathFont =
    mathFontAlloc === undefined ? undefined : loadMathFont().font;
  const usedGlyphs =
    mathFontAlloc === undefined || mathFont === undefined
      ? undefined
      : collectUsedGlyphs(formulas, mathFont);
  if (
    mathFontAlloc !== undefined &&
    mathFont !== undefined &&
    usedGlyphs !== undefined
  ) {
    const built = buildMathFontObjects(
      mathFont,
      usedGlyphs,
      {
        cidFontRef: pdfRef(mathFontAlloc.cidFontNum, 0),
        descriptorRef: pdfRef(mathFontAlloc.descriptorNum, 0),
        fontFileRef: pdfRef(mathFontAlloc.fontFileNum, 0),
        toUnicodeRef: pdfRef(mathFontAlloc.toUnicodeNum, 0),
      },
      compress,
    );
    objects.push({ num: mathFontAlloc.type0Num, value: built.type0 });
    objects.push({ num: mathFontAlloc.cidFontNum, value: built.cidFont });
    objects.push({ num: mathFontAlloc.descriptorNum, value: built.descriptor });
    objects.push({ num: mathFontAlloc.fontFileNum, value: built.fontFile });
    objects.push({ num: mathFontAlloc.toUnicodeNum, value: built.toUnicode });
  }

  for (const [face, alloc] of embeddedAllocs) {
    // The shaped glyph map is computed before the subset because its keys are the subset's own extra input: a 'GSUB' ligature glyph is reachable through no single code point's 'cmap' entry, so handing only the text's code points to the subsetter would drop exactly the ligature outlines the content stream is about to draw.
    const usedGlyphs = collectEmbeddedGlyphs(alloc.texts, face);
    // Ascending on both axes so the same document always subsets against the same input order, matching the sorted-for-determinism reasoning every other allocation here follows.
    const subset = subsetSfnt(
      face.font,
      [...alloc.codePoints].sort((a, b) => a - b),
      [...usedGlyphs.keys()].sort((a, b) => a - b),
    );
    if (subset === undefined) {
      // Loud rather than a silent fall-back to a standard-14 substitute: the caller's own registry chose this face, and quietly drawing the document in a different font than it asked for -- with metrics already laid out against this one -- would be a worse outcome than a failure naming exactly which face could not be embedded. subsetSfnt returns undefined only for a font it cannot rebuild correctly (a CFF-outline face with no 'glyf' at all, or a missing/truncated table it must reconstruct); see its own module comment.
      throw new Error(
        `font "${face.postScriptName}" resolved to an embeddable face, but its glyph outlines could not be subsetted -- only TrueType-outline ('glyf') fonts can be embedded, so supply a TrueType face for this family or drop it from the registry`,
      );
    }
    const built = buildEmbeddedFontObjects(
      face,
      subset,
      usedGlyphs,
      {
        cidFontRef: pdfRef(alloc.cidFontNum, 0),
        descriptorRef: pdfRef(alloc.descriptorNum, 0),
        fontFileRef: pdfRef(alloc.fontFileNum, 0),
        toUnicodeRef: pdfRef(alloc.toUnicodeNum, 0),
      },
      compress,
    );
    objects.push({ num: alloc.type0Num, value: built.type0 });
    objects.push({ num: alloc.cidFontNum, value: built.cidFont });
    objects.push({ num: alloc.descriptorNum, value: built.descriptor });
    objects.push({ num: alloc.fontFileNum, value: built.fontFile });
    objects.push({ num: alloc.toUnicodeNum, value: built.toUnicode });
  }

  const resourceEntries = new Map<string, PdfObject>();
  if (
    fontAllocs.size > 0 ||
    embeddedAllocs.size > 0 ||
    mathFontAlloc !== undefined
  ) {
    const fontEntries = new Map<string, PdfObject>(
      [...fontAllocs.values()].map((alloc) => [
        alloc.resourceName,
        pdfRef(alloc.fontNum, 0),
      ]),
    );
    for (const alloc of embeddedAllocs.values()) {
      fontEntries.set(alloc.resourceName, pdfRef(alloc.type0Num, 0));
    }
    if (mathFontAlloc !== undefined) {
      fontEntries.set(
        mathFontAlloc.resourceName,
        pdfRef(mathFontAlloc.type0Num, 0),
      );
    }
    resourceEntries.set("Font", pdfDict(fontEntries));
  }
  if (imageAllocs.size > 0) {
    resourceEntries.set(
      "XObject",
      pdfDict(
        new Map(
          [...imageAllocs.values()].map((alloc) => [
            alloc.resourceName,
            pdfRef(alloc.imageNum, 0),
          ]),
        ),
      ),
    );
  }
  const resourcesDict = pdfDict(resourceEntries);

  // #967: each page's (MCID -> owning element id) marks, filled by the content writer as it assigns MCIDs, consumed by the /ParentTree assembly after the walk.
  const markedStructureByPage = new Map<
    number,
    { mcid: number; structureId: string }[]
  >();

  const formulasByPage = new Map<number, PositionedFormula[]>();
  for (const formula of formulas) {
    const forPage = formulasByPage.get(formula.pageIndex);
    if (forPage === undefined) {
      formulasByPage.set(formula.pageIndex, [formula]);
    } else {
      forPage.push(formula);
    }
  }

  const context: ContentWriteContext = {
    measurer,
    resolveFont: (font: LayoutFont) => {
      const resolved = resolveFaceWithRegistry(registry, font);
      if (resolved.kind === "embedded") {
        const alloc = embeddedAllocs.get(resolved.face);
        if (alloc === undefined) {
          throw new Error(
            `embedded font "${resolved.face.postScriptName}" was not pre-allocated -- this is a writePdf internal invariant violation`,
          );
        }
        return {
          kind: "embedded",
          resourceName: alloc.resourceName,
          face: resolved.face,
        };
      }
      const alloc = fontAllocs.get(resolved.standardName);
      if (alloc === undefined) {
        throw new Error(
          `font "${resolved.standardName}" was not pre-allocated -- this is a writePdf internal invariant violation`,
        );
      }
      return {
        kind: "standard",
        resourceName: alloc.resourceName,
        standardName: resolved.standardName,
      };
    },
    resolveImage: (imageId) => {
      const alloc = imageAllocs.get(imageId);
      if (alloc === undefined) {
        throw new Error(
          `image "${imageId}" was not pre-allocated -- this is a writePdf internal invariant violation`,
        );
      }
      return { resourceName: alloc.resourceName };
    },
  };

  doc.pages.forEach((page, pageIndex) => {
    throwIfAborted(options.signal);
    const { pageNum, contentsNum } = pageAllocs[pageIndex]!;

    // #967: the per-page marked-content state. MCIDs are page-scoped and sequential in emission order; the layer object numbers were allocated up front, so the content writer can spell an item's /OC reference inline.
    let pageMcid = 0;
    const pageContext: ContentWriteContext = {
      ...context,
      nextMcid: () => pageMcid++,
      layerObjectNumberOf: (name: string) => layerNumByName.get(name),
    };
    const {
      bytes: contentBytes,
      substitutions,
      missingGlyphs,
      markedStructure,
    } = writeContentStream(page.items, pageContext);
    if (markedStructure.length > 0) {
      markedStructureByPage.set(pageIndex, [...markedStructure]);
    }
    for (const substitution of substitutions) {
      options.onSubstitution?.(substitution, { pageIndex });
    }
    for (const missing of missingGlyphs) {
      options.onMissingGlyph?.(missing, { pageIndex });
    }

    const pageFormulas = formulasByPage.get(pageIndex);
    const formulaBytes =
      pageFormulas === undefined ||
      mathFontAlloc === undefined ||
      mathFont === undefined
        ? undefined
        : writeFormulaContentStream(pageFormulas, {
            font: mathFont,
            resourceName: mathFontAlloc.resourceName,
          });
    const combinedContentBytes =
      formulaBytes === undefined
        ? contentBytes
        : concatBytes([contentBytes, formulaBytes]);

    const finalContentBytes = compress
      ? deflate(combinedContentBytes)
      : combinedContentBytes;
    const contentsDict = pdfDict(
      compress ? { Filter: pdfName("FlateDecode") } : {},
    );
    objects.push({
      num: contentsNum,
      value: pdfStream(contentsDict, finalContentBytes),
    });

    const annots = [
      ...page.items.filter(isLinkItem).map((link) => buildLinkAnnotDict(link)),
      ...page.items
        .filter(isInternalLinkItem)
        .map((link) => buildInternalLinkAnnotDict(link, doc, pageAllocs)),
    ];
    if (page.notes !== undefined && page.notes.length > 0) {
      annots.push(buildNotesAnnotDict(page.notes));
    }
    // The page's form-field widgets, in field order: riding /Annots alongside the links and notes so a viewer that never walks the AcroForm tree still renders them. These are references to the very objects the field tree owns, not copies — annotations.ts's own /Annots walk skips /Subtype /Widget for exactly this reason.
    annots.push(...(widgetAnnotsByPage.get(pageIndex) ?? []));

    const pageEntries = new Map<string, PdfObject>([
      ["Type", pdfName("Page")],
      ["Parent", pdfRef(pagesNum, 0)],
      [
        "MediaBox",
        pdfArray([0, 0, page.widthPt, page.heightPt].map((n) => pdfNum(n))),
      ],
      ["Resources", resourcesDict],
      ["Contents", pdfRef(contentsNum, 0)],
    ]);
    if (annots.length > 0) {
      pageEntries.set("Annots", pdfArray(annots));
    }
    if ((markedStructureByPage.get(pageIndex) ?? []).length > 0) {
      // The producer-chosen key this page's parent-tree entry is filed under (14.7.4.4); the page's own position is the natural deterministic choice for a writer minting the tree itself.
      pageEntries.set("StructParents", pdfNum(pageIndex));
    }
    objects.push({ num: pageNum, value: pdfDict(pageEntries) });
  });

  // #967: the /ParentTree number tree. One entry per marked page, keyed by that page's /StructParents value, holding the array of owning element references indexed by MCID -- exactly the association structure.ts's own reader walks back. An MCID with no owning element (an item marked for a layer only, or naming an element id this document's tree does not carry) files a null, the spelling a producer writes for an unused slot.
  if (structRootNum !== undefined && structParentTreeNum !== undefined) {
    const nums: PdfObject[] = [];
    for (const [pageIndex, marks] of markedStructureByPage) {
      const maxMcid = Math.max(...marks.map((mark) => mark.mcid));
      const byMcid: PdfObject[] = Array.from({ length: maxMcid + 1 }, () =>
        pdfNull(),
      );
      for (const mark of marks) {
        const elementNum = structElementNumById.get(mark.structureId);
        if (elementNum !== undefined) {
          byMcid[mark.mcid] = pdfRef(elementNum, 0);
        }
      }
      nums.push(pdfNum(pageIndex), pdfArray(byMcid));
    }
    objects.push({
      num: structParentTreeNum,
      value: pdfDict({ Nums: pdfArray(nums) }),
    });
    const rootEntries: [string, PdfObject][] = [
      ["Type", pdfName("StructTreeRoot")],
      [
        "K",
        pdfArray(
          (doc.structure ?? []).map((element) => {
            const num = structElementNumById.get(element.id);
            if (num === undefined) {
              throw new Error(
                `structure element "${element.id}" was not allocated -- this is a writePdf internal invariant violation`,
              );
            }
            return pdfRef(num, 0);
          }),
        ),
      ],
      ["ParentTree", pdfRef(structParentTreeNum, 0)],
    ];
    objects.push({
      num: structRootNum,
      value: pdfDict(Object.fromEntries(rootEntries)),
    });
  }

  // Encryption runs as a final pass over the fully-assembled object graph, rather than being threaded through every object-construction call above: every string and stream this writer produces needs the identical treatment (Algorithm 1/1.A, keyed by that object's own number), so one recursive walk here is the same DRY move document.ts's own decryptDict/decryptObject already makes on the read side. The /Encrypt dictionary object itself is allocated and appended only afterwards, so this walk never touches it -- ISO 32000-2 7.6.1 requires its own O/U/OE/UE/Perms strings to stay in the clear.
  let fileId: Uint8Array<ArrayBuffer> | undefined;
  let encryptedObjects = objects;
  if (options.encryption !== undefined && encryptDictNum !== undefined) {
    fileId = randomBytes(FILE_ID_BYTES);
    const encryptor = createStandardEncryptor(options.encryption, fileId);
    encryptedObjects = objects.map(({ num, value }) => ({
      num,
      value: encryptIndirectObject(value, num, 0, encryptor),
    }));
    encryptedObjects.push({
      num: encryptDictNum,
      value: encryptor.encryptDict,
    });
  }

  const writer = new ByteWriter();
  writer.writeAscii("%PDF-1.7\n");
  const offsets = new Map<number, number>();
  for (const { num, value } of encryptedObjects) {
    offsets.set(num, writer.length);
    writer.writeAscii(`${num} 0 obj\n`);
    writeObject(writer, value);
    writer.writeAscii("\nendobj\n");
  }

  const maxObjNum = nextObjNum - 1;
  const xrefOffset = writer.length;
  writer.writeAscii("xref\n");
  writer.writeAscii(`0 ${maxObjNum + 1}\n`);
  writer.writeAscii(xrefEntry(0, 65535, false));
  for (let num = 1; num <= maxObjNum; num++) {
    const offset = offsets.get(num);
    if (offset === undefined) {
      throw new Error(
        `object ${num} was allocated but never written -- this is a writePdf internal invariant violation`,
      );
    }
    writer.writeAscii(xrefEntry(offset, 0, true));
  }

  const trailerEntries = new Map<string, PdfObject>([
    ["Size", pdfNum(maxObjNum + 1)],
    ["Root", pdfRef(catalogNum, 0)],
    ["Info", pdfRef(infoNum, 0)],
  ]);
  if (fileId !== undefined && encryptDictNum !== undefined) {
    trailerEntries.set(
      "ID",
      pdfArray([pdfHexString(fileId), pdfHexString(fileId)]),
    );
    trailerEntries.set("Encrypt", pdfRef(encryptDictNum, 0));
  } else if (trailerIdRestore !== undefined) {
    // #967: the quarantined trailer /ID restored verbatim (the one residue row that belongs to the trailer, not the Catalog). An encrypted document keeps its own freshly minted ID -- the encryption keys are derived from it.
    trailerEntries.set("ID", trailerIdRestore);
  }
  writer.writeAscii("trailer\n");
  writeObject(writer, pdfDict(trailerEntries));
  writer.writeAscii("\nstartxref\n");
  writer.writeAscii(`${xrefOffset}\n`);
  writer.writeAscii("%%EOF");

  return writer.toBytes();
}
