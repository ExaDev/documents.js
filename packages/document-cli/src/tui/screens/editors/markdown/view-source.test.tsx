import { openMarkdown } from "documents.js";
import { Text } from "ink";
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
import { MarkdownViewSourceScreen } from "./view-source.js";

const ESCAPE_KEY = "\x1B";

const ORIGINAL_TEXT = "# Title\n\nOriginal paragraph.\n";

// Opens a real markdown document AND edits it AND pushes viewSource in a single effect, matching odt/list-editor.test.tsx's own OpenAtListEditor convention. The edit (APPEND_PARAGRAPH) happens through the exact same generic reducer action docx/odt use -- this is deliberately not a hand-built MarkdownOpenDocument with a pre-edited editor, since the point of this test is that `originalText` and the live `editor` are genuinely decoupled once a real edit has been dispatched.
function OpenEditAndViewSource(): ReactElement | undefined {
  const dispatch = useAppDispatch();
  useEffect(() => {
    dispatch({
      type: "OPEN_FILE_SUCCESS",
      path: "notes.md",
      doc: {
        format: "markdown",
        editor: openMarkdown(ORIGINAL_TEXT),
        originalText: ORIGINAL_TEXT,
        path: "notes.md",
      },
    });
    dispatch({
      type: "APPEND_PARAGRAPH",
      text: "New paragraph",
      styleId: undefined,
      alignment: undefined,
    });
    dispatch({ type: "PUSH_SCREEN", screen: { kind: "viewSource" } });
  }, [dispatch]);
  return undefined;
}

// Gated purely on `state.openDocument === undefined`, not on screen kind -- OpenEditAndViewSource must only ever mount ONCE. Gating on screen kind too (re-rendering it whenever `screen.kind !== 'viewSource'`) would remount it the instant Escape pops viewSource off the stack, re-running its effect and immediately re-dispatching OPEN_FILE_SUCCESS/APPEND_PARAGRAPH/PUSH_SCREEN, undoing the very pop the Escape test below means to observe.
function Harness(): ReactElement {
  const state = useAppState();
  if (state.openDocument === undefined) {
    return <OpenEditAndViewSource />;
  }
  const screen = currentScreen(state);
  if (screen.kind === "viewSource") {
    return <MarkdownViewSourceScreen />;
  }
  return <Text>popped back to {screen.kind}</Text>;
}

function renderViewSource(): ReturnType<typeof render> {
  return render(
    <AppStateProvider>
      <Harness />
    </AppStateProvider>,
  );
}

describe("MarkdownViewSourceScreen", () => {
  it("shows originalText unmodified alongside the edited text the live editor would save right now, proving the two are genuinely decoupled", async () => {
    const { lastFrame } = renderViewSource();
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("As it will save right now"),
    );

    expect(frame).toContain("As opened");
    expect(frame).toContain("Original paragraph.");
    // The edit landed in what will save right now...
    expect(frame).toContain("New paragraph");
    // ...but originalText itself was never touched: the "as opened" section shows no trace of the edit at all.
    const asOpenedSection = frame.slice(
      frame.indexOf("As opened"),
      frame.indexOf("As it will save right now"),
    );
    expect(asOpenedSection).not.toContain("New paragraph");
  });

  it("pops back to the previous screen on Escape", async () => {
    const { lastFrame, stdin } = renderViewSource();
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("As it will save right now"),
    );
    await settle();

    stdin.write(ESCAPE_KEY);
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("popped back to"),
    );
    expect(frame).toContain("popped back to bodyList");
    expect(frame).not.toContain("As it will save right now");
  });
});
