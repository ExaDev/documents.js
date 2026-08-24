import type { ContentSheetPrintSettings } from "document-schema.js";
import type { XmlElement } from "odf.js";
import { describe, expect, it } from "vitest";
import { PAGE_SIZE_A4 } from "document-schema.js";
import { readOdsContent } from "../../odf/ods/read";
import { createOds, openOds } from "./editor";

function directChild(parent: XmlElement, tag: string): XmlElement | undefined {
  return parent.children.find(
    (c): c is XmlElement => c.type === "element" && c.tag === tag,
  );
}

describe("OdsSheet.cell / cellAt", () => {
  it('cell(row, column) and cellAt("B1") address the same position', () => {
    const sheet = createOds().sheets()[0]!;
    sheet.cell(0, 1).value = { kind: "string", value: "B1 via row/column" };
    expect(sheet.cellAt("B1").value).toEqual({
      kind: "string",
      value: "B1 via row/column",
    });
  });

  it("cellAt reuses odf.js's own A1 parsing -- multi-letter columns resolve correctly", () => {
    const sheet = createOds().sheets()[0]!;
    sheet.cell(0, 27).value = { kind: "number", value: 1 }; // column 27 (0-based) is "AB"
    expect(sheet.cellAt("AB1").value).toEqual({ kind: "number", value: 1 });
  });

  it("cellAt throws a clear error for a malformed reference", () => {
    const sheet = createOds().sheets()[0]!;
    expect(() => sheet.cellAt("not-a-reference")).toThrow(
      /not a valid A1-style/,
    );
  });

  it("resolving the same cell twice returns a live view over the SAME underlying node -- a mutation through one is visible through the other", () => {
    const sheet = createOds().sheets()[0]!;
    const first = sheet.cell(2, 2);
    first.value = { kind: "number", value: 99 };
    const second = sheet.cell(2, 2);
    expect(second.value).toEqual({ kind: "number", value: 99 });
  });
});

function findTableElement(editor: ReturnType<typeof createOds>): XmlElement {
  const contentPart = editor.toPackage().parts["content.xml"];
  const root =
    contentPart?.kind === "xml"
      ? contentPart.nodes.find((n): n is XmlElement => n.type === "element")
      : undefined;
  const body =
    root === undefined ? undefined : directChild(root, "office:body");
  const spreadsheet =
    body === undefined ? undefined : directChild(body, "office:spreadsheet");
  const table =
    spreadsheet === undefined
      ? undefined
      : directChild(spreadsheet, "table:table");
  if (table === undefined) {
    throw new Error("expected a table:table element");
  }
  return table;
}

