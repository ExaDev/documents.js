import { createOdp, createPptx, openOdp, openPptx } from "documents.js";
import { render } from "ink-testing-library";
import { useEffect, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { OdpSlideListScreen } from "../editors/odp/index.js";
import {
  PptxSlideListScreen,
  ShapeEditorScreen,
  SlideDetailScreen,
} from "../editors/pptx/index.js";
import {
  AppStateProvider,
  useAppDispatch,
  useAppState,
} from "../../state/context.js";
import { currentScreen } from "../../state/types.js";
import { settle, waitForFrame } from "../../test-support.js";

const ENTER_KEY = "\r";
const ESCAPE_KEY = "\x1B";

// A minimal stand-in for app.tsx's own screen router, scoped to exactly the screens this family owns, so these tests exercise the real exported components in the same "look at the top of the stack, render the matching screen" shape app.tsx will eventually use -- not a bespoke test-only rendering path.
function SlideFamilyRouter({
  format,
}: {
  readonly format: "pptx" | "odp";
}): ReactElement {
  const state = useAppState();
  const screen = currentScreen(state);
  switch (screen.kind) {
    case "slideList":
      return format === "pptx" ? (
        <PptxSlideListScreen />
      ) : (
        <OdpSlideListScreen />
      );
    case "slideDetail":
      return <SlideDetailScreen screen={screen} />;
    case "shapeEditor":
      return <ShapeEditorScreen screen={screen} />;
    default:
      throw new Error(
        `SlideFamilyRouter has no case for ${screen.kind}; this test only ever pushes slideList/slideDetail/shapeEditor.`,
      );
  }
}

function waitForText(
  lastFrame: () => string | undefined,
  text: string,
): Promise<string> {
  return waitForFrame(lastFrame, (frame) => frame.includes(text));
}

// `settle()` (see test-support.ts) before every `stdin.write` that follows a screen swap -- every navigation in this family swaps in a whole new screen component, so every write in this suite needs it, not just the first one after opening the document.
async function sendKey(
  stdin: { readonly write: (data: string) => void },
  key: string,
): Promise<void> {
  await settle();
  stdin.write(key);
}

function buildPptxTestBytes(): Uint8Array<ArrayBuffer> {
  const editor = createPptx();
  const slideOne = editor.addSlide();
  slideOne.addTextBox({
    frame: { xPt: 10, yPt: 10, widthPt: 100, heightPt: 50 },
    text: "Q3 Results",
  });
  slideOne.addTextBox({
    frame: { xPt: 10, yPt: 70, widthPt: 100, heightPt: 50 },
    text: "",
  });
  editor.addSlide();
  return editor.toBytes();
}

function buildOdpTestBytes(): Uint8Array<ArrayBuffer> {
  const editor = createOdp();
  const slide = editor.addSlide();
  slide.addTextBox({
    frame: { xPt: 5, yPt: 5, widthPt: 50, heightPt: 20 },
    text: "Agenda",
  });
  return editor.toBytes();
}

// A real OPEN_FILE_SUCCESS dispatch (not CREATE_DOCUMENT) so the rendered slides/shapes come from bytes this test built and controls exactly, the same way opening a real file would populate state -- dispatched from a `useEffect` since AppStateProvider owns the reducer and there is no way to seed its initial state from outside.
function OpenTestDocument({
  format,
  bytes,
}: {
  readonly format: "pptx" | "odp";
  readonly bytes: Uint8Array<ArrayBuffer>;
}): ReactElement | undefined {
  const dispatch = useAppDispatch();
  useEffect(() => {
    if (format === "pptx") {
      dispatch({
        type: "OPEN_FILE_SUCCESS",
        path: "test.pptx",
        doc: { format: "pptx", editor: openPptx(bytes), path: "test.pptx" },
      });
      return;
    }
    dispatch({
      type: "OPEN_FILE_SUCCESS",
      path: "test.odp",
      doc: { format: "odp", editor: openOdp(bytes), path: "test.odp" },
    });
  }, [format, bytes, dispatch]);
  return undefined;
}

function OpenedHarness({
  format,
  bytes,
}: {
  readonly format: "pptx" | "odp";
  readonly bytes: Uint8Array<ArrayBuffer>;
}): ReactElement {
  const state = useAppState();
  if (state.openDocument === undefined) {
    return <OpenTestDocument format={format} bytes={bytes} />;
  }
  return <SlideFamilyRouter format={format} />;
}

function renderOpened(
  format: "pptx" | "odp",
  bytes: Uint8Array<ArrayBuffer>,
): ReturnType<typeof render> {
  return render(
    <AppStateProvider>
      <OpenedHarness format={format} bytes={bytes} />
    </AppStateProvider>,
  );
}

describe("SlideFamilySlideList rendering", () => {
  it("renders a pptx document as a text outline of slides and shapes", async () => {
    const { lastFrame } = renderOpened("pptx", buildPptxTestBytes());
    const frame = await waitForText(lastFrame, "PowerPoint slides (2)");
    expect(frame).toContain("Slide 1 (2 shapes)");
    expect(frame).toContain('[Text] "Q3 Results"');
    expect(frame).toContain("[Image] (no text)");
    expect(frame).toContain("Slide 2 (0 shapes)");
  });

  it("renders an odp document as a text outline of slides and shapes", async () => {
    const { lastFrame } = renderOpened("odp", buildOdpTestBytes());
    const frame = await waitForText(lastFrame, "Impress slides (1)");
    expect(frame).toContain('[Text] "Agenda"');
  });
});

describe("SlideFamilySlideList navigation", () => {
  it('adds a slide on "a" and opens the selected slide on Enter', async () => {
    const { lastFrame, stdin } = renderOpened("pptx", buildPptxTestBytes());
    await waitForText(lastFrame, "PowerPoint slides (2)");

    await sendKey(stdin, "a");
    const afterAdd = await waitForText(lastFrame, "PowerPoint slides (3)");
    expect(afterAdd).toContain("Slide 3 (0 shapes)");

    // The cursor starts on slide 1; Enter should push slideDetail for slide index 0, not whichever slide was just appended.
    await sendKey(stdin, ENTER_KEY);
    const detail = await waitForText(lastFrame, "Slide 1 -- 2 shapes");
    expect(detail).toContain('1. [Text] "Q3 Results"');
    expect(detail).toContain("2. [Image] (no text)");
  });

  it("opens a shape from slide-detail on Enter", async () => {
    const { lastFrame, stdin } = renderOpened("pptx", buildPptxTestBytes());
    await waitForText(lastFrame, "PowerPoint slides (2)");
    await sendKey(stdin, ENTER_KEY);
    await waitForText(lastFrame, "Slide 1 -- 2 shapes");

    await sendKey(stdin, ENTER_KEY);
    const shapeEditor = await waitForText(lastFrame, "Slide 1, shape 1");
    expect(shapeEditor).toContain("Text:");
    expect(shapeEditor).toContain("Q3 Results");
  });

  it("goes back up the stack one screen at a time on Escape", async () => {
    const { lastFrame, stdin } = renderOpened("pptx", buildPptxTestBytes());
    await waitForText(lastFrame, "PowerPoint slides (2)");
    await sendKey(stdin, ENTER_KEY);
    await waitForText(lastFrame, "Slide 1 -- 2 shapes");

    await sendKey(stdin, ENTER_KEY);
    await waitForText(lastFrame, "Slide 1, shape 1");

    await sendKey(stdin, ESCAPE_KEY);
    await waitForText(lastFrame, "Slide 1 -- 2 shapes");

    await sendKey(stdin, ESCAPE_KEY);
    await waitForText(lastFrame, "PowerPoint slides (2)");
  });
});
