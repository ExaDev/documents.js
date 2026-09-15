import { describe, expect, it } from "vitest";
import { createInitialState } from "./reducer.js";
import {
  anyOverlayOpen,
  currentScreen,
  isEditableDocument,
  isEditableFormat,
  isWritableDocument,
  isWritableFormat,
  rootScreenForFormat,
  selectedIndexFor,
  selectionKeyFor,
  type AppState,
  type OpenDocument,
  type OpenDocumentFormat,
  type Screen,
} from "./types.js";

describe("isEditableFormat", () => {
  it("accepts every format with a live-view editor", () => {
    for (const format of [
      "docx",
      "pptx",
      "odt",
      "odp",
      "ods",
      "odg",
      "pdf",
      "doc",
      "xls",
      "ppt",
    ]) {
      expect(isEditableFormat(format)).toBe(true);
    }
  });

  it("rejects a read-only-preview format", () => {
    expect(isEditableFormat("odb")).toBe(false);
    expect(isEditableFormat("xlsx")).toBe(false);
    expect(isEditableFormat("csv")).toBe(false);
    expect(isEditableFormat("svg")).toBe(false);
    expect(isEditableFormat("rtf")).toBe(false);
    expect(isEditableFormat("wpd")).toBe(false);
    expect(isEditableFormat("epub")).toBe(false);
  });

  it("rejects markdown, which is writable but not editable", () => {
    expect(isEditableFormat("markdown")).toBe(false);
  });

  it("rejects an unrecognised string", () => {
    expect(isEditableFormat("")).toBe(false);
    expect(isEditableFormat("bogus")).toBe(false);
  });
});

describe("isWritableFormat", () => {
  it("accepts every editable format plus markdown", () => {
    for (const format of [
      "docx",
      "pptx",
      "odt",
      "odp",
      "ods",
      "odg",
      "pdf",
      "doc",
      "xls",
      "ppt",
      "markdown",
    ]) {
      expect(isWritableFormat(format)).toBe(true);
    }
  });

  it("rejects a read-only-preview format", () => {
    expect(isWritableFormat("odb")).toBe(false);
    expect(isWritableFormat("xlsx")).toBe(false);
    expect(isWritableFormat("csv")).toBe(false);
    expect(isWritableFormat("svg")).toBe(false);
    expect(isWritableFormat("rtf")).toBe(false);
    expect(isWritableFormat("wpd")).toBe(false);
    expect(isWritableFormat("epub")).toBe(false);
  });

  it("rejects an unrecognised string", () => {
    expect(isWritableFormat("")).toBe(false);
  });
});

function documentWithFormat(format: OpenDocumentFormat): OpenDocument {
  switch (format) {
    case "docx":
    case "pptx":
    case "odt":
    case "odp":
    case "ods":
    case "odg":
    case "doc":
    case "xls":
    case "ppt":
      return { format, editor: {} as never, path: undefined };
    case "pdf":
      return {
        format,
        editor: {} as never,
        layout: {} as never,
        path: undefined,
      };
    case "markdown":
      return {
        format,
        editor: {} as never,
        originalText: undefined,
        path: undefined,
      };
    case "odb":
      return { format, tables: [], forms: [], reports: [], path: "a.odb" };
    case "xlsx":
    case "csv":
    case "svg":
    case "rtf":
    case "wpd":
    case "epub":
      return {
        format,
        layout: {} as never,
        bytes: new Uint8Array(),
        path: "a",
      };
  }
}

describe("isEditableDocument", () => {
  it("is true for every editable-format document", () => {
    for (const format of [
      "docx",
      "pptx",
      "odt",
      "odp",
      "ods",
      "odg",
      "pdf",
      "doc",
      "xls",
      "ppt",
    ] as const) {
      expect(isEditableDocument(documentWithFormat(format))).toBe(true);
    }
  });

  it("is false for a markdown document even though it is writable", () => {
    expect(isEditableDocument(documentWithFormat("markdown"))).toBe(false);
  });

  it("is false for a read-only-preview document", () => {
    expect(isEditableDocument(documentWithFormat("odb"))).toBe(false);
    expect(isEditableDocument(documentWithFormat("xlsx"))).toBe(false);
  });
});

describe("isWritableDocument", () => {
  it("is true for every editable-format document and markdown", () => {
    for (const format of [
      "docx",
      "pptx",
      "odt",
      "odp",
      "ods",
      "odg",
      "pdf",
      "doc",
      "xls",
      "ppt",
      "markdown",
    ] as const) {
      expect(isWritableDocument(documentWithFormat(format))).toBe(true);
    }
  });

  it("is false for a read-only-preview document", () => {
    expect(isWritableDocument(documentWithFormat("odb"))).toBe(false);
    expect(isWritableDocument(documentWithFormat("csv"))).toBe(false);
    expect(isWritableDocument(documentWithFormat("svg"))).toBe(false);
    expect(isWritableDocument(documentWithFormat("rtf"))).toBe(false);
    expect(isWritableDocument(documentWithFormat("wpd"))).toBe(false);
    expect(isWritableDocument(documentWithFormat("epub"))).toBe(false);
  });
});

