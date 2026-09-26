import { describe, expect, it } from "vitest";
import type { ContentSheet } from "document-schema.js";
import type { Package } from "../../model/package";
import { el, txt } from "../../xml/fragment";
import { columnWidthCharsToPt, DEFAULT_ROW_HEIGHT_PT } from "./units";
import { readXlsxContent } from "./content";
function hasOwn(obj: object, key: string): boolean {
  return Object.hasOwn(obj, key);
}

// This suite reads real, unmodified LibreOffice-generated .xlsx fixtures (src/typed/xlsx/fixtures/*.xlsx). Both fixtures are genuine LibreOffice xlsx-exports (`soffice --headless --convert-to xlsx`) of odf.js's own src/typed/ods/fixtures/{kitchen-sink,minimal}.ods — the same feature set that package's own readOds test suite already validates against ODF's equivalent mechanisms, run back through LibreOffice's real SpreadsheetML export filter so this suite exercises genuine, LibreOffice-authored xlsx markup (column-width character units, row heights, hidden rows/columns, every value-type LibreOffice's own xlsx exporter distinguishes, a real merged range, a real cross-sheet formula, and real print settings including Print_Area/Print_Titles defined names) rather than a hand-built approximation of what that markup might look like. A handful of narrow scope-boundary/error-path tests at the end use small, synthetic, hand-built packages instead (via el/txt), mirroring readOds's own established convention for the identical reason.

function buildMinimalPackage(worksheet: ReturnType<typeof el>): Package {
  return {
    parts: {
      "xl/workbook.xml": {
        kind: "xml",
        nodes: [
          el("workbook", {}, [
            el("sheets", {}, [el("sheet", { name: "Sheet1", "r:id": "rId1" })]),
          ]),
        ],
      },
      "xl/_rels/workbook.xml.rels": {
        kind: "xml",
        nodes: [
          el("Relationships", {}, [
            el("Relationship", {
              Id: "rId1",
              Type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
              Target: "worksheets/sheet1.xml",
            }),
          ]),
        ],
      },
      "xl/worksheets/sheet1.xml": { kind: "xml", nodes: [worksheet] },
    },
  };
}

function readFirstCell(worksheet: ReturnType<typeof el>) {
  const result = readXlsxContent(buildMinimalPackage(worksheet));
  if (result.kind !== "spreadsheet") {
    throw new Error("expected a spreadsheet ContentDocument");
  }
  return { cells: result.sheets[0]?.cells ?? [], result };
}

function buildStyledPackage(
  formatCode: string,
  cell: ReturnType<typeof el>,
  date1904?: string,
): Package {
  const workbookChildren = [
    ...(date1904 === undefined ? [] : [el("workbookPr", { date1904 })]),
    el("sheets", {}, [el("sheet", { name: "Sheet1", "r:id": "rId1" })]),
  ];
  return {
    parts: {
      "xl/workbook.xml": {
        kind: "xml",
        nodes: [el("workbook", {}, workbookChildren)],
      },
      "xl/_rels/workbook.xml.rels": {
        kind: "xml",
        nodes: [
          el("Relationships", {}, [
            el("Relationship", {
              Id: "rId1",
              Type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
              Target: "worksheets/sheet1.xml",
            }),
          ]),
        ],
      },
      "xl/styles.xml": {
        kind: "xml",
        nodes: [
          el("styleSheet", {}, [
            el("numFmts", {}, [el("numFmt", { numFmtId: "164", formatCode })]),
            el("cellXfs", {}, [
              el("xf", { numFmtId: "0" }),
              el("xf", { numFmtId: "164" }),
            ]),
          ]),
        ],
      },
      "xl/worksheets/sheet1.xml": {
        kind: "xml",
        nodes: [
          el("worksheet", {}, [
            el("sheetData", {}, [el("row", { r: "1" }, [cell])]),
          ]),
        ],
      },
    },
  };
}

function readStyledCell(
  formatCode: string,
  cell: ReturnType<typeof el>,
  date1904?: string,
) {
  const result = readXlsxContent(
    buildStyledPackage(formatCode, cell, date1904),
  );
  if (result.kind !== "spreadsheet") {
    throw new Error("expected a spreadsheet ContentDocument");
  }
  return result.sheets[0]?.cells[0];
}

// A styled numeric cell — s="1" points at the numFmts-declared format; s="0" at General.
function numericCell(value: string): ReturnType<typeof el> {
  return el("c", { r: "A1", s: "1" }, [el("v", {}, [txt(value)])]);
}

