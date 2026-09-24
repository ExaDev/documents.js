import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LayoutDocument, LayoutImageAsset } from "documents.js";
import { render } from "ink-testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flattenFrame, settle, waitForFrame } from "../../../test-support.js";
import { PdfHarness } from "./test-support.js";

const ENTER = "\r";
const ESCAPE = "\u001B";
// The item-detail screen's own header row and this screen's own list-item preview both render a genuine em dash (U+2014) as a separator; asserting against the same code point (rather than a literal character in this source file) keeps the fixture unambiguous in any editor or terminal.
const EM_DASH = String.fromCharCode(8212);

// A real, minimal 1x1 PNG, matching item-detail.test.tsx's own LOGO_IMAGE_ASSET fixture (and for the identical reason: mutate()'s own undo-snapshot writePdf call throws for an image item whose imageId has no matching registry entry).
const LOGO_IMAGE_ASSET: LayoutImageAsset = {
  format: "png",
  base64:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  widthPx: 1,
  heightPx: 1,
};

// A real, genuinely decodable 1x1 PNG (registerImageBytes calls decodeImageDimensions, unlike the odt/docx/ods image-insertion flows, which take their width/height from the wizard's own typed fields instead) — matching item-detail.test.tsx's own REPLACEMENT_PNG_BYTES fixture, base64-decoded once at module load.
const PNG_BYTES = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
    "base64",
  ),
);

