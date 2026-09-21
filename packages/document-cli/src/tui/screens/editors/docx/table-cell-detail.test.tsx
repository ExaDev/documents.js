import { Box, Text } from "ink";
import { render } from "ink-testing-library";
import { useEffect, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import {
  AppStateProvider,
  useAppDispatch,
  useAppState,
} from "../../../state/context.js";
import { currentScreen } from "../../../state/types.js";
import { waitForFrame } from "../../../test-support.js";
import { TableCellDetailScreen } from "./table-cell-detail.js";

const ANCHOR_TEXT = "anchor";
const PAST_MERGE_TEXT = "past the merge";

// Lands on the cell-detail screen for one grid position of a 2x3 table whose first row already holds a horizontal merge of grid columns 0 and 1, with text written into the merge's anchor and into the cell past it, so the frame shows which cell the position resolved to.
function CellDetailHarness({
  format,
  column,
}: {
  readonly format: "docx" | "odt";
  readonly column: number;
}): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = state.openDocument;
  const screen = currentScreen(state);

  useEffect(() => {
    if (doc === undefined) {
      dispatch({ type: "CREATE_DOCUMENT", format });
      return;
    }
    if (doc.format === format && screen.kind === "bodyList") {
      dispatch({
        type: "APPEND_TABLE",
        rows: 2,
        columns: 3,
        merge: { startRow: 0, startColumn: 0, rowSpan: 1, colSpan: 2 },
      });
      dispatch({
        type: "SET_TABLE_CELL_TEXT",
        tableIndex: 0,
        row: 0,
        column: 0,
        text: ANCHOR_TEXT,
      });
      dispatch({
        type: "SET_TABLE_CELL_TEXT",
        tableIndex: 0,
        row: 0,
        column: 2,
        text: PAST_MERGE_TEXT,
      });
      dispatch({
        type: "PUSH_SCREEN",
        screen: { kind: "tableCellDetail", blockIndex: 0, row: 0, col: column },
      });
    }
  }, [doc, screen, format, column, dispatch]);

  if (doc?.format !== format || screen.kind !== "tableCellDetail") {
    return <Text>loading</Text>;
  }
  return (
    <Box>
      <TableCellDetailScreen />
    </Box>
  );
}

describe.each(["docx", "odt"] as const)(
  "TableCellDetailScreen on a merged %s table",
  (format) => {
    it.each([
      [0, ANCHOR_TEXT],
      [1, ANCHOR_TEXT],
      [2, PAST_MERGE_TEXT],
    ])("shows the owner of grid column %i", async (column, expectedText) => {
      const { lastFrame } = render(
        <AppStateProvider>
          <CellDetailHarness format={format} column={column} />
        </AppStateProvider>,
      );
      const frame = await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("Table 0, cell"),
      );
      expect(frame).toContain(`cell (0, ${column})`);
      expect(frame).toContain(expectedText);
    });

    it("reports a grid column beyond the table's width as having no cell", async () => {
      const { lastFrame } = render(
        <AppStateProvider>
          <CellDetailHarness format={format} column={3} />
        </AppStateProvider>,
      );
      const frame = await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("There is no cell"),
      );
      expect(frame).toContain("row 0, column 3");
    });
  },
);
