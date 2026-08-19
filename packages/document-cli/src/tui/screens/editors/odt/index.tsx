import { Text } from 'ink';
import type { ReactElement } from 'react';
import { useAppDispatch, useAppState } from '../../../state/context.js';
import { createParagraphFamilyAdapter, ParagraphFamilyBodyList, type ParagraphFamilyList } from '../../shared/paragraph-family.js';

// The odt-specific root of this screen family: same shared body list as docx's, but its adapter additionally supplies `lists`, since `OdtEditor` (unlike `DocxEditor`) keeps lists as a genuinely separate tree reached through its own `.lists()` accessor rather than flat per-paragraph metadata. `ParagraphFamilyList` (this file's own shared adapter shape) only carries an item count, not each item's text -- list-editor.tsx reads each item's real `.text` directly once a list is opened, rather than through this summary-row adapter.
export function OdtBodyListScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = state.openDocument;

  if (doc?.format !== 'odt') {
    return <Text color="red">OdtBodyListScreen requires an open odt document, found {doc === undefined ? 'no open document' : doc.format}.</Text>;
  }

  const adapter = createParagraphFamilyAdapter({
    formatLabel: 'odt',
    paragraphs: () => doc.editor.paragraphs(),
    tables: () => doc.editor.tables(),
    lists: (): readonly ParagraphFamilyList[] => doc.editor.lists().map((list) => ({ itemCount: list.items().length })),
    dispatch,
  });

  return <ParagraphFamilyBodyList adapter={adapter} />;
}

export { ListEditorScreen } from './list-editor.js';
// paragraphDetail/runEditor/tableView/tableCellDetail are format-agnostic and already live under screens/editors/docx -- re-exported here unchanged (not reimplemented) so the router has one consistent module per format to import every screen kind from.
export { ParagraphDetailScreen, ParagraphRunsView, RunEditorScreen, RunTextEditor, TableCellDetailScreen, TableViewScreen } from '../docx/index.js';
