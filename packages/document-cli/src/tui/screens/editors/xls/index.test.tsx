import { Box, Text } from "ink";
import { render } from "ink-testing-library";
import { useEffect, useRef, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import {
  AppStateProvider,
  useAppDispatch,
  useAppState,
} from "../../../state/context.js";
import { settle, waitForFrame } from "../../../test-support.js";
import { XlsSheetListScreen, XlsSpreadsheetGridScreen } from "./index.js";

// Creates a fresh xls workbook (a real createXls() editor, seeded with one default sheet) and exposes the live sheet count and the current screen stack's top, mirroring the ods sheet-list harness exactly.
function ListHarness(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (state.openDocument === undefined) {
      dispatch({ type: "CREATE_DOCUMENT", format: "xls" });
    }
  }, [state.openDocument, dispatch]);

  if (state.openDocument?.format !== "xls") {
    return <Text>loading</Text>;
  }
  return (
    <Box flexDirection="column">
      <XlsSheetListScreen />
      <Text>sheetCount:{state.openDocument.editor.sheets().length}</Text>
      <Text>top:{state.stack.at(-1)?.kind}</Text>
    </Box>
  );
}

function renderListHarness(): ReturnType<typeof render> {
  return render(
    <AppStateProvider>
      <ListHarness />
    </AppStateProvider>,
  );
}

describe("XlsSheetListScreen", () => {
  it("renders the default sheet a freshly created workbook already carries", async () => {
    const { lastFrame } = renderListHarness();
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Sheet1"),
    );
    expect(frame).toContain("sheetCount:1");
  });

  it('adds a sheet through the "a" prompt and dispatches ADD_SHEET on submit', async () => {
    const { lastFrame, stdin } = renderListHarness();
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("sheetCount:1"),
    );
    await settle();

    stdin.write("a");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("New sheet name:"),
    );
    await settle();
    stdin.write("Ledger");
    await settle();
    stdin.write("\r");

    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("sheetCount:2"),
    );
    expect(frame).toContain("Ledger");
  });

  it("warns instead of adding a sheet when the submitted name is blank", async () => {
    const { lastFrame, stdin } = renderListHarness();
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("sheetCount:1"),
    );
    await settle();

    stdin.write("a");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("New sheet name:"),
    );
    await settle();
    stdin.write("   ");
    await settle();
    stdin.write("\r");

    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("New sheet name:"),
    );
    // The add-sheet prompt is still open and no second sheet was created.
    expect(frame).toContain("sheetCount:1");
  });

  it("cancels the add-sheet prompt on Escape without creating a sheet", async () => {
    const { lastFrame, stdin } = renderListHarness();
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("sheetCount:1"),
    );
    await settle();

    stdin.write("a");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("New sheet name:"),
    );
    await settle();
    stdin.write("\x1B");

    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Enter to open, a to add a sheet, Esc to go back"),
    );
    expect(frame).toContain("sheetCount:1");
    expect(frame).not.toContain("New sheet name:");
  });

  it("pushes the spreadsheetGrid screen for the highlighted sheet on Enter", async () => {
    const { lastFrame, stdin } = renderListHarness();
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("top:sheetList"),
    );
    await settle();

    stdin.write("\r");

    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("top:spreadsheetGrid"),
    );
  });

  it("filters the sheet list by the live search query", async () => {
    const { lastFrame, stdin } = renderListHarness();
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("sheetCount:1"),
    );
    await settle();

    stdin.write("a");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("New sheet name:"),
    );
    await settle();
    stdin.write("Budget");
    await settle();
    stdin.write("\r");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("sheetCount:2"),
    );
  });
});

