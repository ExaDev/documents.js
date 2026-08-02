import { Box, Text } from 'ink';
import type { ReactElement } from 'react';
import { ListView } from '../../../components/list-view.js';
import { useNavigationInput } from '../../../keybindings/use-navigation-input.js';
import { useAppDispatch, useAppState } from '../../../state/context.js';
import { anyOverlayOpen } from '../../../state/types.js';
import { requireMarkdownDocument } from './shared.js';

interface IndexedLine {
  readonly line: string;
  readonly lineIndex: number;
}

// The root screen of every open markdown document (see `rootScreenForFormat`): one row per line of the raw source, split fresh on every render from `doc.source` -- there is no live editor object to read lines from the way every other format's screen reads `editor.paragraphs()`/`editor.slides()`, since a markdown document IS its own source string. {line, lineIndex} pairs are built BEFORE filtering by the search query (mirroring PdfPageListScreen's own IndexedPage pattern) so a filtered row's Enter still opens the true line index in the underlying source, not its position in the filtered list.
export function MarkdownLineListScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = requireMarkdownDocument(state.openDocument);

  const query = state.searchQuery.trim().toLowerCase();
  const allLines: readonly IndexedLine[] = doc.source.split('\n').map((line, lineIndex) => ({ line, lineIndex }));
  const lines = query === '' ? allLines : allLines.filter((entry) => entry.line.toLowerCase().includes(query));

  const { selectedIndex } = useNavigationInput({
    itemCount: lines.length,
    onSelect: (index) => {
      const entry = lines[index];
      if (entry === undefined) {
        return;
      }
      dispatch({ type: 'PUSH_SCREEN', screen: { kind: 'markdownLineEditor', lineIndex: entry.lineIndex } });
    },
    onBack: () => {
      dispatch({ type: 'POP_SCREEN' });
    },
    isActive: !anyOverlayOpen(state),
  });

  return (
    <Box flexDirection="column">
      <Text bold>
        Lines ({lines.length} of {allLines.length})
      </Text>
      <ListView
        items={lines}
        selectedIndex={selectedIndex}
        emptyMessage={query === '' ? 'This document has no lines.' : `No lines match "${state.searchQuery}".`}
        renderItem={({ line, lineIndex }, isSelected) => (
          <Text color={isSelected ? 'cyan' : undefined} inverse={isSelected}>
            {lineIndex + 1}: {line === '' ? '(blank)' : line}
          </Text>
        )}
      />
    </Box>
  );
}
