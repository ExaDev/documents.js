import type { ContentCellValue } from 'documents.js';
import { Box, Text, useInput, useWindowSize } from 'ink';
import { cellReference, columnIndexToLetters } from 'odf.js';
import { useState, type ReactElement } from 'react';
import { ListView } from '../../../components/list-view.js';
import { useNavigationInput } from '../../../keybindings/use-navigation-input.js';
import { useAppDispatch, useAppState } from '../../../state/context.js';
import { anyOverlayOpen, currentScreen } from '../../../state/types.js';
import { OdsCellEditor } from './cell-detail.js';
import { cellKey, cellLookup, inferKind, KIND_BADGE, odsDocument, rawEditableText, resolveSheet, sheetExtent } from './shared.js';

const ROW_HEADER_WIDTH = 5;
const CELL_WIDTH = 11;
const PAGE_JUMP_ROWS = 10;
// Wide enough for the longest address a compact-list row is likely to show (e.g. "AA100") plus a space.
const COMPACT_ADDRESS_WIDTH = 8;
// This screen's own chrome beyond ListView's default reserved-rows count: a title line, a column-header line, the cell-info line below the grid, one hint line, and the app shell's StatusLine underneath everything -- the compact list view reuses this same figure via ListView's `reservedRows`.
const GRID_CHROME_ROWS = 5;

// 'h'/'j'/'k'/'l' move the cursor, and 'p'/'t' open print settings / toggle the compact view -- all six are claimed before the printable-character check below, so none of them can seed a type-to-edit. A real, honest, vim-shaped limitation: reach the editor with Enter first, then those letters type as ordinary characters like any other.
const RESERVED_LETTERS: ReadonlySet<string> = new Set(['h', 'j', 'k', 'l', 'p', 't']);

interface EditSession {
  readonly seedText: string;
  readonly seedKind: ContentCellValue['kind'];
}

interface CompactRow {
  readonly row: number;
  readonly column: number;
  readonly address: string;
  readonly badge: string;
  readonly displayText: string;
}

function windowStart(cursor: number, total: number, viewport: number): number {
  const maxStart = Math.max(0, total - viewport);
  return Math.min(Math.max(cursor - Math.floor(viewport / 2), 0), maxStart);
}

function padCell(text: string, width: number): string {
  return text.length > width ? text.slice(0, width) : text.padEnd(width);
}

function range(start: number, count: number): readonly number[] {
  return Array.from({ length: count }, (_, offset) => start + offset);
}

