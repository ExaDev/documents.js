import { createOdg, createOdp, createOds, createOdt, createPptx, odsToXlsx, openOdg, openOdp, openOdt, openPptx, readOdpContent, readPdf, readPptxContent, xlsxToPdf } from 'documents.js';
import { describe, expect, it } from 'vitest';
import type { Action } from './actions.js';
import { appReducer, createInitialState } from './reducer.js';
import type { AppState, DocxOpenDocument, MarkdownOpenDocument, OdgOpenDocument, OdpOpenDocument, OdsOpenDocument, OdtOpenDocument, PptxOpenDocument } from './types.js';

function applyAll(actions: readonly Action[], from: AppState = createInitialState()): AppState {
  return actions.reduce<AppState>(appReducer, from);
}

function docxDocument(state: AppState): DocxOpenDocument {
  const doc = state.openDocument;
  if (doc?.format !== 'docx') {
    throw new Error('expected an open docx document');
  }
  return doc;
}

function odsDocument(state: AppState): OdsOpenDocument {
  const doc = state.openDocument;
  if (doc?.format !== 'ods') {
    throw new Error('expected an open ods document');
  }
  return doc;
}

function pptxDocument(state: AppState): PptxOpenDocument {
  const doc = state.openDocument;
  if (doc?.format !== 'pptx') {
    throw new Error('expected an open pptx document');
  }
  return doc;
}

function odpDocument(state: AppState): OdpOpenDocument {
  const doc = state.openDocument;
  if (doc?.format !== 'odp') {
    throw new Error('expected an open odp document');
  }
  return doc;
}

function odtDocument(state: AppState): OdtOpenDocument {
  const doc = state.openDocument;
  if (doc?.format !== 'odt') {
    throw new Error('expected an open odt document');
  }
  return doc;
}

function odgDocument(state: AppState): OdgOpenDocument {
  const doc = state.openDocument;
  if (doc?.format !== 'odg') {
    throw new Error('expected an open odg document');
  }
  return doc;
}

function openPptxDocument(bytes: Uint8Array<ArrayBuffer>, path = '/tmp/deck.pptx'): AppState {
  return appReducer(createInitialState(), { type: 'OPEN_FILE_SUCCESS', path, doc: { format: 'pptx', editor: openPptx(bytes), path } });
}

function openOdpDocument(bytes: Uint8Array<ArrayBuffer>, path = '/tmp/deck.odp'): AppState {
  return appReducer(createInitialState(), { type: 'OPEN_FILE_SUCCESS', path, doc: { format: 'odp', editor: openOdp(bytes), path } });
}

function openOdtDocument(bytes: Uint8Array<ArrayBuffer>, path = '/tmp/doc.odt'): AppState {
  return appReducer(createInitialState(), { type: 'OPEN_FILE_SUCCESS', path, doc: { format: 'odt', editor: openOdt(bytes), path } });
}

function openOdgDocument(bytes: Uint8Array<ArrayBuffer>, path = '/tmp/drawing.odg'): AppState {
  return appReducer(createInitialState(), { type: 'OPEN_FILE_SUCCESS', path, doc: { format: 'odg', editor: openOdg(bytes), path } });
}

// Real xlsx bytes with no XlsxEditor to build one directly: createOds() -> odsToXlsx() is documents.js's own PDF-bypassing bridge, reused here purely as a source of genuine xlsx bytes for the reducer tests below.
function xlsxTestBytes(): Uint8Array<ArrayBuffer> {
  const editor = createOds();
  const sheet = editor.addSheet('Sheet1');
  sheet.cell(0, 0).value = { kind: 'string', value: 'Total' };
  return odsToXlsx(editor.toBytes());
}

// Mirrors format/open-document.ts's own xlsx branch exactly, so these reducer tests exercise OPEN_FILE_SUCCESS/UNDO against the identical XlsxOpenDocument shape the real TUI produces.
function openXlsxDocument(bytes: Uint8Array<ArrayBuffer>, path = '/tmp/workbook.xlsx'): AppState {
  return appReducer(createInitialState(), { type: 'OPEN_FILE_SUCCESS', path, doc: { format: 'xlsx', layout: readPdf(xlsxToPdf(bytes)), bytes, path } });
}

