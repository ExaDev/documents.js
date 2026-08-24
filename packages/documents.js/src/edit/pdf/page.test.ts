import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT_FONT } from "document-schema.js";
import { createPdf } from "./editor";

const BLACK = { r: 0, g: 0, b: 0 };
const RED = { r: 1, g: 0, b: 0 };

describe("PdfPage widthPt/heightPt/notes", () => {
  it("reads back what createPdf built and can be reassigned", () => {
    const editor = createPdf({ widthPt: 400, heightPt: 300 });
    const page = editor.pages()[0]!;
    expect(page.widthPt).toBe(400);
    expect(page.heightPt).toBe(300);
    expect(page.notes).toBeUndefined();

    page.widthPt = 500;
    page.heightPt = 350;
    page.notes = "Speaker notes";
    expect(page.widthPt).toBe(500);
    expect(page.heightPt).toBe(350);
    expect(page.notes).toBe("Speaker notes");

    page.notes = undefined;
    expect(page.notes).toBeUndefined();
  });

  it("rejects a nonpositive widthPt/heightPt", () => {
    const editor = createPdf();
    const page = editor.pages()[0]!;
    expect(() => {
      page.widthPt = 0;
    }).toThrow(/positive/);
    expect(() => {
      page.heightPt = -1;
    }).toThrow(/positive/);
  });

  it("every getter/setter throws once the page has been removed", () => {
    const editor = createPdf();
    editor.appendPage();
    const page = editor.pages()[0]!;
    page.remove();
    expect(() => page.widthPt).toThrow(/removed/);
    expect(() => {
      page.widthPt = 100;
    }).toThrow(/removed/);
    expect(() =>
      page.appendText({
        xPt: 0,
        yPt: 0,
        text: "X",
        font: DEFAULT_LAYOUT_FONT,
        sizePt: 10,
        color: BLACK,
      }),
    ).toThrow(/removed/);
  });
});

describe("PdfPage.items() and per-kind accessors", () => {
  it("returns every item in paint (array) order, narrowed by kind", () => {
    const editor = createPdf();
    const page = editor.pages()[0]!;
    page.appendText({
      xPt: 0,
      yPt: 0,
      text: "A",
      font: DEFAULT_LAYOUT_FONT,
      sizePt: 10,
      color: BLACK,
    });
    page.appendRect({ xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 });
    page.appendEllipse({ xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 });
    page.appendLine({
      x1Pt: 0,
      y1Pt: 0,
      x2Pt: 10,
      y2Pt: 10,
      color: BLACK,
      widthPt: 1,
    });
    page.appendPath({
      subpaths: [
        {
          startXPt: 0,
          startYPt: 0,
          closed: false,
          segments: [{ kind: "line", xPt: 1, yPt: 1 }],
        },
      ],
    });
    page.appendLink({
      uri: "https://example.com",
      xPt: 0,
      yPt: 0,
      widthPt: 10,
      heightPt: 10,
    });

    expect(page.items().map((item) => item.kind)).toEqual([
      "text",
      "rect",
      "ellipse",
      "line",
      "path",
      "link",
    ]);
    expect(page.textItems()).toHaveLength(1);
    expect(page.rectItems()).toHaveLength(1);
    expect(page.ellipseItems()).toHaveLength(1);
    expect(page.lineItems()).toHaveLength(1);
    expect(page.pathItems()).toHaveLength(1);
    expect(page.linkItems()).toHaveLength(1);
    expect(page.imageItems()).toHaveLength(0);
  });

  it("two calls return fresh wrapper instances over the same live node (the fresh-instance rule)", () => {
    const editor = createPdf();
    const page = editor.pages()[0]!;
    page.appendText({
      xPt: 0,
      yPt: 0,
      text: "Original",
      font: DEFAULT_LAYOUT_FONT,
      sizePt: 10,
      color: BLACK,
    });

    const first = page.textItems()[0]!;
    const second = page.textItems()[0]!;
    expect(first).not.toBe(second);

    first.text = "Changed via first";
    expect(second.text).toBe("Changed via first");
  });
});

describe("PdfPage insertion at an explicit index", () => {
  it("inserting at index 1 places the new item there without shifting earlier items", () => {
    const editor = createPdf();
    const page = editor.pages()[0]!;
    page.appendText({
      xPt: 0,
      yPt: 0,
      text: "First",
      font: DEFAULT_LAYOUT_FONT,
      sizePt: 10,
      color: BLACK,
    });
    page.appendText({
      xPt: 0,
      yPt: 0,
      text: "Third",
      font: DEFAULT_LAYOUT_FONT,
      sizePt: 10,
      color: BLACK,
    });

    page.insertTextAt(1, {
      xPt: 0,
      yPt: 0,
      text: "Second",
      font: DEFAULT_LAYOUT_FONT,
      sizePt: 10,
      color: BLACK,
    });

    const texts = page.textItems().map((item) => item.text);
    expect(texts).toEqual(["First", "Second", "Third"]);
  });

  it("insertRectAt at index 0 shifts every existing item down by one, changing nothing about their own fields", () => {
    const editor = createPdf();
    const page = editor.pages()[0]!;
    const existingText = page.appendText({
      xPt: 1,
      yPt: 2,
      text: "Existing",
      font: DEFAULT_LAYOUT_FONT,
      sizePt: 10,
      color: BLACK,
    });

    page.insertRectAt(0, {
      xPt: 5,
      yPt: 5,
      widthPt: 10,
      heightPt: 10,
      fill: RED,
    });

    expect(page.items().map((item) => item.kind)).toEqual(["rect", "text"]);
    expect(existingText.xPt).toBe(1);
    expect(existingText.yPt).toBe(2);
    expect(existingText.text).toBe("Existing");
  });

  it("an out-of-range index clamps to append at the end", () => {
    const editor = createPdf();
    const page = editor.pages()[0]!;
    page.appendText({
      xPt: 0,
      yPt: 0,
      text: "First",
      font: DEFAULT_LAYOUT_FONT,
      sizePt: 10,
      color: BLACK,
    });
    page.insertTextAt(99, {
      xPt: 0,
      yPt: 0,
      text: "Second",
      font: DEFAULT_LAYOUT_FONT,
      sizePt: 10,
      color: BLACK,
    });
    expect(page.textItems().map((item) => item.text)).toEqual([
      "First",
      "Second",
    ]);
  });
});

describe("PdfPage.appendX / removal", () => {
  it("removing an item removes it from items() and leaves the rest untouched", () => {
    const editor = createPdf();
    const page = editor.pages()[0]!;
    page.appendText({
      xPt: 0,
      yPt: 0,
      text: "Keep me",
      font: DEFAULT_LAYOUT_FONT,
      sizePt: 10,
      color: BLACK,
    });
    const toRemove = page.appendRect({
      xPt: 0,
      yPt: 0,
      widthPt: 10,
      heightPt: 10,
    });
    page.appendText({
      xPt: 0,
      yPt: 0,
      text: "Also keep me",
      font: DEFAULT_LAYOUT_FONT,
      sizePt: 10,
      color: BLACK,
    });

    toRemove.remove();

    expect(page.items().map((item) => item.kind)).toEqual(["text", "text"]);
    expect(page.textItems().map((item) => item.text)).toEqual([
      "Keep me",
      "Also keep me",
    ]);
    expect(() => toRemove.widthPt).toThrow(/removed/);
  });
});