describe("selectionKeyFor", () => {
  it("returns the bare kind for every plain, singleton screen", () => {
    const cases: readonly Screen["kind"][] = [
      "launcher",
      "newDocumentPicker",
      "bodyList",
      "docxExtras",
      "slideList",
      "sheetList",
      "pageList",
      "odbTableList",
      "odbFormList",
      "odbReportList",
      "pdfPageList",
      "exportOptions",
      "saveAsPrompt",
      "viewSource",
      "metadata",
    ];
    for (const kind of cases) {
      expect(selectionKeyFor({ kind } as Screen)).toBe(kind);
    }
  });

  it("includes purpose and cwd for the file picker", () => {
    expect(
      selectionKeyFor({ kind: "filePicker", purpose: "open", cwd: "/tmp" }),
    ).toBe("filePicker:open:/tmp");
    expect(
      selectionKeyFor({
        kind: "filePicker",
        purpose: "saveAs",
        cwd: "/home",
      }),
    ).toBe("filePicker:saveAs:/home");
    expect(
      selectionKeyFor({
        kind: "filePicker",
        purpose: "exportTarget",
        cwd: "/x",
      }),
    ).toBe("filePicker:exportTarget:/x");
  });

  it("includes the block index for a single-index block screen", () => {
    expect(selectionKeyFor({ kind: "paragraphDetail", blockIndex: 3 })).toBe(
      "paragraphDetail:3",
    );
    expect(selectionKeyFor({ kind: "tableView", blockIndex: 2 })).toBe(
      "tableView:2",
    );
    expect(selectionKeyFor({ kind: "listEditor", blockIndex: 5 })).toBe(
      "listEditor:5",
    );
  });

  it("includes both the block and run index for the run editor", () => {
    expect(
      selectionKeyFor({ kind: "runEditor", blockIndex: 1, runIndex: 4 }),
    ).toBe("runEditor:1:4");
  });

  it("includes the block, row, and column for a table cell", () => {
    expect(
      selectionKeyFor({
        kind: "tableCellDetail",
        blockIndex: 1,
        row: 2,
        col: 3,
      }),
    ).toBe("tableCellDetail:1:2:3");
  });

  it("includes the slide index for a single-index slide screen", () => {
    expect(selectionKeyFor({ kind: "slideDetail", slideIndex: 6 })).toBe(
      "slideDetail:6",
    );
    expect(selectionKeyFor({ kind: "notesEditor", slideIndex: 7 })).toBe(
      "notesEditor:7",
    );
  });

  it("includes the slide and shape index for the shape editor", () => {
    expect(
      selectionKeyFor({ kind: "shapeEditor", slideIndex: 1, shapeIndex: 2 }),
    ).toBe("shapeEditor:1:2");
  });

  it("includes the slide and table index for a slide table detail", () => {
    expect(
      selectionKeyFor({
        kind: "slideTableDetail",
        slideIndex: 1,
        tableIndex: 2,
      }),
    ).toBe("slideTableDetail:1:2");
  });

  it("includes the sheet index for a single-index sheet screen", () => {
    expect(selectionKeyFor({ kind: "spreadsheetGrid", sheetIndex: 8 })).toBe(
      "spreadsheetGrid:8",
    );
    expect(
      selectionKeyFor({ kind: "printSettingsEditor", sheetIndex: 9 }),
    ).toBe("printSettingsEditor:9");
  });

  it("includes the sheet, row, and column for a spreadsheet cell", () => {
    expect(
      selectionKeyFor({ kind: "cellDetail", sheetIndex: 1, row: 2, col: 3 }),
    ).toBe("cellDetail:1:2:3");
  });

  it("includes the page index for a single-index page screen", () => {
    expect(selectionKeyFor({ kind: "pageDetail", pageIndex: 4 })).toBe(
      "pageDetail:4",
    );
    expect(selectionKeyFor({ kind: "pdfPageItems", pageIndex: 5 })).toBe(
      "pdfPageItems:5",
    );
  });

  it("includes the page and item index for a page item detail", () => {
    expect(
      selectionKeyFor({
        kind: "shapeOrVectorDetail",
        pageIndex: 1,
        itemIndex: 2,
      }),
    ).toBe("shapeOrVectorDetail:1:2");
    expect(
      selectionKeyFor({ kind: "pdfItemDetail", pageIndex: 3, itemIndex: 4 }),
    ).toBe("pdfItemDetail:3:4");
  });

  it("includes the table name for odb table rows", () => {
    expect(
      selectionKeyFor({ kind: "odbTableRows", tableName: "Invoices" }),
    ).toBe("odbTableRows:Invoices");
  });

  it("includes the form name for odb form detail", () => {
    expect(selectionKeyFor({ kind: "odbFormDetail", formName: "Order" })).toBe(
      "odbFormDetail:Order",
    );
  });

  it("includes the report name for odb report detail and render", () => {
    expect(
      selectionKeyFor({ kind: "odbReportDetail", reportName: "Summary" }),
    ).toBe("odbReportDetail:Summary");
    expect(
      selectionKeyFor({ kind: "odbReportRender", reportName: "Summary" }),
    ).toBe("odbReportRender:Summary");
  });
});