function markdownDocument(state: AppState): MarkdownOpenDocument {
  const doc = state.openDocument;
  if (doc?.format !== 'markdown') {
    throw new Error('expected an open markdown document');
  }
  return doc;
}

// There is no CREATE_DOCUMENT path for markdown (documents.js has no createMarkdown()) -- a MarkdownOpenDocument only ever comes from opening a real file, so tests seed one directly through OPEN_FILE_SUCCESS, the same action openDocumentAtPath's own real caller dispatches.
function openMarkdownDocument(source: string, path = '/tmp/notes.md'): AppState {
  return appReducer(createInitialState(), { type: 'OPEN_FILE_SUCCESS', path, doc: { format: 'markdown', source, path } });
}

describe('appReducer navigation', () => {
  it('pushes, pops and resets the screen stack, never emptying it', () => {
    const pushed = applyAll([
      { type: 'PUSH_SCREEN', screen: { kind: 'bodyList' } },
      { type: 'PUSH_SCREEN', screen: { kind: 'paragraphDetail', blockIndex: 2 } },
    ]);
    expect(pushed.stack.map((screen) => screen.kind)).toEqual(['launcher', 'bodyList', 'paragraphDetail']);

    const popped = applyAll([{ type: 'POP_SCREEN' }, { type: 'POP_SCREEN' }, { type: 'POP_SCREEN' }], pushed);
    expect(popped.stack.map((screen) => screen.kind)).toEqual(['launcher']);

    const reset = appReducer(pushed, { type: 'RESET_STACK', screen: { kind: 'slideList' } });
    expect(reset.stack.map((screen) => screen.kind)).toEqual(['slideList']);
  });

  it('quits straight away with nothing unsaved and asks first when there is', () => {
    expect(appReducer(createInitialState(), { type: 'REQUEST_QUIT' }).isExiting).toBe(true);

    const dirty = applyAll([{ type: 'CREATE_DOCUMENT', format: 'docx' }, { type: 'APPEND_PARAGRAPH', text: 'x', styleId: undefined, alignment: undefined }]);
    const asked = appReducer(dirty, { type: 'REQUEST_QUIT' });
    expect(asked.overlays.confirmQuit).toBe(true);
    expect(asked.isExiting).toBe(false);
    expect(appReducer(asked, { type: 'CONFIRM_QUIT' }).isExiting).toBe(true);
  });
});

describe('appReducer document lifecycle', () => {
  it('lands a newly created document on its own format root screen', () => {
    const cases: readonly [Action & { type: 'CREATE_DOCUMENT' }, string][] = [
      [{ type: 'CREATE_DOCUMENT', format: 'docx' }, 'bodyList'],
      [{ type: 'CREATE_DOCUMENT', format: 'odp' }, 'slideList'],
      [{ type: 'CREATE_DOCUMENT', format: 'ods' }, 'sheetList'],
      [{ type: 'CREATE_DOCUMENT', format: 'odg' }, 'pageList'],
    ];
    for (const [action, expectedKind] of cases) {
      const state = appReducer(createInitialState(), action);
      expect(state.stack.map((screen) => screen.kind)).toEqual([expectedKind]);
      expect(state.openDocument?.format).toBe(action.format);
      expect(state.hasUnsavedChanges).toBe(false);
    }
  });

  it('clears the document and history on close', () => {
    const closed = applyAll([
      { type: 'CREATE_DOCUMENT', format: 'docx' },
      { type: 'APPEND_PARAGRAPH', text: 'x', styleId: undefined, alignment: undefined },
      { type: 'CLOSE_DOCUMENT' },
    ]);
    expect(closed.openDocument).toBeUndefined();
    expect(closed.undoStack).toEqual([]);
    expect(closed.hasUnsavedChanges).toBe(false);
    expect(closed.stack.map((screen) => screen.kind)).toEqual(['launcher']);
  });
});

