import { describe, expect, it } from "vitest";
import { encodePng } from "byte-codec";
import { DEFAULT_LAYOUT_FONT } from "document-schema.js";
import { createPdf } from "./editor";

const BLACK = { r: 0, g: 0, b: 0 };
const RED = { r: 1, g: 0, b: 0 };
const BLUE = { r: 0, g: 0, b: 1 };

function tinyPngBytes(): Uint8Array<ArrayBuffer> {
  return encodePng({
    width: 2,
    height: 2,
    channels: 3,
    data: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]),
  });
}

describe("PdfTextItem", () => {
  it("getters read back exactly what appendText was given", () => {
    const editor = createPdf();
    const page = editor.pages()[0]!;
    const item = page.appendText({
      xPt: 10,
      yPt: 20,
      text: "Hello",
      font: DEFAULT_LAYOUT_FONT,
      sizePt: 12,
      color: BLACK,
    });
    expect(item.kind).toBe("text");
    expect(item.xPt).toBe(10);
    expect(item.yPt).toBe(20);
    expect(item.text).toBe("Hello");
    expect(item.font).toEqual(DEFAULT_LAYOUT_FONT);
    expect(item.sizePt).toBe(12);
    expect(item.color).toEqual(BLACK);
    expect(item.widthPt).toBeUndefined();
    expect(item.rotationDeg).toBeUndefined();
    expect(item.underline).toBeUndefined();
  });

  it("setters mutate the live item in place", () => {
    const editor = createPdf();
    const page = editor.pages()[0]!;
    const item = page.appendText({
      xPt: 0,
      yPt: 0,
      text: "Original",
      font: DEFAULT_LAYOUT_FONT,
      sizePt: 10,
      color: BLACK,
    });

    item.text = "Changed";
    item.xPt = 15;
    item.yPt = 25;
    item.sizePt = 18;
    item.color = RED;
    item.rotationDeg = 45;
    item.underline = true;
    item.widthPt = 100;

    expect(item.text).toBe("Changed");
    expect(item.xPt).toBe(15);
    expect(item.yPt).toBe(25);
    expect(item.sizePt).toBe(18);
    expect(item.color).toEqual(RED);
    expect(item.rotationDeg).toBe(45);
    expect(item.underline).toBe(true);
    expect(item.widthPt).toBe(100);

    // Clearing an optional field back to undefined removes it rather than leaving a present-but-undefined key.
    item.rotationDeg = undefined;
    item.underline = undefined;
    item.widthPt = undefined;
    expect(item.rotationDeg).toBeUndefined();
    expect(item.underline).toBeUndefined();
    expect(item.widthPt).toBeUndefined();
  });

  it("rejects a nonpositive sizePt before ever touching the live item", () => {
    const editor = createPdf();
    const page = editor.pages()[0]!;
    const item = page.appendText({
      xPt: 0,
      yPt: 0,
      text: "X",
      font: DEFAULT_LAYOUT_FONT,
      sizePt: 10,
      color: BLACK,
    });
    expect(() => {
      item.sizePt = 0;
    }).toThrow(/positive/);
    expect(() => {
      item.sizePt = -5;
    }).toThrow(/positive/);
    expect(item.sizePt).toBe(10);
  });

  it("appendText itself rejects a nonpositive sizePt", () => {
    const editor = createPdf();
    const page = editor.pages()[0]!;
    expect(() =>
      page.appendText({
        xPt: 0,
        yPt: 0,
        text: "X",
        font: DEFAULT_LAYOUT_FONT,
        sizePt: 0,
        color: BLACK,
      }),
    ).toThrow(/positive/);
    expect(page.items()).toHaveLength(0);
  });

  it("every getter/setter throws once the item has been removed", () => {
    const editor = createPdf();
    const page = editor.pages()[0]!;
    const item = page.appendText({
      xPt: 0,
      yPt: 0,
      text: "X",
      font: DEFAULT_LAYOUT_FONT,
      sizePt: 10,
      color: BLACK,
    });
    item.remove();
    expect(() => item.text).toThrow(/removed/);
    expect(() => {
      item.text = "Y";
    }).toThrow(/removed/);
    expect(() => {
      item.sizePt = 12;
    }).toThrow(/removed/);
  });
});

describe("PdfRectItem / PdfEllipseItem", () => {
  it("rect accepts a zero-width/height box (nonnegative), ellipse does not (positive)", () => {
    const editor = createPdf();
    const page = editor.pages()[0]!;
    expect(() =>
      page.appendRect({ xPt: 0, yPt: 0, widthPt: 0, heightPt: 0 }),
    ).not.toThrow();
    expect(() =>
      page.appendEllipse({ xPt: 0, yPt: 0, widthPt: 0, heightPt: 10 }),
    ).toThrow(/positive/);
    expect(() =>
      page.appendEllipse({ xPt: 0, yPt: 0, widthPt: 10, heightPt: 0 }),
    ).toThrow(/positive/);
  });

  it("rect rejects a negative width/height", () => {
    const editor = createPdf();
    const page = editor.pages()[0]!;
    expect(() =>
      page.appendRect({ xPt: 0, yPt: 0, widthPt: -1, heightPt: 10 }),
    ).toThrow(/nonnegative/);
  });

  it("fill/stroke round trip, and stroke.widthPt must be positive", () => {
    const editor = createPdf();
    const page = editor.pages()[0]!;
    const rect = page.appendRect({
      xPt: 0,
      yPt: 0,
      widthPt: 10,
      heightPt: 10,
      fill: RED,
      stroke: { color: BLUE, widthPt: 2 },
    });
    expect(rect.fill).toEqual(RED);
    expect(rect.stroke).toEqual({ color: BLUE, widthPt: 2 });

    expect(() => {
      rect.stroke = { color: BLUE, widthPt: 0 };
    }).toThrow(/positive/);
    // The failed assignment above never touched the live item.
    expect(rect.stroke).toEqual({ color: BLUE, widthPt: 2 });

    rect.fill = undefined;
    rect.stroke = undefined;
    expect(rect.fill).toBeUndefined();
    expect(rect.stroke).toBeUndefined();
  });

  it("setting widthPt/heightPt validates per-kind (rect nonnegative, ellipse positive)", () => {
    const editor = createPdf();
    const page = editor.pages()[0]!;
    const rect = page.appendRect({ xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 });
    expect(() => {
      rect.widthPt = -1;
    }).toThrow(/nonnegative/);
    rect.widthPt = 0;
    expect(rect.widthPt).toBe(0);

    const ellipse = page.appendEllipse({
      xPt: 0,
      yPt: 0,
      widthPt: 10,
      heightPt: 10,
    });
    expect(() => {
      ellipse.widthPt = 0;
    }).toThrow(/positive/);
  });
});

