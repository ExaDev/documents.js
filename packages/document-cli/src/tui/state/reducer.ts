import {
  decodeMarkdownText,
  encodeMarkdownText,
  openDocx,
  openOdg,
  openOdp,
  openOds,
  openOdt,
  openPptx,
  type DocxParagraph,
  type DocxRun,
  type DocxTable,
  type DocxTableCell,
  type OdpShape,
  type OdsSheet,
  type OdtParagraph,
  type OdtRun,
  type OdtTable,
  type OdtTableCell,
  type PptxShape,
} from 'documents.js';
import { createNewDocument } from '../format/open-document.js';
import type { Action } from './actions.js';
import { rootScreenForFormat, type AppState, type DocxOpenDocument, type EditableOpenDocument, type MarkdownOpenDocument, type OdgOpenDocument, type OdpOpenDocument, type OdsOpenDocument, type OdtOpenDocument, type OpenDocument, type OverlayName, type OverlayState, type PptxOpenDocument, type StatusMessage } from './types.js';

// THIS REDUCER IS DELIBERATELY IMPURE FOR EVERY MUTATING ACTION, AND THAT IS THE DESIGN, NOT AN OVERSIGHT.
//
// documents.js's editors are live views over the mutable XML tree inside a decoded package: `run.bold = true` edits that tree in place and hands back no new object. There is no immutable document value to fold an action into and no new reference for React to compare, so a mutating case here calls the editor method that performs the real mutation and then returns a NEW OUTER STATE OBJECT (`{ ...state, hasUnsavedChanges: true, undoStack }`) purely so React sees a changed reference and re-renders the screens that read the document through fresh accessor calls. Re-running one of these actions against the same state does NOT produce the same result -- appending a paragraph twice appends two paragraphs. Do not add React StrictMode double-invocation, and do not replay actions.
//
// `Date.now()` in the status helper is impure for the same reason and to no lesser degree; a `ClockPort` would buy nothing while the mutations themselves are in here.

const UNDO_STACK_LIMIT = 20;

export function createInitialState(options?: { readonly cwd?: string }): AppState {
  return {
    stack: [{ kind: 'launcher' }],
    openDocument: undefined,
    hasUnsavedChanges: false,
    overlays: { commandPalette: false, search: false, help: false, confirmQuit: false, confirmClose: false, diagnosticsPanel: false },
    status: undefined,
    diagnostics: [],
    undoStack: [],
    selection: {},
    searchQuery: '',
    errorDetail: undefined,
    isExiting: false,
    cwd: options?.cwd ?? process.cwd(),
  };
}

function withStatus(state: AppState, severity: StatusMessage['severity'], text: string): AppState {
  return { ...state, status: { severity, text, createdAtMs: Date.now() } };
}

function setOverlay(overlays: OverlayState, overlay: OverlayName, open: boolean): OverlayState {
  switch (overlay) {
    case 'commandPalette':
      return { ...overlays, commandPalette: open };
    case 'search':
      return { ...overlays, search: open };
    case 'help':
      return { ...overlays, help: open };
    case 'confirmQuit':
      return { ...overlays, confirmQuit: open };
    case 'confirmClose':
      return { ...overlays, confirmClose: open };
    case 'diagnosticsPanel':
      return { ...overlays, diagnosticsPanel: open };
  }
}

function pushSnapshot(stack: readonly Uint8Array<ArrayBuffer>[], snapshot: Uint8Array<ArrayBuffer>): readonly Uint8Array<ArrayBuffer>[] {
  const next = [...stack, snapshot];
  return next.length > UNDO_STACK_LIMIT ? next.slice(next.length - UNDO_STACK_LIMIT) : next;
}

function documentWithPath(doc: OpenDocument, path: string): OpenDocument {
  switch (doc.format) {
    case 'docx':
      return { format: 'docx', editor: doc.editor, path };
    case 'pptx':
      return { format: 'pptx', editor: doc.editor, path };
    case 'odt':
      return { format: 'odt', editor: doc.editor, path };
    case 'odp':
      return { format: 'odp', editor: doc.editor, path };
    case 'ods':
      return { format: 'ods', editor: doc.editor, path };
    case 'odg':
      return { format: 'odg', editor: doc.editor, path };
    case 'odb':
      return { format: 'odb', tables: doc.tables, forms: doc.forms, reports: doc.reports, path };
    case 'markdown':
      return { format: 'markdown', source: doc.source, path };
    case 'pdf':
      return { format: 'pdf', layout: doc.layout, path };
  }
}