function readSheetFromWorksheet(
  worksheet: ReturnType<typeof el>,
): ContentSheet {
  const result = readXlsxContent(buildMinimalPackage(worksheet));
  if (result.kind !== "spreadsheet") {
    throw new Error("expected a spreadsheet ContentDocument");
  }
  const sheet = result.sheets[0];
  if (sheet === undefined) {
    throw new Error("expected a sheet");
  }
  return sheet;
}

describe("readXlsxContent: row/column geometry edge cases (synthetic packages)", () => {
  it("falls back to DEFAULT_ROW_HEIGHT_PT for a row with no ht attribute when the worksheet carries no sheetFormatPr at all", () => {
    const worksheet = el("worksheet", {}, [
      el("sheetData", {}, [el("row", { r: "1" })]),
    ]);
    expect(readSheetFromWorksheet(worksheet).rows).toEqual([
      { index: 0, heightPt: DEFAULT_ROW_HEIGHT_PT },
    ]);
  });

  it("falls back to the sheetFormatPr's own declared defaultRowHeight, not the package-wide default, for a row with no ht of its own", () => {
    const worksheet = el("worksheet", {}, [
      el("sheetFormatPr", { defaultRowHeight: "22.5" }),
      el("sheetData", {}, [el("row", { r: "1" })]),
    ]);
    expect(readSheetFromWorksheet(worksheet).rows).toEqual([
      { index: 0, heightPt: 22.5 },
    ]);
  });

  it("prefers a row's own ht over the sheetFormatPr default", () => {
    const worksheet = el("worksheet", {}, [
      el("sheetFormatPr", { defaultRowHeight: "22.5" }),
      el("sheetData", {}, [el("row", { r: "1", ht: "30" })]),
    ]);
    expect(readSheetFromWorksheet(worksheet).rows).toEqual([
      { index: 0, heightPt: 30 },
    ]);
  });

  it("drops a row whose own r is 0 (below CT_Row/@r's 1-based lower bound) but keeps one whose r is exactly 1", () => {
    const worksheet = el("worksheet", {}, [
      el("sheetData", {}, [el("row", { r: "0" }), el("row", { r: "1" })]),
    ]);
    expect(readSheetFromWorksheet(worksheet).rows).toEqual([
      { index: 0, heightPt: DEFAULT_ROW_HEIGHT_PT },
    ]);
  });

  it('recovers row index 4 — not 6 — from r="5", proving the 1-based-to-0-based conversion subtracts rather than adds', () => {
    const worksheet = el("worksheet", {}, [
      el("sheetData", {}, [el("row", { r: "5" })]),
    ]);
    // r="5" minus 1 (1-based to 0-based), not r="5" plus 1.
    const EXPECTED_ROW_INDEX = 4;
    expect(readSheetFromWorksheet(worksheet).rows[0]?.index).toBe(
      EXPECTED_ROW_INDEX,
    );
  });

  it("marks a row hidden only when its own hidden attribute reads true, never as a side effect of any other attribute", () => {
    const worksheet = el("worksheet", {}, [
      el("sheetData", {}, [
        el("row", { r: "1", hidden: "true" }),
        el("row", { r: "2" }),
      ]),
    ]);
    const rows = readSheetFromWorksheet(worksheet).rows;
    expect(rows[0]).toEqual({
      index: 0,
      heightPt: DEFAULT_ROW_HEIGHT_PT,
      hidden: true,
    });
    expect(hasOwn(rows[1] ?? {}, "hidden")).toBe(false);
  });

  it("drops a <col> whose min is 0 (below CT_Col/@min's 1-based lower bound) but keeps one whose min is exactly 1", () => {
    const worksheet = el("worksheet", {}, [
      el("cols", {}, [
        el("col", { min: "0", max: "0" }),
        el("col", { min: "1", max: "1" }),
      ]),
      el("sheetData", {}),
    ]);
    expect(readSheetFromWorksheet(worksheet).columns).toEqual([{ index: 0 }]);
  });

  it("sets widthPt from a numeric width attribute, and omits the key entirely when width is absent", () => {
    const worksheet = el("worksheet", {}, [
      el("cols", {}, [
        el("col", { min: "1", max: "1", width: "20" }),
        el("col", { min: "2", max: "2" }),
      ]),
      el("sheetData", {}),
    ]);
    const columns = readSheetFromWorksheet(worksheet).columns;
    const COLUMN_WIDTH_CHARS = 20;
    const WIDTH_PT_CLOSE_TO_PRECISION = 10;
    expect(columns[0]?.widthPt).toBeCloseTo(
      columnWidthCharsToPt(COLUMN_WIDTH_CHARS),
      WIDTH_PT_CLOSE_TO_PRECISION,
    );
    expect(hasOwn(columns[1] ?? {}, "widthPt")).toBe(false);
  });

  it("omits widthPt for a non-numeric width attribute, rather than reporting a NaN width", () => {
    const worksheet = el("worksheet", {}, [
      el("cols", {}, [
        el("col", { min: "1", max: "1", width: "not-a-number" }),
      ]),
      el("sheetData", {}),
    ]);
    expect(
      hasOwn(readSheetFromWorksheet(worksheet).columns[0] ?? {}, "widthPt"),
    ).toBe(false);
  });

  it("marks a column hidden only when its own hidden attribute reads true", () => {
    const worksheet = el("worksheet", {}, [
      el("cols", {}, [
        el("col", { min: "1", max: "1", hidden: "true" }),
        el("col", { min: "2", max: "2" }),
      ]),
      el("sheetData", {}),
    ]);
    const columns = readSheetFromWorksheet(worksheet).columns;
    expect(columns[0]).toEqual({ index: 0, hidden: true });
    expect(hasOwn(columns[1] ?? {}, "hidden")).toBe(false);
  });
});

