import { describe, expect, it } from "vitest";
import type {
  ContentDefinedName,
  ContentDocument,
  ContentSheet,
} from "document-schema.js";
import { PAGE_SIZE_LETTER } from "document-schema.js";
import type { XmlElement } from "../../model/node";
import type { Package } from "../../model/package";
import { attr, childrenWithTag, rootElement, textContent } from "../util";
import { buildXlsxPackageFromContent } from "./build";
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

function writtenCell(pkg: Package, reference: string): XmlElement {
  const cell = writtenCells(pkg).get(reference);
  if (cell === undefined) {
    throw new Error(`expected a written cell at ${reference}`);
  }
  return cell;
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

describe("buildXlsxPackageFromContent: workbook, relationship, and shared-string part exactness", () => {
  function documentOfSheets(sheets: readonly ContentSheet[]): ContentDocument {
    return { kind: "spreadsheet", metadata: {}, sheets: [...sheets] };
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
    // One <b>, one <sz>, and one <name> child, and no more.
    const EXPECTED_FONT_CHILD_COUNT = 3;
    expect(
      elementsOf(arial, "b").length +
        elementsOf(arial, "sz").length +
        elementsOf(arial, "name").length,
    ).toBe(EXPECTED_FONT_CHILD_COUNT);
    expect(attr(requireChild(arial, "sz"), "val")).toBe("12");
    expect(attr(requireChild(arial, "name"), "val")).toBe("Arial");
  });
});

describe("buildXlsxPackageFromContent: the names array and the derived print names reconcile by name and scope", () => {
  function workbookWithNames(names: readonly ContentDefinedName[]): Package {
    return buildXlsxPackageFromContent({
      kind: "spreadsheet",
      metadata: {},
      names: [...names],
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

describe("buildXlsxPackageFromContent: bottom alignment and the exact minimal override set", () => {
  it("writes no vertical attribute at all for a bottom-aligned cell, the documented default", () => {
    const pkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "bottom" },
          displayText: "bottom",
          verticalAlignment: "bottom",
        },
      ]),
    );
    const styles = styleSheetOf(pkg);
    const cellXfs = requireChild(styles, "cellXfs");
    const index = Number(attributeOf(writtenCell(pkg, "A1"), "s"));
    const xf = elementsOf(cellXfs, "xf")[index]!;
    const alignment = requireChild(xf, "alignment");
    expect(attributeOf(alignment, "vertical")).toBeUndefined();
  });

  it("declares exactly the six overrides a minimal document carries, and nothing else", () => {
    const pkg = buildXlsxPackageFromContent({
      kind: "spreadsheet",
      metadata: {},
      sheets: [emptySheetFixture("Only")],
    });
    const types = rootElement(pkg.parts["[Content_Types].xml"]);
    if (types === undefined) {
      throw new Error("expected content types root");
    }
    expect(
      elementsOf(types, "Override").map((override) =>
        attributeOf(override, "PartName"),
      ),
    ).toEqual([
      "/xl/workbook.xml",
      "/xl/styles.xml",
      "/xl/sharedStrings.xml",
      "/xl/worksheets/sheet1.xml",
      "/docProps/core.xml",
      "/docProps/app.xml",
    ]);
  });
});

// Every build below constructs its own package inside its own it(), deliberately never sharing a describe-scoped const the way most of this file's other suites do: a describe body's own top-level statements run once during vitest's collection phase, before any individual test starts, so per-test mutation-coverage analysis cannot attribute that collection-time call to any specific it() — a mutation in code reached only that way can show up as a false survivor even though the assertions below it would catch the exact same change if coverage were attributed correctly. Isolating each build inside its own it() sidesteps that attribution gap entirely, on top of pinning several xl/styles.xml and docProps facts (dc:title/dc:creator/cp:keywords text, the printOptions flags) this file never asserted directly anywhere else.
