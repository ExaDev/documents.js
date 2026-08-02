import { Box, Text, useInput } from 'ink';
import { useEffect, useState, type ReactElement } from 'react';
import { rgbHexToColor } from 'documents.js';
import { TextField } from '../../../components/text-field.js';
import { useAppDispatch, useAppState } from '../../../state/context.js';
import { anyOverlayOpen, currentScreen, selectionKeyFor } from '../../../state/types.js';
import { isValidHexColorInput, layoutColorToHex } from '../../shared/color.js';
import { liveParagraphAt, paragraphFamilyDocument, type ParagraphFamilyLiveRun } from '../../shared/paragraph-family.js';

export interface ParagraphRunsViewProps {
  readonly runs: readonly ParagraphFamilyLiveRun[];
  readonly selectedRunIndex: number | undefined;
}

// Shared between this screen (full editing, a real cursor) and table-cell-detail.tsx (read-only display of a cell's own paragraphs, no cursor at all -- documents.js gives a table cell no per-run styling actions, see that screen's own comment) so the same real-styling render logic is never duplicated.
export function ParagraphRunsView(props: ParagraphRunsViewProps): ReactElement {
  if (props.runs.length === 0) {
    return <Text dimColor>(no runs -- press 'a' to append one)</Text>;
  }
  return (
    <Box>
      {props.runs.map((run, index) => (
        <Text key={index} bold={run.bold} italic={run.italic} underline={run.underline} color={run.color === undefined ? undefined : layoutColorToHex(run.color)} inverse={index === props.selectedRunIndex}>
          {run.text.length === 0 ? '<empty run>' : run.text}
        </Text>
      ))}
    </Box>
  );
}

export function ParagraphDetailScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [runIndex, setRunIndex] = useState(0);
  const [colorInput, setColorInput] = useState<string | undefined>(undefined);

  const screen = currentScreen(state);
  const doc = paragraphFamilyDocument(state.openDocument);
  const paragraph = screen.kind === 'paragraphDetail' && doc !== undefined ? liveParagraphAt(doc, screen.blockIndex) : undefined;
  const runs = paragraph === undefined ? [] : paragraph.runs();
  const clampedRunIndex = runs.length === 0 ? 0 : Math.min(runIndex, runs.length - 1);
  const selectedRun = runs[clampedRunIndex];
  const blockIndex = screen.kind === 'paragraphDetail' ? screen.blockIndex : -1;

  // A paragraph's runs are shown inline on one line and moved through with left/right, not up/down through a vertical list, so `useNavigationInput` (and this screen family's own `usePersistedSelection` wrapper around it, built for exactly that vertical case) does not fit here -- the cursor is plain local `useState` instead, and this effect is the direct equivalent of what that wrapper does: recording the cursor into `state.selection` under the same key `selectionKeyFor` would produce for this screen instance.
  useEffect(() => {
    if (screen.kind !== 'paragraphDetail') {
      return;
    }
    dispatch({ type: 'SET_SELECTION', key: selectionKeyFor(screen), index: clampedRunIndex });
  }, [screen, clampedRunIndex, dispatch]);

  useInput(
    (input, key) => {
      if (paragraph === undefined) {
        return;
      }
      if (key.leftArrow) {
        setRunIndex(Math.max(0, clampedRunIndex - 1));
        return;
      }
      if (key.rightArrow) {
        setRunIndex(runs.length === 0 ? 0 : Math.min(runs.length - 1, clampedRunIndex + 1));
        return;
      }
      if (key.escape) {
        dispatch({ type: 'POP_SCREEN' });
        return;
      }
      if (key.return) {
        if (selectedRun !== undefined) {
          dispatch({ type: 'PUSH_SCREEN', screen: { kind: 'runEditor', blockIndex, runIndex: clampedRunIndex } });
        }
        return;
      }
      if (input === 'a') {
        const newIndex = runs.length;
        dispatch({ type: 'APPEND_RUN', blockIndex, text: '' });
        setRunIndex(newIndex);
        dispatch({ type: 'PUSH_SCREEN', screen: { kind: 'runEditor', blockIndex, runIndex: newIndex } });
        return;
      }
      if (selectedRun === undefined) {
        return;
      }
      if (input === 'b') {
        dispatch({ type: 'TOGGLE_RUN_BOLD', blockIndex, runIndex: clampedRunIndex });
        return;
      }
      if (input === 'i') {
        dispatch({ type: 'TOGGLE_RUN_ITALIC', blockIndex, runIndex: clampedRunIndex });
        return;
      }
      if (input === 'u') {
        dispatch({ type: 'TOGGLE_RUN_UNDERLINE', blockIndex, runIndex: clampedRunIndex });
        return;
      }
      if (input === 'c') {
        setColorInput(selectedRun.color === undefined ? '' : layoutColorToHex(selectedRun.color).slice(1));
      }
    },
    { isActive: !anyOverlayOpen(state) && colorInput === undefined },
  );

  if (screen.kind !== 'paragraphDetail') {
    return <Text color="red">ParagraphDetailScreen rendered outside a paragraphDetail screen.</Text>;
  }
  if (doc === undefined) {
    return <Text color="red">ParagraphDetailScreen requires an open docx or odt document.</Text>;
  }
  if (paragraph === undefined) {
    return <Text color="red">There is no paragraph at index {screen.blockIndex}.</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text bold>
        Paragraph {screen.blockIndex}
        {paragraph.styleId === undefined ? '' : ` (${paragraph.styleId})`}
      </Text>
      <ParagraphRunsView runs={runs} selectedRunIndex={runs.length === 0 ? undefined : clampedRunIndex} />
      {colorInput === undefined ? undefined : (
        <Box>
          <Text color="cyan"># </Text>
          <TextField
            value={colorInput}
            isFocused
            placeholder="rrggbb"
            onChange={setColorInput}
            onSubmit={(value) => {
              if (isValidHexColorInput(value)) {
                dispatch({ type: 'SET_RUN_COLOR', blockIndex, runIndex: clampedRunIndex, color: rgbHexToColor(value.trim()) });
              } else {
                dispatch({ type: 'SET_STATUS', severity: 'warning', text: `"${value}" is not a 6-digit hex colour` });
              }
              setColorInput(undefined);
            }}
            onCancel={() => {
              setColorInput(undefined);
            }}
          />
        </Box>
      )}
      <Text dimColor>&lt;- / -&gt; move, Enter edit text, b/i/u toggle, c colour, a append run, Esc back</Text>
    </Box>
  );
}