describe("OdsSheet.mergeCells", () => {
  it("sets colSpan/rowSpan on the anchor cell only when the corresponding span is greater than 1", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.mergeCells(0, 0, 1, 3);
    const table = findTableElement(editor);
    const row = directChild(table, "table:table-row");
    if (row === undefined) {
      throw new Error("expected a row");
    }
    const anchor = directChild(row, "table:table-cell");
    if (anchor === undefined) {
      throw new Error("expected the anchor cell");
    }
    expect(
      anchor.attributes.find((a) => a.name === "table:number-columns-spanned")
        ?.value,
    ).toBe("3");
    expect(
      anchor.attributes.some((a) => a.name === "table:number-rows-spanned"),
    ).toBe(false);
  });

  it("every column/row a merge touches reads back at a real default width/height, never an ambiguous 0, even though mergeCells never calls cell() itself", () => {
    const editor = createOds();
    editor.sheets()[0]!.mergeCells(0, 0, 2, 2);
    const content = readOdsContent(openOds(editor.toBytes()).toPackage());
    if (content.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(
      content.sheets[0]!.columns.find((c) => c.index === 0)?.widthPt,
    ).toBeCloseTo(64, 5);
    expect(
      content.sheets[0]!.columns.find((c) => c.index === 1)?.widthPt,
    ).toBeCloseTo(64, 5);
    expect(
      content.sheets[0]!.rows.find((r) => r.index === 0)?.heightPt,
    ).toBeCloseTo(15, 5);
    expect(
      content.sheets[0]!.rows.find((r) => r.index === 1)?.heightPt,
    ).toBeCloseTo(15, 5);
  });

  it("anchor keeps its own value; every OTHER covered position becomes table:covered-table-cell and is rejected by cell()", () => {
    const sheet = createOds().sheets()[0]!;
    const anchor = sheet.mergeCells(1, 1, 2, 2);
    anchor.value = { kind: "string", value: "merged" };
    expect(sheet.cell(1, 1).value).toEqual({ kind: "string", value: "merged" });
    expect(() => sheet.cell(1, 2)).toThrow(/covered by a merged range/);
    expect(() => sheet.cell(2, 1)).toThrow(/covered by a merged range/);
    expect(() => sheet.cell(2, 2)).toThrow(/covered by a merged range/);
    // Outside the merged rectangle, ordinary cells are unaffected.
    expect(() => sheet.cell(3, 3)).not.toThrow();
  });

  it('a 1x1 "merge" writes no span attributes at all -- an unmerged cell', () => {
    const sheet = createOds().sheets()[0]!;
    const anchor = sheet.mergeCells(0, 0, 1, 1);
    anchor.value = { kind: "number", value: 1 };
    expect(sheet.cell(0, 0).value).toEqual({ kind: "number", value: 1 });
  });

  it("rejects a non-positive span", () => {
    const sheet = createOds().sheets()[0]!;
    expect(() => sheet.mergeCells(0, 0, 0, 1)).toThrow(/positive integers/);
    expect(() => sheet.mergeCells(0, 0, 1, 0)).toThrow(/positive integers/);
  });

  it("rejects merging onto a position already covered by another merge", () => {
    const sheet = createOds().sheets()[0]!;
    sheet.mergeCells(0, 0, 2, 2);
    expect(() => sheet.mergeCells(0, 1, 1, 1)).toThrow(/already covered/);
  });

  it("reaching a merge far from the sheet's origin is cheap regardless of distance -- only the merge's own small area does real work", () => {
    const sheet = createOds().sheets()[0]!;
    const start = performance.now();
    sheet.mergeCells(1000000, 1000, 2, 2); // far from the origin, but a tiny 2x2 rectangle -- reaching it must not cost anything proportional to row 1,000,000.
    const elapsedMs = performance.now() - start;
    expect(elapsedMs).toBeLessThan(500);
  });

  it("a merge's own area does genuinely proportional work -- a moderately large rectangle still completes in a bounded, CI-safe time", () => {
    const sheet = createOds().sheets()[0]!;
    const start = performance.now();
    sheet.mergeCells(0, 0, 100, 100); // 10,000 covered positions, each stamped individually -- see mergeCells' own doc comment on why this is O(area), not O(1).
    const elapsedMs = performance.now() - start;
    // The bound exists to catch accidental super-linearity (an O(area^2) or distance-proportional regression blows far past it), not to pin a wall-clock figure: nominal runtime is well under a second, and a CI runner contended by a concurrent release cascade has measured this same linear work at over five seconds -- ten gives an order of magnitude of headroom over that observed contention without losing any regression-detection power.
    expect(elapsedMs).toBeLessThan(10000);
  });
});

const CUSTOM_PRINT_SETTINGS: ContentSheetPrintSettings = {
  pageSize: { widthPt: 400, heightPt: 300 },
  margins: { topPt: 10, rightPt: 20, bottomPt: 30, leftPt: 40 },
  gridlines: true,
  headers: true,
  pageOrder: "overThenDown",
};

