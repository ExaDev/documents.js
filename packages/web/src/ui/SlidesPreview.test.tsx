import type {
  ContentDocument,
  ContentDrawPage,
  ContentShape,
  ContentSlide,
  ContentVector,
} from "documents.js";
import { afterEach, describe, expect, it } from "vitest";

import { mountWithMantine } from "../test/mountComponent";
import { SlidesPreview, type SlidesPreviewProps } from "./SlidesPreview";

let unmount: (() => void) | undefined;

afterEach(() => {
  unmount?.();
  unmount = undefined;
});

function renderPreview(props: SlidesPreviewProps): string {
  const mounted = mountWithMantine(<SlidesPreview {...props} />);
  unmount = mounted.unmount;
  return mounted.container.innerHTML;
}

function shape(overrides: Partial<ContentShape> = {}): ContentShape {
  return {
    frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 },
    insetLeftPt: 0,
    insetTopPt: 0,
    insetRightPt: 0,
    insetBottomPt: 0,
    blocks: [{ kind: "paragraph", runs: [{ text: "shape text" }] }],
    ...overrides,
  };
}

function slide(overrides: Partial<ContentSlide> = {}): ContentSlide {
  return {
    size: { widthPt: 960, heightPt: 540 },
    shapes: [],
    notes: "",
    ...overrides,
  };
}

function drawPage(overrides: Partial<ContentDrawPage> = {}): ContentDrawPage {
  return {
    size: { widthPt: 960, heightPt: 540 },
    shapes: [],
    vectors: [],
    ...overrides,
  };
}

function presentationDocument(
  slides: readonly ContentSlide[],
): ContentDocument {
  return { kind: "presentation", metadata: {}, slides: [...slides] };
}

function drawingDocument(pages: readonly ContentDrawPage[]): ContentDocument {
  return { kind: "drawing", metadata: {}, pages: [...pages] };
}

const RED = { r: 1, g: 0, b: 0 };