// The spreadsheetGrid harness seeds a real cell at row 2/column 2 (C3) directly through XlsSheet's own cell() setter, then pushes the spreadsheetGrid screen for sheet 0 — the identical shape the ods grid harness uses. The push happens exactly once (guarded by a ref, not by re-checking `top.kind === "sheetList"` on every effect run) so that popping back to the sheet list later — which the "Escape when not mid-edit" test below exercises — does not immediately re-trigger this same setup effect and push straight back onto the grid.
function GridHarness(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = state.openDocument;
  const top = state.stack.at(-1);
  const hasPushed = useRef(false);

  useEffect(() => {
    if (doc === undefined) {
      dispatch({ type: "CREATE_DOCUMENT", format: "xls" });
      return;
    }
    if (
      doc.format === "xls" &&
      top?.kind === "sheetList" &&
      !hasPushed.current
    ) {
      hasPushed.current = true;
      const sheet = doc.editor.sheets()[0];
      if (sheet !== undefined) {
        sheet.cell(2, 2).value = { kind: "string", value: "seed" };
      }
      dispatch({
        type: "PUSH_SCREEN",
        screen: { kind: "spreadsheetGrid", sheetIndex: 0 },
      });
    }
  }, [doc, top, dispatch]);

  if (doc?.format !== "xls") {
    return <Text>loading</Text>;
  }

  return (
    <Box flexDirection="column">
      {top?.kind === "spreadsheetGrid" ? (
        <XlsSpreadsheetGridScreen sheetIndex={0} />
      ) : (
        <Text>not on the grid screen</Text>
      )}
      <Text>top:{top?.kind}</Text>
      <Text>
        originValue:{JSON.stringify(doc.editor.sheets()[0]?.cell(0, 0).value)}
      </Text>
      <Text>
        seedCellValue:{JSON.stringify(doc.editor.sheets()[0]?.cell(2, 2).value)}
      </Text>
    </Box>
  );
}

// A harness identical to GridHarness but pointed at a sheet index the workbook does not carry, to exercise the "no sheet at this index" guard.
function MissingSheetHarness(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = state.openDocument;
  const top = state.stack.at(-1);

  useEffect(() => {
    if (doc === undefined) {
      dispatch({ type: "CREATE_DOCUMENT", format: "xls" });
      return;
    }
    if (doc.format === "xls" && top?.kind === "sheetList") {
      dispatch({
        type: "PUSH_SCREEN",
        screen: { kind: "spreadsheetGrid", sheetIndex: 7 },
      });
    }
  }, [doc, top, dispatch]);

  if (doc?.format !== "xls" || top?.kind !== "spreadsheetGrid") {
    return <Text>loading</Text>;
  }

  return <XlsSpreadsheetGridScreen sheetIndex={7} />;
}

function renderGridHarness(): ReturnType<typeof render> {
  return render(
    <AppStateProvider>
      <GridHarness />
    </AppStateProvider>,
  );
}

