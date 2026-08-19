import { hsqldbCellDisplayText, type ContentCellValue, type HsqldbTable } from 'documents.js';
import { Box, Text } from 'ink';
import type { ReactElement } from 'react';
import { ListView } from '../../../components/list-view.js';
import { useNavigationInput } from '../../../keybindings/use-navigation-input.js';
import { useAppDispatch, useAppState } from '../../../state/context.js';
import { anyOverlayOpen, currentScreen } from '../../../state/types.js';
import { requireOdbDocument } from './shared.js';

// The title line, the column-header line beneath it, and the status line at the bottom -- one more row of chrome than ListView's own default reserves for a plain single-line title.
const TABLE_ROWS_RESERVED_ROWS = 5;
const CELL_SEPARATOR = '  │  ';

function requireTable(tables: readonly HsqldbTable[], tableName: string): HsqldbTable {
  const table = tables.find((candidate) => candidate.tableName === tableName);
  if (table === undefined) {
    throw new Error(`odbTableRows was pushed for table "${tableName}", but the open .odb document has no table by that name.`);
  }
  return table;
}

function rowText(row: readonly ContentCellValue[]): string {
  return row.map((cell) => hsqldbCellDisplayText(cell)).join(CELL_SEPARATOR);
}

// The table's own `rows` array is already fully materialised in memory by `readOdbTables` -- paging here is a pure viewport/rendering concern handled by `useNavigationInput`'s PageUp/PageDown handling together with `ListView`'s own scroll-to-selection window, not a fetch-more-rows concern.
export function OdbTableRowsScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = requireOdbDocument(state.openDocument);
  const screen = currentScreen(state);
  if (screen.kind !== 'odbTableRows') {
    throw new Error(`OdbTableRowsScreen rendered while the current screen is "${screen.kind}", not "odbTableRows".`);
  }
  const table = requireTable(doc.tables, screen.tableName);

  const query = state.searchQuery.trim().toLowerCase();
  const rows = query === '' ? table.rows : table.rows.filter((row) => rowText(row).toLowerCase().includes(query));

  const { selectedIndex } = useNavigationInput({
    itemCount: rows.length,
    onSelect: () => {
      // A row has no further detail screen in this read-only browsing group -- every cell is already fully rendered inline, so there is nothing left to drill into.
    },
    onBack: () => {
      dispatch({ type: 'POP_SCREEN' });
    },
    isActive: !anyOverlayOpen(state),
  });

  const headerLine = table.columns.map((column) => `${column.name} (${column.type})`).join(CELL_SEPARATOR);

  return (
    <Box flexDirection="column">
      <Text bold>
        {table.tableName} ({rows.length} of {table.rows.length} rows)
      </Text>
      <Text dimColor>{headerLine}</Text>
      <ListView
        items={rows}
        selectedIndex={selectedIndex}
        reservedRows={TABLE_ROWS_RESERVED_ROWS}
        emptyMessage={query === '' ? 'This table has no rows.' : `No rows match "${state.searchQuery}".`}
        renderItem={(row, isSelected) => (
          <Text color={isSelected ? 'cyan' : undefined} inverse={isSelected}>
            {rowText(row)}
          </Text>
        )}
      />
    </Box>
  );
}
