import { createPdf, openPdf } from "documents.js";
import { describe, expect, it } from "vitest";
import { appReducer, createInitialState } from "./reducer.js";
import type { AppState, PdfOpenDocument } from "./types.js";

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
  it("edits a text item field by field, and the change round-trips through toBytes() -> a fresh openPdf() re-parse", () => {
    const opened = openPdfDocument(pdfTestBytes());

    const withText = appReducer(opened, {
      type: "SET_PDF_TEXT_TEXT",
      pageIndex: 0,
      itemIndex: 0,
      text: "Goodbye",
    });
    const withColor = appReducer(withText, {
      type: "SET_PDF_TEXT_COLOR",
      pageIndex: 0,
      itemIndex: 0,
      color: { r: 1, g: 0, b: 0 },
    });
    const withPosition = appReducer(withColor, {
      type: "SET_PDF_TEXT_POSITION",
      pageIndex: 0,
      itemIndex: 0,
      xPt: 50,
      yPt: 60,
    });
    expect(withPosition.hasUnsavedChanges).toBe(true);

    // The live view means the item captured before each action already reflects the mutation.
    const liveItem = pdfDocument(withPosition).editor.page(0)?.items()[0];
    if (liveItem?.kind !== "text") {
      throw new Error("expected a live text item");
    }
    expect(liveItem.text).toBe("Goodbye");
    expect(liveItem.color).toStrictEqual({ r: 1, g: 0, b: 0 });
    expect(liveItem.xPt).toBe(50);
    expect(liveItem.yPt).toBe(60);

    // Re-decoding the saved bytes as a completely fresh PDF proves every field was written into the real PDF content stream, not just held on the live in-memory object.
    const reopened = openPdf(pdfDocument(withPosition).editor.toBytes());
    const reopenedItem = reopened.page(0)?.items()[0];
    if (reopenedItem?.kind !== "text") {
      throw new Error("expected a real text item after re-parsing");
    }
    expect(reopenedItem.text).toBe("Goodbye");
    expect(reopenedItem.color.r).toBeCloseTo(1, 1);
    expect(reopenedItem.color.g).toBeCloseTo(0, 1);
    expect(reopenedItem.xPt).toBeCloseTo(50, 0);
    expect(reopenedItem.yPt).toBeCloseTo(60, 0);
  });

  it("adds a text item via ADD_PDF_TEXT, present after a toBytes()/openPdf() round trip", () => {
    const opened = openPdfDocument(pdfTestBytes());

    const withText = appReducer(opened, {
      type: "ADD_PDF_TEXT",
      pageIndex: 0,
      init: {
        xPt: 15,
        yPt: 25,
        text: "Second",
        font: { family: "Helvetica", weight: "normal", style: "normal" },
        sizePt: 14,
        color: { r: 0, g: 0, b: 0 },
      },
    });
    expect(pdfDocument(withText).editor.page(0)?.items()).toHaveLength(2);

    const reopened = openPdf(pdfDocument(withText).editor.toBytes());
    const items = reopened.page(0)?.items() ?? [];
    const second = items.find(
      (item) => item.kind === "text" && item.text === "Second",
    );
    expect(second).toBeDefined();
  });

  it("adds a rect via ADD_PDF_RECT, present after a toBytes()/openPdf() round trip", () => {
    const opened = openPdfDocument(pdfTestBytes());

    const withRect = appReducer(opened, {
      type: "ADD_PDF_RECT",
      pageIndex: 0,
      init: {
        xPt: 5,
        yPt: 5,
        widthPt: 40,
        heightPt: 30,
        fill: { r: 0, g: 1, b: 0 },
      },
    });
    expect(pdfDocument(withRect).editor.page(0)?.items()).toHaveLength(2);

    const reopened = openPdf(pdfDocument(withRect).editor.toBytes());
    const items = reopened.page(0)?.items() ?? [];
    expect(items).toHaveLength(2);
    const rect = items.find((item) => item.kind === "rect");
    expect(rect).toBeDefined();
    if (rect?.kind !== "rect") {
      throw new Error("expected a real rect item after re-parsing");
    }
    expect(rect.widthPt).toBeCloseTo(40, 0);
    expect(rect.heightPt).toBeCloseTo(30, 0);
  });

  it("removes an item via REMOVE_PDF_ITEM, gone after save/reopen", () => {
    const opened = openPdfDocument(pdfTestBytes());
    const withRect = appReducer(opened, {
      type: "ADD_PDF_RECT",
      pageIndex: 0,
      init: { xPt: 5, yPt: 5, widthPt: 40, heightPt: 30 },
    });
    expect(pdfDocument(withRect).editor.page(0)?.items()).toHaveLength(2);

    const withRemoval = appReducer(withRect, {
      type: "REMOVE_PDF_ITEM",
      pageIndex: 0,
      itemIndex: 1,
    });
    expect(pdfDocument(withRemoval).editor.page(0)?.items()).toHaveLength(1);

    const reopened = openPdf(pdfDocument(withRemoval).editor.toBytes());
    const items = reopened.page(0)?.items() ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("text");
  });

  // REMOVE_PDF_ITEM has its own inline wrongDocument/no-item checks, not shared with withPdfPage or withPdfItemMatching above.
  it("warns rather than crashing when REMOVE_PDF_ITEM targets a non-PDF document", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const result = appReducer(created, {
      type: "REMOVE_PDF_ITEM",
      pageIndex: 0,
      itemIndex: 0,
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe(
      "That action needs a pdf document; the open document is docx",
    );
  });

  it("warns rather than crashing when REMOVE_PDF_ITEM targets an item index that does not exist", () => {
    const opened = openPdfDocument(pdfTestBytes());
    const result = appReducer(opened, {
      type: "REMOVE_PDF_ITEM",
      pageIndex: 0,
      itemIndex: 9,
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe("Page 0 has no item at index 9");
    expect(result.hasUnsavedChanges).toBe(false);
  });

  it("undoes a PDF text edit, restoring the snapshot taken before the mutation", () => {
    const opened = openPdfDocument(pdfTestBytes());
    const edited = appReducer(opened, {
      type: "SET_PDF_TEXT_TEXT",
      pageIndex: 0,
      itemIndex: 0,
      text: "Changed",
    });
    expect(edited.undoStack).toHaveLength(1);
    const liveEdited = pdfDocument(edited).editor.page(0)?.items()[0];
    expect(liveEdited?.kind === "text" ? liveEdited.text : undefined).toBe(
      "Changed",
    );

    const undone = appReducer(edited, { type: "UNDO" });
    expect(undone.undoStack).toHaveLength(0);
    expect(undone.hasUnsavedChanges).toBe(true);
    const restoredItem = pdfDocument(undone).editor.page(0)?.items()[0];
    expect(restoredItem?.kind === "text" ? restoredItem.text : undefined).toBe(
      "Hello",
    );
    // Undo replaces the editor wholesale by re-opening the snapshot bytes, matching every other editable format's own UNDO behaviour.
    expect(pdfDocument(undone).editor).not.toBe(pdfDocument(edited).editor);
  });

  it("edits a text item's font, size, rotation, width, and toggles underline on then off", () => {
    const opened = openPdfDocument(pdfTestBytes());
    const withFont = appReducer(opened, {
      type: "SET_PDF_TEXT_FONT",
      pageIndex: 0,
      itemIndex: 0,
      font: { family: "Courier", weight: "bold", style: "italic" },
    });
    const withSize = appReducer(withFont, {
      type: "SET_PDF_TEXT_SIZE",
      pageIndex: 0,
      itemIndex: 0,
      sizePt: 24,
    });
    const withRotation = appReducer(withSize, {
      type: "SET_PDF_TEXT_ROTATION",
      pageIndex: 0,
      itemIndex: 0,
      rotationDeg: 45,
    });
    const withWidth = appReducer(withRotation, {
      type: "SET_PDF_TEXT_WIDTH",
      pageIndex: 0,
      itemIndex: 0,
      widthPt: 99,
    });
    const underlineOn = appReducer(withWidth, {
      type: "TOGGLE_PDF_TEXT_UNDERLINE",
      pageIndex: 0,
      itemIndex: 0,
    });
    const onItem = pdfDocument(underlineOn).editor.page(0)?.items()[0];
    if (onItem?.kind !== "text") {
      throw new Error("expected a live text item");
    }
    expect(onItem.font).toStrictEqual({
      family: "Courier",
      weight: "bold",
      style: "italic",
    });
    expect(onItem.sizePt).toBe(24);
    expect(onItem.rotationDeg).toBe(45);
    expect(onItem.widthPt).toBe(99);
    expect(onItem.underline).toBe(true);

    const underlineOff = appReducer(underlineOn, {
      type: "TOGGLE_PDF_TEXT_UNDERLINE",
      pageIndex: 0,
      itemIndex: 0,
    });
    const offItem = pdfDocument(underlineOff).editor.page(0)?.items()[0];
    expect(offItem?.kind === "text" ? offItem.underline : undefined).toBe(
      false,
    );
  });

  it("warns rather than crashing when SET_PDF_TEXT_FONT, SET_PDF_TEXT_SIZE, and SET_PDF_TEXT_ROTATION target an item of the wrong kind", () => {
    const opened = openPdfDocument(pdfTestBytes());
    const withRect = appReducer(opened, {
      type: "ADD_PDF_RECT",
      pageIndex: 0,
      init: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
    });
    const fontResult = appReducer(withRect, {
      type: "SET_PDF_TEXT_FONT",
      pageIndex: 0,
      itemIndex: 1,
      font: { family: "Helvetica", weight: "normal", style: "normal" },
    });
    expect(fontResult.status?.text).toContain("not text");
    const sizeResult = appReducer(withRect, {
      type: "SET_PDF_TEXT_SIZE",
      pageIndex: 0,
      itemIndex: 1,
      sizePt: 10,
    });
    expect(sizeResult.status?.text).toContain("not text");
    const rotationResult = appReducer(withRect, {
      type: "SET_PDF_TEXT_ROTATION",
      pageIndex: 0,
      itemIndex: 1,
      rotationDeg: 0,
    });
    expect(rotationResult.status?.text).toContain("not text");
  });
});
