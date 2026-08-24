import type {
  DocxEditor,
  HsqldbTable,
  LayoutDocument,
  MarkdownEditor,
  OdbForm,
  OdbReport,
  OdgEditor,
  OdpEditor,
  OdsEditor,
  OdtEditor,
  PdfEditor,
  PptxEditor,
} from "documents.js";

// RULE FOR EVERY SCREEN BUILT ON THIS STATE: documents.js's editor objects (DocxRun, OdtParagraph, PptxShape, OdsCell, OdgBoxVector, ...) are LIVE VIEWS over the mutable XML tree inside the decoded package -- `run.bold = true` edits that tree in place and produces no new object reference anywhere. Call the accessors (`editor.paragraphs()`, `slide.shapes()`, `sheet.cell(r, c)`) FRESH on every render and never cache their results in useState/useMemo: any mutation, from any screen, silently invalidates an array captured on an earlier render, and nothing in the type system or in React will tell you. `AppState.hasUnsavedChanges` flipping (and the new outer state object the reducer returns with it) is the ONLY re-render signal a mutation produces -- see the deliberate-impurity note in reducer.ts.

export type Screen =
  | { readonly kind: "launcher" }
  | {
      readonly kind: "filePicker";
      readonly purpose: "open" | "saveAs" | "exportTarget";
      readonly cwd: string;
    }
  | { readonly kind: "newDocumentPicker" }
  | { readonly kind: "bodyList" }
  | { readonly kind: "docxExtras" }
  | { readonly kind: "paragraphDetail"; readonly blockIndex: number }
  | {
      readonly kind: "runEditor";
      readonly blockIndex: number;
      readonly runIndex: number;
    }
  | { readonly kind: "tableView"; readonly blockIndex: number }
  | {
      readonly kind: "tableCellDetail";
      readonly blockIndex: number;
      readonly row: number;
      readonly col: number;
    }
  | { readonly kind: "listEditor"; readonly blockIndex: number }
  | { readonly kind: "slideList" }
  | { readonly kind: "slideDetail"; readonly slideIndex: number }
  | {
      readonly kind: "shapeEditor";
      readonly slideIndex: number;
      readonly shapeIndex: number;
    }
  | {
      readonly kind: "slideTableDetail";
      readonly slideIndex: number;
      readonly tableIndex: number;
    }
  | { readonly kind: "notesEditor"; readonly slideIndex: number }
  | { readonly kind: "sheetList" }
  | { readonly kind: "spreadsheetGrid"; readonly sheetIndex: number }
  | {
      readonly kind: "cellDetail";
      readonly sheetIndex: number;
      readonly row: number;
      readonly col: number;
    }
  | { readonly kind: "printSettingsEditor"; readonly sheetIndex: number }
  | { readonly kind: "pageList" }
  | { readonly kind: "pageDetail"; readonly pageIndex: number }
  | {
      readonly kind: "shapeOrVectorDetail";
      readonly pageIndex: number;
      readonly itemIndex: number;
    }
  | { readonly kind: "odbTableList" }
  | { readonly kind: "odbTableRows"; readonly tableName: string }
  | { readonly kind: "odbFormList" }
  | { readonly kind: "odbFormDetail"; readonly formName: string }
  | { readonly kind: "odbReportList" }
  | { readonly kind: "odbReportDetail"; readonly reportName: string }
  | { readonly kind: "odbReportRender"; readonly reportName: string }
  | { readonly kind: "viewSource" }
  | { readonly kind: "pdfPageList" }
  | { readonly kind: "pdfPageItems"; readonly pageIndex: number }
  | {
      readonly kind: "pdfItemDetail";
      readonly pageIndex: number;
      readonly itemIndex: number;
    }
  | { readonly kind: "exportOptions" }
  | { readonly kind: "saveAsPrompt" }
  | { readonly kind: "metadata" };

export type ScreenKind = Screen["kind"];

export interface DocxOpenDocument {
  readonly format: "docx";
  readonly editor: DocxEditor;
  readonly path: string | undefined;
}

