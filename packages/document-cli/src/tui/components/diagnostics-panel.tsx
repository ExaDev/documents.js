import { Box, Text } from "ink";
import type { ReactElement } from "react";
import { useNavigationInput } from "../keybindings/use-navigation-input.js";
import { useAppDispatch, useAppState } from "../state/context.js";
import type { Diagnostic } from "../state/types.js";
import { ListView } from "./list-view.js";

// The panel's own chrome: a title line, a footer hint line, the box border's two rows, and the status line underneath it.
const PANEL_RESERVED_ROWS = 7;

function describe(diagnostic: Diagnostic): string {
  const page =
    diagnostic.pageIndex === undefined
      ? ""
      : ` (page ${diagnostic.pageIndex + 1})`;
  return `${diagnostic.severity}${page}: ${diagnostic.message}`;
}

export function DiagnosticsPanel(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();

  const { selectedIndex } = useNavigationInput({
    itemCount: state.diagnostics.length,
    onSelect: (index) => {
      dispatch({ type: "DISMISS_DIAGNOSTIC", index });
    },
    onBack: () => {
      dispatch({ type: "CLOSE_OVERLAY", overlay: "diagnosticsPanel" });
    },
    isActive: true,
  });

  return (
    <Box borderStyle="round" flexDirection="column" paddingX={1}>
      <Text bold>Diagnostics ({state.diagnostics.length})</Text>
      <ListView
        items={state.diagnostics}
        selectedIndex={selectedIndex}
        emptyMessage="No diagnostics have been reported."
        reservedRows={PANEL_RESERVED_ROWS}
        renderItem={(diagnostic, isSelected) => (
          <Text color={isSelected ? "cyan" : undefined} inverse={isSelected}>
            {describe(diagnostic)}
          </Text>
        )}
      />
      <Text dimColor>Enter to dismiss the selected entry, Esc to close</Text>
    </Box>
  );
}
