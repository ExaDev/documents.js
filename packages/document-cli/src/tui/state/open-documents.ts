import { mutate, withStatus, wrongDocument } from "./reducer";
import type {
  AppState,
  DocOpenDocument,
  DocxOpenDocument,
  MarkdownOpenDocument,
  OdgOpenDocument,
  OdpOpenDocument,
  OdsOpenDocument,
  OdtOpenDocument,
  PdfOpenDocument,
  PptOpenDocument,
  PptxOpenDocument,
  XlsOpenDocument,
} from "./types.js";
import {
  type PdfEllipseItem,
  type PdfImageItem,
  type PdfInternalLinkItem,
  type PdfItem,
  type PdfLineItem,
  type PdfLinkItem,
  type PdfPage,
  type PdfPathItem,
  type PdfRectItem,
  type PdfTextItem,
} from "documents.js";
// The per-format open-document constructors of the TUI reducer, split from reducer.ts: the open-document type family and the shape each source format (docx, odt, pptx, ods, odg, pdf, vector hosts) takes in application state. reducer.ts keeps the reducer switch and the mutation helpers.
// The genuinely format-agnostic paragraph/run/table actions (APPEND_PARAGRAPH, SET_RUN_TEXT, TOGGLE_RUN_BOLD/ITALIC, APPEND_RUN, APPEND_TABLE, SET_TABLE_CELL_TEXT, ADD_LIST_ITEM's own non-odt branch) resolve through this widened union — documents.js's MarkdownParagraph/MarkdownRun/MarkdownTable share exactly the subset of DocxParagraph/DocxRun/DocxTable's own shape those actions touch (text/bold/italic, appendRun/appendParagraph/appendTable). `styledWordprocessingDocument` below is the narrower, pre-markdown version of this same idea, kept for the actions that touch a field only docx/odt runs/paragraphs actually have (underline, colour, font family/size, alignment).
export type WordprocessingOpenDocument =
  DocxOpenDocument | OdtOpenDocument | MarkdownOpenDocument | DocOpenDocument;
// The rich pptx/odp surface (slides carrying tables, images, the full shape editor API) versus the wider presentation union that also admits ppt, whose PptSlide carries the text-box/notes subset every presentation action shares.
export type RichPresentationOpenDocument = PptxOpenDocument | OdpOpenDocument;
export type PresentationOpenDocument =
  RichPresentationOpenDocument | PptOpenDocument;
export type SpreadsheetOpenDocument = OdsOpenDocument | XlsOpenDocument;
export type ShapeHostOpenDocument =
  RichPresentationOpenDocument | OdgOpenDocument;

export function wordprocessingDocument(
  state: AppState,
): WordprocessingOpenDocument | undefined {
  const doc = state.openDocument;
  if (doc === undefined) {
    return undefined;
  }
  return doc.format === "docx" ||
    doc.format === "odt" ||
    doc.format === "markdown" ||
    doc.format === "doc"
    ? doc
    : undefined;
}

// The narrow counterpart to wordprocessingDocument above — for actions that need a real per-run/per-paragraph styling field (underline, colour, font family/size, alignment) MarkdownRun/MarkdownParagraph simply do not carry, rather than a markdown branch that would have nothing to do. doc carries the full set (doc-codec's writer round-trips every one of those fields), so it joins docx/odt here.
export function styledWordprocessingDocument(
  state: AppState,
): DocxOpenDocument | OdtOpenDocument | DocOpenDocument | undefined {
  const doc = state.openDocument;
  if (doc === undefined) {
    return undefined;
  }
  return doc.format === "docx" || doc.format === "odt" || doc.format === "doc"
    ? doc
    : undefined;
}

// The docx/odt-only narrowing, for the one paragraph-level API doc genuinely lacks: insertImageAfter (see INSERT_PARAGRAPH_IMAGE's own comment).
export function docxOdtDocument(
  state: AppState,
): DocxOpenDocument | OdtOpenDocument | undefined {
  const doc = state.openDocument;
  if (doc === undefined) {
    return undefined;
  }
  return doc.format === "docx" || doc.format === "odt" ? doc : undefined;
}

export function richPresentationDocument(
  state: AppState,
): RichPresentationOpenDocument | undefined {
  const doc = state.openDocument;
  if (doc === undefined) {
    return undefined;
  }
  return doc.format === "pptx" || doc.format === "odp" ? doc : undefined;
}

export function presentationDocument(
  state: AppState,
): PresentationOpenDocument | undefined {
  const doc = state.openDocument;
  if (doc === undefined) {
    return undefined;
  }
  return doc.format === "pptx" || doc.format === "odp" || doc.format === "ppt"
    ? doc
    : undefined;
}

export function shapeHostDocument(
  state: AppState,
): ShapeHostOpenDocument | undefined {
  const doc = state.openDocument;
  if (doc === undefined) {
    return undefined;
  }
  return doc.format === "pptx" || doc.format === "odp" || doc.format === "odg"
    ? doc
    : undefined;
}

