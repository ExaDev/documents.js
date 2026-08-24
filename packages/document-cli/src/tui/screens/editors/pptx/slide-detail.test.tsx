import {
  createOdp,
  createPptx,
  openOdp,
  openPptx,
  readOdpContent,
  readPptxContent,
} from "documents.js";
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
import { NotesEditorScreen } from "../odp/index.js";
import { SlideDetailScreen } from "./slide-detail.js";

const ENTER_KEY = "\r";
const ESCAPE_KEY = "\x1B";
const BACKSPACE_KEY = "\x7F";

// The rows/columns TextField starts pre-filled with its own default value and the cursor at the end (see export-options.test.tsx's own comment on this exact TextField behaviour) -- typing a digit appends to that default rather than replacing it, so every test that wants a specific value first clears the single pre-filled default digit with one backspace.
async function replaceField(
  stdin: { readonly write: (data: string) => void },
  value: string,
): Promise<void> {
  await sendKey(stdin, BACKSPACE_KEY);
  await sendKey(stdin, value);
}

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

function buildPptxOneSlideBytes(): Uint8Array<ArrayBuffer> {
  const editor = createPptx();
  editor.addSlide();
  return editor.toBytes();
}

function buildOdpOneSlideBytes(): Uint8Array<ArrayBuffer> {
  const editor = createOdp();
  editor.addSlide();
  return editor.toBytes();
}

// A minimal stand-in for app.tsx's own router, scoped to exactly the screens this test drives: slideDetail (the screen under test) and notesEditor (reached from it via 'n').
function SlideDetailRouter(): ReactElement {
  const state = useAppState();
  const screen = currentScreen(state);
  switch (screen.kind) {
    case "slideDetail":
      return <SlideDetailScreen screen={screen} />;
    case "notesEditor":
      return <NotesEditorScreen screen={screen} />;
    default:
      throw new Error(
        `SlideDetailRouter has no case for ${screen.kind}; this test only ever pushes slideDetail/notesEditor.`,
      );
  }
}

// Reads the LIVE package fresh on every render, through the exact same content pivot real pptx/odp reading uses (readPptxContent/readOdpContent), and renders a one-line summary of slide 0's first shape's table (if any) and its own speaker notes. This is how these tests observe a mutation the reducer applied to the real package -- PptxSlide.shapes() itself never reports a table graphicFrame at all (see slide.tsx's own doc comment), so this probe, not the visible shape list, is the ground truth these tests check against.
function DocumentProbe({
  format,
}: {
  readonly format: "pptx" | "odp";
}): ReactElement {
  const state = useAppState();
  const doc = state.openDocument;
  if (doc === undefined || (doc.format !== "pptx" && doc.format !== "odp")) {
    return <Text> </Text>;
  }
  const content =
    format === "pptx"
      ? readPptxContent(doc.editor.toPackage())
      : readOdpContent(doc.editor.toPackage());
  if (content.kind !== "presentation") {
    throw new Error(
      `expected a presentation ContentDocument, got ${content.kind}`,
    );
  }
  const slide = content.slides[0];
  const tableBlock = slide?.shapes[0]?.blocks[0];
  const table =
    tableBlock?.kind === "table"
      ? `${tableBlock.rows.length}x${tableBlock.rows[0]?.cells.length ?? 0}`
      : "none";
  return (
    <Text>
      probe:table={table} notes="{slide?.notes ?? ""}"
    </Text>
  );
}

// Opens the test document AND pushes slideDetail for its one slide in a single effect -- this file has no interest in exercising the slideList -> slideDetail navigation hop the slide-family suite already covers.
function OpenAtSlideDetail({
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
      screen: { kind: "slideDetail", slideIndex: 0 },
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
    return <OpenAtSlideDetail format={format} bytes={bytes} />;
  }
  return (
    <Box flexDirection="column">
      <SlideDetailRouter />
      <DocumentProbe format={format} />
    </Box>
  );
}

function renderAtSlideDetail(
  format: "pptx" | "odp",
  bytes: Uint8Array<ArrayBuffer>,
): ReturnType<typeof render> {
  return render(
    <AppStateProvider>
      <Harness format={format} bytes={bytes} />
    </AppStateProvider>,
  );
}

