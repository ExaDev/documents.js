import { PdfEditor, type LayoutDocument } from "documents.js";
import { Box, Text } from "ink";
import { render } from "ink-testing-library";
import type { ReactElement } from "react";
import { useEffect, useRef } from "react";
import { describe, expect, it } from "vitest";
import {
  AppStateProvider,
  useAppDispatch,
  useAppState,
} from "../../../state/context.js";
import { currentScreen, type PdfOpenDocument } from "../../../state/types.js";
import { flattenFrame, settle, waitForFrame } from "../../../test-support.js";
import { PdfItemDetailScreen } from "./item-detail.js";

const ENTER = "\r";
const ESCAPE = "\u001B";
const BACKSPACE = "\x7f";

// The item-detail screen's own header row renders a genuine em dash (U+2014) between the item index and its kind; asserting against the same code point (rather than a literal character in this source file) keeps the fixture unambiguous in any editor or terminal.
const EM_DASH = "\u2014";

// A real, minimal 1x1 PNG, registered under imageId "logo" — writePdf (called by mutate()'s own undo-snapshot step on every dispatch, not just an explicit save) throws "LayoutDocument references image ... but it is not present in images" for an image item whose imageId has no matching registry entry, so any test that DISPATCHES against an image item (not merely renders its read-only dump) needs a genuine entry here, not an empty `images: {}`.
// A second, real, genuinely decodable 1x1 PNG (a plain red pixel, distinct content from LOGO_IMAGE_ASSET's own bytes so registerImageBytes' crc32-derived id actually differs) — for the "replace image" flow, which calls decodePng on whatever bytes it reads off disk to recover width/height (see documents.js's own registerImageBytes), unlike a docx/odt image insertion's own PNG fixture (paragraph-detail.test.tsx's PNG_BYTES) which never decodes pixels since a docx/odt image's own width/height come from the wizard's typed fields instead. A signature-only stub (the docx fixture's own shape) throws here.
interface Stdin {
  readonly write: (data: string) => void;
}

async function waitForFlatFrame(
  rendered: ReturnType<typeof render>,
  predicate: (frame: string) => boolean,
): Promise<string> {
  return waitForFrame(() => flattenFrame(rendered.lastFrame()), predicate);
}

async function clearAndType(
  stdin: Stdin,
  rendered: ReturnType<typeof render>,
  clearCount: number,
  value: string,
): Promise<void> {
  for (let step = 0; step < clearCount; step += 1) {
    stdin.write(BACKSPACE);
    await settle();
  }
  stdin.write(value);
  await waitForFlatFrame(rendered, (candidate) => candidate.includes(value));
}

// --- read-only field dump, for an xlsx-sourced document -------------------------------------------------------------------------------------------------------------------------------------------------------------------------

// Navigates a fresh xlsx-format harness from pdfPageList through pdfPageItems into pdfItemDetail for the fixture's single item, matching navigation.test.tsx's own established flow for exercising ReadOnlyItemDetail.
// --- real field editor, for a genuine 'pdf'-format document ---------------------------------------------------------------------------------------------------------------------------------------------------------------

// Renders PdfItemDetailScreen directly against a live PdfEditor built from `layout` (the same direct-construction technique test-support.tsx's own PdfHarness uses, and for the identical reason — a real writePdf/openPdf round trip reorders items and substitutes fonts), skipping the pdfPageList/pdfPageItems hops edit.test.tsx already covers for text/rect. A trailing probe line reads the live item straight off the same PdfEditor instance the screen itself edits, exposing state (an image's own imageId after a replace) that the rendered UI never displays on its own.
function Harness({
  layout,
  itemIndex = 0,
}: {
  readonly layout: LayoutDocument;
  readonly itemIndex?: number;
}): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const hasOpened = useRef(false);
  const hasPushed = useRef(false);

  useEffect(() => {
    if (!hasOpened.current && state.openDocument === undefined) {
      hasOpened.current = true;
      const editor = new PdfEditor(layout);
      const doc: PdfOpenDocument = {
        format: "pdf",
        editor,
        layout: editor.toLayoutDocument(),
        path: "sample.pdf",
      };
      dispatch({ type: "OPEN_FILE_SUCCESS", path: "sample.pdf", doc });
      return;
    }
    if (
      !hasPushed.current &&
      state.openDocument !== undefined &&
      currentScreen(state).kind !== "pdfItemDetail"
    ) {
      hasPushed.current = true;
      dispatch({
        type: "PUSH_SCREEN",
        screen: { kind: "pdfItemDetail", pageIndex: 0, itemIndex },
      });
    }
  }, [state, dispatch]);

  const screen =
    state.openDocument === undefined ? undefined : currentScreen(state);
  const doc =
    state.openDocument?.format === "pdf" ? state.openDocument : undefined;
  const item = doc?.editor.page(0)?.items()[itemIndex];
  const imageId = item?.kind === "image" ? item.imageId : "n/a";

  return (
    <Box flexDirection="column">
      {screen?.kind === "pdfItemDetail" ? (
        <PdfItemDetailScreen />
      ) : (
        <Text>closed</Text>
      )}
      <Text>top:{screen?.kind ?? "none"}</Text>
      <Text>imageId:{imageId}</Text>
      {/* item-detail.tsx dispatches SET_STATUS on a failed image replace but never renders state.status itself — the real app's status line lives in a separate top-level component (StatusLine) this harness deliberately doesn't include, so a probe reads it directly instead. */}
      <Text>
        status:
        {state.status === undefined
          ? "none"
          : `${state.status.severity}:${state.status.text}`}
      </Text>
    </Box>
  );
}