describe("OdsSheet.printSettings", () => {
  it("get returns the scaffold's own real defaults before any set (A4, no gridlines/headers, downThenOver)", () => {
    const sheet = createOds().sheets()[0]!;
    expect(sheet.printSettings).toMatchObject({
      pageSize: PAGE_SIZE_A4,
      gridlines: false,
      headers: false,
      pageOrder: "downThenOver",
    });
  });

  it("set then get round-trips every field through the live in-memory view", () => {
    const sheet = createOds().sheets()[0]!;
    sheet.printSettings = CUSTOM_PRINT_SETTINGS;
    expect(sheet.printSettings).toEqual(CUSTOM_PRINT_SETTINGS);
  });

  it("setting one sheet's printSettings does not perturb another sheet's own", () => {
    const editor = createOds();
    const sheetA = editor.sheets()[0]!;
    const sheetB = editor.addSheet("Second");
    sheetA.printSettings = CUSTOM_PRINT_SETTINGS;
    expect(sheetB.printSettings).toMatchObject({
      gridlines: false,
      headers: false,
      pageOrder: "downThenOver",
    });
  });

  it('mints a fresh style:page-layout/style:master-page/style:style[family="table"] triple on every set, repointing table:style-name rather than mutating whatever the sheet was pointing at before', () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.printSettings = CUSTOM_PRINT_SETTINGS;
    const firstTableStyleName = findTableElement(editor).attributes.find(
      (a) => a.name === "table:style-name",
    )?.value;
    sheet.printSettings = { ...CUSTOM_PRINT_SETTINGS, gridlines: false };
    const secondTableStyleName = findTableElement(editor).attributes.find(
      (a) => a.name === "table:style-name",
    )?.value;
    expect(firstTableStyleName).toBeDefined();
    expect(secondTableStyleName).toBeDefined();
    expect(secondTableStyleName).not.toBe(firstTableStyleName); // a genuinely different style was minted, not the first one mutated in place
    expect(sheet.printSettings.gridlines).toBe(false); // the SECOND set's own value is what's actually in effect
  });

  // Re-reads the ACTUAL SERIALIZED BYTES via odf.js's own real readOds parser (readOdsContent is a thin wrapper over it), not this package's own writer echoing its input back -- proves the page-layout/master-page/table-style chain writeSheetPrintSettings mints is genuinely valid, spec-shaped ODF, not merely an in-memory object this editor's own getter happens to read back correctly.
  it("a set printSettings survives a real write -> reread round trip via odf.js's own readOdsContent parser", () => {
    const editor = createOds();
    editor.sheets()[0]!.printSettings = CUSTOM_PRINT_SETTINGS;
    const bytes = editor.toBytes();

    const reopened = openOds(bytes).sheets()[0]!;
    expect(reopened.printSettings).toEqual(CUSTOM_PRINT_SETTINGS);

    const content = readOdsContent(openOds(bytes).toPackage());
    if (content.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(content.sheets[0]!.printSettings).toEqual(CUSTOM_PRINT_SETTINGS);
  });
});

