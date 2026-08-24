import { describe, expect, it } from "vitest";
import { encodePng } from "byte-codec";
import { PdfPasswordRequiredError, readPdf } from "pdf-codec";
import { DEFAULT_LAYOUT_FONT } from "document-schema.js";
import {
  encryptedPdf,
  minimalClassicXrefPdf,
  twoPageMultiTextPdf,
} from "../../test-support/pdf";
import { createPdf, openPdf } from "./editor";

const BLACK = { r: 0, g: 0, b: 0 };
const RED = { r: 1, g: 0, b: 0 };
const BLUE = { r: 0, g: 0, b: 1 };

function pngBytes(
  rgb: readonly [number, number, number],
): Uint8Array<ArrayBuffer> {
  const [r, g, b] = rgb;
  return encodePng({
    width: 2,
    height: 2,
    channels: 3,
    data: new Uint8Array([r, g, b, r, g, b, r, g, b, r, g, b]),
  });
}

describe("openPdf: editing an existing item read from a genuinely external fixture", () => {
  it("edits content/position/font/size/colour, and pdf-codec's own readPdf (an independent oracle) confirms the change", () => {
    const editor = openPdf(minimalClassicXrefPdf());
    const page = editor.pages()[0]!;
    const text = page.textItems()[0]!;
    expect(text.text).toBe("Hello");
    expect(text.xPt).toBe(10);
    expect(text.yPt).toBe(50);
    expect(text.sizePt).toBe(12);

    text.text = "Goodbye";
    text.xPt = 30;
    text.yPt = 60;
    text.sizePt = 24;
    text.color = RED;

    const reparsed = readPdf(editor.toBytes());
    const reparsedText = reparsed.pages[0]?.items[0];
    if (reparsedText?.kind !== "text") {
      throw new Error("expected a text item");
    }
    expect(reparsedText.text).toBe("Goodbye");
    expect(reparsedText.xPt).toBe(30);
    expect(reparsedText.yPt).toBe(60);
    expect(reparsedText.sizePt).toBe(24);
    expect(reparsedText.color).toEqual(RED);
  });
});

describe("openPdf: editing one item on one page leaves every other item, and every other page, untouched", () => {
  it("editing item 1 on page 1 leaves item 0 on page 1 and every item on page 0 semantically unchanged", () => {
    const editor = openPdf(twoPageMultiTextPdf());
    const pageZero = editor.pages()[0]!;
    const pageOne = editor.pages()[1]!;
    expect(pageZero.textItems().map((item) => item.text)).toEqual(["PageZero"]);
    expect(pageOne.textItems().map((item) => item.text)).toEqual([
      "First",
      "Second",
    ]);

    const secondItem = pageOne.textItems()[1]!;
    secondItem.text = "Edited";
    secondItem.xPt = 99;

    // Item 0 on page 1 survived untouched.
    expect(pageOne.textItems()[0]?.text).toBe("First");
    expect(pageOne.textItems()[0]?.xPt).toBe(10);
    // Page 0's own item survived untouched too.
    expect(pageZero.textItems()[0]?.text).toBe("PageZero");
    expect(pageZero.textItems()[0]?.xPt).toBe(10);

    const reparsed = readPdf(editor.toBytes());
    const reparsedPageZero = reparsed.pages[0]!;
    const reparsedPageOne = reparsed.pages[1]!;
    expect(
      reparsedPageZero.items.map((item) =>
        item.kind === "text" ? item.text : item.kind,
      ),
    ).toEqual(["PageZero"]);
    expect(
      reparsedPageOne.items.map((item) =>
        item.kind === "text" ? item.text : item.kind,
      ),
    ).toEqual(["First", "Edited"]);
    const reparsedSecond = reparsedPageOne.items[1];
    if (reparsedSecond?.kind !== "text") {
      throw new Error("expected a text item");
    }
    expect(reparsedSecond.xPt).toBe(99);
  });
});

