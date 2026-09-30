import { assertNeverNodeKind } from "./item";
import { describe, expect, it } from "vitest";
import { encodePng } from "byte-codec";
import { DEFAULT_LAYOUT_FONT } from "document-schema.js";
import { createPdf } from "./editor";
import { PdfInternalLinkItem } from "./item";

// The validation surface: every builder and setter states its own field name in the message it throws, each class names itself in the removed-item message, and every validated setter round-trips its valid values. The messages are pinned verbatim because they are the only thing that distinguishes one guard from its neighbours.

const BLACK = { r: 0, g: 0, b: 0 };

function tinyPngBytes(): Uint8Array<ArrayBuffer> {
  return encodePng({
    width: 2,
    height: 2,
    channels: 3,
    data: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]),
  });
}

function firstPage(): ReturnType<
  ReturnType<typeof createPdf>["pages"]
>[number] {
  const page = createPdf().pages()[0];
  if (page === undefined) {
    throw new Error("expected a first page");
  }
  return page;
}

describe("pdf item builders state their own field in the throw", () => {
  it.each([
    [
      "sizePt must be a positive number, got 0",
      () =>
        firstPage().appendText({
          xPt: 0,
          yPt: 0,
          text: "x",
          font: DEFAULT_LAYOUT_FONT,
          sizePt: 0,
          color: BLACK,
        }),
    ],
    [
      "widthPt must be a nonnegative number, got -1",
      () =>
        firstPage().appendRect({ xPt: 0, yPt: 0, widthPt: -1, heightPt: 1 }),
    ],
    [
      "heightPt must be a nonnegative number, got -1",
      () =>
        firstPage().appendRect({ xPt: 0, yPt: 0, widthPt: 1, heightPt: -1 }),
    ],
    [
      "stroke.widthPt must be a positive number, got 0",
      () =>
        firstPage().appendRect({
          xPt: 0,
          yPt: 0,
          widthPt: 1,
          heightPt: 1,
          stroke: { color: BLACK, widthPt: 0 },
        }),
    ],
    [
      "widthPt must be a positive number, got 0",
      () =>
        firstPage().appendEllipse({ xPt: 0, yPt: 0, widthPt: 0, heightPt: 1 }),
    ],
    [
      "heightPt must be a positive number, got 0",
      () =>
        firstPage().appendEllipse({ xPt: 0, yPt: 0, widthPt: 1, heightPt: 0 }),
    ],
    [
      "widthPt must be a positive number, got 0",
      () =>
        firstPage().appendLine({
          x1Pt: 0,
          y1Pt: 0,
          x2Pt: 1,
          y2Pt: 1,
          color: BLACK,
          widthPt: 0,
        }),
    ],
    [
      "widthPt must be a positive number, got 0",
      () =>
        firstPage().appendImage({
          xPt: 0,
          yPt: 0,
          widthPt: 0,
          heightPt: 1,
          format: "png",
          bytes: tinyPngBytes(),
        }),
    ],
    [
      "heightPt must be a positive number, got 0",
      () =>
        firstPage().appendImage({
          xPt: 0,
          yPt: 0,
          widthPt: 1,
          heightPt: 0,
          format: "png",
          bytes: tinyPngBytes(),
        }),
    ],
    [
      "widthPt must be a nonnegative number, got -1",
      () =>
        firstPage().appendLink({
          uri: "https://example.com/",
          xPt: 0,
          yPt: 0,
          widthPt: -1,
          heightPt: 1,
        }),
    ],
    [
      "heightPt must be a nonnegative number, got -1",
      () =>
        firstPage().appendLink({
          uri: "https://example.com/",
          xPt: 0,
          yPt: 0,
          widthPt: 1,
          heightPt: -1,
        }),
    ],
  ])("%s", (message, build) => {
    expect(build).toThrow(message);
  });
});

