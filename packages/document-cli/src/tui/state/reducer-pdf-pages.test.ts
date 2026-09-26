import {
  createPdf,
  LAYOUT_FORMAT_VERSION,
  type LayoutDocument,
  openPdf,
  writePdf,
} from "documents.js";
import { describe, expect, it } from "vitest";
import type { Action } from "./actions.js";
import { appReducer, createInitialState } from "./reducer.js";
import type { AppState, PdfOpenDocument } from "./types.js";
const REAL_PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02,
  0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44,
  0x41, 0x54, 0x78, 0xda, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x03, 0x01, 0x01,
  0x00, 0xf7, 0x03, 0x41, 0x43, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82,
]);

function pdfDocument(state: AppState): PdfOpenDocument {
  const doc = state.openDocument;
  if (doc?.format !== "pdf") {
    throw new Error("expected an open pdf document");
  }
  return doc;
}

function openPdfDocument(
  bytes: Uint8Array<ArrayBuffer>,
  path = "/tmp/document.pdf",
): AppState {
  const editor = openPdf(bytes);
  return appReducer(createInitialState(), {
    type: "OPEN_FILE_SUCCESS",
    path,
    doc: { format: "pdf", editor, layout: editor.toLayoutDocument(), path },
  });
}

function pdfTestBytes(): Uint8Array<ArrayBuffer> {
  const editor = createPdf();
  const page = editor.pages()[0];
  if (page === undefined) {
    throw new Error("createPdf() always seeds one page");
  }
  page.appendText({
    xPt: 10,
    yPt: 20,
    text: "Hello",
    font: { family: "Helvetica", weight: "normal", style: "normal" },
    sizePt: 12,
    color: { r: 0, g: 0, b: 0 },
  });
  return editor.toBytes();
}

