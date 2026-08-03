import { createOdp, createPptx, openOdp, openPptx, readOdpContent, readPptxContent } from 'documents.js';
import { describe, expect, it } from 'vitest';
import type { Action } from './actions.js';
import { appReducer, createInitialState } from './reducer.js';
import type { AppState, DocxOpenDocument, MarkdownOpenDocument, OdpOpenDocument, OdsOpenDocument, PptxOpenDocument } from './types.js';

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

function openPptxDocument(bytes: Uint8Array<ArrayBuffer>, path = '/tmp/deck.pptx'): AppState {
  return appReducer(createInitialState(), { type: 'OPEN_FILE_SUCCESS', path, doc: { format: 'pptx', editor: openPptx(bytes), path } });
}

function openOdpDocument(bytes: Uint8Array<ArrayBuffer>, path = '/tmp/deck.odp'): AppState {
  return appReducer(createInitialState(), { type: 'OPEN_FILE_SUCCESS', path, doc: { format: 'odp', editor: openOdp(bytes), path } });
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
