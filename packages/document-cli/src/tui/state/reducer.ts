import {
  decodeMarkdownText,
  encodeMarkdownText,
  openDoc,
  openDocx,
  openMarkdown,
  openOdg,
  openOdp,
  openOds,
  openOdt,
  openPdf,
  openXls,
  openPpt,
  openPptx,
  type PptxTable,
} from "documents.js";
import { createNewDocument } from "../format/open-document.js";
import type { Action } from "./actions.js";
import {
  isEditableDocument,
  rootScreenForFormat,
  type AppState,
  type EditableOpenDocument,
  type OpenDocument,
  type OverlayName,
  type OverlayState,
  type StatusMessage,
  type WritableOpenDocument,
} from "./types.js";
import { drawingDocument, vectorHostDocument } from "./open-documents";
import {} from "./mutations";
import { applyPdfAction } from "./reducer-pdf-actions";
import { applyTextAction } from "./reducer-text-actions";
import { applySlideAction } from "./reducer-slide-actions";

// THIS REDUCER IS DELIBERATELY IMPURE FOR EVERY MUTATING ACTION, AND THAT IS THE DESIGN, NOT AN OVERSIGHT.
//
// documents.js's editors are live views over the mutable XML tree inside a decoded package: `run.bold = true` edits that tree in place and hands back no new object. There is no immutable document value to fold an action into and no new reference for React to compare, so a mutating case here calls the editor method that performs the real mutation and then returns a NEW OUTER STATE OBJECT (`{ ...state, hasUnsavedChanges: true, undoStack }`) purely so React sees a changed reference and re-renders the screens that read the document through fresh accessor calls. Re-running one of these actions against the same state does NOT produce the same result — appending a paragraph twice appends two paragraphs. Do not add React StrictMode double-invocation, and do not replay actions.
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

