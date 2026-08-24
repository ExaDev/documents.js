import { createOdp, createPptx, openOdp, openPptx } from "documents.js";
import { Box } from "ink";
import { render } from "ink-testing-library";
import { useEffect, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { StatusLine } from "../../../components/status-line.js";
import {
  AppStateProvider,
  useAppDispatch,
  useAppState,
} from "../../../state/context.js";
import { currentScreen, type Screen } from "../../../state/types.js";
import { settle, waitForFrame } from "../../../test-support.js";
import { ShapeEditorScreen } from "./shape-editor.js";

const ENTER_KEY = "\r";

function waitForText(
  lastFrame: () => string | undefined,
  text: string,
): Promise<string> {
  return waitForFrame(lastFrame, (frame) => frame.includes(text));
}

async function sendKey(
  stdin: { readonly write: (data: string) => void },
  key: string,
): Promise<void> {
  await settle();
  stdin.write(key);
}

function buildOnePptxShapeBytes(): Uint8Array<ArrayBuffer> {
  const editor = createPptx();
  const slide = editor.addSlide();
  slide.addTextBox({
    frame: { xPt: 10, yPt: 10, widthPt: 100, heightPt: 50 },
    text: "Title",
  });
  return editor.toBytes();
}

function buildOneOdpShapeBytes(): Uint8Array<ArrayBuffer> {
  const editor = createOdp();
  const slide = editor.addSlide();
  slide.addTextBox({
    frame: { xPt: 10, yPt: 10, widthPt: 100, heightPt: 50 },
    text: "Title",
  });
  return editor.toBytes();
}

// Opens the test document AND pushes shapeEditor for its one shape in a single effect, so this harness has exactly one screen swap to settle -- ShapeEditorScreen itself, not an intermediate slideList/slideDetail hop this file has no interest in exercising.
function OpenAtShapeEditor({
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
    } else {
      dispatch({
        type: "OPEN_FILE_SUCCESS",
        path: "test.odp",
        doc: { format: "odp", editor: openOdp(bytes), path: "test.odp" },
      });
    }
    dispatch({
      type: "PUSH_SCREEN",
      screen: { kind: "shapeEditor", slideIndex: 0, shapeIndex: 0 },
    });
  }, [format, bytes, dispatch]);
  return undefined;
}

function Harness({
  format,
  bytes,
}: {
  readonly format: "pptx" | "odp";
  readonly bytes: Uint8Array<ArrayBuffer>;
}): ReactElement {
  const state = useAppState();
  if (state.openDocument === undefined) {
    return <OpenAtShapeEditor format={format} bytes={bytes} />;
  }
  const screen: Screen = currentScreen(state);
  if (screen.kind !== "shapeEditor") {
    return <OpenAtShapeEditor format={format} bytes={bytes} />;
  }
  return (
    <Box flexDirection="column">
      <ShapeEditorScreen screen={screen} />
      <StatusLine />
    </Box>
  );
}

function renderShapeEditor(
  format: "pptx" | "odp",
  bytes: Uint8Array<ArrayBuffer>,
): ReturnType<typeof render> {
  return render(
    <AppStateProvider>
      <Harness format={format} bytes={bytes} />
    </AppStateProvider>,
  );
}

// PptxShape gained a real `rotationDeg` getter/setter alongside OdpShape's, so the rotation row now behaves identically for both formats -- these used to be two contrasting suites (pptx greyed out, odp editable); now each format gets its own copy of the same assertions rather than one leaning on the other for contrast.
describe("ShapeEditorScreen rotation row: pptx", () => {
  it("renders the rotation row as an editable, currently-unset value for a pptx shape", async () => {
    const { lastFrame } = renderShapeEditor("pptx", buildOnePptxShapeBytes());
    const frame = await waitForText(lastFrame, "Slide 1, shape 1");
    expect(frame).toContain("Rotation: (unset)");
  });

  it("opens an editable rotation field on Enter for a pptx shape and commits a value on submit", async () => {
    const { lastFrame, stdin } = renderShapeEditor(
      "pptx",
      buildOnePptxShapeBytes(),
    );
    await waitForText(lastFrame, "Slide 1, shape 1");

    // Field order is text, x, y, width, height, rotation -- five downs from the initial text-row selection lands on rotation.
    for (let i = 0; i < 5; i += 1) {
      await sendKey(stdin, "j");
    }
    await sendKey(stdin, ENTER_KEY);
    await waitForText(lastFrame, "Rotation (deg");

    await sendKey(stdin, "3");
    await sendKey(stdin, "0");
    await sendKey(stdin, ENTER_KEY);
    const frame = await waitForText(lastFrame, "Rotation: 30°");
    expect(frame).not.toContain("Rotation (deg");
  });
});

describe("ShapeEditorScreen rotation row: odp", () => {
  it("renders the rotation row as an editable, currently-unset value for an odp shape", async () => {
    const { lastFrame } = renderShapeEditor("odp", buildOneOdpShapeBytes());
    const frame = await waitForText(lastFrame, "Slide 1, shape 1");
    expect(frame).toContain("Rotation: (unset)");
  });

  it("opens an editable rotation field on Enter for an odp shape and commits a value on submit", async () => {
    const { lastFrame, stdin } = renderShapeEditor(
      "odp",
      buildOneOdpShapeBytes(),
    );
    await waitForText(lastFrame, "Slide 1, shape 1");

    for (let i = 0; i < 5; i += 1) {
      await sendKey(stdin, "j");
    }
    await sendKey(stdin, ENTER_KEY);
    await waitForText(lastFrame, "Rotation (deg");

    await sendKey(stdin, "3");
    await sendKey(stdin, "0");
    await sendKey(stdin, ENTER_KEY);
    const frame = await waitForText(lastFrame, "Rotation: 30°");
    expect(frame).not.toContain("Rotation (deg");
  });
});
