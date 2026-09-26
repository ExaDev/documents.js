import { describe, expect, it } from "vitest";
import type { ContentDocument, ContentSheet } from "document-schema.js";
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
function cellXfFor(pkg: Package, reference: string): XmlElement {
  const index = Number(attributeOf(writtenCell(pkg, reference), "s") ?? "0");
  const xf = elementsOf(requireChild(styleSheetOf(pkg), "cellXfs"), "xf")[
    index
  ];
  if (xf === undefined) {
    throw new Error(`expected a <cellXfs><xf> at index ${index}`);
  }
  return xf;
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

describe("buildXlsxPackageFromContent: part roots, scope-keyed name suppression, and row/cell edge exactness", () => {
  it("writes each scaffolding part under its own root tag and namespace declaration", () => {
    const pkg = buildXlsxPackageFromContent({
      kind: "spreadsheet",
      metadata: { createdIso: "2026-09-16T08:00:00Z" },
      sheets: [emptySheetFixture("Sheet1")],
    });
    const types = rootElement(pkg.parts["[Content_Types].xml"]);
    expect(types?.tag).toBe("Types");
    expect(attr(types!, "xmlns")).toBe(
      "http://schemas.openxmlformats.org/package/2006/content-types",
    );
    const packageRels = rootElement(pkg.parts["_rels/.rels"]);
    expect(packageRels?.tag).toBe("Relationships");
    expect(attr(packageRels!, "xmlns")).toBe(
      "http://schemas.openxmlformats.org/package/2006/relationships",
    );
    const workbookRels = rootElement(pkg.parts["xl/_rels/workbook.xml.rels"]);
    expect(workbookRels?.tag).toBe("Relationships");
    expect(attr(workbookRels!, "xmlns")).toBe(
      "http://schemas.openxmlformats.org/package/2006/relationships",
    );
    const workbook = rootElement(pkg.parts["xl/workbook.xml"]);
    expect(workbook?.tag).toBe("workbook");
    expect(attr(workbook!, "xmlns:r")).toBe(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    );
    const sharedStrings = rootElement(pkg.parts["xl/sharedStrings.xml"]);
    expect(sharedStrings?.tag).toBe("sst");
    expect(attr(sharedStrings!, "xmlns")).toBe(
      "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    );
    const app = rootElement(pkg.parts["docProps/app.xml"]);
    expect(app?.tag).toBe("Properties");
    expect(attr(app!, "xmlns")).toBe(
      "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties",
    );
    const core = rootElement(pkg.parts["docProps/core.xml"]);
    expect(core?.tag).toBe("cp:coreProperties");
  });

  it("writes both timestamps with the W3CDTF type attribute", () => {
    const pkg = buildXlsxPackageFromContent({
      kind: "spreadsheet",
      metadata: {
        createdIso: "2026-09-16T08:00:00Z",
        modifiedIso: "2026-09-16T09:30:00Z",
      },
      sheets: [emptySheetFixture("Sheet1")],
    });
    const core = rootElement(pkg.parts["docProps/core.xml"]);
    if (core === undefined) {
      throw new Error("expected core properties root");
    }
    const created = elementsOf(core, "dcterms:created")[0]!;
    expect(attr(created, "xsi:type")).toBe("dcterms:W3CDTF");
    expect(textContent(created)).toBe("2026-09-16T08:00:00Z");
    const modified = elementsOf(core, "dcterms:modified")[0]!;
    expect(attr(modified, "xsi:type")).toBe("dcterms:W3CDTF");
    expect(textContent(modified)).toBe("2026-09-16T09:30:00Z");
  });

  it("suppresses a sheet's derived print area with a carried name scoped to that same non-zero sheet", () => {
    const pkg = buildXlsxPackageFromContent({
      kind: "spreadsheet",
      metadata: {},
      names: [
        {
          name: "_xlnm.Print_Area",
          refersTo: "Beta!$C$2:$D$4",
          scopeSheetIndex: 1,
        },
      ],
      sheets: [
        emptySheetFixture("Alpha"),
        {
          ...emptySheetFixture("Beta"),
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
    ).toEqual([["_xlnm.Print_Area", "1", "Beta!$C$2:$D$4"]]);
  });

  it("leaves a plain cell at the default style index with a single cellXfs entry, and gives a verticalAlignment-only cell its own xf", () => {
    const pkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "number", value: 1 },
          displayText: "1",
        },
        {
          row: 1,
          column: 0,
          value: { kind: "number", value: 2 },
          displayText: "2",
          verticalAlignment: "top",
        },
      ]),
    );
    expect(attributeOf(writtenCell(pkg, "A1"), "s")).toBe("0");
    const verticalIndex = attributeOf(writtenCell(pkg, "A2"), "s");
    expect(verticalIndex).not.toBe("0");
    const styles = styleSheetOf(pkg);
    const cellXfs = requireChild(styles, "cellXfs");
    const entries = elementsOf(cellXfs, "xf");
    expect(entries).toHaveLength(2);
    const verticalXf = entries[Number(verticalIndex)]!;
    expect(attributeOf(verticalXf, "applyAlignment")).toBe("true");
    const alignment = requireChild(verticalXf, "alignment");
    expect(attributeOf(alignment, "vertical")).toBe("top");
  });

  it("spells applyFont true on a fonted xf and maps a middle vertical alignment to xlsx's own center token", () => {
    const pkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "fonted" },
          displayText: "fonted",
          font: { bold: true },
        },
        {
          row: 1,
          column: 0,
          value: { kind: "string", value: "middle" },
          displayText: "middle",
          verticalAlignment: "middle",
        },
      ]),
    );
    const styles = styleSheetOf(pkg);
    const cellXfs = requireChild(styles, "cellXfs");
    const fontedIndex = Number(attributeOf(writtenCell(pkg, "A1"), "s"));
    const fonted = elementsOf(cellXfs, "xf")[fontedIndex]!;
    expect(attributeOf(fonted, "applyFont")).toBe("true");
    const middleIndex = Number(attributeOf(writtenCell(pkg, "A2"), "s"));
    const middle = elementsOf(cellXfs, "xf")[middleIndex]!;
    expect(attributeOf(requireChild(middle, "alignment"), "vertical")).toBe(
      "center",
    );
  });

  it("carries the dxfs count equal to its dxf entries for a styled conditional-format rule", () => {
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
    // Re-use the conditional-format vocabulary through the sheet field the builder reads.
    const pkgWithRule = buildXlsxPackageFromContent({
      kind: "spreadsheet",
      metadata: {},
      sheets: [
        {
          ...emptySheetFixture("Sheet1"),
          conditionalFormats: [
            {
              type: "cellIs",
              ranges: [
                { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 },
              ],
              priority: 1,
              operator: "greaterThan",
              formula1: "4",
              style: { textColor: { r: 1, g: 0, b: 0 } },
            },
          ],
        },
      ],
    });
    const styles = styleSheetOf(pkgWithRule);
    const dxfs = requireChild(styles, "dxfs");
    expect(attr(dxfs, "count")).toBe(String(elementsOf(dxfs, "dxf").length));
    expect(elementsOf(dxfs, "dxf").length).toBeGreaterThan(0);
    // A workbook with no styled rule writes no dxfs element at all (already covered elsewhere) — this fixture only supplies the count.
    expect(
      styleSheetOf(pkg).children.filter(
        (c) => c.type === "element" && c.tag === "dxfs",
      ),
    ).toHaveLength(0);
  });

  it("writes a row declared only hidden with no height attributes, and one declared only tall with no hidden attribute", () => {
    const pkg = buildXlsxPackageFromContent({
      kind: "spreadsheet",
      metadata: {},
      sheets: [
        {
          ...emptySheetFixture("Sheet1"),
          rows: [
            { index: 0, hidden: true },
            { index: 1, heightPt: 30 },
          ],
        },
      ],
    });
    const worksheet = rootElement(pkg.parts["xl/worksheets/sheet1.xml"]);
    if (worksheet === undefined) {
      throw new Error("expected worksheet root");
    }
    const rows = elementsOf(requireChild(worksheet, "sheetData"), "row");
    const hidden = rows.find((row) => attributeOf(row, "r") === "1")!;
    expect(attributeOf(hidden, "hidden")).toBe("true");
    expect(attributeOf(hidden, "ht")).toBeUndefined();
    expect(attributeOf(hidden, "customHeight")).toBeUndefined();
    const tall = rows.find((row) => attributeOf(row, "r") === "2")!;
    expect(attributeOf(tall, "ht")).toBe("30");
    expect(attributeOf(tall, "customHeight")).toBe("true");
    expect(attributeOf(tall, "hidden")).toBeUndefined();
  });

  it("treats a square page as portrait, since only a strictly wider page is landscape", () => {
    const pkg = buildXlsxPackageFromContent({
      kind: "spreadsheet",
      metadata: {},
      sheets: [
        {
          ...emptySheetFixture("Sheet1"),
          printSettings: {
            ...DEFAULT_PRINT_SETTINGS,
            pageSize: { widthPt: 200, heightPt: 200 },
          },
        },
      ],
    });
    const worksheet = rootElement(pkg.parts["xl/worksheets/sheet1.xml"]);
    if (worksheet === undefined) {
      throw new Error("expected worksheet root");
    }
    expect(attr(requireChild(worksheet, "pageSetup"), "orientation")).toBe(
      "portrait",
    );
  });

  it("writes no conditionalFormatting, dataValidations, or tableParts elements for a plain sheet", () => {
    const pkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "number", value: 1 },
          displayText: "1",
        },
      ]),
    );
    const worksheet = rootElement(pkg.parts["xl/worksheets/sheet1.xml"]);
    if (worksheet === undefined) {
      throw new Error("expected worksheet root");
    }
    expect(childrenWithTag(worksheet, "conditionalFormatting")).toHaveLength(0);
    expect(childrenWithTag(worksheet, "dataValidations")).toHaveLength(0);
    expect(childrenWithTag(worksheet, "tableParts")).toHaveLength(0);
  });
});

