import type { ContentCellValue } from "documents.js";
import { Box, Text, useInput } from "ink";
import { useState, type ReactElement } from "react";
import { TextField } from "../../../components/text-field.js";
import { useAppDispatch } from "../../../state/context.js";
import { buildCellValue, CELL_VALUE_KINDS, KIND_BADGE } from "./shared.js";

export interface CellEditorProps {
  readonly address: string;
  readonly initialText: string;
  readonly initialKind: ContentCellValue["kind"];
  // Gates this editor's own key handling exactly the way every routed screen gates its own `useNavigationInput`/`useInput` against `!anyOverlayOpen(state)` -- `OdsCellEditor` stays mounted underneath a global overlay (the command palette, search, help) rather than unmounting, so it must stop reacting to keys itself while one is open.
  readonly isActive: boolean;
  readonly onCommit: (value: ContentCellValue) => void;
  readonly onCancel: () => void;
}

function cycleKind(
  kind: ContentCellValue["kind"],
  direction: 1 | -1,
): ContentCellValue["kind"] {
  const index = CELL_VALUE_KINDS.indexOf(kind);
  // A kind outside the cyclable list (only 'empty' -- see CELL_VALUE_KINDS's own comment in shared.ts) starts the cycle from its first entry rather than failing.
  const from = index === -1 ? 0 : index;
  const next =
    (from + direction + CELL_VALUE_KINDS.length) % CELL_VALUE_KINDS.length;
  const kindAt = CELL_VALUE_KINDS[next];
  if (kindAt === undefined) {
    throw new Error(
      "cycleKind computed an index outside CELL_VALUE_KINDS, which the modulo above makes impossible.",
    );
  }
  return kindAt;
}

// This is spreadsheet-grid.tsx's own inline cell-editing sub-mode -- entered from the grid's own local `editing` state, mirroring how file-picker.tsx's `mode: 'browse' | 'enterName'` opens an inline TextField rather than pushing a whole new Screen. It is deliberately not the reserved `cellDetail` Screen kind: nothing about a single cell's value needs its own place in the navigation stack or its own back-button history, and staying inline is what lets the grid seed the very first keystroke straight into this editor's own starting text (a pushed screen's params carry only plain data, with no way to also carry "and open already mid-keystroke").
//
// Kind inference (leading digit -> number, TRUE/FALSE -> boolean, else string) runs exactly once, at the moment editing begins, in `shared.ts`'s `inferKind` -- the caller passes the result in as `initialKind`. It deliberately does not keep re-inferring on every keystroke after that: re-classifying a cell's kind out from under a user who is still typing (turning it from 'string' to 'number' and back as they add and remove characters) would make the badge and the eventual commit target unpredictable. The explicit override below is the only way the kind changes after editing starts.
//
// Tab / Shift+Tab cycle the kind override, not the brief's own suggested "Ctrl+1..6": verified directly against ink-text-input's own source (node_modules/ink-text-input/build/index.js), which explicitly ignores `key.tab` and `key.shift && key.tab`, so both are free for this component to claim with no risk of the text field itself swallowing or acting on them. Ctrl+<digit> has no such guarantee -- most terminals send no distinguishable sequence at all for Ctrl+1, Ctrl+9 or Ctrl+0 (there is no C0 control code for them), and Ctrl+3/Ctrl+8 collide with the real Escape/Backspace codes on the ones that do. A direct-selection hotkey scheme built on that would silently fail, or misfire as Escape/Backspace, depending on the terminal.
export function OdsCellEditor(props: CellEditorProps): ReactElement {
  const dispatch = useAppDispatch();
  const [text, setText] = useState(props.initialText);
  const [kind, setKind] = useState<ContentCellValue["kind"]>(props.initialKind);

  useInput(
    (_input, key) => {
      if (key.tab && key.shift) {
        setKind((current) => cycleKind(current, -1));
        return;
      }
      if (key.tab) {
        setKind((current) => cycleKind(current, 1));
      }
    },
    { isActive: props.isActive },
  );

  const preview = buildCellValue(kind, text);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="cyan">{props.address} </Text>
        <Text color="yellow">[{KIND_BADGE[kind]}] </Text>
        <TextField
          value={text}
          isFocused={props.isActive}
          onChange={setText}
          onSubmit={() => {
            if (preview === undefined) {
              dispatch({
                type: "SET_STATUS",
                severity: "warning",
                text: `"${text}" is not a valid ${kind} value -- Tab to change kind`,
              });
              return;
            }
            props.onCommit(preview);
          }}
          onCancel={props.onCancel}
        />
      </Box>
      {preview === undefined ? (
        <Text color="red">Not a valid {kind} value</Text>
      ) : undefined}
      <Text dimColor>
        Enter to commit, Tab / Shift+Tab to change kind, Esc to cancel
      </Text>
    </Box>
  );
}
