import { readDocxContent, readOdtContent } from "documents.js";
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
import { settle, waitForFrame } from "../../../test-support.js";
import { TableViewScreen } from "./table-view.js";

// The merge rectangle APPEND_TABLE can carry, so a test can start from a table that is already merged.
interface TableMerge {
  readonly startRow: number;
  readonly startColumn: number;
  readonly rowSpan: number;
  readonly colSpan: number;
}

// Reads the anchor cell's own colSpan/rowSpan fresh through readDocxContent/readOdtContent on every render -- TableViewScreen's own DocxTableCell/OdtTableCell.text getter tells us nothing about a merge, so this probe is how these tests observe the real MERGE_TABLE_CELLS mutation the reducer applied.
function AnchorSpanProbe({
  format,
  column,
}: {
  readonly format: "docx" | "odt";
  readonly column: number;
}): ReactElement {
  const state = useAppState();
  const doc = state.openDocument;
  if (doc === undefined || (doc.format !== "docx" && doc.format !== "odt")) {
    return <Text> </Text>;
  }
  const content =
    format === "docx"
      ? readDocxContent(doc.editor.toPackage())
      : readOdtContent(doc.editor.toPackage());
  if (content.kind !== "wordprocessing") {
    throw new Error(
      `expected a wordprocessing ContentDocument, got ${content.kind}`,
    );
  }
  const tableBlock = content.sections[0]?.blocks[0];
  const anchor =
    tableBlock?.kind === "table"
      ? tableBlock.rows[0]?.cells[column]
      : undefined;
  return (
    <Text>
      anchorSpan:{anchor?.colSpan ?? 1}x{anchor?.rowSpan ?? 1}
    </Text>
  );
}

// Builds a 3x3 table via a real APPEND_TABLE dispatch (no merge field -- the plain creation path) and lands on tableView for it, so these tests exercise MERGE_TABLE_CELLS as a genuine RETROFIT onto an already-built table, distinct from paragraph-family.test.tsx's own creation-time-merge coverage.
function TableViewHarness({
  format,
  merge,
  probeColumn,
  anchorText,
}: {
  readonly format: "docx" | "odt";
  readonly merge: TableMerge | undefined;
  readonly probeColumn: number;
  readonly anchorText: string | undefined;
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
      dispatch({ type: "APPEND_TABLE", rows: 3, columns: 3, merge });
      if (anchorText !== undefined) {
        dispatch({
          type: "SET_TABLE_CELL_TEXT",
          tableIndex: 0,
          row: 0,
          column: 0,
          text: anchorText,
        });
      }
      dispatch({
        type: "PUSH_SCREEN",
        screen: { kind: "tableView", blockIndex: 0 },
      });
    }
  }, [doc, screen, format, merge, anchorText, dispatch]);

  if (doc?.format !== format || screen.kind !== "tableView") {
    return <Text>loading</Text>;
  }

  return (
    <Box flexDirection="column">
      <TableViewScreen />
      <AnchorSpanProbe format={format} column={probeColumn} />
    </Box>
  );
}

function renderHarness(
  format: "docx" | "odt",
  merge?: TableMerge,
  probeColumn = 0,
  anchorText?: string,
): ReturnType<typeof render> {
  return render(
    <AppStateProvider>
      <TableViewHarness
        format={format}
        merge={merge}
        probeColumn={probeColumn}
        anchorText={anchorText}
      />
    </AppStateProvider>,
  );
}

describe.each(["docx", "odt"] as const)(
  "TableViewScreen retrofit merge on %s",
  (format) => {
    it("merges a real rectangle of cells in an already-built table via m-to-anchor, move, m-to-commit", async () => {
      const { lastFrame, stdin } = renderHarness(format);
      let frame = await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("Table 0"),
      );
      expect(frame).toContain("anchorSpan:1x1");
      await settle();

      stdin.write("m");
      frame = await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("m/Enter to merge"),
      );
      expect(frame).not.toContain("to anchor a merge");
      await settle();

      stdin.write("l");
      await settle();
      stdin.write("j");
      await settle();

      stdin.write("m");
      frame = await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("anchorSpan:2x2"),
      );
      expect(frame).toContain("to anchor a merge");
    });

    it("cancels a pending merge on Escape without touching the document", async () => {
      const { lastFrame, stdin } = renderHarness(format);
      await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("anchorSpan:1x1"),
      );
      await settle();

      stdin.write("m");
      await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("m/Enter to merge"),
      );
      await settle();

      stdin.write("\x1B");
      const frame = await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("to anchor a merge"),
      );
      expect(frame).toContain("anchorSpan:1x1");
      expect(frame).toContain("Table 0");
    });
  },
);