// One item of every LayoutItem kind previewFor branches on, so a single render proves every one of its own preview strings.
const RICH_LAYOUT: LayoutDocument = {
  formatVersion: 1,
  metadata: {},
  images: { logo: LOGO_IMAGE_ASSET },
  pages: [
    {
      widthPt: 612,
      heightPt: 792,
      items: [
        {
          kind: "text",
          text: "Hello, this is a fairly long paragraph of body text that runs well past forty eight characters",
          xPt: 10,
          yPt: 700,
          font: { family: "Helvetica", weight: "normal", style: "normal" },
          sizePt: 12,
          color: { r: 0, g: 0, b: 0 },
        },
        {
          kind: "link",
          uri: "https://example.com/",
          xPt: 5,
          yPt: 5,
          widthPt: 60,
          heightPt: 15,
        },
        {
          kind: "internalLink",
          destination: "chapter-2",
          xPt: 5,
          yPt: 5,
          widthPt: 60,
          heightPt: 15,
        },
        {
          kind: "image",
          imageId: "logo",
          xPt: 10,
          yPt: 600,
          widthPt: 50,
          heightPt: 25,
        },
        { kind: "rect", xPt: 0, yPt: 0, widthPt: 30, heightPt: 20 },
        { kind: "ellipse", xPt: 0, yPt: 0, widthPt: 40, heightPt: 40 },
        {
          kind: "line",
          x1Pt: 0,
          y1Pt: 0,
          x2Pt: 100,
          y2Pt: 50,
          color: { r: 0, g: 0, b: 0 },
          widthPt: 1,
        },
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

// A single-item layout, the shape most delete/add/search tests need: a rich multi-kind page would make "which item is selected/removed" assertions ambiguous.
function singleItemLayout(): LayoutDocument {
  return {
    formatVersion: 1,
    metadata: {},
    images: {},
    pages: [
      {
        widthPt: 612,
        heightPt: 792,
        items: [{ kind: "rect", xPt: 0, yPt: 0, widthPt: 30, heightPt: 20 }],
      },
    ],
  };
}

function emptyLayout(): LayoutDocument {
  return {
    formatVersion: 1,
    metadata: {},
    images: {},
    pages: [{ widthPt: 612, heightPt: 792, items: [] }],
  };
}

async function openPageItems(
  stdin: { readonly write: (data: string) => void },
  lastFrame: () => string | undefined,
): Promise<string> {
  await waitForFrame(lastFrame, (candidate) => candidate.includes("Page 1"));
  await settle();
  stdin.write(ENTER);
  return waitForFrame(lastFrame, (candidate) =>
    candidate.includes("Page 1 items"),
  );
}

describe("PdfPageItemsScreen", () => {
  it("previews every item kind with its own kind label and dimension/text summary", async () => {
    const { lastFrame, stdin } = render(
      <PdfHarness layout={RICH_LAYOUT} format="xlsx" />,
    );
    const frame = await openPageItems(stdin, lastFrame);
    const flat = flattenFrame(frame);
    expect(flat).toContain(`1. text ${EM_DASH} Hello, this is a fairly long`);
    // The text preview truncates at 48 characters with a trailing ellipsis, so the full sentence must not appear.
    expect(flat).not.toContain("past forty eight characters");
    expect(flat).toContain(`2. link ${EM_DASH} https://example.com/`);
    expect(flat).toContain(`3. internalLink ${EM_DASH} → chapter-2`);
    expect(flat).toContain(`4. image ${EM_DASH} 50×25pt`);
    expect(flat).toContain(`5. rect ${EM_DASH} 30×20pt`);
    expect(flat).toContain(`6. ellipse ${EM_DASH} 40×40pt`);
    expect(flat).toContain(`7. line ${EM_DASH} 100×50pt`);
    // The path's own bounding box: x runs 0 to 10, y runs 0 to 10.
    expect(flat).toContain(`8. path ${EM_DASH} 10×10pt`);
    expect(frame).toContain("Page 1 items (8 of 8)");
  });

  it("reports an empty path's bounding box as 'empty path' rather than a bogus negative size", async () => {
    const layout: LayoutDocument = {
      formatVersion: 1,
      metadata: {},
      images: {},
      pages: [
        {
          widthPt: 612,
          heightPt: 792,
          items: [{ kind: "path", subpaths: [] }],
        },
      ],
    };
    const { lastFrame, stdin } = render(
      <PdfHarness layout={layout} format="xlsx" />,
    );
    const frame = await openPageItems(stdin, lastFrame);
    expect(flattenFrame(frame)).toContain(`1. path ${EM_DASH} empty path`);
  });

  it("navigates to the item-detail screen for the selected item on Enter", async () => {
    const { lastFrame, stdin } = render(
      <PdfHarness layout={RICH_LAYOUT} format="xlsx" />,
    );
    await openPageItems(stdin, lastFrame);
    await settle();

    stdin.write("j");
    await settle();
    stdin.write(ENTER);
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Page 1, item 2"),
    );
    expect(frame).toContain("Kind: link");
  });

  it("pops back to the page list on Escape", async () => {
    const { lastFrame, stdin } = render(
      <PdfHarness layout={RICH_LAYOUT} format="xlsx" />,
    );
    await openPageItems(stdin, lastFrame);
    await settle();

    stdin.write(ESCAPE);
    const frame = await waitForFrame(
      lastFrame,
      (candidate) =>
        candidate.includes("Page 1") && !candidate.includes("Page 1 items"),
    );
    expect(frame).toBeDefined();
  });

  it("shows a format-appropriate empty message, and no add/delete hint, for a non-editable xlsx preview", async () => {
    const { lastFrame, stdin } = render(
      <PdfHarness layout={emptyLayout()} format="xlsx" />,
    );
    const frame = await openPageItems(stdin, lastFrame);
    expect(frame).toContain("This page has no items.");
    expect(frame).not.toContain("press 'a' to add one");
    expect(frame).not.toContain("a to add an item, d to delete");
  });

  it("shows the add-item hint for an empty page on a genuine editable pdf document", async () => {
    const { lastFrame, stdin } = render(
      <PdfHarness layout={emptyLayout()} format="pdf" />,
    );
    const frame = await openPageItems(stdin, lastFrame);
    expect(frame).toContain(
      `This page has no items ${EM_DASH} press 'a' to add one`,
    );
  });

  describe("editable pdf document", () => {
    it("deletes the selected item on 'd' and shows the empty-page message once none remain", async () => {
      const { lastFrame, stdin } = render(
        <PdfHarness layout={singleItemLayout()} format="pdf" />,
      );
      const frame = await openPageItems(stdin, lastFrame);
      expect(frame).toContain("Page 1 items (1 of 1)");
      expect(frame).toContain(
        "a to add an item, d to delete the selected item",
      );

      stdin.write("d");
      const after = await waitForFrame(lastFrame, (candidate) =>
        candidate.includes(
          `This page has no items ${EM_DASH} press 'a' to add one`,
        ),
      );
      expect(after).toContain("Page 1 items (0 of 0)");
    });

    it("never dispatches REMOVE_PDF_ITEM for a non-editable xlsx preview: 'd' does nothing", async () => {
      const { lastFrame, stdin } = render(
        <PdfHarness layout={singleItemLayout()} format="xlsx" />,
      );
      const frame = await openPageItems(stdin, lastFrame);
      expect(frame).toContain("Page 1 items (1 of 1)");

      stdin.write("d");
      await settle();
      expect(lastFrame()).toContain("Page 1 items (1 of 1)");
    });

    it("cancels the add-item flow on Escape from the kind list without dispatching anything", async () => {
      const { lastFrame, stdin } = render(
        <PdfHarness layout={emptyLayout()} format="pdf" />,
      );
      await openPageItems(stdin, lastFrame);
      await settle();

      stdin.write("a");
      await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("Add item"),
      );
      await settle();
      stdin.write(ESCAPE);
      const frame = await waitForFrame(
        lastFrame,
        (candidate) => !candidate.includes("Add item"),
      );
      expect(frame).toContain("This page has no items");
    });

    it("walks the add-item wizard for a text item and dispatches ADD_PDF_TEXT, landing the new item in the list", async () => {
      const { lastFrame, stdin } = render(
        <PdfHarness layout={emptyLayout()} format="pdf" />,
      );
      await openPageItems(stdin, lastFrame);
      await settle();

      stdin.write("a");
      const kindList = await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("Add item"),
      );
      expect(kindList).toContain("Text");
      await settle();

      // "Text" is the first (already selected) option in ADD_KIND_OPTIONS.
      stdin.write(ENTER);
      await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("X (pt)"),
      );
      await settle();
      // Accept the X/Y defaults.
      stdin.write(ENTER);
      await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("Y (pt)"),
      );
      await settle();
      stdin.write(ENTER);
      await waitForFrame(
        lastFrame,
        (candidate) =>
          candidate.includes("Text") && candidate.includes("Step 3 of 8"),
      );
      await settle();

      // The "text" field defaults to "Text" (not empty) — clear it with real backspaces before typing, matching this suite's own established pattern for a pre-filled field.
      let remaining = "Text".length;
      while (remaining > 0) {
        stdin.write("\x7F");
        await settle();
        remaining -= 1;
      }
      stdin.write("Greetings");
      await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("Greetings"),
      );
      await settle();
      stdin.write(ENTER);
      await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("Font family"),
      );
      await settle();
      // Accept the remaining defaults: font family, weight, style, size, colour.
      stdin.write(ENTER);
      await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("Font weight"),
      );
      await settle();
      stdin.write(ENTER);
      await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("Font style"),
      );
      await settle();
      stdin.write(ENTER);
      await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("Size (pt)"),
      );
      await settle();
      stdin.write(ENTER);
      await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("Colour"),
      );
      await settle();
      stdin.write(ENTER);

      const frame = await waitForFrame(
        lastFrame,
        (candidate) => candidate.includes("Page 1 items (1 of 1)"),
        6000,
      );
      expect(flattenFrame(frame)).toContain(`1. text ${EM_DASH} Greetings`);
    });
  });

  describe("add-item image kind", () => {
    let workspace: string;

    beforeEach(async () => {
      workspace = await mkdtemp(join(tmpdir(), "document-cli-pdf-image-"));
    });

    afterEach(async () => {
      await rm(workspace, { recursive: true, force: true });
    });

    it("reads a real file off disk and dispatches ADD_PDF_IMAGE", async () => {
      const imagePath = join(workspace, "fixture.png");
      await writeFile(imagePath, PNG_BYTES);

      const { lastFrame, stdin } = render(
        <PdfHarness layout={emptyLayout()} format="pdf" />,
      );
      await openPageItems(stdin, lastFrame);
      await settle();

      stdin.write("a");
      await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("Add item"),
      );
      await settle();
      // Image is the sixth option (index 5): text, rect, ellipse, line, path, image.
      for (let step = 0; step < 5; step += 1) {
        stdin.write("j");
        await settle();
      }
      stdin.write(ENTER);
      await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("X (pt)"),
      );
      await settle();
      stdin.write(ENTER);
      await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("Y (pt)"),
      );
      await settle();
      stdin.write(ENTER);
      await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("Width (pt)"),
      );
      await settle();
      stdin.write(ENTER);
      await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("Height (pt)"),
      );
      await settle();
      stdin.write(ENTER);
      await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("Image file path"),
      );
      await settle();

      stdin.write(imagePath);
      await waitForFrame(lastFrame, (candidate) =>
        flattenFrame(candidate).includes(imagePath),
      );
      await settle();
      await new Promise((resolve) => {
        setTimeout(resolve, 500);
      });
      stdin.write(ENTER);

      const frame = await waitForFrame(
        lastFrame,
        (candidate) => candidate.includes("Page 1 items (1 of 1)"),
        6000,
      );
      expect(flattenFrame(frame)).toContain(`1. image ${EM_DASH} 160×100pt`);
    }, 20000);

    it("reports a warning and adds no item for a non .png/.jpg/.jpeg file extension", async () => {
      const { lastFrame, stdin } = render(
        <PdfHarness layout={emptyLayout()} format="pdf" />,
      );
      await openPageItems(stdin, lastFrame);
      await settle();

      stdin.write("a");
      await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("Add item"),
      );
      await settle();
      for (let step = 0; step < 5; step += 1) {
        stdin.write("j");
        await settle();
      }
      stdin.write(ENTER);
      await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("X (pt)"),
      );
      await settle();
      stdin.write(ENTER);
      await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("Y (pt)"),
      );
      await settle();
      stdin.write(ENTER);
      await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("Width (pt)"),
      );
      await settle();
      stdin.write(ENTER);
      await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("Height (pt)"),
      );
      await settle();
      stdin.write(ENTER);
      await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("Image file path"),
      );
      await settle();

      stdin.write("/not/a/real/file.txt");
      await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("file.txt"),
      );
      await settle();
      stdin.write(ENTER);

      // PdfHarness renders only the raw screen component, with no wrapping StatusLine, so the SET_STATUS warning applyAddKind dispatches for a rejected extension isn't observable here; what IS observable, and is this test's own point, is that no image item was actually added.
      const frame = await waitForFrame(
        lastFrame,
        (candidate) => candidate.includes("Page 1 items (0 of 0)"),
        6000,
      );
      expect(frame).toContain("This page has no items");
    }, 20000);
  });
});
