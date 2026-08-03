import { Box, Text, useInput } from 'ink';
import type { ReactElement } from 'react';
import { ListView } from '../../../components/list-view.js';
import { useNavigationInput } from '../../../keybindings/use-navigation-input.js';
import { useAppDispatch, useAppState } from '../../../state/context.js';
import { anyOverlayOpen } from '../../../state/types.js';
import { requireOdbDocument } from './shared.js';

// The title line, the hint line beneath the list, and the status line at the bottom -- one more row of chrome than ListView's own default reserves for a plain title-plus-status screen.
const TABLE_LIST_RESERVED_ROWS = 5;

// The root screen of every open `.odb` document (see `rootScreenForFormat`): one row per table, each showing its own shape at a glance so a wide database is easy to scan before drilling into any one table's rows. It is also the only way into the form and report browsers, via `f` and `r` -- a `.odb`'s tables, forms, and reports are three independent collections read from one package, and this screen is the one place all three are reachable from.
export function OdbTableListScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = requireOdbDocument(state.openDocument);
  const overlayOpen = anyOverlayOpen(state);

  const query = state.searchQuery.trim().toLowerCase();
  const tables = query === '' ? doc.tables : doc.tables.filter((table) => table.tableName.toLowerCase().includes(query));

  const { selectedIndex } = useNavigationInput({
    itemCount: tables.length,
    onSelect: (index) => {
      const table = tables[index];
      if (table === undefined) {
        return;
      }
      dispatch({ type: 'PUSH_SCREEN', screen: { kind: 'odbTableRows', tableName: table.tableName } });
    },
    onBack: () => {
      dispatch({ type: 'POP_SCREEN' });
    },
    isActive: !overlayOpen,
  });

  // A second `useInput` alongside the navigation hook rather than an extension of it: `f`/`r` are this screen's own bindings, not list navigation, and `useNavigationInput` deliberately owns only the shared movement/select/back keys (the same split ods/spreadsheet-grid.tsx already uses for its own `t`/`p`).
  useInput(
    (input) => {
      if (input === 'f') {
        dispatch({ type: 'PUSH_SCREEN', screen: { kind: 'odbFormList' } });
        return;
      }
      if (input === 'r') {
        dispatch({ type: 'PUSH_SCREEN', screen: { kind: 'odbReportList' } });
      }
    },
    { isActive: !overlayOpen },
  );

  return (
    <Box flexDirection="column">
      <Text bold>
        Tables ({tables.length} of {doc.tables.length})
      </Text>
      <ListView
        items={tables}
        selectedIndex={selectedIndex}
        reservedRows={TABLE_LIST_RESERVED_ROWS}
        emptyMessage={query === '' ? 'This database has no tables.' : `No tables match "${state.searchQuery}".`}
        renderItem={(table, isSelected) => (
          <Text color={isSelected ? 'cyan' : undefined} inverse={isSelected}>
            {table.tableName} ({table.columns.length} columns, {table.rows.length} rows)
          </Text>
        )}
      />
      <Text dimColor>
        Enter to open a table, f for forms ({doc.forms.length}), r for reports ({doc.reports.length})
      </Text>
    </Box>
  );
}
