import { Box, Text } from 'ink';
import type { ReactElement } from 'react';
import { useAppDispatch, useAppState } from '../../../state/context.js';
import { currentScreen } from '../../../state/types.js';
import { RunTextEditor } from '../docx/run-editor.js';

// Edits one line of a markdown document's raw source, reached by pushing a 'markdownLineEditor' screen from the line list. Committing rejoins the full line array with '\n' and dispatches SET_MARKDOWN_SOURCE with the whole rejoined string -- there is no per-line action, since the reducer's own mutateMarkdown helper (see reducer.ts) treats the document as a single string value, not a mutable structure a single line could be addressed and patched within.
export function MarkdownLineEditorScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const screen = currentScreen(state);
  const doc = state.openDocument;

  if (screen.kind !== 'markdownLineEditor') {
    return <Text color="red">MarkdownLineEditorScreen rendered outside a markdownLineEditor screen.</Text>;
  }
  if (doc?.format !== 'markdown') {
    return <Text color="red">MarkdownLineEditorScreen requires an open markdown document.</Text>;
  }

  const lines = doc.source.split('\n');
  const line = lines[screen.lineIndex];
  if (line === undefined) {
    return <Text color="red">There is no line at index {screen.lineIndex}.</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text bold>Edit line {screen.lineIndex + 1}</Text>
      <RunTextEditor
        initialText={line}
        onCommit={(text) => {
          const nextLines = [...lines];
          nextLines[screen.lineIndex] = text;
          dispatch({ type: 'SET_MARKDOWN_SOURCE', source: nextLines.join('\n') });
          dispatch({ type: 'POP_SCREEN' });
        }}
        onCancel={() => {
          dispatch({ type: 'POP_SCREEN' });
        }}
      />
      <Text dimColor>Enter to commit, Esc to discard</Text>
    </Box>
  );
}