function reopenEditable(doc: EditableOpenDocument, bytes: Uint8Array<ArrayBuffer>): EditableOpenDocument {
  switch (doc.format) {
    case 'docx':
      return { format: 'docx', editor: openDocx(bytes), path: doc.path };
    case 'pptx':
      return { format: 'pptx', editor: openPptx(bytes), path: doc.path };
    case 'odt':
      return { format: 'odt', editor: openOdt(bytes), path: doc.path };
    case 'odp':
      return { format: 'odp', editor: openOdp(bytes), path: doc.path };
    case 'ods':
      return { format: 'ods', editor: openOds(bytes), path: doc.path };
    case 'odg':
      return { format: 'odg', editor: openOdg(bytes), path: doc.path };
  }
}

// Snapshot BEFORE the mutation runs, so the pushed entry is the state to come back to, then run the mutation against the live tree and hand React a fresh outer object.
function mutate(state: AppState, doc: EditableOpenDocument, apply: () => void): AppState {
  const snapshot = doc.editor.toBytes();
  apply();
  return { ...state, hasUnsavedChanges: true, undoStack: pushSnapshot(state.undoStack, snapshot) };
}

// Markdown's own counterpart to `mutate` above -- but genuinely pure, unlike every other mutating case in this reducer. A markdown document is a plain string value, not a live view over a mutable XmlElement tree, so there is nothing to `apply()` in place: this just returns a new outer state with `.source` replaced and the PREVIOUS source pushed onto the same undoStack the live-editor formats already share, encoded through the identical byte<->text boundary (`encodeMarkdownText`/`decodeMarkdownText`) markdownToPdf/markdownToDocx/markdownToOdt already use -- so UNDO's own restore step needs no markdown-specific stack at all, just a markdown-specific decode of whichever snapshot it pops.
function mutateMarkdown(state: AppState, doc: MarkdownOpenDocument, source: string): AppState {
  const snapshot = encodeMarkdownText(doc.source);
  return {
    ...state,
    openDocument: { ...doc, source },
    hasUnsavedChanges: true,
    undoStack: pushSnapshot(state.undoStack, snapshot),
  };
}

function wrongDocument(state: AppState, expected: string): AppState {
  const actual = state.openDocument === undefined ? 'no document' : state.openDocument.format;
  return withStatus(state, 'warning', `That action needs ${expected}; the open document is ${actual}`);
}

type WordprocessingOpenDocument = DocxOpenDocument | OdtOpenDocument;
type PresentationOpenDocument = PptxOpenDocument | OdpOpenDocument;
type ShapeHostOpenDocument = PresentationOpenDocument | OdgOpenDocument;

function wordprocessingDocument(state: AppState): WordprocessingOpenDocument | undefined {
  const doc = state.openDocument;
  if (doc === undefined) {
    return undefined;
  }
  return doc.format === 'docx' || doc.format === 'odt' ? doc : undefined;
}

function presentationDocument(state: AppState): PresentationOpenDocument | undefined {
  const doc = state.openDocument;
  if (doc === undefined) {
    return undefined;
  }
  return doc.format === 'pptx' || doc.format === 'odp' ? doc : undefined;
}

function shapeHostDocument(state: AppState): ShapeHostOpenDocument | undefined {
  const doc = state.openDocument;
  if (doc === undefined) {
    return undefined;
  }
  return doc.format === 'pptx' || doc.format === 'odp' || doc.format === 'odg' ? doc : undefined;
}

function spreadsheetDocument(state: AppState): OdsOpenDocument | undefined {
  const doc = state.openDocument;
  if (doc === undefined) {
    return undefined;
  }
  return doc.format === 'ods' ? doc : undefined;
}

function drawingDocument(state: AppState): OdgOpenDocument | undefined {
  const doc = state.openDocument;
  if (doc === undefined) {
    return undefined;
  }
  return doc.format === 'odg' ? doc : undefined;
}

function markdownDocument(state: AppState): MarkdownOpenDocument | undefined {
  const doc = state.openDocument;
  if (doc === undefined) {
    return undefined;
  }
  return doc.format === 'markdown' ? doc : undefined;
}

function paragraphAt(doc: WordprocessingOpenDocument, blockIndex: number): DocxParagraph | OdtParagraph | undefined {
  return doc.editor.paragraphs()[blockIndex];
}

