import { Box, Text } from "ink";
import { render } from "ink-testing-library";
import { useEffect, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import {
  AppStateProvider,
  useAppDispatch,
  useAppState,
} from "../../../state/context.js";
import { settle, waitForFrame } from "../../../test-support.js";
import { OdsSheetListScreen } from "./sheet-list.js";

// Creates a fresh ods workbook on mount (a real createOds() editor, seeded with one default sheet -- confirmed by running it directly against the installed package) and exposes two probes: the live sheet count and the current screen stack's top, so tests can assert on real reducer/editor state rather than only on rendered text.
function Harness(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (state.openDocument === undefined) {
      dispatch({ type: "CREATE_DOCUMENT", format: "ods" });
    }
  }, [state.openDocument, dispatch]);

  if (state.openDocument?.format !== "ods") {
    return <Text>loading</Text>;
  }
  return (
    <Box flexDirection="column">
      <OdsSheetListScreen />
      <Text>sheetCount:{state.openDocument.editor.sheets().length}</Text>
      <Text>top:{state.stack.at(-1)?.kind}</Text>
    </Box>
  );
}

function renderHarness(): ReturnType<typeof render> {
  return render(
    <AppStateProvider>
      <Harness />
    </AppStateProvider>,
  );
}

describe("OdsSheetListScreen", () => {
  it("renders the default sheet a freshly created workbook already carries", async () => {
    const { lastFrame } = renderHarness();
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Sheet1"),
    );
    expect(frame).toContain("sheetCount:1");
  });

  it('adds a sheet through the "a" prompt and dispatches ADD_SHEET on submit', async () => {
    const { lastFrame, stdin } = renderHarness();
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("sheetCount:1"),
    );
    await settle();

    stdin.write("a");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("New sheet name:"),
    );
    // The add-sheet TextField has just mounted for the first time -- see test-support.ts's own comment for why its input needs a settled tick before it reliably receives keystrokes, and between each of its own writes.
    await settle();
    stdin.write("Budget");
    await settle();
    stdin.write("\r");

    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("sheetCount:2"),
    );
    expect(frame).toContain("Budget");
  });

  it("pushes the spreadsheetGrid screen for the highlighted sheet on Enter", async () => {
    const { lastFrame, stdin } = renderHarness();
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("top:sheetList"),
    );
    await settle();

    stdin.write("\r");

    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("top:spreadsheetGrid"),
    );
  });
});
