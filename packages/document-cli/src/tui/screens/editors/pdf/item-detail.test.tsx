import { type LayoutDocument } from "documents.js";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import {} from "../../../state/context.js";
import { settle, waitForFrame } from "../../../test-support.js";
import { PdfHarness } from "./test-support.js";

const ENTER = "\r";
const ESCAPE = "\u001B";

// The item-detail screen's own header row renders a genuine em dash (U+2014) between the item index and its kind; asserting against the same code point (rather than a literal character in this source file) keeps the fixture unambiguous in any editor or terminal.
// A real, minimal 1x1 PNG, registered under imageId "logo" — writePdf (called by mutate()'s own undo-snapshot step on every dispatch, not just an explicit save) throws "LayoutDocument references image ... but it is not present in images" for an image item whose imageId has no matching registry entry, so any test that DISPATCHES against an image item (not merely renders its read-only dump) needs a genuine entry here, not an empty `images: {}`.
// A second, real, genuinely decodable 1x1 PNG (a plain red pixel, distinct content from LOGO_IMAGE_ASSET's own bytes so registerImageBytes' crc32-derived id actually differs) — for the "replace image" flow, which calls decodePng on whatever bytes it reads off disk to recover width/height (see documents.js's own registerImageBytes), unlike a docx/odt image insertion's own PNG fixture (paragraph-detail.test.tsx's PNG_BYTES) which never decodes pixels since a docx/odt image's own width/height come from the wizard's typed fields instead. A signature-only stub (the docx fixture's own shape) throws here.
interface Stdin {
  readonly write: (data: string) => void;
}
type LastFrame = () => string | undefined;

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