describe('appReducer docx mutations', () => {
  it('toggles a real run bold through the live editor and marks the document dirty', () => {
    const state = applyAll([
      { type: 'CREATE_DOCUMENT', format: 'docx' },
      { type: 'APPEND_PARAGRAPH', text: undefined, styleId: undefined, alignment: undefined },
      { type: 'APPEND_RUN', blockIndex: 0, text: 'Hello' },
    ]);

    const doc = docxDocument(state);
    const paragraph = doc.editor.paragraphs()[0];
    if (paragraph === undefined) {
      throw new Error('expected an appended paragraph');
    }
    const run = paragraph.runs()[0];
    if (run === undefined) {
      throw new Error('expected an appended run');
    }
    expect(run.bold).toBe(false);

    const bolded = appReducer(state, { type: 'TOGGLE_RUN_BOLD', blockIndex: 0, runIndex: 0 });
    expect(bolded.hasUnsavedChanges).toBe(true);
    expect(bolded).not.toBe(state);
    // The live view means the run object captured before the action already reflects the mutation -- there is no new object to re-read.
    expect(run.bold).toBe(true);

    const unbolded = appReducer(bolded, { type: 'TOGGLE_RUN_BOLD', blockIndex: 0, runIndex: 0 });
    expect(run.bold).toBe(false);
    expect(unbolded.hasUnsavedChanges).toBe(true);
  });

  it('reports a missing run rather than throwing', () => {
    const state = appReducer(createInitialState(), { type: 'CREATE_DOCUMENT', format: 'docx' });
    const missed = appReducer(state, { type: 'TOGGLE_RUN_BOLD', blockIndex: 7, runIndex: 0 });
    expect(missed.status?.severity).toBe('warning');
    expect(missed.hasUnsavedChanges).toBe(false);
  });

  it('warns instead of mutating when the open document is the wrong format', () => {
    const state = appReducer(createInitialState(), { type: 'CREATE_DOCUMENT', format: 'ods' });
    const warned = appReducer(state, { type: 'APPEND_PARAGRAPH', text: 'x', styleId: undefined, alignment: undefined });
    expect(warned.status?.severity).toBe('warning');
    expect(warned.hasUnsavedChanges).toBe(false);
  });
});

describe('appReducer SET_LIST_ITEM_TEXT on odt', () => {
  it('replaces a real list item\'s text and the change round-trips through re-decoding the package', () => {
    const editor = createOdt();
    const list = editor.body.appendList();
    list.addItem().appendParagraph({ text: 'first' });
    list.addItem().appendParagraph({ text: 'second' });
    const opened = openOdtDocument(editor.toBytes());
    const blockIndex = odtDocument(opened).editor.lists().length - 1;

    const edited = appReducer(opened, { type: 'SET_LIST_ITEM_TEXT', blockIndex, itemIndex: 1, text: 'SECOND, EDITED' });
    expect(edited.hasUnsavedChanges).toBe(true);
    const items = odtDocument(edited).editor.lists()[blockIndex]?.items();
    expect(items?.[0]?.text).toBe('first');
    expect(items?.[1]?.text).toBe('SECOND, EDITED');

    // Re-decoding the saved bytes as a completely fresh package proves the edit was written into the real text:list-item tree, not just held on the live in-memory object.
    const reopened = openOdt(odtDocument(edited).editor.toBytes());
    const reopenedItems = reopened.lists()[blockIndex]?.items();
    expect(reopenedItems?.[0]?.text).toBe('first');
    expect(reopenedItems?.[1]?.text).toBe('SECOND, EDITED');
  });

  it('warns rather than crashing for a list index that does not exist', () => {
    const editor = createOdt();
    editor.body.appendList().addItem().appendParagraph({ text: 'only' });
    const opened = openOdtDocument(editor.toBytes());

    const result = appReducer(opened, { type: 'SET_LIST_ITEM_TEXT', blockIndex: 5, itemIndex: 0, text: 'x' });
    expect(result.status?.severity).toBe('warning');
    expect(result.hasUnsavedChanges).toBe(false);
  });

  it('warns rather than crashing for an item index that does not exist', () => {
    const editor = createOdt();
    const list = editor.body.appendList();
    list.addItem().appendParagraph({ text: 'only' });
    const opened = openOdtDocument(editor.toBytes());
    const blockIndex = odtDocument(opened).editor.lists().length - 1;

    const result = appReducer(opened, { type: 'SET_LIST_ITEM_TEXT', blockIndex, itemIndex: 3, text: 'x' });
    expect(result.status?.severity).toBe('warning');
    expect(result.hasUnsavedChanges).toBe(false);
  });

  it('warns instead of mutating when the open document is docx (lists are an odt-only concept)', () => {
    const state = appReducer(createInitialState(), { type: 'CREATE_DOCUMENT', format: 'docx' });
    const warned = appReducer(state, { type: 'SET_LIST_ITEM_TEXT', blockIndex: 0, itemIndex: 0, text: 'x' });
    expect(warned.status?.severity).toBe('warning');
    expect(warned.hasUnsavedChanges).toBe(false);
  });
});

