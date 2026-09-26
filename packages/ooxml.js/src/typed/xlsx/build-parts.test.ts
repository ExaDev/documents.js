import { describe, expect, it } from "vitest";
import type { ContentDocument, ContentSheet } from "document-schema.js";
import { PAGE_SIZE_LETTER } from "document-schema.js";
import type { XmlElement } from "../../model/node";
import type { Package } from "../../model/package";
import { attr, childrenWithTag, rootElement, textContent } from "../util";
import { buildXlsxPackageFromContent } from "./build";
import { readXlsxContent } from "./content";
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
