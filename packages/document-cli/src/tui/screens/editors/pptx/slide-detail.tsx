import { readFile } from 'node:fs/promises';
import { Box, Text, useInput } from 'ink';
import { useState, type ReactElement } from 'react';
import { describeError } from '../../../errors.js';
import { ListView } from '../../../components/list-view.js';
import { TextField } from '../../../components/text-field.js';
import { useNavigationInput } from '../../../keybindings/use-navigation-input.js';
import { useAppDispatch, useAppState } from '../../../state/context.js';
import { anyOverlayOpen, selectionKeyFor, type Screen } from '../../../state/types.js';
import { assertPresentationDocument, defaultShapeFrame, describeSlideFamilyShape } from '../../shared/slide-family.js';

export interface SlideDetailScreenProps {
  readonly screen: Extract<Screen, { kind: 'slideDetail' }>;
}

// 'tableRows'/'tableColumns' are a two-step wizard rather than one combined field: this screen has no multi-field FieldWizard the way odg's page-detail.tsx does (see that file's own FieldWizard), and a table only ever needs these two small integers, so two sequential single-value TextField steps -- the same shape every other add-item flow in this screen already uses -- covers it without importing a heavier component for one caller.
type AddItemMode = 'closed' | 'chooseKind' | 'textbox' | 'image' | 'tableRows' | 'tableColumns';

const IMAGE_EXTENSION_TO_FORMAT: Readonly<Record<string, 'png' | 'jpeg'>> = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg' };

const DEFAULT_TABLE_ROWS = 2;
const DEFAULT_TABLE_COLUMNS = 2;

