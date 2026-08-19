import { Box, Text } from 'ink';
import type { ReactElement } from 'react';
import { describeOdbForm } from '../../../../odb-structure.js';
import { ListView } from '../../../components/list-view.js';
import { useNavigationInput } from '../../../keybindings/use-navigation-input.js';
import { useAppDispatch, useAppState } from '../../../state/context.js';
import { anyOverlayOpen } from '../../../state/types.js';
import { requireOdbDocument } from './shared.js';

// One row per form the database declares, reached from the table list with `f`. A form is a static ODF sub-document rather than database content, so this list is populated whether or not the `.odb` has an embedded engine at all -- see format/open-document.ts.
export function OdbFormListScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = requireOdbDocument(state.openDocument);

  const query = state.searchQuery.trim().toLowerCase();
  const forms = query === '' ? doc.forms : doc.forms.filter((form) => form.name.toLowerCase().includes(query));

  const { selectedIndex } = useNavigationInput({
    itemCount: forms.length,
    onSelect: (index) => {
      const form = forms[index];
      if (form === undefined) {
        return;
      }
      dispatch({ type: 'PUSH_SCREEN', screen: { kind: 'odbFormDetail', formName: form.name } });
    },
    onBack: () => {
      dispatch({ type: 'POP_SCREEN' });
    },
    isActive: !anyOverlayOpen(state),
  });

  return (
    <Box flexDirection="column">
      <Text bold>
        Forms ({forms.length} of {doc.forms.length})
      </Text>
      <ListView
        items={forms}
        selectedIndex={selectedIndex}
        emptyMessage={query === '' ? 'This database declares no forms.' : `No forms match "${state.searchQuery}".`}
        renderItem={(form, isSelected) => (
          <Text color={isSelected ? 'cyan' : undefined} inverse={isSelected}>
            {describeOdbForm(form)}
          </Text>
        )}
      />
      <Text dimColor>Enter to open a form, Esc to go back to the tables</Text>
    </Box>
  );
}
