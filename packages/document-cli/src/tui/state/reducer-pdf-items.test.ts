import {
  createOdg,
  createOdp,
  createPptx,
  type PptxTableCell,
  type PptxTableRow,
  openDocx,
  openOdg,
  openOdp,
  openOdt,
  openPptx,
  readDocxContent,
  readOdpContent,
  readOdtContent,
  readPptxContent,
} from "documents.js";
import {
  type ContentDocument,
  type ContentTable,
  walkTableGrid,
} from "document-schema.js";
import { describe, expect, it } from "vitest";
import type { Action } from "./actions.js";
import { appReducer, createInitialState } from "./reducer.js";
import type {
  AppState,
  DocxOpenDocument,
  OdpOpenDocument,
  OdtOpenDocument,
  PptxOpenDocument,
} from "./types.js";
function applyAll(
  actions: readonly Action[],
  from: AppState = createInitialState(),
): AppState {
  return actions.reduce<AppState>(appReducer, from);
}

function docxDocument(state: AppState): DocxOpenDocument {
  const doc = state.openDocument;
  if (doc?.format !== "docx") {
    throw new Error("expected an open docx document");
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

function odpDocument(state: AppState): OdpOpenDocument {
  const doc = state.openDocument;
  if (doc?.format !== "odp") {
    throw new Error("expected an open odp document");
  }
  return doc;
}

function odtDocument(state: AppState): OdtOpenDocument {
  const doc = state.openDocument;
  if (doc?.format !== "odt") {
    throw new Error("expected an open odt document");
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

function openOdpDocument(
  bytes: Uint8Array<ArrayBuffer>,
  path = "/tmp/deck.odp",
): AppState {
  return appReducer(createInitialState(), {
    type: "OPEN_FILE_SUCCESS",
    path,
    doc: { format: "odp", editor: openOdp(bytes), path },
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

function expectTopLeftTwoByTwoMerge(table: ContentTable): void {
  expect(table.rows.map((row) => row.cells.length)).toEqual([3, 3, 3]);
  const covered = walkTableGrid(table).map((row) =>
    row.map((position) => position.anchorRowIndex !== undefined),
  );
  expect(covered).toEqual([
    [false, true, false],
    [true, true, false],
    [false, false, false],
  ]);
  const anchor = table.rows[0]?.cells[0];
  expect(anchor?.colSpan).toBe(2);
  expect(anchor?.rowSpan).toBe(2);
  for (const position of walkTableGrid(table).flat()) {
    if (position.anchorRowIndex !== undefined) {
      expect(position.cell.blocks).toEqual([]);
    }
  }
}

// The number of a:p paragraphs in a cell's a:txBody, which the schema requires to be at least one even for an empty cell.
function paragraphElementCount(cell: PptxTableCell): number {
  const txBody = cell.element.children.find(
    (child) => child.type === "element" && child.tag === "a:txBody",
  );
  if (txBody?.type !== "element") {
    throw new Error("expected the cell to have an a:txBody");
  }
  return txBody.children.filter(
    (child) => child.type === "element" && child.tag === "a:p",
  ).length;
}

function fillPptxTableWithText(
  rows: readonly PptxTableRow[] | undefined,
): void {
  if (rows === undefined) {
    throw new Error("expected a table on the first slide");
  }
  for (const [rowIndex, row] of rows.entries()) {
    for (const [columnIndex, cell] of row.cells().entries()) {
      cell.setParagraphs([
        { runs: [{ text: `cell ${rowIndex}${columnIndex}` }] },
      ]);
    }
  }
}

function firstTable(content: ContentDocument): ContentTable {
  const blocks =
    content.kind === "wordprocessing"
      ? content.sections[0]?.blocks
      : content.kind === "presentation"
        ? content.slides[0]?.shapes[0]?.blocks
        : undefined;
  const block = blocks?.[0];
  if (block?.kind !== "table") {
    throw new Error(`expected a table block, got ${block?.kind}`);
  }
  return block;
}

describe("appReducer merges read back as dense ContentTables", () => {
  const CELL_TEXT_ACTIONS: readonly Action[] = [0, 1, 2].flatMap((row) =>
    [0, 1, 2].map((column): Action => ({
      type: "SET_TABLE_CELL_TEXT",
      tableIndex: 0,
      row,
      column,
      text: `cell ${row}${column}`,
    })),
  );
  const MERGE_TOP_LEFT: Action = {
    type: "MERGE_TABLE_CELLS",
    tableIndex: 0,
    startRow: 0,
    startColumn: 0,
    rowSpan: 2,
    colSpan: 2,
  };

  it("keeps a docx 2x2 merge as one anchor plus covered entries, before and after a save and reopen", () => {
    const merged = applyAll([
      { type: "CREATE_DOCUMENT", format: "docx" },
      { type: "APPEND_TABLE", rows: 3, columns: 3 },
      ...CELL_TEXT_ACTIONS,
      MERGE_TOP_LEFT,
    ]);
    const live = readDocxContent(docxDocument(merged).editor.toPackage());
    expectTopLeftTwoByTwoMerge(firstTable(live));
    const reopened = readDocxContent(
      openDocx(docxDocument(merged).editor.toBytes()).toPackage(),
    );
    expectTopLeftTwoByTwoMerge(firstTable(reopened));
  });

  it("keeps an odt 2x2 merge as one anchor plus covered entries, before and after a save and reopen", () => {
    const merged = applyAll([
      { type: "CREATE_DOCUMENT", format: "odt" },
      { type: "APPEND_TABLE", rows: 3, columns: 3 },
      ...CELL_TEXT_ACTIONS,
      MERGE_TOP_LEFT,
    ]);
    const live = readOdtContent(odtDocument(merged).editor.toPackage());
    expectTopLeftTwoByTwoMerge(firstTable(live));
    const reopened = readOdtContent(
      openOdt(odtDocument(merged).editor.toBytes()).toPackage(),
    );
    expectTopLeftTwoByTwoMerge(firstTable(reopened));
  });

  it("keeps a pptx 2x2 merge as one anchor plus covered entries, before and after a save and reopen", () => {
    const editor = createPptx();
    editor.addSlide();
    const withTable = appReducer(openPptxDocument(editor.toBytes()), {
      type: "ADD_SLIDE_TABLE",
      slideIndex: 0,
      frame: { xPt: 10, yPt: 10, widthPt: 200, heightPt: 100 },
      rows: 3,
      columns: 3,
    });
    const rows = pptxDocument(withTable)
      .editor.slides()[0]
      ?.tables()[0]
      ?.rows();
    fillPptxTableWithText(rows);
    const merged = appReducer(withTable, {
      type: "MERGE_SLIDE_TABLE_CELLS",
      slideIndex: 0,
      tableIndex: 0,
      startRow: 0,
      startColumn: 0,
      rowSpan: 2,
      colSpan: 2,
    });
    const live = readPptxContent(pptxDocument(merged).editor.toPackage());
    expectTopLeftTwoByTwoMerge(firstTable(live));
    const reopened = readPptxContent(
      openPptx(pptxDocument(merged).editor.toBytes()).toPackage(),
    );
    expectTopLeftTwoByTwoMerge(firstTable(reopened));
    expect(firstTable(reopened).rows[0]?.cells[0]?.blocks).toHaveLength(1);
  });

  it("clears the text of every pptx cell a merge covers, so no hidden content survives in the file", () => {
    const editor = createPptx();
    editor.addSlide();
    const withTable = appReducer(openPptxDocument(editor.toBytes()), {
      type: "ADD_SLIDE_TABLE",
      slideIndex: 0,
      frame: { xPt: 10, yPt: 10, widthPt: 200, heightPt: 100 },
      rows: 3,
      columns: 3,
    });
    const rows = pptxDocument(withTable)
      .editor.slides()[0]
      ?.tables()[0]
      ?.rows();
    fillPptxTableWithText(rows);
    const merged = appReducer(withTable, {
      type: "MERGE_SLIDE_TABLE_CELLS",
      slideIndex: 0,
      tableIndex: 0,
      startRow: 0,
      startColumn: 0,
      rowSpan: 2,
      colSpan: 2,
    });
    const mergedRows = pptxDocument(merged)
      .editor.slides()[0]
      ?.tables()[0]
      ?.rows();
    const cellAt = (row: number, column: number): PptxTableCell => {
      const cell = mergedRows?.[row]?.cells()[column];
      if (cell === undefined) {
        throw new Error(`expected a cell at ${row},${column}`);
      }
      return cell;
    };
    const serialised = (row: number, column: number): string =>
      JSON.stringify(cellAt(row, column).element);
    expect(serialised(0, 0)).toContain("cell 00");
    expect(serialised(0, 1)).not.toContain("cell 01");
    expect(serialised(1, 0)).not.toContain("cell 10");
    expect(serialised(1, 1)).not.toContain("cell 11");
    // The cleared cells keep the one (empty) paragraph a text body must have.
    expect(paragraphElementCount(cellAt(0, 1))).toBe(1);
    expect(paragraphElementCount(cellAt(1, 1))).toBe(1);
    // A cell outside the rectangle keeps its own text.
    expect(serialised(0, 2)).toContain("cell 02");
  });
});

describe("appReducer MERGE_SLIDE_TABLE_CELLS", () => {
  it("merges a real rectangle of cells in a pptx slide table through the live PptxTable, verified through readPptxContent", () => {
    const editor = createPptx();
    editor.addSlide();
    const opened = openPptxDocument(editor.toBytes());

    const withTable = appReducer(opened, {
      type: "ADD_SLIDE_TABLE",
      slideIndex: 0,
      frame: { xPt: 10, yPt: 10, widthPt: 200, heightPt: 100 },
      rows: 3,
      columns: 3,
    });
    const merged = appReducer(withTable, {
      type: "MERGE_SLIDE_TABLE_CELLS",
      slideIndex: 0,
      tableIndex: 0,
      startRow: 0,
      startColumn: 0,
      rowSpan: 2,
      colSpan: 2,
    });
    expect(merged.hasUnsavedChanges).toBe(true);

    const content = readPptxContent(pptxDocument(merged).editor.toPackage());
    if (content.kind !== "presentation") {
      throw new Error(
        `expected a presentation ContentDocument, got ${content.kind}`,
      );
    }
    const tableBlock = content.slides[0]?.shapes[0]?.blocks[0];
    if (tableBlock?.kind !== "table") {
      throw new Error(`expected a table block, got ${tableBlock?.kind}`);
    }
    // The anchor carries the real merge attributes; every other cell in the rectangle reads back with no blocks at all (hMerge/vMerge covered), matching readTableCell's own short-circuit — see ooxml.js's own typed/pptx/read.js.
    expect(tableBlock.rows[0]?.cells[0]?.colSpan).toBe(2);
    expect(tableBlock.rows[0]?.cells[0]?.rowSpan).toBe(2);
    expect(tableBlock.rows[0]?.cells[1]?.blocks).toEqual([]);
    expect(tableBlock.rows[1]?.cells[0]?.blocks).toEqual([]);
    expect(tableBlock.rows[1]?.cells[1]?.blocks).toEqual([]);
    // The untouched third row/column stay real, ordinary cells.
    expect(tableBlock.rows[2]?.cells[2]?.colSpan).toBeUndefined();
  });

  it("merges a real rectangle of cells in an odp slide table through the live OdtTable, verified through readOdpContent", () => {
    const editor = createOdp();
    editor.addSlide();
    const opened = openOdpDocument(editor.toBytes());

    const withTable = appReducer(opened, {
      type: "ADD_SLIDE_TABLE",
      slideIndex: 0,
      frame: { xPt: 10, yPt: 10, widthPt: 200, heightPt: 100 },
      rows: 3,
      columns: 3,
    });
    const merged = appReducer(withTable, {
      type: "MERGE_SLIDE_TABLE_CELLS",
      slideIndex: 0,
      tableIndex: 0,
      startRow: 1,
      startColumn: 1,
      rowSpan: 2,
      colSpan: 2,
    });
    expect(merged.hasUnsavedChanges).toBe(true);

    const content = readOdpContent(odpDocument(merged).editor.toPackage());
    if (content.kind !== "presentation") {
      throw new Error(
        `expected a presentation ContentDocument, got ${content.kind}`,
      );
    }
    const tableBlock = content.slides[0]?.shapes[0]?.blocks[0];
    if (tableBlock?.kind !== "table") {
      throw new Error(`expected a table block, got ${tableBlock?.kind}`);
    }
    expect(tableBlock.rows[1]?.cells[1]?.colSpan).toBe(2);
    expect(tableBlock.rows[1]?.cells[1]?.rowSpan).toBe(2);
  });

  it("surfaces a thrown merge error as a warning status instead of crashing", () => {
    const editor = createPptx();
    editor.addSlide();
    const opened = openPptxDocument(editor.toBytes());
    const withTable = appReducer(opened, {
      type: "ADD_SLIDE_TABLE",
      slideIndex: 0,
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
      rows: 2,
      columns: 2,
    });

    const result = appReducer(withTable, {
      type: "MERGE_SLIDE_TABLE_CELLS",
      slideIndex: 0,
      tableIndex: 0,
      startRow: 0,
      startColumn: 0,
      rowSpan: 5,
      colSpan: 2,
    });
    expect(result.status?.severity).toBe("warning");
  });

  it("warns rather than crashing for a table index that does not exist", () => {
    const editor = createPptx();
    editor.addSlide();
    const opened = openPptxDocument(editor.toBytes());

    const result = appReducer(opened, {
      type: "MERGE_SLIDE_TABLE_CELLS",
      slideIndex: 0,
      tableIndex: 0,
      startRow: 0,
      startColumn: 0,
      rowSpan: 1,
      colSpan: 1,
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe("There is no table at index 0 on slide 0");
    expect(result.hasUnsavedChanges).toBe(false);
  });

  it("warns rather than crashing when the open document is not pptx or odp", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const result = appReducer(created, {
      type: "MERGE_SLIDE_TABLE_CELLS",
      slideIndex: 0,
      tableIndex: 0,
      startRow: 0,
      startColumn: 0,
      rowSpan: 1,
      colSpan: 1,
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toContain("pptx or odp");
  });

  // wrongDocument's own "actual" half names the real open format when there is one (covered just above), but falls back to the literal words "no document" when state.openDocument is undefined — distinct from any real format string, so it must come from its own ternary branch rather than always compute an actual format.
  it("says 'no document' rather than a format name when nothing is open at all", () => {
    const result = appReducer(createInitialState(), {
      type: "MERGE_SLIDE_TABLE_CELLS",
      slideIndex: 0,
      tableIndex: 0,
      startRow: 0,
      startColumn: 0,
      rowSpan: 1,
      colSpan: 1,
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe(
      "That action needs a pptx or odp document; the open document is no document",
    );
  });

  it("rejects a non-integer or non-positive rowSpan/colSpan instead of merging anything", () => {
    const editor = createPptx();
    editor.addSlide();
    const opened = openPptxDocument(editor.toBytes());
    const withTable = appReducer(opened, {
      type: "ADD_SLIDE_TABLE",
      slideIndex: 0,
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
      rows: 3,
      columns: 3,
    });

    const cases: readonly [number, number][] = [
      [0, 1], // rowSpan below 1
      [1, 0], // colSpan below 1
      [1.5, 1], // rowSpan not an integer
      [1, 1.5], // colSpan not an integer
    ];
    for (const [rowSpan, colSpan] of cases) {
      const result = appReducer(withTable, {
        type: "MERGE_SLIDE_TABLE_CELLS",
        slideIndex: 0,
        tableIndex: 0,
        startRow: 0,
        startColumn: 0,
        rowSpan,
        colSpan,
      });
      expect(result.status?.severity).toBe("warning");
      expect(result.status?.text).toContain("positive integers");
      // Rejected outright, before any cell was ever touched — the same open document object survives untouched, not a partially-applied merge.
      expect(result.openDocument).toBe(withTable.openDocument);
    }
  });

  it("rejects a colSpan that overruns the table's own column count", () => {
    const editor = createPptx();
    editor.addSlide();
    const opened = openPptxDocument(editor.toBytes());
    const withTable = appReducer(opened, {
      type: "ADD_SLIDE_TABLE",
      slideIndex: 0,
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
      rows: 2,
      columns: 2,
    });

    const result = appReducer(withTable, {
      type: "MERGE_SLIDE_TABLE_CELLS",
      slideIndex: 0,
      tableIndex: 0,
      startRow: 0,
      startColumn: 0,
      rowSpan: 1,
      colSpan: 3,
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toContain("exceeds this table's own 2 columns");
    expect(result.openDocument).toBe(withTable.openDocument);
  });

  // mergePptxTableCells's own row/column bounds checks compare with a strict `>`, not `>=` — a merge landing exactly on the table's own last row/column is valid, not an overrun. rowSpan=1/colSpan=1 here also proves the "must be positive integers" guard rejects only BELOW 1, not AT 1.
  it("accepts a 1x1 merge landing exactly on the table's own last row and column", () => {
    const editor = createPptx();
    editor.addSlide();
    const opened = openPptxDocument(editor.toBytes());
    const withTable = appReducer(opened, {
      type: "ADD_SLIDE_TABLE",
      slideIndex: 0,
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
      rows: 2,
      columns: 2,
    });

    const result = appReducer(withTable, {
      type: "MERGE_SLIDE_TABLE_CELLS",
      slideIndex: 0,
      tableIndex: 0,
      startRow: 1,
      startColumn: 1,
      rowSpan: 1,
      colSpan: 1,
    });
    expect(result.status?.severity).not.toBe("warning");
    expect(result.hasUnsavedChanges).toBe(true);
  });

  // startRow=2/rowSpan=2 on a 3-row table overruns by exactly one row — distinguishes the real check from a mutant that flips `+` to `-` (2-2=0, which would never exceed 3 and would fall through to a table access that is merely undefined rather than out of range) or drops the whole guard block outright, both of which would surface a DIFFERENT warning than this one.
  it("names the exact rowSpan/startRow/row-count in the row-overrun message", () => {
    const editor = createPptx();
    editor.addSlide();
    const opened = openPptxDocument(editor.toBytes());
    const withTable = appReducer(opened, {
      type: "ADD_SLIDE_TABLE",
      slideIndex: 0,
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
      rows: 3,
      columns: 2,
    });

    const result = appReducer(withTable, {
      type: "MERGE_SLIDE_TABLE_CELLS",
      slideIndex: 0,
      tableIndex: 0,
      startRow: 2,
      startColumn: 0,
      rowSpan: 2,
      colSpan: 1,
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe(
      "mergeSlideTableCells: rowSpan 2 starting at row 2 exceeds this table's own 3 rows",
    );
    expect(result.openDocument).toBe(withTable.openDocument);
  });

  // A rectangle taller than 1 row but only 1 column wide: the covered cell directly below the anchor must carry verticalMerge alone, never horizontalMerge (columnOffset is always 0 in a 1-wide merge, so the "columnOffset > 0" branch must never fire), and the row just past rowSpan must be left completely untouched by the row loop.
  it("sets only verticalMerge on the covered cell of a 1-column-wide, multi-row merge, and never touches the row past rowSpan", () => {
    const editor = createPptx();
    editor.addSlide();
    const opened = openPptxDocument(editor.toBytes());
    const withTable = appReducer(opened, {
      type: "ADD_SLIDE_TABLE",
      slideIndex: 0,
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
      rows: 3,
      columns: 2,
    });

    const merged = appReducer(withTable, {
      type: "MERGE_SLIDE_TABLE_CELLS",
      slideIndex: 0,
      tableIndex: 0,
      startRow: 0,
      startColumn: 0,
      rowSpan: 2,
      colSpan: 1,
    });
    const rows = pptxDocument(merged).editor.slides()[0]?.tables()[0]?.rows();
    const coveredBelow = rows?.[1]?.cells()[0];
    const pastRowSpan = rows?.[2]?.cells()[0];
    expect(coveredBelow?.element.attributes).toContainEqual({
      name: "vMerge",
      value: "1",
    });
    expect(
      coveredBelow?.element.attributes.some((a) => a.name === "hMerge"),
    ).toBe(false);
    expect(pastRowSpan?.element.attributes).toEqual([]);
  });

  // The column-wide counterpart: a rectangle wider than 1 column but only 1 row tall must set horizontalMerge alone on its covered cell (rowOffset is always 0, so "rowOffset > 0" must never fire), and the column just past colSpan must be left completely untouched by the column loop.
  it("sets only horizontalMerge on the covered cell of a 1-row-tall, multi-column merge, and never touches the column past colSpan", () => {
    const editor = createPptx();
    editor.addSlide();
    const opened = openPptxDocument(editor.toBytes());
    const withTable = appReducer(opened, {
      type: "ADD_SLIDE_TABLE",
      slideIndex: 0,
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
      rows: 2,
      columns: 3,
    });

    const merged = appReducer(withTable, {
      type: "MERGE_SLIDE_TABLE_CELLS",
      slideIndex: 0,
      tableIndex: 0,
      startRow: 0,
      startColumn: 0,
      rowSpan: 1,
      colSpan: 2,
    });
    const firstRowCells = pptxDocument(merged)
      .editor.slides()[0]
      ?.tables()[0]
      ?.rows()[0]
      ?.cells();
    const coveredRight = firstRowCells?.[1];
    const pastColSpan = firstRowCells?.[2];
    expect(coveredRight?.element.attributes).toContainEqual({
      name: "hMerge",
      value: "1",
    });
    expect(
      coveredRight?.element.attributes.some((a) => a.name === "vMerge"),
    ).toBe(false);
    expect(pastColSpan?.element.attributes).toEqual([]);
  });
});

describe("appReducer SET_SLIDE_NOTES on pptx", () => {
  it("sets real speaker notes on a pptx slide, not just an odp one", () => {
    const editor = createPptx();
    editor.addSlide();
    const opened = openPptxDocument(editor.toBytes());

    const withNotes = appReducer(opened, {
      type: "SET_SLIDE_NOTES",
      slideIndex: 0,
      notes: "Remember to mention Q3 growth",
    });
    expect(withNotes.hasUnsavedChanges).toBe(true);
    expect(pptxDocument(withNotes).editor.slides()[0]?.notes).toBe(
      "Remember to mention Q3 growth",
    );
  });
});

describe("appReducer SET_SHAPE_ROTATION on pptx", () => {
  it("rotates a real pptx shape, not just an odp one, and the rotation round-trips through re-decoding the package", () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    slide.addTextBox({
      frame: { xPt: 10, yPt: 10, widthPt: 100, heightPt: 50 },
      text: "Title",
    });
    const opened = openPptxDocument(editor.toBytes());

    const rotated = appReducer(opened, {
      type: "SET_SHAPE_ROTATION",
      containerIndex: 0,
      shapeIndex: 0,
      rotationDeg: 30,
    });
    expect(rotated.hasUnsavedChanges).toBe(true);
    // The live view means the shape object captured before the action already reflects the mutation.
    expect(
      pptxDocument(rotated).editor.slides()[0]?.shapes()[0]?.rotationDeg,
    ).toBeCloseTo(30, 5);

    // Re-decoding the saved bytes as a completely fresh package proves the rotation was written into the real docx/pptx tree, not just held on the live in-memory object.
    const reopened = openPptx(pptxDocument(rotated).editor.toBytes());
    expect(reopened.slides()[0]?.shapes()[0]?.rotationDeg).toBeCloseTo(30, 5);
  });

  it("warns rather than crashing for a shape index that does not exist, naming the slide it looked on", () => {
    const editor = createPptx();
    editor.addSlide();
    const opened = openPptxDocument(editor.toBytes());

    const result = appReducer(opened, {
      type: "SET_SHAPE_ROTATION",
      containerIndex: 0,
      shapeIndex: 5,
      rotationDeg: 30,
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.hasUnsavedChanges).toBe(false);
    expect(result.status?.text).toBe("There is no shape 5 on slide 0");
  });

  // withShape's own missing-shape message says "page" for odg specifically, "slide" for every other shape-host format — the pptx test above only ever exercises the "slide" branch of that ternary.
  it("warns with 'page' rather than 'slide' when the missing shape is on an odg page", () => {
    const editor = createOdg();
    editor.addPage();
    const opened = openOdgDocument(editor.toBytes());

    const result = appReducer(opened, {
      type: "SET_SHAPE_TEXT",
      containerIndex: 0,
      shapeIndex: 3,
      text: "unreachable",
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe("There is no shape 3 on page 0");
  });

  // SET_SHAPE_TEXT above resolves through withWideShape, a DIFFERENT function from withShape (used only by SET_SHAPE_ROTATION) — each has its own copy of the identical "page"/"slide" ternary, so covering one says nothing about the other.
  it("warns with 'page' rather than 'slide' when SET_SHAPE_ROTATION targets a missing shape on an odg page", () => {
    const editor = createOdg();
    editor.addPage();
    const opened = openOdgDocument(editor.toBytes());

    const result = appReducer(opened, {
      type: "SET_SHAPE_ROTATION",
      containerIndex: 0,
      shapeIndex: 3,
      rotationDeg: 10,
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe("There is no shape 3 on page 0");
  });

  // withShape's own wrongDocument path (used only by SET_SHAPE_ROTATION) — distinct from withWideShape's own copy below, which SET_SHAPE_TEXT/SET_SHAPE_FRAME resolve through instead.
  it("warns rather than crashing when SET_SHAPE_ROTATION targets a document with no shape host at all", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const result = appReducer(created, {
      type: "SET_SHAPE_ROTATION",
      containerIndex: 0,
      shapeIndex: 0,
      rotationDeg: 10,
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toContain("a pptx, odp or odg document");
  });

  // withWideShape's own wrongDocument path — SET_SHAPE_TEXT/SET_SHAPE_FRAME resolve through it, not withShape, so this is a genuinely separate code path from the SET_SHAPE_ROTATION test above.
  it("warns rather than crashing when SET_SHAPE_TEXT targets a document with no shape host at all", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const result = appReducer(created, {
      type: "SET_SHAPE_TEXT",
      containerIndex: 0,
      shapeIndex: 0,
      text: "x",
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toContain("a pptx, odp, ppt or odg document");
  });
});
