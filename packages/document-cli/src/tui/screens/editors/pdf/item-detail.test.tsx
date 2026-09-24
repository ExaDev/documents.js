import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PdfEditor,
  type LayoutDocument,
  type LayoutImageAsset,
} from "documents.js";
import { Box, Text } from "ink";
import { render } from "ink-testing-library";
import type { ReactElement } from "react";
import { useEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AppStateProvider,
  useAppDispatch,
  useAppState,
} from "../../../state/context.js";
import { currentScreen, type PdfOpenDocument } from "../../../state/types.js";
import { flattenFrame, settle, waitForFrame } from "../../../test-support.js";
import { PdfItemDetailScreen } from "./item-detail.js";
import { PdfHarness } from "./test-support.js";

const ENTER = "\r";
const ESCAPE = "\u001B";
const BACKSPACE = "\x7f";

// The item-detail screen's own header row renders a genuine em dash (U+2014) between the item index and its kind; asserting against the same code point (rather than a literal character in this source file) keeps the fixture unambiguous in any editor or terminal.
const EM_DASH = "\u2014";

// A real, minimal 1x1 PNG, registered under imageId "logo" — writePdf (called by mutate()'s own undo-snapshot step on every dispatch, not just an explicit save) throws "LayoutDocument references image ... but it is not present in images" for an image item whose imageId has no matching registry entry, so any test that DISPATCHES against an image item (not merely renders its read-only dump) needs a genuine entry here, not an empty `images: {}`.
const LOGO_IMAGE_ASSET: LayoutImageAsset = {
  format: "png",
  base64:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  widthPx: 1,
  heightPx: 1,
};

// A second, real, genuinely decodable 1x1 PNG (a plain red pixel, distinct content from LOGO_IMAGE_ASSET's own bytes so registerImageBytes' crc32-derived id actually differs) — for the "replace image" flow, which calls decodePng on whatever bytes it reads off disk to recover width/height (see documents.js's own registerImageBytes), unlike a docx/odt image insertion's own PNG fixture (paragraph-detail.test.tsx's PNG_BYTES) which never decodes pixels since a docx/odt image's own width/height come from the wizard's typed fields instead. A signature-only stub (the docx fixture's own shape) throws here.
const REPLACEMENT_PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);

interface Stdin {
  readonly write: (data: string) => void;
}
type LastFrame = () => string | undefined;

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
async function openReadOnlyDetail(
  stdin: Stdin,
  lastFrame: LastFrame,
): Promise<string> {
  await waitForFrame(lastFrame, (candidate) => candidate.includes("Page 1"));
  await settle();
  stdin.write(ENTER);
  await waitForFrame(lastFrame, (candidate) =>
    candidate.includes("Page 1 items"),
  );
  await settle();
  stdin.write(ENTER);
  return waitForFrame(lastFrame, (candidate) =>
    candidate.includes("Page 1, item 1"),
  );
}

