import { describe, expect, it } from "vitest";
import type { ContentDocument, ContentSheet } from "document-schema.js";
import { PAGE_SIZE_A4, PAGE_SIZE_LETTER } from "document-schema.js";
import type { XmlElement } from "../../model/node";
import type { Package } from "../../model/package";
import { encodePackage } from "../../codec";
import { parsePackage } from "../../package-io/read";
import { attr, childrenWithTag, decodeEntities, rootElement } from "../util";
import { buildXlsxPackageFromContent } from "./build";
import { readXlsxContent } from "./content";
import { columnWidthCharsToPt } from "./units";
import { BUILTIN_NUMBER_FORMATS } from "excel-number-format";
const FORMULA_CELL_ROW = 3;
const ERROR_CELL_ROW = 4;
// Also the row after which the manual page break below is placed, so the printed pagination genuinely splits mid-sheet.
const DEDUPED_STRING_CELL_ROW = 5;

const MERGE_ANCHOR_ROW = 6;
const ESCAPED_TEXT_CELL_ROW = 8;

const KITCHEN_SINK_SHEET: ContentSheet = {
  name: "Data",
  cells: [
    {
      row: 0,
      column: 0,
      value: { kind: "string", value: "Name" },
      displayText: "Name",
    },
    {
      row: 0,
      column: 1,
      value: { kind: "string", value: "Amount" },
      displayText: "Amount",
    },
    {
      row: 1,
      column: 0,
      value: { kind: "string", value: "Acme Corp" },
      displayText: "Acme Corp",
    },
    {
      row: 1,
      column: 1,
      value: { kind: "number", value: 1234.56 },
      displayText: "1234.56",
    },
    {
      row: 2,
      column: 0,
      value: { kind: "boolean", value: true },
      displayText: "TRUE",
    },
    {
      row: 3,
      column: 0,
      value: { kind: "number", value: 3 },
      formula: "SUM(B2:B3)",
      displayText: "3",
    },
    {
      row: 4,
      column: 0,
      value: { kind: "error", value: "#DIV/0!" },
      formula: "1/0",
      displayText: "#DIV/0!",
    },
    // A repeated text value — exercises shared-string deduplication (both cells must intern to the SAME index).
    {
      row: 5,
      column: 0,
      value: { kind: "string", value: "Acme Corp" },
      displayText: "Acme Corp",
    },
    // The anchor of a 2x2 merge.
    {
      row: 6,
      column: 0,
      value: { kind: "string", value: "Merged Cell" },
      displayText: "Merged Cell",
      colSpan: 2,
      rowSpan: 2,
    },
    // A cell containing text that needs XML escaping.
    {
      row: 8,
      column: 0,
      value: { kind: "string", value: "Tom & Jerry <b>" },
      displayText: "Tom & Jerry <b>",
    },
  ],
  columns: [
    { index: 0, widthPt: 100 },
    { index: 1, widthPt: 60, hidden: true },
  ],
  rows: [
    { index: 0, heightPt: 20 },
    { index: 9, heightPt: 15, hidden: true },
  ],
  images: [],
  printSettings: {
    pageSize: PAGE_SIZE_A4,
    margins: { topPt: 54, rightPt: 50.4, bottomPt: 54, leftPt: 50.4 },
    printRange: { startRow: 0, startColumn: 0, endRow: 9, endColumn: 1 },
    scalePercent: 125,
    repeatRows: { start: 0, end: 0 },
    repeatColumns: { start: 0, end: 0 },
    gridlines: true,
    headers: true,
    pageOrder: "overThenDown",
    manualBreaks: { rows: [DEDUPED_STRING_CELL_ROW], columns: [1] },
  },
};

const SUMMARY_SHEET: ContentSheet = {
  name: "Summary",
  cells: [
    {
      row: 0,
      column: 0,
      value: { kind: "number", value: 42 },
      displayText: "42",
    },
  ],
  columns: [],
  rows: [],
  images: [],
  printSettings: {
    pageSize: PAGE_SIZE_LETTER,
    margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
    fitToPages: { width: 1, height: 3 },
    gridlines: false,
    headers: false,
    pageOrder: "downThenOver",
  },
};