describe("appReducer PDF item and page mutations", () => {
  it("warns rather than crashing for a page index that does not exist", () => {
    const opened = openPdfDocument(pdfTestBytes());
    const result = appReducer(opened, {
      type: "ADD_PDF_RECT",
      pageIndex: 5,
      init: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe("There is no page at index 5");
    expect(result.hasUnsavedChanges).toBe(false);
  });

  it("warns rather than crashing when a field-edit action targets an item of the wrong kind", () => {
    const opened = openPdfDocument(pdfTestBytes());
    // Item 0 is the fixture's own text item, not a rect.
    const result = appReducer(opened, {
      type: "SET_PDF_RECT_FILL",
      pageIndex: 0,
      itemIndex: 0,
      fill: { r: 1, g: 0, b: 0 },
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toContain("not rect");
    expect(result.hasUnsavedChanges).toBe(false);
  });

  // withPdfPage's own wrongDocument path — every ADD_PDF_* test above only exercises the "no page at that index" branch against an already-open PDF, never the "not a PDF at all" branch.
  it("warns rather than crashing when ADD_PDF_RECT targets a non-PDF document", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const result = appReducer(created, {
      type: "ADD_PDF_RECT",
      pageIndex: 0,
      init: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe(
      "That action needs a pdf document; the open document is docx",
    );
  });

  // withPdfItemMatching's own wrongDocument path — a genuinely separate function from withPdfPage above, so covering one says nothing about the other.
  it("warns rather than crashing when SET_PDF_RECT_FILL targets a non-PDF document", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const result = appReducer(created, {
      type: "SET_PDF_RECT_FILL",
      pageIndex: 0,
      itemIndex: 0,
      fill: { r: 1, g: 0, b: 0 },
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe(
      "That action needs a pdf document; the open document is docx",
    );
  });

  // withPdfItemMatching's own "no item at that index" path — the wrong-kind test above needs a real item at itemIndex 0 to check its kind against, so it can never reach this branch; this needs a valid page with an item count too low for the requested index instead.
  it("warns rather than crashing when SET_PDF_RECT_FILL targets an item index that does not exist", () => {
    const opened = openPdfDocument(pdfTestBytes());
    const result = appReducer(opened, {
      type: "SET_PDF_RECT_FILL",
      pageIndex: 0,
      itemIndex: 9,
      fill: { r: 1, g: 0, b: 0 },
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe("Page 0 has no item at index 9");
    expect(result.hasUnsavedChanges).toBe(false);
  });

  it("adds a link via ADD_PDF_LINK, present after a toBytes()/openPdf() round trip", () => {
    const opened = openPdfDocument(pdfTestBytes());
    const withLink = appReducer(opened, {
      type: "ADD_PDF_LINK",
      pageIndex: 0,
      init: {
        uri: "https://example.com",
        xPt: 5,
        yPt: 5,
        widthPt: 40,
        heightPt: 15,
      },
    });
    const reopened = openPdf(pdfDocument(withLink).editor.toBytes());
    const link = (reopened.page(0)?.items() ?? []).find(
      (item) => item.kind === "link",
    );
    expect(link).toBeDefined();
    if (link?.kind !== "link") {
      throw new Error("expected a real link item after re-parsing");
    }
    expect(link.uri).toBe("https://example.com");
  });

  describe("field edits on non-text pdf item kinds", () => {
    // One page carrying one of every editable non-text item kind, each added through the reducer's own ADD_PDF_* actions so tests below index into a document built the same way a real session would build one.
    function pdfMultiItemState(): AppState {
      const opened = openPdfDocument(pdfTestBytes());
      const withRect = appReducer(opened, {
        type: "ADD_PDF_RECT",
        pageIndex: 0,
        init: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      });
      const withEllipse = appReducer(withRect, {
        type: "ADD_PDF_ELLIPSE",
        pageIndex: 0,
        init: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      });
      const withLine = appReducer(withEllipse, {
        type: "ADD_PDF_LINE",
        pageIndex: 0,
        init: {
          x1Pt: 0,
          y1Pt: 0,
          x2Pt: 10,
          y2Pt: 10,
          color: { r: 0, g: 0, b: 0 },
          widthPt: 1,
        },
      });
      const withPath = appReducer(withLine, {
        type: "ADD_PDF_PATH",
        pageIndex: 0,
        init: {
          subpaths: [
            {
              startXPt: 0,
              startYPt: 0,
              closed: false,
              segments: [{ kind: "line", xPt: 5, yPt: 5 }],
            },
          ],
        },
      });
      const withImage = appReducer(withPath, {
        type: "ADD_PDF_IMAGE",
        pageIndex: 0,
        init: {
          xPt: 0,
          yPt: 0,
          widthPt: 10,
          heightPt: 10,
          bytes: REAL_PNG_BYTES,
          format: "png",
        },
      });
      return appReducer(withImage, {
        type: "ADD_PDF_LINK",
        pageIndex: 0,
        init: {
          uri: "https://before.example",
          xPt: 0,
          yPt: 0,
          widthPt: 10,
          heightPt: 10,
        },
      });
    }

    // Item order matches pdfMultiItemState()'s own build sequence: 0 text, 1 rect, 2 ellipse, 3 line, 4 path, 5 image, 6 link.
    const TEXT_INDEX = 0;
    const RECT_INDEX = 1;
    const ELLIPSE_INDEX = 2;
    const LINE_INDEX = 3;
    const PATH_INDEX = 4;
    const IMAGE_INDEX = 5;
    const LINK_INDEX = 6;

    it("edits a rect's frame, fill, and stroke in place", () => {
      const state = pdfMultiItemState();
      const withFrame = appReducer(state, {
        type: "SET_PDF_RECT_FRAME",
        pageIndex: 0,
        itemIndex: RECT_INDEX,
        xPt: 1,
        yPt: 2,
        widthPt: 33,
        heightPt: 44,
      });
      const withFill = appReducer(withFrame, {
        type: "SET_PDF_RECT_FILL",
        pageIndex: 0,
        itemIndex: RECT_INDEX,
        fill: { r: 1, g: 0.5, b: 0 },
      });
      const withStroke = appReducer(withFill, {
        type: "SET_PDF_RECT_STROKE",
        pageIndex: 0,
        itemIndex: RECT_INDEX,
        stroke: { color: { r: 0, g: 0, b: 1 }, widthPt: 3 },
      });
      const item = pdfDocument(withStroke).editor.page(0)?.items()[RECT_INDEX];
      if (item?.kind !== "rect") {
        throw new Error("expected a live rect item");
      }
      expect(item.xPt).toBe(1);
      expect(item.yPt).toBe(2);
      expect(item.widthPt).toBe(33);
      expect(item.heightPt).toBe(44);
      expect(item.fill).toStrictEqual({ r: 1, g: 0.5, b: 0 });
      expect(item.stroke).toStrictEqual({
        color: { r: 0, g: 0, b: 1 },
        widthPt: 3,
      });
    });

    it("warns rather than crashing when a rect field-edit targets an item of the wrong kind", () => {
      const state = pdfMultiItemState();
      const result = appReducer(state, {
        type: "SET_PDF_RECT_FRAME",
        pageIndex: 0,
        itemIndex: ELLIPSE_INDEX,
        xPt: 0,
        yPt: 0,
        widthPt: 1,
        heightPt: 1,
      });
      expect(result.status?.severity).toBe("warning");
      expect(result.status?.text).toContain("not rect");
    });

    it("edits an ellipse's frame, fill, and stroke in place", () => {
      const state = pdfMultiItemState();
      const withFrame = appReducer(state, {
        type: "SET_PDF_ELLIPSE_FRAME",
        pageIndex: 0,
        itemIndex: ELLIPSE_INDEX,
        xPt: 3,
        yPt: 4,
        widthPt: 22,
        heightPt: 11,
      });
      const withFill = appReducer(withFrame, {
        type: "SET_PDF_ELLIPSE_FILL",
        pageIndex: 0,
        itemIndex: ELLIPSE_INDEX,
        fill: { r: 0, g: 1, b: 0 },
      });
      const withStroke = appReducer(withFill, {
        type: "SET_PDF_ELLIPSE_STROKE",
        pageIndex: 0,
        itemIndex: ELLIPSE_INDEX,
        stroke: { color: { r: 1, g: 1, b: 0 }, widthPt: 2 },
      });
      const item = pdfDocument(withStroke).editor.page(0)?.items()[
        ELLIPSE_INDEX
      ];
      if (item?.kind !== "ellipse") {
        throw new Error("expected a live ellipse item");
      }
      expect(item.widthPt).toBe(22);
      expect(item.heightPt).toBe(11);
      expect(item.fill).toStrictEqual({ r: 0, g: 1, b: 0 });
      expect(item.stroke).toStrictEqual({
        color: { r: 1, g: 1, b: 0 },
        widthPt: 2,
      });
    });

    it("warns rather than crashing when an ellipse field-edit targets an item of the wrong kind", () => {
      const state = pdfMultiItemState();
      const result = appReducer(state, {
        type: "SET_PDF_ELLIPSE_FILL",
        pageIndex: 0,
        itemIndex: LINE_INDEX,
        fill: { r: 0, g: 0, b: 0 },
      });
      expect(result.status?.severity).toBe("warning");
      expect(result.status?.text).toContain("not ellipse");
    });

    it("edits a line's endpoints, color, and width in place", () => {
      const state = pdfMultiItemState();
      const withFrom = appReducer(state, {
        type: "SET_PDF_LINE_FROM",
        pageIndex: 0,
        itemIndex: LINE_INDEX,
        x1Pt: 7,
        y1Pt: 8,
      });
      const withTo = appReducer(withFrom, {
        type: "SET_PDF_LINE_TO",
        pageIndex: 0,
        itemIndex: LINE_INDEX,
        x2Pt: 70,
        y2Pt: 80,
      });
      const withColor = appReducer(withTo, {
        type: "SET_PDF_LINE_COLOR",
        pageIndex: 0,
        itemIndex: LINE_INDEX,
        color: { r: 0.2, g: 0.3, b: 0.4 },
      });
      const withWidth = appReducer(withColor, {
        type: "SET_PDF_LINE_WIDTH",
        pageIndex: 0,
        itemIndex: LINE_INDEX,
        widthPt: 5,
      });
      const item = pdfDocument(withWidth).editor.page(0)?.items()[LINE_INDEX];
      if (item?.kind !== "line") {
        throw new Error("expected a live line item");
      }
      expect(item.x1Pt).toBe(7);
      expect(item.y1Pt).toBe(8);
      expect(item.x2Pt).toBe(70);
      expect(item.y2Pt).toBe(80);
      expect(item.color).toStrictEqual({ r: 0.2, g: 0.3, b: 0.4 });
      expect(item.widthPt).toBe(5);
    });

    it("warns rather than crashing when a line field-edit targets an item of the wrong kind", () => {
      const state = pdfMultiItemState();
      const result = appReducer(state, {
        type: "SET_PDF_LINE_WIDTH",
        pageIndex: 0,
        itemIndex: PATH_INDEX,
        widthPt: 1,
      });
      expect(result.status?.severity).toBe("warning");
      expect(result.status?.text).toContain("not line");
    });

    it("edits a path's fill, fill rule, and stroke in place", () => {
      const state = pdfMultiItemState();
      const withFill = appReducer(state, {
        type: "SET_PDF_PATH_FILL",
        pageIndex: 0,
        itemIndex: PATH_INDEX,
        fill: { r: 1, g: 0, b: 1 },
      });
      const withRule = appReducer(withFill, {
        type: "SET_PDF_PATH_FILL_RULE",
        pageIndex: 0,
        itemIndex: PATH_INDEX,
        fillRule: "evenodd",
      });
      const withStroke = appReducer(withRule, {
        type: "SET_PDF_PATH_STROKE",
        pageIndex: 0,
        itemIndex: PATH_INDEX,
        stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1.5 },
      });
      const item = pdfDocument(withStroke).editor.page(0)?.items()[PATH_INDEX];
      if (item?.kind !== "path") {
        throw new Error("expected a live path item");
      }
      expect(item.fill).toStrictEqual({ r: 1, g: 0, b: 1 });
      expect(item.fillRule).toBe("evenodd");
      expect(item.stroke).toStrictEqual({
        color: { r: 0, g: 0, b: 0 },
        widthPt: 1.5,
      });
    });

    it("warns rather than crashing when a path field-edit targets an item of the wrong kind", () => {
      const state = pdfMultiItemState();
      const result = appReducer(state, {
        type: "SET_PDF_PATH_FILL_RULE",
        pageIndex: 0,
        itemIndex: IMAGE_INDEX,
        fillRule: "nonzero",
      });
      expect(result.status?.severity).toBe("warning");
      expect(result.status?.text).toContain("not path");
    });

    it("edits an image's frame, rotation, and source in place", () => {
      const state = pdfMultiItemState();
      const withFrame = appReducer(state, {
        type: "SET_PDF_IMAGE_FRAME",
        pageIndex: 0,
        itemIndex: IMAGE_INDEX,
        xPt: 9,
        yPt: 10,
        widthPt: 15,
        heightPt: 25,
      });
      const withRotation = appReducer(withFrame, {
        type: "SET_PDF_IMAGE_ROTATION",
        pageIndex: 0,
        itemIndex: IMAGE_INDEX,
        rotationDeg: 90,
      });
      const beforeItem = pdfDocument(withRotation).editor.page(0)?.items()[
        IMAGE_INDEX
      ];
      if (beforeItem?.kind !== "image") {
        throw new Error("expected a live image item");
      }
      // Read the string value now, before the mutation below: beforeItem is a live view over the same underlying node, so its own .imageId getter would report the POST-mutation value if read only after withSource exists.
      const beforeImageIdValue = beforeItem.imageId;
      const withSource = appReducer(withRotation, {
        type: "SET_PDF_IMAGE_SOURCE",
        pageIndex: 0,
        itemIndex: IMAGE_INDEX,
        // A different real, decodable PNG (1x1 blue rather than REAL_PNG_BYTES' red) — distinct content, so registerImageBytes' own dedup-by-content assigns it a genuinely different imageId, proving setImage repointed the item rather than leaving it unchanged.
        bytes: new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00,
          0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00,
          0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde,
          0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63,
          0x60, 0x60, 0xf8, 0x0f, 0x00, 0x01, 0x03, 0x01, 0x00, 0x36, 0x74,
          0x11, 0x40, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
          0x42, 0x60, 0x82,
        ]),
        format: "png",
      });
      const item = pdfDocument(withSource).editor.page(0)?.items()[IMAGE_INDEX];
      if (item?.kind !== "image") {
        throw new Error("expected a live image item");
      }
      expect(item.widthPt).toBe(15);
      expect(item.heightPt).toBe(25);
      expect(item.rotationDeg).toBe(90);
      expect(item.imageId).not.toBe(beforeImageIdValue);
    });

    it("warns rather than crashing when an image field-edit targets an item of the wrong kind", () => {
      const state = pdfMultiItemState();
      const result = appReducer(state, {
        type: "SET_PDF_IMAGE_ROTATION",
        pageIndex: 0,
        itemIndex: LINK_INDEX,
        rotationDeg: 0,
      });
      expect(result.status?.severity).toBe("warning");
      expect(result.status?.text).toContain("not image");
    });

    it("edits a link's uri and frame in place", () => {
      const state = pdfMultiItemState();
      const withUri = appReducer(state, {
        type: "SET_PDF_LINK_URI",
        pageIndex: 0,
        itemIndex: LINK_INDEX,
        uri: "https://after.example",
      });
      const withFrame = appReducer(withUri, {
        type: "SET_PDF_LINK_FRAME",
        pageIndex: 0,
        itemIndex: LINK_INDEX,
        xPt: 11,
        yPt: 12,
        widthPt: 50,
        heightPt: 20,
      });
      const item = pdfDocument(withFrame).editor.page(0)?.items()[LINK_INDEX];
      if (item?.kind !== "link") {
        throw new Error("expected a live link item");
      }
      expect(item.uri).toBe("https://after.example");
      expect(item.xPt).toBe(11);
      expect(item.yPt).toBe(12);
      expect(item.widthPt).toBe(50);
      expect(item.heightPt).toBe(20);
    });

    it("warns rather than crashing when a link field-edit targets an item of the wrong kind", () => {
      const state = pdfMultiItemState();
      const result = appReducer(state, {
        type: "SET_PDF_LINK_URI",
        pageIndex: 0,
        itemIndex: TEXT_INDEX,
        uri: "https://wrong.example",
      });
      expect(result.status?.severity).toBe("warning");
      expect(result.status?.text).toContain("not link");
    });

    // internalLink items arise only from reading a real PDF's own GoTo/Dest annotations (PdfPage has no appendInternalLink — unlike every other item kind, there is no way to add one fresh through the editor), so only the wrong-kind guard is reachable here; the success path is exercised at the pdf-codec layer instead (see its own navigation.test.ts).
    it("warns rather than crashing when an internal-link destination edit targets an item of the wrong kind", () => {
      const state = pdfMultiItemState();
      const result = appReducer(state, {
        type: "SET_PDF_INTERNAL_LINK_DESTINATION",
        pageIndex: 0,
        itemIndex: TEXT_INDEX,
        destination: "dest1",
      });
      expect(result.status?.severity).toBe("warning");
      expect(result.status?.text).toContain("not internalLink");
    });

    it("warns rather than crashing when an internal-link frame edit targets an item of the wrong kind", () => {
      const state = pdfMultiItemState();
      const result = appReducer(state, {
        type: "SET_PDF_INTERNAL_LINK_FRAME",
        pageIndex: 0,
        itemIndex: TEXT_INDEX,
        xPt: 1,
        yPt: 2,
        widthPt: 3,
        heightPt: 4,
      });
      expect(result.status?.severity).toBe("warning");
      expect(result.status?.text).toContain("not internalLink");
    });

    // A real internalLink item, unlike every other PDF item kind, cannot be created through PdfPage's own append* API (see the comment above) — so this builds one the only other way a genuine internalLink ever arises: writing a LayoutDocument with a real internal-link annotation through pdf-codec's own writePdf, then re-reading it, proving the isPdfInternalLinkItem guard's TRUE branch (not just its wrong-kind rejection) actually matches a real internalLink item.
    it("edits a real internal link's destination and frame through the live editor", () => {
      const layoutDoc: LayoutDocument = {
        formatVersion: LAYOUT_FORMAT_VERSION,
        metadata: {},
        images: {},
        destinations: [
          { name: "target", pageIndex: 0, target: { kind: "fit" } },
          { name: "other", pageIndex: 0, target: { kind: "fit" } },
        ],
        pages: [
          {
            widthPt: 200,
            heightPt: 200,
            items: [
              {
                kind: "internalLink",
                destination: "target",
                xPt: 10,
                yPt: 10,
                widthPt: 50,
                heightPt: 20,
              },
              // A second internalLink referencing the second destination: writePdf only carries a destination through into the saved document's own /Names tree when something actually references it, so an unreferenced destination is silently dropped on the way back in — this one needs a real referrer to survive the round trip.
              {
                kind: "internalLink",
                destination: "other",
                xPt: 70,
                yPt: 10,
                widthPt: 50,
                heightPt: 20,
              },
            ],
          },
        ],
      };
      const opened = openPdfDocument(writePdf(layoutDoc));

      const item = pdfDocument(opened).editor.page(0)?.items()[0];
      if (item?.kind !== "internalLink") {
        throw new Error("expected a real internalLink item");
      }
      const otherItem = pdfDocument(opened).editor.page(0)?.items()[1];
      if (otherItem?.kind !== "internalLink") {
        throw new Error("expected a second real internalLink item");
      }
      // The reader mints its own destination names on the way back in rather than necessarily preserving the writer's own names verbatim, so the destination this edit switches to is read from the second item's own round-tripped destination rather than assumed.
      const otherDestination = otherItem.destination;

      const withDestination = appReducer(opened, {
        type: "SET_PDF_INTERNAL_LINK_DESTINATION",
        pageIndex: 0,
        itemIndex: 0,
        destination: otherDestination,
      });
      expect(withDestination.status?.severity).not.toBe("warning");
      expect(withDestination.hasUnsavedChanges).toBe(true);
      expect(item.destination).toBe(otherDestination);

      const withFrame = appReducer(withDestination, {
        type: "SET_PDF_INTERNAL_LINK_FRAME",
        pageIndex: 0,
        itemIndex: 0,
        xPt: 1,
        yPt: 2,
        widthPt: 3,
        heightPt: 4,
      });
      expect(withFrame.status?.severity).not.toBe("warning");
      expect(item.xPt).toBe(1);
      expect(item.yPt).toBe(2);
      expect(item.widthPt).toBe(3);
      expect(item.heightPt).toBe(4);
    });

    // Every other SET_PDF_*_* field-edit action routes through the identical withPdfItemMatching guard, but each call site carries its OWN copy of the kindLabel string literal — exercising the wrong-kind path through the FRAME/FILL/one representative action per kind above does not cover the same literal at a sibling action's own call site (e.g. SET_PDF_RECT_FRAME's "rect" and SET_PDF_RECT_STROKE's "rect" are two distinct AST nodes). This table drives every remaining action through the wrong-kind branch once each.
    const wrongKindCases: [string, Action, string][] = [
      [
        "SET_PDF_TEXT_TEXT",
        {
          type: "SET_PDF_TEXT_TEXT",
          pageIndex: 0,
          itemIndex: RECT_INDEX,
          text: "x",
        },
        "not text",
      ],
      [
        "SET_PDF_TEXT_POSITION",
        {
          type: "SET_PDF_TEXT_POSITION",
          pageIndex: 0,
          itemIndex: RECT_INDEX,
          xPt: 0,
          yPt: 0,
        },
        "not text",
      ],
      [
        "SET_PDF_TEXT_COLOR",
        {
          type: "SET_PDF_TEXT_COLOR",
          pageIndex: 0,
          itemIndex: RECT_INDEX,
          color: { r: 0, g: 0, b: 0 },
        },
        "not text",
      ],
      [
        "SET_PDF_TEXT_WIDTH",
        {
          type: "SET_PDF_TEXT_WIDTH",
          pageIndex: 0,
          itemIndex: RECT_INDEX,
          widthPt: 1,
        },
        "not text",
      ],
      [
        "TOGGLE_PDF_TEXT_UNDERLINE",
        {
          type: "TOGGLE_PDF_TEXT_UNDERLINE",
          pageIndex: 0,
          itemIndex: RECT_INDEX,
        },
        "not text",
      ],
      [
        "SET_PDF_RECT_STROKE",
        {
          type: "SET_PDF_RECT_STROKE",
          pageIndex: 0,
          itemIndex: TEXT_INDEX,
          stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
        },
        "not rect",
      ],
      [
        "SET_PDF_ELLIPSE_FRAME",
        {
          type: "SET_PDF_ELLIPSE_FRAME",
          pageIndex: 0,
          itemIndex: TEXT_INDEX,
          xPt: 0,
          yPt: 0,
          widthPt: 1,
          heightPt: 1,
        },
        "not ellipse",
      ],
      [
        "SET_PDF_ELLIPSE_STROKE",
        {
          type: "SET_PDF_ELLIPSE_STROKE",
          pageIndex: 0,
          itemIndex: TEXT_INDEX,
          stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
        },
        "not ellipse",
      ],
      [
        "SET_PDF_LINE_FROM",
        {
          type: "SET_PDF_LINE_FROM",
          pageIndex: 0,
          itemIndex: TEXT_INDEX,
          x1Pt: 0,
          y1Pt: 0,
        },
        "not line",
      ],
      [
        "SET_PDF_LINE_TO",
        {
          type: "SET_PDF_LINE_TO",
          pageIndex: 0,
          itemIndex: TEXT_INDEX,
          x2Pt: 0,
          y2Pt: 0,
        },
        "not line",
      ],
      [
        "SET_PDF_LINE_COLOR",
        {
          type: "SET_PDF_LINE_COLOR",
          pageIndex: 0,
          itemIndex: TEXT_INDEX,
          color: { r: 0, g: 0, b: 0 },
        },
        "not line",
      ],
      [
        "SET_PDF_PATH_FILL",
        {
          type: "SET_PDF_PATH_FILL",
          pageIndex: 0,
          itemIndex: TEXT_INDEX,
          fill: { r: 0, g: 0, b: 0 },
        },
        "not path",
      ],
      [
        "SET_PDF_PATH_STROKE",
        {
          type: "SET_PDF_PATH_STROKE",
          pageIndex: 0,
          itemIndex: TEXT_INDEX,
          stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
        },
        "not path",
      ],
      [
        "SET_PDF_IMAGE_FRAME",
        {
          type: "SET_PDF_IMAGE_FRAME",
          pageIndex: 0,
          itemIndex: TEXT_INDEX,
          xPt: 0,
          yPt: 0,
          widthPt: 1,
          heightPt: 1,
        },
        "not image",
      ],
      [
        "SET_PDF_IMAGE_SOURCE",
        {
          type: "SET_PDF_IMAGE_SOURCE",
          pageIndex: 0,
          itemIndex: TEXT_INDEX,
          format: "png",
          bytes: REAL_PNG_BYTES,
        },
        "not image",
      ],
      [
        "SET_PDF_LINK_FRAME",
        {
          type: "SET_PDF_LINK_FRAME",
          pageIndex: 0,
          itemIndex: TEXT_INDEX,
          xPt: 0,
          yPt: 0,
          widthPt: 1,
          heightPt: 1,
        },
        "not link",
      ],
    ];

    it.each(wrongKindCases)(
      "warns rather than crashing when %s targets an item of the wrong kind",
      (_name, action, expectedFragment) => {
        const state = pdfMultiItemState();
        const result = appReducer(state, action);
        expect(result.status?.severity).toBe("warning");
        expect(result.status?.text).toContain(expectedFragment);
      },
    );
  });
});
