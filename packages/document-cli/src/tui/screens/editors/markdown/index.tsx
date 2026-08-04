import { Text } from 'ink';
import type { ReactElement } from 'react';
import { useAppDispatch, useAppState } from '../../../state/context.js';
import { createParagraphFamilyAdapter, ParagraphFamilyBodyList } from '../../shared/paragraph-family.js';

// The markdown-specific root of this screen family: the identical shared body list docx/odt already use, built straight from MarkdownEditor's own live-view accessors (`doc.editor.paragraphs()`/`.tables()`/`.body.appendParagraph()`/`.body.appendTable()`) -- see documents.js's own README, "src/edit/markdown/" architecture entry, and MarkdownOpenDocument's own doc comment (state/types.ts) for why this is a genuine live view despite there being no XmlElement tree underneath it. MarkdownBody has no `.lists()` accessor at all (a markdown list is flat per-paragraph metadata -- MarkdownParagraph.list -- matching docx's own model, not a separate container tree the way OdtList is), so this adapter omits `lists`, exactly like docx's own adapter does.
export function MarkdownBodyListScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = state.openDocument;

  if (doc?.format !== 'markdown') {
    return <Text color="red">MarkdownBodyListScreen requires an open markdown document, found {doc === undefined ? 'no open document' : doc.format}.</Text>;
  }

  const adapter = createParagraphFamilyAdapter({
    formatLabel: 'markdown',
    paragraphs: () => doc.editor.paragraphs(),
    tables: () => doc.editor.tables(),
    dispatch,
  });

  return <ParagraphFamilyBodyList adapter={adapter} />;
}

export { MarkdownViewSourceScreen } from './view-source.js';
// paragraphDetail/runEditor/tableView/tableCellDetail are format-agnostic (each narrows the open document to docx|odt|markdown itself via paragraph-family.ts's own `paragraphFamilyDocument`), so there is exactly one implementation of each, re-exported unchanged from screens/editors/docx/index.tsx for the router to find under this format's own module too -- the same convention screens/editors/odt/index.tsx already follows.
export { ParagraphDetailScreen, ParagraphRunsView, RunEditorScreen, RunTextEditor, TableCellDetailScreen, TableViewScreen } from '../docx/index.js';
