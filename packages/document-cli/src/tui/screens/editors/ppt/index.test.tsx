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
import { PptSlideDetailScreen, PptSlideListScreen } from "./index.js";

// Creates a fresh, empty ppt presentation (a real createPpt() editor -- see PptEditor's own comment, it starts with zero slides, unlike ods/xls's default sheet) and exposes the current screen stack's top plus the live slide count as probes.
function ListHarness(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (state.openDocument === undefined) {
      dispatch({ type: "CREATE_DOCUMENT", format: "ppt" });
    }
  }, [state.openDocument, dispatch]);

  if (state.openDocument?.format !== "ppt") {
    return <Text>loading</Text>;
  }
  return (
    <Box flexDirection="column">
      <PptSlideListScreen />
      <Text>slideCount:{state.openDocument.editor.slides().length}</Text>
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

describe("PptSlideListScreen", () => {
  it("renders the empty-presentation message a freshly created ppt starts with", async () => {
    const { lastFrame } = renderListHarness();
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("PowerPoint 97-2003 slides (0)"),
    );
    expect(frame).toContain("No slides yet");
    expect(frame).toContain("slideCount:0");
  });

  it('adds a slide through the "a" key, since ADD_SLIDE\'s own narrowing accepts ppt alongside pptx/odp', async () => {
    const { lastFrame, stdin } = renderListHarness();
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("slideCount:0"),
    );
    await settle();

    stdin.write("a");
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("slideCount:1"),
    );
    expect(frame).toContain("PowerPoint 97-2003 slides (1)");
  });

  it("pushes the slideDetail screen for the selected slide on Enter", async () => {
    const { lastFrame, stdin } = renderListHarness();
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("slideCount:0"),
    );
    await settle();

    stdin.write("a");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("slideCount:1"),
    );
    await settle();

    stdin.write("\r");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("top:slideDetail"),
    );
  });
});

// A harness that seeds a real slide, and a real text-box shape on it, directly through PptEditor.addSlide()/PptSlide.addTextBox() -- test setup, not the behaviour under test, exactly like the xls grid harness seeds a cell directly -- so the detail screen has real, pre-populated content to render rather than starting from ADD_SLIDE's own bare default. The push happens exactly once, guarded by a ref, so popping back to the slide list later does not immediately re-trigger this same setup effect.
function DetailHarness(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = state.openDocument;
  const top = state.stack.at(-1);
  const hasPushed = useRef(false);

  useEffect(() => {
    if (doc === undefined) {
      dispatch({ type: "CREATE_DOCUMENT", format: "ppt" });
      return;
    }
    if (
      doc.format === "ppt" &&
      top?.kind === "slideList" &&
      !hasPushed.current
    ) {
      hasPushed.current = true;
      const slide = doc.editor.addSlide();
      slide.addTextBox({
        frame: { xPt: 10, yPt: 20, widthPt: 100, heightPt: 50 },
        text: "Hello",
      });
      dispatch({
        type: "PUSH_SCREEN",
        screen: { kind: "slideDetail", slideIndex: 0 },
      });
    }
  }, [doc, top, dispatch]);

  if (doc?.format !== "ppt") {
    return <Text>loading</Text>;
  }

  return (
    <Box flexDirection="column">
      {top?.kind === "slideDetail" ? (
        <PptSlideDetailScreen slideIndex={0} />
      ) : (
        <Text>not on the detail screen</Text>
      )}
      <Text>top:{top?.kind}</Text>
      <Text>
        shapeText:
        {JSON.stringify(doc.editor.slides()[0]?.shapes()[0]?.text)}
      </Text>
      <Text>shapeCount:{doc.editor.slides()[0]?.shapes().length}</Text>
      <Text>notes:{JSON.stringify(doc.editor.slides()[0]?.notes)}</Text>
    </Box>
  );
}

function renderDetailHarness(): ReturnType<typeof render> {
  return render(
    <AppStateProvider>
      <DetailHarness />
    </AppStateProvider>,
  );
}

// A harness identical to DetailHarness but pointed at a slide index the presentation does not carry, to exercise the "no slide at this index" guard.
function MissingSlideHarness(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = state.openDocument;
  const top = state.stack.at(-1);

  useEffect(() => {
    if (doc === undefined) {
      dispatch({ type: "CREATE_DOCUMENT", format: "ppt" });
      return;
    }
    if (doc.format === "ppt" && top?.kind === "slideList") {
      dispatch({
        type: "PUSH_SCREEN",
        screen: { kind: "slideDetail", slideIndex: 3 },
      });
    }
  }, [doc, top, dispatch]);

  if (doc?.format !== "ppt" || top?.kind !== "slideDetail") {
    return <Text>loading</Text>;
  }

  return <PptSlideDetailScreen slideIndex={3} />;
}