describe("PdfLineItem", () => {
  it("reads/writes every field, and rejects a nonpositive widthPt", () => {
    const editor = createPdf();
    const page = editor.pages()[0]!;
    const line = page.appendLine({
      x1Pt: 0,
      y1Pt: 0,
      x2Pt: 10,
      y2Pt: 10,
      color: BLACK,
      widthPt: 1,
      style: "dashed",
    });
    expect(line.style).toBe("dashed");

    line.x2Pt = 50;
    line.y2Pt = 50;
    line.style = undefined;
    expect(line.x2Pt).toBe(50);
    expect(line.y2Pt).toBe(50);
    expect(line.style).toBeUndefined();

    expect(() =>
      page.appendLine({
        x1Pt: 0,
        y1Pt: 0,
        x2Pt: 1,
        y2Pt: 1,
        color: BLACK,
        widthPt: 0,
      }),
    ).toThrow(/positive/);
    expect(() => {
      line.widthPt = -1;
    }).toThrow(/positive/);
  });
});

describe("PdfPathItem", () => {
  it("subpaths is a whole-array-replace setter", () => {
    const editor = createPdf();
    const page = editor.pages()[0]!;
    const original = [
      {
        startXPt: 0,
        startYPt: 0,
        closed: false,
        segments: [{ kind: "line" as const, xPt: 10, yPt: 10 }],
      },
    ];
    const path = page.appendPath({
      subpaths: original,
      fill: RED,
      fillRule: "evenodd",
    });
    expect(path.subpaths).toEqual(original);
    expect(path.fillRule).toBe("evenodd");

    const replacement = [
      {
        startXPt: 5,
        startYPt: 5,
        closed: true,
        segments: [{ kind: "line" as const, xPt: 20, yPt: 20 }],
      },
    ];
    path.subpaths = replacement;
    expect(path.subpaths).toEqual(replacement);
  });
});

describe("PdfImageItem", () => {
  it("appendImage registers the bytes in the shared registry and setImage repoints imageId without touching position/size", () => {
    const editor = createPdf();
    const page = editor.pages()[0]!;
    const firstBytes = tinyPngBytes();
    const image = page.appendImage({
      xPt: 5,
      yPt: 5,
      widthPt: 30,
      heightPt: 30,
      bytes: firstBytes,
      format: "png",
    });
    const originalImageId = image.imageId;
    expect(editor.toLayoutDocument().images[originalImageId]).toBeDefined();

    const secondBytes = encodePng({
      width: 2,
      height: 2,
      channels: 3,
      data: new Uint8Array([0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0]),
    });
    image.setImage(secondBytes, "png");

    expect(image.imageId).not.toBe(originalImageId);
    expect(image.xPt).toBe(5);
    expect(image.yPt).toBe(5);
    expect(image.widthPt).toBe(30);
    expect(image.heightPt).toBe(30);
    expect(editor.toLayoutDocument().images[image.imageId]).toBeDefined();
    // The old entry is still present in the registry (dedup is content-shared, so pruning it here could be unsafe) -- see registerImageBytes' own doc comment.
    expect(editor.toLayoutDocument().images[originalImageId]).toBeDefined();
  });

  it("appendImage rejects a nonpositive widthPt/heightPt", () => {
    const editor = createPdf();
    const page = editor.pages()[0]!;
    expect(() =>
      page.appendImage({
        xPt: 0,
        yPt: 0,
        widthPt: 0,
        heightPt: 10,
        bytes: tinyPngBytes(),
        format: "png",
      }),
    ).toThrow(/positive/);
  });
});

describe("PdfLinkItem", () => {
  it("reads/writes uri and geometry", () => {
    const editor = createPdf();
    const page = editor.pages()[0]!;
    const link = page.appendLink({
      uri: "https://example.com",
      xPt: 0,
      yPt: 0,
      widthPt: 50,
      heightPt: 20,
    });
    expect(link.uri).toBe("https://example.com");
    link.uri = "https://example.org";
    expect(link.uri).toBe("https://example.org");
    expect(() => {
      link.widthPt = -1;
    }).toThrow(/nonnegative/);
  });
});

describe("sourcePath", () => {
  it("is undefined for a freshly built item (only a format reader assigns one)", () => {
    const editor = createPdf();
    const page = editor.pages()[0]!;
    const item = page.appendText({
      xPt: 0,
      yPt: 0,
      text: "X",
      font: DEFAULT_LAYOUT_FONT,
      sizePt: 10,
      color: BLACK,
    });
    expect(item.sourcePath).toBeUndefined();
  });
});