describe("readXlsxContent: readSheet's own optional-field keys are absent, not undefined, when a sheet carries none of them", () => {
  it("omits embeddedObjects/dataValidations/conditionalFormats entirely from a sheet with no drawing, validation, or conditional format at all", () => {
    const sheet = readSheetFromWorksheet(
      el("worksheet", {}, [el("sheetData", {})]),
    );
    expect(hasOwn(sheet, "embeddedObjects")).toBe(false);
    expect(hasOwn(sheet, "dataValidations")).toBe(false);
    expect(hasOwn(sheet, "conditionalFormats")).toBe(false);
  });
});

describe("readXlsxContent: deriveDisplayText/resolveNumericValue exact per-kind coverage (synthetic packages)", () => {
  it("renders a numeric-format dateTime cell's displayText as its ISO spelling, not the boolean-branch TRUE/FALSE fallthrough text", () => {
    const cell = readStyledCell(
      "yyyy-mm-dd hh:mm:ss",
      numericCell("46234.604166666666667"),
    );
    expect(cell?.displayText).toBe("2026-07-31T14:30:00");
  });

  it("renders a percentage cell's displayText as the raw stored fraction, not TRUE", () => {
    const cell = readStyledCell("0.00%", numericCell("0.4256"));
    expect(cell?.displayText).toBe("0.4256");
  });

  it("omits the currency key entirely (not merely as undefined) when the format names money by symbol alone", () => {
    const cell = readStyledCell("[$£-809]#,##0.00", numericCell("99.99"));
    expect(cell?.value.kind).toBe("currency");
    expect(hasOwn(cell?.value ?? {}, "currency")).toBe(false);
  });

  it('renders FALSE, not just "not TRUE", for a false boolean cell', () => {
    expect(
      readFirstCell(
        el("worksheet", {}, [
          el("sheetData", {}, [
            el("row", { r: "1" }, [
              el("c", { r: "A1", t: "b" }, [el("v", {}, [txt("0")])]),
            ]),
          ]),
        ]),
      ).cells[0],
    ).toMatchObject({
      value: { kind: "boolean", value: false },
      displayText: "FALSE",
    });
  });
});

describe("readXlsxContent: readCellValue's boolean/numeric branch precision (synthetic packages)", () => {
  it('reads t="b" true from an upper-, lower-, or mixed-case spelling of "true", not just the literal "1"', () => {
    for (const raw of ["TRUE", "True", "true"]) {
      const { cells } = readFirstCell(
        el("worksheet", {}, [
          el("sheetData", {}, [
            el("row", { r: "1" }, [
              el("c", { r: "A1", t: "b" }, [el("v", {}, [txt(raw)])]),
            ]),
          ]),
        ]),
      );
      expect(cells[0]?.value).toEqual({ kind: "boolean", value: true });
      expect(cells[0]?.displayText).toBe("TRUE");
    }
  });

  it('reads t="b" as false for any raw text that is neither "1" nor a case-insensitive "true"', () => {
    const { cells } = readFirstCell(
      el("worksheet", {}, [
        el("sheetData", {}, [
          el("row", { r: "1" }, [
            el("c", { r: "A1", t: "b" }, [el("v", {}, [txt("false")])]),
          ]),
        ]),
      ]),
    );
    expect(cells[0]?.value).toEqual({ kind: "boolean", value: false });
  });

  it("drops an untyped cell whose <v> text is not a parseable number at all, rather than reporting NaN", () => {
    const { cells } = readFirstCell(
      el("worksheet", {}, [
        el("sheetData", {}, [
          el("row", { r: "1" }, [
            el("c", { r: "A1" }, [el("v", {}, [txt("not-a-number")])]),
          ]),
        ]),
      ]),
    );
    expect(cells).toEqual([]);
  });
});