// Table dimensions are small positive integers -- a blank or non-numeric entry falls back to the same default the field was pre-filled with, and anything less than 1 (zero, negative, a fraction that floors to 0) does too, since documents.js's own SlideTableInit has no meaningful zero-row or zero-column table to build.
function parsePositiveIntField(raw: string, fallback: number): number {
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function imageFormatFromPath(path: string): 'png' | 'jpeg' | undefined {
  const dotIndex = path.lastIndexOf('.');
  if (dotIndex < 0) {
    return undefined;
  }
  return IMAGE_EXTENSION_TO_FORMAT[path.slice(dotIndex + 1).toLowerCase()];
}

async function readImageForShape(path: string): Promise<{ readonly format: 'png' | 'jpeg'; readonly bytes: Uint8Array<ArrayBuffer> }> {
  const format = imageFormatFromPath(path);
  if (format === undefined) {
    throw new Error(`${path} does not look like a .png or .jpg/.jpeg file -- ADD_IMAGE only accepts those two formats`);
  }
  return { format, bytes: new Uint8Array(await readFile(path)) };
}

export function SlideDetailScreen(props: SlideDetailScreenProps): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const overlayOpen = anyOverlayOpen(state);
  const doc = assertPresentationDocument(state.openDocument);
  const { slideIndex } = props.screen;
  const slide = doc.editor.slides()[slideIndex];
  const shapes = slide === undefined ? [] : slide.shapes();
  const rows = shapes.map((shape, index) => ({ index, text: shape.text, frame: shape.frame }));

  const [addMode, setAddMode] = useState<AddItemMode>('closed');
  const [draft, setDraft] = useState('');
  const [imageError, setImageError] = useState<string | undefined>(undefined);
  const [tableRows, setTableRows] = useState(DEFAULT_TABLE_ROWS);
  const formIsOpen = addMode !== 'closed';

  const { selectedIndex } = useNavigationInput({
    itemCount: rows.length,
    isActive: !overlayOpen && !formIsOpen,
    onBack: () => {
      dispatch({ type: 'POP_SCREEN' });
    },
    onSelect: (index) => {
      dispatch({ type: 'SET_SELECTION', key: selectionKeyFor(props.screen), index });
      dispatch({ type: 'PUSH_SCREEN', screen: { kind: 'shapeEditor', slideIndex, shapeIndex: index } });
    },
    onAppend: () => {
      setAddMode('chooseKind');
    },
  });

  // 't'/'i'/'b' choose the new item's kind; anything else (bar Esc) is ignored rather than falling through to the list navigation below, since useNavigationInput is already inactive for the whole add-item flow (see `formIsOpen` above).
  useInput(
    (input, key) => {
      if (key.escape) {
        setAddMode('closed');
        return;
      }
      if (input === 't') {
        setDraft('');
        setAddMode('textbox');
        return;
      }
      if (input === 'i') {
        setDraft('');
        setImageError(undefined);
        setAddMode('image');
        return;
      }
      if (input === 'b') {
        setDraft(String(DEFAULT_TABLE_ROWS));
        setAddMode('tableRows');
      }
    },
    { isActive: !overlayOpen && addMode === 'chooseKind' },
  );

  // Notes editing is scoped to odp only -- see notes-editor.tsx's own doc comment for why pptx, which technically supports it too, is deliberately left out here.
  useInput(
    (input) => {
      if (input === 'n' && doc.format === 'odp') {
        dispatch({ type: 'PUSH_SCREEN', screen: { kind: 'notesEditor', slideIndex } });
      }
    },
    { isActive: !overlayOpen && !formIsOpen },
  );

  const commitTextbox = (text: string): void => {
    dispatch({ type: 'ADD_TEXTBOX', containerIndex: slideIndex, frame: defaultShapeFrame(doc.editor.slideSize), text });
    setAddMode('closed');
  };

  const commitImage = (path: string): void => {
    void (async () => {
      try {
        const { format, bytes } = await readImageForShape(path);
        dispatch({ type: 'ADD_IMAGE', containerIndex: slideIndex, frame: defaultShapeFrame(doc.editor.slideSize), format, bytes, altText: undefined });
        setAddMode('closed');
      } catch (error) {
        setImageError(describeError(error));
      }
    })();
  };

  const commitTableRows = (raw: string): void => {
    setTableRows(parsePositiveIntField(raw, DEFAULT_TABLE_ROWS));
    setDraft(String(DEFAULT_TABLE_COLUMNS));
    setAddMode('tableColumns');
  };

  const commitTableColumns = (raw: string): void => {
    const columns = parsePositiveIntField(raw, DEFAULT_TABLE_COLUMNS);
    dispatch({ type: 'ADD_SLIDE_TABLE', slideIndex, frame: defaultShapeFrame(doc.editor.slideSize), rows: tableRows, columns });
    setAddMode('closed');
  };

  return (
    <Box flexDirection="column">
      <Text bold>
        Slide {slideIndex + 1} -- {rows.length} shape{rows.length === 1 ? '' : 's'}
      </Text>
      {slide === undefined ? (
        <Text color="yellow">This slide no longer exists -- press Esc to go back</Text>
      ) : (
        <ListView
          items={rows}
          selectedIndex={selectedIndex}
          emptyMessage="No shapes yet -- press 'a' to add one"
          renderItem={(row, isSelected) => (
            <Text color={isSelected ? 'cyan' : undefined} inverse={isSelected}>
              {row.index + 1}. {describeSlideFamilyShape({ text: row.text, frame: row.frame })}
            </Text>
          )}
        />
      )}
      {addMode === 'chooseKind' ? <Text color="cyan">Add shape: t textbox, i image, b table, Esc cancel</Text> : undefined}
      {addMode === 'textbox' ? (
        <Box>
          <Text color="cyan">Textbox content: </Text>
          <TextField
            value={draft}
            isFocused
            onChange={setDraft}
            onSubmit={commitTextbox}
            onCancel={() => {
              setAddMode('closed');
            }}
          />
        </Box>
      ) : undefined}
      {addMode === 'image' ? (
        <Box flexDirection="column">
          <Box>
            <Text color="cyan">Image file path: </Text>
            <TextField
              value={draft}
              isFocused
              onChange={setDraft}
              onSubmit={commitImage}
              onCancel={() => {
                setAddMode('closed');
              }}
            />
          </Box>
          {imageError === undefined ? undefined : <Text color="red">{imageError}</Text>}
        </Box>
      ) : undefined}
      {addMode === 'tableRows' ? (
        <Box>
          <Text color="cyan">Rows: </Text>
          <TextField
            value={draft}
            isFocused
            onChange={setDraft}
            onSubmit={commitTableRows}
            onCancel={() => {
              setAddMode('closed');
            }}
          />
        </Box>
      ) : undefined}
      {addMode === 'tableColumns' ? (
        <Box>
          <Text color="cyan">Columns: </Text>
          <TextField
            value={draft}
            isFocused
            onChange={setDraft}
            onSubmit={commitTableColumns}
            onCancel={() => {
              setAddMode('closed');
            }}
          />
        </Box>
      ) : undefined}
      <Text dimColor>
        Enter: edit shape a: add shape{doc.format === 'odp' ? ' n: notes' : ''} Esc: back
      </Text>
    </Box>
  );
}
