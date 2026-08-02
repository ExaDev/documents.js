import { describeError } from '../errors.js';
import { saveDocumentTo } from '../format/open-document.js';
import type { Action } from './actions.js';
import type { OpenDocument } from './types.js';

// Writing bytes is asynchronous and the reducer is synchronous, so saving happens here and its outcome arrives back as the action to dispatch. Shared by the Ctrl+S handler in the app shell and by the palette's `:save`/`:saveas`, so the two can never disagree about what a failed save reports.
export async function saveOpenDocumentAction(document: OpenDocument, path: string): Promise<Action> {
  try {
    await saveDocumentTo(document, path);
    return { type: 'SAVE_SUCCESS', path };
  } catch (error) {
    return { type: 'SAVE_ERROR', message: `Could not save ${path}: ${describeError(error)}` };
  }
}