// A 3x3 table whose first row already holds a horizontal merge of grid columns 0 and 1: that row has two physical cells but the table has three grid columns.
const FIRST_ROW_MERGE: TableMerge = {
  startRow: 0,
  startColumn: 0,
  rowSpan: 1,
  colSpan: 2,
};

describe.each(["docx", "odt"] as const)(
  "TableViewScreen on a table with a horizontal merge on %s",
  (format) => {
    it("titles the table by its grid width, not by the merged row's physical cell count", async () => {
      const { lastFrame } = renderHarness(format, FIRST_ROW_MERGE);
      const frame = await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("Table 0"),
      );
      expect(frame).toContain("Table 0 (3×3)");
    });

    it("draws one box per grid column in every row, the merged row included", async () => {
      const { lastFrame } = renderHarness(format, FIRST_ROW_MERGE);
      const frame = await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("Table 0"),
      );
      // Nine boxes: each has a top border, and three of them per row.
      expect(frame.match(/┌/g)).toHaveLength(9);
    });

    it("draws a merged region's text once, at its anchor, and leaves the positions it covers empty", async () => {
      const { lastFrame } = renderHarness(format, FIRST_ROW_MERGE, 0, "anchor");
      const frame = await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("anchor"),
      );
      const textRow = frame.split("\n").find((line) => line.includes("anchor"));
      // The anchor's box, then the covered box (blank), then the unmerged cell's box, which shows the empty-cell placeholder.
      expect(textRow).toMatch(/│anchor\s+││\s+││\(empty\)\s+│/u);
      expect(frame.match(/│anchor/gu)).toHaveLength(1);
    });

    it("truncates a long anchor text to the width of one box", async () => {
      const { lastFrame } = renderHarness(
        format,
        FIRST_ROW_MERGE,
        0,
        "abcdefghijklmnopqrstuvwxyz",
      );
      const frame = await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("abcdef"),
      );
      // A box is 16 columns wide, of which the two borders take two, so the text is cut to 14 columns with an ellipsis as the last.
      expect(frame).toContain("│abcdefghijklm…│");
    });

    it("lets the cursor reach the grid column beyond the merge, and merges from there", async () => {
      const { lastFrame, stdin } = renderHarness(format, FIRST_ROW_MERGE, 2);
      await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("anchorSpan:1x1"),
      );
      await settle();

      // Grid column 2 is the merged row's second physical cell. The cursor moving right twice must land on it, and a merge anchored there and extended one row down must state a rowSpan of 2 on the cell at grid column 2.
      stdin.write("l");
      await settle();
      stdin.write("l");
      await settle();
      stdin.write("m");
      await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("m/Enter to merge"),
      );
      await settle();
      stdin.write("j");
      await settle();
      stdin.write("m");
      const frame = await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("anchorSpan:1x2"),
      );
      expect(frame).toContain("Table 0 (3×3)");
    });

    it("leaves the document unchanged when a merge is anchored inside an existing merged region", async () => {
      // The cursor on grid column 1 lies inside the merged cell that starts at grid column 0: anchoring a merge there is refused, and the document stays as it was.
      const { lastFrame, stdin } = renderHarness(format, FIRST_ROW_MERGE);
      await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("anchorSpan:2x1"),
      );
      await settle();

      stdin.write("l");
      await settle();
      stdin.write("m");
      await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("m/Enter to merge"),
      );
      await settle();
      stdin.write("l");
      await settle();
      stdin.write("m");
      const frame = await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("to anchor a merge"),
      );
      expect(frame).toContain("anchorSpan:2x1");
    });
  },
);
