import { describe, expect, it } from "vitest";
import type { ContentDocument, ContentSheet } from "document-schema.js";
import { PAGE_SIZE_LETTER } from "document-schema.js";
import type { XmlElement } from "../../model/node";
import type { Package } from "../../model/package";
import { attr, childrenWithTag, rootElement, textContent } from "../util";
import { buildXlsxPackageFromContent } from "./build";
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
function SUMMARY_ONLY_DOCUMENT(): ContentDocument {
  return { kind: "spreadsheet", metadata: {}, sheets: [SUMMARY_SHEET] };
}

// --- print settings: margins, page setup, and manual breaks --------------------------------------------------------

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

  it("takes the larger of cells' and rows'/columns' own extents, not the smaller — a column/row entry past the last cell still widens the dimension", () => {
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
    // Only the literal cell interned into sharedStrings — the formula's own cached text did not.
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
  function pageSetupOf(
    pageSize: Readonly<{
      widthPt: number;
      heightPt: number;
    }>,
  ): XmlElement {
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
    // Two arbitrary, distinct row indices, asserted below by their own written ids ("3", "7").
    const FIRST_ROW_BREAK_INDEX = 3;
    const SECOND_ROW_BREAK_INDEX = 7;
    const pkg = pkgWithBreaks({
      rows: [FIRST_ROW_BREAK_INDEX, SECOND_ROW_BREAK_INDEX],
      columns: [],
    });
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