const DOCUMENT: ContentDocument = {
  kind: "spreadsheet",
  metadata: {
    title: "Kitchen Sink",
    author: "Test Suite",
    keywords: ["a", "b"],
    createdIso: "2026-07-31T00:00:00Z",
  },
  sheets: [KITCHEN_SINK_SHEET, SUMMARY_SHEET],
};

const DEFAULT_PRINT_SETTINGS: ContentSheet["printSettings"] = {
  pageSize: PAGE_SIZE_LETTER,
  margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
  gridlines: false,
  headers: false,
  pageOrder: "downThenOver",
};

function singleSheetDocument(cells: ContentSheet["cells"]): ContentDocument {
  return {
    kind: "spreadsheet",
    metadata: {},
    sheets: [
      {
        name: "Sheet1",
        cells,
        columns: [],
        rows: [],
        images: [],
        printSettings: DEFAULT_PRINT_SETTINGS,
      },
    ],
  };
}

function elementsOf(parent: XmlElement, tag: string): XmlElement[] {
  return parent.children.filter(
    (node): node is XmlElement => node.type === "element" && node.tag === tag,
  );
}

function childElement(parent: XmlElement, tag: string): XmlElement | undefined {
  return elementsOf(parent, tag)[0];
}

function requireChild(parent: XmlElement, tag: string): XmlElement {
  const child = childElement(parent, tag);
  if (child === undefined) {
    throw new Error(`expected a <${tag}> child of <${parent.tag}>`);
  }
  return child;
}

function attributeOf(element: XmlElement, name: string): string | undefined {
  return element.attributes.find((attribute) => attribute.name === name)?.value;
}

function styleSheetOf(pkg: Package): XmlElement {
  const styles = rootElement(pkg.parts["xl/styles.xml"]);
  if (styles === undefined) {
    throw new Error("expected xl/styles.xml to have a root element");
  }
  return styles;
}

// The <cellXfs><xf> a written cell's own `s` attribute resolves to — never cellXfs's first child, which is the table's own reserved default entry (always seeded at index 0 regardless of whether any cell uses it) rather than necessarily the cell being asked about.
function writtenCells(pkg: Package): Map<string, XmlElement> {
  const worksheet = rootElement(pkg.parts["xl/worksheets/sheet1.xml"]);
  if (worksheet === undefined) {
    throw new Error("expected a worksheet root element");
  }
  const sheetData = requireChild(worksheet, "sheetData");
  const cells = new Map<string, XmlElement>();
  for (const row of elementsOf(sheetData, "row")) {
    for (const cell of elementsOf(row, "c")) {
      const reference = attributeOf(cell, "r");
      if (reference !== undefined) {
        cells.set(reference, cell);
      }
    }
  }
  return cells;
}

function writtenCell(pkg: Package, reference: string): XmlElement {
  const cell = writtenCells(pkg).get(reference);
  if (cell === undefined) {
    throw new Error(`expected a written cell at ${reference}`);
  }
  return cell;
}

// The <v> text of a written cell, exactly as a consumer would read it.
function writtenValue(pkg: Package, reference: string): string {
  return requireChild(writtenCell(pkg, reference), "v")
    .children.map((node) => (node.type === "text" ? node.value : ""))
    .join("");
}

// The number format a written cell is displayed through: its own s index resolved through <cellXfs> and, for a custom id, through <numFmts>. Deliberately resolved from the produced XML rather than from the table that produced it, so these assertions check what a consumer actually reads.
function formatCodeOf(pkg: Package, reference: string): string | undefined {
  const styleIndex = Number(attributeOf(writtenCell(pkg, reference), "s"));
  const styles = styleSheetOf(pkg);
  const cellXfs = requireChild(styles, "cellXfs");
  const xf = elementsOf(cellXfs, "xf")[styleIndex];
  if (xf === undefined) {
    throw new Error(`expected a cellXfs entry at index ${styleIndex}`);
  }
  const numFmtId = attributeOf(xf, "numFmtId");
  const numFmts = childElement(styles, "numFmts");
  const declared = numFmts === undefined ? [] : elementsOf(numFmts, "numFmt");
  const match = declared.find(
    (numFmt) => attributeOf(numFmt, "numFmtId") === numFmtId,
  );
  return match === undefined
    ? BUILTIN_NUMBER_FORMATS.get(Number(numFmtId))
    : decodeEntities(attributeOf(match, "formatCode") ?? "");
}

