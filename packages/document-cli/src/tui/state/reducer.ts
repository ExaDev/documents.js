import {
  bytesToBase64,
  decodeMarkdownText,
  encodeMarkdownText,
  openDocx,
  openMarkdown,
  openOdg,
  openOdp,
  openOds,
  openOdt,
  openPdf,
  openPptx,
  type DocxParagraph,
  type DocxRun,
  type DocxTable,
  type DocxTableCell,
  type MarkdownParagraph,
  type MarkdownRun,
  type MarkdownTable,
  type MarkdownTableCell,
  type OdpShape,
  type OdsSheet,
  type OdtParagraph,
  type OdtRun,
  type OdtTable,
  type OdtTableCell,
  type PdfEllipseItem,
  type PdfImageItem,
  type PdfItem,
  type PdfLineItem,
  type PdfInternalLinkItem,
  type PdfLinkItem,
  type PdfPage,
  type PdfPathItem,
  type PdfRectItem,
  type PdfTextItem,
  type PptxShape,
  type PptxTable,
  type MathMlNode,
} from "documents.js";
import { createNewDocument } from "../format/open-document.js";
import type { Action } from "./actions.js";
import {
  rootScreenForFormat,
  type AppState,
  type DocxOpenDocument,
  type EditableOpenDocument,
  type MarkdownOpenDocument,
  type OdgOpenDocument,
  type OdpOpenDocument,
  type OdsOpenDocument,
  type OdtOpenDocument,
  type OpenDocument,
  type OverlayName,
  type OverlayState,
  type PdfOpenDocument,
  type PptxOpenDocument,
  type StatusMessage,
  type WritableOpenDocument,
} from "./types.js";

// THIS REDUCER IS DELIBERATELY IMPURE FOR EVERY MUTATING ACTION, AND THAT IS THE DESIGN, NOT AN OVERSIGHT.
//
// documents.js's editors are live views over the mutable XML tree inside a decoded package: `run.bold = true` edits that tree in place and hands back no new object. There is no immutable document value to fold an action into and no new reference for React to compare, so a mutating case here calls the editor method that performs the real mutation and then returns a NEW OUTER STATE OBJECT (`{ ...state, hasUnsavedChanges: true, undoStack }`) purely so React sees a changed reference and re-renders the screens that read the document through fresh accessor calls. Re-running one of these actions against the same state does NOT produce the same result -- appending a paragraph twice appends two paragraphs. Do not add React StrictMode double-invocation, and do not replay actions.
//
// `Date.now()` in the status helper is impure for the same reason and to no lesser degree; a `ClockPort` would buy nothing while the mutations themselves are in here.

const UNDO_STACK_LIMIT = 20;

export function createInitialState(options?: {
  readonly cwd?: string;
}): AppState {
  return {
    stack: [{ kind: "launcher" }],
    openDocument: undefined,
    hasUnsavedChanges: false,
    overlays: {
      commandPalette: false,
      search: false,
      help: false,
      confirmQuit: false,
      confirmClose: false,
      diagnosticsPanel: false,
    },
    status: undefined,
    diagnostics: [],
    undoStack: [],
    selection: {},
    searchQuery: "",
    errorDetail: undefined,
    isExiting: false,
    cwd: options?.cwd ?? process.cwd(),
  };
}

function withStatus(
  state: AppState,
  severity: StatusMessage["severity"],
  text: string,
): AppState {
  return { ...state, status: { severity, text, createdAtMs: Date.now() } };
}

function setOverlay(
  overlays: OverlayState,
  overlay: OverlayName,
  open: boolean,
): OverlayState {
  switch (overlay) {
    case "commandPalette":
      return { ...overlays, commandPalette: open };
    case "search":
      return { ...overlays, search: open };
    case "help":
      return { ...overlays, help: open };
    case "confirmQuit":
      return { ...overlays, confirmQuit: open };
    case "confirmClose":
      return { ...overlays, confirmClose: open };
    case "diagnosticsPanel":
      return { ...overlays, diagnosticsPanel: open };
  }
}

function pushSnapshot(
  stack: readonly Uint8Array<ArrayBuffer>[],
  snapshot: Uint8Array<ArrayBuffer>,
): readonly Uint8Array<ArrayBuffer>[] {
  const next = [...stack, snapshot];
  return next.length > UNDO_STACK_LIMIT
    ? next.slice(next.length - UNDO_STACK_LIMIT)
    : next;
}

function documentWithPath(doc: OpenDocument, path: string): OpenDocument {
  switch (doc.format) {
    case "docx":
      return { format: "docx", editor: doc.editor, path };
    case "pptx":
      return { format: "pptx", editor: doc.editor, path };
    case "odt":
      return { format: "odt", editor: doc.editor, path };
    case "odp":
      return { format: "odp", editor: doc.editor, path };
    case "ods":
      return { format: "ods", editor: doc.editor, path };
    case "odg":
      return { format: "odg", editor: doc.editor, path };
    case "pdf":
      return { format: "pdf", editor: doc.editor, layout: doc.layout, path };
    case "odb":
      return {
        format: "odb",
        tables: doc.tables,
        forms: doc.forms,
        reports: doc.reports,
        path,
      };
    case "markdown":
      return {
        format: "markdown",
        editor: doc.editor,
        originalText: doc.originalText,
        path,
      };
    case "xlsx":
      return { format: "xlsx", layout: doc.layout, bytes: doc.bytes, path };
    case "csv":
      return { format: "csv", layout: doc.layout, bytes: doc.bytes, path };
    case "svg":
      return { format: "svg", layout: doc.layout, bytes: doc.bytes, path };
    case "rtf":
      return { format: "rtf", layout: doc.layout, bytes: doc.bytes, path };
    case "wpd":
      return { format: "wpd", layout: doc.layout, bytes: doc.bytes, path };
  }
}

function reopenEditable(
  doc: EditableOpenDocument,
  bytes: Uint8Array<ArrayBuffer>,
): EditableOpenDocument {
  switch (doc.format) {
    case "docx":
      return { format: "docx", editor: openDocx(bytes), path: doc.path };
    case "pptx":
      return { format: "pptx", editor: openPptx(bytes), path: doc.path };
    case "odt":
      return { format: "odt", editor: openOdt(bytes), path: doc.path };
    case "odp":
      return { format: "odp", editor: openOdp(bytes), path: doc.path };
    case "ods":
      return { format: "ods", editor: openOds(bytes), path: doc.path };
    case "odg":
      return { format: "odg", editor: openOdg(bytes), path: doc.path };
    case "pdf": {
      const editor = openPdf(bytes);
      return {
        format: "pdf",
        editor,
        layout: editor.toLayoutDocument(),
        path: doc.path,
      };
    }
  }
}

// markdown's own MarkdownEditor has no toBytes() at all (bytes are incidental to markdown -- see MarkdownOpenDocument's own doc comment): its undo snapshot is the encoded text `toMarkdownText()` produces right now, the same byte<->text boundary every other markdown-touching call site in this codebase (openDocumentAtPath, saveDocumentTo, exportToPdf) already uses.
function toUndoSnapshot(doc: WritableOpenDocument): Uint8Array<ArrayBuffer> {
  return doc.format === "markdown"
    ? encodeMarkdownText(doc.editor.toMarkdownText())
    : doc.editor.toBytes();
}

