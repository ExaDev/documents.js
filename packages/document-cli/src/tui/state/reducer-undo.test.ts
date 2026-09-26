import {
  createOdg,
  createOds,
  createPptx,
  openOdg,
  openOds,
  openPptx,
} from "documents.js";
import { describe, expect, it } from "vitest";
import { appReducer, createInitialState } from "./reducer.js";
import type {
  AppState,
  OdgOpenDocument,
  OdsOpenDocument,
  PptxOpenDocument,
} from "./types.js";
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);

// A genuinely decodable 1x1 red PNG (real IHDR/IDAT/IEND chunks, truecolor, no filter). Unlike PNG_BYTES above, PdfPage.appendImage -> registerImageBytes DOES decode the pixel grid (to size the image asset it registers), so a fake signature-only PNG throws "PNG file does not begin with an IHDR chunk" here.
function odsDocument(state: AppState): OdsOpenDocument {
  const doc = state.openDocument;
  if (doc?.format !== "ods") {
    throw new Error("expected an open ods document");
  }
  return doc;
}

function pptxDocument(state: AppState): PptxOpenDocument {
  const doc = state.openDocument;
  if (doc?.format !== "pptx") {
    throw new Error("expected an open pptx document");
  }
  return doc;
}

function odgDocument(state: AppState): OdgOpenDocument {
  const doc = state.openDocument;
  if (doc?.format !== "odg") {
    throw new Error("expected an open odg document");
  }
  return doc;
}

function openPptxDocument(
  bytes: Uint8Array<ArrayBuffer>,
  path = "/tmp/deck.pptx",
): AppState {
  return appReducer(createInitialState(), {
    type: "OPEN_FILE_SUCCESS",
    path,
    doc: { format: "pptx", editor: openPptx(bytes), path },
  });
}

function openOdsDocument(
  bytes: Uint8Array<ArrayBuffer>,
  path = "/tmp/workbook.ods",
): AppState {
  return appReducer(createInitialState(), {
    type: "OPEN_FILE_SUCCESS",
    path,
    doc: { format: "ods", editor: openOds(bytes), path },
  });
}

function openOdgDocument(
  bytes: Uint8Array<ArrayBuffer>,
  path = "/tmp/drawing.odg",
): AppState {
  return appReducer(createInitialState(), {
    type: "OPEN_FILE_SUCCESS",
    path,
    doc: { format: "odg", editor: openOdg(bytes), path },
  });
}

describe("appReducer ADD_SLIDE / ADD_PAGE", () => {
  it("appends a real slide to a pptx presentation", () => {
    const editor = createPptx();
    editor.addSlide();
    const opened = openPptxDocument(editor.toBytes());
    const withSlide = appReducer(opened, { type: "ADD_SLIDE" });
    expect(withSlide.hasUnsavedChanges).toBe(true);
    expect(pptxDocument(withSlide).editor.slides()).toHaveLength(2);
  });

  it("warns rather than crashing when the open document is neither pptx, odp nor ppt", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const result = appReducer(created, { type: "ADD_SLIDE" });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toContain("a pptx or odp document");
  });

  it("appends a real page to an odg drawing", () => {
    const editor = createOdg();
    editor.addPage();
    const opened = openOdgDocument(editor.toBytes());
    const withPage = appReducer(opened, { type: "ADD_PAGE" });
    expect(withPage.hasUnsavedChanges).toBe(true);
    expect(odgDocument(withPage).editor.pages()).toHaveLength(2);
  });

  it("warns rather than crashing when ADD_PAGE targets a non-odg document", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const result = appReducer(created, { type: "ADD_PAGE" });
    expect(result.status?.severity).toBe("warning");
  });
});