describe("buildXlsxPackageFromContent: rejects a non-spreadsheet ContentDocument", () => {
  it("throws for a wordprocessing document", () => {
    const wrongKind: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [],
    };
    expect(() => buildXlsxPackageFromContent(wrongKind)).toThrow(/spreadsheet/);
  });
});

describe("buildXlsxPackageFromContent: produces a structurally valid xlsx package", () => {
  const pkg = buildXlsxPackageFromContent(DOCUMENT);

  it("writes every required OPC/SpreadsheetML part", () => {
    expect(Object.keys(pkg.parts).sort()).toEqual(
      [
        "[Content_Types].xml",
        "_rels/.rels",
        "docProps/app.xml",
        "docProps/core.xml",
        "xl/_rels/workbook.xml.rels",
        "xl/sharedStrings.xml",
        "xl/styles.xml",
        "xl/workbook.xml",
        "xl/worksheets/sheet1.xml",
        "xl/worksheets/sheet2.xml",
      ].sort(),
    );
  });

  it("round-trips through the lossless byte codec (encodePackage -> parsePackage -> byte-identical structure)", () => {
    const bytes = encodePackage(pkg);
    const reparsed = parsePackage(bytes);
    expect(reparsed).toEqual(pkg);
  });

  it("deduplicates a repeated string value into a single shared-string entry", () => {
    const sharedStrings = rootElement(pkg.parts["xl/sharedStrings.xml"]);
    if (sharedStrings === undefined) {
      throw new Error("expected xl/sharedStrings.xml to have a root element");
    }
    const siCount = sharedStrings.children.filter(
      (node) => node.type === "element" && node.tag === "si",
    ).length;
    // "Name", "Amount", "Acme Corp" (deduplicated across rows 1 and 5), "Merged Cell", "Tom & Jerry <b>" — 5 unique strings, not 6.
    const KITCHEN_SINK_UNIQUE_STRING_COUNT = 5;
    expect(siCount).toBe(KITCHEN_SINK_UNIQUE_STRING_COUNT);
  });

  it("writes a structurally complete xl/styles.xml in CT_Stylesheet element order, numFmts first", () => {
    const styles = rootElement(pkg.parts["xl/styles.xml"]);
    if (styles === undefined) {
      throw new Error("expected xl/styles.xml to have a root element");
    }
    const tags = styles.children
      .filter((node) => node.type === "element")
      .map((node) => node.tag);
    // numFmts is present because this sheet has a boolean cell, whose TRUE/FALSE display format is a custom one — see the number-format suite below for the no-custom-formats case.
    expect(tags).toEqual([
      "numFmts",
      "fonts",
      "fills",
      "borders",
      "cellStyleXfs",
      "cellXfs",
      "cellStyles",
    ]);
  });
});

