import { Box, Text } from 'ink';
import type { ReactElement } from 'react';
import { ListView } from '../../../components/list-view.js';
import { useNavigationInput } from '../../../keybindings/use-navigation-input.js';
import { useAppDispatch, useAppState } from '../../../state/context.js';
import { anyOverlayOpen } from '../../../state/types.js';
import { requireOdbDocument } from './shared.js';

// The root screen of every open `.odb` document (see `rootScreenForFormat`): one row per table, each showing its own shape at a glance so a wide database is easy to scan before drilling into any one table's rows.
export function OdbTableListScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = requireOdbDocument(state.openDocument);

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
    isActive: !anyOverlayOpen(state),
  });

  return (
    <Box flexDirection="column">
      <Text bold>
        Tables ({tables.length} of {doc.tables.length})
      </Text>
      <ListView
        items={tables}
        selectedIndex={selectedIndex}
        emptyMessage={query === '' ? 'This database has no tables.' : `No tables match "${state.searchQuery}".`}
        renderItem={(table, isSelected) => (
          <Text color={isSelected ? 'cyan' : undefined} inverse={isSelected}>
            {table.tableName} ({table.columns.length} columns, {table.rows.length} rows)
          </Text>
        )}
      />
    </Box>
  );
}
