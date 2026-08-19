import { Box, Text } from 'ink';
import { useState, type ReactElement } from 'react';
import { ListView } from '../../../components/list-view.js';
import { TextField } from '../../../components/text-field.js';
import { useNavigationInput } from '../../../keybindings/use-navigation-input.js';
import { useAppDispatch, useAppState } from '../../../state/context.js';
import { anyOverlayOpen } from '../../../state/types.js';
import { odsDocument } from './shared.js';

interface SheetRow {
  readonly index: number;
  readonly name: string;
}

export function OdsSheetListScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = odsDocument(state);

  // undefined means "not naming a new sheet"; a string (including '') is the draft name buffer while the add-sheet prompt is open.
  const [draftName, setDraftName] = useState<string | undefined>(undefined);
  const isAdding = draftName !== undefined;
  const isActive = !anyOverlayOpen(state) && !isAdding;

  // Sheet names alone are cheap to read straight off the live editor -- `OdsSheet.name` is a plain getter, so there is no need to walk `readOdsContent` (which shared.ts's `resolveSheet` reserves for the sparse-cell-extent problem the grid actually has) just to list them.
  const query = state.searchQuery.trim().toLowerCase();
  const rows: readonly SheetRow[] = doc.editor
    .sheets()
    .map((sheet, index): SheetRow => ({ index, name: sheet.name }))
    .filter((row) => query.length === 0 || row.name.toLowerCase().includes(query));

  const commitAdd = (name: string): void => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      dispatch({ type: 'SET_STATUS', severity: 'warning', text: 'A sheet needs a name' });
      return;
    }
    dispatch({ type: 'ADD_SHEET', name: trimmed });
    setDraftName(undefined);
  };

  const { selectedIndex } = useNavigationInput({
    itemCount: rows.length,
    onSelect: (index) => {
      const row = rows[index];
      if (row === undefined) {
        return;
      }
      dispatch({ type: 'PUSH_SCREEN', screen: { kind: 'spreadsheetGrid', sheetIndex: row.index } });
    },
    onBack: () => {
      dispatch({ type: 'POP_SCREEN' });
    },
    onAppend: () => {
      setDraftName('');
    },
    isActive,
  });

  return (
    <Box flexDirection="column">
      <Text bold>Sheets ({rows.length})</Text>
      <ListView
        items={rows}
        selectedIndex={selectedIndex}
        emptyMessage="This workbook has no sheets yet -- press 'a' to add one."
        renderItem={(row, isSelected) => (
          <Text color={isSelected ? 'cyan' : undefined} inverse={isSelected}>
            {row.name}
          </Text>
        )}
      />
      {draftName === undefined ? (
        <Text dimColor>Enter to open, a to add a sheet, Esc to go back</Text>
      ) : (
        <Box>
          <Text color="cyan">New sheet name: </Text>
          <TextField
            value={draftName}
            isFocused={!anyOverlayOpen(state)}
            placeholder="Sheet name"
            onChange={setDraftName}
            onSubmit={commitAdd}
            onCancel={() => {
              setDraftName(undefined);
            }}
          />
        </Box>
      )}
    </Box>
  );
}
