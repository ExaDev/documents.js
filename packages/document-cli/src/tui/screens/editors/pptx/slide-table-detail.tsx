import { Box, Text, useInput } from 'ink';
import { useState, type ReactElement } from 'react';
import { useAppDispatch, useAppState } from '../../../state/context.js';
import { anyOverlayOpen, type Screen } from '../../../state/types.js';
import { assertPresentationDocument } from '../../shared/slide-family.js';
import { resolveSlideTable, slideTableCellText } from '../../shared/slide-table.js';
import { truncatePreview } from '../../shared/text.js';

export interface SlideTableDetailScreenProps {
  readonly screen: Extract<Screen, { kind: 'slideTableDetail' }>;
}

const CELL_WIDTH = 16;

interface Cursor {
  readonly row: number;
  readonly column: number;
}

// A slide table's own cursor is genuinely two-dimensional, exactly like docx/odt's own table-view.tsx (see that screen's doc comment for why this stays outside SelectionState rather than a single SET_SELECTION index) -- and this screen borrows that one's rendering shape wholesale (a simple, unvirtualised bordered grid). What is new here is the merge-anchor flow, lifted from the ODS spreadsheet grid's own range-select-then-merge convention: 'm' anchors the merge rectangle at the current cursor cell; hjkl/arrows then move the OPPOSITE corner; a second 'm' (or Enter) commits MERGE_SLIDE_TABLE_CELLS for the rectangle between the two; Esc cancels a pending merge without leaving the screen (and only pops the screen once no merge is pending).
export function SlideTableDetailScreen(props: SlideTableDetailScreenProps): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = assertPresentationDocument(state.openDocument);
  const { slideIndex, tableIndex } = props.screen;

  const [cursor, setCursor] = useState<Cursor>({ row: 0, column: 0 });
  const [mergeAnchor, setMergeAnchor] = useState<Cursor | undefined>(undefined);

  const table = resolveSlideTable(doc, slideIndex, tableIndex);
  const rows = table?.rows ?? [];
  const rowCount = rows.length;
  const columnCount = rows[0]?.cells.length ?? 0;
  const clampedRow = rowCount === 0 ? 0 : Math.min(cursor.row, rowCount - 1);
  const clampedColumn = columnCount === 0 ? 0 : Math.min(cursor.column, columnCount - 1);

  const commitMerge = (anchor: Cursor): void => {
    const startRow = Math.min(anchor.row, clampedRow);
    const startColumn = Math.min(anchor.column, clampedColumn);
    const rowSpan = Math.abs(clampedRow - anchor.row) + 1;
    const colSpan = Math.abs(clampedColumn - anchor.column) + 1;
    dispatch({ type: 'MERGE_SLIDE_TABLE_CELLS', slideIndex, tableIndex, startRow, startColumn, rowSpan, colSpan });
    setMergeAnchor(undefined);
  };

  useInput(
    (input, key) => {
      if (table === undefined) {
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
      if (input === 'm' || key.return) {
        if (mergeAnchor === undefined) {
          setMergeAnchor({ row: clampedRow, column: clampedColumn });
          return;
        }
        commitMerge(mergeAnchor);
      }
    },
    { isActive: !anyOverlayOpen(state) },
  );

  if (table === undefined) {
    return (
      <Box flexDirection="column">
        <Text bold>
          Slide {slideIndex + 1}, table {tableIndex + 1}
        </Text>
        <Text color="yellow">This table no longer exists -- press Esc to go back</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>
        Slide {slideIndex + 1}, table {tableIndex + 1} ({rowCount}x{columnCount})
      </Text>
      {rows.length === 0 ? (
        <Text dimColor>This table has no rows.</Text>
      ) : (
        rows.map((row, rowIndex) => (
          <Box key={rowIndex}>
            {row.cells.map((cell, columnIndex) => {
              const isCursor = rowIndex === clampedRow && columnIndex === clampedColumn;
              const isAnchor = rowIndex === mergeAnchor?.row && columnIndex === mergeAnchor.column;
              return (
                <Box key={columnIndex} width={CELL_WIDTH} borderStyle="single" borderColor={isCursor ? 'cyan' : isAnchor ? 'yellow' : 'gray'}>
                  <Text color={isCursor ? 'cyan' : undefined} inverse={isCursor}>
                    {truncatePreview(slideTableCellText(cell), CELL_WIDTH - 2)}
                  </Text>
                </Box>
              );
            })}
          </Box>
        ))
      )}
      <Text dimColor>{mergeAnchor === undefined ? 'Arrows/hjkl move, m to anchor a merge, Esc back' : 'Arrows/hjkl to the opposite corner, m/Enter to merge, Esc to cancel'}</Text>
    </Box>
  );
}
