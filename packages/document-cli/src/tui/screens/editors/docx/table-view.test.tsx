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

// Reads the anchor cell's own colSpan/rowSpan fresh through readDocxContent/readOdtContent on every render -- TableViewScreen's own DocxTableCell/OdtTableCell.text getter tells us nothing about a merge, so this probe is how these tests observe the real MERGE_TABLE_CELLS mutation the reducer applied.
function AnchorSpanProbe({
  format,
}: {
  readonly format: "docx" | "odt";
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
    tableBlock?.kind === "table" ? tableBlock.rows[0]?.cells[0] : undefined;
  return (
    <Text>
      anchorSpan:{anchor?.colSpan ?? 1}x{anchor?.rowSpan ?? 1}
    </Text>
  );
}

// Builds a 3x3 table via a real APPEND_TABLE dispatch (no merge field -- the plain creation path) and lands on tableView for it, so these tests exercise MERGE_TABLE_CELLS as a genuine RETROFIT onto an already-built table, distinct from paragraph-family.test.tsx's own creation-time-merge coverage.
function TableViewHarness({
  format,
}: {
  readonly format: "docx" | "odt";
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
      dispatch({ type: "APPEND_TABLE", rows: 3, columns: 3 });
      dispatch({
        type: "PUSH_SCREEN",
        screen: { kind: "tableView", blockIndex: 0 },
      });
    }
  }, [doc, screen, format, dispatch]);

  if (doc?.format !== format || screen.kind !== "tableView") {
    return <Text>loading</Text>;
  }

  return (
    <Box flexDirection="column">
      <TableViewScreen />
      <AnchorSpanProbe format={format} />
    </Box>
  );
}

function renderHarness(format: "docx" | "odt"): ReturnType<typeof render> {
  return render(
    <AppStateProvider>
      <TableViewHarness format={format} />
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