// Snapshot BEFORE the mutation runs, so the pushed entry is the state to come back to, then run the mutation against the live tree and hand React a fresh outer object. Takes any WritableOpenDocument, not just EditableOpenDocument, so markdown's own live-view MarkdownEditor shares this exact undo/mutate machinery with zero format-specific reducer code of its own -- see toUndoSnapshot above for the one place the two byte<->text boundaries genuinely differ.
function mutate(
  state: AppState,
  doc: WritableOpenDocument,
  apply: () => void,
): AppState {
  const snapshot = toUndoSnapshot(doc);
  apply();
  return {
    ...state,
    hasUnsavedChanges: true,
    undoStack: pushSnapshot(state.undoStack, snapshot),
  };
}

// mutate()'s own counterpart for an `apply` that can genuinely fail on bad caller input rather than only on a routing bug -- a merge rectangle that overruns a table/sheet's own bounds throws a real Error from documents.js's own mergeCells primitives (OdsSheet.mergeCells, DocxTable.mergeCells, OdtTable.mergeCells, this file's own mergePptxTableCells), and the UI screens that dispatch these actions bound their own row/column pickers against the target's current dimensions but cannot guarantee every dispatch stays in range (e.g. a screen driven by a scripted/test caller, or a race with a concurrent edit). Reports the thrown message as a warning status instead of letting it escape the reducer and crash the app. If `apply` throws after partially mutating the live tree (e.g. a docx table's own row-by-row mergeCells loop merging row 0 successfully before finding row 1 out of range), that partial mutation genuinely already happened -- this only prevents the crash and the false "nothing changed" undo-stack/hasUnsavedChanges bookkeeping, it does not roll the live tree back, matching the "the reducer is deliberately impure" caveat at the top of this file.
function mutateGuarded(
  state: AppState,
  doc: WritableOpenDocument,
  apply: () => void,
): AppState {
  try {
    return mutate(state, doc, apply);
  } catch (error) {
    return withStatus(
      state,
      "warning",
      error instanceof Error ? error.message : String(error),
    );
  }
}

// The pptx-side counterpart to DocxTable.mergeCells/OdtTable.mergeCells: a DrawingML table has no such convenience on PptxTable itself (see documents.js's own edit/pptx/table.ts doc comment -- every row always carries exactly `columns` a:tc elements, and a merge is expressed purely via gridSpan/rowSpan/hMerge/vMerge attributes on cells that already exist, never by removing or retagging an element the way docx/ODF each do). The anchor cell gets colSpan/rowSpan; every other cell in the rectangle gets horizontalMerge (covered from the left, in the SAME row) and/or verticalMerge (covered from above) set, matching real PowerPoint output for a rectangular merge's interior/trailing cells (both attributes set together).
function mergePptxTableCells(
  table: PptxTable,
  startRow: number,
  startColumn: number,
  rowSpan: number,
  colSpan: number,
): void {
  if (
    !Number.isInteger(rowSpan) ||
    rowSpan < 1 ||
    !Number.isInteger(colSpan) ||
    colSpan < 1
  ) {
    throw new Error(
      `mergeSlideTableCells: rowSpan and colSpan must be positive integers, got rowSpan=${rowSpan}, colSpan=${colSpan}`,
    );
  }
  const rows = table.rows();
  if (startRow + rowSpan > rows.length) {
    throw new Error(
      `mergeSlideTableCells: rowSpan ${rowSpan} starting at row ${startRow} exceeds this table's own ${rows.length} rows`,
    );
  }
  const anchorRow = rows[startRow];
  if (anchorRow === undefined) {
    throw new Error(
      `mergeSlideTableCells: row ${startRow} does not exist in this table`,
    );
  }
  const columnCount = anchorRow.cells().length;
  if (startColumn + colSpan > columnCount) {
    throw new Error(
      `mergeSlideTableCells: colSpan ${colSpan} starting at column ${startColumn} exceeds this table's own ${columnCount} columns`,
    );
  }
  for (let rowOffset = 0; rowOffset < rowSpan; rowOffset++) {
    const row = rows[startRow + rowOffset];
    if (row === undefined) {
      throw new Error(
        `mergeSlideTableCells: row ${startRow + rowOffset} does not exist in this table`,
      );
    }
    const cells = row.cells();
    for (let columnOffset = 0; columnOffset < colSpan; columnOffset++) {
      const cell = cells[startColumn + columnOffset];
      if (cell === undefined) {
        throw new Error(
          `mergeSlideTableCells: column ${startColumn + columnOffset} does not exist in row ${startRow + rowOffset}`,
        );
      }
      if (rowOffset === 0 && columnOffset === 0) {
        cell.colSpan = colSpan;
        cell.rowSpan = rowSpan;
        continue;
      }
      if (columnOffset > 0) {
        cell.horizontalMerge = true;
      }
      if (rowOffset > 0) {
        cell.verticalMerge = true;
      }
    }
  }
}

function wrongDocument(state: AppState, expected: string): AppState {
  const actual =
    state.openDocument === undefined
      ? "no document"
      : state.openDocument.format;
  return withStatus(
    state,
    "warning",
    `That action needs ${expected}; the open document is ${actual}`,
  );
}

// The genuinely format-agnostic paragraph/run/table actions (APPEND_PARAGRAPH, SET_RUN_TEXT, TOGGLE_RUN_BOLD/ITALIC, APPEND_RUN, APPEND_TABLE, SET_TABLE_CELL_TEXT, ADD_LIST_ITEM's own non-odt branch) resolve through this widened union -- documents.js's MarkdownParagraph/MarkdownRun/MarkdownTable share exactly the subset of DocxParagraph/DocxRun/DocxTable's own shape those actions touch (text/bold/italic, appendRun/appendParagraph/appendTable). `styledWordprocessingDocument` below is the narrower, pre-markdown version of this same idea, kept for the actions that touch a field only docx/odt runs/paragraphs actually have (underline, colour, font family/size, alignment).
type WordprocessingOpenDocument =
  DocxOpenDocument | OdtOpenDocument | MarkdownOpenDocument;
type PresentationOpenDocument = PptxOpenDocument | OdpOpenDocument;
type ShapeHostOpenDocument = PresentationOpenDocument | OdgOpenDocument;

function wordprocessingDocument(
  state: AppState,
): WordprocessingOpenDocument | undefined {
  const doc = state.openDocument;
  if (doc === undefined) {
    return undefined;
  }
  return doc.format === "docx" ||
    doc.format === "odt" ||
    doc.format === "markdown"
    ? doc
    : undefined;
}

// The narrow, docx/odt-only counterpart to wordprocessingDocument above -- for actions that need a real per-run/per-paragraph styling field (underline, colour, font family/size, alignment) MarkdownRun/MarkdownParagraph simply do not carry, rather than a markdown branch that would have nothing to do.
function styledWordprocessingDocument(
  state: AppState,
): DocxOpenDocument | OdtOpenDocument | undefined {
  const doc = state.openDocument;
  if (doc === undefined) {
    return undefined;
  }
  return doc.format === "docx" || doc.format === "odt" ? doc : undefined;
}

function presentationDocument(
  state: AppState,
): PresentationOpenDocument | undefined {
  const doc = state.openDocument;
  if (doc === undefined) {
    return undefined;
  }
  return doc.format === "pptx" || doc.format === "odp" ? doc : undefined;
}

function shapeHostDocument(state: AppState): ShapeHostOpenDocument | undefined {
  const doc = state.openDocument;
  if (doc === undefined) {
    return undefined;
  }
  return doc.format === "pptx" || doc.format === "odp" || doc.format === "odg"
    ? doc
    : undefined;
}

function spreadsheetDocument(state: AppState): OdsOpenDocument | undefined {
  const doc = state.openDocument;
  if (doc === undefined) {
    return undefined;
  }
  return doc.format === "ods" ? doc : undefined;
}