describe("PdfItemDetailScreen read-only field dump (an xlsx/csv/svg/... preview, no live PdfEditor)", () => {
  it("dumps every optional text field when they are all set, on top of the always-present ones", async () => {
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
              kind: "text",
              text: "Hello",
              xPt: 10,
              yPt: 20,
              font: { family: "Helvetica", weight: "bold", style: "italic" },
              sizePt: 12,
              color: { r: 0, g: 0, b: 0 },
              widthPt: 90,
              rotationDeg: 15,
              underline: true,
              sourcePath: "body/p[0]",
            },
          ],
        },
      ],
    };
    const { lastFrame, stdin } = render(
      <PdfHarness layout={layout} format="xlsx" />,
    );
    const frame = await openReadOnlyDetail(stdin, lastFrame);
    expect(frame).toContain("Width: 90pt");
    expect(frame).toContain("Rotation: 15°");
    expect(frame).toContain("Underline: yes");
    expect(frame).toContain("Source path: body/p[0]");
  });

  it("omits every optional text field when none of them are set", async () => {
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
              kind: "text",
              text: "Plain",
              xPt: 0,
              yPt: 0,
              font: { family: "Helvetica", weight: "normal", style: "normal" },
              sizePt: 10,
              color: { r: 0, g: 0, b: 0 },
            },
          ],
        },
      ],
    };
    const { lastFrame, stdin } = render(
      <PdfHarness layout={layout} format="xlsx" />,
    );
    const frame = await openReadOnlyDetail(stdin, lastFrame);
    expect(frame).not.toContain("Width:");
    expect(frame).not.toContain("Rotation:");
    expect(frame).not.toContain("Underline:");
    expect(frame).not.toContain("Source path:");
  });

  it("dumps an image item's fields including rotation and source path when set", async () => {
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
              kind: "image",
              imageId: "logo",
              xPt: 10,
              yPt: 700,
              widthPt: 50,
              heightPt: 25,
              rotationDeg: 5,
              sourcePath: "body/img[0]",
            },
          ],
        },
      ],
    };
    const { lastFrame, stdin } = render(
      <PdfHarness layout={layout} format="xlsx" />,
    );
    const frame = await openReadOnlyDetail(stdin, lastFrame);
    expect(frame).toContain("Kind: image");
    expect(frame).toContain("Image ID: logo");
    expect(frame).toContain("Position: (10.0, 700.0)pt");
    expect(frame).toContain("Size: 50×25pt");
    expect(frame).toContain("Rotation: 5°");
    expect(frame).toContain("Source path: body/img[0]");
  });

  it("omits rotation from an image item's dump when unset", async () => {
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
              kind: "image",
              imageId: "logo",
              xPt: 0,
              yPt: 0,
              widthPt: 10,
              heightPt: 10,
            },
          ],
        },
      ],
    };
    const { lastFrame, stdin } = render(
      <PdfHarness layout={layout} format="xlsx" />,
    );
    const frame = await openReadOnlyDetail(stdin, lastFrame);
    expect(frame).not.toContain("Rotation:");
  });

  it("dumps a rect item with fill and stroke both set", async () => {
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
              widthPt: 200,
              heightPt: 100,
              fill: { r: 0.9, g: 0.9, b: 0.9 },
              stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1.5 },
            },
          ],
        },
      ],
    };
    const { lastFrame, stdin } = render(
      <PdfHarness layout={layout} format="xlsx" />,
    );
    const frame = await openReadOnlyDetail(stdin, lastFrame);
    expect(frame).toContain("Kind: rect");
    expect(frame).toContain("Position: (0.0, 0.0)pt");
    expect(frame).toContain("Size: 200×100pt");
    expect(frame).toContain("Fill: #e6e6e6");
    expect(frame).toContain("Stroke: #000000 @ 1.5pt");
  });

  it("omits fill and stroke from a rect item's dump when neither is set", async () => {
    const layout: LayoutDocument = {
      formatVersion: 1,
      metadata: {},
      images: {},
      pages: [
        {
          widthPt: 612,
          heightPt: 792,
          items: [{ kind: "rect", xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }],
        },
      ],
    };
    const { lastFrame, stdin } = render(
      <PdfHarness layout={layout} format="xlsx" />,
    );
    const frame = await openReadOnlyDetail(stdin, lastFrame);
    expect(frame).not.toContain("Fill:");
    expect(frame).not.toContain("Stroke:");
  });

  it("dumps an ellipse item, reaching the same fieldsFor branch as rect but its own distinct case label", async () => {
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
              kind: "ellipse",
              xPt: 20,
              yPt: 20,
              widthPt: 40,
              heightPt: 40,
              fill: { r: 0.1, g: 0.2, b: 0.3 },
            },
          ],
        },
      ],
    };
    const { lastFrame, stdin } = render(
      <PdfHarness layout={layout} format="xlsx" />,
    );
    const frame = await openReadOnlyDetail(stdin, lastFrame);
    expect(frame).toContain("Kind: ellipse");
    expect(frame).toContain("Size: 40×40pt");
    expect(frame).toContain("Fill: #1a334d");
    expect(frame).not.toContain("Stroke:");
  });

  it("dumps a line item's from/to/colour/width fields", async () => {
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
              y2Pt: 50,
              color: { r: 0, g: 0, b: 0 },
              widthPt: 2,
            },
          ],
        },
      ],
    };
    const { lastFrame, stdin } = render(
      <PdfHarness layout={layout} format="xlsx" />,
    );
    const frame = await openReadOnlyDetail(stdin, lastFrame);
    expect(frame).toContain("Kind: line");
    expect(frame).toContain("From: (0.0, 0.0)pt");
    expect(frame).toContain("To: (100.0, 50.0)pt");
    expect(frame).toContain("Colour: #000000");
    expect(frame).toContain("Width: 2pt");
  });

  it("dumps a path item with fill, fill rule, and stroke all set", async () => {
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
              fill: { r: 0.4, g: 0.5, b: 0.6 },
              fillRule: "evenodd",
              stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
            },
          ],
        },
      ],
    };
    const { lastFrame, stdin } = render(
      <PdfHarness layout={layout} format="xlsx" />,
    );
    const frame = await openReadOnlyDetail(stdin, lastFrame);
    expect(frame).toContain("Kind: path");
    expect(frame).toContain("Subpaths: 1");
    expect(frame).toContain("Segments: 2");
    expect(frame).toContain("Fill: #668099");
    expect(frame).toContain("Fill rule: evenodd");
    expect(frame).toContain("Stroke: #000000 @ 1.0pt");
  });

  it("omits fill, fill rule, and stroke from a path item's dump when none are set", async () => {
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
    const { lastFrame, stdin } = render(
      <PdfHarness layout={layout} format="xlsx" />,
    );
    const frame = await openReadOnlyDetail(stdin, lastFrame);
    expect(frame).toContain("Subpaths: 1");
    expect(frame).toContain("Segments: 1");
    expect(frame).not.toContain("Fill:");
    expect(frame).not.toContain("Fill rule:");
    expect(frame).not.toContain("Stroke:");
  });

  it("dumps a link item's uri/position/size fields", async () => {
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
              kind: "link",
              uri: "https://example.com/",
              xPt: 5,
              yPt: 5,
              widthPt: 60,
              heightPt: 15,
            },
          ],
        },
      ],
    };
    const { lastFrame, stdin } = render(
      <PdfHarness layout={layout} format="xlsx" />,
    );
    const frame = await openReadOnlyDetail(stdin, lastFrame);
    expect(frame).toContain("Kind: link");
    expect(frame).toContain("URI: https://example.com/");
    expect(frame).toContain("Position: (5.0, 5.0)pt");
    expect(frame).toContain("Size: 60×15pt");
  });

  it("dumps an internalLink item's destination/title/position/size fields, and never a Source path row", async () => {
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
              kind: "internalLink",
              destination: "chapter-2",
              title: "Go to chapter 2",
              xPt: 5,
              yPt: 5,
              widthPt: 60,
              heightPt: 15,
            },
          ],
        },
      ],
    };
    const { lastFrame, stdin } = render(
      <PdfHarness layout={layout} format="xlsx" />,
    );
    const frame = await openReadOnlyDetail(stdin, lastFrame);
    expect(frame).toContain("Kind: internalLink");
    expect(frame).toContain("Destination: chapter-2");
    expect(frame).toContain("Title: Go to chapter 2");
    expect(frame).toContain("Position: (5.0, 5.0)pt");
    expect(frame).toContain("Size: 60×15pt");
    expect(frame).not.toContain("Source path:");
  });

  it("omits the title row from an internalLink item's dump when unset", async () => {
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
              kind: "internalLink",
              destination: "chapter-3",
              xPt: 0,
              yPt: 0,
              widthPt: 10,
              heightPt: 10,
            },
          ],
        },
      ],
    };
    const { lastFrame, stdin } = render(
      <PdfHarness layout={layout} format="xlsx" />,
    );
    const frame = await openReadOnlyDetail(stdin, lastFrame);
    expect(frame).not.toContain("Title:");
  });

  it.each([
    ["Escape", ESCAPE],
    ["the left arrow", "\u001B[D"],
    ["h", "h"],
  ] as const)(
    "pops the screen on %s from the read-only dump",
    async (_label, key) => {
      const layout: LayoutDocument = {
        formatVersion: 1,
        metadata: {},
        images: {},
        pages: [
          {
            widthPt: 612,
            heightPt: 792,
            items: [
              { kind: "rect", xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
            ],
          },
        ],
      };
      const { lastFrame, stdin } = render(
        <PdfHarness layout={layout} format="xlsx" />,
      );
      await openReadOnlyDetail(stdin, lastFrame);
      stdin.write(key);
      const after = await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("Page 1 items"),
      );
      expect(after).toContain("Page 1 items");
    },
  );

  it("does not pop the screen on an unrelated key from the read-only dump", async () => {
    const layout: LayoutDocument = {
      formatVersion: 1,
      metadata: {},
      images: {},
      pages: [
        {
          widthPt: 612,
          heightPt: 792,
          items: [{ kind: "rect", xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }],
        },
      ],
    };
    const { lastFrame, stdin } = render(
      <PdfHarness layout={layout} format="xlsx" />,
    );
    const frame = await openReadOnlyDetail(stdin, lastFrame);
    stdin.write("x");
    await settle();
    expect(lastFrame()).toBe(frame);
  });
});

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

  it("shows a path's plural subpath/segment summary for more than one of each", async () => {
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
                {
                  startXPt: 20,
                  startYPt: 20,
                  closed: true,
                  segments: [{ kind: "line", xPt: 30, yPt: 20 }],
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
      "2 subpaths, 3 segments (not editable here — see documents.js's own PdfPathItem doc comment)",
    );
  });

  it("edits an image's frame and rotation fields, showing 'unset' when rotation is absent", async () => {
    const layout: LayoutDocument = {
      formatVersion: 1,
      metadata: {},
      images: { logo: LOGO_IMAGE_ASSET },
      pages: [
        {
          widthPt: 612,
          heightPt: 792,
          items: [
            {
              kind: "image",
              imageId: "logo",
              xPt: 0,
              yPt: 0,
              widthPt: 20,
              heightPt: 20,
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
    expect(frame).toContain(`Page 1, item 1 ${EM_DASH} image`);
    expect(frame).toContain("Image ID: logo");
    expect(frame).toContain("Rotation: unset");

    // Width is row 2 (X, Y, Width, Height, Rotation, Replace image...).
    stdin.write("j");
    await settle();
    stdin.write("j");
    await settle();
    stdin.write(ENTER);
    await settle();
    await clearAndType(stdin, rendered, "20".length, "45");
    stdin.write(ENTER);
    const widthFrame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("Width: 45.0pt"),
    );
    expect(widthFrame).toContain("Width: 45.0pt");

    // Rotation is two more rows down from Width.
    stdin.write("j");
    await settle();
    stdin.write("j");
    await settle();
    stdin.write(ENTER);
    await settle();
    stdin.write("30");
    await settle();
    stdin.write(ENTER);
    const rotationFrame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("Rotation: 30°"),
    );
    expect(rotationFrame).toContain("Rotation: 30°");

    // Appending "5" with no prior clear proves the draft was genuinely pre-filled with "30" (the set rotation's own currentValue): the cursor sits after seeded text, so typing appends onto it, producing "305" rather than a bare "5" a wrongly-blank pre-fill would leave.
    stdin.write(ENTER);
    await settle();
    stdin.write("5");
    await waitForFlatFrame(rendered, (candidate) => candidate.includes("305"));
    stdin.write(ENTER);
    const appendedFrame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("Rotation: 305°"),
    );
    expect(appendedFrame).toContain("Rotation: 305°");

    // Clearing it back to blank restores 'unset'.
    stdin.write(ENTER);
    await settle();
    await clearAndType(rendered.stdin, rendered, "305".length, "");
    stdin.write(ENTER);
    const clearedFrame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("Rotation: unset"),
    );
    expect(clearedFrame).toContain("Rotation: unset");
  }, 20000);

  describe("image replace flow", () => {
    let workspace: string;

    beforeEach(async () => {
      workspace = await mkdtemp(join(tmpdir(), "document-cli-pdf-image-"));
    });

    afterEach(async () => {
      await rm(workspace, { recursive: true, force: true });
    });

    it("reads a real file off disk and replaces the item's image, registering a new imageId", async () => {
      const imagePath = join(workspace, "new.png");
      await writeFile(imagePath, REPLACEMENT_PNG_BYTES);
      const layout: LayoutDocument = {
        formatVersion: 1,
        metadata: {},
        images: { logo: LOGO_IMAGE_ASSET },
        pages: [
          {
            widthPt: 612,
            heightPt: 792,
            items: [
              {
                kind: "image",
                imageId: "logo",
                xPt: 0,
                yPt: 0,
                widthPt: 20,
                heightPt: 20,
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
      expect(frame).toContain("imageId:logo");

      // Replace image... is the last row (X, Y, Width, Height, Rotation, Replace image...).
      for (let step = 0; step < 5; step += 1) {
        stdin.write("j");
        await settle();
      }
      stdin.write(ENTER);
      await waitForFlatFrame(rendered, (candidate) =>
        candidate.includes("Image file path"),
      );
      await settle();
      stdin.write(imagePath);
      await waitForFlatFrame(rendered, (candidate) =>
        candidate.includes(imagePath),
      );
      stdin.write(ENTER);

      const after = await waitForFlatFrame(
        rendered,
        (candidate) =>
          candidate.includes("imageId:") && !candidate.includes("imageId:logo"),
      );
      // Proves the wizard's own onComplete callback actually ran setReplacingImage(false) after the dispatch resolved, not merely that the dispatch itself landed: the wizard's own path-input box would still be showing here otherwise.
      expect(after).toContain("Enter to edit a field, Esc to go back");
      expect(after).not.toContain("Image file path");
    }, 20000);

    it("warns and does not replace the image for a non-image file extension", async () => {
      const layout: LayoutDocument = {
        formatVersion: 1,
        metadata: {},
        images: { logo: LOGO_IMAGE_ASSET },
        pages: [
          {
            widthPt: 612,
            heightPt: 792,
            items: [
              {
                kind: "image",
                imageId: "logo",
                xPt: 0,
                yPt: 0,
                widthPt: 20,
                heightPt: 20,
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
      await waitForTop(rendered, "pdfItemDetail");
      for (let step = 0; step < 5; step += 1) {
        stdin.write("j");
        await settle();
      }
      stdin.write(ENTER);
      await waitForFlatFrame(rendered, (candidate) =>
        candidate.includes("Image file path"),
      );
      await settle();
      stdin.write("/not/a/real/file.txt");
      await waitForFlatFrame(rendered, (candidate) =>
        candidate.includes("/not/a/real/file.txt"),
      );
      stdin.write(ENTER);

      const after = await waitForFlatFrame(rendered, (candidate) =>
        candidate.includes("is not a .png or .jpg/.jpeg file"),
      );
      expect(after).toContain("image not replaced");
      expect(after).toContain("imageId:logo");
    }, 20000);

    it("reports an error and does not replace the image when the file cannot be read", async () => {
      const layout: LayoutDocument = {
        formatVersion: 1,
        metadata: {},
        images: { logo: LOGO_IMAGE_ASSET },
        pages: [
          {
            widthPt: 612,
            heightPt: 792,
            items: [
              {
                kind: "image",
                imageId: "logo",
                xPt: 0,
                yPt: 0,
                widthPt: 20,
                heightPt: 20,
              },
            ],
          },
        ],
      };
      // A short, fixed path rather than one built from the mkdtemp workspace: a long temp-dir-rooted path routinely runs past the injected stdout's 100-column width and gets word-wrapped mid-character (splitting even a space-free path like this one), which flattenFrame turns into a literal substring mismatch — see test-support.ts's own documented wrap risk.
      const missingPath = "/nonexistent-document-cli-fixture/missing.png";
      const rendered = render(
        <AppStateProvider>
          <Harness layout={layout} />
        </AppStateProvider>,
      );
      const { stdin } = rendered;
      await waitForTop(rendered, "pdfItemDetail");
      for (let step = 0; step < 5; step += 1) {
        stdin.write("j");
        await settle();
      }
      stdin.write(ENTER);
      await waitForFlatFrame(rendered, (candidate) =>
        candidate.includes("Image file path"),
      );
      await settle();
      stdin.write(missingPath);
      await waitForFlatFrame(rendered, (candidate) =>
        candidate.includes(missingPath),
      );
      stdin.write(ENTER);

      const after = await waitForFlatFrame(rendered, (candidate) =>
        candidate.includes("Could not read"),
      );
      expect(after).toContain(`Could not read ${missingPath}`);
      expect(after).toContain("imageId:logo");
    }, 20000);

    it("cancels the replace-image wizard on Escape, leaving the item unchanged", async () => {
      const layout: LayoutDocument = {
        formatVersion: 1,
        metadata: {},
        images: { logo: LOGO_IMAGE_ASSET },
        pages: [
          {
            widthPt: 612,
            heightPt: 792,
            items: [
              {
                kind: "image",
                imageId: "logo",
                xPt: 0,
                yPt: 0,
                widthPt: 20,
                heightPt: 20,
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
      await waitForTop(rendered, "pdfItemDetail");
      for (let step = 0; step < 5; step += 1) {
        stdin.write("j");
        await settle();
      }
      stdin.write(ENTER);
      await waitForFlatFrame(rendered, (candidate) =>
        candidate.includes("Image file path"),
      );
      stdin.write(ESCAPE);
      const after = await waitForFlatFrame(rendered, (candidate) =>
        candidate.includes("Enter to edit a field, Esc to go back"),
      );
      expect(after).toContain("imageId:logo");
    }, 20000);
  });

  it("edits a link's URI and frame fields", async () => {
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
              kind: "link",
              uri: "https://example.com/",
              xPt: 0,
              yPt: 0,
              widthPt: 10,
              heightPt: 10,
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
    expect(frame).toContain("URI: https://example.com/");

    stdin.write(ENTER);
    await settle();
    await clearAndType(
      stdin,
      rendered,
      "https://example.com/".length,
      "https://other.example/",
    );
    stdin.write(ENTER);
    const uriFrame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("URI: https://other.example/"),
    );
    expect(uriFrame).toContain("URI: https://other.example/");

    // X is row 1 from URI.
    stdin.write("j");
    await settle();
    stdin.write(ENTER);
    await settle();
    await clearAndType(stdin, rendered, "0".length, "15");
    stdin.write(ENTER);
    const xFrame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("X: 15.0pt"),
    );
    expect(xFrame).toContain("X: 15.0pt");
  }, 20000);

  it("edits an internalLink's destination and frame fields", async () => {
    const layout: LayoutDocument = {
      formatVersion: 1,
      metadata: {},
      images: {},
      // mutate()'s own undo-snapshot step calls writePdf on every dispatch, which validates every internalLink's destination against this table — both the fixture's starting name and the one the test renames it to need an entry, or the very first (and every later) commit throws "the document's destinations table does not carry" this destination.
      destinations: [
        { name: "chapter-1", pageIndex: 0, target: { kind: "fit" } },
        { name: "chapter-9", pageIndex: 0, target: { kind: "fit" } },
      ],
      pages: [
        {
          widthPt: 612,
          heightPt: 792,
          items: [
            {
              kind: "internalLink",
              destination: "chapter-1",
              xPt: 0,
              yPt: 0,
              widthPt: 10,
              heightPt: 10,
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
    expect(frame).toContain("Destination: chapter-1");

    stdin.write(ENTER);
    await settle();
    await clearAndType(stdin, rendered, "chapter-1".length, "chapter-9");
    stdin.write(ENTER);
    const destFrame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("Destination: chapter-9"),
    );
    expect(destFrame).toContain("Destination: chapter-9");

    // Height is the last frame row.
    for (let step = 0; step < 4; step += 1) {
      stdin.write("j");
      await settle();
    }
    stdin.write(ENTER);
    await settle();
    await clearAndType(stdin, rendered, "10".length, "35");
    stdin.write(ENTER);
    const heightFrame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("Height: 35.0pt"),
    );
    expect(heightFrame).toContain("Height: 35.0pt");
  }, 20000);

  it("cancels an in-progress field edit on Escape without committing anything", async () => {
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
    await waitForTop(rendered, "pdfItemDetail");
    stdin.write(ENTER);
    await settle();
    stdin.write("9 9 9");
    await settle();
    stdin.write(ESCAPE);

    const frame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("Enter to edit a field, Esc to go back"),
    );
    expect(frame).toContain("X: 0.0pt");
  });

  it("pops the screen on Escape from the row list", async () => {
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
    await waitForTop(rendered, "pdfItemDetail");
    stdin.write(ESCAPE);

    const frame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("top:pdfPageList"),
    );
    expect(frame).toContain("top:pdfPageList");
  });
});