describe("readXlsxContent(buildXlsxPackageFromContent(x)) round-trips real content", () => {
  const pkg = buildXlsxPackageFromContent(DOCUMENT);
  const roundTripped = readXlsxContent(pkg);
  if (roundTripped.kind !== "spreadsheet") {
    throw new Error("expected a spreadsheet ContentDocument");
  }
  const [data, summary] = roundTripped.sheets;
  if (data === undefined || summary === undefined) {
    throw new Error("expected both sheets to survive the round trip");
  }

  it("preserves sheet names and order", () => {
    expect(roundTripped.sheets.map((sheet) => sheet.name)).toEqual([
      "Data",
      "Summary",
    ]);
  });

  it("preserves every cell value kind, including the deduplicated shared string and the XML-special-character text", () => {
    expect(
      data.cells.find((cell) => cell.row === 0 && cell.column === 0)?.value,
    ).toEqual({ kind: "string", value: "Name" });
    expect(
      data.cells.find((cell) => cell.row === 1 && cell.column === 1)?.value,
    ).toEqual({ kind: "number", value: 1234.56 });
    expect(
      data.cells.find((cell) => cell.row === 2 && cell.column === 0)?.value,
    ).toEqual({ kind: "boolean", value: true });
    expect(
      data.cells.find(
        (cell) => cell.row === ERROR_CELL_ROW && cell.column === 0,
      )?.value,
    ).toEqual({ kind: "error", value: "#DIV/0!" });
    expect(
      data.cells.find(
        (cell) => cell.row === DEDUPED_STRING_CELL_ROW && cell.column === 0,
      )?.value,
    ).toEqual({ kind: "string", value: "Acme Corp" });
    expect(
      data.cells.find(
        (cell) => cell.row === ESCAPED_TEXT_CELL_ROW && cell.column === 0,
      )?.value,
    ).toEqual({ kind: "string", value: "Tom & Jerry <b>" });
  });

  it("preserves formulas", () => {
    expect(
      data.cells.find(
        (cell) => cell.row === FORMULA_CELL_ROW && cell.column === 0,
      )?.formula,
    ).toBe("SUM(B2:B3)");
    expect(
      data.cells.find(
        (cell) => cell.row === ERROR_CELL_ROW && cell.column === 0,
      )?.formula,
    ).toBe("1/0");
  });

  it("preserves the merged range as colSpan/rowSpan on the anchor cell", () => {
    const anchor = data.cells.find(
      (cell) => cell.row === MERGE_ANCHOR_ROW && cell.column === 0,
    );
    expect(anchor).toMatchObject({ colSpan: 2, rowSpan: 2 });
  });

  it("preserves column widths (within the documented approximation) and hidden flags", () => {
    const hiddenColumn = data.columns.find((column) => column.index === 1);
    expect(hiddenColumn?.hidden).toBe(true);
    const firstColumn = data.columns.find((column) => column.index === 0);
    // The fixture's own first column is 100pt (see KITCHEN_SINK_SHEET above); these bounds are deliberately loose, not exact, per units.ts's own documented round-trip caveat.
    const COLUMN_WIDTH_LOWER_BOUND_PT = 80;
    const COLUMN_WIDTH_UPPER_BOUND_PT = 120;
    expect(firstColumn?.widthPt).toBeGreaterThan(COLUMN_WIDTH_LOWER_BOUND_PT);
    expect(firstColumn?.widthPt).toBeLessThan(COLUMN_WIDTH_UPPER_BOUND_PT);
  });

  it("column widths converge to a fixed point rather than drifting on repeated read/write cycles (ExaDev/documents.js#953)", () => {
    // A dedicated document, not DOCUMENT above: DOCUMENT's own column widths (100pt/60pt) already reproduce write 2 byte-identically from write 2 onward even under the pre-fix rounding, so they would pass this assertion whether or not the fix is present and exercise nothing. These two widthPt values instead come from columnWidthCharsToPt(12.76) and columnWidthCharsToPt(9.7) — points equivalents of two of kitchen-sink.xlsx's own real, LibreOffice-authored stored widths (see content.test.ts's dataSheetColWidthAttrs suite) — independently re-verified to keep narrowing across multiple further write cycles under the pre-fix rounding (12.76 chars -> 12.64 -> 12.5 -> 12.36; 9.7 chars -> 9.64 -> 9.5 -> 9.36) rather than settling after the first.
    // The two real, LibreOffice-authored kitchen-sink.xlsx widths (chars) the comment above names.
    const LIBREOFFICE_COLUMN_WIDTH_CHARS_FIRST = 12.76;
    const LIBREOFFICE_COLUMN_WIDTH_CHARS_SECOND = 9.7;
    const drifting: ContentDocument = {
      kind: "spreadsheet",
      metadata: {},
      sheets: [
        {
          name: "Data",
          cells: [],
          columns: [
            {
              index: 0,
              widthPt: columnWidthCharsToPt(
                LIBREOFFICE_COLUMN_WIDTH_CHARS_FIRST,
              ),
            },
            {
              index: 1,
              widthPt: columnWidthCharsToPt(
                LIBREOFFICE_COLUMN_WIDTH_CHARS_SECOND,
              ),
            },
          ],
          rows: [],
          images: [],
          printSettings: {
            pageSize: PAGE_SIZE_A4,
            margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
            gridlines: true,
            headers: true,
            pageOrder: "downThenOver",
          },
        },
      ],
    };

    function colWidthAttrs(
      source: Package,
      path: string,
    ): (string | undefined)[] {
      const worksheet = rootElement(source.parts[path]);
      if (worksheet === undefined) {
        throw new Error(`expected ${path} to have a root element`);
      }
      const colsEl = childrenWithTag(worksheet, "cols")[0];
      if (colsEl === undefined) {
        return [];
      }
      return childrenWithTag(colsEl, "col").map((col) => attr(col, "width"));
    }

    const firstWritePkg = buildXlsxPackageFromContent(drifting); // write 1 — allowed to differ from write 2, since these widthPt values need not already land on the pixel grid the very first write snaps to
    const firstRead = readXlsxContent(firstWritePkg);
    if (firstRead.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }

    const secondWritePkg = buildXlsxPackageFromContent(firstRead); // write 2
    const secondRead = readXlsxContent(secondWritePkg);
    if (secondRead.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    const [secondData] = secondRead.sheets;
    if (secondData === undefined) {
      throw new Error("expected the first sheet to survive the second cycle");
    }

    const thirdWritePkg = buildXlsxPackageFromContent(secondRead); // write 3
    const thirdRead = readXlsxContent(thirdWritePkg);
    if (thirdRead.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    const [thirdData] = thirdRead.sheets;
    if (thirdData === undefined) {
      throw new Error("expected the first sheet to survive the third cycle");
    }

    expect(colWidthAttrs(thirdWritePkg, "xl/worksheets/sheet1.xml")).toEqual(
      colWidthAttrs(secondWritePkg, "xl/worksheets/sheet1.xml"),
    );
    expect(thirdData.columns).toEqual(secondData.columns);
  });

  it("preserves row heights and hidden flags", () => {
    // KITCHEN_SINK_SHEET's own row heights above.
    const FIRST_ROW_HEIGHT_PT = 20;
    const HIDDEN_ROW_INDEX = 9;
    const HIDDEN_ROW_HEIGHT_PT = 15;
    expect(data.rows.find((row) => row.index === 0)?.heightPt).toBe(
      FIRST_ROW_HEIGHT_PT,
    );
    const hiddenRow = data.rows.find((row) => row.index === HIDDEN_ROW_INDEX);
    expect(hiddenRow?.hidden).toBe(true);
    expect(hiddenRow?.heightPt).toBe(HIDDEN_ROW_HEIGHT_PT);
  });

  it("preserves print settings: page size, scale, gridlines/headers, page order, print range, repeat rows/columns, manual breaks", () => {
    // KITCHEN_SINK_SHEET's own scalePercent above.
    const KITCHEN_SINK_SCALE_PERCENT = 125;
    expect(data.printSettings.pageSize).toEqual(PAGE_SIZE_A4);
    expect(data.printSettings.scalePercent).toBe(KITCHEN_SINK_SCALE_PERCENT);
    expect(data.printSettings.fitToPages).toBeUndefined();
    expect(data.printSettings.gridlines).toBe(true);
    expect(data.printSettings.headers).toBe(true);
    expect(data.printSettings.pageOrder).toBe("overThenDown");
    expect(data.printSettings.printRange).toEqual({
      startRow: 0,
      startColumn: 0,
      endRow: 9,
      endColumn: 1,
    });
    expect(data.printSettings.repeatRows).toEqual({ start: 0, end: 0 });
    expect(data.printSettings.repeatColumns).toEqual({ start: 0, end: 0 });
    expect(data.printSettings.manualBreaks).toEqual({
      rows: [DEDUPED_STRING_CELL_ROW],
      columns: [1],
    });
  });

  it("preserves the Summary sheet's fit-to-page settings and Letter page size", () => {
    expect(summary.printSettings.pageSize).toEqual(PAGE_SIZE_LETTER);
    expect(summary.printSettings.fitToPages).toEqual({ width: 1, height: 3 });
    expect(summary.printSettings.scalePercent).toBeUndefined();
    expect(
      summary.cells.find((cell) => cell.row === 0 && cell.column === 0)?.value,
    ).toEqual({ kind: "number", value: 42 });
  });

  it("preserves document metadata", () => {
    expect(roundTripped.metadata.title).toBe("Kitchen Sink");
    expect(roundTripped.metadata.author).toBe("Test Suite");
    expect(roundTripped.metadata.keywords).toEqual(["a", "b"]);
  });
});

describe("buildXlsxPackageFromContent: an empty sheet with no cells/columns/rows still produces a structurally valid worksheet", () => {
  const emptyDocument: ContentDocument = {
    kind: "spreadsheet",
    metadata: {},
    sheets: [
      {
        name: "Empty",
        cells: [],
        columns: [],
        rows: [],
        images: [],
        printSettings: {
          pageSize: PAGE_SIZE_LETTER,
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          gridlines: false,
          headers: false,
          pageOrder: "downThenOver",
        },
      },
    ],
  };

  it('builds and round-trips without throwing, dimension falling back to "A1"', () => {
    const pkg = buildXlsxPackageFromContent(emptyDocument);
    const worksheet = rootElement(pkg.parts["xl/worksheets/sheet1.xml"]);
    if (worksheet === undefined) {
      throw new Error("expected a worksheet root element");
    }
    const dimension = worksheet.children.find(
      (node) => node.type === "element" && node.tag === "dimension",
    );
    expect(
      dimension?.type === "element"
        ? dimension.attributes.find((a) => a.name === "ref")?.value
        : undefined,
    ).toBe("A1");

    const roundTripped = readXlsxContent(pkg);
    if (roundTripped.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(roundTripped.sheets[0]?.cells).toEqual([]);
  });
});

// --- number formats: the write side of typed/xlsx/number-format.ts ------------------------------------------------

describe("buildXlsxPackageFromContent: writes a real number format for every value kind xlsx has no cell type for", () => {
  const pkg = buildXlsxPackageFromContent(
    singleSheetDocument([
      {
        row: 0,
        column: 0,
        value: { kind: "percentage", value: 0.4256 },
        displayText: "0.4256",
      },
      {
        row: 0,
        column: 1,
        value: { kind: "currency", value: 99.99, currency: "GBP" },
        displayText: "99.99",
      },
      {
        row: 0,
        column: 2,
        value: { kind: "currency", value: 12.5 },
        displayText: "12.5",
      },
      {
        row: 0,
        column: 3,
        value: { kind: "date", value: "2026-07-31" },
        displayText: "2026-07-31",
      },
      {
        row: 0,
        column: 4,
        value: { kind: "time", value: "14:30:00" },
        displayText: "14:30:00",
      },
      {
        row: 0,
        column: 5,
        value: { kind: "dateTime", value: "2026-07-31T14:30:00" },
        displayText: "2026-07-31T14:30:00",
      },
      {
        row: 0,
        column: 6,
        value: { kind: "boolean", value: true },
        displayText: "TRUE",
      },
      // A second boolean, to prove one format is interned rather than one per cell.
      {
        row: 0,
        column: 7,
        value: { kind: "boolean", value: false },
        displayText: "FALSE",
      },
      {
        row: 0,
        column: 8,
        value: { kind: "number", value: 42 },
        displayText: "42",
      },
    ]),
  );

  it("writes the built-in percentage and time formats by id, declaring no <numFmt> for either", () => {
    expect(formatCodeOf(pkg, "A1")).toBe("0.00%");
    expect(formatCodeOf(pkg, "E1")).toBe("h:mm:ss");
  });

  it("writes a currency's ISO code into the format itself, so it survives the way a bare symbol would not", () => {
    expect(formatCodeOf(pkg, "B1")).toBe("[$GBP]#,##0.00");
  });

  it("writes a currency with no ISO code as a plain amount format — a documented, deliberate loss of the money semantic", () => {
    expect(formatCodeOf(pkg, "C1")).toBe("#,##0.00");
  });

  it("writes ISO-ordered date and dateTime formats", () => {
    expect(formatCodeOf(pkg, "D1")).toBe("yyyy\\-mm\\-dd");
    expect(formatCodeOf(pkg, "F1")).toBe("yyyy\\-mm\\-dd hh:mm:ss");
  });

  it("writes the LibreOffice TRUE/FALSE boolean format, XML-encoded in the attribute and decoding back to the exact quoted-section code", () => {
    expect(formatCodeOf(pkg, "G1")).toBe('"TRUE";"TRUE";"FALSE"');
    const declared = elementsOf(
      requireChild(styleSheetOf(pkg), "numFmts"),
      "numFmt",
    ).map((numFmt) => attributeOf(numFmt, "formatCode"));
    expect(declared).toContain(
      "&quot;TRUE&quot;;&quot;TRUE&quot;;&quot;FALSE&quot;",
    );
  });

  it("interns one cell format per distinct number format, not one per cell, and leaves an unformatted cell at index 0", () => {
    expect(attributeOf(writtenCell(pkg, "G1"), "s")).toBe(
      attributeOf(writtenCell(pkg, "H1"), "s"),
    );
    expect(attributeOf(writtenCell(pkg, "I1"), "s")).toBe("0");
    // Seven distinct non-General formats across nine cells (percentage, GBP currency, plain amount, date, time, dateTime, boolean), plus the General default at index 0.
    const EXPECTED_DISTINCT_CELL_FORMAT_COUNT = 8;
    const cellXfs = requireChild(styleSheetOf(pkg), "cellXfs");
    expect(elementsOf(cellXfs, "xf").length).toBe(
      EXPECTED_DISTINCT_CELL_FORMAT_COUNT,
    );
    expect(attributeOf(cellXfs, "count")).toBe(
      `${EXPECTED_DISTINCT_CELL_FORMAT_COUNT}`,
    );
  });

  it("marks every non-General cell format applyNumberFormat, and never the General one", () => {
    const xfs = elementsOf(requireChild(styleSheetOf(pkg), "cellXfs"), "xf");
    expect(xfs.map((xf) => attributeOf(xf, "applyNumberFormat"))).toEqual([
      undefined,
      "true",
      "true",
      "true",
      "true",
      "true",
      "true",
      "true",
    ]);
  });

  it('writes a date/time/dateTime cell as a REAL SERIAL with no t attribute at all, never ST_CellType\'s t="d"', () => {
    for (const reference of ["D1", "E1", "F1"]) {
      expect(attributeOf(writtenCell(pkg, reference), "t")).toBeUndefined();
      expect(Number.isFinite(Number(writtenValue(pkg, reference)))).toBe(true);
    }
    // 46234 is the serial this package's own kitchen-sink fixture (a real LibreOffice export) stores for 2026-07-31; a time of day is the fraction-of-a-day part alone, and a dateTime the two summed.
    const DATE_SERIAL_2026_07_31 = 46234;
    const TIME_OF_DAY_HOURS = 14.5;
    const HOURS_PER_DAY = 24;
    // toBeCloseTo's own precision (decimal places), chosen per assertion for the floating-point tolerance each computation actually needs.
    const TIME_FRACTION_PRECISION_DIGITS = 12;
    const DATETIME_SUM_PRECISION_DIGITS = 9;
    expect(writtenValue(pkg, "D1")).toBe(`${DATE_SERIAL_2026_07_31}`);
    expect(Number(writtenValue(pkg, "E1"))).toBeCloseTo(
      TIME_OF_DAY_HOURS / HOURS_PER_DAY,
      TIME_FRACTION_PRECISION_DIGITS,
    );
    expect(Number(writtenValue(pkg, "F1"))).toBeCloseTo(
      DATE_SERIAL_2026_07_31 + TIME_OF_DAY_HOURS / HOURS_PER_DAY,
      DATETIME_SUM_PRECISION_DIGITS,
    );
  });

  it("round-trips every kind back through readXlsxContent, including the deliberate currency-without-a-code narrowing", () => {
    const roundTripped = readXlsxContent(pkg);
    if (roundTripped.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    const cells = roundTripped.sheets[0]?.cells ?? [];
    const valueAt = (column: number): unknown =>
      cells.find((cell) => cell.row === 0 && cell.column === column)?.value;
    // Row 0's own columns, in the order this describe block's own pkg fixture defines them below.
    const DATE_COLUMN = 3;
    const TIME_COLUMN = 4;
    const DATETIME_COLUMN = 5;
    const BOOLEAN_TRUE_COLUMN = 6;
    const BOOLEAN_FALSE_COLUMN = 7;
    const PLAIN_NUMBER_COLUMN = 8;
    expect(valueAt(0)).toEqual({ kind: "percentage", value: 0.4256 });
    expect(valueAt(1)).toEqual({
      kind: "currency",
      value: 99.99,
      currency: "GBP",
    });
    // The documented loss: nothing in '#,##0.00' says money, so a currency that named no ISO code comes back as the plain number it now looks like.
    expect(valueAt(2)).toEqual({ kind: "number", value: 12.5 });
    expect(valueAt(DATE_COLUMN)).toEqual({
      kind: "date",
      value: "2026-07-31",
    });
    // The bug this write side exists to fix: a time cell no longer collapses into a date/dateTime, because its serial and format distinguish it.
    expect(valueAt(TIME_COLUMN)).toEqual({ kind: "time", value: "14:30:00" });
    expect(valueAt(DATETIME_COLUMN)).toEqual({
      kind: "dateTime",
      value: "2026-07-31T14:30:00",
    });
    expect(valueAt(BOOLEAN_TRUE_COLUMN)).toEqual({
      kind: "boolean",
      value: true,
    });
    expect(valueAt(BOOLEAN_FALSE_COLUMN)).toEqual({
      kind: "boolean",
      value: false,
    });
    expect(valueAt(PLAIN_NUMBER_COLUMN)).toEqual({ kind: "number", value: 42 });
  });
});

describe("buildXlsxPackageFromContent: a temporal value with no valid serial degrades to text, never to a fabricated serial", () => {
  const pkg = buildXlsxPackageFromContent(
    singleSheetDocument([
      // An ODF-style duration rather than the canonical HH:MM:SS wall-clock spelling.
      {
        row: 0,
        column: 0,
        value: { kind: "time", value: "PT14H30M00S" },
        displayText: "PT14H30M00S",
      },
      // A calendar day that does not exist, and a date before the 1900 epoch — neither has a serial.
      {
        row: 0,
        column: 1,
        value: { kind: "date", value: "2026-02-30" },
        displayText: "2026-02-30",
      },
      {
        row: 0,
        column: 2,
        value: { kind: "date", value: "1850-01-01" },
        displayText: "1850-01-01",
      },
    ]),
  );

  it("writes each one as an ordinary shared-string cell carrying the original text verbatim", () => {
    for (const reference of ["A1", "B1", "C1"]) {
      expect(attributeOf(writtenCell(pkg, reference), "t")).toBe("s");
      expect(attributeOf(writtenCell(pkg, reference), "s")).toBe("0");
    }
    const roundTripped = readXlsxContent(pkg);
    if (roundTripped.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(
      (roundTripped.sheets[0]?.cells ?? []).map((cell) => cell.value),
    ).toEqual([
      { kind: "string", value: "PT14H30M00S" },
      { kind: "string", value: "2026-02-30" },
      { kind: "string", value: "1850-01-01" },
    ]);
  });

  it("declares no number formats at all, since nothing needing one was written", () => {
    expect(childElement(styleSheetOf(pkg), "numFmts")).toBeUndefined();
  });
});
