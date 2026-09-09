import { Box, Text, useInput } from "ink";
import { useState, type ReactElement } from "react";
import type { ContentCellValue } from "documents.js";
import { ListView } from "../../../components/list-view.js";
import { TextField } from "../../../components/text-field.js";
import { useNavigationInput } from "../../../keybindings/use-navigation-input.js";
import { useAppDispatch, useAppState } from "../../../state/context.js";
import { anyOverlayOpen, type XlsOpenDocument } from "../../../state/types.js";
import { OdsCellEditor } from "../ods/cell-detail.js";

// The xls root screens, the sparse-model counterpart of the ods sheet list/grid pair. Everything here reads the live editor fresh on every render (the live-view rule in state/types.ts): XlsEditor's sheets()/cells() are plain array walks over the ContentDocument, so -- unlike ods, whose OdsSheet.cell() display-read has a repeated-run materialisation hazard its own grid carefully routes around through readOdsContent -- a xls grid read is exactly a lookup in the sparse cells array and needs no such detour.

function xlsDocument(state: ReturnType<typeof useAppState>): XlsOpenDocument {
  const doc = state.openDocument;
  if (doc?.format !== "xls") {
    throw new Error(
      "An xls screen rendered without an open xls document; check the screen router in app.tsx.",
    );
  }
  return doc;
}

interface SheetRow {
  readonly index: number;
  readonly name: string;
}