describe("pdf item setters validate before mutating, then round-trip", () => {
  it("text sizePt and widthPt", () => {
    const item = firstPage().appendText({
      xPt: 0,
      yPt: 0,
      text: "x",
      font: DEFAULT_LAYOUT_FONT,
      sizePt: 12,
      color: BLACK,
    });
    expect(() => (item.sizePt = 0)).toThrow(
      "sizePt must be a positive number, got 0",
    );
    expect(() => (item.widthPt = -1)).toThrow(
      "widthPt must be a nonnegative number, got -1",
    );
    item.sizePt = 14;
    item.widthPt = 30;
    expect(item.sizePt).toBe(14);
    expect(item.widthPt).toBe(30);
  });

  it("rect widthPt and heightPt are nonnegative", () => {
    const item = firstPage().appendRect({
      xPt: 0,
      yPt: 0,
      widthPt: 1,
      heightPt: 1,
    });
    expect(() => (item.widthPt = -1)).toThrow(
      "widthPt must be a nonnegative number, got -1",
    );
    expect(() => (item.heightPt = -1)).toThrow(
      "heightPt must be a nonnegative number, got -1",
    );
    item.widthPt = 0;
    expect(item.widthPt).toBe(0);
  });

  it("ellipse widthPt and heightPt are positive", () => {
    const item = firstPage().appendEllipse({
      xPt: 0,
      yPt: 0,
      widthPt: 1,
      heightPt: 1,
    });
    expect(() => (item.widthPt = 0)).toThrow(
      "widthPt must be a positive number, got 0",
    );
    expect(() => (item.heightPt = 0)).toThrow(
      "heightPt must be a positive number, got 0",
    );
    item.heightPt = 5;
    expect(item.heightPt).toBe(5);
  });

  it("line widthPt is positive", () => {
    const item = firstPage().appendLine({
      x1Pt: 0,
      y1Pt: 0,
      x2Pt: 1,
      y2Pt: 1,
      color: BLACK,
      widthPt: 1,
    });
    expect(() => (item.widthPt = 0)).toThrow(
      "widthPt must be a positive number, got 0",
    );
    item.widthPt = 2;
    expect(item.widthPt).toBe(2);
  });

  it("image widthPt and heightPt are positive", () => {
    const item = firstPage().appendImage({
      xPt: 0,
      yPt: 0,
      widthPt: 1,
      heightPt: 1,
      format: "png",
      bytes: tinyPngBytes(),
    });
    expect(() => (item.widthPt = 0)).toThrow(
      "widthPt must be a positive number, got 0",
    );
    expect(() => (item.heightPt = 0)).toThrow(
      "heightPt must be a positive number, got 0",
    );
    item.widthPt = 3;
    expect(item.widthPt).toBe(3);
  });

  it("link and internalLink widthPt and heightPt are nonnegative", () => {
    const link = firstPage().appendLink({
      uri: "https://example.com/",
      xPt: 0,
      yPt: 0,
      widthPt: 1,
      heightPt: 1,
    });
    expect(() => (link.widthPt = -1)).toThrow(
      "widthPt must be a nonnegative number, got -1",
    );
    expect(() => (link.heightPt = -1)).toThrow(
      "heightPt must be a nonnegative number, got -1",
    );
    link.uri = "https://example.org/";
    link.xPt = 4;
    expect(link.uri).toBe("https://example.org/");
    expect(link.xPt).toBe(4);

    const internal = new PdfInternalLinkItem([], {
      kind: "internalLink",
      destination: "sec",
      xPt: 0,
      yPt: 0,
      widthPt: 1,
      heightPt: 1,
    });
    expect(() => (internal.widthPt = -1)).toThrow(
      "widthPt must be a nonnegative number, got -1",
    );
    expect(() => (internal.heightPt = -1)).toThrow(
      "heightPt must be a nonnegative number, got -1",
    );
    internal.destination = "other";
    internal.xPt = 2;
    internal.widthPt = 0;
    expect(internal.destination).toBe("other");
    expect(internal.xPt).toBe(2);
    expect(internal.widthPt).toBe(0);
  });
});

describe("every pdf item class names itself in the removed-item message", () => {
  it("per class", () => {
    const cases: readonly [string, { remove: () => void }, () => unknown][] = [
      [
        "PdfTextItem",
        firstPage().appendText({
          xPt: 0,
          yPt: 0,
          text: "x",
          font: DEFAULT_LAYOUT_FONT,
          sizePt: 12,
          color: BLACK,
        }),
        () => 0,
      ],
      [
        "PdfRectItem",
        firstPage().appendRect({ xPt: 0, yPt: 0, widthPt: 1, heightPt: 1 }),
        () => 0,
      ],
      [
        "PdfEllipseItem",
        firstPage().appendEllipse({ xPt: 0, yPt: 0, widthPt: 1, heightPt: 1 }),
        () => 0,
      ],
      [
        "PdfLineItem",
        firstPage().appendLine({
          x1Pt: 0,
          y1Pt: 0,
          x2Pt: 1,
          y2Pt: 1,
          color: BLACK,
          widthPt: 1,
        }),
        () => 0,
      ],
      [
        "PdfPathItem",
        firstPage().appendPath({
          subpaths: [
            {
              startXPt: 0,
              startYPt: 0,
              closed: false,
              segments: [{ kind: "line", xPt: 1, yPt: 1 }],
            },
          ],
          stroke: { color: BLACK, widthPt: 1 },
        }),
        () => 0,
      ],
      [
        "PdfImageItem",
        firstPage().appendImage({
          xPt: 0,
          yPt: 0,
          widthPt: 1,
          heightPt: 1,
          format: "png",
          bytes: tinyPngBytes(),
        }),
        () => 0,
      ],
      [
        "PdfLinkItem",
        firstPage().appendLink({
          uri: "https://example.com/",
          xPt: 0,
          yPt: 0,
          widthPt: 1,
          heightPt: 1,
        }),
        () => 0,
      ],
      [
        "PdfInternalLinkItem",
        new PdfInternalLinkItem([], {
          kind: "internalLink",
          destination: "sec",
          xPt: 0,
          yPt: 0,
          widthPt: 1,
          heightPt: 1,
        }),
        () => 0,
      ],
    ];
    for (const [typeName, item] of cases) {
      item.remove();
      expect(() => {
        item.remove();
      }).toThrow(
        `this ${typeName} has been removed from its page and can no longer be used`,
      );
    }
  });
});

describe("assertNeverNodeKind", () => {
  it("names the kind it was handed", () => {
    expect(() => assertNeverNodeKind("nonsense" as never)).toThrow("nonsense");
  });
});