function tableAt(doc: WordprocessingOpenDocument, tableIndex: number): DocxTable | OdtTable | undefined {
  return doc.editor.tables()[tableIndex];
}

function shapeAt(doc: ShapeHostOpenDocument, containerIndex: number, shapeIndex: number): PptxShape | OdpShape | undefined {
  if (doc.format === 'odg') {
    return doc.editor.pages()[containerIndex]?.shapes()[shapeIndex];
  }
  return doc.editor.slides()[containerIndex]?.shapes()[shapeIndex];
}

// Only odp/odg shapes are `OdpShape`, the one shape class with a real `draw:transform` rotation setter; `PptxShape` has none, so SET_SHAPE_ROTATION resolves through this narrower accessor and reports a warning rather than crashing when the open document is pptx.
function rotatableShapeAt(doc: OdpOpenDocument | OdgOpenDocument, containerIndex: number, shapeIndex: number): OdpShape | undefined {
  if (doc.format === 'odg') {
    return doc.editor.pages()[containerIndex]?.shapes()[shapeIndex];
  }
  return doc.editor.slides()[containerIndex]?.shapes()[shapeIndex];
}

function sheetAt(doc: OdsOpenDocument, sheetIndex: number): OdsSheet | undefined {
  return doc.editor.sheets()[sheetIndex];
}

function withRun(state: AppState, blockIndex: number, runIndex: number, apply: (run: DocxRun | OdtRun) => void): AppState {
  const doc = wordprocessingDocument(state);
  if (doc === undefined) {
    return wrongDocument(state, 'a docx or odt document');
  }
  const paragraph = paragraphAt(doc, blockIndex);
  if (paragraph === undefined) {
    return withStatus(state, 'warning', `There is no paragraph at index ${blockIndex}`);
  }
  const run = paragraph.runs()[runIndex];
  if (run === undefined) {
    return withStatus(state, 'warning', `Paragraph ${blockIndex} has no run at index ${runIndex}`);
  }
  return mutate(state, doc, () => {
    apply(run);
  });
}

function withShape(state: AppState, containerIndex: number, shapeIndex: number, apply: (shape: PptxShape | OdpShape) => void): AppState {
  const doc = shapeHostDocument(state);
  if (doc === undefined) {
    return wrongDocument(state, 'a pptx, odp or odg document');
  }
  const shape = shapeAt(doc, containerIndex, shapeIndex);
  if (shape === undefined) {
    return withStatus(state, 'warning', `There is no shape ${shapeIndex} on ${doc.format === 'odg' ? 'page' : 'slide'} ${containerIndex}`);
  }
  return mutate(state, doc, () => {
    apply(shape);
  });
}

function withSheet(state: AppState, sheetIndex: number, apply: (sheet: OdsSheet) => void): AppState {
  const doc = spreadsheetDocument(state);
  if (doc === undefined) {
    return wrongDocument(state, 'an ods document');
  }
  const sheet = sheetAt(doc, sheetIndex);
  if (sheet === undefined) {
    return withStatus(state, 'warning', `There is no sheet at index ${sheetIndex}`);
  }
  return mutate(state, doc, () => {
    apply(sheet);
  });
}