describe('appReducer ods mutations', () => {
  it('writes a cell value through the real OdsCell setter', () => {
    const created = applyAll([{ type: 'CREATE_DOCUMENT', format: 'ods' }, { type: 'ADD_SHEET', name: 'Data' }]);
    const sheetIndex = odsDocument(created).editor.sheets().length - 1;

    const written = appReducer(created, { type: 'SET_CELL_VALUE', sheetIndex, row: 2, column: 3, value: { kind: 'string', value: 'Total' } });
    expect(written.hasUnsavedChanges).toBe(true);

    const sheet = odsDocument(written).editor.sheets()[sheetIndex];
    if (sheet === undefined) {
      throw new Error('expected the added sheet');
    }
    expect(sheet.cell(2, 3).value).toEqual({ kind: 'string', value: 'Total' });
  });
});

describe('appReducer markdown mutations', () => {
  it('lands an opened markdown document on the line-list root screen', () => {
    const state = openMarkdownDocument('# Title\n\nBody text');
    expect(state.stack.map((screen) => screen.kind)).toEqual(['markdownLineList']);
    expect(markdownDocument(state).source).toBe('# Title\n\nBody text');
  });

  it('replaces the whole source on SET_MARKDOWN_SOURCE and marks the document dirty', () => {
    const state = openMarkdownDocument('one\ntwo\nthree');
    const edited = appReducer(state, { type: 'SET_MARKDOWN_SOURCE', source: 'one\nTWO\nthree' });
    expect(markdownDocument(edited).source).toBe('one\nTWO\nthree');
    expect(edited.hasUnsavedChanges).toBe(true);
    expect(edited.undoStack).toHaveLength(1);
  });

  it('warns instead of mutating when the open document is the wrong format', () => {
    const state = appReducer(createInitialState(), { type: 'CREATE_DOCUMENT', format: 'docx' });
    const warned = appReducer(state, { type: 'SET_MARKDOWN_SOURCE', source: 'x' });
    expect(warned.status?.severity).toBe('warning');
    expect(warned.hasUnsavedChanges).toBe(false);
  });
});