describe("readXlsxContent: readCell's formula key presence (synthetic packages)", () => {
  it("omits the formula key entirely for a plain value cell with no <f> child", () => {
    const { cells } = readFirstCell(
      el("worksheet", {}, [
        el("sheetData", {}, [
          el("row", { r: "1" }, [
            el("c", { r: "A1" }, [el("v", {}, [txt("42")])]),
          ]),
        ]),
      ]),
    );
    expect(hasOwn(cells[0] ?? {}, "formula")).toBe(false);
  });
});

describe("readXlsxContent: merged-range span arithmetic (synthetic packages)", () => {
  // Anchored at B2, not A1: with a zero-valued start, endColumn-startColumn and endColumn+startColumn (the ArithmeticOperator mutant's own replacement) coincide, so a genuine test needs a nonzero start on both axes to actually distinguish subtraction from addition.
  function mergedWorksheet(
    ref: string,
    anchorRef: string,
  ): ReturnType<typeof el> {
    return el("worksheet", {}, [
      el("sheetData", {}, [
        el("row", { r: "2" }, [
          el("c", { r: anchorRef }, [el("v", {}, [txt("1")])]),
        ]),
      ]),
      el("mergeCells", {}, [el("mergeCell", { ref })]),
    ]);
  }

  it("computes colSpan and rowSpan from the true end-minus-start distance, not an end-plus-start sum, for a merge anchored away from row/column 0", () => {
    const { cells } = readFirstCell(mergedWorksheet("B2:D4", "B2"));
    const anchor = cells[0];
    // B2:D4 spans 3 columns (B, C, D) and 3 rows (2, 3, 4).
    const SPAN_OF_THREE = 3;
    expect(anchor?.colSpan).toBe(SPAN_OF_THREE);
    expect(anchor?.rowSpan).toBe(SPAN_OF_THREE);
  });

  it("sets colSpan alone for a 1-row, multi-column merge, never fabricating a rowSpan", () => {
    const { cells } = readFirstCell(mergedWorksheet("B2:D2", "B2"));
    const anchor = cells[0];
    // B2:D2 spans 3 columns (B, C, D).
    const SPAN_OF_THREE = 3;
    expect(anchor?.colSpan).toBe(SPAN_OF_THREE);
    expect(hasOwn(anchor ?? {}, "rowSpan")).toBe(false);
  });

  it("sets rowSpan alone for a 1-column, multi-row merge, never fabricating a colSpan", () => {
    const { cells } = readFirstCell(mergedWorksheet("B2:B4", "B2"));
    const anchor = cells[0];
    // B2:B4 spans 3 rows (2, 3, 4).
    const SPAN_OF_THREE = 3;
    expect(anchor?.rowSpan).toBe(SPAN_OF_THREE);
    expect(hasOwn(anchor ?? {}, "colSpan")).toBe(false);
  });

  it("sets neither colSpan nor rowSpan for a single-cell 'merge' (B2:B2) — a span of exactly 1 on both axes", () => {
    const { cells } = readFirstCell(mergedWorksheet("B2:B2", "B2"));
    const anchor = cells[0];
    expect(hasOwn(anchor ?? {}, "colSpan")).toBe(false);
    expect(hasOwn(anchor ?? {}, "rowSpan")).toBe(false);
  });
});

// A chart graphic frame reached the way a real workbook reaches one: the worksheet's own <drawing r:id> names a drawing part through the worksheet's relationships, the drawing's xdr:twoCellAnchor carries an xdr:graphicFrame whose a:graphicData names the chart part through the DRAWING's relationships. The anchor geometry resolves through the sheet's own declared column widths and row heights, exactly as a spreadsheet renderer would place it.