export interface PptxOpenDocument {
  readonly format: "pptx";
  readonly editor: PptxEditor;
  readonly path: string | undefined;
}

export interface OdtOpenDocument {
  readonly format: "odt";
  readonly editor: OdtEditor;
  readonly path: string | undefined;
}

export interface OdpOpenDocument {
  readonly format: "odp";
  readonly editor: OdpEditor;
  readonly path: string | undefined;
}

export interface OdsOpenDocument {
  readonly format: "ods";
  readonly editor: OdsEditor;
  readonly path: string | undefined;
}

export interface OdgOpenDocument {
  readonly format: "odg";
  readonly editor: OdgEditor;
  readonly path: string | undefined;
}

// `.odb` carries no editor: documents.js reads its embedded database's tables and offers no write direction at all, so `path` is always known (it was read from disk) and the document is permanently read-only.
//
// All three collections are resolved once, at open time, from the same decoded package -- `tables` from the embedded database's own storage, `forms`/`reports` from the static ODF sub-documents inside the package. They are plain immutable values rather than live views, so unlike an editor format's accessors (see the RULE at the top of this file) they are safe to hold on to across renders.
export interface OdbOpenDocument {
  readonly format: "odb";
  readonly tables: readonly HsqldbTable[];
  readonly forms: readonly OdbForm[];
  readonly reports: readonly OdbReport[];
  readonly path: string;
}

// Markdown now carries a genuine live-view editor: documents.js's `MarkdownEditor` (openMarkdown/createMarkdownEditor) mutates a real, mutable `ContentDocument` in memory -- `paragraph.appendRun({ text })` edits that document in place, the same live-view contract every other editor here follows, even though there is no `XmlElement` tree underneath it the way there is for docx/odt (see documents.js's own README, "src/edit/markdown/" architecture entry, and `MarkdownEditor.toMarkdownText()`, which re-serialises the whole document fresh on every call rather than exposing a `toBytes()`). `originalText` is the literal text this document was opened/saved with, kept ONLY for the read-only `:view-source` screen -- it is never mutated and never written back directly, so it stays decoupled from whatever `editor` currently holds. `path` is optional, matching every other editable format (`undefined` for a document created fresh with no path yet) -- though the TUI does not yet wire a "new markdown document" flow (`EditableFormat`/`CREATE_DOCUMENT` do not include markdown), so in practice a `MarkdownOpenDocument` only ever comes from opening a real .md/.markdown file, with `originalText` always set.
export interface MarkdownOpenDocument {
  readonly format: "markdown";
  readonly editor: MarkdownEditor;
  readonly originalText: string | undefined;
  readonly path: string | undefined;
}

// A PDF opens through documents.js's own live-view `PdfEditor` (openPdf/createPdf) -- `layout` is `editor.toLayoutDocument()`, the exact same `LayoutDocument` object the editor mutates in place, kept alongside so every existing reader of `doc.layout` (the pdf/xlsx page-list/page-items/item-detail screen family, shared with XlsxOpenDocument below) keeps working unmodified: a mutation through `editor` is a mutation of the identical object `layout` already points to, not a separate snapshot that could drift out of sync. `path` is `undefined` for a freshly created blank PDF (`createPdf()`), matching every other EditableOpenDocument variant.
export interface PdfOpenDocument {
  readonly format: "pdf";
  readonly editor: PdfEditor;
  readonly layout: LayoutDocument;
  readonly path: string | undefined;
}

// documents.js has no XlsxEditor at all -- there is no live-view object to hold, the way there is a `DocxEditor`/`OdtEditor`, and no `readXlsxContent` re-exported from documents.js's own public surface for this TUI to read a sheet grid from directly (see that package's own README: deliberately not re-exported, mirroring the readDocx/readPptx choice). What documents.js does have is a genuine `xlsxToPdf` conversion, so opening a .xlsx converts it through that once at open time and reads the result back with `readPdf`, exactly the same `LayoutDocument` shape a real .pdf opens as -- `layout` is what the pdf page-list/page-items/item-detail screens browse (see screens/editors/pdf/shared.ts's own broadened guard), reusing that whole screen family with no xlsx-specific viewer code at all. `bytes` is kept alongside so a real export re-runs `xlsxToPdf` with the caller's own fonts/diagnostics options at export time, rather than writing back the fixed preview conversion computed here.
export interface XlsxOpenDocument {
  readonly format: "xlsx";
  readonly layout: LayoutDocument;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly path: string;
}