describe("OdsSheet.printSettings: printRange, scale/fitToPages, repeatRows/repeatColumns, manualBreaks", () => {
  it("printRange round-trips through a real write -> reread cycle via odf.js's own readOdsContent parser", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.cell(0, 0).value = { kind: "string", value: "x" };
    sheet.printSettings = {
      ...CUSTOM_PRINT_SETTINGS,
      printRange: { startRow: 0, startColumn: 0, endRow: 9, endColumn: 4 },
    };

    const content = readOdsContent(openOds(editor.toBytes()).toPackage());
    if (content.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(content.sheets[0]!.printSettings.printRange).toEqual({
      startRow: 0,
      startColumn: 0,
      endRow: 9,
      endColumn: 4,
    });
  });

  it("scalePercent and fitToPages round-trip independently -- setting one never perturbs a separately-set other", () => {
    const editor = createOds();
    const sheetA = editor.sheets()[0]!;
    sheetA.printSettings = { ...CUSTOM_PRINT_SETTINGS, scalePercent: 80 };
    const sheetB = editor.addSheet("FitToPages");
    sheetB.printSettings = {
      ...CUSTOM_PRINT_SETTINGS,
      fitToPages: { width: 1, height: 2 },
    };

    const content = readOdsContent(openOds(editor.toBytes()).toPackage());
    if (content.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(content.sheets[0]!.printSettings.scalePercent).toBe(80);
    expect(content.sheets[0]!.printSettings.fitToPages).toBeUndefined();
    expect(content.sheets[1]!.printSettings.fitToPages).toEqual({
      width: 1,
      height: 2,
    });
    expect(content.sheets[1]!.printSettings.scalePercent).toBeUndefined();
  });

  it("repeatRows/repeatColumns wrap the real rows/columns into table:table-header-rows/table:table-header-columns, and round-trip through odf.js's own readOdsContent", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.cell(0, 0).value = { kind: "string", value: "Header" };
    sheet.cell(5, 2).value = { kind: "string", value: "Data" };
    sheet.printSettings = {
      ...CUSTOM_PRINT_SETTINGS,
      repeatRows: { start: 0, end: 0 },
      repeatColumns: { start: 0, end: 0 },
    };

    const table = findTableElement(editor);
    expect(directChild(table, "table:table-header-rows")).toBeDefined();
    expect(directChild(table, "table:table-header-columns")).toBeDefined();

    const content = readOdsContent(openOds(editor.toBytes()).toPackage());
    if (content.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    const sheetOut = content.sheets[0]!;
    expect(sheetOut.printSettings.repeatRows).toEqual({ start: 0, end: 0 });
    expect(sheetOut.printSettings.repeatColumns).toEqual({ start: 0, end: 0 });
    // The wrapped header row's own cell content survived the structural move, and the un-wrapped data cell beyond it is still addressable at its own real position.
    expect(
      sheetOut.cells.find((c) => c.row === 0 && c.column === 0)?.value,
    ).toEqual({ kind: "string", value: "Header" });
    expect(
      sheetOut.cells.find((c) => c.row === 5 && c.column === 2)?.value,
    ).toEqual({ kind: "string", value: "Data" });
  });

  it("repeatColumns/repeatRows beyond any touched cell read back at a real default width/height, never an ambiguous 0", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    // Touch only column 0 / row 0; the repeat range covers columns/rows that have never been individuated by a cell write.
    sheet.cell(0, 0).value = { kind: "string", value: "only cell" };
    sheet.printSettings = {
      ...CUSTOM_PRINT_SETTINGS,
      repeatColumns: { start: 3, end: 5 },
      repeatRows: { start: 3, end: 4 },
    };

    const content = readOdsContent(openOds(editor.toBytes()).toPackage());
    if (content.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    const sheetOut = content.sheets[0]!;
    // Every column/row the repeat range individuated reads back at the real default (64pt/15pt), not the ambiguous 0 an unstyled element produces.
    expect(sheetOut.columns.find((c) => c.index === 3)?.widthPt).toBeCloseTo(
      64,
      5,
    );
    expect(sheetOut.columns.find((c) => c.index === 4)?.widthPt).toBeCloseTo(
      64,
      5,
    );
    expect(sheetOut.columns.find((c) => c.index === 5)?.widthPt).toBeCloseTo(
      64,
      5,
    );
    expect(sheetOut.rows.find((r) => r.index === 3)?.heightPt).toBeCloseTo(
      15,
      5,
    );
    expect(sheetOut.rows.find((r) => r.index === 4)?.heightPt).toBeCloseTo(
      15,
      5,
    );
  });

  it("repeatColumns beyond any touched cell also stamps the exterior gap-fill columns (positions between coverage and the range start), not only the in-range ones", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    // Touch only column 0; repeatColumns starts at 3, so replaceRun gap-fills columns 1-2 (positions between coverage and the range start) -- those exterior gap-fills must also carry a real default width, never the ambiguous 0.
    sheet.cell(0, 0).value = { kind: "string", value: "only cell" };
    sheet.printSettings = {
      ...CUSTOM_PRINT_SETTINGS,
      repeatColumns: { start: 3, end: 5 },
    };

    const content = readOdsContent(openOds(editor.toBytes()).toPackage());
    if (content.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    const sheetOut = content.sheets[0]!;
    // The exterior gap-fill (columns 1-2, a single number-columns-repeated run reported by odf.js at index 1) reads back at the real default, alongside the in-range columns 3-5.
    expect(sheetOut.columns.find((c) => c.index === 1)?.widthPt).toBeCloseTo(
      64,
      5,
    );
    expect(sheetOut.columns.find((c) => c.index === 3)?.widthPt).toBeCloseTo(
      64,
      5,
    );
  });

  it("repeatColumns preserves a width already set on a column inside the range rather than overwriting it with the default", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.setColumnWidth(4, 111);
    sheet.printSettings = {
      ...CUSTOM_PRINT_SETTINGS,
      repeatColumns: { start: 3, end: 5 },
    };

    const content = readOdsContent(openOds(editor.toBytes()).toPackage());
    if (content.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    const sheetOut = content.sheets[0]!;
    expect(sheetOut.columns.find((c) => c.index === 4)?.widthPt).toBeCloseTo(
      111,
      5,
    );
    expect(sheetOut.columns.find((c) => c.index === 3)?.widthPt).toBeCloseTo(
      64,
      5,
    );
  });

  it("a cell written to a row AFTER it has been wrapped into repeatRows resolves to its real, existing position rather than a spurious duplicate", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.cell(0, 0).value = { kind: "string", value: "Header" };
    sheet.printSettings = {
      ...CUSTOM_PRINT_SETTINGS,
      repeatRows: { start: 0, end: 0 },
    };

    // Row 0 is now wrapped inside table:table-header-rows -- writing a SECOND cell on that same row must find the SAME wrapped row element, not create a duplicate direct-child row 0.
    sheet.cell(0, 1).value = { kind: "string", value: "Header2" };

    const table = findTableElement(editor);
    const directRows = table.children.filter(
      (c): c is XmlElement =>
        c.type === "element" && c.tag === "table:table-row",
    );
    expect(directRows).toHaveLength(0); // row 0 lives ONLY inside the header wrapper, never duplicated as a direct child too

    const content = readOdsContent(openOds(editor.toBytes()).toPackage());
    if (content.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    const row0Cells = content.sheets[0]!.cells.filter((c) => c.row === 0);
    expect(row0Cells).toHaveLength(2);
    expect(row0Cells.find((c) => c.column === 0)?.value).toEqual({
      kind: "string",
      value: "Header",
    });
    expect(row0Cells.find((c) => c.column === 1)?.value).toEqual({
      kind: "string",
      value: "Header2",
    });
  });

  it("manualBreaks round-trip on both rows and columns, preserving a width/height already set on the SAME row/column", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.cell(3, 2).value = { kind: "string", value: "x" };
    sheet.setColumnWidth(2, 111);
    sheet.setRowHeight(3, 22);
    sheet.printSettings = {
      ...CUSTOM_PRINT_SETTINGS,
      manualBreaks: { rows: [3], columns: [2] },
    };

    const content = readOdsContent(openOds(editor.toBytes()).toPackage());
    if (content.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    const sheetOut = content.sheets[0]!;
    expect(sheetOut.printSettings.manualBreaks).toEqual({
      rows: [3],
      columns: [2],
    });
    // Setting the manual break must not have clobbered the width/height already set on that same column/row.
    expect(sheetOut.columns.find((c) => c.index === 2)?.widthPt).toBeCloseTo(
      111,
      5,
    );
    expect(sheetOut.rows.find((r) => r.index === 3)?.heightPt).toBeCloseTo(
      22,
      5,
    );
  });

  it("setting a width AFTER a manual break on the same column preserves the break, mirroring the reverse order above", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.cell(0, 4).value = { kind: "string", value: "x" };
    sheet.printSettings = {
      ...CUSTOM_PRINT_SETTINGS,
      manualBreaks: { rows: [], columns: [4] },
    };
    sheet.setColumnWidth(4, 77);

    const content = readOdsContent(openOds(editor.toBytes()).toPackage());
    if (content.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    const sheetOut = content.sheets[0]!;
    expect(sheetOut.columns.find((c) => c.index === 4)?.widthPt).toBeCloseTo(
      77,
      5,
    );
    expect(sheetOut.printSettings.manualBreaks?.columns).toContain(4);
  });
});

describe("OdsSheet.setColumnWidth / setRowHeight", () => {
  it("a column/row touched only via cell() reads back at a real default width/height, never an ambiguous 0", () => {
    const editor = createOds();
    editor.sheets()[0]!.cell(0, 0).value = { kind: "string", value: "x" };
    const content = readOdsContent(openOds(editor.toBytes()).toPackage());
    if (content.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(content.sheets[0]!.columns[0]?.widthPt).toBeCloseTo(64, 5);
    expect(content.sheets[0]!.rows[0]?.heightPt).toBeCloseTo(15, 5);
  });

  it("set then get (via a real write -> reread round trip through odf.js's own readOdsContent parser) round-trips the width/height", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.cell(0, 0).value = { kind: "string", value: "x" };
    sheet.setColumnWidth(0, 120);
    sheet.setRowHeight(0, 30);

    const content = readOdsContent(openOds(editor.toBytes()).toPackage());
    if (content.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(content.sheets[0]!.columns[0]?.widthPt).toBeCloseTo(120, 5);
    expect(content.sheets[0]!.rows[0]?.heightPt).toBeCloseTo(30, 5);
  });

  it("individuates (gap-fills) a column/row no cell has ever touched, rather than requiring cell() first", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.setColumnWidth(5, 90);
    sheet.setRowHeight(5, 25);

    const content = readOdsContent(openOds(editor.toBytes()).toPackage());
    if (content.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(
      content.sheets[0]!.columns.find((c) => c.index === 5)?.widthPt,
    ).toBeCloseTo(90, 5);
    expect(
      content.sheets[0]!.rows.find((r) => r.index === 5)?.heightPt,
    ).toBeCloseTo(25, 5);
  });

  it("mints a fresh style on every call, repointing table:style-name rather than mutating whatever the column/row was pointing at before", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.cell(0, 0).value = { kind: "string", value: "x" };
    sheet.setColumnWidth(0, 100);
    const table = findTableElement(editor);
    const firstColumnStyleName = directChild(
      table,
      "table:table-column",
    )?.attributes.find((a) => a.name === "table:style-name")?.value;
    sheet.setColumnWidth(0, 200);
    const secondColumnStyleName = directChild(
      table,
      "table:table-column",
    )?.attributes.find((a) => a.name === "table:style-name")?.value;
    expect(firstColumnStyleName).toBeDefined();
    expect(secondColumnStyleName).toBeDefined();
    expect(secondColumnStyleName).not.toBe(firstColumnStyleName);

    const content = readOdsContent(openOds(editor.toBytes()).toPackage());
    if (content.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(content.sheets[0]!.columns[0]?.widthPt).toBeCloseTo(200, 5); // the SECOND set's own value is what's actually in effect
  });

  it("setting one sheet's column width does not perturb another sheet's own", () => {
    const editor = createOds();
    const sheetA = editor.sheets()[0]!;
    const sheetB = editor.addSheet("Second");
    sheetA.cell(0, 0).value = { kind: "string", value: "x" };
    sheetB.cell(0, 0).value = { kind: "string", value: "y" };
    sheetA.setColumnWidth(0, 150);

    const content = readOdsContent(openOds(editor.toBytes()).toPackage());
    if (content.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(content.sheets[0]!.columns[0]?.widthPt).toBeCloseTo(150, 5);
    // sheetB's own column was only ever touched by its own cell() call, never by sheetA's setColumnWidth -- it reads back at the ordinary cell()-materialization default (64pt), proving the two sheets' styles are genuinely independent rather than sharing one automatic style neither of them meant to share.
    expect(content.sheets[1]!.columns[0]?.widthPt).toBeCloseTo(64, 5);
  });
});

describe("OdsSheet.setColumnHidden / setRowHidden", () => {
  it("individuates a column/row no cell has ever touched with a real default width/height, not an ambiguous 0", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.setColumnHidden(4, true);
    sheet.setRowHidden(4, true);

    const content = readOdsContent(openOds(editor.toBytes()).toPackage());
    if (content.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(
      content.sheets[0]!.columns.find((c) => c.index === 4)?.widthPt,
    ).toBeCloseTo(64, 5);
    expect(
      content.sheets[0]!.rows.find((r) => r.index === 4)?.heightPt,
    ).toBeCloseTo(15, 5);
  });

  it("a column/row no cell has touched yet is not hidden by default", () => {
    const editor = createOds();
    editor.sheets()[0]!.cell(0, 0).value = { kind: "string", value: "x" };
    const content = readOdsContent(openOds(editor.toBytes()).toPackage());
    if (content.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(content.sheets[0]!.columns[0]?.hidden).toBeUndefined();
    expect(content.sheets[0]!.rows[0]?.hidden).toBeUndefined();
  });

  it("set then get (via a real write -> reread round trip through odf.js's own readOdsContent parser) round-trips hidden state", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.cell(0, 0).value = { kind: "string", value: "x" };
    sheet.setColumnHidden(0, true);
    sheet.setRowHidden(0, true);

    const content = readOdsContent(openOds(editor.toBytes()).toPackage());
    if (content.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(content.sheets[0]!.columns[0]?.hidden).toBe(true);
    expect(content.sheets[0]!.rows[0]?.hidden).toBe(true);
  });

  it("preserves a width/height already set on the same column/row -- hidden and sizing never collide, since table:visibility is a plain attribute, not a style property", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.cell(0, 0).value = { kind: "string", value: "x" };
    sheet.setColumnWidth(0, 130);
    sheet.setRowHeight(0, 40);
    sheet.setColumnHidden(0, true);
    sheet.setRowHidden(0, true);

    const content = readOdsContent(openOds(editor.toBytes()).toPackage());
    if (content.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(content.sheets[0]!.columns[0]?.widthPt).toBeCloseTo(130, 5);
    expect(content.sheets[0]!.rows[0]?.heightPt).toBeCloseTo(40, 5);
    expect(content.sheets[0]!.columns[0]?.hidden).toBe(true);
    expect(content.sheets[0]!.rows[0]?.hidden).toBe(true);
  });

  it('unhiding (passing false) removes table:visibility rather than leaving a stale "collapse"', () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.cell(0, 0).value = { kind: "string", value: "x" };
    sheet.setColumnHidden(0, true);
    sheet.setColumnHidden(0, false);

    const content = readOdsContent(openOds(editor.toBytes()).toPackage());
    if (content.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(content.sheets[0]!.columns[0]?.hidden).toBeUndefined();
  });
});

describe("OdsSheet.name", () => {
  it("get/set the sheet name", () => {
    const sheet = createOds().sheets()[0]!;
    expect(sheet.name).toBe("Sheet1");
    sheet.name = "Renamed";
    expect(sheet.name).toBe("Renamed");
  });
});

describe("OdsSheet.remove", () => {
  it("removes the sheet from the spreadsheet and throws on any further use", () => {
    const editor = createOds();
    editor.addSheet("Second");
    expect(editor.sheets()).toHaveLength(2);
    const [first] = editor.sheets();
    first!.remove();
    expect(editor.sheets()).toHaveLength(1);
    expect(editor.sheets()[0]!.name).toBe("Second");
    expect(() => first!.cell(0, 0)).toThrow(/removed/);
  });
});
