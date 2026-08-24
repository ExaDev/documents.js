import { Box, Text, useWindowSize } from "ink";
import type { ReactElement } from "react";

// Rows the surrounding chrome occupies when a screen renders a ListView: its own title line, the status line at the bottom, a blank separator between them, and one row of slack so the selected row is never flush against the terminal's bottom edge. A screen that renders more chrome than that passes its own `reservedRows`.
const DEFAULT_RESERVED_ROWS = 4;

export interface ListViewProps<T> {
  readonly items: readonly T[];
  readonly selectedIndex: number;
  readonly renderItem: (item: T, isSelected: boolean) => ReactElement;
  readonly emptyMessage?: string;
  readonly reservedRows?: number;
}

export function ListView<T>(props: ListViewProps<T>): ReactElement {
  const { rows } = useWindowSize();
  const reserved = props.reservedRows ?? DEFAULT_RESERVED_ROWS;
  const viewportRows = Math.max(1, rows - reserved);
  const maxStart = Math.max(0, props.items.length - viewportRows);
  // Keep the selected row roughly centred, then clamp so the window never runs past either end of the list.
  const start = Math.min(
    Math.max(props.selectedIndex - Math.floor(viewportRows / 2), 0),
    maxStart,
  );
  const visible = props.items.slice(start, start + viewportRows);

  if (props.items.length === 0) {
    return (
      <Box flexDirection="column">
        {props.emptyMessage === undefined ? undefined : (
          <Text dimColor>{props.emptyMessage}</Text>
        )}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {visible.map((item, offset) => {
        const index = start + offset;
        return (
          <Box key={index}>
            {props.renderItem(item, index === props.selectedIndex)}
          </Box>
        );
      })}
    </Box>
  );
}