describe('appReducer undo', () => {
  it('restores a markdown document to its source before the last SET_MARKDOWN_SOURCE', () => {
    const opened = openMarkdownDocument('one\ntwo');
    const edited = appReducer(opened, { type: 'SET_MARKDOWN_SOURCE', source: 'one\nTWO' });
    expect(edited.undoStack).toHaveLength(1);

    const undone = appReducer(edited, { type: 'UNDO' });
    expect(undone.undoStack).toHaveLength(0);
    expect(markdownDocument(undone).source).toBe('one\ntwo');
    expect(undone.hasUnsavedChanges).toBe(true);
  });

  it('restores the snapshot taken before the last mutation', () => {
    const created = appReducer(createInitialState(), { type: 'CREATE_DOCUMENT', format: 'docx' });
    const paragraphsBefore = docxDocument(created).editor.paragraphs().length;

    const appended = appReducer(created, { type: 'APPEND_PARAGRAPH', text: 'undo me', styleId: undefined, alignment: undefined });
    expect(docxDocument(appended).editor.paragraphs()).toHaveLength(paragraphsBefore + 1);
    expect(appended.undoStack).toHaveLength(1);

    const undone = appReducer(appended, { type: 'UNDO' });
    expect(undone.undoStack).toHaveLength(0);
    expect(docxDocument(undone).editor.paragraphs()).toHaveLength(paragraphsBefore);
    // Undo replaces the editor wholesale by re-opening the snapshot bytes, so the old editor object is not the one in state any more.
    expect(docxDocument(undone).editor).not.toBe(docxDocument(appended).editor);
  });

  it('says so when there is nothing to undo', () => {
    const created = appReducer(createInitialState(), { type: 'CREATE_DOCUMENT', format: 'docx' });
    const undone = appReducer(created, { type: 'UNDO' });
    expect(undone.status?.severity).toBe('info');
    expect(undone.openDocument).toBe(created.openDocument);
  });
});

describe('appReducer ADD_SLIDE_TABLE', () => {
  it('adds a real table to a pptx slide, reachable through documents.js own PptxSlide.addTable', () => {
    const editor = createPptx();
    editor.addSlide();
    const opened = openPptxDocument(editor.toBytes());

    const withTable = appReducer(opened, { type: 'ADD_SLIDE_TABLE', slideIndex: 0, frame: { xPt: 10, yPt: 10, widthPt: 200, heightPt: 100 }, rows: 3, columns: 2 });
    expect(withTable.hasUnsavedChanges).toBe(true);

    // PptxSlide.shapes() never returns a table graphicFrame at all (documents.js's own shapes() walk only matches p:sp/p:pic), so the only way to observe the table this reducer just added is the same read-only pivot readPptxContent already uses -- proving the mutation reached the real package, not just that the action was accepted.
    const content = readPptxContent(pptxDocument(withTable).editor.toPackage());
    if (content.kind !== 'presentation') {
      throw new Error(`expected a presentation ContentDocument from readPptxContent, got ${content.kind}`);
    }
    const tableBlock = content.slides[0]?.shapes[0]?.blocks[0];
    if (tableBlock?.kind !== 'table') {
      throw new Error(`expected a table block on slide 0's first shape, got ${tableBlock?.kind}`);
    }
    expect(tableBlock.rows).toHaveLength(3);
    expect(tableBlock.rows[0]?.cells).toHaveLength(2);
  });

  it('adds a real table to an odp slide, reachable through documents.js own OdpSlide.addTable', () => {
    const editor = createOdp();
    editor.addSlide();
    const opened = openOdpDocument(editor.toBytes());

    const withTable = appReducer(opened, { type: 'ADD_SLIDE_TABLE', slideIndex: 0, frame: { xPt: 10, yPt: 10, widthPt: 200, heightPt: 100 }, rows: 2, columns: 4 });
    expect(withTable.hasUnsavedChanges).toBe(true);

    const content = readOdpContent(odpDocument(withTable).editor.toPackage());
    if (content.kind !== 'presentation') {
      throw new Error(`expected a presentation ContentDocument from readOdpContent, got ${content.kind}`);
    }
    const tableBlock = content.slides[0]?.shapes[0]?.blocks[0];
    if (tableBlock?.kind !== 'table') {
      throw new Error(`expected a table block on slide 0's first shape, got ${tableBlock?.kind}`);
    }
    expect(tableBlock.rows).toHaveLength(2);
    expect(tableBlock.rows[0]?.cells).toHaveLength(4);
  });

  it('warns rather than crashing for a slide index that does not exist', () => {
    const editor = createPptx();
    editor.addSlide();
    const opened = openPptxDocument(editor.toBytes());

    const result = appReducer(opened, { type: 'ADD_SLIDE_TABLE', slideIndex: 5, frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 }, rows: 2, columns: 2 });
    expect(result.status?.severity).toBe('warning');
    expect(result.hasUnsavedChanges).toBe(false);
  });

  it('warns rather than crashing when the open document is not a pptx or odp document', () => {
    const created = appReducer(createInitialState(), { type: 'CREATE_DOCUMENT', format: 'docx' });
    const result = appReducer(created, { type: 'ADD_SLIDE_TABLE', slideIndex: 0, frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 }, rows: 2, columns: 2 });
    expect(result.status?.severity).toBe('warning');
    expect(result.status?.text).toContain('pptx or odp');
  });
});

