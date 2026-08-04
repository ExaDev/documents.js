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

// The six formats this picker offers as a genuinely useful "start from a blank document" flow. `.odb` is excluded because it has no write direction at all (it only extracts an embedded database's tables). `.pdf` is a real `EditableFormat` too now (documents.js's `createPdf()` produces a live-view `PdfEditor` exactly like the six below) and `createNewDocument` handles it -- it is left off THIS list on UX grounds rather than a technical one: a blank single-page PDF with nothing on it is a far less useful starting point than opening an existing PDF and editing it (the pdf page-list/page-items/item-detail screens), so this picker does not surface it as a "new document" option.
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
