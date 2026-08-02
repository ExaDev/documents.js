import { Box, Text } from 'ink';
import type { ReactElement } from 'react';
import { formatToExtension } from '../../format.js';
import { ListView } from '../components/list-view.js';
import { useNavigationInput } from '../keybindings/use-navigation-input.js';
import { useAppDispatch, useAppState } from '../state/context.js';
import { anyOverlayOpen, type EditableFormat } from '../state/types.js';

interface CreatableFormat {
  readonly format: EditableFormat;
  readonly description: string;
}

// The six formats documents.js exposes a create<X>() live-view editor for. `.odb` and `.pdf` are deliberately excluded rather than listed and then disabled: `.odb` has no write direction at all (it only extracts an embedded database's tables) and a `.pdf` is opened as a parsed LayoutDocument, never as something this app creates from nothing.
const CREATABLE_FORMATS: readonly CreatableFormat[] = [
  { format: 'docx', description: 'Word-processing document (OOXML)' },
  { format: 'pptx', description: 'Presentation slide deck (OOXML)' },
  { format: 'odt', description: 'Word-processing document (OpenDocument)' },
  { format: 'odp', description: 'Presentation slide deck (OpenDocument)' },
  { format: 'ods', description: 'Spreadsheet workbook (OpenDocument)' },
  { format: 'odg', description: 'Vector drawing (OpenDocument)' },
];

const EXTENSION_COLUMN_WIDTH = 8;

export function NewDocumentPickerScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const isActive = !anyOverlayOpen(state);

  const { selectedIndex } = useNavigationInput({
    itemCount: CREATABLE_FORMATS.length,
    onSelect: (index) => {
      const entry = CREATABLE_FORMATS[index];
      if (entry === undefined) {
        return;
      }
      dispatch({ type: 'CREATE_DOCUMENT', format: entry.format });
    },
    onBack: () => {
      dispatch({ type: 'POP_SCREEN' });
    },
    isActive,
  });

  return (
    <Box flexDirection="column">
      <Text bold>New document</Text>
      <ListView
        items={CREATABLE_FORMATS}
        selectedIndex={selectedIndex}
        renderItem={(entry, isSelected) => (
          <Box>
            <Box width={EXTENSION_COLUMN_WIDTH}>
              <Text color={isSelected ? 'cyan' : undefined} inverse={isSelected}>
                .{formatToExtension(entry.format)}
              </Text>
            </Box>
            <Text color={isSelected ? 'cyan' : undefined} inverse={isSelected}>
              {entry.description}
            </Text>
          </Box>
        )}
      />
      <Text dimColor>Enter to create, Esc to go back</Text>
    </Box>
  );
}
