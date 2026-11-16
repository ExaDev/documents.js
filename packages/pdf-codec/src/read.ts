import { readPageAnnotations } from "./annotations";
import type { ImageRegistry } from "./read-convert";
import {
  convertExtractedItem,
  readLinkAnnotations,
  readPageNotes,
} from "./read-convert";
import { readAcroForm } from "./form";
import { readXmpMetadata } from "./xmp";
import { readAttachments } from "./attachments";
import { readOptionalContent } from "./optional-content";
import { readStructure } from "./structure";
import type { LayoutMetadata, SourceResidue } from "document-schema.js";
import type {
  LayoutDocument,
  LayoutImageAsset,
  LayoutItem,
  LayoutPage,
  LayoutDocumentSurface,
} from "./layout";
import { LAYOUT_FORMAT_VERSION, LayoutDocumentSurfaceSchema } from "./layout";
import { openPdfDocument } from "./document";
import type { PdfDocument } from "./document";
import type { PdfDiagnosticSink } from "./diagnostics";
import { NOOP_DIAGNOSTIC_SINK, PdfParseError } from "./diagnostics";
import { hasPdfHeader, resolvePageSelection } from "./read-open";
import { throwIfAborted } from "./util/abort";
import type { FontResolverService } from "./font-read";
import { createFontResolver } from "./font-read";
import type { PdfObjectResolver } from "./interpret-types";
import { interpretContentStream } from "./interpret";
import type {
  PageBoxRect,
  PageRotation,
  PageRotationResult,
} from "./page-frame";
import {
  itemIntersectsVisibleRegion,
  normalizeRotation as normalizePageRotation,
  pageRotationTransform as pageRotationMatrix,
  readPageContentBytes,
  readPageFrame,
} from "./page-frame";
import type { DestinationRegistry } from "./navigation";
import { createDestinationRegistry, readOutline } from "./navigation";
import type { PdfDict, PdfObject } from "./objects";
import {
  asArray,
  dictGet,
  pdfArray,
  pdfDict,
  pdfNull,
  pdfNum,
} from "./objects";
import { serializeObjectToText } from "./serialize";
import { decodePdfString, parsePdfDate } from "./pdf-text";

// readPdf(bytes, options?) -> LayoutDocument: the top of the read pipeline, assembling every other src/pdf/* read module (document.ts's object store and page tree, interpret.ts's graphics/text extraction, font-read.ts's width/decode, images-read.ts's PNG/JPEG recovery) into the same pivot model src/pdf/write.ts consumes on the way out, so a document round-trips through readPdf -> writePdf structurally even though neither claims byte- or content-fidelity.
//
// This module is also the package's read-only entry point: package.json's explicit `./read` export maps here, so a consumer that only reads PDFs imports 'pdf-codec/read' and gets a module graph that provably excludes the write path and the vendored font assets (src/read-graph.test.ts walks this file's static imports and fails if write.ts, math-font.ts, font-registry.ts, or an asset module becomes reachable — on runtimes with a bundle budget, e.g. Cloudflare Workers' 3 MB gzipped free-plan cap, that exclusion is the difference between adoptable and not). It is deliberately a real owning module rather than a curated re-export barrel: the family's barrel policy keeps re-exports in src/index.ts alone, and the wildcard `./*` export already deep-serves every read-adjacent module the surface here does not itself own — diagnostics (pdf-codec/diagnostics), the Layout family (pdf-codec/layout), standard-14 resolution and AFM metrics (pdf-codec/fonts, pdf-codec/afm-widths), and the text-run grouping every reader needs to turn this module's output back into lines and words (pdf-codec/text-group), all of which carry no asset imports either. Nothing in this file may import the write half; the one symbol the two pipelines genuinely share (NOTES_ANNOTATION_AUTHOR) lives in its own leaf module for exactly that reason.

