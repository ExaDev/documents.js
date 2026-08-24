import { Box, Text, useInput } from "ink";
import { useState, type ReactElement } from "react";
import { useAppDispatch, useAppState } from "../../../state/context.js";
import { anyOverlayOpen, currentScreen } from "../../../state/types.js";
import {
  liveTableAt,
  paragraphFamilyDocument,
} from "../../shared/paragraph-family.js";
import { ParagraphRunsView } from "./paragraph-detail.js";
import { RunTextEditor } from "./run-editor.js";

// documents.js's DocxTableCell/OdtTableCell expose `paragraphs()`/`appendParagraph()` and a read-only `text`, but no per-run access at all -- there is no reducer action to toggle bold/italic/underline or set a colour on a run inside a cell (SET_TABLE_CELL_TEXT is the only cell-mutating action, and it replaces the cell's whole text, matching `setCellText` in state/reducer.ts). This screen therefore reuses paragraph-detail's own `ParagraphRunsView` purely to DISPLAY a cell's existing paragraphs with their real styling, and run-editor's own `RunTextEditor` to replace the cell's text wholesale -- it does not duplicate either screen's editing UI, and it does not offer bold/italic/underline/colour keys the underlying API has nowhere to send.
export function TableCellDetailScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [isEditing, setIsEditing] = useState(false);

  const screen = currentScreen(state);
  const doc = paragraphFamilyDocument(state.openDocument);
  const table =
    screen.kind === "tableCellDetail" && doc !== undefined
      ? liveTableAt(doc, screen.blockIndex)
      : undefined;
  const row =
    screen.kind === "tableCellDetail" && table !== undefined
      ? table.rows()[screen.row]
      : undefined;
  const cell =
    screen.kind === "tableCellDetail" && row !== undefined
      ? row.cells()[screen.col]
      : undefined;

  useInput(
    (input, key) => {
      if (cell === undefined) {
        return;
      }
      if (key.escape) {
        dispatch({ type: "POP_SCREEN" });
        return;
      }
      if (key.return || input === "e") {
        setIsEditing(true);
      }
    },
    { isActive: !anyOverlayOpen(state) && !isEditing },
  );

  if (screen.kind !== "tableCellDetail") {
    return (
      <Text color="red">
        TableCellDetailScreen rendered outside a tableCellDetail screen.
      </Text>
    );
  }
  if (doc === undefined) {
    return (
      <Text color="red">
        TableCellDetailScreen requires an open docx, odt or markdown document.
      </Text>
    );
  }
  if (cell === undefined) {
    return (
      <Text color="red">
        There is no cell at row {screen.row}, column {screen.col} of table{" "}
        {screen.blockIndex}.
      </Text>
    );
  }

  const paragraphs = cell.paragraphs();

  return (
    <Box flexDirection="column">
      <Text bold>
        Table {screen.blockIndex}, cell ({screen.row}, {screen.col})
      </Text>
      {paragraphs.length === 0 ? (
        <Text dimColor>(empty cell)</Text>
      ) : (
        paragraphs.map((paragraph, index) => (
          <ParagraphRunsView
            key={index}
            runs={paragraph.runs()}
            selectedRunIndex={undefined}
          />
        ))
      )}
      {isEditing ? (
        <RunTextEditor
          initialText={cell.text}
          onCommit={(text) => {
            dispatch({
              type: "SET_TABLE_CELL_TEXT",
              tableIndex: screen.blockIndex,
              row: screen.row,
              column: screen.col,
              text,
            });
            setIsEditing(false);
          }}
          onCancel={() => {
            setIsEditing(false);
          }}
        />
      ) : (
        <Text dimColor>Enter / e to replace this cell's text, Esc back</Text>
      )}
    </Box>
  );
}