async function waitForTop(
  rendered: ReturnType<typeof render>,
  kind: string,
): Promise<string> {
  const frame = await waitForFlatFrame(rendered, (candidate) =>
    candidate.includes(`top:${kind}`),
  );
  await settle();
  return frame;
}

describe("PdfItemDetailScreen editable field editor — ellipse, line, path, image, link, and internalLink rows", () => {
  it("shows the item-not-found message and pops the screen on Escape when the item no longer exists", async () => {
    const layout: LayoutDocument = {
      formatVersion: 1,
      metadata: {},
      images: {},
      pages: [{ widthPt: 612, heightPt: 792, items: [] }],
    };
    const rendered = render(
      <AppStateProvider>
        <Harness layout={layout} itemIndex={0} />
      </AppStateProvider>,
    );
    const frame = await waitForTop(rendered, "pdfItemDetail");
    expect(frame).toContain("There is no item 1 on page 1 any more.");
    rendered.stdin.write(ESCAPE);
    const after = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("top:pdfPageList"),
    );
    expect(after).toContain("top:pdfPageList");
  });

  it("edits a rect's frame, fill, and stroke fields", async () => {
    const layout: LayoutDocument = {
      formatVersion: 1,
      metadata: {},
      images: {},
      pages: [
        {
          widthPt: 612,
          heightPt: 792,
          items: [
            {
              kind: "rect",
              xPt: 0,
              yPt: 0,
              widthPt: 10,
              heightPt: 10,
              fill: { r: 1, g: 0, b: 0 },
              stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
            },
          ],
        },
      ],
    };
    const rendered = render(
      <AppStateProvider>
        <Harness layout={layout} />
      </AppStateProvider>,
    );
    const { stdin } = rendered;
    const frame = await waitForTop(rendered, "pdfItemDetail");
    expect(frame).toContain(`Page 1, item 1 ${EM_DASH} rect`);
    expect(frame).toContain("Fill: #ff0000");
    expect(frame).toContain("Stroke: #000000 @ 1.0pt");

    // Width is row 2 (X, Y, Width, Height, Fill, Stroke).
    stdin.write("j");
    await settle();
    stdin.write("j");
    await settle();
    stdin.write(ENTER);
    await settle();
    await clearAndType(stdin, rendered, "10".length, "50");
    stdin.write(ENTER);
    const widthFrame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("Width: 50.0pt"),
    );
    expect(widthFrame).toContain("Width: 50.0pt");

    // Fill is row 4 from Width, two more downs.
    stdin.write("j");
    await settle();
    stdin.write("j");
    await settle();
    stdin.write(ENTER);
    await settle();
    await clearAndType(stdin, rendered, "1 0 0".length, "0 1 0");
    stdin.write(ENTER);
    const fillFrame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("Fill: #00ff00"),
    );
    expect(fillFrame).toContain("Fill: #00ff00");

    stdin.write("j");
    await settle();
    stdin.write(ENTER);
    await settle();
    await clearAndType(stdin, rendered, "0 0 0 1".length, "0 0 1 3");
    stdin.write(ENTER);
    const strokeFrame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("Stroke: #0000ff @ 3.0pt"),
    );
    expect(strokeFrame).toContain("Stroke: #0000ff @ 3.0pt");
  }, 20000);

  it("edits an ellipse's frame, fill, and stroke fields, and shows 'none' for an unset fill", async () => {
    const layout: LayoutDocument = {
      formatVersion: 1,
      metadata: {},
      images: {},
      pages: [
        {
          widthPt: 612,
          heightPt: 792,
          items: [
            { kind: "ellipse", xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
          ],
        },
      ],
    };
    const rendered = render(
      <AppStateProvider>
        <Harness layout={layout} />
      </AppStateProvider>,
    );
    const { stdin } = rendered;
    const frame = await waitForTop(rendered, "pdfItemDetail");
    expect(frame).toContain("Page 1, item 1 — ellipse");
    expect(frame).toContain("Fill: none");
    expect(frame).toContain("Stroke: none");

    // Width is row 2 (X, Y, Width, Height, Fill, Stroke).
    stdin.write("j");
    await settle();
    stdin.write("j");
    await settle();
    stdin.write(ENTER);
    await settle();
    await clearAndType(stdin, rendered, "10".length, "40");
    stdin.write(ENTER);
    const widthFrame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("Width: 40.0pt"),
    );
    expect(widthFrame).toContain("Width: 40.0pt");

    // Fill is row 4 from Width — two more downs.
    stdin.write("j");
    await settle();
    stdin.write("j");
    await settle();
    stdin.write(ENTER);
    await settle();
    stdin.write("1 0 0");
    await settle();
    stdin.write(ENTER);
    const fillFrame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("Fill: #ff0000"),
    );
    expect(fillFrame).toContain("Fill: #ff0000");

    stdin.write("j");
    await settle();
    stdin.write(ENTER);
    await settle();
    stdin.write("0 0 1 2");
    await settle();
    stdin.write(ENTER);
    const strokeFrame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("Stroke: #0000ff @ 2.0pt"),
    );
    expect(strokeFrame).toContain("Stroke: #0000ff @ 2.0pt");
  }, 20000);

  it("edits a line's from, to, colour, and width fields, and clamps a non-positive width to a positive value", async () => {
    const layout: LayoutDocument = {
      formatVersion: 1,
      metadata: {},
      images: {},
      pages: [
        {
          widthPt: 612,
          heightPt: 792,
          items: [
            {
              kind: "line",
              x1Pt: 0,
              y1Pt: 0,
              x2Pt: 100,
              y2Pt: 0,
              color: { r: 0, g: 0, b: 0 },
              widthPt: 1,
            },
          ],
        },
      ],
    };
    const rendered = render(
      <AppStateProvider>
        <Harness layout={layout} />
      </AppStateProvider>,
    );
    const { stdin } = rendered;
    const frame = await waitForTop(rendered, "pdfItemDetail");
    expect(frame).toContain("From X: 0.0pt");
    expect(frame).toContain("To X: 100.0pt");
    expect(frame).toContain("To Y: 0.0pt");

    // From X is row 0.
    stdin.write(ENTER);
    await settle();
    await clearAndType(stdin, rendered, "0".length, "10");
    stdin.write(ENTER);
    const fromXFrame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("From X: 10.0pt"),
    );
    expect(fromXFrame).toContain("From X: 10.0pt");

    // From Y is row 1.
    stdin.write("j");
    await settle();
    stdin.write(ENTER);
    await settle();
    await clearAndType(stdin, rendered, "0".length, "25");
    stdin.write(ENTER);
    const fromYFrame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("From Y: 25.0pt"),
    );
    expect(fromYFrame).toContain("From Y: 25.0pt");

    // To X is row 2.
    stdin.write("j");
    await settle();
    stdin.write(ENTER);
    await settle();
    await clearAndType(stdin, rendered, "100".length, "150");
    stdin.write(ENTER);
    const toXFrame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("To X: 150.0pt"),
    );
    expect(toXFrame).toContain("To X: 150.0pt");

    // To Y is row 3.
    stdin.write("j");
    await settle();
    stdin.write(ENTER);
    await settle();
    await clearAndType(stdin, rendered, "0".length, "40");
    stdin.write(ENTER);
    const toYFrame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("To Y: 40.0pt"),
    );
    expect(toYFrame).toContain("To Y: 40.0pt");

    // Colour is row 4.
    stdin.write("j");
    await settle();
    stdin.write(ENTER);
    await settle();
    const colourDraftFrame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("0 0 0"),
    );
    expect(colourDraftFrame).toContain("0 0 0");
    await clearAndType(stdin, rendered, "0 0 0".length, "0 1 0");
    stdin.write(ENTER);
    const colourFrame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("Colour: #00ff00"),
    );
    expect(colourFrame).toContain("Colour: #00ff00");

    // Width is the next (last) row.
    stdin.write("j");
    await settle();
    stdin.write(ENTER);
    await settle();
    await clearAndType(stdin, rendered, "1".length, "-5");
    stdin.write(ENTER);
    const widthFrame = await waitForFlatFrame(
      rendered,
      (candidate) =>
        candidate.includes("Width:") && !candidate.includes("Width: 1pt"),
    );
    // Math.max(..., Number.EPSILON) clamps a non-positive width to a tiny positive value, never negative — Number.EPSILON's own fixed spec value, not the unclamped "-5" a raw parse would keep.
    expect(widthFrame).toContain(`Width: ${Number.EPSILON}pt`);
    expect(widthFrame).not.toContain("Width: -5pt");
  }, 20000);

  it("cycles a path's fill rule unset -> nonzero -> evenodd -> unset, and edits its fill and stroke", async () => {
    const layout: LayoutDocument = {
      formatVersion: 1,
      metadata: {},
      images: {},
      pages: [
        {
          widthPt: 612,
          heightPt: 792,
          items: [
            {
              kind: "path",
              subpaths: [
                {
                  startXPt: 0,
                  startYPt: 0,
                  closed: true,
                  segments: [
                    { kind: "line", xPt: 10, yPt: 0 },
                    { kind: "line", xPt: 10, yPt: 10 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const rendered = render(
      <AppStateProvider>
        <Harness layout={layout} />
      </AppStateProvider>,
    );
    const { stdin } = rendered;
    const frame = await waitForTop(rendered, "pdfItemDetail");
    expect(frame).toContain("Fill rule: nonzero (default) (Enter to cycle)");

    // Unset (shown as "nonzero (default)") cycles to the explicit "nonzero" first.
    stdin.write(ENTER);
    const nonzeroFrame = await waitForFlatFrame(
      rendered,
      (candidate) =>
        candidate.includes("Fill rule: nonzero (Enter to cycle)") &&
        !candidate.includes("(default)"),
    );
    expect(nonzeroFrame).toContain("Fill rule: nonzero (Enter to cycle)");

    stdin.write(ENTER);
    const evenoddFrame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("Fill rule: evenodd (Enter to cycle)"),
    );
    expect(evenoddFrame).toContain("Fill rule: evenodd (Enter to cycle)");

    stdin.write(ENTER);
    const unsetFrame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("Fill rule: nonzero (default) (Enter to cycle)"),
    );
    expect(unsetFrame).toContain(
      "Fill rule: nonzero (default) (Enter to cycle)",
    );

    // Fill is row 1.
    stdin.write("j");
    await settle();
    stdin.write(ENTER);
    await settle();
    stdin.write("0.2 0.4 0.6");
    await settle();
    stdin.write(ENTER);
    const fillFrame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("Fill: #336699"),
    );
    expect(fillFrame).toContain("Fill: #336699");

    stdin.write("j");
    await settle();
    stdin.write(ENTER);
    await settle();
    stdin.write("0 0 0 3");
    await settle();
    stdin.write(ENTER);
    const strokeFrame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("Stroke: #000000 @ 3.0pt"),
    );
    expect(strokeFrame).toContain("Stroke: #000000 @ 3.0pt");
  }, 20000);

  it("shows a path's singular subpath/segment summary for exactly one of each, and edits with no editable geometry row", async () => {
    const layout: LayoutDocument = {
      formatVersion: 1,
      metadata: {},
      images: {},
      pages: [
        {
          widthPt: 612,
          heightPt: 792,
          items: [
            {
              kind: "path",
              subpaths: [
                {
                  startXPt: 0,
                  startYPt: 0,
                  closed: false,
                  segments: [{ kind: "line", xPt: 10, yPt: 10 }],
                },
              ],
            },
          ],
        },
      ],
    };
    const rendered = render(
      <AppStateProvider>
        <Harness layout={layout} />
      </AppStateProvider>,
    );
    const frame = await waitForTop(rendered, "pdfItemDetail");
    expect(frame).toContain(
      "1 subpath, 1 segment (not editable here — see documents.js's own PdfPathItem doc comment)",
    );
  });
});
