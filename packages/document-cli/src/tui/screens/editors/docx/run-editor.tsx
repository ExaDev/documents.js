import { Box, Text } from 'ink';
import { useState, type ReactElement } from 'react';
import { TextField } from '../../../components/text-field.js';
import { useAppDispatch, useAppState } from '../../../state/context.js';
import { currentScreen } from '../../../state/types.js';
import { liveParagraphAt, paragraphFamilyDocument } from '../../shared/paragraph-family.js';

export interface RunTextEditorProps {
  readonly initialText: string;
  readonly onCommit: (text: string) => void;
  readonly onCancel: () => void;
}

// The one piece of editing UI both the real run-editor screen below and table-cell-detail.tsx's own text edit reuse -- documents.js gives a table cell no per-run styling at all (see that screen's own comment), so both call sites reduce to the identical "edit one line of text, commit or cancel" shape, and this is that shape written once.
export function RunTextEditor(props: RunTextEditorProps): ReactElement {
  const [value, setValue] = useState(props.initialText);
  return (
    <Box>
      <Text color="cyan">&gt; </Text>
      <TextField value={value} isFocused placeholder="text" onChange={setValue} onSubmit={props.onCommit} onCancel={props.onCancel} />
    </Box>
  );
}

export function RunEditorScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const screen = currentScreen(state);
  const doc = paragraphFamilyDocument(state.openDocument);

  if (screen.kind !== 'runEditor') {
    return <Text color="red">RunEditorScreen rendered outside a runEditor screen.</Text>;
  }
  if (doc === undefined) {
    return <Text color="red">RunEditorScreen requires an open docx, odt or markdown document.</Text>;
  }
  const paragraph = liveParagraphAt(doc, screen.blockIndex);
  if (paragraph === undefined) {
    return <Text color="red">There is no paragraph at index {screen.blockIndex}.</Text>;
  }
  const run = paragraph.runs()[screen.runIndex];
  if (run === undefined) {
    return (
      <Text color="red">
        Paragraph {screen.blockIndex} has no run at index {screen.runIndex}.
      </Text>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>
        Edit run {screen.runIndex} of paragraph {screen.blockIndex}
      </Text>
      <RunTextEditor
        initialText={run.text}
        onCommit={(text) => {
          dispatch({ type: 'SET_RUN_TEXT', blockIndex: screen.blockIndex, runIndex: screen.runIndex, text });
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
