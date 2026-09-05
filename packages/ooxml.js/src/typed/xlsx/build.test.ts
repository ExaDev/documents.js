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

// buildXlsxPackageFromContent's own real-LibreOffice validation (`soffice --headless --convert-to ods` against a genuine built .xlsx, confirming Excel/LibreOffice actually open the file rather than merely well-formed XML) is a manual verification step, deliberately NOT wired into this vitest suite -- this package's CI runners have no LibreOffice installed (unlike documents.js's own gitignored, opt-in test:corpus project, which exists for exactly this reason: real-third-party-software checks that need a local tool this repo's CI can't assume). This suite instead verifies everything checkable in-process: the produced Package's own XML structure (parsed back through this package's own lossless parsePackage/encodePackage, never assumed), and that readXlsxContent(buildXlsxPackageFromContent(x)) round-trips the real content.

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
    // A repeated text value -- exercises shared-string deduplication (both cells must intern to the SAME index).
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
    manualBreaks: { rows: [5], columns: [1] },
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
    // "Name", "Amount", "Acme Corp" (deduplicated across rows 1 and 5), "Merged Cell", "Tom & Jerry <b>" -- 5 unique strings, not 6.
    expect(siCount).toBe(5);
  });

  it("writes a structurally complete xl/styles.xml in CT_Stylesheet element order, numFmts first", () => {
    const styles = rootElement(pkg.parts["xl/styles.xml"]);
    if (styles === undefined) {
      throw new Error("expected xl/styles.xml to have a root element");
    }
    const tags = styles.children
      .filter((node) => node.type === "element")
      .map((node) => node.tag);
    // numFmts is present because this sheet has a boolean cell, whose TRUE/FALSE display format is a custom one -- see the number-format suite below for the no-custom-formats case.
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
      data.cells.find((cell) => cell.row === 4 && cell.column === 0)?.value,
    ).toEqual({ kind: "error", value: "#DIV/0!" });
    expect(
      data.cells.find((cell) => cell.row === 5 && cell.column === 0)?.value,
    ).toEqual({ kind: "string", value: "Acme Corp" });
    expect(
      data.cells.find((cell) => cell.row === 8 && cell.column === 0)?.value,
    ).toEqual({ kind: "string", value: "Tom & Jerry <b>" });
  });

  it("preserves formulas", () => {
    expect(
      data.cells.find((cell) => cell.row === 3 && cell.column === 0)?.formula,
    ).toBe("SUM(B2:B3)");
    expect(
      data.cells.find((cell) => cell.row === 4 && cell.column === 0)?.formula,
    ).toBe("1/0");
  });

  it("preserves the merged range as colSpan/rowSpan on the anchor cell", () => {
    const anchor = data.cells.find(
      (cell) => cell.row === 6 && cell.column === 0,
    );
    expect(anchor).toMatchObject({ colSpan: 2, rowSpan: 2 });
  });

  it("preserves column widths (within the documented approximation) and hidden flags", () => {
    const hiddenColumn = data.columns.find((column) => column.index === 1);
    expect(hiddenColumn?.hidden).toBe(true);
    const firstColumn = data.columns.find((column) => column.index === 0);
    expect(firstColumn?.widthPt).toBeGreaterThan(80); // approximate, not exact -- see units.ts's own documented round-trip caveat
    expect(firstColumn?.widthPt).toBeLessThan(120);
  });

  it("column widths converge to a fixed point rather than drifting on repeated read/write cycles (ExaDev/documents.js#953)", () => {
    // A dedicated document, not DOCUMENT above: DOCUMENT's own column widths (100pt/60pt) already reproduce write 2 byte-identically from write 2 onward even under the pre-fix rounding, so they would pass this assertion whether or not the fix is present and exercise nothing. These two widthPt values instead come from columnWidthCharsToPt(12.76) and columnWidthCharsToPt(9.7) -- points equivalents of two of kitchen-sink.xlsx's own real, LibreOffice-authored stored widths (see content.test.ts's dataSheetColWidthAttrs suite) -- independently re-verified to keep narrowing across multiple further write cycles under the pre-fix rounding (12.76 chars -> 12.64 -> 12.5 -> 12.36; 9.7 chars -> 9.64 -> 9.5 -> 9.36) rather than settling after the first.
    const drifting: ContentDocument = {
      kind: "spreadsheet",
      metadata: {},
      sheets: [
        {
          name: "Data",
          cells: [],
          columns: [
            { index: 0, widthPt: columnWidthCharsToPt(12.76) },
            { index: 1, widthPt: columnWidthCharsToPt(9.7) },
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

    const firstWritePkg = buildXlsxPackageFromContent(drifting); // write 1 -- allowed to differ from write 2, since these widthPt values need not already land on the pixel grid the very first write snaps to
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
    expect(data.rows.find((row) => row.index === 0)?.heightPt).toBe(20);
    const hiddenRow = data.rows.find((row) => row.index === 9);
    expect(hiddenRow?.hidden).toBe(true);
    expect(hiddenRow?.heightPt).toBe(15);
  });

  it("preserves print settings: page size, scale, gridlines/headers, page order, print range, repeat rows/columns, manual breaks", () => {
    expect(data.printSettings.pageSize).toEqual(PAGE_SIZE_A4);
    expect(data.printSettings.scalePercent).toBe(125);
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
      rows: [5],
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

// Every written cell of the first worksheet, keyed by its own A1 reference.
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

  it("writes a currency with no ISO code as a plain amount format -- a documented, deliberate loss of the money semantic", () => {
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
    const cellXfs = requireChild(styleSheetOf(pkg), "cellXfs");
    expect(elementsOf(cellXfs, "xf").length).toBe(8);
    expect(attributeOf(cellXfs, "count")).toBe("8");
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
    expect(writtenValue(pkg, "D1")).toBe("46234");
    expect(Number(writtenValue(pkg, "E1"))).toBeCloseTo(14.5 / 24, 12);
    expect(Number(writtenValue(pkg, "F1"))).toBeCloseTo(46234 + 14.5 / 24, 9);
  });

  it("round-trips every kind back through readXlsxContent, including the deliberate currency-without-a-code narrowing", () => {
    const roundTripped = readXlsxContent(pkg);
    if (roundTripped.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    const cells = roundTripped.sheets[0]?.cells ?? [];
    const valueAt = (column: number): unknown =>
      cells.find((cell) => cell.row === 0 && cell.column === column)?.value;
    expect(valueAt(0)).toEqual({ kind: "percentage", value: 0.4256 });
    expect(valueAt(1)).toEqual({
      kind: "currency",
      value: 99.99,
      currency: "GBP",
    });
    // The documented loss: nothing in '#,##0.00' says money, so a currency that named no ISO code comes back as the plain number it now looks like.
    expect(valueAt(2)).toEqual({ kind: "number", value: 12.5 });
    expect(valueAt(3)).toEqual({ kind: "date", value: "2026-07-31" });
    // The bug this write side exists to fix: a time cell no longer collapses into a date/dateTime, because its serial and format distinguish it.
    expect(valueAt(4)).toEqual({ kind: "time", value: "14:30:00" });
    expect(valueAt(5)).toEqual({
      kind: "dateTime",
      value: "2026-07-31T14:30:00",
    });
    expect(valueAt(6)).toEqual({ kind: "boolean", value: true });
    expect(valueAt(7)).toEqual({ kind: "boolean", value: false });
    expect(valueAt(8)).toEqual({ kind: "number", value: 42 });
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
      // A calendar day that does not exist, and a date before the 1900 epoch -- neither has a serial.
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

describe("buildXlsxPackageFromContent: a workbook needing no number formats writes the same minimal styles part it always did", () => {
  const pkg = buildXlsxPackageFromContent(
    singleSheetDocument([
      {
        row: 0,
        column: 0,
        value: { kind: "string", value: "Name" },
        displayText: "Name",
      },
      {
        row: 0,
        column: 1,
        value: { kind: "number", value: 1234.56 },
        displayText: "1234.56",
      },
      {
        row: 0,
        column: 2,
        value: { kind: "error", value: "#DIV/0!" },
        displayText: "#DIV/0!",
      },
    ]),
  );

  it("omits <numFmts> entirely and writes exactly one General cellXfs entry", () => {
    const styles = styleSheetOf(pkg);
    const tags = styles.children
      .filter((node) => node.type === "element")
      .map((node) => node.tag);
    expect(tags).toEqual([
      "fonts",
      "fills",
      "borders",
      "cellStyleXfs",
      "cellXfs",
      "cellStyles",
    ]);
    const cellXfs = requireChild(styles, "cellXfs");
    expect(attributeOf(cellXfs, "count")).toBe("1");
    expect(
      elementsOf(cellXfs, "xf").map((xf) => attributeOf(xf, "numFmtId")),
    ).toEqual(["0"]);
    expect(
      elementsOf(cellXfs, "xf").map((xf) =>
        attributeOf(xf, "applyNumberFormat"),
      ),
    ).toEqual([undefined]);
  });
});

describe('buildXlsxPackageFromContent: a formula cell with a cached STRING result writes t="str" literally, never shared-string-indexed', () => {
  const document: ContentDocument = {
    kind: "spreadsheet",
    metadata: {},
    sheets: [
      {
        name: "Sheet1",
        cells: [
          {
            row: 0,
            column: 0,
            value: { kind: "string", value: "ab" },
            formula: 'CONCATENATE("a","b")',
            displayText: "ab",
          },
        ],
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

  it('writes t="str" with a literal <v>, not a shared-string index, and the sharedStrings table stays empty', () => {
    const pkg = buildXlsxPackageFromContent(document);
    const worksheet = rootElement(pkg.parts["xl/worksheets/sheet1.xml"]);
    if (worksheet === undefined) {
      throw new Error("expected a worksheet root element");
    }
    const sheetData = worksheet.children.find(
      (node) => node.type === "element" && node.tag === "sheetData",
    );
    const row =
      sheetData?.type === "element"
        ? sheetData.children.find(
            (node) => node.type === "element" && node.tag === "row",
          )
        : undefined;
    const cell =
      row?.type === "element"
        ? row.children.find(
            (node) => node.type === "element" && node.tag === "c",
          )
        : undefined;
    expect(
      cell?.type === "element"
        ? cell.attributes.find((a) => a.name === "t")?.value
        : undefined,
    ).toBe("str");

    const sharedStrings = rootElement(pkg.parts["xl/sharedStrings.xml"]);
    expect(
      sharedStrings?.attributes.find((a) => a.name === "count")?.value,
    ).toBe("0");

    const roundTripped = readXlsxContent(pkg);
    if (roundTripped.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(roundTripped.sheets[0]?.cells[0]).toMatchObject({
      value: { kind: "string", value: "ab" },
      formula: 'CONCATENATE("a","b")',
    });
  });
});

// Cell decoration (background/borders/alignment/verticalAlignment) is interned into the same cellXfs table as the number format and emitted as real <fills>/<borders>/<alignment>. This describes a round trip through buildXlsxPackageFromContent -> readXlsxContent, asserting both the written XML structure and the read-back ContentSheetCell fields, since the kitchen-sink ContentSheet above carries no decoration at all.
const DECORATED_SHEET: ContentSheet = {
  name: "Decorated",
  cells: [
    {
      row: 0,
      column: 0,
      value: { kind: "string", value: "Header" },
      displayText: "Header",
      background: { r: 1, g: 0, b: 0 },
      borders: {
        left: { color: { r: 0, g: 0, b: 0 }, widthPt: 0.75 },
        right: { color: { r: 0, g: 0, b: 0 }, widthPt: 0.75 },
        top: { color: { r: 0, g: 0, b: 0 }, widthPt: 0.75 },
        bottom: { color: { r: 0, g: 0, b: 0 }, widthPt: 0.75 },
      },
      alignment: "center",
      verticalAlignment: "middle",
    },
    {
      row: 1,
      column: 0,
      value: { kind: "number", value: 42 },
      displayText: "42",
      background: { r: 1, g: 1, b: 0 },
    },
  ],
  columns: [],
  rows: [],
  images: [],
  printSettings: {
    pageSize: PAGE_SIZE_A4,
    margins: { topPt: 36, rightPt: 36, bottomPt: 36, leftPt: 36 },
    gridlines: true,
    headers: true,
    pageOrder: "downThenOver",
  },
};

describe("buildXlsxPackageFromContent: writes cell decoration (fills/borders/alignment) into xl/styles.xml", () => {
  const pkg = buildXlsxPackageFromContent({
    kind: "spreadsheet",
    metadata: {
      title: undefined,
      author: undefined,
      subject: undefined,
      keywords: undefined,
      creator: undefined,
      producer: undefined,
      createdIso: undefined,
      modifiedIso: undefined,
    },
    sheets: [DECORATED_SHEET],
  });
  const styles = rootElement(pkg.parts["xl/styles.xml"]);
  if (styles === undefined) {
    throw new Error("expected xl/styles.xml to have a root element");
  }
  // Required-element accessor: the structure below is asserted to exist by the test's own intent, so a missing element is a genuine test failure (thrown here) rather than a silently-skipped assertion.
  const required = (
    element: XmlElement | undefined,
    message: string,
  ): XmlElement => {
    if (element === undefined) {
      throw new Error(message);
    }
    return element;
  };

  it("writes the two reserved fills (none/gray125) before the solid fills, one per distinct background colour", () => {
    const fillsEl = required(
      childrenWithTag(styles, "fills")[0],
      "expected a <fills> element",
    );
    const fills = childrenWithTag(fillsEl, "fill");
    expect(fills).toHaveLength(4); // none, gray125, red, yellow
    const patternType = (fill: XmlElement | undefined): string | undefined =>
      fill === undefined
        ? undefined
        : childrenWithTag(fill, "patternFill")[0]?.attributes.find(
            (a) => a.name === "patternType",
          )?.value;
    expect(patternType(fills[0])).toBe("none");
    expect(patternType(fills[1])).toBe("gray125");
    expect(patternType(fills[2])).toBe("solid");
    const solidFill = required(fills[2], "expected a solid <fill> at index 2");
    const solidRed = required(
      childrenWithTag(solidFill, "patternFill")[0],
      "expected a <patternFill>",
    );
    expect(
      childrenWithTag(solidRed, "fgColor")[0]?.attributes.find(
        (a) => a.name === "rgb",
      )?.value,
    ).toBe("FFff0000");
  });

  it("writes the reserved empty border at index 0, then the real per-edge border", () => {
    const bordersEl = required(
      childrenWithTag(styles, "borders")[0],
      "expected a <borders> element",
    );
    const borders = childrenWithTag(bordersEl, "border");
    expect(borders).toHaveLength(2);
    const reservedBorder = required(
      borders[0],
      "expected a reserved <border> at index 0",
    );
    const realBorder = required(
      borders[1],
      "expected a real <border> at index 1",
    );
    // reserved empty: every edge present but with no style attribute
    const reservedLeft = childrenWithTag(reservedBorder, "left")[0];
    expect(
      reservedLeft?.attributes.find((a) => a.name === "style"),
    ).toBeUndefined();
    // real border: four thin edges with black colour
    const realLeft = required(
      childrenWithTag(realBorder, "left")[0],
      "expected a real <left>",
    );
    expect(realLeft.attributes.find((a) => a.name === "style")?.value).toBe(
      "thin",
    );
    expect(
      childrenWithTag(realLeft, "color")[0]?.attributes.find(
        (a) => a.name === "rgb",
      )?.value,
    ).toBe("FF000000");
  });

  it("writes applyFill/applyBorder/applyAlignment and an inline <alignment> on the decorated xf", () => {
    const cellXfsEl = required(
      childrenWithTag(styles, "cellXfs")[0],
      "expected a <cellXfs> element",
    );
    const xfs = childrenWithTag(cellXfsEl, "xf");
    // xf[0] = default General/no-decoration; xf[1] = red + bordered + centred; xf[2] = yellow only
    const decorated = required(xfs[1], "expected a decorated <xf> at index 1");
    const attrs = decorated.attributes.map((a) => a.name);
    expect(attrs).toContain("applyFill");
    expect(attrs).toContain("applyBorder");
    expect(attrs).toContain("applyAlignment");
    const alignment = childrenWithTag(decorated, "alignment")[0];
    expect(
      alignment?.attributes.find((a) => a.name === "horizontal")?.value,
    ).toBe("center");
    expect(
      alignment?.attributes.find((a) => a.name === "vertical")?.value,
    ).toBe("center");
  });
});

describe("readXlsxContent(buildXlsxPackageFromContent(x)) round-trips cell decoration", () => {
  const pkg = buildXlsxPackageFromContent({
    kind: "spreadsheet",
    metadata: {
      title: undefined,
      author: undefined,
      subject: undefined,
      keywords: undefined,
      creator: undefined,
      producer: undefined,
      createdIso: undefined,
      modifiedIso: undefined,
    },
    sheets: [DECORATED_SHEET],
  });
  const result = readXlsxContent(pkg);
  if (result.kind !== "spreadsheet") {
    throw new Error("expected a spreadsheet ContentDocument");
  }
  const cells = result.sheets[0]?.cells ?? [];

  it("preserves a cell background colour through the round trip", () => {
    expect(cells[0]?.background).toEqual({ r: 1, g: 0, b: 0 });
    expect(cells[1]?.background).toEqual({ r: 1, g: 1, b: 0 });
  });

  it("preserves per-edge borders, recovering the same thin solid width the writer emitted", () => {
    const borders = cells[0]?.borders;
    expect(borders?.left).toEqual({
      color: { r: 0, g: 0, b: 0 },
      widthPt: 0.75,
    });
    expect(borders?.right).toEqual({
      color: { r: 0, g: 0, b: 0 },
      widthPt: 0.75,
    });
    expect(borders?.top).toEqual({
      color: { r: 0, g: 0, b: 0 },
      widthPt: 0.75,
    });
    expect(borders?.bottom).toEqual({
      color: { r: 0, g: 0, b: 0 },
      widthPt: 0.75,
    });
  });

  it('preserves horizontal and vertical alignment (middle round-trips through xlsx "center")', () => {
    expect(cells[0]?.alignment).toBe("center");
    expect(cells[0]?.verticalAlignment).toBe("middle");
  });
});