describe("SlidesPreview", () => {
  it("always renders the label and format badge", () => {
    const html = renderPreview({ label: "Doc A", format: "pptx" });
    expect(html).toContain("Doc A");
    expect(html).toContain("pptx");
  });

  it("shows a loading overlay when loading", () => {
    const html = renderPreview({ label: "L", format: "pptx", loading: true });
    expect(html).toContain("mantine-LoadingOverlay-root");
  });

  it("shows the unavailable message when an error is present", () => {
    const html = renderPreview({
      label: "L",
      format: "pptx",
      content: presentationDocument([slide()]),
      error: new Error("boom"),
    });
    expect(html).toContain("Preview unavailable for this format.");
  });

  it("shows the not-yet-available message when there is no content at all", () => {
    const html = renderPreview({ label: "L", format: "pptx" });
    expect(html).toContain("No preview yet.");
  });

  it("shows the not-yet-available message when the content is neither a presentation nor a drawing", () => {
    const html = renderPreview({
      label: "L",
      format: "pptx",
      content: { kind: "formula", metadata: {}, formula: { mathml: [] } },
    });
    expect(html).toContain("No preview yet.");
  });

  it("renders no SegmentedControl for a single slide", () => {
    const html = renderPreview({
      label: "L",
      format: "pptx",
      content: presentationDocument([slide()]),
    });
    expect(html).not.toContain("mantine-SegmentedControl-root");
  });

  it("renders a SegmentedControl (1, 2, ...) when there is more than one slide", () => {
    const html = renderPreview({
      label: "L",
      format: "pptx",
      content: presentationDocument([slide(), slide()]),
    });
    expect(html).toContain("mantine-SegmentedControl-root");
    expect(html).toContain(">1<");
    expect(html).toContain(">2<");
  });

  it("renders a presentation slide's own shape text", () => {
    const html = renderPreview({
      label: "L",
      format: "pptx",
      content: presentationDocument([
        slide({
          shapes: [
            shape({
              blocks: [{ kind: "paragraph", runs: [{ text: "hello slide" }] }],
            }),
          ],
        }),
      ]),
    });
    expect(html).toContain("hello slide");
    expect(html).toContain("<svg");
    expect(html).toContain("<foreignObject");
  });

  it("renders a drawing page's own shape text via the pages field, not slides", () => {
    const html = renderPreview({
      label: "L",
      format: "odg",
      content: drawingDocument([
        drawPage({
          shapes: [
            shape({
              blocks: [
                { kind: "paragraph", runs: [{ text: "hello drawing" }] },
              ],
            }),
          ],
        }),
      ]),
    });
    expect(html).toContain("hello drawing");
  });

  it("renders a rect vector with its fill colour", () => {
    const vector: ContentVector = {
      kind: "rect",
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      fill: RED,
    };
    const html = renderPreview({
      label: "L",
      format: "odg",
      content: drawingDocument([drawPage({ vectors: [vector] })]),
    });
    expect(html).toContain("<rect");
    expect(html).toContain("rgb(255 0 0)");
  });

  it("renders a rect vector with no fill as fill=none", () => {
    const vector: ContentVector = {
      kind: "rect",
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
    };
    const html = renderPreview({
      label: "L",
      format: "odg",
      content: drawingDocument([drawPage({ vectors: [vector] })]),
    });
    expect(html).toContain('fill="none"');
  });

  it("renders an ellipse vector centred on its frame", () => {
    const vector: ContentVector = {
      kind: "ellipse",
      frame: { xPt: 10, yPt: 20, widthPt: 40, heightPt: 60 },
      fill: RED,
    };
    const html = renderPreview({
      label: "L",
      format: "odg",
      content: drawingDocument([drawPage({ vectors: [vector] })]),
    });
    expect(html).toContain("<ellipse");
    expect(html).toContain('cx="30"');
    expect(html).toContain('cy="50"');
    expect(html).toContain('rx="20"');
    expect(html).toContain('ry="30"');
  });

  it("renders a line vector between its two endpoints", () => {
    const vector: ContentVector = {
      kind: "line",
      from: { xPt: 1, yPt: 2 },
      to: { xPt: 3, yPt: 4 },
      stroke: { color: RED, widthPt: 1 },
    };
    const html = renderPreview({
      label: "L",
      format: "odg",
      content: drawingDocument([drawPage({ vectors: [vector] })]),
    });
    expect(html).toContain("<line");
    expect(html).toContain('x1="1"');
    expect(html).toContain('y1="2"');
    expect(html).toContain('x2="3"');
    expect(html).toContain('y2="4"');
  });

  it("renders a path vector's subpaths as move/line/cubic/close commands", () => {
    const vector: ContentVector = {
      kind: "path",
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      subpaths: [
        {
          start: { xPt: 0, yPt: 0 },
          segments: [
            { kind: "line", to: { xPt: 10, yPt: 0 } },
            {
              kind: "cubic",
              control1: { xPt: 10, yPt: 5 },
              control2: { xPt: 5, yPt: 10 },
              to: { xPt: 0, yPt: 10 },
            },
          ],
          closed: true,
        },
      ],
    };
    const html = renderPreview({
      label: "L",
      format: "odg",
      content: drawingDocument([drawPage({ vectors: [vector] })]),
    });
    expect(html).toContain("<path");
    expect(html).toContain("M 0 0");
    expect(html).toContain("L 10 0");
    expect(html).toContain("C 10 5 5 10 0 10");
    expect(html).toContain(" Z");
  });

  it("does not close an open subpath's path data", () => {
    const vector: ContentVector = {
      kind: "path",
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      subpaths: [
        {
          start: { xPt: 0, yPt: 0 },
          segments: [{ kind: "line", to: { xPt: 10, yPt: 0 } }],
          closed: false,
        },
      ],
    };
    const html = renderPreview({
      label: "L",
      format: "odg",
      content: drawingDocument([drawPage({ vectors: [vector] })]),
    });
    expect(html).not.toContain(" Z");
  });

  it("renders a solid stroke with the given colour and width", () => {
    const vector: ContentVector = {
      kind: "line",
      from: { xPt: 0, yPt: 0 },
      to: { xPt: 10, yPt: 0 },
      stroke: { color: RED, widthPt: 2 },
    };
    const html = renderPreview({
      label: "L",
      format: "odg",
      content: drawingDocument([drawPage({ vectors: [vector] })]),
    });
    expect(html).toContain('stroke="rgb(255 0 0)"');
    expect(html).toContain('stroke-width="2"');
    expect(html).not.toContain("stroke-dasharray");
  });

  it("renders a dashed stroke with a dash pattern derived from its width", () => {
    const vector: ContentVector = {
      kind: "line",
      from: { xPt: 0, yPt: 0 },
      to: { xPt: 10, yPt: 0 },
      stroke: { color: RED, widthPt: 2, style: "dashed" },
    };
    const html = renderPreview({
      label: "L",
      format: "odg",
      content: drawingDocument([drawPage({ vectors: [vector] })]),
    });
    expect(html).toContain('stroke-dasharray="6 4"');
  });

  it("renders a dotted stroke with a round linecap", () => {
    const vector: ContentVector = {
      kind: "line",
      from: { xPt: 0, yPt: 0 },
      to: { xPt: 10, yPt: 0 },
      stroke: { color: RED, widthPt: 2, style: "dotted" },
    };
    const html = renderPreview({
      label: "L",
      format: "odg",
      content: drawingDocument([drawPage({ vectors: [vector] })]),
    });
    expect(html).toContain('stroke-dasharray="0.2 4"');
    expect(html).toContain('stroke-linecap="round"');
  });

  it("simulates a double stroke as two stacked elements, thick underlay then thin gap overlay", () => {
    const vector: ContentVector = {
      kind: "rect",
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      fill: RED,
      stroke: { color: { r: 0, g: 0, b: 1 }, widthPt: 2, style: "double" },
    };
    const html = renderPreview({
      label: "L",
      format: "odg",
      content: drawingDocument([drawPage({ vectors: [vector] })]),
    });
    // Underlay: 3x the stroke width, in the stroke colour.
    expect(html).toContain('stroke-width="6"');
    expect(html).toContain("rgb(0 0 255)");
    // Gap overlay: the plain stroke width, in the shape's own fill colour (not white, since the rect is filled).
    expect(html).toContain('stroke-width="2"');
  });

  it("uses white as the double stroke's gap colour when the underlying shape has no fill", () => {
    const vector: ContentVector = {
      kind: "rect",
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      stroke: { color: { r: 0, g: 0, b: 1 }, widthPt: 2, style: "double" },
    };
    const html = renderPreview({
      label: "L",
      format: "odg",
      content: drawingDocument([drawPage({ vectors: [vector] })]),
    });
    expect(html).toContain("white");
  });

  it("applies a rotation transform about the frame's own centre when rotationDeg is present", () => {
    const vector: ContentVector = {
      kind: "rect",
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 20 },
      rotationDeg: 45,
    };
    const html = renderPreview({
      label: "L",
      format: "odg",
      content: drawingDocument([drawPage({ vectors: [vector] })]),
    });
    expect(html).toContain('transform="rotate(45 5 10)"');
  });

  it("applies no transform attribute at all when rotationDeg is absent", () => {
    const vector: ContentVector = {
      kind: "rect",
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 20 },
    };
    const html = renderPreview({
      label: "L",
      format: "odg",
      content: drawingDocument([drawPage({ vectors: [vector] })]),
    });
    expect(html).not.toContain("transform=");
  });

  it("paints shapes and vectors in ascending paintOrder, not array order", () => {
    const html = renderPreview({
      label: "L",
      format: "odg",
      content: drawingDocument([
        drawPage({
          shapes: [
            shape({
              paintOrder: 1,
              blocks: [{ kind: "paragraph", runs: [{ text: "second" }] }],
            }),
          ],
          vectors: [
            {
              kind: "rect",
              frame: { xPt: 0, yPt: 0, widthPt: 1, heightPt: 1 },
              paintOrder: 0,
            },
          ],
        }),
      ]),
    });
    const rectAt = html.indexOf("<rect");
    const secondAt = html.indexOf("second");
    expect(rectAt).toBeGreaterThan(-1);
    expect(rectAt).toBeLessThan(secondAt);
  });

  it("paints an item with no paintOrder last, after every item that has one", () => {
    const html = renderPreview({
      label: "L",
      format: "odg",
      content: drawingDocument([
        drawPage({
          vectors: [
            {
              kind: "rect",
              frame: { xPt: 0, yPt: 0, widthPt: 1, heightPt: 1 },
            },
            {
              kind: "ellipse",
              frame: { xPt: 0, yPt: 0, widthPt: 1, heightPt: 1 },
              paintOrder: 0,
            },
          ],
        }),
      ]),
    });
    const ellipseAt = html.indexOf("<ellipse");
    const rectAt = html.indexOf("<rect");
    expect(ellipseAt).toBeGreaterThan(-1);
    expect(ellipseAt).toBeLessThan(rectAt);
  });

  it("applies fontScale as an em font-size on a shape's own text box", () => {
    const html = renderPreview({
      label: "L",
      format: "odg",
      content: drawingDocument([
        drawPage({ shapes: [shape({ fontScale: 1.5 })] }),
      ]),
    });
    expect(html).toContain("font-size: 1.5em");
  });

  it("derives line-height from lineSpacingReduction", () => {
    const html = renderPreview({
      label: "L",
      format: "odg",
      content: drawingDocument([
        drawPage({ shapes: [shape({ lineSpacingReduction: 0.2 })] }),
      ]),
    });
    expect(html).toContain("line-height: 1.3");
  });
});