export function withStatus(
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

// A negative slice bound is exactly as safe as the "if too long, slice; else return as-is" branch it replaces — Array.prototype.slice(-N) on an array no longer than N returns every element, so this single expression covers both the truncating and non-truncating cases with no conditional to keep in sync with UNDO_STACK_LIMIT.
function pushSnapshot(
  stack: readonly Uint8Array<ArrayBuffer>[],
  snapshot: Uint8Array<ArrayBuffer>,
): readonly Uint8Array<ArrayBuffer>[] {
  return [...stack, snapshot].slice(-UNDO_STACK_LIMIT);
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
    case "doc":
      return { format: "doc", editor: doc.editor, path };
    case "xls":
      return { format: "xls", editor: doc.editor, path };
    case "ppt":
      return { format: "ppt", editor: doc.editor, path };
    case "epub":
      return { format: "epub", layout: doc.layout, bytes: doc.bytes, path };
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
    case "doc":
      return { format: "doc", editor: openDoc(bytes), path: doc.path };
    case "xls":
      return { format: "xls", editor: openXls(bytes), path: doc.path };
    case "ppt":
      return { format: "ppt", editor: openPpt(bytes), path: doc.path };
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

// markdown's own MarkdownEditor has no toBytes() at all (bytes are incidental to markdown — see MarkdownOpenDocument's own doc comment): its undo snapshot is the encoded text `toMarkdownText()` produces right now, the same byte<->text boundary every other markdown-touching call site in this codebase (openDocumentAtPath, saveDocumentTo, exportToPdf) already uses.
function toUndoSnapshot(doc: WritableOpenDocument): Uint8Array<ArrayBuffer> {
  return doc.format === "markdown"
    ? encodeMarkdownText(doc.editor.toMarkdownText())
    : doc.editor.toBytes();
}

// Snapshot BEFORE the mutation runs, so the pushed entry is the state to come back to, then run the mutation against the live tree and hand React a fresh outer object. Takes any WritableOpenDocument, not just EditableOpenDocument, so markdown's own live-view MarkdownEditor shares this exact undo/mutate machinery with zero format-specific reducer code of its own — see toUndoSnapshot above for the one place the two byte<->text boundaries genuinely differ.
export function mutate(
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

// mutate()'s own counterpart for an `apply` that can genuinely fail on bad caller input rather than only on a routing bug — a merge rectangle that overruns a table/sheet's own bounds throws a real Error from documents.js's own mergeCells primitives (OdsSheet.mergeCells, DocxTable.mergeCells, OdtTable.mergeCells, this file's own mergePptxTableCells), and the UI screens that dispatch these actions bound their own row/column pickers against the target's current dimensions but cannot guarantee every dispatch stays in range (e.g. a screen driven by a scripted/test caller, or a race with a concurrent edit). Reports the thrown message as a warning status instead of letting it escape the reducer and crash the app. If `apply` throws after partially mutating the live tree (e.g. a docx table's own row-by-row mergeCells loop merging row 0 successfully before finding row 1 out of range), that partial mutation genuinely already happened — this only prevents the crash and the false "nothing changed" undo-stack/hasUnsavedChanges bookkeeping, it does not roll the live tree back, matching the "the reducer is deliberately impure" caveat at the top of this file.
export function mutateGuarded(
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

// The pptx-side counterpart to DocxTable.mergeCells/OdtTable.mergeCells: a DrawingML table has no such convenience on PptxTable itself (see documents.js's own edit/pptx/table.ts doc comment — every row always carries exactly `columns` a:tc elements, and a merge is expressed purely via gridSpan/rowSpan/hMerge/vMerge attributes on cells that already exist, never by removing or retagging an element the way docx/ODF each do). The anchor cell gets colSpan/rowSpan; every other cell in the rectangle gets horizontalMerge (covered from the left, in the SAME row) and/or verticalMerge (covered from above) set, matching real PowerPoint output for a rectangular merge's interior/trailing cells (both attributes set together), and its own content cleared.
export function mergePptxTableCells(
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
      // A covered cell holds no content of its own: the merged region's content belongs to the anchor (ContentTableCell's grid rule), and ooxml.js's reader ignores a hMerge/vMerge cell's a:txBody, so text left here would stay in the file while being invisible in every view of it. A single empty paragraph is the body of a freshly built cell.
      cell.setParagraphs([{ runs: [] }]);
    }
  }
}

export function wrongDocument(state: AppState, expected: string): AppState {
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

export function appReducer(state: AppState, action: Action): AppState {
  const pdfHandled = applyPdfAction(state, action);
  if (pdfHandled !== undefined) {
    return pdfHandled;
  }
  const textHandled = applyTextAction(state, action);
  if (textHandled !== undefined) {
    return textHandled;
  }
  const slideHandled = applySlideAction(state, action);
  if (slideHandled !== undefined) {
    return slideHandled;
  }
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
        // xlsx, csv, svg, rtf, wpd, doc, xls, ppt, and epub have no editor to open at all — action.doc is already a read-only PDF-preview conversion by the time it reaches here (see format/open-document.ts) — so these are the formats whose "opened" message doubles as pointing the way to the one thing that can actually be done with them next.
        action.doc.format === "xlsx" ||
          action.doc.format === "csv" ||
          action.doc.format === "svg" ||
          action.doc.format === "rtf" ||
          action.doc.format === "wpd" ||
          action.doc.format === "doc" ||
          action.doc.format === "xls" ||
          action.doc.format === "ppt" ||
          action.doc.format === "epub"
          ? `Opened ${action.path} as a read-only PDF preview — press ':' then 'export pdf' to save it as a real PDF`
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
      // odp has no per-kind convenience methods the way odg does — OdpSlide.addVector is the ONE generic method every kind goes through, so the ContentVector literal is built here from the same OdgBoxVectorInit/OdgLineVectorInit/OdgPathVectorInit shape the odg branch above already consumes, rather than a second, odp-specific init type.
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

    case "SET_METADATA": {
      const doc = state.openDocument;
      if (doc === undefined || !isEditableDocument(doc)) {
        return wrongDocument(state, "an editable document");
      }
      return mutate(state, doc, () => {
        doc.editor.metadata = action.overrides;
      });
    }

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
      // doc/xls/ppt are deliberately absent from this list: they gained real live-view editors (DocEditor/XlsEditor/PptEditor) and a reopenEditable case of their own in the same change that widened EditableOpenDocument to include them, so — like every other EditableOpenDocument format — they push real undo snapshots via mutate() and must be able to pop them back off here too. Only the genuinely read-only, no-live-editor formats belong in this list.
      if (
        doc.format === "odb" ||
        doc.format === "xlsx" ||
        doc.format === "csv" ||
        doc.format === "svg" ||
        doc.format === "rtf" ||
        doc.format === "wpd" ||
        doc.format === "epub"
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
    default:
      // The pdf-editor action family is handled by applyPdfAction before this switch; any action that still reaches here leaves state unchanged.
      return state;
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