// csv is the same read-only-preview story as xlsx one variant over: documents.js has no csv editor (a csv file is one sheet of raw RFC 4180 text, not a package with an XML tree to hold a live view into), but it does have `csvToPdf`, so a .csv opens as that conversion's own `readPdf` result and browses through the identical pdf page-list family. A multi-sheet source never reaches here -- a csv file is exactly one sheet by construction, so no sheet selection is needed at open time the way a spreadsheet-to-csv conversion needs one at write time.
export interface CsvOpenDocument {
  readonly format: "csv";
  readonly layout: LayoutDocument;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly path: string;
}

// svg mirrors csv: no editor (an SVG source is one drawing page of XML text with no live-view object), but a genuine `svgToPdf` conversion, opened read-only as its own `readPdf` result through the shared pdf screen family. An SVG source is likewise exactly one page by construction, so the page selection a multi-page drawing's own svg write edge demands never applies on the read side.
export interface SvgOpenDocument {
  readonly format: "svg";
  readonly layout: LayoutDocument;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly path: string;
}

// The seven formats that have a live-view editor, and therefore support every mutating action, `editor.toBytes()` saving, undo snapshots. `odb`/`xlsx`/`csv`/`svg` are read-only sources; `pdf` joined this union once documents.js gained a real live-view `PdfEditor` -- see PdfOpenDocument's own doc comment. `pdf` is deliberately excluded from exportToPdf's own conversion set even though it is editable now: there is no docxToPdf-equivalent "convert a PDF to a PDF" function, and there does not need to be one -- editing and saving a PDF in place needs no conversion step at all.
export type EditableOpenDocument =
  | DocxOpenDocument
  | PptxOpenDocument
  | OdtOpenDocument
  | OdpOpenDocument
  | OdsOpenDocument
  | OdgOpenDocument
  | PdfOpenDocument;

// Every format that can be written back to disk at all: the seven live-view-editor formats above, plus markdown through its own live-view MarkdownEditor. This is a strictly broader question than "does this have a `.editor` object" -- markdown genuinely does have one now, but `MarkdownEditor` has no `toBytes()` (it re-serialises the whole document fresh via `toMarkdownText()` instead, see MarkdownOpenDocument's own doc comment), which is exactly why markdown is NOT folded into EditableOpenDocument itself: every EditableOpenDocument call site (`reopenEditable` in reducer.ts, the `.editor.toBytes()` branches in exportToPdf/saveDocumentTo) assumes `.editor.toBytes()` exists verbatim. `mutate`/`mutateGuarded` (reducer.ts) DO take the wider `WritableOpenDocument`, via a small `toUndoSnapshot` helper that branches on the one place the two byte<->text boundaries genuinely differ. Screens that only need "can this be saved, and what extension does it get" (file-picker.tsx, save-as-prompt.tsx) should check WritableOpenDocument/isWritableDocument instead of EditableOpenDocument/isEditableDocument.
export type WritableOpenDocument = EditableOpenDocument | MarkdownOpenDocument;

export type OpenDocument =
  | WritableOpenDocument
  | OdbOpenDocument
  | XlsxOpenDocument
  | CsvOpenDocument
  | SvgOpenDocument;

export type EditableFormat = EditableOpenDocument["format"];

export type WritableFormat = WritableOpenDocument["format"];

export type OpenDocumentFormat = OpenDocument["format"];

const EDITABLE_FORMATS: Readonly<Record<EditableFormat, true>> = {
  docx: true,
  pptx: true,
  odt: true,
  odp: true,
  ods: true,
  odg: true,
  pdf: true,
};

