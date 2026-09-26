import { createOds, openOds, readOdsContent } from "documents.js";
import { describe, expect, it } from "vitest";
import type { Action } from "./actions.js";
import { appReducer, createInitialState } from "./reducer.js";
import type { AppState, OdsOpenDocument } from "./types.js";
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);

// A genuinely decodable 1x1 red PNG (real IHDR/IDAT/IEND chunks, truecolor, no filter). Unlike PNG_BYTES above, PdfPage.appendImage -> registerImageBytes DOES decode the pixel grid (to size the image asset it registers), so a fake signature-only PNG throws "PNG file does not begin with an IHDR chunk" here.
function applyAll(
  actions: readonly Action[],
  from: AppState = createInitialState(),
): AppState {
  return actions.reduce<AppState>(appReducer, from);
}

function odsDocument(state: AppState): OdsOpenDocument {
  const doc = state.openDocument;
  if (doc?.format !== "ods") {
    throw new Error("expected an open ods document");
  }
  return doc;
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

describe("appReducer ods mutations", () => {
  it("writes a cell value through the real OdsCell setter", () => {
    const created = applyAll([
      { type: "CREATE_DOCUMENT", format: "ods" },
      { type: "ADD_SHEET", name: "Data" },
    ]);
    const sheetIndex = odsDocument(created).editor.sheets().length - 1;

    const written = appReducer(created, {
      type: "SET_CELL_VALUE",
      sheetIndex,
      row: 2,
      column: 3,
      value: { kind: "string", value: "Total" },
    });
    expect(written.hasUnsavedChanges).toBe(true);

    const sheet = odsDocument(written).editor.sheets()[sheetIndex];
    if (sheet === undefined) {
      throw new Error("expected the added sheet");
    }
    expect(sheet.cell(2, 3).value).toEqual({ kind: "string", value: "Total" });
  });

  // withSheet's own wrongDocument path — every other withSheet test (SET_CELL_VALUE, SET_SHEET_PRINT_SETTINGS) only exercises the "no sheet at that index" branch against an already-open spreadsheet, never the "not a spreadsheet at all" branch.
  it("warns rather than crashing when SET_CELL_VALUE targets a non-spreadsheet document", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const result = appReducer(created, {
      type: "SET_CELL_VALUE",
      sheetIndex: 0,
      row: 0,
      column: 0,
      value: { kind: "string", value: "x" },
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe(
      "That action needs an ods or xls document; the open document is docx",
    );
  });
});

describe("appReducer SET_CELL_FORMULA on ods", () => {
  it("writes a real table:formula through the live OdsCell.formula setter, coexisting with the cell's own typed value, verified through readOdsContent", () => {
    const created = applyAll([
      { type: "CREATE_DOCUMENT", format: "ods" },
      { type: "ADD_SHEET", name: "Data" },
    ]);
    const sheetIndex = odsDocument(created).editor.sheets().length - 1;
    const seeded = appReducer(created, {
      type: "SET_CELL_VALUE",
      sheetIndex,
      row: 0,
      column: 0,
      value: { kind: "number", value: 42 },
    });

    const withFormula = appReducer(seeded, {
      type: "SET_CELL_FORMULA",
      sheetIndex,
      row: 0,
      column: 0,
      formula: "of:=1+41",
    });
    expect(withFormula.hasUnsavedChanges).toBe(true);

    const content = readOdsContent(odsDocument(withFormula).editor.toPackage());
    if (content.kind !== "spreadsheet") {
      throw new Error(
        `expected a spreadsheet ContentDocument, got ${content.kind}`,
      );
    }
    // createOds() already seeds a default 'Sheet1' at index 0 — ADD_SHEET appends 'Data' after it, so the sheet under test sits at `sheetIndex`, not index 0.
    const cell = content.sheets[sheetIndex]?.cells.find(
      (candidate) => candidate.row === 0 && candidate.column === 0,
    );
    expect(cell?.formula).toBe("of:=1+41");
    // The formula coexists with the cell's own typed value — setting one never clobbers the other.
    expect(cell?.value).toEqual({ kind: "number", value: 42 });

    // A subsequent undefined formula clears it back out, again without touching the typed value.
    const cleared = appReducer(withFormula, {
      type: "SET_CELL_FORMULA",
      sheetIndex,
      row: 0,
      column: 0,
      formula: undefined,
    });
    const clearedContent = readOdsContent(
      odsDocument(cleared).editor.toPackage(),
    );
    if (clearedContent.kind !== "spreadsheet") {
      throw new Error(
        `expected a spreadsheet ContentDocument, got ${clearedContent.kind}`,
      );
    }
    const clearedCell = clearedContent.sheets[sheetIndex]?.cells.find(
      (candidate) => candidate.row === 0 && candidate.column === 0,
    );
    expect(clearedCell?.formula).toBeUndefined();
    expect(clearedCell?.value).toEqual({ kind: "number", value: 42 });
  });

  it("warns rather than crashing for a sheet index that does not exist", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "ods",
    });
    const result = appReducer(created, {
      type: "SET_CELL_FORMULA",
      sheetIndex: 4,
      row: 0,
      column: 0,
      formula: "of:=1",
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe("There is no sheet at index 4");
    expect(result.hasUnsavedChanges).toBe(false);
  });

  it("warns rather than crashing when the open document is not ods", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const result = appReducer(created, {
      type: "SET_CELL_FORMULA",
      sheetIndex: 0,
      row: 0,
      column: 0,
      formula: "of:=1",
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toContain("ods");
  });
});

describe("appReducer ADD_SHEET_IMAGE on ods", () => {
  it("adds a real floating image, positioned by resolving the anchor cell against the sheet's own explicit column widths/row heights, verified through readOdsContent", () => {
    // Explicit widths/heights for every column/row strictly before the anchor, set through the live editor BEFORE the image is added — matching OdsSheet.addImage's own doc comment ("Call this AFTER any setColumnWidth/setColumnHidden/setRowHeight/setRowHidden calls this sheet needs") — so the expected absolute position asserted below is derived from values this test itself set, never from OdsSheet.addImage's own internal default-size fallback.
    const editor = createOds();
    const sheet = editor.addSheet("Data");
    const columnWidthsPt = [30, 40, 50];
    const rowHeightsPt = [20, 25];
    columnWidthsPt.forEach((widthPt, index) => {
      sheet.setColumnWidth(index, widthPt);
    });
    rowHeightsPt.forEach((heightPt, index) => {
      sheet.setRowHeight(index, heightPt);
    });
    const opened = openOdsDocument(editor.toBytes());
    const sheetIndex = odsDocument(opened).editor.sheets().length - 1;

    const withImage = appReducer(opened, {
      type: "ADD_SHEET_IMAGE",
      sheetIndex,
      anchorRow: rowHeightsPt.length,
      anchorColumn: columnWidthsPt.length,
      offsetXPt: 5,
      offsetYPt: 10,
      format: "png",
      bytes: PNG_BYTES,
      widthPt: 80,
      heightPt: 40,
      altText: "a logo",
    });
    expect(withImage.hasUnsavedChanges).toBe(true);

    const content = readOdsContent(odsDocument(withImage).editor.toPackage());
    if (content.kind !== "spreadsheet") {
      throw new Error(
        `expected a spreadsheet ContentDocument, got ${content.kind}`,
      );
    }
    // createOds() already seeds a default 'Sheet1' at index 0 — addSheet('Data') appends a second sheet after it, so the sheet under test sits at `sheetIndex`, not index 0.
    const image = content.sheets[sheetIndex]?.images[0];
    if (image === undefined) {
      throw new Error("expected a real image on the added sheet");
    }
    // A spreadsheet's own table:shapes container (the direct parent of every floating image, always table:table's own first child) carries no per-cell anchor at all — its svg:x/svg:y is always sheet-absolute — so odf.js's own reader always reports anchorRow/anchorColumn 0 with that absolute position carried through as the offset (see odf.js's own typed/ods/read.ts top-of-file note: "cell (0,0)'s own top-left IS the sheet origin, so the two coordinate systems coincide exactly there"). This is a genuine, documented ODF format limitation, not a round-trip bug — the WRITE side still resolved the given anchor correctly against the sheet's real column/row sizing, which is exactly what the derived offset values below prove.
    expect(image.anchorRow).toBe(0);
    expect(image.anchorColumn).toBe(0);
    expect(image.offsetXPt).toBe(
      columnWidthsPt.reduce((sum, width) => sum + width, 0) + 5,
    );
    expect(image.offsetYPt).toBe(
      rowHeightsPt.reduce((sum, height) => sum + height, 0) + 10,
    );
    expect(image.format).toBe("png");
    expect(image.widthPt).toBe(80);
    expect(image.heightPt).toBe(40);
    // altText does NOT round-trip here — confirmed directly against the installed documents.js: OdsSheet.addImage's own write path (src/edit/ods/floating.ts's insertSheetImage) never writes a floating image's svg:title/svg:desc at all, even though odf.js's own reader (readDrawFrame, which every OTHER image-insertion path in this codebase already reads altText through) fully supports reading them back. A real, confirmed write-side gap in the installed documents.js dependency, not a bug in this action/reducer — ADD_SHEET_IMAGE still forwards the caller's altText through to OdsSheet.addImage unconditionally (the field is a genuine, schema-valid ContentSheetImage member), so a future documents.js release that starts writing it needs no change on this side at all.
    expect(image.altText).toBeUndefined();
  });

  it("warns rather than crashing for a sheet index that does not exist", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "ods",
    });
    const result = appReducer(created, {
      type: "ADD_SHEET_IMAGE",
      sheetIndex: 4,
      anchorRow: 0,
      anchorColumn: 0,
      offsetXPt: 0,
      offsetYPt: 0,
      format: "png",
      bytes: PNG_BYTES,
      widthPt: 10,
      heightPt: 10,
      altText: undefined,
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.hasUnsavedChanges).toBe(false);
  });

  it("warns rather than crashing when the open document is not ods", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const result = appReducer(created, {
      type: "ADD_SHEET_IMAGE",
      sheetIndex: 0,
      anchorRow: 0,
      anchorColumn: 0,
      offsetXPt: 0,
      offsetYPt: 0,
      format: "png",
      bytes: PNG_BYTES,
      widthPt: 10,
      heightPt: 10,
      altText: undefined,
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toContain("ods");
  });
});

describe("appReducer MERGE_CELLS on ods", () => {
  it("merges a real rectangle of cells through the live OdsSheet.mergeCells, and a covered cell is rejected by cell() afterwards", () => {
    const created = applyAll([
      { type: "CREATE_DOCUMENT", format: "ods" },
      { type: "ADD_SHEET", name: "Data" },
    ]);
    const sheetIndex = odsDocument(created).editor.sheets().length - 1;
    const seeded = appReducer(created, {
      type: "SET_CELL_VALUE",
      sheetIndex,
      row: 0,
      column: 0,
      value: { kind: "string", value: "Merged" },
    });

    const merged = appReducer(seeded, {
      type: "MERGE_CELLS",
      sheetIndex,
      startRow: 0,
      startColumn: 0,
      rowSpan: 2,
      colSpan: 2,
    });
    expect(merged.hasUnsavedChanges).toBe(true);

    const sheet = odsDocument(merged).editor.sheets()[sheetIndex];
    if (sheet === undefined) {
      throw new Error("expected the added sheet");
    }
    expect(sheet.cell(0, 0).value).toEqual({ kind: "string", value: "Merged" });
    expect(() => sheet.cell(0, 1)).toThrow(/covered/);
    expect(() => sheet.cell(1, 0)).toThrow(/covered/);
    expect(() => sheet.cell(1, 1)).toThrow(/covered/);

    // Round-trips through re-decoding the package as a completely fresh workbook, not just the live in-memory object.
    const reopened = openOds(odsDocument(merged).editor.toBytes());
    const reopenedSheet = reopened.sheets()[sheetIndex];
    if (reopenedSheet === undefined) {
      throw new Error("expected the added sheet to survive a fresh decode");
    }
    expect(reopenedSheet.cell(0, 0).value).toEqual({
      kind: "string",
      value: "Merged",
    });
    expect(() => reopenedSheet.cell(0, 1)).toThrow(/covered/);
  });

  it("surfaces a thrown merge error as a warning status instead of crashing", () => {
    const created = applyAll([
      { type: "CREATE_DOCUMENT", format: "ods" },
      { type: "ADD_SHEET", name: "Data" },
    ]);
    const sheetIndex = odsDocument(created).editor.sheets().length - 1;

    const result = appReducer(created, {
      type: "MERGE_CELLS",
      sheetIndex,
      startRow: 0,
      startColumn: 0,
      rowSpan: 0,
      colSpan: 2,
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toContain("rowSpan");
    // hasUnsavedChanges is unchanged from before this dispatch (ADD_SHEET already set it true) — the guarded merge neither adds a further change nor resets it.
    expect(result.hasUnsavedChanges).toBe(created.hasUnsavedChanges);
  });

  it("warns rather than crashing for a sheet index that does not exist", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "ods",
    });
    const result = appReducer(created, {
      type: "MERGE_CELLS",
      sheetIndex: 4,
      startRow: 0,
      startColumn: 0,
      rowSpan: 1,
      colSpan: 1,
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe("There is no sheet at index 4");
    expect(result.hasUnsavedChanges).toBe(false);
  });

  it("warns rather than crashing when the open document is not ods", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const result = appReducer(created, {
      type: "MERGE_CELLS",
      sheetIndex: 0,
      startRow: 0,
      startColumn: 0,
      rowSpan: 1,
      colSpan: 1,
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toContain("ods");
  });
});