describe("PptSlideDetailScreen", () => {
  it("renders the not-found message when the addressed slide does not exist", async () => {
    const { lastFrame } = render(
      <AppStateProvider>
        <MissingSlideHarness />
      </AppStateProvider>,
    );
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("There is no slide at index"),
    );
    expect(frame).toContain("3");
  });

  it("lists each shape's geometry and text, plus a trailing notes row", async () => {
    const { lastFrame } = renderDetailHarness();
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Slide 1"),
    );
    expect(frame).toContain("10,20 100x50pt Hello");
    expect(frame).toContain("Notes: (none)");
  });

  it("shows the empty-shape placeholder for a shape with no text", async () => {
    function EmptyShapeHarness(): ReactElement {
      const state = useAppState();
      const dispatch = useAppDispatch();
      const doc = state.openDocument;
      const top = state.stack.at(-1);
      const hasPushed = useRef(false);

      useEffect(() => {
        if (doc === undefined) {
          dispatch({ type: "CREATE_DOCUMENT", format: "ppt" });
          return;
        }
        if (
          doc.format === "ppt" &&
          top?.kind === "slideList" &&
          !hasPushed.current
        ) {
          hasPushed.current = true;
          const slide = doc.editor.addSlide();
          slide.addTextBox({
            frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
            text: "",
          });
          dispatch({
            type: "PUSH_SCREEN",
            screen: { kind: "slideDetail", slideIndex: 0 },
          });
        }
      }, [doc, top, dispatch]);

      if (doc?.format !== "ppt" || top?.kind !== "slideDetail") {
        return <Text>loading</Text>;
      }
      return <PptSlideDetailScreen slideIndex={0} />;
    }

    const { lastFrame } = render(
      <AppStateProvider>
        <EmptyShapeHarness />
      </AppStateProvider>,
    );
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Slide 1"),
    );
    expect(frame).toContain("(empty shape)");
  });

  it("shows the real notes text once a slide carries some", async () => {
    function NotedSlideHarness(): ReactElement {
      const state = useAppState();
      const dispatch = useAppDispatch();
      const doc = state.openDocument;
      const top = state.stack.at(-1);
      const hasPushed = useRef(false);

      useEffect(() => {
        if (doc === undefined) {
          dispatch({ type: "CREATE_DOCUMENT", format: "ppt" });
          return;
        }
        if (
          doc.format === "ppt" &&
          top?.kind === "slideList" &&
          !hasPushed.current
        ) {
          hasPushed.current = true;
          const slide = doc.editor.addSlide();
          slide.notes = "Remember the punchline";
          dispatch({
            type: "PUSH_SCREEN",
            screen: { kind: "slideDetail", slideIndex: 0 },
          });
        }
      }, [doc, top, dispatch]);

      if (doc?.format !== "ppt" || top?.kind !== "slideDetail") {
        return <Text>loading</Text>;
      }
      return <PptSlideDetailScreen slideIndex={0} />;
    }

    const { lastFrame } = render(
      <AppStateProvider>
        <NotedSlideHarness />
      </AppStateProvider>,
    );
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Slide 1"),
    );
    expect(frame).toContain("Notes: Remember the punchline");
  });

  it("opens the shape text editor on Enter and commits SET_SHAPE_TEXT on submit", async () => {
    const { lastFrame, stdin } = renderDetailHarness();
    await waitForFrame(lastFrame, (candidate) => candidate.includes("Slide 1"));
    await settle();

    stdin.write("\r");
    const editing = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Shape 0 text"),
    );
    expect(editing).toContain("Enter to save, Esc to cancel");
    await settle();

    stdin.write(" world");
    await settle();
    stdin.write("\r");

    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes('shapeText:"Hello world"'),
    );
    expect(frame).not.toContain("Shape 0 text");
  });

  it("cancels the shape text editor on Escape without dispatching SET_SHAPE_TEXT", async () => {
    const { lastFrame, stdin } = renderDetailHarness();
    await waitForFrame(lastFrame, (candidate) => candidate.includes("Slide 1"));
    await settle();

    stdin.write("\r");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Shape 0 text"),
    );
    await settle();

    stdin.write("garbage");
    await settle();
    stdin.write("\x1B");

    const frame = await waitForFrame(
      lastFrame,
      (candidate) => !candidate.includes("Shape 0 text"),
    );
    expect(frame).toContain('shapeText:"Hello"');
  });

  it('pushes the notes editor via the "n" hotkey', async () => {
    const { lastFrame, stdin } = renderDetailHarness();
    await waitForFrame(lastFrame, (candidate) => candidate.includes("Slide 1"));
    await settle();

    stdin.write("n");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("top:notesEditor"),
    );
  });

  it("pushes the notes editor by selecting the trailing notes row with Enter", async () => {
    const { lastFrame, stdin } = renderDetailHarness();
    await waitForFrame(lastFrame, (candidate) => candidate.includes("Slide 1"));
    await settle();

    // The notes row is the second row (index 1) after the single seeded shape.
    stdin.write("[B"); // down arrow, off the shape row and onto the notes row
    await settle();
    stdin.write("\r");

    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("top:notesEditor"),
    );
  });

  it('adds a text box through the "a" field wizard, accepting every default', async () => {
    const { lastFrame, stdin } = renderDetailHarness();
    await waitForFrame(lastFrame, (candidate) => candidate.includes("Slide 1"));
    await settle();

    stdin.write("a");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Step 1 of 5"),
    );
    await settle();

    for (let step = 1; step <= 5; step++) {
      stdin.write("\r");
      await settle();
    }

    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("shapeCount:2"),
    );
    expect(frame).not.toContain("Step");
  });

  it("cancels the add-text-box wizard on Escape without adding a shape", async () => {
    const { lastFrame, stdin } = renderDetailHarness();
    await waitForFrame(lastFrame, (candidate) => candidate.includes("Slide 1"));
    await settle();

    stdin.write("a");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Step 1 of 5"),
    );
    await settle();

    stdin.write("\x1B");
    const frame = await waitForFrame(
      lastFrame,
      (candidate) => !candidate.includes("Step"),
    );
    expect(frame).toContain("shapeCount:1");
  });

  it("pops the screen on Escape when browsing (not mid-edit, not in the wizard)", async () => {
    const { lastFrame, stdin } = renderDetailHarness();
    await waitForFrame(lastFrame, (candidate) => candidate.includes("Slide 1"));
    await settle();

    stdin.write("\x1B");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("top:slideList"),
    );
  });
});
