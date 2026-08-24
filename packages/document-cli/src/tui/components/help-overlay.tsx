import { Box, Text, useInput } from "ink";
import type { ReactElement } from "react";
import { GLOBAL_KEYS } from "../keybindings/global-keys.js";
import { useAppDispatch } from "../state/context.js";

const KEY_COLUMN_WIDTH = 18;

export function HelpOverlay(): ReactElement {
  const dispatch = useAppDispatch();

  useInput((input, key) => {
    if (key.escape || input === "?" || key.return) {
      dispatch({ type: "CLOSE_OVERLAY", overlay: "help" });
    }
  });

  return (
    <Box borderStyle="round" flexDirection="column" paddingX={1}>
      <Text bold>Key bindings</Text>
      {GLOBAL_KEYS.map((binding) => (
        <Box key={binding.keys}>
          <Box width={KEY_COLUMN_WIDTH}>
            <Text color="cyan">{binding.keys}</Text>
          </Box>
          <Text>{binding.description}</Text>
        </Box>
      ))}
      <Text dimColor>Esc to close</Text>
    </Box>
  );
}