export function XlsSheetListScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = xlsDocument(state);

  // undefined means "not naming a new sheet"; a string (including '') is the draft name buffer while the add-sheet prompt is open.
  const [draftName, setDraftName] = useState<string | undefined>(undefined);
  const isAdding = draftName !== undefined;
  const isActive = !anyOverlayOpen(state) && !isAdding;

  const query = state.searchQuery.trim().toLowerCase();
  const rows: readonly SheetRow[] = doc.editor
    .sheets()
    .map((sheet, index): SheetRow => ({ index, name: sheet.name }))
    .filter(
      (row) => query.length === 0 || row.name.toLowerCase().includes(query),
    );

  const commitAdd = (name: string): void => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      dispatch({
        type: "SET_STATUS",
        severity: "warning",
        text: "A sheet needs a name",
      });
      return;
    }
    dispatch({ type: "ADD_SHEET", name: trimmed });
    setDraftName(undefined);
  };

  const { selectedIndex } = useNavigationInput({
    itemCount: rows.length,
    onSelect: (index) => {
      const row = rows[index];
      if (row === undefined) {
        return;
      }
      dispatch({
        type: "PUSH_SCREEN",
        screen: { kind: "spreadsheetGrid", sheetIndex: row.index },
      });
    },
    onBack: () => {
      dispatch({ type: "POP_SCREEN" });
    },
    onAppend: () => {
      setDraftName("");
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
          <Text color={isSelected ? "cyan" : undefined} inverse={isSelected}>
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

// Column letters the way a spreadsheet states them (A, B, ... AA), for the cursor address readout -- the identical convention the ods grid's own address line uses.
function columnLetters(column: number): string {
  let value = column;
  let letters = "";
  do {
    letters = String.fromCharCode((value % 26) + 65) + letters;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return letters;
}

const GRID_ROWS = 10;
const GRID_COLUMNS = 6;

interface EditSession {
  readonly seedText: string;
  readonly seedKind: ContentCellValue["kind"];
}

export function XlsSpreadsheetGridScreen(props: {
  readonly sheetIndex: number;
}): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = xlsDocument(state);
  const overlayOpen = anyOverlayOpen(state);
  // Non-empty-cells-only listing ('t'): the escape hatch for a huge, sparse sheet, the identical affordance the ods grid offers.
  const [compact, setCompact] = useState(false);
  const [cursor, setCursor] = useState({ row: 0, column: 0 });
  const [editSession, setEditSession] = useState<EditSession | undefined>(
    undefined,
  );
  const editing = editSession !== undefined;
  const sheet = doc.editor.sheets()[props.sheetIndex];

  // Cursor movement and editing, raw useInput the way the ods grid itself drives its cursor (a deliberate override of the linear-list convention -- see its own comment); every handler is a no-op when the addressed sheet does not exist, so hook order stays identical across renders.
  useInput(
    (input, key) => {
      if (sheet === undefined) {
        return;
      }
      const move = (dRow: number, dColumn: number): void => {
        setCursor((current) => ({
          row: Math.max(0, current.row + dRow),
          column: Math.max(0, current.column + dColumn),
        }));
      };
      if (key.escape) {
        if (editing) {
          setEditSession(undefined);
          return;
        }
        dispatch({ type: "POP_SCREEN" });
        return;
      }
      if (key.upArrow || input === "k") {
        move(-1, 0);
        return;
      }
      if (key.downArrow || input === "j") {
        move(1, 0);
        return;
      }
      if (key.leftArrow || input === "h") {
        move(0, -1);
        return;
      }
      if (key.rightArrow || input === "l") {
        move(0, 1);
        return;
      }
      if (key.return) {
        const existing = sheet
          .cells()
          .find(
            (cell) => cell.row === cursor.row && cell.column === cursor.column,
          );
        setEditSession({
          seedText: existing?.displayText ?? "",
          seedKind: existing?.value.kind ?? "empty",
        });
        return;
      }
      if (input === "t") {
        setCompact((value) => !value);
      }
    },
    { isActive: !overlayOpen },
  );

  if (sheet === undefined) {
    return (
      <Text color="red">
        There is no sheet at index {props.sheetIndex} in this workbook.
      </Text>
    );
  }

  // Fresh on every render, straight off the live editor: a plain Map over the sparse cells array.
  const cells = new Map(
    sheet.cells().map((cell) => [`${cell.row}:${cell.column}`, cell]),
  );
  const cursorAddress = `${columnLetters(cursor.column)}${cursor.row + 1}`;
  const cursorCell = cells.get(`${cursor.row}:${cursor.column}`);

  if (compact) {
    const entries = sheet.cells();
    return (
      <Box flexDirection="column">
        <Text bold>
          {sheet.name} -- non-empty cells ({entries.length}) -- 't' back to grid
        </Text>
        {entries.length === 0 ? (
          <Text dimColor>No cells carry a value yet.</Text>
        ) : (
          entries.slice(0, 200).map((cell) => (
            <Text key={`${cell.row}:${cell.column}`}>
              {columnLetters(cell.column)}
              {cell.row + 1}:{" "}
              {cell.displayText === "" ? "(empty)" : cell.displayText}
            </Text>
          ))
        )}
        <Text dimColor>t: full grid Esc: back</Text>
      </Box>
    );
  }

  const windowStartRow = Math.min(
    Math.max(0, cursor.row - (GRID_ROWS - 1)),
    Math.max(0, cursor.row),
  );
  const windowStartColumn = Math.min(
    Math.max(0, cursor.column - (GRID_COLUMNS - 1)),
    Math.max(0, cursor.column),
  );

  return (
    <Box flexDirection="column">
      <Text bold>
        {sheet.name} ({cells.size} cells)
      </Text>
      {Array.from({ length: GRID_ROWS }, (_, r) => windowStartRow + r).map(
        (row) => (
          <Text key={row}>
            {Array.from(
              { length: GRID_COLUMNS },
              (_, c) => windowStartColumn + c,
            )
              .map((column) => {
                const cell = cells.get(`${row}:${column}`);
                const isCursor = row === cursor.row && column === cursor.column;
                const body = (cell?.displayText ?? "").slice(0, 12);
                const padded = body.padEnd(12, " ");
                return isCursor ? `[${padded.slice(0, 12)}]` : ` ${padded} `;
              })
              .join("")}
          </Text>
        ),
      )}
      {editSession === undefined ? (
        <Text>
          <Text color="cyan">{cursorAddress} </Text>
          <Text>
            {cursorCell === undefined ? "(empty)" : cursorCell.displayText}
          </Text>
        </Text>
      ) : (
        <OdsCellEditor
          address={cursorAddress}
          initialText={editSession.seedText}
          initialKind={editSession.seedKind}
          isActive={!overlayOpen}
          onCommit={(value) => {
            dispatch({
              type: "SET_CELL_VALUE",
              sheetIndex: props.sheetIndex,
              row: cursor.row,
              column: cursor.column,
              value,
            });
            setEditSession(undefined);
          }}
          onCancel={() => {
            setEditSession(undefined);
          }}
        />
      )}
      <Text dimColor>
        hjkl/arrows: move Enter: edit t: non-empty list Esc: back
      </Text>
    </Box>
  );
}