describe("selectedIndexFor", () => {
  it("returns 0 for a key never recorded", () => {
    expect(selectedIndexFor({}, "slideList")).toBe(0);
  });

  it("returns the recorded index for a known key", () => {
    expect(selectedIndexFor({ slideList: 3 }, "slideList")).toBe(3);
  });

  it("returns 0 when the recorded value is genuinely 0, not treating it as absent", () => {
    expect(selectedIndexFor({ slideList: 0 }, "slideList")).toBe(0);
  });

  it("distinguishes between different keys in the same map", () => {
    const selection = { slideList: 2, sheetList: 5 };
    expect(selectedIndexFor(selection, "slideList")).toBe(2);
    expect(selectedIndexFor(selection, "sheetList")).toBe(5);
  });
});

describe("currentScreen", () => {
  it("returns the top of the stack", () => {
    const state: AppState = {
      ...createInitialState(),
      stack: [{ kind: "launcher" }, { kind: "bodyList" }],
    };
    expect(currentScreen(state)).toEqual({ kind: "bodyList" });
  });

  it("throws if the stack is somehow empty", () => {
    const state: AppState = { ...createInitialState(), stack: [] };
    expect(() => currentScreen(state)).toThrow(/screen stack is empty/);
  });
});

describe("rootScreenForFormat", () => {
  it("maps word-processing-shaped formats to bodyList", () => {
    expect(rootScreenForFormat("docx")).toEqual({ kind: "bodyList" });
    expect(rootScreenForFormat("odt")).toEqual({ kind: "bodyList" });
    expect(rootScreenForFormat("markdown")).toEqual({ kind: "bodyList" });
    expect(rootScreenForFormat("doc")).toEqual({ kind: "bodyList" });
  });

  it("maps presentation-shaped formats to slideList", () => {
    expect(rootScreenForFormat("pptx")).toEqual({ kind: "slideList" });
    expect(rootScreenForFormat("odp")).toEqual({ kind: "slideList" });
    expect(rootScreenForFormat("ppt")).toEqual({ kind: "slideList" });
  });

  it("maps spreadsheet-shaped formats to sheetList", () => {
    expect(rootScreenForFormat("ods")).toEqual({ kind: "sheetList" });
    expect(rootScreenForFormat("xls")).toEqual({ kind: "sheetList" });
  });

  it("maps odg to pageList", () => {
    expect(rootScreenForFormat("odg")).toEqual({ kind: "pageList" });
  });

  it("maps odb to odbTableList", () => {
    expect(rootScreenForFormat("odb")).toEqual({ kind: "odbTableList" });
  });

  it("maps every pdf-page-list-shaped format to pdfPageList", () => {
    for (const format of [
      "pdf",
      "xlsx",
      "csv",
      "svg",
      "rtf",
      "wpd",
      "epub",
    ] as const) {
      expect(rootScreenForFormat(format)).toEqual({ kind: "pdfPageList" });
    }
  });
});

describe("anyOverlayOpen", () => {
  const base = createInitialState();

  it("is false when nothing is open", () => {
    expect(anyOverlayOpen(base)).toBe(false);
  });

  it("is true for each individual overlay flag", () => {
    for (const key of [
      "commandPalette",
      "search",
      "help",
      "confirmQuit",
      "confirmClose",
      "diagnosticsPanel",
    ] as const) {
      const state: AppState = {
        ...base,
        overlays: { ...base.overlays, [key]: true },
      };
      expect(anyOverlayOpen(state)).toBe(true);
    }
  });

  it("is true when the error-detail overlay is showing, even with every flag false", () => {
    const state: AppState = {
      ...base,
      errorDetail: { message: "boom", detail: undefined },
    };
    expect(anyOverlayOpen(state)).toBe(true);
  });
});
