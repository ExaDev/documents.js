import { Box, Text, useInput } from 'ink';
import { useState, type ReactElement } from 'react';
import { useAppDispatch, useAppState } from '../../../state/context.js';
import { anyOverlayOpen, currentScreen } from '../../../state/types.js';
import { liveTableAt, paragraphFamilyDocument } from '../../shared/paragraph-family.js';
import { truncatePreview } from '../../shared/text.js';

const CELL_WIDTH = 16;

interface CellAddress {
  readonly row: number;
  readonly column: number;
}

// A table's own cursor is genuinely two-dimensional (row and column together), which does not fit `SelectionState`'s one-scalar-index-per-key model (`SET_SELECTION` carries a single `index: number`) -- so unlike the body list and paragraph-detail screens, this one does not record its cursor into `state.selection` at all; inventing an encoding (e.g. `row * columnCount + column`) for a shape the shared state was not designed to carry would be speculative, not a fix for a real gap. Rendered as a simple, unvirtualised 2D grid rather than through ListView: documents.js tables in practice are modest-sized, and ListView's own single-axis virtualisation does not generalise to two dimensions without reimplementing it.
//
// 'm' merges cells in this ALREADY-BUILT table (a retrofit onto a table that may have existed long before this session, or been appended plain via the body-list wizard) -- the same range-select-then-merge convention the ODS spreadsheet grid and the pptx/odp slide-table-detail screen both use: 'm' anchors the merge rectangle at the cursor, hjkl/arrows move the OPPOSITE corner, a second 'm' (or Enter) commits MERGE_TABLE_CELLS, Esc cancels a pending merge without leaving the screen.
export function TableViewScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [cursor, setCursor] = useState({ row: 0, column: 0 });
  const [mergeAnchor, setMergeAnchor] = useState<CellAddress | undefined>(undefined);

  const screen = currentScreen(state);
  const doc = paragraphFamilyDocument(state.openDocument);
  const table = screen.kind === 'tableView' && doc !== undefined ? liveTableAt(doc, screen.blockIndex) : undefined;
  const rows = table === undefined ? [] : table.rows();
  const rowCount = rows.length;
  const columnCount = rows[0]?.cells().length ?? 0;
  const clampedRow = rowCount === 0 ? 0 : Math.min(cursor.row, rowCount - 1);
  const clampedColumn = columnCount === 0 ? 0 : Math.min(cursor.column, columnCount - 1);

  const commitMerge = (anchor: CellAddress): void => {
    if (screen.kind !== 'tableView') {
      return;
    }
    const startRow = Math.min(anchor.row, clampedRow);
    const startColumn = Math.min(anchor.column, clampedColumn);
    const rowSpan = Math.abs(clampedRow - anchor.row) + 1;
    const colSpan = Math.abs(clampedColumn - anchor.column) + 1;
    dispatch({ type: 'MERGE_TABLE_CELLS', tableIndex: screen.blockIndex, startRow, startColumn, rowSpan, colSpan });
    setMergeAnchor(undefined);
  };

  useInput(
    (input, key) => {
      if (table === undefined || screen.kind !== 'tableView') {
        return;
      }
      if (key.upArrow || input === 'k') {
        setCursor({ row: Math.max(0, clampedRow - 1), column: clampedColumn });
        return;
      }
      if (key.downArrow || input === 'j') {
        setCursor({ row: rowCount === 0 ? 0 : Math.min(rowCount - 1, clampedRow + 1), column: clampedColumn });
        return;
      }
      if (key.leftArrow || input === 'h') {
        setCursor({ row: clampedRow, column: Math.max(0, clampedColumn - 1) });
        return;
      }
      if (key.rightArrow || input === 'l') {
        setCursor({ row: clampedRow, column: columnCount === 0 ? 0 : Math.min(columnCount - 1, clampedColumn + 1) });
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
      if (input === 'm' && rowCount > 0 && columnCount > 0) {
        if (mergeAnchor === undefined) {
          setMergeAnchor({ row: clampedRow, column: clampedColumn });
        } else {
          commitMerge(mergeAnchor);
        }
        return;
      }
      if (key.return && rowCount > 0 && columnCount > 0) {
        if (mergeAnchor !== undefined) {
          commitMerge(mergeAnchor);
          return;
        }
        dispatch({ type: 'PUSH_SCREEN', screen: { kind: 'tableCellDetail', blockIndex: screen.blockIndex, row: clampedRow, col: clampedColumn } });
      }
    },
    { isActive: !anyOverlayOpen(state) },
  );

  if (screen.kind !== 'tableView') {
    return <Text color="red">TableViewScreen rendered outside a tableView screen.</Text>;
  }
  if (doc === undefined) {
    return <Text color="red">TableViewScreen requires an open docx, odt or markdown document.</Text>;
  }
  if (table === undefined) {
    return <Text color="red">There is no table at index {screen.blockIndex}.</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text bold>
        Table {screen.blockIndex} ({rowCount}×{columnCount})
      </Text>
      {rows.length === 0 ? (
        <Text dimColor>This table has no rows.</Text>
      ) : (
        rows.map((row, rowIndex) => (
          <Box key={rowIndex}>
            {row.cells().map((cell, columnIndex) => {
              const isSelected = rowIndex === clampedRow && columnIndex === clampedColumn;
              const isAnchor = rowIndex === mergeAnchor?.row && columnIndex === mergeAnchor.column;
              return (
                <Box key={columnIndex} width={CELL_WIDTH} borderStyle="single" borderColor={isSelected ? 'cyan' : isAnchor ? 'yellow' : 'gray'}>
                  <Text color={isSelected ? 'cyan' : undefined} inverse={isSelected}>
                    {truncatePreview(cell.text, CELL_WIDTH - 2)}
                  </Text>
                </Box>
              );
            })}
          </Box>
        ))
      )}
      <Text dimColor>{mergeAnchor === undefined ? 'Arrows/hjkl move, Enter to edit a cell, m to anchor a merge, Esc back' : 'Arrows/hjkl to the opposite corner, m/Enter to merge, Esc to cancel'}</Text>
    </Box>
  );
}
