import { createPdf, openPdf } from "documents.js";
import { describe, expect, it } from "vitest";
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
  it("adds an ellipse via ADD_PDF_ELLIPSE, present after a toBytes()/openPdf() round trip", () => {
    const opened = openPdfDocument(pdfTestBytes());
    const withEllipse = appReducer(opened, {
      type: "ADD_PDF_ELLIPSE",
      pageIndex: 0,
      init: {
        xPt: 5,
        yPt: 5,
        widthPt: 20,
        heightPt: 10,
        fill: { r: 1, g: 0, b: 0 },
      },
    });
    const reopened = openPdf(pdfDocument(withEllipse).editor.toBytes());
    const ellipse = (reopened.page(0)?.items() ?? []).find(
      (item) => item.kind === "ellipse",
    );
    expect(ellipse).toBeDefined();
    if (ellipse?.kind !== "ellipse") {
      throw new Error("expected a real ellipse item after re-parsing");
    }
    expect(ellipse.widthPt).toBeCloseTo(20, 0);
    expect(ellipse.heightPt).toBeCloseTo(10, 0);
  });

  it("adds a line via ADD_PDF_LINE, present after a toBytes()/openPdf() round trip", () => {
    const opened = openPdfDocument(pdfTestBytes());
    const withLine = appReducer(opened, {
      type: "ADD_PDF_LINE",
      pageIndex: 0,
      init: {
        x1Pt: 1,
        y1Pt: 2,
        x2Pt: 30,
        y2Pt: 40,
        color: { r: 0, g: 0, b: 1 },
        widthPt: 2,
      },
    });
    const reopened = openPdf(pdfDocument(withLine).editor.toBytes());
    const line = (reopened.page(0)?.items() ?? []).find(
      (item) => item.kind === "line",
    );
    expect(line).toBeDefined();
    if (line?.kind !== "line") {
      throw new Error("expected a real line item after re-parsing");
    }
    expect(line.x2Pt).toBeCloseTo(30, 0);
    expect(line.y2Pt).toBeCloseTo(40, 0);
  });

  it("adds a path via ADD_PDF_PATH, present after a toBytes()/openPdf() round trip", () => {
    const opened = openPdfDocument(pdfTestBytes());
    const withPath = appReducer(opened, {
      type: "ADD_PDF_PATH",
      pageIndex: 0,
      init: {
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
        fill: { r: 0, g: 1, b: 1 },
      },
    });
    const reopened = openPdf(pdfDocument(withPath).editor.toBytes());
    const path = (reopened.page(0)?.items() ?? []).find(
      (item) => item.kind === "path",
    );
    expect(path).toBeDefined();
  });

  it("adds an image via ADD_PDF_IMAGE, present after a toBytes()/openPdf() round trip", () => {
    const opened = openPdfDocument(pdfTestBytes());
    const withImage = appReducer(opened, {
      type: "ADD_PDF_IMAGE",
      pageIndex: 0,
      init: {
        xPt: 5,
        yPt: 5,
        widthPt: 30,
        heightPt: 20,
        bytes: REAL_PNG_BYTES,
        format: "png",
      },
    });
    const reopened = openPdf(pdfDocument(withImage).editor.toBytes());
    const image = (reopened.page(0)?.items() ?? []).find(
      (item) => item.kind === "image",
    );
    expect(image).toBeDefined();
    if (image?.kind !== "image") {
      throw new Error("expected a real image item after re-parsing");
    }
    expect(image.widthPt).toBeCloseTo(30, 0);
    expect(image.heightPt).toBeCloseTo(20, 0);
  });
});
