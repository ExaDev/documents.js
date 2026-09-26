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