describe("XlsSpreadsheetGridScreen", () => {
  it("renders the not-found message when the addressed sheet does not exist", async () => {
    const { lastFrame } = render(
      <AppStateProvider>
        <MissingSheetHarness />
      </AppStateProvider>,
    );
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("There is no sheet at index"),
    );
    expect(frame).toContain("7");
  });

  it("moves the cell cursor on hjkl and arrows alike, clamped at the top-left origin", async () => {
    const { lastFrame, stdin } = renderGridHarness();
    const mounted = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("A1"),
    );
    expect(mounted).toContain("top:spreadsheetGrid");
    await settle();

    stdin.write("l");
    await waitForFrame(lastFrame, (candidate) => candidate.includes("B1"));
    await settle();

    stdin.write("j");
    await waitForFrame(lastFrame, (candidate) => candidate.includes("B2"));
    await settle();

    stdin.write("h");
    await waitForFrame(lastFrame, (candidate) => candidate.includes("A2"));
    await settle();

    stdin.write("k");
    await waitForFrame(lastFrame, (candidate) => candidate.includes("A1"));
    await settle();

    // Moving up/left past the origin clamps at row/column 0 rather than going negative.
    stdin.write("k");
    await settle();
    stdin.write("h");
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("A1"),
    );
    expect(frame).toContain("A1");
  });

  it("moves the cursor with the arrow keys too", async () => {
    const { lastFrame, stdin } = renderGridHarness();
    await waitForFrame(lastFrame, (candidate) => candidate.includes("A1"));
    await settle();

    stdin.write("[C"); // right arrow
    await waitForFrame(lastFrame, (candidate) => candidate.includes("B1"));
    await settle();

    stdin.write("[B"); // down arrow
    await waitForFrame(lastFrame, (candidate) => candidate.includes("B2"));
    await settle();

    stdin.write("[D"); // left arrow
    await waitForFrame(lastFrame, (candidate) => candidate.includes("A2"));
    await settle();

    stdin.write("[A"); // up arrow
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("A1"),
    );
    expect(frame).toContain("A1");
  });

  it("renders a double-letter column address once the cursor passes column Z", async () => {
    const { lastFrame, stdin } = renderGridHarness();
    await waitForFrame(lastFrame, (candidate) => candidate.includes("A1"));
    await settle();

    for (let i = 0; i < 26; i++) {
      stdin.write("l");
      await settle();
    }

    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("AA1"),
    );
    expect(frame).toContain("AA1");
  });

  it("starts an edit on Enter seeded from an existing cell's text and kind, and commits back into the real XlsCell", async () => {
    const { lastFrame, stdin } = renderGridHarness();
    await waitForFrame(lastFrame, (candidate) => candidate.includes("A1"));
    await settle();

    // Move to C3 (row 2, column 2), the cell the harness seeded with a string value.
    stdin.write("l");
    await settle();
    stdin.write("l");
    await settle();
    stdin.write("j");
    await settle();
    stdin.write("j");
    await settle();

    const beforeEdit = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("C3"),
    );
    expect(beforeEdit).toContain("seed");

    stdin.write("\r");
    const editing = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("[S]"),
    );
    expect(editing).toContain("seed");
    await settle();

    stdin.write("!");
    await settle();
    stdin.write("\r");

    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes('seedCellValue:{"kind":"string","value":"seed!"}'),
    );
    expect(frame).not.toContain("[S]");
  });

  it("starts an edit on Enter seeded with the empty kind when the cursor is over a cell with no value yet", async () => {
    const { lastFrame, stdin } = renderGridHarness();
    await waitForFrame(lastFrame, (candidate) => candidate.includes("A1"));
    await settle();

    stdin.write("\r");
    const editing = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Enter to commit"),
    );
    expect(editing).toContain("[.]");
    await settle();

    // Tab cycles the kind override off 'empty' onto 'number', the second entry in CELL_VALUE_KINDS.
    stdin.write("\t");
    await waitForFrame(lastFrame, (candidate) => candidate.includes("[N]"));
    await settle();

    stdin.write("9");
    await settle();
    stdin.write("\r");

    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes('originValue:{"kind":"number","value":9}'),
    );
    expect(frame).not.toContain("Enter to commit");
  });

  it("cancels an in-progress edit on Escape without touching the document", async () => {
    const { lastFrame, stdin } = renderGridHarness();
    await waitForFrame(lastFrame, (candidate) => candidate.includes("A1"));
    await settle();

    stdin.write("\r");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Enter to commit"),
    );
    await settle();

    stdin.write("\x1B");
    const frame = await waitForFrame(
      lastFrame,
      (candidate) => !candidate.includes("Enter to commit"),
    );
    expect(frame).toContain("top:spreadsheetGrid");
    expect(frame).toContain('originValue:{"kind":"empty"}');
  });

  it("pops the screen on Escape when not mid-edit", async () => {
    const { lastFrame, stdin } = renderGridHarness();
    await waitForFrame(lastFrame, (candidate) => candidate.includes("A1"));
    await settle();

    stdin.write("\x1B");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("top:sheetList"),
    );
  });

  it('switches to the compact non-empty-cells list on "t" and back to the grid', async () => {
    const { lastFrame, stdin } = renderGridHarness();
    await waitForFrame(lastFrame, (candidate) => candidate.includes("A1"));
    await settle();

    stdin.write("t");
    const compactFrame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("non-empty cells"),
    );
    expect(compactFrame).toContain("C3");
    expect(compactFrame).toContain("seed");
    await settle();

    stdin.write("t");
    await waitForFrame(lastFrame, (candidate) => candidate.includes("A1"));
  });

  it("shows the empty-sheet message in the compact view when no cell carries a value", async () => {
    function EmptyGridHarness(): ReactElement {
      const state = useAppState();
      const dispatch = useAppDispatch();
      const doc = state.openDocument;
      const top = state.stack.at(-1);

      useEffect(() => {
        if (doc === undefined) {
          dispatch({ type: "CREATE_DOCUMENT", format: "xls" });
          return;
        }
        if (doc.format === "xls" && top?.kind === "sheetList") {
          dispatch({
            type: "PUSH_SCREEN",
            screen: { kind: "spreadsheetGrid", sheetIndex: 0 },
          });
        }
      }, [doc, top, dispatch]);

      if (doc?.format !== "xls" || top?.kind !== "spreadsheetGrid") {
        return <Text>loading</Text>;
      }
      return <XlsSpreadsheetGridScreen sheetIndex={0} />;
    }

    const { lastFrame, stdin } = render(
      <AppStateProvider>
        <EmptyGridHarness />
      </AppStateProvider>,
    );
    await waitForFrame(lastFrame, (candidate) => candidate.includes("A1"));
    await settle();

    stdin.write("t");
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("No cells carry a value yet."),
    );
    expect(frame).toContain("non-empty cells (0)");
  });
});
