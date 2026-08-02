import { Box, Text, useInput } from 'ink';
import { useState, type ReactElement } from 'react';
import { TextField } from '../../../components/text-field.js';
import { useAppDispatch, useAppState } from '../../../state/context.js';
import { anyOverlayOpen, currentScreen } from '../../../state/types.js';
import { paragraphFamilyDocument } from '../../shared/paragraph-family.js';

// OdtListItem (documents.js) exposes only `appendParagraph()` and `addNestedList()` -- no getter at all for an item's own text, and no getter for a nested list it may already contain -- so this screen can show how many items a list has and let the user append a new top-level item, but cannot render any existing item's content.
//
// Indenting an item into a new nested list (`item.addNestedList()`) is a real, separate gap: state/actions.ts has no Action for it at all -- `ADD_LIST_ITEM` only ever appends a sibling to the TOP-LEVEL list addressed by `blockIndex`, never a nested one -- and adding one would mean extending state/actions.ts and state/reducer.ts, which are outside this task's own file scope (that reducer is shared foundation, verified and depended on by sibling screens being built in parallel in this same tree). Pressing the indent/outdent keys reports why through the status line, the same way the reducer itself reports "can't do that" for every other out-of-reach action, rather than doing nothing silently.
export function ListEditorScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [isAdding, setIsAdding] = useState(false);
  const [newItemText, setNewItemText] = useState('');

  const screen = currentScreen(state);
  const doc = paragraphFamilyDocument(state.openDocument);
  const list = screen.kind === 'listEditor' && doc?.format === 'odt' ? doc.editor.lists()[screen.blockIndex] : undefined;
  const itemCount = list === undefined ? 0 : list.items().length;

  useInput(
    (input, key) => {
      if (list === undefined || screen.kind !== 'listEditor') {
        return;
      }
      if (key.escape) {
        dispatch({ type: 'POP_SCREEN' });
        return;
      }
      if (input === 'a') {
        setIsAdding(true);
        return;
      }
      if (key.tab || input === '>' || input === '<') {
        dispatch({ type: 'SET_STATUS', severity: 'warning', text: "Indenting a list item needs a new reducer action this pass didn't add -- OdtListItem.addNestedList() has no wiring yet" });
      }
    },
    { isActive: !anyOverlayOpen(state) && !isAdding },
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

  return (
    <Box flexDirection="column">
      <Text bold>
        List {screen.blockIndex} ({itemCount} item{itemCount === 1 ? '' : 's'})
      </Text>
      {itemCount === 0 ? (
        <Text dimColor>This list has no items yet.</Text>
      ) : (
        Array.from({ length: itemCount }, (_, index) => (
          <Text key={index} dimColor>
            {index + 1}. (item content is not readable through documents.js's OdtListItem API)
          </Text>
        ))
      )}
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
        <Text dimColor>a to add an item, Esc back</Text>
      )}
    </Box>
  );
}