export interface ReadPdfOptions {
  readonly sink?: PdfDiagnosticSink;
  readonly signal?: AbortSignal;
  /**
   * The pages to read, as zero-based indices into the document's page tree; a negative index counts from the end (`-1` is the last page). Omitted, every page is read.
   *
   * What a selected read skips: an unselected page's content stream is never fetched, decoded or interpreted, so the fonts and images only unselected pages use are never resolved; embedded-file payloads are never decoded, so `attachments` is absent from a page-selected result (an attachment is document-level payload whose size is independent of the pages asked for, and decoding it would cost the same whichever pages were selected).
   *
   * What it still reads whole, because a negative index and every document-level page reference resolve against it or because it is document-level and holds no page content stream: the page tree, the outline, named destinations, optional-content layers, the AcroForm, the structure element tree and the /ParentTree number tree (both of which scale with the document), metadata and package residue; every one of those but the page tree and metadata can be left out as well with `surfaces`. Two surfaces are built from page content and so cover selected pages only: the structure-ownership association an item's `structure` field names (and its parent-tree diagnostics), and the `page-boxes` residue row. Destinations a link states as a direct array are minted into `destinations` (as `dest1`, `dest2`, ...) only when their page is interpreted, so an unselected page's direct link destinations are absent and a minted name depends on which pages were read (and on whether the outline was read: see `surfaces`); named destinations are unaffected.
   *
   * Duplicates collapse, and the result's `pages` holds the selected pages in ascending document order whatever order they were asked for in, each carrying its source position as `index`, with the document's total as `pageCount`; every document-level reference keeps naming source indices. An empty array is a valid selection: it reads no page and returns the document-level surfaces with `pageCount`, the cheapest way to learn a file's length and metadata. An entry naming no page throws `PdfPageSelectionError` rather than being skipped.
   */
  readonly pages?: readonly number[];
  /**
   * Which document-level surfaces to read. Each is read unless its entry is `false`, so omitting the setting, or an entry, reads it as before. Independent of `pages`: it applies to a full read and a page-selected read alike.
   *
   * A surface turned off is never parsed (its part of the catalog is not walked, so a malformed outline, form, layer list or structure tree reports no diagnostic, and no image a page draws is decoded or diagnosed) and its field is absent from the result whatever the file holds (`images` is left empty instead); the result lists it in `skippedSurfaces`, which is how a caller tells "not read" from "none". What each one covers, and what page items lose without it:
   *
   * - `outline`: the `/Outlines` bookmark tree (`outline`). Page items do not depend on it, except through minted names: a destination stated as a direct array is named with the first unused `destN` in the order the reader meets it, and the outline is read before any page, so an outline entry's direct destination takes a lower number than any link's. Without the outline, the names minted for page links' direct destinations are renumbered, and `destinations` loses the entries only the outline minted; each link still resolves to the same target.
   * - `destinations`: the named destinations of the catalog `/Dests` dictionary and the `/Names /Dests` name tree, and the registry links and outline entries name their targets through (`destinations`). Without it nothing can name an internal target, so a link whose target is internal (a `/Dest`, or a `/GoTo` action, named or direct) is left out of its page's items, and a read outline entry carries no `destination`; a link to a URI is kept as usual.
   * - `form`: the AcroForm field tree (`form`). Page items do not depend on it: a widget annotation is never a page item or annotation either way.
   * - `layers`: optional content, the `/OCProperties` groups and their default visibility (`layers`). Without it no item carries a `layer`, since an `/OC` membership resolves to no name; the items themselves are all still read, so content the default view hides is indistinguishable from visible content.
   * - `structure`: the `/StructTreeRoot` element tree and its `/ParentTree` ownership map (`structure`). Without it no item carries a `structure` owner, and the parent-tree diagnostics are not reported.
   * - `residue`: the package-level residue rows (`source`), including the per-page `page-boxes` row. Page items do not depend on it; `metadata` still reads the XMP packet it falls back to.
   * - `images`: the image registry (`images`), which holds every image XObject and inline image a read page draws, decoded to PNG or passed through as JPEG. Without it no image's stream is decoded, `images` is an empty record (every `LayoutDocument` carries one), and each page's `image` items are left out, since they would name assets that were never read. Decoding an image costs memory in proportion to its pixels, so a read that wants only a page's text leaves this out.
   *
   * Apart from those stated losses and the renumbering a skipped outline causes, every page item is exactly what a read with the surface on produces.
   */
  readonly surfaces?: ReadPdfSurfaces;
  /**
   * The most bytes stream decoding may produce over the whole read, a non-negative safe integer (anything else throws `RangeError`). Every decode the read reaches is charged against it: cross-reference and object streams while opening the document, then page content streams, form XObjects, font programs (each time one is decoded, so a program two fonts share is charged twice), `/ToUnicode` CMaps, `/CIDToGIDMap` streams, image XObjects and inline images, soft masks, `/Indexed` lookup streams, the `/Metadata` packet and embedded files. Each filter stage's output counts, so a stream under two filters pays for both.
   *
   * The first decode that would pass the budget throws `PdfDecodeBudgetError` (a `PdfParseError` with code `pdf/decode-budget-exceeded`, carrying `maxDecodedBytes`, the bytes already `decodedBytes`, the stream's `objectNumber` and its `filters`), and stops as soon as its output crosses what is left rather than after materialising it: Flate, LZW, RunLength and ASCII85 stop incrementally, ASCIIHex is refused from its exact size before allocating it, and CCITTFax, JBIG2 and JPEG 2000 are charged their declared output (a CCITTFax stream with no row count its worst case, a JBIG2 stream with no `/Width` and `/Height` refused) before they decode. A JPEG is passed through undecoded and costs nothing. Absent, the read decodes without a bound, exactly as it always has.
   */
  readonly maxDecodedBytes?: number;
}

