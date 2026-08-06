import { cellReference, columnIndexToLetters, type ContentCellValue } from 'documents.js';
import { Box, Text, useInput, useWindowSize } from 'ink';
import { useState, type Dispatch, type ReactElement } from 'react';
import { describeError } from '../../../errors.js';
import { readInput } from '../../../../runtime/io.js';
import { ListView } from '../../../components/list-view.js';
import { TextField } from '../../../components/text-field.js';
import { useNavigationInput } from '../../../keybindings/use-navigation-input.js';
import type { Action } from '../../../state/actions.js';
import { useAppDispatch, useAppState } from '../../../state/context.js';
import { anyOverlayOpen, currentScreen } from '../../../state/types.js';
import { FieldWizard, requireFieldValue, type FieldSpec } from '../../shared/field-wizard.js';
import { parseNumberField } from '../../shared/text.js';
import { OdsCellEditor } from './cell-detail.js';
import { cellKey, cellLookup, inferKind, KIND_BADGE, odsDocument, rawEditableText, resolveSheet, sheetExtent } from './shared.js';

const ROW_HEADER_WIDTH = 5;
const CELL_WIDTH = 11;
const PAGE_JUMP_ROWS = 10;
// Wide enough for the longest address a compact-list row is likely to show (e.g. "AA100") plus a space.
const COMPACT_ADDRESS_WIDTH = 8;
// This screen's own chrome beyond ListView's default reserved-rows count: a title line, a column-header line, the cell-info line below the grid, one hint line, and the app shell's StatusLine underneath everything -- the compact list view reuses this same figure via ListView's `reservedRows`.
const GRID_CHROME_ROWS = 5;

// 'h'/'j'/'k'/'l' move the cursor, 'p'/'t' open print settings / toggle the compact view, 'm' anchors/commits a range-select merge, 'f' opens formula editing, and 'i' opens the floating-image wizard -- all nine are claimed before the printable-character check below, so none of them can seed a type-to-edit. A real, honest, vim-shaped limitation: reach the editor with Enter first, then those letters type as ordinary characters like any other.
const RESERVED_LETTERS: ReadonlySet<string> = new Set(['h', 'j', 'k', 'l', 'p', 't', 'm', 'f', 'i']);

const IMAGE_EXTENSION_TO_FORMAT: Readonly<Record<string, 'png' | 'jpeg'>> = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg' };

function inferSheetImageFormat(path: string): 'png' | 'jpeg' | undefined {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return IMAGE_EXTENSION_TO_FORMAT[extension];
}

// The sheet-image wizard's own field list -- unlike ADD_TEXTBOX/ADD_IMAGE's page-absolute frame, a spreadsheet floating image is anchored to a cell (see documents.js's own OdsSheet.addImage doc comment), so the anchor row/column come from the grid's own current cursor position (see applyAddSheetImage below) rather than being fields a caller types in here; only the cell-relative offset, the rendered size, and alt text are collected.
const SHEET_IMAGE_FIELDS: readonly FieldSpec[] = [
  { key: 'path', label: 'Image file path (.png/.jpg/.jpeg)', defaultValue: '' },
  { key: 'widthPt', label: 'Width (pt)', defaultValue: '100' },
  { key: 'heightPt', label: 'Height (pt)', defaultValue: '60' },
  { key: 'offsetXPt', label: 'Offset X from anchor cell (pt)', defaultValue: '0' },
  { key: 'offsetYPt', label: 'Offset Y from anchor cell (pt)', defaultValue: '0' },
  { key: 'altText', label: 'Alt text, blank for none', defaultValue: '' },
];

// The one async step (reading the image file off disk) is why this whole function is async, matching paragraph-detail.tsx's/odg's own applyInsertImage/applyAddKind for the identical reason.
async function applyAddSheetImage(sheetIndex: number, anchorRow: number, anchorColumn: number, values: Readonly<Record<string, string>>, dispatch: Dispatch<Action>): Promise<void> {
  const path = requireFieldValue(values, 'path');
  const format = inferSheetImageFormat(path);
  if (format === undefined) {
    dispatch({ type: 'SET_STATUS', severity: 'warning', text: `${path} is not a .png or .jpg/.jpeg file -- image not added` });
    return;
  }
  try {
    const bytes = new Uint8Array(await readInput(path));
    const widthPt = parseNumberField(requireFieldValue(values, 'widthPt'), 100);
    const heightPt = parseNumberField(requireFieldValue(values, 'heightPt'), 60);
    const offsetXPt = parseNumberField(requireFieldValue(values, 'offsetXPt'), 0);
    const offsetYPt = parseNumberField(requireFieldValue(values, 'offsetYPt'), 0);
    const altTextRaw = requireFieldValue(values, 'altText').trim();
    dispatch({ type: 'ADD_SHEET_IMAGE', sheetIndex, anchorRow, anchorColumn, offsetXPt, offsetYPt, format, bytes, widthPt, heightPt, altText: altTextRaw.length === 0 ? undefined : altTextRaw });
  } catch (error) {
    dispatch({ type: 'SET_STATUS', severity: 'error', text: `Could not read ${path}: ${describeError(error)}` });
  }
}

interface EditSession {
  readonly seedText: string;
  readonly seedKind: ContentCellValue['kind'];
}