describe('appReducer SET_SLIDE_NOTES on pptx', () => {
  it('sets real speaker notes on a pptx slide, not just an odp one', () => {
    const editor = createPptx();
    editor.addSlide();
    const opened = openPptxDocument(editor.toBytes());

    const withNotes = appReducer(opened, { type: 'SET_SLIDE_NOTES', slideIndex: 0, notes: 'Remember to mention Q3 growth' });
    expect(withNotes.hasUnsavedChanges).toBe(true);
    expect(pptxDocument(withNotes).editor.slides()[0]?.notes).toBe('Remember to mention Q3 growth');
  });
});

describe('appReducer SET_SHAPE_ROTATION on pptx', () => {
  it('rotates a real pptx shape, not just an odp one, and the rotation round-trips through re-decoding the package', () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    slide.addTextBox({ frame: { xPt: 10, yPt: 10, widthPt: 100, heightPt: 50 }, text: 'Title' });
    const opened = openPptxDocument(editor.toBytes());

    const rotated = appReducer(opened, { type: 'SET_SHAPE_ROTATION', containerIndex: 0, shapeIndex: 0, rotationDeg: 30 });
    expect(rotated.hasUnsavedChanges).toBe(true);
    // The live view means the shape object captured before the action already reflects the mutation.
    expect(pptxDocument(rotated).editor.slides()[0]?.shapes()[0]?.rotationDeg).toBeCloseTo(30, 5);

    // Re-decoding the saved bytes as a completely fresh package proves the rotation was written into the real docx/pptx tree, not just held on the live in-memory object.
    const reopened = openPptx(pptxDocument(rotated).editor.toBytes());
    expect(reopened.slides()[0]?.shapes()[0]?.rotationDeg).toBeCloseTo(30, 5);
  });

  it('warns rather than crashing for a shape index that does not exist', () => {
    const editor = createPptx();
    editor.addSlide();
    const opened = openPptxDocument(editor.toBytes());

    const result = appReducer(opened, { type: 'SET_SHAPE_ROTATION', containerIndex: 0, shapeIndex: 5, rotationDeg: 30 });
    expect(result.status?.severity).toBe('warning');
    expect(result.hasUnsavedChanges).toBe(false);
  });
});

describe('appReducer xlsx (read-only PDF-preview) documents', () => {
  it('opens with a status message pointing at the export-pdf flow, unlike every other format', () => {
    const bytes = xlsxTestBytes();
    const opened = openXlsxDocument(bytes, '/tmp/report.xlsx');

    expect(opened.openDocument?.format).toBe('xlsx');
    expect(opened.stack.map((screen) => screen.kind)).toEqual(['pdfPageList']);
    expect(opened.status?.severity).toBe('info');
    expect(opened.status?.text).toContain('read-only PDF preview');
    expect(opened.status?.text).toContain('export pdf');

    const docxOpened = appReducer(createInitialState(), { type: 'CREATE_DOCUMENT', format: 'docx' });
    expect(docxOpened.status?.text).not.toContain('read-only');
  });

  it('has no undo history, the same as pdf and odb', () => {
    const opened = openXlsxDocument(xlsxTestBytes());
    const undone = appReducer(opened, { type: 'UNDO' });
    expect(undone.status?.severity).toBe('warning');
    expect(undone.status?.text).toContain('read-only');
    expect(undone.openDocument).toBe(opened.openDocument);
  });
});