function drawingDocument(state: AppState): OdgOpenDocument | undefined {
  const doc = state.openDocument;
  if (doc === undefined) {
    return undefined;
  }
  return doc.format === "odg" ? doc : undefined;
}

function pdfDocument(state: AppState): PdfOpenDocument | undefined {
  const doc = state.openDocument;
  if (doc === undefined) {
    return undefined;
  }
  return doc.format === "pdf" ? doc : undefined;
}

function pdfItemAt(
  doc: PdfOpenDocument,
  pageIndex: number,
  itemIndex: number,
): PdfItem | undefined {
  return doc.editor.page(pageIndex)?.items()[itemIndex];
}

// One page-scoped action per ADD_PDF_* case: resolves `pageIndex` against `editor.page()` (a real, live PdfPage), then mutates through it -- the pdf-family counterpart to withSheet/withShape above.
function withPdfPage(
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

// Resolves (pageIndex, itemIndex) fresh against the live editor on every dispatch -- PdfPage.items() is a real, unambiguous enumeration accessor with no parity-mismatch risk (unlike OdgPage.vectors(), see actions.ts's own top-of-file note on why the odg vector actions carry a live object instead), so addressing by index alone is safe here. `guard` narrows to the one PdfItem subtype the calling action's own field set assumes; a mismatch (the item changed kind under a stale index, or the wrong action was dispatched for this row) reports a warning rather than silently touching the wrong fields.
function withPdfItemMatching<T extends PdfItem>(
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

const isPdfTextItem = (item: PdfItem): item is PdfTextItem =>
  item.kind === "text";
const isPdfRectItem = (item: PdfItem): item is PdfRectItem =>
  item.kind === "rect";
const isPdfEllipseItem = (item: PdfItem): item is PdfEllipseItem =>
  item.kind === "ellipse";
const isPdfLineItem = (item: PdfItem): item is PdfLineItem =>
  item.kind === "line";
const isPdfPathItem = (item: PdfItem): item is PdfPathItem =>
  item.kind === "path";
const isPdfImageItem = (item: PdfItem): item is PdfImageItem =>
  item.kind === "image";
const isPdfLinkItem = (item: PdfItem): item is PdfLinkItem =>
  item.kind === "link";
const isPdfInternalLinkItem = (item: PdfItem): item is PdfInternalLinkItem =>
  item.kind === "internalLink";

type VectorHostOpenDocument = OdgOpenDocument | OdpOpenDocument;

// The odg-or-odp narrowing ADD_RECT/ADD_ELLIPSE/ADD_LINE/ADD_PATH share: odg hosts a vector primitive on a drawing page (OdgPage.addRect/etc, a real live-view class per kind), odp on a slide (OdpSlide.addVector, one generic method taking a real ContentVector) -- see documents.js's own README architecture entry on why odp reuses odg's vector writer wholesale rather than duplicating it.
function vectorHostDocument(
  state: AppState,
): VectorHostOpenDocument | undefined {
  const doc = state.openDocument;
  if (doc === undefined) {
    return undefined;
  }
  return doc.format === "odg" || doc.format === "odp" ? doc : undefined;
}

function paragraphAt(
  doc: WordprocessingOpenDocument,
  blockIndex: number,
): DocxParagraph | OdtParagraph | MarkdownParagraph | undefined {
  return doc.editor.paragraphs()[blockIndex];
}

function tableAt(
  doc: WordprocessingOpenDocument,
  tableIndex: number,
): DocxTable | OdtTable | MarkdownTable | undefined {
  return doc.editor.tables()[tableIndex];
}

// The universal cell lookup every table kind supports, used in place of DocxTable/OdtTable's own `.cell(row, column)` shortcut -- MarkdownTable has no such shortcut (only `rows()`/`appendRow()`/`remove()`), so SET_TABLE_CELL_TEXT resolves a cell through the one traversal all three genuinely share.
function tableCellAt(
  table: DocxTable | OdtTable | MarkdownTable,
  row: number,
  column: number,
): DocxTableCell | OdtTableCell | MarkdownTableCell | undefined {
  return table.rows()[row]?.cells()[column];
}

function shapeAt(
  doc: ShapeHostOpenDocument,
  containerIndex: number,
  shapeIndex: number,
): PptxShape | OdpShape | undefined {
  if (doc.format === "odg") {
    return doc.editor.pages()[containerIndex]?.shapes()[shapeIndex];
  }
  return doc.editor.slides()[containerIndex]?.shapes()[shapeIndex];
}

function sheetAt(
  doc: OdsOpenDocument,
  sheetIndex: number,
): OdsSheet | undefined {
  return doc.editor.sheets()[sheetIndex];
}

function withRun(
  state: AppState,
  blockIndex: number,
  runIndex: number,
  apply: (run: DocxRun | OdtRun | MarkdownRun) => void,
): AppState {
  const doc = wordprocessingDocument(state);
  if (doc === undefined) {
    return wrongDocument(state, "a docx, odt or markdown document");
  }
  const paragraph = paragraphAt(doc, blockIndex);
  if (paragraph === undefined) {
    return withStatus(
      state,
      "warning",
      `There is no paragraph at index ${blockIndex}`,
    );
  }
  const run = paragraph.runs()[runIndex];
  if (run === undefined) {
    return withStatus(
      state,
      "warning",
      `Paragraph ${blockIndex} has no run at index ${runIndex}`,
    );
  }
  return mutate(state, doc, () => {
    apply(run);
  });
}

// withRun's narrow, docx/odt-only counterpart -- for TOGGLE_RUN_UNDERLINE/SET_RUN_COLOR/SET_RUN_FONT_FAMILY/SET_RUN_FONT_SIZE, none of which MarkdownRun has a field for at all (it carries bold/italic/strike/hyperlink/code, not underline/colour/fontFamily/sizePt).
function withStyledRun(
  state: AppState,
  blockIndex: number,
  runIndex: number,
  apply: (run: DocxRun | OdtRun) => void,
): AppState {
  const doc = styledWordprocessingDocument(state);
  if (doc === undefined) {
    return wrongDocument(state, "a docx or odt document");
  }
  const paragraph = doc.editor.paragraphs()[blockIndex];
  if (paragraph === undefined) {
    return withStatus(
      state,
      "warning",
      `There is no paragraph at index ${blockIndex}`,
    );
  }
  const run = paragraph.runs()[runIndex];
  if (run === undefined) {
    return withStatus(
      state,
      "warning",
      `Paragraph ${blockIndex} has no run at index ${runIndex}`,
    );
  }
  return mutate(state, doc, () => {
    apply(run);
  });
}

function withShape(
  state: AppState,
  containerIndex: number,
  shapeIndex: number,
  apply: (shape: PptxShape | OdpShape) => void,
): AppState {
  const doc = shapeHostDocument(state);
  if (doc === undefined) {
    return wrongDocument(state, "a pptx, odp or odg document");
  }
  const shape = shapeAt(doc, containerIndex, shapeIndex);
  if (shape === undefined) {
    return withStatus(
      state,
      "warning",
      `There is no shape ${shapeIndex} on ${doc.format === "odg" ? "page" : "slide"} ${containerIndex}`,
    );
  }
  return mutate(state, doc, () => {
    apply(shape);
  });
}

function withSheet(
  state: AppState,
  sheetIndex: number,
  apply: (sheet: OdsSheet) => void,
): AppState {
  const doc = spreadsheetDocument(state);
  if (doc === undefined) {
    return wrongDocument(state, "an ods document");
  }
  const sheet = sheetAt(doc, sheetIndex);
  if (sheet === undefined) {
    return withStatus(
      state,
      "warning",
      `There is no sheet at index ${sheetIndex}`,
    );
  }
  return mutate(state, doc, () => {
    apply(sheet);
  });
}

// The small structural shape a "replace this container's whole text" write needs -- satisfied by DocxTableCell/OdtTableCell (paragraphs()/appendParagraph()) and equally by OdtListItem (the identical paragraphs()/appendParagraph() pair, see documents.js's src/edit/odt/list.ts), even though a table cell and a list item share no common base class or interface of their own.
interface TextRunLike {
  text: string;
  remove(): void;
}
interface TextParagraphLike {
  runs(): readonly TextRunLike[];
  appendRun(init: { readonly text: string }): unknown;
}
interface TextContainerLike {
  paragraphs(): readonly TextParagraphLike[];
  appendParagraph(): TextParagraphLike;
}

// A container's text is replaced rather than appended: documents.js gives a table cell or list item `paragraphs()`/`appendParagraph()` and a read-only `text`, so the first paragraph's first run carries the new value and any further runs in it are removed. Generalised from a docx/odt-table-cell-only helper so SET_LIST_ITEM_TEXT can reuse the identical template against an OdtListItem.
function setTextContainerText(
  container: TextContainerLike,
  text: string,
): void {
  const existing = container.paragraphs();
  const first = existing[0];
  const paragraph = first ?? container.appendParagraph();
  const runs = paragraph.runs();
  const firstRun = runs[0];
  if (firstRun === undefined) {
    paragraph.appendRun({ text });
    return;
  }
  firstRun.text = text;
  for (const extra of runs.slice(1)) {
    extra.remove();
  }
}

function setCellText(
  cell: DocxTableCell | OdtTableCell | MarkdownTableCell,
  text: string,
): void {
  setTextContainerText(cell, text);
}

// documents.js's own MathMlNode (src/mathml/nodes.ts, what INSERT_ODT_FORMULA's own action field is typed with, matching appendOfficeMath's identical parameter type) declares every array field `readonly` -- but ContentFormula.mathml (document-schema.js's own, separately hand-written MathMlNode, what OdtBody.appendFormula's own `formula` parameter actually requires) declares the identical fields as plain mutable arrays. The two describe the same JSON shape at runtime; TypeScript still refuses a `readonly T[]` value at a `T[]`-typed target, at every nesting level (attributes, children), so a shallow spread of the top-level array is not enough. This rebuilds the tree as fresh, genuinely mutable objects/arrays, structurally satisfying document-schema.js's MathMlNode with no cast. documents.js's own MathMlNode collapses the cdata/comment/declaration/pi variants down to a bare `{ type }` with none of their other fields (that module's own doc comment: "MathML content never meaningfully contains any of them"), so there is nothing to carry across for those four kinds -- document-schema.js's schema still requires one, so an empty stand-in is supplied; neither a hand-authored preset (formula-presets.ts) nor a real parsed MathML formula ever produces one of these kinds in practice.
interface MutableMathMlAttribute {
  readonly name: string;
  readonly value: string;
}
type MutableMathMlNode =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "cdata"; readonly value: string }
  | { readonly type: "comment"; readonly value: string }
  | {
      readonly type: "declaration";
      readonly attributes: MutableMathMlAttribute[];
    }
  | { readonly type: "pi"; readonly target: string; readonly content: string }
  | {
      readonly type: "element";
      readonly tag: string;
      readonly attributes: MutableMathMlAttribute[];
      readonly children: MutableMathMlNode[];
    };

function mutableMathMlNode(node: MathMlNode): MutableMathMlNode {
  if (node.type === "element") {
    return {
      type: "element",
      tag: node.tag,
      attributes: [...node.attributes],
      children: node.children.map(mutableMathMlNode),
    };
  }
  if (node.type === "text") {
    return { type: "text", value: node.value };
  }
  if (node.type === "cdata" || node.type === "comment") {
    return { type: node.type, value: "" };
  }
  if (node.type === "declaration") {
    return { type: "declaration", attributes: [] };
  }
  return { type: "pi", target: "", content: "" };
}

export function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "PUSH_SCREEN":
      return { ...state, stack: [...state.stack, action.screen] };

    case "POP_SCREEN":
      return state.stack.length <= 1
        ? state
        : { ...state, stack: state.stack.slice(0, -1) };

    case "RESET_STACK":
      return { ...state, stack: [action.screen] };

    case "OPEN_OVERLAY":
      return {
        ...state,
        overlays: setOverlay(state.overlays, action.overlay, true),
      };

    case "CLOSE_OVERLAY":
      return {
        ...state,
        overlays: setOverlay(state.overlays, action.overlay, false),
      };

    case "REQUEST_QUIT":
      return state.hasUnsavedChanges
        ? {
            ...state,
            overlays: setOverlay(state.overlays, "confirmQuit", true),
          }
        : { ...state, isExiting: true };

    case "CONFIRM_QUIT":
      return {
        ...state,
        overlays: setOverlay(state.overlays, "confirmQuit", false),
        isExiting: true,
      };

    case "CANCEL_QUIT":
      return {
        ...state,
        overlays: setOverlay(state.overlays, "confirmQuit", false),
      };

    case "REQUEST_CLOSE":
      if (state.openDocument === undefined) {
        return withStatus(state, "info", "There is no open document to close");
      }
      return state.hasUnsavedChanges
        ? {
            ...state,
            overlays: setOverlay(state.overlays, "confirmClose", true),
          }
        : closeDocument(state);

    case "CONFIRM_CLOSE":
      return closeDocument({
        ...state,
        overlays: setOverlay(state.overlays, "confirmClose", false),
      });

    case "CANCEL_CLOSE":
      return {
        ...state,
        overlays: setOverlay(state.overlays, "confirmClose", false),
      };

    case "CLOSE_DOCUMENT":
      return closeDocument(state);

    // The stack reset lives here rather than in a separate RESET_STACK the caller has to remember: an opened document always lands on its own format's root screen, and splitting that across two dispatches only creates a frame where the two disagree.
    case "OPEN_FILE_SUCCESS":
      return withStatus(
        {
          ...state,
          openDocument: action.doc,
          hasUnsavedChanges: false,
          undoStack: [],
          selection: {},
          errorDetail: undefined,
          stack: [rootScreenForFormat(action.doc.format)],
        },
        "info",
        // xlsx, csv, svg, rtf, and wpd have no editor to open at all -- action.doc is already a read-only PDF-preview conversion by the time it reaches here (see format/open-document.ts) -- so these are the formats whose "opened" message doubles as pointing the way to the one thing that can actually be done with them next.
        action.doc.format === "xlsx" ||
          action.doc.format === "csv" ||
          action.doc.format === "svg" ||
          action.doc.format === "rtf" ||
          action.doc.format === "wpd"
          ? `Opened ${action.path} as a read-only PDF preview -- press ':' then 'export pdf' to save it as a real PDF`
          : `Opened ${action.path}`,
      );

    case "OPEN_FILE_ERROR":
      return withStatus(
        {
          ...state,
          errorDetail: { message: action.message, detail: action.detail },
        },
        "error",
        action.message,
      );

    case "CREATE_DOCUMENT": {
      const doc = createNewDocument(action.format);
      return withStatus(
        {
          ...state,
          openDocument: doc,
          hasUnsavedChanges: false,
          undoStack: [],
          selection: {},
          errorDetail: undefined,
          stack: [rootScreenForFormat(action.format)],
        },
        "info",
        `New ${action.format} document`,
      );
    }

    case "SAVE_SUCCESS": {
      const doc = state.openDocument;
      if (doc === undefined) {
        return withStatus(
          state,
          "warning",
          "Saved, but there is no open document to record the path against",
        );
      }
      return withStatus(
        {
          ...state,
          openDocument: documentWithPath(doc, action.path),
          hasUnsavedChanges: false,
        },
        "info",
        `Saved ${action.path}`,
      );
    }

    case "SAVE_ERROR":
      return withStatus(state, "error", action.message);

    case "SAVE_AS_REQUEST":
      return { ...state, stack: [...state.stack, { kind: "saveAsPrompt" }] };

    case "SET_SELECTION":
      return {
        ...state,
        selection: { ...state.selection, [action.key]: action.index },
      };

    // `alignment` is set through the shared body.appendParagraph call for docx/odt, but MarkdownParagraphInit has no alignment field at all (CommonMark/GFM has no per-paragraph alignment construct) -- so a markdown document drops it here rather than the wordprocessing union call silently disagreeing about which ParagraphInit shape it is.
    case "APPEND_PARAGRAPH": {
      const doc = wordprocessingDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "a docx, odt or markdown document");
      }
      return mutate(state, doc, () => {
        if (doc.format === "markdown") {
          doc.editor.body.appendParagraph({
            text: action.text,
            styleId: action.styleId,
          });
          return;
        }
        doc.editor.body.appendParagraph({
          text: action.text,
          styleId: action.styleId,
          alignment: action.alignment,
        });
      });
    }

    // Narrowed to docx/odt specifically (not the wider wordprocessingDocument union): MarkdownParagraph has no `.alignment` at all.
    case "SET_PARAGRAPH_ALIGNMENT": {
      const doc = styledWordprocessingDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "a docx or odt document");
      }
      const paragraph = doc.editor.paragraphs()[action.blockIndex];
      if (paragraph === undefined) {
        return withStatus(
          state,
          "warning",
          `There is no paragraph at index ${action.blockIndex}`,
        );
      }
      return mutate(state, doc, () => {
        paragraph.alignment = action.alignment;
      });
    }

    case "APPEND_RUN": {
      const doc = wordprocessingDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "a docx, odt or markdown document");
      }
      const paragraph = paragraphAt(doc, action.blockIndex);
      if (paragraph === undefined) {
        return withStatus(
          state,
          "warning",
          `There is no paragraph at index ${action.blockIndex}`,
        );
      }
      return mutate(state, doc, () => {
        paragraph.appendRun({ text: action.text });
      });
    }

    case "SET_RUN_TEXT":
      return withRun(state, action.blockIndex, action.runIndex, (run) => {
        run.text = action.text;
      });

    case "TOGGLE_RUN_BOLD":
      return withRun(state, action.blockIndex, action.runIndex, (run) => {
        run.bold = !run.bold;
      });

    case "TOGGLE_RUN_ITALIC":
      return withRun(state, action.blockIndex, action.runIndex, (run) => {
        run.italic = !run.italic;
      });

    // Narrowed to docx/odt (withStyledRun, not withRun): MarkdownRun has no underline field at all.
    case "TOGGLE_RUN_UNDERLINE":
      return withStyledRun(state, action.blockIndex, action.runIndex, (run) => {
        run.underline = !run.underline;
      });

    // Narrowed to docx/odt: MarkdownRun has no colour field at all.
    case "SET_RUN_COLOR":
      return withStyledRun(state, action.blockIndex, action.runIndex, (run) => {
        run.color = action.color;
      });

    // Narrowed to docx/odt: MarkdownRun has no font-family field at all.
    case "SET_RUN_FONT_FAMILY":
      return withStyledRun(state, action.blockIndex, action.runIndex, (run) => {
        run.fontFamily = action.fontFamily;
      });

    // Narrowed to docx/odt: MarkdownRun has no font-size field at all.
    case "SET_RUN_FONT_SIZE":
      return withStyledRun(state, action.blockIndex, action.runIndex, (run) => {
        run.sizePt = action.sizePt;
      });

    // MarkdownTable has no mergeCells at all -- GFM tables have no cell-merge concept -- so a merge requested against a freshly-created markdown table still creates the (unmerged) table and reports why the merge itself didn't happen, rather than either silently dropping the merge or refusing to create the table at all.
    case "APPEND_TABLE": {
      const doc = wordprocessingDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "a docx, odt or markdown document");
      }
      // A property on a const holder, not a bare `let`: the only write is inside the mutateGuarded callback below, and TypeScript ignores assignments made in a nested function when narrowing the enclosing scope -- so a `let` would read as `false` at the check and the warning branch would look statically dead while genuinely firing.
      const merge = { unsupported: false };
      const nextState = mutateGuarded(state, doc, () => {
        const table = doc.editor.body.appendTable({
          rows: action.rows,
          columns: action.columns,
        });
        if (action.merge === undefined) {
          return;
        }
        if (!("mergeCells" in table)) {
          merge.unsupported = true;
          return;
        }
        table.mergeCells(
          action.merge.startRow,
          action.merge.startColumn,
          action.merge.rowSpan,
          action.merge.colSpan,
        );
      });
      return merge.unsupported
        ? withStatus(
            nextState,
            "warning",
            "Markdown tables do not support merged cells -- the table was created without merging",
          )
        : nextState;
    }

    // MarkdownTable has no mergeCells at all (see APPEND_TABLE above) -- resolved through the wide wordprocessingDocument union so the table lookup itself stays generic, with the same in-narrowing decline for a markdown table specifically.
    case "MERGE_TABLE_CELLS": {
      const doc = wordprocessingDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "a docx, odt or markdown document");
      }
      const table = tableAt(doc, action.tableIndex);
      if (table === undefined) {
        return withStatus(
          state,
          "warning",
          `There is no table at index ${action.tableIndex}`,
        );
      }
      if (!("mergeCells" in table)) {
        return withStatus(
          state,
          "warning",
          "Markdown tables do not support merged cells",
        );
      }
      return mutateGuarded(state, doc, () => {
        table.mergeCells(
          action.startRow,
          action.startColumn,
          action.rowSpan,
          action.colSpan,
        );
      });
    }

    case "SET_TABLE_CELL_TEXT": {
      const doc = wordprocessingDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "a docx, odt or markdown document");
      }
      const table = tableAt(doc, action.tableIndex);
      if (table === undefined) {
        return withStatus(
          state,
          "warning",
          `There is no table at index ${action.tableIndex}`,
        );
      }
      const cell = tableCellAt(table, action.row, action.column);
      if (cell === undefined) {
        return withStatus(
          state,
          "warning",
          `There is no cell at row ${action.row}, column ${action.column} of table ${action.tableIndex}`,
        );
      }
      return mutate(state, doc, () => {
        setCellText(cell, action.text);
      });
    }

    // ODF models a list as a real `text:list`/`text:list-item` tree, OOXML and markdown both as a flat per-paragraph numId/level membership -- so odt's own write path genuinely differs from docx/markdown's shared one. For odt the anchor block index selects which `text:list` to extend; for docx/markdown it selects the paragraph whose list membership a newly appended paragraph should copy.
    case "ADD_LIST_ITEM": {
      const doc = wordprocessingDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "a docx, odt or markdown document");
      }
      if (doc.format === "odt") {
        const list = doc.editor.lists()[action.blockIndex];
        if (list === undefined) {
          return withStatus(
            state,
            "warning",
            `There is no list at index ${action.blockIndex}`,
          );
        }
        return mutate(state, doc, () => {
          list.addItem().appendParagraph({ text: action.text });
        });
      }
      const anchor = doc.editor.paragraphs()[action.blockIndex];
      if (anchor === undefined) {
        return withStatus(
          state,
          "warning",
          `There is no paragraph at index ${action.blockIndex}`,
        );
      }
      const membership = anchor.list;
      if (membership === undefined) {
        return withStatus(
          state,
          "warning",
          `Paragraph ${action.blockIndex} is not part of a list`,
        );
      }
      return mutate(state, doc, () => {
        const appended = doc.editor.body.appendParagraph({ text: action.text });
        appended.list = membership;
      });
    }

    // odt-only, unlike ADD_LIST_ITEM: a list is a genuinely separate ODF concept (text:list/text:list-item) with no docx analogue -- OOXML's own list membership is flat paragraph metadata with no equivalent "list item" object to address by (blockIndex, itemIndex) at all.
    case "SET_LIST_ITEM_TEXT": {
      const doc = wordprocessingDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "a docx, odt or markdown document");
      }
      if (doc.format !== "odt") {
        return wrongDocument(
          state,
          "an odt document (lists are an odt-only concept)",
        );
      }
      const list = doc.editor.lists()[action.blockIndex];
      if (list === undefined) {
        return withStatus(
          state,
          "warning",
          `There is no list at index ${action.blockIndex}`,
        );
      }
      const item = list.items()[action.itemIndex];
      if (item === undefined) {
        return withStatus(
          state,
          "warning",
          `List ${action.blockIndex} has no item at index ${action.itemIndex}`,
        );
      }
      return mutate(state, doc, () => {
        setTextContainerText(item, action.text);
      });
    }

    // odt-only, matching SET_LIST_ITEM_TEXT's own narrowing: creates a real, brand-new, empty text:list via OdtBody.appendList() -- docx has no ADD_LIST_ITEM-shaped anchor to create a fresh list against (a docx paragraph gains list membership by copying an EXISTING paragraph's own numId/level, see ADD_LIST_ITEM above), so there is no equivalent "create a list from nothing" action to share.
    case "ADD_LIST": {
      const doc = wordprocessingDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "a docx, odt or markdown document");
      }
      if (doc.format !== "odt") {
        return wrongDocument(
          state,
          "an odt document (lists are an odt-only concept)",
        );
      }
      return mutate(state, doc, () => {
        doc.editor.body.appendList();
      });
    }

    // Both DocxParagraph.insertImageAfter and OdtParagraph.insertImageAfter accept the identical ImageInit shape (documents.js's own edit/{docx,odt}/image.ts), so this resolves through the shared styledWordprocessingDocument narrowing exactly as APPEND_PARAGRAPH/APPEND_RUN's own wordprocessingDocument narrowing does -- deliberately excluding markdown, since MarkdownParagraph has no insertImageAfter at all.
    case "INSERT_PARAGRAPH_IMAGE": {
      const doc = styledWordprocessingDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "a docx or odt document");
      }
      const paragraph = doc.editor.paragraphs()[action.blockIndex];
      if (paragraph === undefined) {
        return withStatus(
          state,
          "warning",
          `There is no paragraph at index ${action.blockIndex}`,
        );
      }
      return mutate(state, doc, () => {
        paragraph.insertImageAfter({
          format: action.format,
          bytes: action.bytes,
          widthPt: action.widthPt,
          heightPt: action.heightPt,
          altText: action.altText,
        });
      });
    }

    // Deliberately narrowed to docx specifically, not through the shared wordprocessingDocument helper: odt's own formula insertion (INSERT_ODT_FORMULA below) is body-scoped, not paragraph-scoped, so there is no single paragraph-level action both formats can share the way image insertion above does.
    case "INSERT_DOCX_FORMULA": {
      const doc = state.openDocument;
      if (doc?.format !== "docx") {
        return wrongDocument(state, "a docx document");
      }
      const paragraph = doc.editor.paragraphs()[action.blockIndex];
      if (paragraph === undefined) {
        return withStatus(
          state,
          "warning",
          `There is no paragraph at index ${action.blockIndex}`,
        );
      }
      // Same holder reason as `merge` above: the write happens inside the mutate callback.
      const omml = { written: true };
      const nextState = mutate(state, doc, () => {
        omml.written = paragraph.appendOfficeMath(action.mathml).written;
      });
      return omml.written
        ? nextState
        : withStatus(
            nextState,
            "warning",
            "The formula produced no OMML content and was not written",
          );
    }

    // odt's OdtBody.appendFormula has no docx counterpart at all (see the action's own doc comment) -- narrowed to odt specifically rather than through wordprocessingDocument.
    case "INSERT_ODT_FORMULA": {
      const doc = state.openDocument;
      if (doc?.format !== "odt") {
        return wrongDocument(state, "an odt document");
      }
      return mutate(state, doc, () => {
        doc.editor.body.appendFormula(
          { mathml: action.mathml.map(mutableMathMlNode) },
          action.frame,
        );
      });
    }

    case "ADD_SLIDE": {
      const doc = presentationDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "a pptx or odp document");
      }
      return mutate(state, doc, () => {
        doc.editor.addSlide();
      });
    }

    case "ADD_SLIDE_TABLE": {
      const doc = presentationDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "a pptx or odp document");
      }
      const slide = doc.editor.slides()[action.slideIndex];
      if (slide === undefined) {
        return withStatus(
          state,
          "warning",
          `There is no slide at index ${action.slideIndex}`,
        );
      }
      return mutate(state, doc, () => {
        slide.addTable({
          frame: action.frame,
          table: { rows: action.rows, columns: action.columns },
        });
      });
    }

    case "MERGE_SLIDE_TABLE_CELLS": {
      const doc = presentationDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "a pptx or odp document");
      }
      if (doc.format === "odp") {
        const entry = doc.editor.slides()[action.slideIndex]?.tables()[
          action.tableIndex
        ];
        if (entry === undefined) {
          return withStatus(
            state,
            "warning",
            `There is no table at index ${action.tableIndex} on slide ${action.slideIndex}`,
          );
        }
        return mutateGuarded(state, doc, () => {
          entry.table.mergeCells(
            action.startRow,
            action.startColumn,
            action.rowSpan,
            action.colSpan,
          );
        });
      }
      const table = doc.editor.slides()[action.slideIndex]?.tables()[
        action.tableIndex
      ];
      if (table === undefined) {
        return withStatus(
          state,
          "warning",
          `There is no table at index ${action.tableIndex} on slide ${action.slideIndex}`,
        );
      }
      return mutateGuarded(state, doc, () => {
        mergePptxTableCells(
          table,
          action.startRow,
          action.startColumn,
          action.rowSpan,
          action.colSpan,
        );
      });
    }

    case "ADD_TEXTBOX": {
      const doc = shapeHostDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "a pptx, odp or odg document");
      }
      if (doc.format === "odg") {
        const page = doc.editor.pages()[action.containerIndex];
        if (page === undefined) {
          return withStatus(
            state,
            "warning",
            `There is no page at index ${action.containerIndex}`,
          );
        }
        return mutate(state, doc, () => {
          page.addTextBox({ frame: action.frame, text: action.text });
        });
      }
      const slide = doc.editor.slides()[action.containerIndex];
      if (slide === undefined) {
        return withStatus(
          state,
          "warning",
          `There is no slide at index ${action.containerIndex}`,
        );
      }
      return mutate(state, doc, () => {
        slide.addTextBox({ frame: action.frame, text: action.text });
      });
    }

    case "ADD_IMAGE": {
      const doc = shapeHostDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "a pptx, odp or odg document");
      }
      const image = {
        frame: action.frame,
        format: action.format,
        bytes: action.bytes,
        altText: action.altText,
      };
      if (doc.format === "odg") {
        const page = doc.editor.pages()[action.containerIndex];
        if (page === undefined) {
          return withStatus(
            state,
            "warning",
            `There is no page at index ${action.containerIndex}`,
          );
        }
        return mutate(state, doc, () => {
          page.addImage(image);
        });
      }
      const slide = doc.editor.slides()[action.containerIndex];
      if (slide === undefined) {
        return withStatus(
          state,
          "warning",
          `There is no slide at index ${action.containerIndex}`,
        );
      }
      return mutate(state, doc, () => {
        slide.addImage(image);
      });
    }

    case "SET_SHAPE_TEXT":
      return withShape(
        state,
        action.containerIndex,
        action.shapeIndex,
        (shape) => {
          shape.text = action.text;
        },
      );

    case "SET_SHAPE_FRAME":
      return withShape(
        state,
        action.containerIndex,
        action.shapeIndex,
        (shape) => {
          shape.frame = action.frame;
        },
      );

    // PptxShape gained a real `rotationDeg` getter/setter alongside OdpShape's -- SET_SHAPE_ROTATION resolves through the same withShape helper SET_SHAPE_TEXT/SET_SHAPE_FRAME already use rather than a pptx-specific rejection.
    case "SET_SHAPE_ROTATION":
      return withShape(
        state,
        action.containerIndex,
        action.shapeIndex,
        (shape) => {
          shape.rotationDeg = action.rotationDeg;
        },
      );

    case "SET_SLIDE_NOTES": {
      const doc = presentationDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "a pptx or odp document");
      }
      const slide = doc.editor.slides()[action.slideIndex];
      if (slide === undefined) {
        return withStatus(
          state,
          "warning",
          `There is no slide at index ${action.slideIndex}`,
        );
      }
      return mutate(state, doc, () => {
        slide.notes = action.notes;
      });
    }

    case "ADD_SHEET": {
      const doc = spreadsheetDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "an ods document");
      }
      return mutate(state, doc, () => {
        doc.editor.addSheet(action.name);
      });
    }

    case "SET_CELL_VALUE":
      return withSheet(state, action.sheetIndex, (sheet) => {
        sheet.cell(action.row, action.column).value = action.value;
      });

    // A separate action/edit mode from SET_CELL_VALUE, not a variant of it -- see actions.ts's own doc comment: OdsCell.formula and .value are two independent attributes of the same real cell, both settable at once.
    case "SET_CELL_FORMULA":
      return withSheet(state, action.sheetIndex, (sheet) => {
        sheet.cell(action.row, action.column).formula = action.formula;
      });

    // OdsSheet.addImage takes a real ContentSheetImage, which -- unlike ADD_IMAGE/INSERT_PARAGRAPH_IMAGE's own SlideImageInit/ImageInit -- carries its bytes as `base64: string`, not a raw Uint8Array (document-schema.js's ContentImageBlockSchema, shared with every other embedded-image/object shape); the conversion happens here, once, rather than pushing bytesToBase64 out to every dispatch site.
    case "ADD_SHEET_IMAGE":
      return withSheet(state, action.sheetIndex, (sheet) => {
        sheet.addImage({
          kind: "image",
          format: action.format,
          base64: bytesToBase64(action.bytes),
          widthPt: action.widthPt,
          heightPt: action.heightPt,
          altText: action.altText,
          anchorRow: action.anchorRow,
          anchorColumn: action.anchorColumn,
          offsetXPt: action.offsetXPt,
          offsetYPt: action.offsetYPt,
        });
      });

    case "MERGE_CELLS": {
      const doc = spreadsheetDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "an ods document");
      }
      const sheet = sheetAt(doc, action.sheetIndex);
      if (sheet === undefined) {
        return withStatus(
          state,
          "warning",
          `There is no sheet at index ${action.sheetIndex}`,
        );
      }
      return mutateGuarded(state, doc, () => {
        sheet.mergeCells(
          action.startRow,
          action.startColumn,
          action.rowSpan,
          action.colSpan,
        );
      });
    }

    case "SET_SHEET_PRINT_SETTINGS":
      return withSheet(state, action.sheetIndex, (sheet) => {
        sheet.printSettings = action.printSettings;
      });

    case "ADD_PAGE": {
      const doc = drawingDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "an odg document");
      }
      return mutate(state, doc, () => {
        doc.editor.addPage();
      });
    }

    case "ADD_RECT":
    case "ADD_ELLIPSE":
    case "ADD_LINE":
    case "ADD_PATH": {
      const doc = vectorHostDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "an odg or odp document");
      }
      if (doc.format === "odg") {
        const page = doc.editor.pages()[action.containerIndex];
        if (page === undefined) {
          return withStatus(
            state,
            "warning",
            `There is no page at index ${action.containerIndex}`,
          );
        }
        return mutate(state, doc, () => {
          switch (action.type) {
            case "ADD_RECT":
              page.addRect(action.init);
              return;
            case "ADD_ELLIPSE":
              page.addEllipse(action.init);
              return;
            case "ADD_LINE":
              page.addLine(action.init);
              return;
            case "ADD_PATH":
              page.addPath(action.init);
              return;
          }
        });
      }
      // odp has no per-kind convenience methods the way odg does -- OdpSlide.addVector is the ONE generic method every kind goes through, so the ContentVector literal is built here from the same OdgBoxVectorInit/OdgLineVectorInit/OdgPathVectorInit shape the odg branch above already consumes, rather than a second, odp-specific init type.
      const slide = doc.editor.slides()[action.containerIndex];
      if (slide === undefined) {
        return withStatus(
          state,
          "warning",
          `There is no slide at index ${action.containerIndex}`,
        );
      }
      return mutate(state, doc, () => {
        switch (action.type) {
          case "ADD_RECT":
            slide.addVector({
              kind: "rect",
              frame: action.init.frame,
              fill: action.init.fill,
              stroke: action.init.stroke,
            });
            return;
          case "ADD_ELLIPSE":
            slide.addVector({
              kind: "ellipse",
              frame: action.init.frame,
              fill: action.init.fill,
              stroke: action.init.stroke,
            });
            return;
          case "ADD_LINE":
            slide.addVector({
              kind: "line",
              from: action.init.from,
              to: action.init.to,
              stroke: action.init.stroke,
            });
            return;
          case "ADD_PATH":
            slide.addVector({
              kind: "path",
              frame: action.init.frame,
              subpaths: [...action.init.subpaths],
              fill: action.init.fill,
              stroke: action.init.stroke,
            });
            return;
        }
      });
    }

    case "SET_VECTOR_FILL": {
      const doc = drawingDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "an odg document");
      }
      return mutate(state, doc, () => {
        action.vector.fill = action.fill;
      });
    }

    case "SET_VECTOR_STROKE": {
      const doc = drawingDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "an odg document");
      }
      return mutate(state, doc, () => {
        action.vector.stroke = action.stroke;
      });
    }

    case "ADD_PDF_TEXT":
      return withPdfPage(state, action.pageIndex, (page) => {
        page.appendText(action.init);
      });

    case "ADD_PDF_RECT":
      return withPdfPage(state, action.pageIndex, (page) => {
        page.appendRect(action.init);
      });

    case "ADD_PDF_ELLIPSE":
      return withPdfPage(state, action.pageIndex, (page) => {
        page.appendEllipse(action.init);
      });

    case "ADD_PDF_LINE":
      return withPdfPage(state, action.pageIndex, (page) => {
        page.appendLine(action.init);
      });

    case "ADD_PDF_PATH":
      return withPdfPage(state, action.pageIndex, (page) => {
        page.appendPath(action.init);
      });

    case "ADD_PDF_IMAGE":
      return withPdfPage(state, action.pageIndex, (page) => {
        page.appendImage(action.init);
      });

    case "ADD_PDF_LINK":
      return withPdfPage(state, action.pageIndex, (page) => {
        page.appendLink(action.init);
      });

    case "REMOVE_PDF_ITEM": {
      const doc = pdfDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "a pdf document");
      }
      const item = pdfItemAt(doc, action.pageIndex, action.itemIndex);
      if (item === undefined) {
        return withStatus(
          state,
          "warning",
          `Page ${action.pageIndex} has no item at index ${action.itemIndex}`,
        );
      }
      return mutate(state, doc, () => {
        item.remove();
      });
    }

    case "SET_PDF_TEXT_TEXT":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfTextItem,
        "text",
        (item) => {
          item.text = action.text;
        },
      );

    case "SET_PDF_TEXT_POSITION":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfTextItem,
        "text",
        (item) => {
          item.xPt = action.xPt;
          item.yPt = action.yPt;
        },
      );

    case "SET_PDF_TEXT_FONT":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfTextItem,
        "text",
        (item) => {
          item.font = action.font;
        },
      );

    case "SET_PDF_TEXT_SIZE":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfTextItem,
        "text",
        (item) => {
          item.sizePt = action.sizePt;
        },
      );

    case "SET_PDF_TEXT_COLOR":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfTextItem,
        "text",
        (item) => {
          item.color = action.color;
        },
      );

    case "SET_PDF_TEXT_ROTATION":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfTextItem,
        "text",
        (item) => {
          item.rotationDeg = action.rotationDeg;
        },
      );

    case "SET_PDF_TEXT_WIDTH":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfTextItem,
        "text",
        (item) => {
          item.widthPt = action.widthPt;
        },
      );

    case "TOGGLE_PDF_TEXT_UNDERLINE":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfTextItem,
        "text",
        (item) => {
          item.underline = !(item.underline ?? false);
        },
      );

    case "SET_PDF_RECT_FRAME":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfRectItem,
        "rect",
        (item) => {
          item.xPt = action.xPt;
          item.yPt = action.yPt;
          item.widthPt = action.widthPt;
          item.heightPt = action.heightPt;
        },
      );

    case "SET_PDF_RECT_FILL":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfRectItem,
        "rect",
        (item) => {
          item.fill = action.fill;
        },
      );

    case "SET_PDF_RECT_STROKE":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfRectItem,
        "rect",
        (item) => {
          item.stroke = action.stroke;
        },
      );

    case "SET_PDF_ELLIPSE_FRAME":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfEllipseItem,
        "ellipse",
        (item) => {
          item.xPt = action.xPt;
          item.yPt = action.yPt;
          item.widthPt = action.widthPt;
          item.heightPt = action.heightPt;
        },
      );

    case "SET_PDF_ELLIPSE_FILL":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfEllipseItem,
        "ellipse",
        (item) => {
          item.fill = action.fill;
        },
      );

    case "SET_PDF_ELLIPSE_STROKE":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfEllipseItem,
        "ellipse",
        (item) => {
          item.stroke = action.stroke;
        },
      );

    case "SET_PDF_LINE_FROM":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfLineItem,
        "line",
        (item) => {
          item.x1Pt = action.x1Pt;
          item.y1Pt = action.y1Pt;
        },
      );

    case "SET_PDF_LINE_TO":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfLineItem,
        "line",
        (item) => {
          item.x2Pt = action.x2Pt;
          item.y2Pt = action.y2Pt;
        },
      );

    case "SET_PDF_LINE_COLOR":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfLineItem,
        "line",
        (item) => {
          item.color = action.color;
        },
      );

    case "SET_PDF_LINE_WIDTH":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfLineItem,
        "line",
        (item) => {
          item.widthPt = action.widthPt;
        },
      );

    case "SET_PDF_PATH_FILL":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfPathItem,
        "path",
        (item) => {
          item.fill = action.fill;
        },
      );

    case "SET_PDF_PATH_FILL_RULE":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfPathItem,
        "path",
        (item) => {
          item.fillRule = action.fillRule;
        },
      );

    case "SET_PDF_PATH_STROKE":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfPathItem,
        "path",
        (item) => {
          item.stroke = action.stroke;
        },
      );

    case "SET_PDF_IMAGE_FRAME":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfImageItem,
        "image",
        (item) => {
          item.xPt = action.xPt;
          item.yPt = action.yPt;
          item.widthPt = action.widthPt;
          item.heightPt = action.heightPt;
        },
      );

    case "SET_PDF_IMAGE_ROTATION":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfImageItem,
        "image",
        (item) => {
          item.rotationDeg = action.rotationDeg;
        },
      );

    case "SET_PDF_IMAGE_SOURCE":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfImageItem,
        "image",
        (item) => {
          item.setImage(action.bytes, action.format);
        },
      );

    case "SET_PDF_LINK_URI":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfLinkItem,
        "link",
        (item) => {
          item.uri = action.uri;
        },
      );

    case "SET_PDF_LINK_FRAME":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfLinkItem,
        "link",
        (item) => {
          item.xPt = action.xPt;
          item.yPt = action.yPt;
          item.widthPt = action.widthPt;
          item.heightPt = action.heightPt;
        },
      );

    case "SET_PDF_INTERNAL_LINK_DESTINATION":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfInternalLinkItem,
        "internalLink",
        (item) => {
          item.destination = action.destination;
        },
      );

    case "SET_PDF_INTERNAL_LINK_FRAME":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfInternalLinkItem,
        "internalLink",
        (item) => {
          item.xPt = action.xPt;
          item.yPt = action.yPt;
          item.widthPt = action.widthPt;
          item.heightPt = action.heightPt;
        },
      );

    case "APPEND_DIAGNOSTIC":
      return {
        ...state,
        diagnostics: [...state.diagnostics, action.diagnostic],
      };

    case "DISMISS_DIAGNOSTIC":
      return {
        ...state,
        diagnostics: state.diagnostics.filter(
          (_, index) => index !== action.index,
        ),
      };

    case "CLEAR_DIAGNOSTICS":
      return { ...state, diagnostics: [] };

    case "SET_STATUS":
      return withStatus(state, action.severity, action.text);

    case "CLEAR_STATUS":
      return { ...state, status: undefined };

    case "SET_SEARCH_QUERY":
      return { ...state, searchQuery: action.query };

    case "DISMISS_ERROR_DETAIL":
      return { ...state, errorDetail: undefined };

    case "UNDO": {
      const doc = state.openDocument;
      if (doc === undefined) {
        return withStatus(state, "info", "There is nothing to undo");
      }
      if (
        doc.format === "odb" ||
        doc.format === "xlsx" ||
        doc.format === "csv" ||
        doc.format === "svg" ||
        doc.format === "rtf" ||
        doc.format === "wpd"
      ) {
        return withStatus(
          state,
          "warning",
          `A ${doc.format} document is read-only, so it has no history to undo`,
        );
      }
      const snapshot = state.undoStack.at(-1);
      if (snapshot === undefined) {
        return withStatus(state, "info", "There is nothing to undo");
      }
      const restored: OpenDocument =
        doc.format === "markdown"
          ? { ...doc, editor: openMarkdown(decodeMarkdownText(snapshot)) }
          : reopenEditable(doc, snapshot);
      return withStatus(
        {
          ...state,
          openDocument: restored,
          undoStack: state.undoStack.slice(0, -1),
          hasUnsavedChanges: true,
        },
        "info",
        "Undone",
      );
    }
  }
}

function closeDocument(state: AppState): AppState {
  return {
    ...state,
    openDocument: undefined,
    hasUnsavedChanges: false,
    undoStack: [],
    selection: {},
    searchQuery: "",
    errorDetail: undefined,
    stack: [{ kind: "launcher" }],
  };
}