interface CellAddress {
  readonly row: number;
  readonly column: number;
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
  const [mergeAnchor, setMergeAnchor] = useState<CellAddress | undefined>(undefined);
  // Formula editing is a genuinely separate edit mode from `editSession` above, not a variant of it -- a real ODF cell carries a formula and a typed value as two independent, coexisting attributes (see actions.ts's own SET_CELL_FORMULA doc comment), so this never reuses the value-kind-cycle UI OdsCellEditor drives.
  const [formulaEditing, setFormulaEditing] = useState(false);
  const [formulaDraft, setFormulaDraft] = useState('');
  const [imageWizardOpen, setImageWizardOpen] = useState(false);

  const { columns: terminalColumns, rows: terminalRows } = useWindowSize();

  const sheet = resolveSheet(doc.editor, sheetIndex);
  const { rowCount, columnCount } = sheetExtent(sheet);
  const cells = cellLookup(sheet);

  const clampedRow = Math.min(cursorRow, rowCount - 1);
  const clampedColumn = Math.min(cursorColumn, columnCount - 1);

  const overlayOpen = anyOverlayOpen(state);
  const editing = editSession !== undefined;
  const editingAnything = editing || formulaEditing || imageWizardOpen;

  function moveCursor(deltaRow: number, deltaColumn: number): void {
    setCursorRow((row) => Math.min(Math.max(row + deltaRow, 0), rowCount - 1));
    setCursorColumn((column) => Math.min(Math.max(column + deltaColumn, 0), columnCount - 1));
  }

  function beginEdit(seedText: string, seedKind: ContentCellValue['kind']): void {
    setEditSession({ seedText, seedKind });
  }

  // Commits the rectangle between `anchor` and the current cursor cell (whichever corner is which -- 'm' can be pressed anywhere relative to the anchor) as a real MERGE_CELLS dispatch, then clears the pending anchor.
  function commitMerge(anchor: CellAddress): void {
    const startRow = Math.min(anchor.row, clampedRow);
    const startColumn = Math.min(anchor.column, clampedColumn);
    const rowSpan = Math.abs(clampedRow - anchor.row) + 1;
    const colSpan = Math.abs(clampedColumn - anchor.column) + 1;
    dispatch({ type: 'MERGE_CELLS', sheetIndex, startRow, startColumn, rowSpan, colSpan });
    setMergeAnchor(undefined);
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
    { isActive: !overlayOpen && !editingAnything },
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
        if (mergeAnchor !== undefined) {
          setMergeAnchor(undefined);
          return;
        }
        dispatch({ type: 'POP_SCREEN' });
        return;
      }
      if (input === 'm') {
        if (mergeAnchor === undefined) {
          setMergeAnchor({ row: clampedRow, column: clampedColumn });
        } else {
          commitMerge(mergeAnchor);
        }
        return;
      }
      if (input === 'f') {
        const cell = cells.get(cellKey(clampedRow, clampedColumn));
        setFormulaDraft(cell?.formula ?? '');
        setFormulaEditing(true);
        return;
      }
      if (input === 'i') {
        setImageWizardOpen(true);
        return;
      }
      if (key.return) {
        if (mergeAnchor !== undefined) {
          commitMerge(mergeAnchor);
          return;
        }
        const cell = cells.get(cellKey(clampedRow, clampedColumn));
        const seedKind: ContentCellValue['kind'] = cell === undefined || cell.value.kind === 'empty' ? 'string' : cell.value.kind;
        beginEdit(cell === undefined ? '' : rawEditableText(cell.value), seedKind);
        return;
      }
      if (input.length === 1 && !key.ctrl && !key.meta && !RESERVED_LETTERS.has(input)) {
        beginEdit(input, inferKind(input));
      }
    },
    { isActive: !overlayOpen && !editingAnything && viewMode === 'grid' },
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
              address: cellReference(cell.row, cell.column),
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
  const cursorAddress = cellReference(clampedRow, clampedColumn);
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
                const isAnchor = row === mergeAnchor?.row && column === mergeAnchor?.column;
                const cell = cells.get(cellKey(row, column));
                return (
                  <Text key={column} inverse={isCursor} color={isCursor ? 'cyan' : isAnchor ? 'yellow' : undefined}>
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

      {formulaEditing ? (
        <Box>
          <Text color="cyan">{cursorAddress} formula: </Text>
          <TextField
            value={formulaDraft}
            isFocused={!overlayOpen}
            placeholder="e.g. of:=[.A1]+[.A2]"
            onChange={setFormulaDraft}
            onSubmit={(value) => {
              const trimmed = value.trim();
              dispatch({ type: 'SET_CELL_FORMULA', sheetIndex, row: clampedRow, column: clampedColumn, formula: trimmed.length === 0 ? undefined : trimmed });
              setFormulaEditing(false);
            }}
            onCancel={() => {
              setFormulaEditing(false);
            }}
          />
        </Box>
      ) : undefined}

      {imageWizardOpen ? (
        <FieldWizard
          fields={SHEET_IMAGE_FIELDS}
          onCancel={() => {
            setImageWizardOpen(false);
          }}
          onComplete={(values) => {
            void applyAddSheetImage(sheetIndex, clampedRow, clampedColumn, values, dispatch).then(() => {
              setImageWizardOpen(false);
            });
          }}
        />
      ) : undefined}

      <Text dimColor>
        {mergeAnchor === undefined
          ? `hjkl/arrows move, Enter/type to edit, m to anchor a merge, p print settings, t ${viewMode === 'grid' ? 'compact list' : 'grid'} view, f formula, i image, Esc back`
          : 'hjkl/arrows to the opposite corner, m/Enter to merge, Esc to cancel'}
      </Text>
    </Box>
  );
}
