import { describe, expect, it } from 'vitest';
import type { Action } from './actions.js';
import { appReducer, createInitialState } from './reducer.js';
import type { AppState, DocxOpenDocument, OdsOpenDocument } from './types.js';

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

describe('appReducer undo', () => {
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