/**
 * One entry per document-level surface `readPdf` can leave out, each read unless set to `false` (see `ReadPdfOptions.surfaces` for what each covers and what page items lose without it).
 */
export type ReadPdfSurfaces = Readonly<
  Partial<Record<LayoutDocumentSurface, boolean>>
>;

// The surfaces a setting turns off, in LayoutDocumentSurfaceSchema's order, so the result's skippedSurfaces lists them the same way however the caller spelled the object.
function skippedSurfacesOf(
  surfaces: ReadPdfSurfaces | undefined,
): LayoutDocumentSurface[] {
  return LayoutDocumentSurfaceSchema.options.filter(
    (surface) => surfaces?.[surface] === false,
  );
}

// A registry for a read that skips destinations: it holds no entry and names nothing, so a link or outline entry asking it for a target gets none, without a diagnostic (nothing was looked up, so nothing dangles).
const UNREAD_DESTINATION_REGISTRY: DestinationRegistry = {
  entries: [],
  intern: () => undefined,
};

export function readPdf(
  bytes: Uint8Array<ArrayBuffer>,
  options?: ReadPdfOptions,
): LayoutDocument {
  const sink = options?.sink ?? NOOP_DIAGNOSTIC_SINK;
  const signal = options?.signal;
  if (!hasPdfHeader(bytes)) {
    throw new PdfParseError(
      "pdf/no-header",
      'no "%PDF-" header found within the first bytes of the file; this does not look like a PDF at all',
    );
  }
  // Checked before openPdfDocument rather than relying solely on the page loop's per-iteration check below: the document-open phase (xref resolution, object parsing) runs before any page, and a document with an empty page tree never enters the loop at all — without this check, an already-aborted signal on such a file would return a parsed document instead of throwing.
  throwIfAborted(signal);
  const doc = openPdfDocument(bytes, sink, {
    maxDecodedBytes: options?.maxDecodedBytes,
  });
  const fontResolver = createFontResolver({ resolver: doc, sink });
  const images: Record<string, LayoutImageAsset> = {};

  // The page tree is walked first (materialising the page-index map a destination's page reference resolves against), then the navigation surfaces: page interpretation interns direct destination arrays into the registry as it meets them, so links on page N can name a destination minted by nothing but themselves.
  const pageDicts = doc.pages();
  const selection =
    options?.pages === undefined
      ? undefined
      : resolvePageSelection(options.pages, pageDicts.length);
  // Each surface ReadPdfOptions.surfaces turns off is never parsed: its reader is not called, and what page interpretation would have asked of it answers nothing (see ReadPdfOptions.surfaces for what page items lose).
  const skippedSurfaces = skippedSurfacesOf(options?.surfaces);
  const reads = (surface: LayoutDocumentSurface): boolean =>
    !skippedSurfaces.includes(surface);
  const imageRegistry: ImageRegistry | undefined = reads("images")
    ? { images, imageIdCache: new Map() }
    : undefined;
  const destinationRegistry = reads("destinations")
    ? createDestinationRegistry(
        doc.catalog,
        doc,
        (obj) => doc.pageIndex(obj),
        sink,
      )
    : UNREAD_DESTINATION_REGISTRY;
  const outline = reads("outline")
    ? readOutline(doc.catalog, destinationRegistry, doc, sink)
    : undefined;
  // A page-selected read decodes no embedded file: see ReadPdfOptions.pages.
  const attachments =
    selection === undefined
      ? readAttachments(doc.catalog, pageDicts, doc, sink)
      : [];
  const optionalContent = reads("layers")
    ? readOptionalContent(doc.catalog, doc, sink)
    : undefined;
  const form = reads("form")
    ? readAcroForm(doc.catalog, doc, (obj) => doc.pageIndex(obj), sink)
    : undefined;
  const structure = reads("structure")
    ? readStructure(
        doc.catalog,
        pageDicts,
        (index) => selection === undefined || selection.has(index),
        doc,
        sink,
      )
    : undefined;
  const source = reads("residue") ? readDocumentResidue(doc, sink) : undefined;
  const pageBoxRows: PdfObject[] = [];

  // An unselected page is skipped before readPage, the only path that fetches a page's /Contents, interprets it, and resolves the fonts and images it names: those costs are paid for selected pages alone. Each page keeps its source position as the page index readPage stamps (diagnostics, the structure-ownership lookup, the page-boxes residue row), and a selected page also carries it as `index`, since its position in `pages` no longer says which page it is.
  const pages = pageDicts.flatMap((pageDict, index) => {
    if (selection !== undefined && !selection.has(index)) {
      return [];
    }
    throwIfAborted(signal);
    const read = readPage(
      index,
      pageDict,
      doc,
      fontResolver,
      imageRegistry,
      destinationRegistry,
      optionalContent?.layerNameOf ?? noLayerName,
      structure?.ownerOf ?? noStructureOwner,
      sink,
    );
    if (read.boxRow !== undefined) {
      pageBoxRows.push(read.boxRow);
    }
    return [selection === undefined ? read.page : { ...read.page, index }];
  });

  // The per-page boundary declarations a distinct crop box or a print-production box left behind, quarantined with the other package-level residue rows, and so left out with them when residue is skipped.
  if (source !== undefined && pageBoxRows.length > 0) {
    source["page-boxes"] = {
      format: "pdf",
      xml: serializeObjectToText(pdfArray(pageBoxRows)),
    };
  }

  return {
    formatVersion: LAYOUT_FORMAT_VERSION,
    metadata: readMetadata(doc.trailer, doc, doc.catalog, sink),
    pages,
    ...(selection !== undefined ? { pageCount: pageDicts.length } : {}),
    images,
    ...(destinationRegistry.entries.length > 0
      ? { destinations: [...destinationRegistry.entries] }
      : {}),
    ...(outline !== undefined && outline.length > 0 ? { outline } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(optionalContent !== undefined && optionalContent.layers.length > 0
      ? { layers: [...optionalContent.layers] }
      : {}),
    ...(form !== undefined && form.length > 0 ? { form } : {}),
    ...(structure !== undefined && structure.tree.length > 0
      ? { structure: [...structure.tree] }
      : {}),
    ...(source !== undefined && Object.keys(source).length > 0
      ? { source }
      : {}),
    ...(skippedSurfaces.length > 0 ? { skippedSurfaces } : {}),
  };
}

// What page interpretation asks of a skipped layers or structure surface: an /OC membership names no layer, and marked content has no owner.
function noLayerName(): undefined {
  return undefined;
}

function noStructureOwner(): undefined {
  return undefined;
}

// --- Page rotation: implemented in page-frame.ts (which the image listing loads without this module's text pipeline), and still served from here, where the pdf-codec/read entry has always exported them. ---

/**
 * Normalizes a page's /Rotate to one of the four quarter turns (ISO 32000-1 7.7.3.3).
 * @param rotate - The /Rotate value, if any.
 * @returns 0, 90, 180 or 270.
 */
export function normalizeRotation(rotate: number | undefined): PageRotation {
  return normalizePageRotation(rotate);
}

/**
 * The matrix a page's /Rotate applies, for a media box `w` by `h` points, and the rotated page's size.
 * @param rotation - A normalized rotation.
 * @param w - The media box width.
 * @param h - The media box height.
 * @returns The matrix and the rotated size.
 */
export function pageRotationTransform(
  rotation: PageRotation,
  w: number,
  h: number,
): PageRotationResult {
  return pageRotationMatrix(rotation, w, h);
}

// --- Page content: /Contents (single stream or array), interpretation, and per-item conversion into LayoutItem. ---

// One page's contribution to the package-level page-boxes residue row: the declared boundary rectangles that carry a fact beyond the visible one. A page contributes when a declared /CropBox differs from the media box (the outer region and the crop's own absolute position are both left behind by reading the visible box alone) or when any of /BleedBox /TrimBox /ArtBox is declared (print-production facts with no field in the layout model). Values are the parsed source arrays, serialised verbatim, so a same-format restorer re-emits exactly what the producer wrote. Undefined when the page's declarations carry nothing beyond the visible box.
function pageBoxResidueEntry(
  pageIndex: number,
  page: PdfDict,
  mediaBox: PageBoxRect,
  cropBox: PageBoxRect,
): PdfObject | undefined {
  const declaredBoxes: readonly (readonly [string, PdfObject | undefined])[] = [
    ["MediaBox", dictGet(page, "MediaBox")],
    ["CropBox", dictGet(page, "CropBox")],
    ["BleedBox", dictGet(page, "BleedBox")],
    ["TrimBox", dictGet(page, "TrimBox")],
    ["ArtBox", dictGet(page, "ArtBox")],
  ];
  const cropDeclared = dictGet(page, "CropBox") !== undefined;
  const productionBoxDeclared = declaredBoxes
    .slice(2)
    .some(([, value]) => value !== undefined);
  const cropDiffersFromMedia =
    cropDeclared &&
    (cropBox.llx !== mediaBox.llx ||
      cropBox.lly !== mediaBox.lly ||
      cropBox.urx !== mediaBox.urx ||
      cropBox.ury !== mediaBox.ury);
  if (!cropDiffersFromMedia && !productionBoxDeclared) {
    return undefined;
  }
  const entries: Record<string, PdfObject> = { Page: pdfNum(pageIndex) };
  for (const [key, value] of declaredBoxes) {
    if (value !== undefined) {
      entries[key] = value;
    }
  }
  return pdfDict(entries);
}

// A page as read, plus the boundary-declaration residue row it left behind, if any. The row is handed back rather than appended to a shared list so the residue is assembled where it is reported.
interface ReadPage {
  readonly page: LayoutPage;
  readonly boxRow: PdfObject | undefined;
}

function readPage(
  pageIndex: number,
  page: PdfDict,
  resolver: Readonly<PdfObjectResolver>,
  fontResolver: FontResolverService,
  // Undefined when the read skips images: then no image item is converted and no image stream is decoded.
  imageRegistry: ImageRegistry | undefined,
  destinationRegistry: DestinationRegistry,
  layerNameOf: (obj: PdfObject | undefined) => string | undefined,
  structureOwnerOf: (pageIndex: number, mcid: number) => string | undefined,
  sink: PdfDiagnosticSink,
): ReadPage {
  const resources = resolver.resolveDict(dictGet(page, "Resources"));
  const { mediaBox, cropBox, widthPt, heightPt, pageMatrix } = readPageFrame(
    pageIndex,
    page,
    sink,
  );

  const boxRow = pageBoxResidueEntry(pageIndex, page, mediaBox, cropBox);

  const items: LayoutItem[] = [];
  if (resources !== undefined) {
    const contentBytes = readPageContentBytes(page, resolver, sink);
    const extracted = interpretContentStream(contentBytes, resources, {
      fontMetrics: fontResolver.metrics,
      resolver,
      sink,
      layerNameOf,
    });
    for (const item of extracted) {
      const converted = convertExtractedItem(
        item,
        pageMatrix,
        fontResolver,
        imageRegistry,
        resolver,
        sink,
      );
      if (
        converted === undefined ||
        !itemIntersectsVisibleRegion(converted, widthPt, heightPt)
      ) {
        continue;
      }
      // The (page, MCID) association: an item stamped with its span's MCID names the element the parent tree says owns that marked content — the one place a PDF states semantics natively rather than leaving geometry to imply it.
      const owner =
        item.mcid === undefined
          ? undefined
          : structureOwnerOf(pageIndex, item.mcid);
      items.push(
        owner === undefined ? converted : withStructure(converted, owner),
      );
    }
  } else {
    sink({
      code: "pdf/object-missing-value",
      severity: "warning",
      message:
        "page has no /Resources dict; its content stream cannot be interpreted",
    });
  }
  items.push(
    ...readLinkAnnotations(page, pageMatrix, resolver, destinationRegistry),
  );

  const notes = readPageNotes(page, resolver);
  const annotations = readPageAnnotations(page, pageMatrix, resolver, sink);

  return {
    page: {
      widthPt,
      heightPt,
      items,
      ...(notes !== undefined ? { notes } : {}),
      ...(annotations.length > 0 ? { annotations } : {}),
    },
    boxRow,
  };
}

// Stamps the owning element id onto a converted item. The link kinds carry no structure field by the same line the layer filter draws — an annotation is an anchored construct, not painted stream content — and they never reach here with an owner anyway (they are not extracted from a content stream), so the guard is pure narrowing.
function withStructure(item: LayoutItem, structure: string): LayoutItem {
  if (item.kind === "link" || item.kind === "internalLink") {
    return item;
  }
  return { ...item, structure };
}

// --- PDF string decoding and /Info metadata: the scalar decoders themselves live in pdf-text.ts (shared with the other read-side modules; deep-importable as pdf-codec/pdf-text through the wildcard export). ---

function readMetadata(
  trailer: PdfDict,
  resolver: Readonly<PdfObjectResolver>,
  catalog: PdfDict,
  sink: PdfDiagnosticSink,
): LayoutMetadata {
  const info = resolver.resolveDict(dictGet(trailer, "Info"));
  if (info === undefined) {
    return {};
  }
  const stringField = (key: string): string | undefined => {
    const obj: PdfObject | undefined = dictGet(info, key);
    return obj?.kind === "string" ? decodePdfString(obj.bytes) : undefined;
  };
  const keywordsRaw = stringField("Keywords");
  const keywords = keywordsRaw
    ?.split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
  const langObj = dictGet(catalog, "Lang");
  // The XMP mirror fills ONLY the fields /Info does not carry: in an ordinary file the two agree, and in a PDF/A file the fields live only in XMP — either way /Info, the structured original, wins where it speaks.
  const xmp = xmpPacket(catalog, resolver, sink);
  const mirrored = readXmpMetadata(xmp ?? "");
  return {
    title: stringField("Title") ?? mirrored.title,
    author: stringField("Author") ?? mirrored.author,
    subject: stringField("Subject") ?? mirrored.subject,
    keywords:
      (keywords !== undefined && keywords.length > 0 ? keywords : undefined) ??
      mirrored.keywords,
    creator: stringField("Creator") ?? mirrored.creator,
    producer: stringField("Producer") ?? mirrored.producer,
    createdIso:
      parsePdfDate(stringField("CreationDate")) ?? mirrored.createdIso,
    modifiedIso: parsePdfDate(stringField("ModDate")) ?? mirrored.modifiedIso,
    ...(langObj?.kind === "string"
      ? { language: decodePdfString(langObj.bytes) }
      : {}),
  };
}

function xmpPacket(
  catalog: PdfDict,
  resolver: Readonly<PdfObjectResolver>,
  sink: PdfDiagnosticSink,
): string | undefined {
  const metadataObj = resolver.resolve(dictGet(catalog, "Metadata"));
  if (metadataObj?.kind !== "stream") {
    return undefined;
  }
  const decoded = resolver.decodeStream(metadataObj, sink);
  return new TextDecoder().decode(decoded.bytes);
}

// The package-level residue rows: whole-document PDF facts no content node owns, serialised in their own syntax and quarantined per the channel's contract — a consumer never derives semantics from them, and only a same-format writer may re-emit them.
function readDocumentResidue(
  doc: PdfDocument,
  sink: PdfDiagnosticSink,
): Record<string, SourceResidue> {
  const source: Record<string, SourceResidue> = {};
  const residue = (key: string, obj: PdfObject | undefined): void => {
    if (obj !== undefined) {
      source[key] = { format: "pdf", xml: serializeObjectToText(obj) };
    }
  };
  const catalog = doc.catalog;
  const packet = xmpPacket(catalog, doc, sink);
  if (packet !== undefined) {
    source.xmp = { format: "pdf", xml: packet };
  }
  residue("viewer-preferences", dictGet(catalog, "ViewerPreferences"));
  residue("page-mode", dictGet(catalog, "PageMode"));
  residue("page-layout", dictGet(catalog, "PageLayout"));
  residue("open-action", dictGet(catalog, "OpenAction"));
  // /OutputIntents is an array of references — the residue that is worth quarantining is the intent dictionaries themselves, so each element resolves before serialising.
  const outputIntents = asArray(dictGet(catalog, "OutputIntents"));
  if (outputIntents !== undefined) {
    residue(
      "output-intents",
      pdfArray(outputIntents.map((intent) => doc.resolve(intent) ?? pdfNull())),
    );
  }
  residue("piece-info", dictGet(catalog, "PieceInfo"));
  residue("legal", dictGet(catalog, "Legal"));
  residue("collection", dictGet(catalog, "Collection"));
  residue("trailer-id", dictGet(doc.trailer, "ID"));
  return source;
}