describe('appReducer SET_VECTOR_FILL / SET_VECTOR_STROKE on odg', () => {
  it('edits a real rect vector\'s fill and stroke, and the change round-trips through re-decoding the package', () => {
    const editor = createOdg();
    const page = editor.addPage();
    page.addRect({ frame: { xPt: 10, yPt: 10, widthPt: 40, heightPt: 30 }, fill: { r: 1, g: 0, b: 0 } });
    const opened = openOdgDocument(editor.toBytes());

    const liveVector = odgDocument(opened).editor.pages()[0]?.vectors()[0];
    if (liveVector === undefined || liveVector.kind === 'line') {
      throw new Error('expected a rect vector');
    }

    const filled = appReducer(opened, { type: 'SET_VECTOR_FILL', vector: liveVector, fill: { r: 0, g: 1, b: 0 } });
    expect(filled.hasUnsavedChanges).toBe(true);
    // The live view means the vector object captured before the action already reflects the mutation.
    expect(liveVector.fill).toEqual({ r: 0, g: 1, b: 0 });

    const stroked = appReducer(filled, { type: 'SET_VECTOR_STROKE', vector: liveVector, stroke: { color: { r: 0, g: 0, b: 1 }, widthPt: 2 } });
    expect(stroked.hasUnsavedChanges).toBe(true);
    expect(liveVector.stroke).toEqual({ color: { r: 0, g: 0, b: 1 }, widthPt: 2 });

    // Re-decoding the saved bytes as a completely fresh package proves both edits were written into the real draw:rect element, not just held on the live in-memory object.
    const reopened = openOdg(odgDocument(stroked).editor.toBytes());
    const reopenedVector = reopened.pages()[0]?.vectors()[0];
    if (reopenedVector === undefined || reopenedVector.kind === 'line') {
      throw new Error('expected a rect vector after re-decoding');
    }
    expect(reopenedVector.fill).toEqual({ r: 0, g: 1, b: 0 });
    expect(reopenedVector.stroke).toEqual({ color: { r: 0, g: 0, b: 1 }, widthPt: 2 });
  });

  it('warns instead of mutating when the open document is the wrong format', () => {
    const editor = createOdg();
    const page = editor.addPage();
    const rect = page.addRect({ frame: { xPt: 10, yPt: 10, widthPt: 40, heightPt: 30 } });
    const state = appReducer(createInitialState(), { type: 'CREATE_DOCUMENT', format: 'docx' });

    const result = appReducer(state, { type: 'SET_VECTOR_FILL', vector: rect, fill: { r: 1, g: 1, b: 1 } });
    expect(result.status?.severity).toBe('warning');
    expect(result.hasUnsavedChanges).toBe(false);
  });
});

describe('appReducer diagnostics and selection', () => {
  it('appends, dismisses and clears diagnostics', () => {
    const withTwo = applyAll([
      { type: 'APPEND_DIAGNOSTIC', diagnostic: { severity: 'info', message: 'first' } },
      { type: 'APPEND_DIAGNOSTIC', diagnostic: { severity: 'warning', message: 'second', pageIndex: 1 } },
    ]);
    expect(withTwo.diagnostics).toHaveLength(2);

    const dismissed = appReducer(withTwo, { type: 'DISMISS_DIAGNOSTIC', index: 0 });
    expect(dismissed.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(['second']);
    expect(appReducer(dismissed, { type: 'CLEAR_DIAGNOSTICS' }).diagnostics).toEqual([]);
  });

  it('records a selection index per key', () => {
    const state = applyAll([
      { type: 'SET_SELECTION', key: 'bodyList', index: 4 },
      { type: 'SET_SELECTION', key: 'slideDetail:2', index: 1 },
    ]);
    expect(state.selection).toEqual({ bodyList: 4, 'slideDetail:2': 1 });
  });
});
