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
import { SlideDetailScreen } from "./slide-detail.js";
import { SlideTableDetailScreen } from "./slide-table-detail.js";

const ENTER_KEY = "\r";
const ESCAPE_KEY = "\x1B";

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

function buildPptxTableDeckBytes(): Uint8Array<ArrayBuffer> {
  const editor = createPptx();
  const slide = editor.addSlide();
  slide.addTable({
    frame: { xPt: 10, yPt: 10, widthPt: 300, heightPt: 150 },
    table: { rows: 3, columns: 3 },
  });
  return editor.toBytes();
}

function buildOdpTableDeckBytes(): Uint8Array<ArrayBuffer> {
  const editor = createOdp();
  const slide = editor.addSlide();
  slide.addTable({
    frame: { xPt: 10, yPt: 10, widthPt: 300, heightPt: 150 },
    table: { rows: 3, columns: 3 },
  });
  return editor.toBytes();
}

// A minimal stand-in for app.tsx's own router, scoped to exactly the screens this test drives: slideDetail (to navigate from) and slideTableDetail (the screen under test).
function SlideTableRouter(): ReactElement {
  const state = useAppState();
  const screen = currentScreen(state);
  switch (screen.kind) {
    case "slideDetail":
      return <SlideDetailScreen screen={screen} />;
    case "slideTableDetail":
      return <SlideTableDetailScreen screen={screen} />;
    default:
      throw new Error(
        `SlideTableRouter has no case for ${screen.kind}; this test only ever pushes slideDetail/slideTableDetail.`,
      );
  }
}

// Reads the LIVE package fresh on every render, through the exact same content pivot real pptx/odp reading uses -- how these tests observe a MERGE_SLIDE_TABLE_CELLS mutation the reducer applied to the real package.
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
  const tableBlock = content.slides[0]?.shapes[0]?.blocks[0];
  const anchor =
    tableBlock?.kind === "table" ? tableBlock.rows[0]?.cells[0] : undefined;
  return (
    <Text>
      probe:anchorColSpan={anchor?.colSpan ?? 1} anchorRowSpan=
      {anchor?.rowSpan ?? 1}
    </Text>
  );
}

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
      <SlideTableRouter />
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

describe.each(["pptx", "odp"] as const)(
  "SlideTableDetailScreen on %s",
  (format) => {
    it("is reachable from slide-detail's own Tables section and merges a real rectangle of cells", async () => {
      const bytes =
        format === "pptx"
          ? buildPptxTableDeckBytes()
          : buildOdpTableDeckBytes();
      const { lastFrame, stdin } = renderAtSlideDetail(format, bytes);
      const initial = await waitForText(lastFrame, "Tables (1)");
      expect(initial).toContain("probe:anchorColSpan=1 anchorRowSpan=1");
      // PptxSlide.shapes()/OdpSlide.shapes() never report a table -- "0 shapes" is the correct, expected read, matching the "b" add-table wizard's own tests.
      expect(initial).toContain("Slide 1 -- 0 shapes");

      await sendKey(stdin, ENTER_KEY);
      await waitForText(lastFrame, "table 1 (3x3)");

      // Anchor the merge at the table's own (0,0), move to (1,1), commit.
      await sendKey(stdin, "m");
      const anchored = await waitForText(lastFrame, "m/Enter to merge");
      expect(anchored).not.toContain("anchor a merge");

      await sendKey(stdin, "l");
      await sendKey(stdin, "j");
      await sendKey(stdin, "m");

      const merged = await waitForText(
        lastFrame,
        "probe:anchorColSpan=2 anchorRowSpan=2",
      );
      expect(merged).toContain("anchor a merge");
    });

    it("cancels a pending merge on Escape without touching the document, then Escape again returns to slide-detail", async () => {
      const bytes =
        format === "pptx"
          ? buildPptxTableDeckBytes()
          : buildOdpTableDeckBytes();
      const { lastFrame, stdin } = renderAtSlideDetail(format, bytes);
      await waitForText(lastFrame, "Tables (1)");

      await sendKey(stdin, ENTER_KEY);
      await waitForText(lastFrame, "table 1 (3x3)");

      await sendKey(stdin, "m");
      await waitForText(lastFrame, "m/Enter to merge");

      await sendKey(stdin, ESCAPE_KEY);
      const cancelled = await waitForText(lastFrame, "anchor a merge");
      expect(cancelled).toContain("probe:anchorColSpan=1 anchorRowSpan=1");
      expect(cancelled).toContain("table 1 (3x3)");

      await sendKey(stdin, ESCAPE_KEY);
      await waitForText(lastFrame, "Tables (1)");
    });
  },
);
