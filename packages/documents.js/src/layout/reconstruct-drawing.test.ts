import { describe, expect, it } from "vitest";
import type { ContentDrawPage } from "document-schema.js";
import { reconstructDrawing } from "./reconstruct-presentations-prod";
import {} from "./reconstruct";
import type {
  LayoutDocument,
  LayoutImageAsset,
  LayoutItem,
  LayoutPage,
  LayoutText,
} from "pdf-codec";
const RED = { r: 1, g: 0, b: 0 };
function text(overrides: {
  text: string;
  xPt: number;
  yPt: number;
  widthPt: number;
  sizePt?: number;
  family?: string;
  bold?: boolean;
}): LayoutText {
  return {
    kind: "text",
    text: overrides.text,
    xPt: overrides.xPt,
    yPt: overrides.yPt,
    font: {
      family: overrides.family ?? "Helvetica",
      weight: overrides.bold === true ? "bold" : "normal",
      style: "normal",
    },
    sizePt: overrides.sizePt ?? 12,
    color: { r: 0, g: 0, b: 0 },
    widthPt: overrides.widthPt,
  };
}

function page(
  widthPt: number,
  heightPt: number,
  items: LayoutItem[],
): LayoutPage {
  return { widthPt, heightPt, items };
}

function docFrom(
  pages: LayoutPage[],
  images: Record<string, LayoutImageAsset> = {},
): LayoutDocument {
  return { formatVersion: 1, metadata: {}, pages, images };
}

function drawPages(
  doc: ReturnType<typeof reconstructDrawing>,
): ContentDrawPage[] {
  if (doc.kind !== "drawing") {
    throw new Error("expected a drawing document");
  }
  return doc.pages;
}

describe("reconstructDrawing: empty input and cancellation", () => {
  it("produces an empty page (no vectors, no shapes) for a page with no items", () => {
    const doc = reconstructDrawing(docFrom([page(400, 300, [])]));
    const [pg] = drawPages(doc);
    expect(pg!.vectors).toEqual([]);
    expect(pg!.shapes).toEqual([]);
  });

  it("throws when the signal is already aborted", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      reconstructDrawing(docFrom([page(400, 300, [])]), {
        signal: controller.signal,
      }),
    ).toThrow();
  });
});

describe("reconstructDrawing: shared paintOrder", () => {
  it("stamps a dense, monotonic paintOrder across BOTH arrays in the page's own recovered paint order", () => {
    const items: LayoutItem[] = [
      { kind: "rect", xPt: 0, yPt: 0, widthPt: 10, heightPt: 10, fill: RED },
      text({ text: "Middle", xPt: 5, yPt: 5, widthPt: 30 }),
      { kind: "rect", xPt: 20, yPt: 0, widthPt: 10, heightPt: 10, fill: RED },
    ];
    const [pg] = drawPages(
      reconstructDrawing(docFrom([page(400, 300, items)])),
    );
    expect(pg!.vectors.map((v) => v.paintOrder)).toEqual([0, 2]);
    expect(pg!.shapes.map((s) => s.paintOrder)).toEqual([1]);
  });

  it("skips no slot for a dropped link item, keeping the stamped values a dense run over what was actually recovered", () => {
    const items: LayoutItem[] = [
      { kind: "rect", xPt: 0, yPt: 0, widthPt: 10, heightPt: 10, fill: RED },
      {
        kind: "link",
        xPt: 0,
        yPt: 0,
        widthPt: 10,
        heightPt: 10,
        uri: "https://example.invalid",
      },
      { kind: "rect", xPt: 20, yPt: 0, widthPt: 10, heightPt: 10, fill: RED },
    ];
    const [pg] = drawPages(
      reconstructDrawing(docFrom([page(400, 300, items)])),
    );
    expect(pg!.vectors.map((v) => v.paintOrder)).toEqual([0, 1]);
  });
});

// --- Vector recovery generalized into the wordprocessing/presentation directions -------------------------------

// Both directions carry recovered vectors in a ContentEmbeddedObjectBlock whose nested document is a real one-page drawing document — the container ContentSection/ContentSlide lack a vectors array of their own. Reading one back out is the same narrowing in both, so both suites share this helper.