describe("insertion at an explicit position, verified through a real toBytes()/reopen round trip", () => {
  it("a new rect inserted at index 0 appears first, and nothing after it shifted", () => {
    const editor = createPdf();
    const page = editor.pages()[0]!;
    page.appendText({
      xPt: 1,
      yPt: 1,
      text: "A",
      font: DEFAULT_LAYOUT_FONT,
      sizePt: 10,
      color: BLACK,
    });
    page.appendText({
      xPt: 2,
      yPt: 2,
      text: "B",
      font: DEFAULT_LAYOUT_FONT,
      sizePt: 10,
      color: BLACK,
    });

    page.insertRectAt(0, {
      xPt: 0,
      yPt: 0,
      widthPt: 5,
      heightPt: 5,
      fill: RED,
    });

    const reopened = openPdf(editor.toBytes());
    const reopenedPage = reopened.pages()[0]!;
    expect(reopenedPage.items().map((item) => item.kind)).toEqual([
      "rect",
      "text",
      "text",
    ]);
    expect(reopenedPage.textItems().map((item) => item.text)).toEqual([
      "A",
      "B",
    ]);
    expect(reopenedPage.textItems()[0]?.xPt).toBe(1);
    expect(reopenedPage.textItems()[1]?.xPt).toBe(2);
  });
});

describe("deletion, verified through a real toBytes()/reopen round trip", () => {
  it("a removed item is gone from items() immediately, and from the reparsed document, with survivors untouched", () => {
    const editor = createPdf();
    const page = editor.pages()[0]!;
    page.appendText({
      xPt: 1,
      yPt: 1,
      text: "Keep",
      font: DEFAULT_LAYOUT_FONT,
      sizePt: 10,
      color: BLACK,
    });
    const doomed = page.appendRect({
      xPt: 0,
      yPt: 0,
      widthPt: 10,
      heightPt: 10,
      fill: RED,
    });
    page.appendText({
      xPt: 2,
      yPt: 2,
      text: "Also keep",
      font: DEFAULT_LAYOUT_FONT,
      sizePt: 10,
      color: BLACK,
    });

    doomed.remove();
    expect(page.items().map((item) => item.kind)).toEqual(["text", "text"]);

    const reopened = openPdf(editor.toBytes());
    const reopenedPage = reopened.pages()[0]!;
    expect(reopenedPage.items()).toHaveLength(2);
    expect(reopenedPage.textItems().map((item) => item.text)).toEqual([
      "Keep",
      "Also keep",
    ]);
    expect(reopenedPage.textItems()[0]?.xPt).toBe(1);
    expect(reopenedPage.textItems()[1]?.xPt).toBe(2);
  });
});

describe("setImage: swapped pixel bytes survive a real write/reopen, and the orphaned original is excluded from output", () => {
  it("the new image bytes decode back correctly, and the old imageId never reaches the written PDF at all", () => {
    const editor = createPdf();
    const page = editor.pages()[0]!;
    const image = page.appendImage({
      xPt: 0,
      yPt: 0,
      widthPt: 40,
      heightPt: 40,
      bytes: pngBytes([255, 0, 0]),
      format: "png",
    });
    const originalImageId = image.imageId;

    image.setImage(pngBytes([0, 255, 0]), "png");
    expect(image.imageId).not.toBe(originalImageId);

    const reopened = readPdf(editor.toBytes());
    // writePdf only ever embeds an images[] entry a page item actually references -- the orphaned original was never referenced after setImage, so it was never embedded and does not reappear on a fresh parse.
    expect(reopened.images[originalImageId]).toBeUndefined();
    expect(reopened.images[image.imageId]).toBeDefined();
    const reopenedImage = reopened.pages[0]?.items[0];
    if (reopenedImage?.kind !== "image") {
      throw new Error("expected an image item");
    }
    expect(reopenedImage.imageId).toBe(image.imageId);
  });
});

