import { Box, Text, useInput } from "ink";
import { useState, type ReactElement } from "react";
import { ListView } from "../../../components/list-view.js";
import { TextField } from "../../../components/text-field.js";
import { useNavigationInput } from "../../../keybindings/use-navigation-input.js";
import { useAppDispatch, useAppState } from "../../../state/context.js";
import { anyOverlayOpen, currentScreen } from "../../../state/types.js";
import { paragraphFamilyDocument } from "../../shared/paragraph-family.js";
import { RunTextEditor } from "../docx/run-editor.js";

// OdtListItem (documents.js) now exposes `.text` (its own paragraphs, newline-joined -- the same convention OdtTableCell.text/OdpShape.text already use) alongside `appendParagraph()`/`addNestedList()`, so an item's real content is readable and editable here, not just countable.
//
// Tab/">" indents the selected item into the preceding sibling's nested list (INDENT_LIST_ITEM, OdtList.indentItem). Outdent ("<") and navigating INTO an already-nested list are deliberately out of scope here: this screen only ever addresses a TOP-LEVEL list (`doc.editor.lists()[screen.blockIndex]`), with no route to drill into an item's own nestedLists(), so there is nothing reachable from this screen for outdent to act on yet -- tracked as its own follow-up.
export function ListEditorScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const overlayOpen = anyOverlayOpen(state);
  const [isAdding, setIsAdding] = useState(false);
  const [newItemText, setNewItemText] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | undefined>(
    undefined,
  );

  const screen = currentScreen(state);
  const doc = paragraphFamilyDocument(state.openDocument);
  const blockIndex =
    screen.kind === "listEditor" ? screen.blockIndex : undefined;
  const list =
    blockIndex !== undefined && doc?.format === "odt"
      ? doc.editor.lists()[blockIndex]
      : undefined;
  // Fresh every render, matching this codebase's own live-view rule (state/types.ts's top-of-file note) -- never cached in useState/useMemo, since any mutation elsewhere invalidates an array captured on an earlier render.
  const items = list === undefined ? [] : list.items();
  const rows = items.map((item, index) => ({ item, index }));
  const itemCount = items.length;

  const isNavigationActive =
    !overlayOpen && !isAdding && editingIndex === undefined;

  const { selectedIndex } = useNavigationInput({
    itemCount,
    isActive: isNavigationActive,
    onBack: () => {
      dispatch({ type: "POP_SCREEN" });
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
      if (key.tab || input === ">") {
        if (blockIndex === undefined) return;
        dispatch({
          type: "INDENT_LIST_ITEM",
          blockIndex,
          itemIndex: selectedIndex,
        });
      } else if (input === "<") {
        dispatch({
          type: "SET_STATUS",
          severity: "warning",
          text: "Outdenting isn't reachable from this screen yet -- it only browses top-level lists, with no route into an item's own nested list",
        });
      }
    },
    { isActive: isNavigationActive },
  );

  if (screen.kind !== "listEditor") {
    return (
      <Text color="red">
        ListEditorScreen rendered outside a listEditor screen.
      </Text>
    );
  }
  if (doc?.format !== "odt") {
    return (
      <Text color="red">ListEditorScreen requires an open odt document.</Text>
    );
  }
  if (list === undefined) {
    return (
      <Text color="red">There is no list at index {screen.blockIndex}.</Text>
    );
  }

  if (editingIndex !== undefined) {
    const item = items[editingIndex];
    if (item === undefined) {
      throw new Error(
        `ListEditorScreen is editing item index ${editingIndex}, but list ${screen.blockIndex} only has ${items.length} items -- selecting a row always sets editingIndex to a valid index from that same items array, so this indicates a bug in that selection.`,
      );
    }
    return (
      <Box flexDirection="column">
        <Text bold>
          List {screen.blockIndex}, item {editingIndex + 1}
        </Text>
        <RunTextEditor
          initialText={item.text}
          onCommit={(text) => {
            dispatch({
              type: "SET_LIST_ITEM_TEXT",
              blockIndex: screen.blockIndex,
              itemIndex: editingIndex,
              text,
            });
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
        List {screen.blockIndex} ({itemCount} item{itemCount === 1 ? "" : "s"})
      </Text>
      <ListView
        items={rows}
        selectedIndex={selectedIndex}
        emptyMessage="This list has no items yet -- press 'a' to add one."
        renderItem={(row, isSelected) => {
          const trimmed = row.item.text.trim();
          return (
            <Text color={isSelected ? "cyan" : undefined} inverse={isSelected}>
              {row.index + 1}.{" "}
              {trimmed.length === 0 ? "(empty)" : row.item.text}
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
              dispatch({
                type: "ADD_LIST_ITEM",
                blockIndex: screen.blockIndex,
                text,
              });
              setNewItemText("");
              setIsAdding(false);
            }}
            onCancel={() => {
              setNewItemText("");
              setIsAdding(false);
            }}
          />
        </Box>
      ) : (
        <Text dimColor>
          Enter to edit an item, a to add, Tab/&gt; to indent, Esc back
        </Text>
      )}
    </Box>
  );
}