describe('SlideDetailScreen "b" add-table affordance', () => {
  it("adds a real table to a pptx slide via the rows/columns prompt, verified against the real package content", async () => {
    const { lastFrame, stdin } = renderAtSlideDetail(
      "pptx",
      buildPptxOneSlideBytes(),
    );
    const initial = await waitForText(lastFrame, "Slide 1 -- 0 shapes");
    expect(initial).toContain("probe:table=none");

    await sendKey(stdin, "a");
    await waitForText(
      lastFrame,
      "Add shape: t textbox, i image, b table, Esc cancel",
    );

    await sendKey(stdin, "b");
    await waitForText(lastFrame, "Rows:");

    await replaceField(stdin, "3");
    await sendKey(stdin, ENTER_KEY);
    await waitForText(lastFrame, "Columns:");

    await replaceField(stdin, "2");
    await sendKey(stdin, ENTER_KEY);

    // PptxSlide.shapes() never reports a table graphicFrame at all, so "0 shapes" staying put is the correct, expected read -- the probe line (built from the same content pivot real pptx reading uses) is what proves the table genuinely landed in the package.
    const after = await waitForText(lastFrame, "probe:table=3x2");
    expect(after).toContain("Slide 1 -- 0 shapes");
    expect(after).not.toContain("Rows:");
    expect(after).not.toContain("Columns:");
  });

  it("adds a real table to an odp slide via the rows/columns prompt, verified against the real package content", async () => {
    const { lastFrame, stdin } = renderAtSlideDetail(
      "odp",
      buildOdpOneSlideBytes(),
    );
    await waitForText(lastFrame, "Slide 1 -- 0 shapes");

    await sendKey(stdin, "a");
    // odp additionally offers r/e/n/p vector-primitive kinds here (see this file's own vector-creation describe block below) -- pptx has no equivalent, whose own chooseKind test further down still expects the plain textbox/image/table hint verbatim.
    await waitForText(
      lastFrame,
      "Add shape: t textbox, i image, b table, r rect, e ellipse, n line, p path, Esc cancel",
    );

    await sendKey(stdin, "b");
    await waitForText(lastFrame, "Rows:");
    await replaceField(stdin, "2");
    await sendKey(stdin, ENTER_KEY);
    await waitForText(lastFrame, "Columns:");
    await replaceField(stdin, "4");
    await sendKey(stdin, ENTER_KEY);

    // OdpSlide.shapes() now excludes a table's own draw:frame (it used to double-expose it as a functionally-dead OdpShape whose .paragraphs()/.text silently returned nothing) -- "0 shapes" staying put is the correct, expected read now, matching pptx's own convention. The probe line (built from the same content pivot real odp reading uses) is what proves the table genuinely landed in the package, exactly as it already is for pptx.
    const after = await waitForText(lastFrame, "probe:table=2x4");
    expect(after).toContain("Slide 1 -- 0 shapes");
  });

  it("cancels the add-table wizard on Escape without touching the document", async () => {
    const { lastFrame, stdin } = renderAtSlideDetail(
      "pptx",
      buildPptxOneSlideBytes(),
    );
    await waitForText(lastFrame, "Slide 1 -- 0 shapes");

    await sendKey(stdin, "a");
    await waitForText(
      lastFrame,
      "Add shape: t textbox, i image, b table, Esc cancel",
    );
    await sendKey(stdin, "b");
    await waitForText(lastFrame, "Rows:");

    await sendKey(stdin, ESCAPE_KEY);
    // The footer hint line is rendered unconditionally regardless of addMode (see slide-detail.tsx), so it is not itself a signal that the wizard closed -- the disappearance of the "Rows:" prompt is.
    const after = await waitForFrame(
      lastFrame,
      (frame) => !frame.includes("Rows:"),
    );
    expect(after).toContain(
      "Enter: edit shape a: add shape n: notes Esc: back",
    );
    expect(after).toContain("probe:table=none");
  });
});

describe('SlideDetailScreen "n" notes affordance shared between pptx and odp', () => {
  it("opens the notes editor for a pptx slide and saves real speaker notes back onto PptxSlide.notes", async () => {
    const { lastFrame, stdin } = renderAtSlideDetail(
      "pptx",
      buildPptxOneSlideBytes(),
    );
    await waitForText(lastFrame, "Slide 1 -- 0 shapes");
    expect(lastFrame()).toContain('notes=""');

    await sendKey(stdin, "n");
    await waitForText(lastFrame, "Slide 1 notes");

    await settle();
    stdin.write("Q3 growth is up");
    await waitForText(lastFrame, "Q3 growth is up");
    stdin.write(ENTER_KEY);

    // Back on slide-detail, with the probe now reading the real notes text back off PptxSlide.notes -- SET_SLIDE_NOTES was previously wired to odp only; this is the direct proof it now also commits for a pptx document.
    const after = await waitForText(lastFrame, 'notes="Q3 growth is up"');
    expect(after).toContain("Slide 1 -- 0 shapes");
  });

  it("opens the notes editor for an odp slide exactly as before", async () => {
    const { lastFrame, stdin } = renderAtSlideDetail(
      "odp",
      buildOdpOneSlideBytes(),
    );
    await waitForText(lastFrame, "Slide 1 -- 0 shapes");

    await sendKey(stdin, "n");
    await waitForText(lastFrame, "Slide 1 notes");
    await settle();
    stdin.write("Agenda for the meeting");
    await waitForText(lastFrame, "Agenda for the meeting");
    stdin.write(ENTER_KEY);

    await waitForText(lastFrame, 'notes="Agenda for the meeting"');
  });
});
