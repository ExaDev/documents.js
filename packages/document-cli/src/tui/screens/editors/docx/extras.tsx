import { readDocxExtras } from 'documents.js';
import { Box, Text } from 'ink';
import type { ReactElement } from 'react';
import { formatDocxExtrasLines } from '../../../../docx-extras-format.js';
import { ListView } from '../../../components/list-view.js';
import { useNavigationInput } from '../../../keybindings/use-navigation-input.js';
import { useAppDispatch, useAppState } from '../../../state/context.js';
import { anyOverlayOpen } from '../../../state/types.js';

// The title line, the hint line beneath the list, and the status line at the bottom -- one more row of chrome than ListView's own default reserves, matching odb/form-detail.tsx's own reasoning for the identical read-only-flat-lines shape.
const DOCX_EXTRAS_RESERVED_ROWS = 5;

// A docx's own comments, footnotes, headers, footers, and numbering definitions -- data `ContentDocument`'s section/block shape has nowhere to carry, so `readDocxExtras` (documents.js) is a second, independent read of the same package, reached here with 'x' from `DocxBodyListScreen`. Whole-document, no params: unlike `paragraphDetail`/`tableView` there is no per-item drill-down, everything renders as one flat, searchable line list, exactly like `odb/form-detail.tsx`'s own control tree.
//
// `readDocxExtras(doc.editor.toPackage())` is called fresh on every render, never cached in state/useMemo -- the RULE at the top of state/types.ts: `DocxEditor`'s own live-view accessors (and everything built from `toPackage()`) can be silently invalidated by a mutation from any other screen, so caching this across renders risks showing stale comments/footnotes after an edit made elsewhere in the same session.
export function DocxExtrasScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = state.openDocument;
  const isDocx = doc?.format === 'docx';

  // Computed unconditionally, ahead of the `useNavigationInput` hook below, so every hook in this component runs on every render regardless of `doc`'s format -- an early return before a hook call would violate React's own rules-of-hooks the moment this screen is ever reached with a non-docx document open.
  const extras = doc?.format === 'docx' ? readDocxExtras(doc.editor.toPackage()) : undefined;
  const allLines = extras === undefined ? [] : formatDocxExtrasLines(extras);
  const query = state.searchQuery.trim().toLowerCase();
  const lines = query === '' ? allLines : allLines.filter((line) => line.toLowerCase().includes(query));

  const { selectedIndex } = useNavigationInput({
    itemCount: lines.length,
    onSelect: () => {
      // Nothing to open: every line is already fully rendered inline, exactly as odb/form-detail.tsx's own control-tree rows are.
    },
    onBack: () => {
      dispatch({ type: 'POP_SCREEN' });
    },
    isActive: isDocx && !anyOverlayOpen(state),
  });

  if (!isDocx) {
    return <Text color="red">DocxExtrasScreen requires an open docx document, found {doc === undefined ? 'no open document' : doc.format}.</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text bold>
        Comments, footnotes, headers, footers, numbering ({lines.length} of {allLines.length} lines)
      </Text>
      <ListView
        items={lines}
        selectedIndex={selectedIndex}
        reservedRows={DOCX_EXTRAS_RESERVED_ROWS}
        emptyMessage={query === '' ? 'This document carries no comments, footnotes, headers, footers, or numbering definitions.' : `No lines match "${state.searchQuery}".`}
        renderItem={(line, isSelected) => (
          <Text color={isSelected ? 'cyan' : undefined} inverse={isSelected}>
            {line}
          </Text>
        )}
      />
      <Text dimColor>Esc to go back to the body list</Text>
    </Box>
  );
}