// A cell's text is replaced rather than appended: documents.js gives a table cell `paragraphs()`/`appendParagraph()` and a read-only `text`, so the first paragraph's first run carries the new value and any further runs in it are removed.
function setCellText(cell: DocxTableCell | OdtTableCell, text: string): void {
  const existing = cell.paragraphs();
  const first = existing[0];
  const paragraph = first ?? cell.appendParagraph();
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

export function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'PUSH_SCREEN':
      return { ...state, stack: [...state.stack, action.screen] };

    case 'POP_SCREEN':
      return state.stack.length <= 1 ? state : { ...state, stack: state.stack.slice(0, -1) };

    case 'RESET_STACK':
      return { ...state, stack: [action.screen] };

    case 'OPEN_OVERLAY':
      return { ...state, overlays: setOverlay(state.overlays, action.overlay, true) };

    case 'CLOSE_OVERLAY':
      return { ...state, overlays: setOverlay(state.overlays, action.overlay, false) };

    case 'REQUEST_QUIT':
      return state.hasUnsavedChanges ? { ...state, overlays: setOverlay(state.overlays, 'confirmQuit', true) } : { ...state, isExiting: true };

    case 'CONFIRM_QUIT':
      return { ...state, overlays: setOverlay(state.overlays, 'confirmQuit', false), isExiting: true };

    case 'CANCEL_QUIT':
      return { ...state, overlays: setOverlay(state.overlays, 'confirmQuit', false) };

    case 'REQUEST_CLOSE':
      if (state.openDocument === undefined) {
        return withStatus(state, 'info', 'There is no open document to close');
      }
      return state.hasUnsavedChanges ? { ...state, overlays: setOverlay(state.overlays, 'confirmClose', true) } : closeDocument(state);

    case 'CONFIRM_CLOSE':
      return closeDocument({ ...state, overlays: setOverlay(state.overlays, 'confirmClose', false) });

    case 'CANCEL_CLOSE':
      return { ...state, overlays: setOverlay(state.overlays, 'confirmClose', false) };

    case 'CLOSE_DOCUMENT':
      return closeDocument(state);

    // The stack reset lives here rather than in a separate RESET_STACK the caller has to remember: an opened document always lands on its own format's root screen, and splitting that across two dispatches only creates a frame where the two disagree.
    case 'OPEN_FILE_SUCCESS':
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
        'info',
        `Opened ${action.path}`,
      );

    case 'OPEN_FILE_ERROR':
      return withStatus({ ...state, errorDetail: { message: action.message, detail: action.detail } }, 'error', action.message);

    case 'CREATE_DOCUMENT': {
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
        'info',
        `New ${action.format} document`,
      );
    }

    case 'SAVE_SUCCESS': {
      const doc = state.openDocument;
      if (doc === undefined) {
        return withStatus(state, 'warning', 'Saved, but there is no open document to record the path against');
      }
      return withStatus({ ...state, openDocument: documentWithPath(doc, action.path), hasUnsavedChanges: false }, 'info', `Saved ${action.path}`);
    }

    case 'SAVE_ERROR':
      return withStatus(state, 'error', action.message);

    case 'SAVE_AS_REQUEST':
      return { ...state, stack: [...state.stack, { kind: 'saveAsPrompt' }] };

    case 'SET_SELECTION':
      return { ...state, selection: { ...state.selection, [action.key]: action.index } };

    case 'APPEND_PARAGRAPH': {
      const doc = wordprocessingDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, 'a docx or odt document');
      }
      return mutate(state, doc, () => {
        doc.editor.body.appendParagraph({ text: action.text, styleId: action.styleId, alignment: action.alignment });
      });
    }

    case 'SET_PARAGRAPH_ALIGNMENT': {
      const doc = wordprocessingDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, 'a docx or odt document');
      }
      const paragraph = paragraphAt(doc, action.blockIndex);
      if (paragraph === undefined) {
        return withStatus(state, 'warning', `There is no paragraph at index ${action.blockIndex}`);
      }
      return mutate(state, doc, () => {
        paragraph.alignment = action.alignment;
      });
    }

    case 'APPEND_RUN': {
      const doc = wordprocessingDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, 'a docx or odt document');
      }
      const paragraph = paragraphAt(doc, action.blockIndex);
      if (paragraph === undefined) {
        return withStatus(state, 'warning', `There is no paragraph at index ${action.blockIndex}`);
      }
      return mutate(state, doc, () => {
        paragraph.appendRun({ text: action.text });
      });
    }

    case 'SET_RUN_TEXT':
      return withRun(state, action.blockIndex, action.runIndex, (run) => {
        run.text = action.text;
      });

    case 'TOGGLE_RUN_BOLD':
      return withRun(state, action.blockIndex, action.runIndex, (run) => {
        run.bold = !run.bold;
      });

    case 'TOGGLE_RUN_ITALIC':
      return withRun(state, action.blockIndex, action.runIndex, (run) => {
        run.italic = !run.italic;
      });

    case 'TOGGLE_RUN_UNDERLINE':
      return withRun(state, action.blockIndex, action.runIndex, (run) => {
        run.underline = !run.underline;
      });

    case 'SET_RUN_COLOR':
      return withRun(state, action.blockIndex, action.runIndex, (run) => {
        run.color = action.color;
      });

    case 'APPEND_TABLE': {
      const doc = wordprocessingDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, 'a docx or odt document');
      }
      return mutate(state, doc, () => {
        doc.editor.body.appendTable({ rows: action.rows, columns: action.columns });
      });
    }

    case 'SET_TABLE_CELL_TEXT': {
      const doc = wordprocessingDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, 'a docx or odt document');
      }
      const table = tableAt(doc, action.tableIndex);
      if (table === undefined) {
        return withStatus(state, 'warning', `There is no table at index ${action.tableIndex}`);
      }
      return mutate(state, doc, () => {
        setCellText(table.cell(action.row, action.column), action.text);
      });
    }

    // ODF models a list as a real `text:list`/`text:list-item` tree, OOXML as a flat per-paragraph numId/level membership -- so the two write paths genuinely differ rather than sharing one accessor. For odt the anchor block index selects which `text:list` to extend; for docx it selects the paragraph whose list membership a newly appended paragraph should copy.
    case 'ADD_LIST_ITEM': {
      const doc = wordprocessingDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, 'a docx or odt document');
      }
      if (doc.format === 'odt') {
        const list = doc.editor.lists()[action.blockIndex];
        if (list === undefined) {
          return withStatus(state, 'warning', `There is no list at index ${action.blockIndex}`);
        }
        return mutate(state, doc, () => {
          list.addItem().appendParagraph({ text: action.text });
        });
      }
      const anchor = doc.editor.paragraphs()[action.blockIndex];
      if (anchor === undefined) {
        return withStatus(state, 'warning', `There is no paragraph at index ${action.blockIndex}`);
      }
      const membership = anchor.list;
      if (membership === undefined) {
        return withStatus(state, 'warning', `Paragraph ${action.blockIndex} is not part of a list`);
      }
      return mutate(state, doc, () => {
        const appended = doc.editor.body.appendParagraph({ text: action.text });
        appended.list = membership;
      });
    }

    case 'ADD_SLIDE': {
      const doc = presentationDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, 'a pptx or odp document');
      }
      return mutate(state, doc, () => {
        doc.editor.addSlide();
      });
    }

    case 'ADD_SLIDE_TABLE': {
      const doc = presentationDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, 'a pptx or odp document');
      }
      const slide = doc.editor.slides()[action.slideIndex];
      if (slide === undefined) {
        return withStatus(state, 'warning', `There is no slide at index ${action.slideIndex}`);
      }
      return mutate(state, doc, () => {
        slide.addTable({ frame: action.frame, table: { rows: action.rows, columns: action.columns } });
      });
    }

    case 'ADD_TEXTBOX': {
      const doc = shapeHostDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, 'a pptx, odp or odg document');
      }
      if (doc.format === 'odg') {
        const page = doc.editor.pages()[action.containerIndex];
        if (page === undefined) {
          return withStatus(state, 'warning', `There is no page at index ${action.containerIndex}`);
        }
        return mutate(state, doc, () => {
          page.addTextBox({ frame: action.frame, text: action.text });
        });
      }
      const slide = doc.editor.slides()[action.containerIndex];
      if (slide === undefined) {
        return withStatus(state, 'warning', `There is no slide at index ${action.containerIndex}`);
      }
      return mutate(state, doc, () => {
        slide.addTextBox({ frame: action.frame, text: action.text });
      });
    }

    case 'ADD_IMAGE': {
      const doc = shapeHostDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, 'a pptx, odp or odg document');
      }
      const image = { frame: action.frame, format: action.format, bytes: action.bytes, altText: action.altText };
      if (doc.format === 'odg') {
        const page = doc.editor.pages()[action.containerIndex];
        if (page === undefined) {
          return withStatus(state, 'warning', `There is no page at index ${action.containerIndex}`);
        }
        return mutate(state, doc, () => {
          page.addImage(image);
        });
      }
      const slide = doc.editor.slides()[action.containerIndex];
      if (slide === undefined) {
        return withStatus(state, 'warning', `There is no slide at index ${action.containerIndex}`);
      }
      return mutate(state, doc, () => {
        slide.addImage(image);
      });
    }

    case 'SET_SHAPE_TEXT':
      return withShape(state, action.containerIndex, action.shapeIndex, (shape) => {
        shape.text = action.text;
      });

    case 'SET_SHAPE_FRAME':
      return withShape(state, action.containerIndex, action.shapeIndex, (shape) => {
        shape.frame = action.frame;
      });

    case 'SET_SHAPE_ROTATION': {
      const doc = shapeHostDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, 'a pptx, odp or odg document');
      }
      if (doc.format === 'pptx') {
        return withStatus(state, 'warning', 'documents.js has no rotation setter for a pptx shape; rotate the shape in odp instead');
      }
      const shape = rotatableShapeAt(doc, action.containerIndex, action.shapeIndex);
      if (shape === undefined) {
        return withStatus(state, 'warning', `There is no shape ${action.shapeIndex} at index ${action.containerIndex}`);
      }
      return mutate(state, doc, () => {
        shape.rotationDeg = action.rotationDeg;
      });
    }

    case 'SET_SLIDE_NOTES': {
      const doc = presentationDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, 'a pptx or odp document');
      }
      const slide = doc.editor.slides()[action.slideIndex];
      if (slide === undefined) {
        return withStatus(state, 'warning', `There is no slide at index ${action.slideIndex}`);
      }
      return mutate(state, doc, () => {
        slide.notes = action.notes;
      });
    }

    case 'ADD_SHEET': {
      const doc = spreadsheetDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, 'an ods document');
      }
      return mutate(state, doc, () => {
        doc.editor.addSheet(action.name);
      });
    }

    case 'SET_CELL_VALUE':
      return withSheet(state, action.sheetIndex, (sheet) => {
        sheet.cell(action.row, action.column).value = action.value;
      });

    case 'SET_SHEET_PRINT_SETTINGS':
      return withSheet(state, action.sheetIndex, (sheet) => {
        sheet.printSettings = action.printSettings;
      });

    case 'ADD_PAGE': {
      const doc = drawingDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, 'an odg document');
      }
      return mutate(state, doc, () => {
        doc.editor.addPage();
      });
    }

    case 'ADD_RECT':
    case 'ADD_ELLIPSE':
    case 'ADD_LINE':
    case 'ADD_PATH': {
      const doc = drawingDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, 'an odg document');
      }
      const page = doc.editor.pages()[action.pageIndex];
      if (page === undefined) {
        return withStatus(state, 'warning', `There is no page at index ${action.pageIndex}`);
      }
      return mutate(state, doc, () => {
        switch (action.type) {
          case 'ADD_RECT':
            page.addRect(action.init);
            return;
          case 'ADD_ELLIPSE':
            page.addEllipse(action.init);
            return;
          case 'ADD_LINE':
            page.addLine(action.init);
            return;
          case 'ADD_PATH':
            page.addPath(action.init);
            return;
        }
      });
    }

    case 'SET_VECTOR_FILL': {
      const doc = drawingDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, 'an odg document');
      }
      return mutate(state, doc, () => {
        action.vector.fill = action.fill;
      });
    }

    case 'SET_VECTOR_STROKE': {
      const doc = drawingDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, 'an odg document');
      }
      return mutate(state, doc, () => {
        action.vector.stroke = action.stroke;
      });
    }

    case 'SET_MARKDOWN_SOURCE': {
      const doc = markdownDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, 'a markdown document');
      }
      return mutateMarkdown(state, doc, action.source);
    }

    case 'APPEND_DIAGNOSTIC':
      return { ...state, diagnostics: [...state.diagnostics, action.diagnostic] };

    case 'DISMISS_DIAGNOSTIC':
      return { ...state, diagnostics: state.diagnostics.filter((_, index) => index !== action.index) };

    case 'CLEAR_DIAGNOSTICS':
      return { ...state, diagnostics: [] };

    case 'SET_STATUS':
      return withStatus(state, action.severity, action.text);

    case 'CLEAR_STATUS':
      return { ...state, status: undefined };

    case 'SET_SEARCH_QUERY':
      return { ...state, searchQuery: action.query };

    case 'DISMISS_ERROR_DETAIL':
      return { ...state, errorDetail: undefined };

    case 'UNDO': {
      const doc = state.openDocument;
      if (doc === undefined) {
        return withStatus(state, 'info', 'There is nothing to undo');
      }
      if (doc.format === 'odb' || doc.format === 'pdf') {
        return withStatus(state, 'warning', `A ${doc.format} document is read-only, so it has no history to undo`);
      }
      const snapshot = state.undoStack.at(-1);
      if (snapshot === undefined) {
        return withStatus(state, 'info', 'There is nothing to undo');
      }
      const restored: OpenDocument = doc.format === 'markdown' ? { ...doc, source: decodeMarkdownText(snapshot) } : reopenEditable(doc, snapshot);
      return withStatus(
        {
          ...state,
          openDocument: restored,
          undoStack: state.undoStack.slice(0, -1),
          hasUnsavedChanges: true,
        },
        'info',
        'Undone',
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
    searchQuery: '',
    errorDetail: undefined,
    stack: [{ kind: 'launcher' }],
  };
}
