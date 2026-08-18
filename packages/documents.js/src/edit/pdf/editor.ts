import type { LayoutMetadata } from 'document-schema.js';
import type { LayoutDocument, ReadPdfOptions, WritePdfOptions } from 'pdf-codec';
import { LAYOUT_FORMAT_VERSION, readPdf, writePdf } from 'pdf-codec';
import { resolveMetadataTimestamps } from '../../model/metadata';
import type { ClockPort } from '../../ports/clock';
import { systemClock } from '../../ports/clock';
import type { PageInit } from './page';
import { buildPage, PdfPage } from './page';

// A live-view PDF editor over pdf-codec's own positioned-item model (LayoutDocument), NOT a content-stream/byte-level editor -- see this module's own package doc comment for the full rationale. `doc` is the ONE mutable LayoutDocument every PdfPage/PdfItem this editor hands out holds a live reference directly into; toBytes() runs writePdf(doc, options) fresh on every call, so there is nothing to keep in sync -- the document IS the working copy.
//
// Explicitly out of scope for v1 (see src/edit/pdf/item.ts's own PdfPathItem note for the path-specific case): no auto-flow/reflow -- every insertion takes an explicit position, since PDF has no paragraph model to flow into; a caller wanting wrapped multi-line text composes it themselves (optionally via pdf-codec's own exported wrapRunsToWidth/createFontMeasurer), one PdfTextItem per line. No embedded-font program editing -- a text item's `font` is a LayoutFont request (family/weight/style), resolved to an actual embedded/standard-14 face only at writePdf time, exactly as it already is for every X-to-PDF conversion in this package. No re-encryption of an edited, originally-encrypted source: openPdf on a source encrypted with the standard security handler and an empty user password decrypts transparently, exactly as a bare readPdf(bytes) call already does (pdf-codec's own createStandardDecryptor, src/document.ts) -- LayoutDocument carries no field recording that this happened, so there is nothing for this editor to inspect after the fact and no cheap way to surface a diagnostic for it; toBytes() never re-encrypts the output regardless of whether the source was encrypted, which is a real, security-relevant difference from the source file. A source requiring a real (non-empty) password throws PdfPasswordRequiredError from readPdf/openPdf itself, before this editor ever sees a LayoutDocument to wrap.
export class PdfEditor {
  private readonly doc: LayoutDocument;

  constructor(doc: LayoutDocument) {
    this.doc = doc;
  }

  get metadata(): LayoutMetadata {
    return this.doc.metadata;
  }

  set metadata(value: LayoutMetadata) {
    this.doc.metadata = value;
  }

  // Every page, in document order -- a fresh PdfPage wrapper every call, never cached, exactly matching every other editor family in this package (DocxEditor.paragraphs(), OdgEditor.pages()): each wrapper holds a live reference into the actual LayoutPage object inside doc.pages, so mutating through one and re-reading through a freshly obtained wrapper from a later call observes the same change.
  pages(): PdfPage[] {
    return this.doc.pages.map((page) => new PdfPage(this.doc.pages, page, this.doc.images));
  }

  page(index: number): PdfPage | undefined {
    const node = this.doc.pages[index];
    return node === undefined ? undefined : new PdfPage(this.doc.pages, node, this.doc.images);
  }

  appendPage(init?: PageInit): PdfPage {
    const page = buildPage(init);
    this.doc.pages.push(page);
    return new PdfPage(this.doc.pages, page, this.doc.images);
  }

  insertPageAt(index: number, init?: PageInit): PdfPage {
    const page = buildPage(init);
    const insertAt = Math.min(Math.max(index, 0), this.doc.pages.length);
    this.doc.pages.splice(insertAt, 0, page);
    return new PdfPage(this.doc.pages, page, this.doc.images);
  }

  toLayoutDocument(): LayoutDocument {
    return this.doc;
  }

  toBytes(options?: WritePdfOptions): Uint8Array<ArrayBuffer> {
    return writePdf(this.doc, options);
  }
}

// Parses `bytes` via pdf-codec's own readPdf and wraps the result as the one live, mutable LayoutDocument this editor and every PdfPage/PdfItem it hands out share.
//
// SECURITY NOTE: if `bytes` is encrypted with the PDF standard security handler and an empty user password (the common "restrict editing, not reading" case), readPdf decrypts it transparently and this call succeeds with a perfectly ordinary-looking PdfEditor -- there is no field on the resulting document recording that this happened. toBytes() on the returned editor writes a plain, UNENCRYPTED PDF regardless, even though the source was encrypted. A caller that needs to preserve or re-apply the source's encryption must do so itself; this editor has no re-encryption path at all. A source requiring a real (non-empty) password throws PdfPasswordRequiredError, and one using an unsupported security handler throws PdfEncryptedError, both from readPdf itself before this function returns.
export function openPdf(bytes: Uint8Array<ArrayBuffer>, options?: ReadPdfOptions): PdfEditor {
  return new PdfEditor(readPdf(bytes, options));
}

export interface CreatePdfOptions {
  readonly widthPt?: number;
  readonly heightPt?: number;
  readonly clock?: ClockPort;
}

// Creates a fresh PDF with one default-sized (US Letter unless widthPt/heightPt override it) blank page and real metadata creation/modification timestamps -- mirrors createDocx's own default-on clock behaviour exactly (src/edit/docx/editor.ts), even though LayoutDocument's timestamps have nowhere format-specific to land the way docProps/core.xml or office:meta do: they simply are LayoutMetadata.createdIso/modifiedIso, read back by writePdf into the output PDF's own /CreationDate and /ModDate.
export function createPdf(options?: CreatePdfOptions): PdfEditor {
  const clock = options?.clock ?? systemClock;
  const metadata = resolveMetadataTimestamps({}, clock);
  const doc: LayoutDocument = {
    formatVersion: LAYOUT_FORMAT_VERSION,
    metadata,
    pages: [buildPage({ widthPt: options?.widthPt, heightPt: options?.heightPt })],
    images: {},
  };
  return new PdfEditor(doc);
}