describe("resource allocation over a hand-assembled, multi-page, multi-font, multi-image document", () => {
  it("writePdf allocates distinct font/image resources correctly for a document built incrementally rather than by a layout engine in one pass", () => {
    const editor = createPdf();
    const pageOne = editor.pages()[0]!;
    pageOne.appendText({
      xPt: 10,
      yPt: 10,
      text: "Plain",
      font: DEFAULT_LAYOUT_FONT,
      sizePt: 12,
      color: BLACK,
    });
    pageOne.appendText({
      xPt: 10,
      yPt: 30,
      text: "Bold Italic",
      font: { family: "Helvetica", weight: "bold", style: "italic" },
      sizePt: 12,
      color: BLUE,
    });
    pageOne.appendImage({
      xPt: 10,
      yPt: 50,
      widthPt: 20,
      heightPt: 20,
      bytes: pngBytes([255, 0, 0]),
      format: "png",
    });

    const pageTwo = editor.appendPage();
    pageTwo.appendText({
      xPt: 10,
      yPt: 10,
      text: "Second page text",
      font: { family: "Helvetica", weight: "bold", style: "italic" },
      sizePt: 14,
      color: RED,
    });
    pageTwo.appendImage({
      xPt: 10,
      yPt: 50,
      widthPt: 20,
      heightPt: 20,
      bytes: pngBytes([0, 0, 255]),
      format: "png",
    });

    const reopened = readPdf(editor.toBytes());
    expect(reopened.pages).toHaveLength(2);

    const firstPageTexts = reopened.pages[0]!.items.filter(
      (item) => item.kind === "text",
    );
    expect(firstPageTexts.map((item) => item.text)).toEqual([
      "Plain",
      "Bold Italic",
    ]);
    expect(firstPageTexts[0]?.font.weight).toBe("normal");
    expect(firstPageTexts[1]?.font.weight).toBe("bold");
    expect(firstPageTexts[1]?.font.style).toBe("italic");
    expect(firstPageTexts[1]?.color).toEqual(BLUE);

    const secondPageText = reopened.pages[1]!.items.find(
      (item) => item.kind === "text",
    );
    if (secondPageText?.kind !== "text") {
      throw new Error("expected a text item on the second page");
    }
    expect(secondPageText.text).toBe("Second page text");
    expect(secondPageText.color).toEqual(RED);

    // Two genuinely different images across two pages resolve to two distinct, correctly-associated imageIds.
    const firstImage = reopened.pages[0]!.items.find(
      (item) => item.kind === "image",
    );
    const secondImage = reopened.pages[1]!.items.find(
      (item) => item.kind === "image",
    );
    if (firstImage?.kind !== "image" || secondImage?.kind !== "image") {
      throw new Error("expected an image item on each page");
    }
    expect(firstImage.imageId).not.toBe(secondImage.imageId);
    expect(Object.keys(reopened.images)).toHaveLength(2);
  });
});

describe("full mixed-edit round trip: open, mutate several kinds across several pages including deletions, save, reopen", () => {
  it("every mutation persists and every removed item is genuinely gone", () => {
    const editor = openPdf(twoPageMultiTextPdf());
    const pageZero = editor.pages()[0]!;
    const pageOne = editor.pages()[1]!;

    // Edit an existing item on page 0.
    pageZero.textItems()[0]!.text = "PageZeroEdited";

    // Remove one item on page 1, edit the survivor, and insert a new rect.
    const [firstOnPageOne, secondOnPageOne] = pageOne.textItems();
    secondOnPageOne!.remove();
    firstOnPageOne!.sizePt = 20;
    pageOne.appendRect({
      xPt: 5,
      yPt: 5,
      widthPt: 15,
      heightPt: 15,
      fill: RED,
    });

    // Append a brand new third page with an image and a link.
    const pageTwo = editor.appendPage({ widthPt: 250, heightPt: 150 });
    pageTwo.appendImage({
      xPt: 0,
      yPt: 0,
      widthPt: 10,
      heightPt: 10,
      bytes: pngBytes([10, 20, 30]),
      format: "png",
    });
    pageTwo.appendLink({
      uri: "https://example.com",
      xPt: 0,
      yPt: 0,
      widthPt: 40,
      heightPt: 20,
    });

    const bytes = editor.toBytes();
    const reopened = openPdf(bytes);
    expect(reopened.pages()).toHaveLength(3);

    const reopenedPageZero = reopened.pages()[0]!;
    expect(reopenedPageZero.textItems().map((item) => item.text)).toEqual([
      "PageZeroEdited",
    ]);

    const reopenedPageOne = reopened.pages()[1]!;
    expect(reopenedPageOne.textItems()).toHaveLength(1);
    expect(reopenedPageOne.textItems()[0]?.text).toBe("First");
    expect(reopenedPageOne.textItems()[0]?.sizePt).toBe(20);
    expect(reopenedPageOne.rectItems()).toHaveLength(1);
    expect(reopenedPageOne.rectItems()[0]?.fill).toEqual(RED);

    const reopenedPageTwo = reopened.pages()[2]!;
    expect(reopenedPageTwo.widthPt).toBe(250);
    expect(reopenedPageTwo.heightPt).toBe(150);
    expect(reopenedPageTwo.imageItems()).toHaveLength(1);
    expect(reopenedPageTwo.linkItems()).toHaveLength(1);
    expect(reopenedPageTwo.linkItems()[0]?.uri).toBe("https://example.com");
  });
});