describe("buildXlsxPackageFromContent: xl/styles.xml and docProps facts pinned inside isolated per-test builds", () => {
  it("omits <numFmts> entirely for a workbook needing no custom number format", () => {
    const pkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "plain" },
          displayText: "plain",
        },
      ]),
    );
    const styles = styleSheetOf(pkg);
    expect(childElement(styles, "numFmts")).toBeUndefined();
    const xf = requireChild(requireChild(styles, "cellXfs"), "xf");
    expect(attributeOf(xf, "numFmtId")).toBe("0");
    expect(attributeOf(xf, "applyNumberFormat")).toBeUndefined();
  });

  it("keeps the reserved none/gray125 fills as a bare <patternFill patternType> with no fgColor/bgColor children", () => {
    const pkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "plain" },
          displayText: "plain",
        },
      ]),
    );
    const fills = elementsOf(requireChild(styleSheetOf(pkg), "fills"), "fill");
    const none = fills[0];
    const gray125 = fills[1];
    if (none === undefined || gray125 === undefined) {
      throw new Error("expected the two reserved <fill> entries");
    }
    const nonePatternFill = requireChild(none, "patternFill");
    expect(attributeOf(nonePatternFill, "patternType")).toBe("none");
    expect(nonePatternFill.children).toHaveLength(0);
    const gray125PatternFill = requireChild(gray125, "patternFill");
    expect(attributeOf(gray125PatternFill, "patternType")).toBe("gray125");
    expect(gray125PatternFill.children).toHaveLength(0);
  });

  it("writes a border's four edges and its always-bare diagonal in the fixed left/right/top/bottom/diagonal order, leaving an unset edge bare", () => {
    const pkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "bordered" },
          displayText: "bordered",
          borders: { top: { color: { r: 0, g: 1, b: 0 }, widthPt: 1.5 } },
        },
      ]),
    );
    const styles = styleSheetOf(pkg);
    const border = elementsOf(requireChild(styles, "borders"), "border")[1];
    if (border === undefined) {
      throw new Error("expected the interned <border> at index 1");
    }
    expect(
      border.children
        .filter((node): node is XmlElement => node.type === "element")
        .map((node) => node.tag),
    ).toEqual(["left", "right", "top", "bottom", "diagonal"]);
    const left = requireChild(border, "left");
    expect(attributeOf(left, "style")).toBeUndefined();
    expect(childElement(left, "color")).toBeUndefined();
    const top = requireChild(border, "top");
    expect(attributeOf(top, "style")).toBeDefined();
    const topColor = requireChild(top, "color");
    expect(attributeOf(topColor, "rgb")).toBe("FF00ff00");
  });

  it("writes a solid fill's own colour into fgColor, with bgColor always the reserved indexed=64 sentinel", () => {
    const pkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "filled" },
          displayText: "filled",
          background: { kind: "solid", color: { r: 1, g: 0, b: 1 } },
        },
      ]),
    );
    const fill = elementsOf(
      requireChild(styleSheetOf(pkg), "fills"),
      "fill",
    )[2];
    if (fill === undefined) {
      throw new Error("expected the interned solid <fill> at index 2");
    }
    expect(fill.tag).toBe("fill");
    const patternFill = requireChild(fill, "patternFill");
    expect(attributeOf(patternFill, "patternType")).toBe("solid");
    const fgColor = requireChild(patternFill, "fgColor");
    expect(attributeOf(fgColor, "rgb")).toBe("FFff00ff");
    const bgColor = requireChild(patternFill, "bgColor");
    expect(attributeOf(bgColor, "indexed")).toBe("64");
  });

  it("writes no bold/italic/strike/underline/colour element on a font with none of those set", () => {
    const pkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "plain" },
          displayText: "plain",
        },
      ]),
    );
    const font = requireChild(requireChild(styleSheetOf(pkg), "fonts"), "font");
    expect(childElement(font, "b")).toBeUndefined();
    expect(childElement(font, "i")).toBeUndefined();
    expect(childElement(font, "strike")).toBeUndefined();
    expect(childElement(font, "u")).toBeUndefined();
    expect(childElement(font, "color")).toBeUndefined();
  });

  it("writes every bold/italic/strike/underline/colour element on a font with all of them set", () => {
    const pkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "decorated" },
          displayText: "decorated",
          font: {
            bold: true,
            italic: true,
            strike: true,
            underline: true,
            color: { r: 0, g: 1, b: 0 },
          },
        },
      ]),
    );
    const styles = styleSheetOf(pkg);
    const font = elementsOf(requireChild(styles, "fonts"), "font")[1];
    if (font === undefined) {
      throw new Error("expected the decorated <font> at index 1");
    }
    expect(childElement(font, "b")).toBeDefined();
    expect(childElement(font, "i")).toBeDefined();
    expect(childElement(font, "strike")).toBeDefined();
    const underline = requireChild(font, "u");
    expect(attributeOf(underline, "val")).toBe("single");
    const color = requireChild(font, "color");
    expect(attributeOf(color, "rgb")).toBe("FF00ff00");
  });

  it("writes the reserved cellXfs xfId as the literal string zero", () => {
    const pkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "plain" },
          displayText: "plain",
        },
      ]),
    );
    expect(attributeOf(cellXfFor(pkg, "A1"), "xfId")).toBe("0");
  });

  it("sets applyNumberFormat only on an xf whose numFmtId is not the General one, and always to the literal true spelling", () => {
    const generalPkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "plain" },
          displayText: "plain",
        },
      ]),
    );
    expect(
      attributeOf(cellXfFor(generalPkg, "A1"), "applyNumberFormat"),
    ).toBeUndefined();

    const customFormatPkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "boolean", value: true },
          displayText: "TRUE",
        },
      ]),
    );
    expect(
      attributeOf(cellXfFor(customFormatPkg, "A1"), "applyNumberFormat"),
    ).toBe("true");
  });

  it("sets applyFont only on an xf whose fontId is not the default font", () => {
    const defaultFontPkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "plain" },
          displayText: "plain",
        },
      ]),
    );
    expect(
      attributeOf(cellXfFor(defaultFontPkg, "A1"), "applyFont"),
    ).toBeUndefined();

    const customFontPkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "styled" },
          displayText: "styled",
          font: { bold: true },
        },
      ]),
    );
    expect(attributeOf(cellXfFor(customFontPkg, "A1"), "applyFont")).toBe(
      "true",
    );
  });

  it("sets applyFill only on an xf whose fillId is not the reserved none fill", () => {
    const noFillPkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "plain" },
          displayText: "plain",
        },
      ]),
    );
    expect(
      attributeOf(cellXfFor(noFillPkg, "A1"), "applyFill"),
    ).toBeUndefined();

    const filledPkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "filled" },
          displayText: "filled",
          background: { kind: "solid", color: { r: 1, g: 0, b: 1 } },
        },
      ]),
    );
    expect(attributeOf(cellXfFor(filledPkg, "A1"), "applyFill")).toBe("true");
  });

  it("sets applyBorder only on an xf whose borderId is not the reserved empty border", () => {
    const noBorderPkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "plain" },
          displayText: "plain",
        },
      ]),
    );
    expect(
      attributeOf(cellXfFor(noBorderPkg, "A1"), "applyBorder"),
    ).toBeUndefined();

    const borderedPkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "bordered" },
          displayText: "bordered",
          borders: { top: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 } },
        },
      ]),
    );
    expect(attributeOf(cellXfFor(borderedPkg, "A1"), "applyBorder")).toBe(
      "true",
    );
  });

  it("writes a cell's own explicit horizontal alignment onto the inline <alignment> element", () => {
    const pkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "aligned" },
          displayText: "aligned",
          alignment: "center",
        },
      ]),
    );
    const alignment = requireChild(cellXfFor(pkg, "A1"), "alignment");
    expect(attributeOf(alignment, "horizontal")).toBe("center");
  });

  it("writes the styleSheet root under its own tag and the SpreadsheetML namespace", () => {
    const pkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "plain" },
          displayText: "plain",
        },
      ]),
    );
    const styles = styleSheetOf(pkg);
    expect(styles.tag).toBe("styleSheet");
    expect(attributeOf(styles, "xmlns")).toBe(
      "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    );
  });

  it("writes title, author, and every keyword joined by a comma-space into docProps/core.xml", () => {
    const pkg = buildXlsxPackageFromContent({
      kind: "spreadsheet",
      metadata: {
        title: "My Title",
        author: "My Author",
        keywords: ["one", "two"],
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
    const core = rootElement(pkg.parts["docProps/core.xml"]);
    if (core === undefined) {
      throw new Error("expected docProps/core.xml to have a root element");
    }
    expect(textContent(requireChild(core, "dc:title"))).toBe("My Title");
    expect(textContent(requireChild(core, "dc:creator"))).toBe("My Author");
    expect(textContent(requireChild(core, "cp:keywords"))).toBe("one, two");
  });

  it("declares all four required namespaces on docProps/core.xml's own root element", () => {
    const pkg = buildXlsxPackageFromContent({
      kind: "spreadsheet",
      metadata: { title: "T" },
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
    const core = rootElement(pkg.parts["docProps/core.xml"]);
    if (core === undefined) {
      throw new Error("expected docProps/core.xml to have a root element");
    }
    expect(attributeOf(core, "xmlns:cp")).toBe(
      "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
    );
    expect(attributeOf(core, "xmlns:dc")).toBe(
      "http://purl.org/dc/elements/1.1/",
    );
    expect(attributeOf(core, "xmlns:dcterms")).toBe(
      "http://purl.org/dc/terms/",
    );
    expect(attributeOf(core, "xmlns:xsi")).toBe(
      "http://www.w3.org/2001/XMLSchema-instance",
    );
  });

  it("writes the creator into docProps/app.xml's own <Application> element", () => {
    const pkg = buildXlsxPackageFromContent({
      kind: "spreadsheet",
      metadata: { creator: "My Creator" },
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
    const app = rootElement(pkg.parts["docProps/app.xml"]);
    if (app === undefined) {
      throw new Error("expected docProps/app.xml to have a root element");
    }
    expect(textContent(requireChild(app, "Application"))).toBe("My Creator");
  });

  it("writes the sheet's own gridlines/headers flags onto xl/worksheets/sheet1.xml's <printOptions>", () => {
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
            gridlines: true,
            headers: true,
          },
        },
      ],
    });
    const worksheet = rootElement(pkg.parts["xl/worksheets/sheet1.xml"]);
    if (worksheet === undefined) {
      throw new Error("expected a worksheet root element");
    }
    const printOptions = requireChild(worksheet, "printOptions");
    expect(printOptions.tag).toBe("printOptions");
    expect(attributeOf(printOptions, "gridLines")).toBe("true");
    expect(attributeOf(printOptions, "headings")).toBe("true");
  });
});
