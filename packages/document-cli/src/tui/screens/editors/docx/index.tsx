import { Text } from 'ink';
import type { ReactElement } from 'react';
import { useAppDispatch, useAppState } from '../../../state/context.js';
import { createParagraphFamilyAdapter, ParagraphFamilyBodyList } from '../../shared/paragraph-family.js';

// The docx-specific root of this screen family: constructs a fresh, unwrapped adapter straight from `DocxEditor.paragraphs()`/`.tables()` on every render (never cached -- see the live-view rule in state/types.ts) and hands it to the shared body list. docx has no `.lists()` accessor at all (a docx paragraph's own list membership is flat metadata, not a separate container), so its adapter simply omits `lists`.
export function DocxBodyListScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = state.openDocument;

  if (doc?.format !== 'docx') {
    return <Text color="red">DocxBodyListScreen requires an open docx document, found {doc === undefined ? 'no open document' : doc.format}.</Text>;
  }

  const adapter = createParagraphFamilyAdapter({
    formatLabel: 'docx',
    paragraphs: () => doc.editor.paragraphs(),
    tables: () => doc.editor.tables(),
    dispatch,
  });

  return <ParagraphFamilyBodyList adapter={adapter} />;
}

// paragraphDetail/runEditor/tableView/tableCellDetail are format-agnostic (each narrows the open document to docx|odt itself via paragraph-family.ts's own `paragraphFamilyDocument`), so there is exactly one implementation of each, re-exported unchanged from screens/editors/odt/index.tsx for the router to find under either format's own module.
export { ParagraphDetailScreen, ParagraphRunsView } from './paragraph-detail.js';
export { RunEditorScreen, RunTextEditor } from './run-editor.js';
export { TableViewScreen } from './table-view.js';
export { TableCellDetailScreen } from './table-cell-detail.js';