describe("createPdf", () => {
  it("defaults to one US Letter page, and widthPt/heightPt override it", () => {
    const editor = createPdf();
    expect(editor.pages()).toHaveLength(1);
    expect(editor.pages()[0]?.widthPt).toBe(612);
    expect(editor.pages()[0]?.heightPt).toBe(792);

    const custom = createPdf({ widthPt: 300, heightPt: 200 });
    expect(custom.pages()[0]?.widthPt).toBe(300);
    expect(custom.pages()[0]?.heightPt).toBe(200);
  });

  it("stamps real, agreeing metadata createdIso/modifiedIso timestamps", () => {
    const editor = createPdf();
    const metadata = editor.metadata;
    expect(metadata.createdIso).toBeDefined();
    expect(metadata.modifiedIso).toBe(metadata.createdIso);
  });
});

describe("PdfEditor.metadata", () => {
  it("is a live getter/setter over the document's own metadata", () => {
    const editor = createPdf();
    editor.metadata = { ...editor.metadata, title: "A Title", author: "Jane" };
    expect(editor.metadata.title).toBe("A Title");
    expect(editor.metadata.author).toBe("Jane");
  });
});

describe("PdfEditor.pages / page / appendPage / insertPageAt", () => {
  it("page(index) returns undefined past the end, and a live handle in range", () => {
    const editor = createPdf();
    expect(editor.page(0)).toBeDefined();
    expect(editor.page(1)).toBeUndefined();
  });

  it("insertPageAt places a new page at the given position without disturbing the others", () => {
    const editor = createPdf();
    editor.pages()[0]!.appendText({
      xPt: 0,
      yPt: 0,
      text: "First",
      font: DEFAULT_LAYOUT_FONT,
      sizePt: 10,
      color: BLACK,
    });
    editor.appendPage().appendText({
      xPt: 0,
      yPt: 0,
      text: "Third",
      font: DEFAULT_LAYOUT_FONT,
      sizePt: 10,
      color: BLACK,
    });

    editor.insertPageAt(1).appendText({
      xPt: 0,
      yPt: 0,
      text: "Second",
      font: DEFAULT_LAYOUT_FONT,
      sizePt: 10,
      color: BLACK,
    });

    expect(editor.pages().map((page) => page.textItems()[0]?.text)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
  });
});

describe("toLayoutDocument / toBytes", () => {
  it("toLayoutDocument returns the live document itself, not a snapshot", () => {
    const editor = createPdf();
    const doc = editor.toLayoutDocument();
    editor.pages()[0]!.appendText({
      xPt: 0,
      yPt: 0,
      text: "X",
      font: DEFAULT_LAYOUT_FONT,
      sizePt: 10,
      color: BLACK,
    });
    expect(doc.pages[0]?.items).toHaveLength(1);
  });

  it("toBytes runs writePdf fresh every call, reflecting whatever has changed since the previous call", () => {
    const editor = createPdf();
    const page = editor.pages()[0]!;
    const item = page.appendText({
      xPt: 0,
      yPt: 0,
      text: "Before",
      font: DEFAULT_LAYOUT_FONT,
      sizePt: 10,
      color: BLACK,
    });
    const before = readPdf(editor.toBytes()).pages[0]?.items[0];
    if (before?.kind !== "text") {
      throw new Error("expected a text item");
    }
    expect(before.text).toBe("Before");

    item.text = "After";
    const after = readPdf(editor.toBytes()).pages[0]?.items[0];
    if (after?.kind !== "text") {
      throw new Error("expected a text item");
    }
    expect(after.text).toBe("After");
  });
});

describe("openPdf: a source requiring a real password throws before returning an editor", () => {
  it("throws PdfPasswordRequiredError rather than producing a PdfEditor", () => {
    expect(() => openPdf(encryptedPdf())).toThrow(PdfPasswordRequiredError);
  });
});