describe("appReducer ADD_TEXTBOX / ADD_IMAGE / SET_SHAPE_FRAME on pptx and odg", () => {
  it("adds a real text box to a pptx slide", () => {
    const editor = createPptx();
    editor.addSlide();
    const opened = openPptxDocument(editor.toBytes());
    const withBox = appReducer(opened, {
      type: "ADD_TEXTBOX",
      containerIndex: 0,
      frame: { xPt: 10, yPt: 10, widthPt: 100, heightPt: 30 },
      text: "Caption",
    });
    expect(withBox.hasUnsavedChanges).toBe(true);
    const shape = pptxDocument(withBox).editor.slides()[0]?.shapes()[0];
    expect(shape?.text).toBe("Caption");
  });

  it("adds a real text box to an odg page", () => {
    const editor = createOdg();
    editor.addPage();
    const opened = openOdgDocument(editor.toBytes());
    const withBox = appReducer(opened, {
      type: "ADD_TEXTBOX",
      containerIndex: 0,
      frame: { xPt: 10, yPt: 10, widthPt: 100, heightPt: 30 },
      text: "Caption",
    });
    expect(withBox.hasUnsavedChanges).toBe(true);
    const shape = odgDocument(withBox).editor.pages()[0]?.shapes()[0];
    expect(shape?.text).toBe("Caption");
  });

  it("warns rather than crashing when ADD_TEXTBOX targets a missing odg page", () => {
    const editor = createOdg();
    editor.addPage();
    const opened = openOdgDocument(editor.toBytes());
    const result = appReducer(opened, {
      type: "ADD_TEXTBOX",
      containerIndex: 4,
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      text: "x",
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe("There is no page at index 4");
  });

  it("warns rather than crashing when ADD_TEXTBOX targets a missing pptx slide", () => {
    const editor = createPptx();
    editor.addSlide();
    const opened = openPptxDocument(editor.toBytes());
    const result = appReducer(opened, {
      type: "ADD_TEXTBOX",
      containerIndex: 4,
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      text: "x",
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe("There is no slide at index 4");
  });

  it("warns rather than crashing when ADD_TEXTBOX targets a document with no shape host at all", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const result = appReducer(created, {
      type: "ADD_TEXTBOX",
      containerIndex: 0,
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      text: "x",
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toContain("a pptx, odp, ppt or odg document");
  });

  it("adds a real image to a pptx slide", () => {
    const editor = createPptx();
    editor.addSlide();
    const opened = openPptxDocument(editor.toBytes());
    const withImage = appReducer(opened, {
      type: "ADD_IMAGE",
      containerIndex: 0,
      frame: { xPt: 0, yPt: 0, widthPt: 20, heightPt: 20 },
      format: "png",
      bytes: PNG_BYTES,
      altText: undefined,
    });
    expect(withImage.hasUnsavedChanges).toBe(true);
    expect(pptxDocument(withImage).editor.slides()[0]?.shapes()).toHaveLength(
      1,
    );
  });

  it("adds a real image to an odg page", () => {
    const editor = createOdg();
    editor.addPage();
    const opened = openOdgDocument(editor.toBytes());
    const withImage = appReducer(opened, {
      type: "ADD_IMAGE",
      containerIndex: 0,
      frame: { xPt: 0, yPt: 0, widthPt: 20, heightPt: 20 },
      format: "png",
      bytes: PNG_BYTES,
      altText: undefined,
    });
    expect(withImage.hasUnsavedChanges).toBe(true);
    expect(odgDocument(withImage).editor.pages()[0]?.shapes()).toHaveLength(1);
  });

  it("warns rather than crashing when ADD_IMAGE targets a missing odg page", () => {
    const editor = createOdg();
    editor.addPage();
    const opened = openOdgDocument(editor.toBytes());
    const result = appReducer(opened, {
      type: "ADD_IMAGE",
      containerIndex: 4,
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      format: "png",
      bytes: PNG_BYTES,
      altText: undefined,
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe("There is no page at index 4");
  });

  it("warns rather than crashing when ADD_IMAGE targets a document with no shape host at all", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const result = appReducer(created, {
      type: "ADD_IMAGE",
      containerIndex: 0,
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      format: "png",
      bytes: PNG_BYTES,
      altText: undefined,
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toContain("a pptx, odp or odg document");
  });

  it("moves a real pptx shape via SET_SHAPE_FRAME", () => {
    const editor = createPptx();
    editor.addSlide();
    const opened = openPptxDocument(editor.toBytes());
    const withBox = appReducer(opened, {
      type: "ADD_TEXTBOX",
      containerIndex: 0,
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      text: "x",
    });
    const withFrame = appReducer(withBox, {
      type: "SET_SHAPE_FRAME",
      containerIndex: 0,
      shapeIndex: 0,
      frame: { xPt: 5, yPt: 6, widthPt: 20, heightPt: 30 },
    });
    expect(withFrame.hasUnsavedChanges).toBe(true);
    const shape = pptxDocument(withFrame).editor.slides()[0]?.shapes()[0];
    expect(shape?.frame).toStrictEqual({
      xPt: 5,
      yPt: 6,
      widthPt: 20,
      heightPt: 30,
    });
  });

  // withWideShape's own "page"/"slide" ternary: the odg describe block elsewhere only ever exercises the "page" branch via SET_SHAPE_TEXT, so this proves the "slide" branch specifically, on a pptx document.
  it("warns with 'slide' rather than 'page' when SET_SHAPE_FRAME targets a missing shape on a pptx slide", () => {
    const editor = createPptx();
    editor.addSlide();
    const opened = openPptxDocument(editor.toBytes());

    const result = appReducer(opened, {
      type: "SET_SHAPE_FRAME",
      containerIndex: 0,
      shapeIndex: 5,
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe("There is no shape 5 on slide 0");
  });
});

describe("appReducer SET_SHEET_PRINT_SETTINGS", () => {
  it("sets a real sheet's print settings on an ods document", () => {
    const opened = openOdsDocument(createOds().toBytes());
    const settings = {
      pageSize: { widthPt: 595, heightPt: 842 },
      margins: { topPt: 20, rightPt: 20, bottomPt: 20, leftPt: 20 },
      gridlines: true,
      headers: true,
      pageOrder: "downThenOver" as const,
    };
    const withSettings = appReducer(opened, {
      type: "SET_SHEET_PRINT_SETTINGS",
      sheetIndex: 0,
      printSettings: settings,
    });
    expect(withSettings.hasUnsavedChanges).toBe(true);
    expect(
      odsDocument(withSettings).editor.sheets()[0]?.printSettings,
    ).toStrictEqual(settings);
  });

  it("warns rather than crashing for a sheet index that does not exist", () => {
    const opened = openOdsDocument(createOds().toBytes());
    const result = appReducer(opened, {
      type: "SET_SHEET_PRINT_SETTINGS",
      sheetIndex: 5,
      printSettings: {
        pageSize: { widthPt: 595, heightPt: 842 },
        margins: { topPt: 20, rightPt: 20, bottomPt: 20, leftPt: 20 },
        gridlines: false,
        headers: false,
        pageOrder: "downThenOver",
      },
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe("There is no sheet at index 5");
  });
});