const WRITABLE_FORMATS: Readonly<Record<WritableFormat, true>> = {
  ...EDITABLE_FORMATS,
  markdown: true,
};

export function isEditableFormat(value: string): value is EditableFormat {
  return value in EDITABLE_FORMATS;
}

export function isEditableDocument(
  document: OpenDocument,
): document is EditableOpenDocument {
  return isEditableFormat(document.format);
}

export function isWritableFormat(value: string): value is WritableFormat {
  return value in WRITABLE_FORMATS;
}

export function isWritableDocument(
  document: OpenDocument,
): document is WritableOpenDocument {
  return isWritableFormat(document.format);
}

export type OverlayName =
  | "commandPalette"
  | "search"
  | "help"
  | "confirmQuit"
  | "confirmClose"
  | "diagnosticsPanel";

export interface OverlayState {
  readonly commandPalette: boolean;
  readonly search: boolean;
  readonly help: boolean;
  readonly confirmQuit: boolean;
  readonly confirmClose: boolean;
  readonly diagnosticsPanel: boolean;
}

export interface StatusMessage {
  readonly severity: "info" | "warning" | "error";
  readonly text: string;
  readonly createdAtMs: number;
}

// Deliberately independent of documents.js's own port `Diagnostic` (which additionally carries a `code`): this one is fed by the raw `onSubstitution`/`PdfDiagnosticSink` callbacks the ergonomic conversion functions expose, not by `DocumentConverter.convert`'s result, and those callbacks have no code to report.
export interface Diagnostic {
  readonly severity: "info" | "warning";
  readonly message: string;
  readonly pageIndex?: number;
}

// A failure worth showing the user in full: `message` is the one-line summary that also lands in the status bar, `detail` the underlying error text (a stack-free `Error.message`, a documents.js error class's own message listing available tables, and so on).
export interface ErrorDetail {
  readonly message: string;
  readonly detail: string | undefined;
}

// Cross-screen list cursors, keyed by `selectionKeyFor(screen)` so each screen INSTANCE (slide 3's shape list, slide 4's shape list) keeps its own cursor and navigating back restores where you were. A flat string-keyed map rather than a per-screen-kind union of shapes because the alternative -- a field per screen kind -- would need a reducer case per screen kind for what is one number, and because a screen with per-instance coordinates (slideDetail, cellDetail) needs those coordinates IN the key regardless. Absence means "not visited yet", which reads as index 0; use `selectedIndexFor` rather than indexing directly.
export type SelectionState = Readonly<Record<string, number>>;

export function selectionKeyFor(screen: Screen): string {
  switch (screen.kind) {
    case "launcher":
    case "newDocumentPicker":
    case "bodyList":
    case "docxExtras":
    case "slideList":
    case "sheetList":
    case "pageList":
    case "odbTableList":
    case "odbFormList":
    case "odbReportList":
    case "pdfPageList":
    case "exportOptions":
    case "saveAsPrompt":
    case "viewSource":
    case "metadata":
      return screen.kind;
    case "filePicker":
      return `filePicker:${screen.purpose}:${screen.cwd}`;
    case "paragraphDetail":
    case "tableView":
    case "listEditor":
      return `${screen.kind}:${screen.blockIndex}`;
    case "runEditor":
      return `runEditor:${screen.blockIndex}:${screen.runIndex}`;
    case "tableCellDetail":
      return `tableCellDetail:${screen.blockIndex}:${screen.row}:${screen.col}`;
    case "slideDetail":
    case "notesEditor":
      return `${screen.kind}:${screen.slideIndex}`;
    case "shapeEditor":
      return `shapeEditor:${screen.slideIndex}:${screen.shapeIndex}`;
    case "slideTableDetail":
      return `slideTableDetail:${screen.slideIndex}:${screen.tableIndex}`;
    case "spreadsheetGrid":
    case "printSettingsEditor":
      return `${screen.kind}:${screen.sheetIndex}`;
    case "cellDetail":
      return `cellDetail:${screen.sheetIndex}:${screen.row}:${screen.col}`;
    case "pageDetail":
    case "pdfPageItems":
      return `${screen.kind}:${screen.pageIndex}`;
    case "shapeOrVectorDetail":
    case "pdfItemDetail":
      return `${screen.kind}:${screen.pageIndex}:${screen.itemIndex}`;
    case "odbTableRows":
      return `odbTableRows:${screen.tableName}`;
    case "odbFormDetail":
      return `odbFormDetail:${screen.formName}`;
    case "odbReportDetail":
      return `odbReportDetail:${screen.reportName}`;
    case "odbReportRender":
      return `odbReportRender:${screen.reportName}`;
  }
}