// OdsSheet and XlsSheet share the exact accessor subset the spreadsheet actions below touch (sheets()/addSheet(name), cell(row, column).value, printSettings) — the widened union lets one narrowing serve both, with the genuinely ods-only actions (a formula write, a floating image, mergeCells' rectangle API) narrowing further through withOdsSheet below.
export function spreadsheetDocument(
  state: AppState,
): SpreadsheetOpenDocument | undefined {
  const doc = state.openDocument;
  if (doc === undefined) {
    return undefined;
  }
  return doc.format === "ods" || doc.format === "xls" ? doc : undefined;
}

// The ods-only narrowing for actions whose sheet surface xls genuinely lacks: XlsCell.formula is getter-only (xls-codec's writer has no formula write path), XlsSheet has no addImage and no mergeCells rectangle API (an xls merge is colSpan/rowSpan set directly on the anchor cell).
export function odsDocument(state: AppState): OdsOpenDocument | undefined {
  const doc = state.openDocument;
  if (doc === undefined) {
    return undefined;
  }
  return doc.format === "ods" ? doc : undefined;
}

export function drawingDocument(state: AppState): OdgOpenDocument | undefined {
  const doc = state.openDocument;
  if (doc === undefined) {
    return undefined;
  }
  return doc.format === "odg" ? doc : undefined;
}

export function pdfDocument(state: AppState): PdfOpenDocument | undefined {
  const doc = state.openDocument;
  if (doc === undefined) {
    return undefined;
  }
  return doc.format === "pdf" ? doc : undefined;
}

export function pdfItemAt(
  doc: PdfOpenDocument,
  pageIndex: number,
  itemIndex: number,
): PdfItem | undefined {
  return doc.editor.page(pageIndex)?.items()[itemIndex];
}

// One page-scoped action per ADD_PDF_* case: resolves `pageIndex` against `editor.page()` (a real, live PdfPage), then mutates through it — the pdf-family counterpart to withSheet/withShape above.
export function withPdfPage(
  state: AppState,
  pageIndex: number,
  apply: (page: PdfPage) => void,
): AppState {
  const doc = pdfDocument(state);
  if (doc === undefined) {
    return wrongDocument(state, "a pdf document");
  }
  const page = doc.editor.page(pageIndex);
  if (page === undefined) {
    return withStatus(
      state,
      "warning",
      `There is no page at index ${pageIndex}`,
    );
  }
  return mutate(state, doc, () => {
    apply(page);
  });
}

// Resolves (pageIndex, itemIndex) fresh against the live editor on every dispatch — PdfPage.items() is a real, unambiguous enumeration accessor with no parity-mismatch risk (unlike OdgPage.vectors(), see actions.ts's own top-of-file note on why the odg vector actions carry a live object instead), so addressing by index alone is safe here. `guard` narrows to the one PdfItem subtype the calling action's own field set assumes; a mismatch (the item changed kind under a stale index, or the wrong action was dispatched for this row) reports a warning rather than silently touching the wrong fields.
export function withPdfItemMatching<T extends PdfItem>(
  state: AppState,
  pageIndex: number,
  itemIndex: number,
  guard: (item: PdfItem) => item is T,
  kindLabel: string,
  apply: (item: T) => void,
): AppState {
  const doc = pdfDocument(state);
  if (doc === undefined) {
    return wrongDocument(state, "a pdf document");
  }
  const item = pdfItemAt(doc, pageIndex, itemIndex);
  if (item === undefined) {
    return withStatus(
      state,
      "warning",
      `Page ${pageIndex} has no item at index ${itemIndex}`,
    );
  }
  if (!guard(item)) {
    return withStatus(
      state,
      "warning",
      `Item ${itemIndex} on page ${pageIndex} is a ${item.kind} item, not ${kindLabel}`,
    );
  }
  return mutate(state, doc, () => {
    apply(item);
  });
}

export const isPdfTextItem = (item: PdfItem): item is PdfTextItem =>
  item.kind === "text";
export const isPdfRectItem = (item: PdfItem): item is PdfRectItem =>
  item.kind === "rect";
export const isPdfEllipseItem = (item: PdfItem): item is PdfEllipseItem =>
  item.kind === "ellipse";
export const isPdfLineItem = (item: PdfItem): item is PdfLineItem =>
  item.kind === "line";
export const isPdfPathItem = (item: PdfItem): item is PdfPathItem =>
  item.kind === "path";
export const isPdfImageItem = (item: PdfItem): item is PdfImageItem =>
  item.kind === "image";
export const isPdfLinkItem = (item: PdfItem): item is PdfLinkItem =>
  item.kind === "link";
export const isPdfInternalLinkItem = (
  item: PdfItem,
): item is PdfInternalLinkItem => item.kind === "internalLink";

export type VectorHostOpenDocument = OdgOpenDocument | OdpOpenDocument;

// The odg-or-odp narrowing ADD_RECT/ADD_ELLIPSE/ADD_LINE/ADD_PATH share: odg hosts a vector primitive on a drawing page (OdgPage.addRect/etc, a real live-view class per kind), odp on a slide (OdpSlide.addVector, one generic method taking a real ContentVector) — see documents.js's own README architecture entry on why odp reuses odg's vector writer wholesale rather than duplicating it.
export function vectorHostDocument(
  state: AppState,
): VectorHostOpenDocument | undefined {
  const doc = state.openDocument;
  if (doc === undefined) {
    return undefined;
  }
  return doc.format === "odg" || doc.format === "odp" ? doc : undefined;
}