// A bounded, viewport-windowed 2D grid: `hjkl`/arrow keys move the cell cursor literally (left/down/up/right), a deliberate override of the generic list convention (see use-navigation-input.ts) matching vim's own mode-dependent overload of the same letters. Esc pops back to the sheet list; 't' swaps to a compact non-empty-cells-only list (an escape hatch for a huge, sparse sheet) without leaving this screen; 'p' pushes the print-settings editor. Cell display reads exclusively through `resolveSheet`/`readOdsContent` (see shared.ts's own comment on why `OdsSheet.cell()` is display-unsafe); only a committed edit ever calls the live `OdsSheet.cell(...).value` setter, via SET_CELL_VALUE.
export function OdsSpreadsheetGridScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = odsDocument(state);
  const screen = currentScreen(state);
  if (screen.kind !== 'spreadsheetGrid') {
    throw new Error('OdsSpreadsheetGridScreen was rendered while the current screen was not a spreadsheetGrid screen.');
  }
  const { sheetIndex } = screen;

  const [cursorRow, setCursorRow] = useState(0);
  const [cursorColumn, setCursorColumn] = useState(0);
  const [viewMode, setViewMode] = useState<'grid' | 'compact'>('grid');
  const [editSession, setEditSession] = useState<EditSession | undefined>(undefined);

  const { columns: terminalColumns, rows: terminalRows } = useWindowSize();

  const sheet = resolveSheet(doc.editor, sheetIndex);
  const { rowCount, columnCount } = sheetExtent(sheet);
  const cells = cellLookup(sheet);

  const clampedRow = Math.min(cursorRow, rowCount - 1);
  const clampedColumn = Math.min(cursorColumn, columnCount - 1);

  const overlayOpen = anyOverlayOpen(state);
  const editing = editSession !== undefined;

  function moveCursor(deltaRow: number, deltaColumn: number): void {
    setCursorRow((row) => Math.min(Math.max(row + deltaRow, 0), rowCount - 1));
    setCursorColumn((column) => Math.min(Math.max(column + deltaColumn, 0), columnCount - 1));
  }

  function beginEdit(seedText: string, seedKind: ContentCellValue['kind']): void {
    setEditSession({ seedText, seedKind });
  }

  // Commands that apply in either view mode: print settings and the grid/compact toggle.
  useInput(
    (input) => {
      if (input === 't') {
        setViewMode((mode) => (mode === 'grid' ? 'compact' : 'grid'));
        return;
      }
      if (input === 'p') {
        dispatch({ type: 'PUSH_SCREEN', screen: { kind: 'printSettingsEditor', sheetIndex } });
      }
    },
    { isActive: !overlayOpen && !editing },
  );

  // Grid-mode cursor movement and type-to-edit -- inactive while the compact list owns the keyboard instead.
  useInput(
    (input, key) => {
      if (key.upArrow || input === 'k') {
        moveCursor(-1, 0);
        return;
      }
      if (key.downArrow || input === 'j') {
        moveCursor(1, 0);
        return;
      }
      if (key.leftArrow || input === 'h') {
        moveCursor(0, -1);
        return;
      }
      if (key.rightArrow || input === 'l') {
        moveCursor(0, 1);
        return;
      }
      if (key.pageUp) {
        moveCursor(-PAGE_JUMP_ROWS, 0);
        return;
      }
      if (key.pageDown) {
        moveCursor(PAGE_JUMP_ROWS, 0);
        return;
      }
      // Home/End jump within the current row (to column A / the last populated column) rather than to the first/last row: the generic ListView convention (first/last item) has no clean 2D analogue, and a row-relative jump matches how a real spreadsheet's own Home/End behave.
      if (key.home) {
        setCursorColumn(0);
        return;
      }
      if (key.end) {
        setCursorColumn(columnCount - 1);
        return;
      }
      if (key.escape) {
        dispatch({ type: 'POP_SCREEN' });
        return;
      }
      if (key.return) {
        const cell = cells.get(cellKey(clampedRow, clampedColumn));
        const seedKind: ContentCellValue['kind'] = cell === undefined || cell.value.kind === 'empty' ? 'string' : cell.value.kind;
        beginEdit(cell === undefined ? '' : rawEditableText(cell.value), seedKind);
        return;
      }
      if (input.length === 1 && !key.ctrl && !key.meta && !RESERVED_LETTERS.has(input)) {
        beginEdit(input, inferKind(input));
      }
    },
    { isActive: !overlayOpen && !editing && viewMode === 'grid' },
  );

  const compactRows: readonly CompactRow[] =
    sheet === undefined
      ? []
      : sheet.cells
          .filter((cell) => cell.value.kind !== 'empty')
          .map(
            (cell): CompactRow => ({
              row: cell.row,
              column: cell.column,
              address: cellReference(cell.column, cell.row),
              badge: KIND_BADGE[cell.value.kind],
              displayText: cell.displayText,
            }),
          )
          .sort((a, b) => a.row - b.row || a.column - b.column);

  const query = state.searchQuery.trim().toLowerCase();
  const filteredCompactRows = compactRows.filter((row) => query.length === 0 || row.address.toLowerCase().includes(query) || row.displayText.toLowerCase().includes(query));

  const { selectedIndex: compactSelectedIndex } = useNavigationInput({
    itemCount: filteredCompactRows.length,
    onSelect: (index) => {
      const row = filteredCompactRows[index];
      if (row === undefined) {
        return;
      }
      setCursorRow(row.row);
      setCursorColumn(row.column);
      setViewMode('grid');
    },
    onBack: () => {
      setViewMode('grid');
    },
    isActive: !overlayOpen && !editing && viewMode === 'compact',
  });

  const cursorCell = cells.get(cellKey(clampedRow, clampedColumn));
  const cursorAddress = cellReference(clampedColumn, clampedRow);
  const cursorKind = cursorCell === undefined ? 'empty' : cursorCell.value.kind;

  const viewportRows = Math.max(1, terminalRows - GRID_CHROME_ROWS);
  const visibleColumnCount = Math.max(1, Math.floor((terminalColumns - ROW_HEADER_WIDTH) / CELL_WIDTH));
  const rowStart = windowStart(clampedRow, rowCount, viewportRows);
  const columnStart = windowStart(clampedColumn, columnCount, visibleColumnCount);
  const visibleColumns = range(columnStart, Math.min(visibleColumnCount, columnCount - columnStart));
  const visibleRows = range(rowStart, Math.min(viewportRows, rowCount - rowStart));

  return (
    <Box flexDirection="column">
      <Text bold>
        {sheet === undefined ? `Sheet ${sheetIndex}` : sheet.name} ({rowCount}x{columnCount})
      </Text>

      {viewMode === 'compact' ? (
        <ListView
          items={filteredCompactRows}
          selectedIndex={compactSelectedIndex}
          reservedRows={GRID_CHROME_ROWS}
          emptyMessage="No populated cells yet -- press 't' to go back to the grid and start typing."
          renderItem={(row, isSelected) => (
            <Text color={isSelected ? 'cyan' : undefined} inverse={isSelected}>
              {padCell(row.address, COMPACT_ADDRESS_WIDTH)}[{row.badge}] {row.displayText}
            </Text>
          )}
        />
      ) : (
        <Box flexDirection="column">
          <Box>
            <Text dimColor>{' '.repeat(ROW_HEADER_WIDTH)}</Text>
            {visibleColumns.map((column) => (
              <Text key={column} dimColor>
                {padCell(columnIndexToLetters(column), CELL_WIDTH)}
              </Text>
            ))}
          </Box>
          {visibleRows.map((row) => (
            <Box key={row}>
              <Text dimColor>{`${row + 1}`.padStart(ROW_HEADER_WIDTH - 1)} </Text>
              {visibleColumns.map((column) => {
                const isCursor = row === clampedRow && column === clampedColumn;
                const cell = cells.get(cellKey(row, column));
                return (
                  <Text key={column} inverse={isCursor} color={isCursor ? 'cyan' : undefined}>
                    {padCell(cell === undefined ? '' : cell.displayText, CELL_WIDTH)}
                  </Text>
                );
              })}
            </Box>
          ))}
        </Box>
      )}

      {editSession === undefined ? (
        <Text>
          <Text color="cyan">{cursorAddress} </Text>
          <Text color="yellow">[{KIND_BADGE[cursorKind]}] </Text>
          <Text>{cursorCell === undefined ? '(empty)' : cursorCell.displayText}</Text>
        </Text>
      ) : (
        <OdsCellEditor
          address={cursorAddress}
          initialText={editSession.seedText}
          initialKind={editSession.seedKind}
          isActive={!overlayOpen}
          onCommit={(value) => {
            dispatch({ type: 'SET_CELL_VALUE', sheetIndex, row: clampedRow, column: clampedColumn, value });
            setEditSession(undefined);
          }}
          onCancel={() => {
            setEditSession(undefined);
          }}
        />
      )}

      <Text dimColor>
        hjkl/arrows move, Enter/type to edit, p print settings, t {viewMode === 'grid' ? 'compact list' : 'grid'} view, Esc back
      </Text>
    </Box>
  );
}
