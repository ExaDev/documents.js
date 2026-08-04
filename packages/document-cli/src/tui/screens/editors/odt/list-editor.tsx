import { Box, Text, useInput } from 'ink';
import { useState, type ReactElement } from 'react';
import { ListView } from '../../../components/list-view.js';
import { TextField } from '../../../components/text-field.js';
import { useNavigationInput } from '../../../keybindings/use-navigation-input.js';
import { useAppDispatch, useAppState } from '../../../state/context.js';
import { anyOverlayOpen, currentScreen } from '../../../state/types.js';
import { paragraphFamilyDocument } from '../../shared/paragraph-family.js';
import { RunTextEditor } from '../docx/run-editor.js';

// OdtListItem (documents.js) now exposes `.text` (its own paragraphs, newline-joined -- the same convention OdtTableCell.text/OdpShape.text already use) alongside `appendParagraph()`/`addNestedList()`, so an item's real content is readable and editable here, not just countable.
//
// Indenting an item into a new nested list (`item.addNestedList()`) is deliberately left out of scope: state/actions.ts has no Action for it at all -- `ADD_LIST_ITEM` only ever appends a sibling to the TOP-LEVEL list addressed by `blockIndex`, never a nested one -- and `SET_LIST_ITEM_TEXT` (this file's own addition) only replaces an existing item's text, it does not restructure the list tree. Pressing the indent/outdent keys reports why through the status line, the same way the reducer itself reports "can't do that" for every other out-of-reach action, rather than doing nothing silently.
export function ListEditorScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const overlayOpen = anyOverlayOpen(state);
  const [isAdding, setIsAdding] = useState(false);
  const [newItemText, setNewItemText] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | undefined>(undefined);

  const screen = currentScreen(state);
  const doc = paragraphFamilyDocument(state.openDocument);
  const list = screen.kind === 'listEditor' && doc?.format === 'odt' ? doc.editor.lists()[screen.blockIndex] : undefined;
  // Fresh every render, matching this codebase's own live-view rule (state/types.ts's top-of-file note) -- never cached in useState/useMemo, since any mutation elsewhere invalidates an array captured on an earlier render.
  const items = list === undefined ? [] : list.items();
  const rows = items.map((item, index) => ({ item, index }));
  const itemCount = items.length;

  const isNavigationActive = !overlayOpen && !isAdding && editingIndex === undefined;

  const { selectedIndex } = useNavigationInput({
    itemCount,
    isActive: isNavigationActive,
    onBack: () => {
      dispatch({ type: 'POP_SCREEN' });
    },
    onSelect: (index) => {
      setEditingIndex(index);
    },
    onAppend: () => {
      setIsAdding(true);
    },
  });

  useInput(
    (input, key) => {
      if (key.tab || input === '>' || input === '<') {
        dispatch({ type: 'SET_STATUS', severity: 'warning', text: "Indenting a list item needs a new reducer action this pass didn't add -- OdtListItem.addNestedList() has no wiring yet" });
      }
    },
    { isActive: isNavigationActive },
  );

  if (screen.kind !== 'listEditor') {
    return <Text color="red">ListEditorScreen rendered outside a listEditor screen.</Text>;
  }
  if (doc?.format !== 'odt') {
    return <Text color="red">ListEditorScreen requires an open odt document.</Text>;
  }
  if (list === undefined) {
    return <Text color="red">There is no list at index {screen.blockIndex}.</Text>;
  }

  if (editingIndex !== undefined) {
    const item = items[editingIndex];
    if (item === undefined) {
      throw new Error(`ListEditorScreen is editing item index ${editingIndex}, but list ${screen.blockIndex} only has ${items.length} items -- selecting a row always sets editingIndex to a valid index from that same items array, so this indicates a bug in that selection.`);
    }
    return (
      <Box flexDirection="column">
        <Text bold>
          List {screen.blockIndex}, item {editingIndex + 1}
        </Text>
        <RunTextEditor
          initialText={item.text}
          onCommit={(text) => {
            dispatch({ type: 'SET_LIST_ITEM_TEXT', blockIndex: screen.blockIndex, itemIndex: editingIndex, text });
            setEditingIndex(undefined);
          }}
          onCancel={() => {
            setEditingIndex(undefined);
          }}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>
        List {screen.blockIndex} ({itemCount} item{itemCount === 1 ? '' : 's'})
      </Text>
      <ListView
        items={rows}
        selectedIndex={selectedIndex}
        emptyMessage="This list has no items yet -- press 'a' to add one."
        renderItem={(row, isSelected) => {
          const trimmed = row.item.text.trim();
          return (
            <Text color={isSelected ? 'cyan' : undefined} inverse={isSelected}>
              {row.index + 1}. {trimmed.length === 0 ? '(empty)' : row.item.text}
            </Text>
          );
        }}
      />
      {isAdding ? (
        <Box>
          <Text color="cyan">+ </Text>
          <TextField
            value={newItemText}
            isFocused
            placeholder="new item text"
            onChange={setNewItemText}
            onSubmit={(text) => {
              dispatch({ type: 'ADD_LIST_ITEM', blockIndex: screen.blockIndex, text });
              setNewItemText('');
              setIsAdding(false);
            }}
            onCancel={() => {
              setNewItemText('');
              setIsAdding(false);
            }}
          />
        </Box>
      ) : (
        <Text dimColor>Enter to edit an item, a to add, Esc back</Text>
      )}
    </Box>
  );
}