export function selectedIndexFor(
  selection: SelectionState,
  key: string,
): number {
  const recorded = selection[key];
  return recorded ?? 0;
}

export interface AppState {
  readonly stack: readonly Screen[];
  readonly openDocument: OpenDocument | undefined;
  readonly hasUnsavedChanges: boolean;
  readonly overlays: OverlayState;
  readonly status: StatusMessage | undefined;
  readonly diagnostics: readonly Diagnostic[];
  // Bounded ring buffer of whole-document snapshots (`editor.toBytes()` taken immediately BEFORE each committed mutation), capped at UNDO_STACK_LIMIT in reducer.ts. Whole-package snapshots rather than inverse operations because a live-view mutation leaves nothing behind to invert.
  readonly undoStack: readonly Uint8Array<ArrayBuffer>[];
  readonly selection: SelectionState;
  // The shared search contract: the search overlay writes the query here and each screen filters its OWN visible rows by case-insensitive substring while this is non-empty. Screens keep their row text to themselves; nothing registers rows centrally.
  readonly searchQuery: string;
  // Non-undefined means the error-detail overlay is showing. Deliberately not an `overlays` flag: the payload and the visibility are the same fact, and two of them would be able to disagree.
  readonly errorDetail: ErrorDetail | undefined;
  // Set by CONFIRM_QUIT (or by REQUEST_QUIT when there is nothing unsaved to confirm); the app shell watches it and calls Ink's `exit()`. A state flag rather than calling `exit()` from the reducer so quitting stays testable without rendering.
  readonly isExiting: boolean;
  // The file picker's own starting directory (launcher.tsx reads this rather than calling process.cwd() itself), seeded from RunTuiOptions.cwd at startup -- lets an embedding caller (or a future `document-cli tui --cwd <dir>` flag) launch the picker somewhere other than the real process cwd.
  readonly cwd: string;
}

export function rootScreenForFormat(format: OpenDocumentFormat): Screen {
  switch (format) {
    case "docx":
    case "odt":
    case "markdown":
      return { kind: "bodyList" };
    case "pptx":
    case "odp":
      return { kind: "slideList" };
    case "ods":
      return { kind: "sheetList" };
    case "odg":
      return { kind: "pageList" };
    case "odb":
      return { kind: "odbTableList" };
    case "pdf":
    case "xlsx":
    case "csv":
    case "svg":
      return { kind: "pdfPageList" };
  }
}

export function currentScreen(state: AppState): Screen {
  const screen = state.stack.at(-1);
  if (screen === undefined) {
    throw new Error(
      "The screen stack is empty: createInitialState always seeds a launcher screen and POP_SCREEN never removes the last entry, so this cannot happen through the reducer.",
    );
  }
  return screen;
}

// True whenever something layered over the current screen owns the keyboard, INCLUDING the error-detail overlay (which has no `overlays` flag of its own -- `errorDetail` being set is what makes it visible). Every screen must pass `isActive: !anyOverlayOpen(state)` to its own `useInput`/`useNavigationInput` calls, because the app shell keeps the screen mounted underneath an open overlay and both would otherwise react to the same key press.
export function anyOverlayOpen(state: AppState): boolean {
  const { overlays } = state;
  return (
    overlays.commandPalette ||
    overlays.search ||
    overlays.help ||
    overlays.confirmQuit ||
    overlays.confirmClose ||
    overlays.diagnosticsPanel ||
    state.errorDetail !== undefined
  );
}
