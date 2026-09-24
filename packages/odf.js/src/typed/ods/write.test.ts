import { describe, expect, it } from "vitest";
import type {
  ContentDocument,
  ContentSheet,
  ContentSheetCell,
} from "document-schema.js";
import { PAGE_SIZE_A4 } from "document-schema.js";
import type { XmlElement } from "../../model/node";
import type { Package } from "../../model/package";
import {
  attrValue,
  childrenWithTag,
  findChildElement,
  rootElement,
} from "../../xml/query";
import { readManifest } from "../../manifest";
import { readMimetype } from "../../mimetype";
import { decodeXmlText } from "../../xml/entities";
import { buildXml } from "../../xml/build";
import {
  writeOdsContent,
  canonicalColor,
  canonicalCellFill,
  canonicalRun,
  canonicalCellValue,
  canonicalCell,
  canonicalCells,
  canonicalColumns,
  canonicalRows,
  canonicalSheetImage,
  canonicalImages,
  canonicalPrintSettings,
  canonicalDataValidations,
  canonicalConditionalFormatStyle,
  canonicalConditionalFormats,
} from "./write";

// The write side's XML-shape suite: what writeOdsContent actually emits, construct by construct — the sibling suite (write-round-trip.test.ts) proves the output reads back as the document it came from; this one proves the output is the ODF a real consumer expects, which a round trip through this package's own reader cannot (a writer and reader that agreed on the same wrong spelling would round-trip perfectly and open nowhere). This mirrors typed/odt/write.test.ts's own stated split of responsibility.

const MARGINS = { topPt: 36, rightPt: 36, bottomPt: 36, leftPt: 36 };

const DEFAULT_PRINT_SETTINGS = {
  pageSize: PAGE_SIZE_A4,
  margins: MARGINS,
  gridlines: false,
  headers: false,
  pageOrder: "downThenOver" as const,
};

function sheetOf(
  cells: readonly ContentSheetCell[],
  overrides: Partial<ContentSheet> = {},
): ContentSheet {
  return {
    name: "Sheet1",
    cells: [...cells],
    columns: [],
    rows: [],
    images: [],
    printSettings: DEFAULT_PRINT_SETTINGS,
    ...overrides,
  };
}

function documentOf(sheets: readonly ContentSheet[]): ContentDocument {
  return { kind: "spreadsheet", metadata: {}, sheets: [...sheets] };
}

function partRoot(pkg: Package, path: string): XmlElement {
  const part = pkg.parts[path];
  if (part?.kind !== "xml") {
    throw new Error(`expected an XML part at ${path}`);
  }
  const root = rootElement(part.nodes);
  if (root === undefined) {
    throw new Error(`expected a root element in ${path}`);
  }
  return root;
}

function firstTable(pkg: Package): XmlElement {
  const body = findChildElement(
    partRoot(pkg, "content.xml").children,
    "office:body",
  );
  const spreadsheet =
    body === undefined
      ? undefined
      : findChildElement(body.children, "office:spreadsheet");
  const table =
    spreadsheet === undefined
      ? undefined
      : childrenWithTag(spreadsheet, "table:table")[0];
  if (table === undefined) {
    throw new Error("expected office:body/office:spreadsheet/table:table");
  }
  return table;
}

function contentValidations(pkg: Package): XmlElement {
  const body = findChildElement(
    partRoot(pkg, "content.xml").children,
    "office:body",
  );
  const spreadsheet =
    body === undefined
      ? undefined
      : findChildElement(body.children, "office:spreadsheet");
  const container =
    spreadsheet === undefined
      ? undefined
      : findChildElement(spreadsheet.children, "table:content-validations");
  if (container === undefined) {
    throw new Error(
      "expected office:body/office:spreadsheet/table:content-validations",
    );
  }
  return container;
}

function contentAutomaticStyles(pkg: Package): XmlElement {
  const container = findChildElement(
    partRoot(pkg, "content.xml").children,
    "office:automatic-styles",
  );
  if (container === undefined) {
    throw new Error("expected content.xml office:automatic-styles");
  }
  return container;
}

function stylesAutomaticStyles(pkg: Package): XmlElement {
  const container = findChildElement(
    partRoot(pkg, "styles.xml").children,
    "office:automatic-styles",
  );
  if (container === undefined) {
    throw new Error("expected styles.xml office:automatic-styles");
  }
  return container;
}

function firstCell(pkg: Package): XmlElement {
  return childrenWithTag(
    childrenWithTag(firstTable(pkg), "table:table-row")[0]!,
    "table:table-cell",
  )[0]!;
}

function masterStyles(pkg: Package): XmlElement {
  const container = findChildElement(
    partRoot(pkg, "styles.xml").children,
    "office:master-styles",
  );
  if (container === undefined) {
    throw new Error("expected styles.xml office:master-styles");
  }
  return container;
}

describe("writeOdsContent: package structure", () => {
  it("declares the spreadsheet media type", () => {
    const pkg = writeOdsContent(documentOf([sheetOf([])]));
    expect(readMimetype(pkg)).toBe(
      "application/vnd.oasis.opendocument.spreadsheet",
    );
  });

  it("declares the template media type, in both the mimetype part and the manifest root entry, when template is requested", () => {
    const template = writeOdsContent(documentOf([sheetOf([])]), {
      template: true,
    });
    expect(readMimetype(template)).toBe(
      "application/vnd.oasis.opendocument.spreadsheet-template",
    );
    expect(
      readManifest(template).entries.find((entry) => entry.fullPath === "/")
        ?.mediaType,
    ).toBe("application/vnd.oasis.opendocument.spreadsheet-template");
  });
});

describe("writeOdsContent XML shapes", () => {
  it("writes a plain number cell as office:value-type='float' with office:value", () => {
    const pkg = writeOdsContent(
      documentOf([
        sheetOf([
          {
            row: 0,
            column: 0,
            value: { kind: "number", value: 42 },
            displayText: "42",
          },
        ]),
      ]),
    );
    const cell = childrenWithTag(
      childrenWithTag(firstTable(pkg), "table:table-row")[0]!,
      "table:table-cell",
    )[0]!;
    expect(attrValue(cell, "office:value-type")).toBe("float");
    expect(attrValue(cell, "office:value")).toBe("42");
  });

  it("writes a time cell's office:time-value as a real ODF xsd:duration, not the ISO clock string", () => {
    const pkg = writeOdsContent(
      documentOf([
        sheetOf([
          {
            row: 0,
            column: 0,
            value: { kind: "time", value: "13:30:05" },
            displayText: "13:30:05",
          },
        ]),
      ]),
    );
    const cell = childrenWithTag(
      childrenWithTag(firstTable(pkg), "table:table-row")[0]!,
      "table:table-cell",
    )[0]!;
    expect(attrValue(cell, "office:value-type")).toBe("time");
    expect(attrValue(cell, "office:time-value")).toBe("PT13H30M5S");
  });

  it("writes a merged cell's table:number-columns-spanned/-rows-spanned and covers the rest with table:covered-table-cell", () => {
    const pkg = writeOdsContent(
      documentOf([
        sheetOf([
          {
            row: 0,
            column: 0,
            value: { kind: "string", value: "Merged" },
            displayText: "Merged",
            colSpan: 2,
            rowSpan: 2,
          },
        ]),
      ]),
    );
    const rows = childrenWithTag(firstTable(pkg), "table:table-row");
    const firstRowCell = childrenWithTag(rows[0]!, "table:table-cell")[0]!;
    expect(attrValue(firstRowCell, "table:number-columns-spanned")).toBe("2");
    expect(attrValue(firstRowCell, "table:number-rows-spanned")).toBe("2");
    expect(childrenWithTag(rows[0]!, "table:covered-table-cell")).toHaveLength(
      1,
    );
    // Row 1 is fully covered (both columns 0 and 1 sit under the merge), so the two adjacent covered positions collapse into one table:covered-table-cell carrying a repeat count, mirroring how this writer compresses any other run of identical adjacent cells.
    const secondRowCovered = childrenWithTag(
      rows[1]!,
      "table:covered-table-cell",
    );
    expect(secondRowCovered).toHaveLength(1);
    expect(
      attrValue(secondRowCovered[0]!, "table:number-columns-repeated"),
    ).toBe("2");
  });

  it("compresses a long run of empty gap cells into one table:number-columns-repeated filler", () => {
    const pkg = writeOdsContent(
      documentOf([
        sheetOf([
          {
            row: 0,
            column: 0,
            value: { kind: "number", value: 1 },
            displayText: "1",
          },
          {
            row: 0,
            column: 20,
            value: { kind: "number", value: 2 },
            displayText: "2",
          },
        ]),
      ]),
    );
    const row = childrenWithTag(firstTable(pkg), "table:table-row")[0]!;
    const cells = childrenWithTag(row, "table:table-cell");
    // anchor cell, one compressed filler run, the far cell — not 21 individual elements.
    expect(cells.length).toBeLessThan(5);
    const filler = cells.find(
      (cellElement) =>
        attrValue(cellElement, "table:number-columns-repeated") !== undefined,
    );
    expect(filler).toBeDefined();
    expect(attrValue(filler!, "table:number-columns-repeated")).toBe("19");
  });

  it("anchors an image directly inside its own table:table-cell with cell-relative svg:x/svg:y", () => {
    const pkg = writeOdsContent(
      documentOf([
        sheetOf([], {
          images: [
            {
              kind: "image",
              format: "png",
              base64:
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
              widthPt: 30,
              heightPt: 20,
              anchorRow: 1,
              anchorColumn: 2,
              offsetXPt: 4,
              offsetYPt: 6,
            },
          ],
        }),
      ]),
    );
    const rows = childrenWithTag(firstTable(pkg), "table:table-row");
    const secondRowCells = childrenWithTag(rows[1]!, "table:table-cell");
    const anchorCell = secondRowCells.find(
      (cellElement) => childrenWithTag(cellElement, "draw:frame").length > 0,
    )!;
    expect(anchorCell).toBeDefined();
    const frame = childrenWithTag(anchorCell, "draw:frame")[0]!;
    expect(attrValue(frame, "svg:x")).toBe("4pt");
    expect(attrValue(frame, "svg:y")).toBe("6pt");
    expect(attrValue(frame, "svg:width")).toBe("30pt");
    expect(attrValue(frame, "svg:height")).toBe("20pt");
    const image = childrenWithTag(frame, "draw:image")[0]!;
    expect(attrValue(image, "xlink:href")).toBe("Pictures/image1.png");
    expect(pkg.parts["Pictures/image1.png"]?.kind).toBe("binary");
  });

  it("mints sequential Pictures/imageN.png paths and sequential draw:z-index across multiple images", () => {
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const imageAt = (anchorRow: number) => ({
      kind: "image" as const,
      format: "png" as const,
      base64: png,
      widthPt: 10,
      heightPt: 10,
      anchorRow,
      anchorColumn: 0,
      offsetXPt: 0,
      offsetYPt: 0,
    });
    const pkg = writeOdsContent(
      documentOf([sheetOf([], { images: [imageAt(0), imageAt(1)] })]),
    );
    expect(pkg.parts["Pictures/image1.png"]?.kind).toBe("binary");
    expect(pkg.parts["Pictures/image2.png"]?.kind).toBe("binary");
    const frames = childrenWithTag(firstTable(pkg), "table:table-row").flatMap(
      (row) =>
        childrenWithTag(row, "table:table-cell").flatMap((cell) =>
          childrenWithTag(cell, "draw:frame"),
        ),
    );
    expect(frames).toHaveLength(2);
    const zIndexes = frames
      .map((frame) => Number(attrValue(frame, "draw:z-index")))
      .sort((a, b) => a - b);
    expect(zIndexes).toStrictEqual([0, 1]);
  });

  it("mints sequential 'Object N' directories across multiple embedded objects", () => {
    const embeddedDocOf = (text: string) => ({
      kind: "wordprocessing" as const,
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [{ kind: "paragraph" as const, runs: [{ text }] }],
        },
      ],
    });
    const pkg = writeOdsContent(
      documentOf([
        sheetOf([], {
          embeddedObjects: [
            {
              objectKind: "wordprocessing",
              frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
              anchorRow: 0,
              anchorColumn: 0,
              document: embeddedDocOf("first"),
            },
            {
              objectKind: "wordprocessing",
              frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
              anchorRow: 1,
              anchorColumn: 0,
              document: embeddedDocOf("second"),
            },
          ],
        }),
      ]),
    );
    const objectParts = Object.keys(pkg.parts).filter((path) =>
      path.startsWith("Object "),
    );
    expect(objectParts.some((path) => path.startsWith("Object 1/"))).toBe(true);
    expect(objectParts.some((path) => path.startsWith("Object 2/"))).toBe(true);
    const frames = childrenWithTag(firstTable(pkg), "table:table-row").flatMap(
      (row) =>
        childrenWithTag(row, "table:table-cell").flatMap((cell) =>
          childrenWithTag(cell, "draw:frame"),
        ),
    );
    expect(frames).toHaveLength(2);
    const zIndexes = frames
      .map((frame) => Number(attrValue(frame, "draw:z-index")))
      .sort((a, b) => a - b);
    expect(zIndexes).toStrictEqual([0, 1]);
  });

  it("mints a distinct SheetTableN style name per sheet, not one shared across all of them", () => {
    const pkg = writeOdsContent(
      documentOf([
        sheetOf([], { name: "Sheet1" }),
        sheetOf([], { name: "Sheet2" }),
        sheetOf([], { name: "Sheet3" }),
      ]),
    );
    const body = findChildElement(
      partRoot(pkg, "content.xml").children,
      "office:body",
    )!;
    const spreadsheet = findChildElement(body.children, "office:spreadsheet")!;
    const tables = childrenWithTag(spreadsheet, "table:table");
    expect(tables).toHaveLength(3);
    const styleNames = tables.map((table) =>
      attrValue(table, "table:style-name"),
    );
    expect(new Set(styleNames).size).toBe(3);
  });

  it("writes table:table-column and table:table-row with no table:style-name when the column/row carries no width, height, or manual break", () => {
    const pkg = writeOdsContent(
      documentOf([
        sheetOf([
          {
            row: 0,
            column: 0,
            value: { kind: "string", value: "x" },
            displayText: "x",
          },
        ]),
      ]),
    );
    const table = firstTable(pkg);
    const column = childrenWithTag(table, "table:table-column")[0]!;
    expect(attrValue(column, "table:style-name")).toBeUndefined();
    const row = childrenWithTag(table, "table:table-row")[0]!;
    expect(attrValue(row, "table:style-name")).toBeUndefined();
  });

  it("writes table:table-cell with no table:style-name when the cell carries no background, borders, or alignment", () => {
    const pkg = writeOdsContent(
      documentOf([
        sheetOf([
          {
            row: 0,
            column: 0,
            value: { kind: "string", value: "plain" },
            displayText: "plain",
          },
        ]),
      ]),
    );
    const cell = firstCell(pkg);
    expect(attrValue(cell, "table:style-name")).toBeUndefined();
  });

  it("writes a background-only cell's style:table-cell-properties on its own minted style:style", () => {
    const pkg = writeOdsContent(
      documentOf([
        sheetOf([
          {
            row: 0,
            column: 0,
            value: { kind: "string", value: "coloured" },
            displayText: "coloured",
            background: { kind: "solid", color: { r: 1, g: 0, b: 0 } },
          },
        ]),
      ]),
    );
    const cell = firstCell(pkg);
    const styleName = attrValue(cell, "table:style-name")!;
    expect(styleName).toBeDefined();
    const cellStyle = childrenWithTag(
      contentAutomaticStyles(pkg),
      "style:style",
    ).find(
      (styleElement) => attrValue(styleElement, "style:name") === styleName,
    )!;
    expect(attrValue(cellStyle, "style:family")).toBe("table-cell");
    const properties = childrenWithTag(
      cellStyle,
      "style:table-cell-properties",
    )[0]!;
    expect(attrValue(properties, "fo:background-color")).toBe("#ff0000");
  });

  describe("used range: each independent source extends its own axis, never the other", () => {
    it("a column past the last cell extends table:table-column but not table:table-row", () => {
      const pkg = writeOdsContent(
        documentOf([sheetOf([], { columns: [{ index: 3, hidden: false }] })]),
      );
      const table = firstTable(pkg);
      expect(childrenWithTag(table, "table:table-column")).toHaveLength(4);
      expect(childrenWithTag(table, "table:table-row")).toHaveLength(0);
    });

    it("a row past the last cell extends table:table-row but not table:table-column", () => {
      const pkg = writeOdsContent(
        documentOf([sheetOf([], { rows: [{ index: 2, hidden: false }] })]),
      );
      const table = firstTable(pkg);
      expect(childrenWithTag(table, "table:table-row")).toHaveLength(3);
      expect(childrenWithTag(table, "table:table-column")).toHaveLength(0);
    });

    it("an image past the last cell extends both axes to its own anchor position", () => {
      const pkg = writeOdsContent(
        documentOf([
          sheetOf([], {
            images: [
              {
                kind: "image",
                format: "png",
                base64:
                  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
                widthPt: 30,
                heightPt: 20,
                anchorRow: 4,
                anchorColumn: 2,
                offsetXPt: 0,
                offsetYPt: 0,
              },
            ],
          }),
        ]),
      );
      const table = firstTable(pkg);
      expect(childrenWithTag(table, "table:table-row")).toHaveLength(5);
      expect(childrenWithTag(table, "table:table-column")).toHaveLength(3);
    });

    it("an embedded object past the last cell extends both axes to its own anchor position", () => {
      const pkg = writeOdsContent(
        documentOf([
          sheetOf([], {
            embeddedObjects: [
              {
                objectKind: "wordprocessing",
                frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
                anchorRow: 3,
                anchorColumn: 1,
                document: {
                  kind: "wordprocessing",
                  metadata: {},
                  sections: [
                    {
                      pageSize: { widthPt: 612, heightPt: 792 },
                      margins: {
                        topPt: 72,
                        rightPt: 72,
                        bottomPt: 72,
                        leftPt: 72,
                      },
                      blocks: [{ kind: "paragraph", runs: [{ text: "x" }] }],
                    },
                  ],
                },
              },
            ],
          }),
        ]),
      );
      const table = firstTable(pkg);
      expect(childrenWithTag(table, "table:table-row")).toHaveLength(4);
      expect(childrenWithTag(table, "table:table-column")).toHaveLength(2);
    });

    it("an embedded object with no anchorRow/anchorColumn defaults to position (0,0), not undefined-driven NaN cells", () => {
      const pkg = writeOdsContent(
        documentOf([
          sheetOf([], {
            embeddedObjects: [
              {
                objectKind: "wordprocessing",
                frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
                document: {
                  kind: "wordprocessing",
                  metadata: {},
                  sections: [
                    {
                      pageSize: { widthPt: 612, heightPt: 792 },
                      margins: {
                        topPt: 72,
                        rightPt: 72,
                        bottomPt: 72,
                        leftPt: 72,
                      },
                      blocks: [{ kind: "paragraph", runs: [{ text: "x" }] }],
                    },
                  ],
                },
              },
            ],
          }),
        ]),
      );
      const table = firstTable(pkg);
      expect(childrenWithTag(table, "table:table-row")).toHaveLength(1);
      expect(childrenWithTag(table, "table:table-column")).toHaveLength(1);
    });

    it("a data-validation rule's range past the last cell extends the grid, unlike a conditional-format rule's range", () => {
      const pkg = writeOdsContent(
        documentOf([
          sheetOf([], {
            dataValidations: [
              {
                ranges: [
                  { startRow: 0, startColumn: 0, endRow: 6, endColumn: 4 },
                ],
                type: "list",
                formula1: '"a,b,c"',
              },
            ],
          }),
        ]),
      );
      const table = firstTable(pkg);
      expect(childrenWithTag(table, "table:table-row")).toHaveLength(7);
      expect(childrenWithTag(table, "table:table-column")).toHaveLength(5);
    });

    it("printSettings.repeatColumns/repeatRows each extend only their own axis (wrapped in their own table:table-header-columns/-rows)", () => {
      const pkg = writeOdsContent(
        documentOf([
          sheetOf([], {
            printSettings: {
              ...DEFAULT_PRINT_SETTINGS,
              repeatColumns: { start: 0, end: 2 },
              repeatRows: { start: 0, end: 5 },
            },
          }),
        ]),
      );
      const table = firstTable(pkg);
      // repeatColumns/repeatRows wrap every column/row 0..end inside their own table:table-header-columns/-rows element (ODF's own repeated-header spelling), rather than leaving them as direct table:table children — see wrapHeaderRange.
      const columnHeader = childrenWithTag(
        table,
        "table:table-header-columns",
      )[0]!;
      const rowHeader = childrenWithTag(table, "table:table-header-rows")[0]!;
      expect(childrenWithTag(columnHeader, "table:table-column")).toHaveLength(
        3,
      );
      expect(childrenWithTag(rowHeader, "table:table-row")).toHaveLength(6);
    });

    it("printSettings.printRange extends both axes to its own end position", () => {
      const pkg = writeOdsContent(
        documentOf([
          sheetOf([], {
            printSettings: {
              ...DEFAULT_PRINT_SETTINGS,
              printRange: {
                startRow: 0,
                startColumn: 0,
                endRow: 8,
                endColumn: 3,
              },
            },
          }),
        ]),
      );
      const table = firstTable(pkg);
      expect(childrenWithTag(table, "table:table-row")).toHaveLength(9);
      expect(childrenWithTag(table, "table:table-column")).toHaveLength(4);
    });

    it("printSettings.manualBreaks rows/columns each extend only their own axis", () => {
      const pkg = writeOdsContent(
        documentOf([
          sheetOf([], {
            printSettings: {
              ...DEFAULT_PRINT_SETTINGS,
              manualBreaks: { rows: [7], columns: [3] },
            },
          }),
        ]),
      );
      const table = firstTable(pkg);
      expect(childrenWithTag(table, "table:table-row")).toHaveLength(8);
      expect(childrenWithTag(table, "table:table-column")).toHaveLength(4);
    });
  });

  describe("data validation messages", () => {
    it("writes no table:help-message/table:error-message and no table:allow-empty-cell for a bare rule with no message fields and allowBlank left absent", () => {
      const pkg = writeOdsContent(
        documentOf([
          sheetOf([], {
            dataValidations: [
              {
                ranges: [
                  { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 },
                ],
                type: "list",
                formula1: '"a,b,c"',
              },
            ],
          }),
        ]),
      );
      const rule = childrenWithTag(
        contentValidations(pkg),
        "table:content-validation",
      )[0]!;
      expect(attrValue(rule, "table:allow-empty-cell")).toBeUndefined();
      expect(childrenWithTag(rule, "table:help-message")).toHaveLength(0);
      expect(childrenWithTag(rule, "table:error-message")).toHaveLength(0);
    });

    it("writes table:allow-empty-cell=false only when allowBlank is explicitly false", () => {
      const pkg = writeOdsContent(
        documentOf([
          sheetOf([], {
            dataValidations: [
              {
                ranges: [
                  { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 },
                ],
                type: "list",
                formula1: '"a,b,c"',
                allowBlank: false,
              },
            ],
          }),
        ]),
      );
      const rule = childrenWithTag(
        contentValidations(pkg),
        "table:content-validation",
      )[0]!;
      expect(attrValue(rule, "table:allow-empty-cell")).toBe("false");
    });

    it("writes table:help-message and table:error-message with display/title/body only when the corresponding fields are actually set", () => {
      const pkg = writeOdsContent(
        documentOf([
          sheetOf([], {
            dataValidations: [
              {
                ranges: [
                  { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 },
                ],
                type: "list",
                formula1: '"a,b,c"',
                showInputMessage: true,
                promptTitle: "Pick one",
                prompt: "Choose a value",
                showErrorMessage: true,
                errorTitle: "Invalid",
                error: "That value is not allowed",
                errorStyle: "warning",
              },
            ],
          }),
        ]),
      );
      const rule = childrenWithTag(
        contentValidations(pkg),
        "table:content-validation",
      )[0]!;
      const help = childrenWithTag(rule, "table:help-message")[0]!;
      expect(attrValue(help, "table:display")).toBe("true");
      expect(attrValue(help, "table:title")).toBe("Pick one");
      expect(childrenWithTag(help, "text:p")[0]!.children[0]).toMatchObject({
        type: "text",
        value: "Choose a value",
      });
      const error = childrenWithTag(rule, "table:error-message")[0]!;
      expect(attrValue(error, "table:display")).toBe("true");
      expect(attrValue(error, "table:title")).toBe("Invalid");
      expect(attrValue(error, "table:message-type")).toBe("warning");
      expect(childrenWithTag(error, "text:p")[0]!.children[0]).toMatchObject({
        type: "text",
        value: "That value is not allowed",
      });
    });

    it("omits table:display when a message's title/body exist but its own show flag was never set", () => {
      const pkg = writeOdsContent(
        documentOf([
          sheetOf([], {
            dataValidations: [
              {
                ranges: [
                  { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 },
                ],
                type: "list",
                formula1: '"a,b,c"',
                promptTitle: "Pick one",
              },
            ],
          }),
        ]),
      );
      const rule = childrenWithTag(
        contentValidations(pkg),
        "table:content-validation",
      )[0]!;
      const help = childrenWithTag(rule, "table:help-message")[0]!;
      expect(attrValue(help, "table:display")).toBeUndefined();
      expect(attrValue(help, "table:title")).toBe("Pick one");
    });

    it("interns a rule with showInputMessage/showErrorMessage true as a definition distinct from an otherwise-identical rule with them left unset", () => {
      const rangeAt = (row: number) => ({
        startRow: row,
        startColumn: 0,
        endRow: row,
        endColumn: 0,
      });
      const pkg = writeOdsContent(
        documentOf([
          sheetOf([], {
            dataValidations: [
              {
                ranges: [rangeAt(0)],
                type: "list",
                formula1: '"a,b,c"',
                showInputMessage: true,
              },
              {
                ranges: [rangeAt(1)],
                type: "list",
                formula1: '"a,b,c"',
              },
              {
                ranges: [rangeAt(2)],
                type: "list",
                formula1: '"x,y,z"',
                showErrorMessage: true,
              },
              {
                ranges: [rangeAt(3)],
                type: "list",
                formula1: '"x,y,z"',
              },
            ],
          }),
        ]),
      );
      const rows = childrenWithTag(firstTable(pkg), "table:table-row");
      const nameOfRow = (row: number) => {
        const cell = childrenWithTag(rows[row]!, "table:table-cell")[0]!;
        return attrValue(cell, "table:content-validation-name");
      };
      expect(nameOfRow(0)).not.toBe(nameOfRow(1));
      expect(nameOfRow(2)).not.toBe(nameOfRow(3));
    });

    it("interns two rules with identical written content to the SAME name, not a fresh one each time", () => {
      const pkg = writeOdsContent(
        documentOf([
          sheetOf([], {
            dataValidations: [
              {
                ranges: [
                  { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 },
                ],
                type: "list",
                formula1: '"a,b,c"',
              },
              {
                ranges: [
                  { startRow: 1, startColumn: 0, endRow: 1, endColumn: 0 },
                ],
                type: "list",
                formula1: '"a,b,c"',
              },
            ],
          }),
        ]),
      );
      expect(
        childrenWithTag(contentValidations(pkg), "table:content-validation"),
      ).toHaveLength(1);
      const rows = childrenWithTag(firstTable(pkg), "table:table-row");
      const nameOf = (row: number) =>
        attrValue(
          childrenWithTag(rows[row]!, "table:table-cell")[0]!,
          "table:content-validation-name",
        );
      expect(nameOf(0)).toBe(nameOf(1));
    });

    it("mints names in first-encounter order across three genuinely distinct rules: val1, val2, val3", () => {
      const rangeAt = (row: number) => ({
        startRow: row,
        startColumn: 0,
        endRow: row,
        endColumn: 0,
      });
      const pkg = writeOdsContent(
        documentOf([
          sheetOf([], {
            dataValidations: [
              { ranges: [rangeAt(0)], type: "list", formula1: '"a,b,c"' },
              { ranges: [rangeAt(1)], type: "list", formula1: '"x,y,z"' },
              { ranges: [rangeAt(2)], type: "list", formula1: '"p,q,r"' },
            ],
          }),
        ]),
      );
      const names = childrenWithTag(
        contentValidations(pkg),
        "table:content-validation",
      ).map((rule) => attrValue(rule, "table:name"));
      expect(names).toEqual(["val1", "val2", "val3"]);
    });

    it("treats allowBlank left unset and allowBlank explicitly true as the same written content, deduping to one definition", () => {
      const pkg = writeOdsContent(
        documentOf([
          sheetOf([], {
            dataValidations: [
              {
                ranges: [
                  { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 },
                ],
                type: "list",
                formula1: '"a,b,c"',
              },
              {
                ranges: [
                  { startRow: 1, startColumn: 0, endRow: 1, endColumn: 0 },
                ],
                type: "list",
                formula1: '"a,b,c"',
                allowBlank: true,
              },
            ],
          }),
        ]),
      );
      expect(
        childrenWithTag(contentValidations(pkg), "table:content-validation"),
      ).toHaveLength(1);
    });

    it("writes no table:help-message/table:error-message element at all when display, title, and body are all absent", () => {
      const pkg = writeOdsContent(
        documentOf([
          sheetOf([], {
            dataValidations: [
              {
                ranges: [
                  { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 },
                ],
                type: "list",
                formula1: '"a,b,c"',
              },
            ],
          }),
        ]),
      );
      const rule = childrenWithTag(
        contentValidations(pkg),
        "table:content-validation",
      )[0]!;
      expect(childrenWithTag(rule, "table:help-message")).toHaveLength(0);
      expect(childrenWithTag(rule, "table:error-message")).toHaveLength(0);
    });

    it("splits a multi-line help/error message body into one text:p per line", () => {
      const pkg = writeOdsContent(
        documentOf([
          sheetOf([], {
            dataValidations: [
              {
                ranges: [
                  { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 },
                ],
                type: "list",
                formula1: '"a,b,c"',
                showInputMessage: true,
                prompt: "Line one\nLine two",
              },
            ],
          }),
        ]),
      );
      const rule = childrenWithTag(
        contentValidations(pkg),
        "table:content-validation",
      )[0]!;
      const help = childrenWithTag(rule, "table:help-message")[0]!;
      const paragraphs = childrenWithTag(help, "text:p");
      expect(paragraphs).toHaveLength(2);
      expect(paragraphs[0]!.children[0]).toMatchObject({
        type: "text",
        value: "Line one",
      });
      expect(paragraphs[1]!.children[0]).toMatchObject({
        type: "text",
        value: "Line two",
      });
    });
  });

  describe("unsupportedConditionalFormatReason refusals", () => {
    const rangeOnly = [
      { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 },
    ];

    it("refuses containsBlanks and notContainsBlanks by name", () => {
      for (const type of ["containsBlanks", "notContainsBlanks"] as const) {
        expect(() =>
          writeOdsContent(
            documentOf([
              sheetOf([], {
                conditionalFormats: [{ type, ranges: rangeOnly }],
              }),
            ]),
          ),
        ).toThrow(/no spelling for/);
      }
    });

    it("refuses a rule carrying a priority", () => {
      expect(() =>
        writeOdsContent(
          documentOf([
            sheetOf([], {
              conditionalFormats: [
                {
                  type: "containsErrors",
                  ranges: rangeOnly,
                  priority: 1,
                },
              ],
            }),
          ]),
        ),
      ).toThrow(/priority/);
    });

    it("refuses a rule carrying stopIfTrue", () => {
      expect(() =>
        writeOdsContent(
          documentOf([
            sheetOf([], {
              conditionalFormats: [
                {
                  type: "containsErrors",
                  ranges: rangeOnly,
                  stopIfTrue: true,
                },
              ],
            }),
          ]),
        ),
      ).toThrow(/stopIfTrue/);
    });

    it("does NOT refuse a rule with priority/stopIfTrue left unset", () => {
      expect(() =>
        writeOdsContent(
          documentOf([
            sheetOf([], {
              conditionalFormats: [
                { type: "containsErrors", ranges: rangeOnly },
              ],
            }),
          ]),
        ),
      ).not.toThrow();
    });

    it("refuses an aboveAverage rule carrying a stdDev count", () => {
      expect(() =>
        writeOdsContent(
          documentOf([
            sheetOf([], {
              conditionalFormats: [
                {
                  type: "aboveAverage",
                  ranges: rangeOnly,
                  stdDev: 2,
                },
              ],
            }),
          ]),
        ),
      ).toThrow(/standard-deviation/);
    });

    it("does not refuse an aboveAverage rule with no stdDev", () => {
      expect(() =>
        writeOdsContent(
          documentOf([
            sheetOf([], {
              conditionalFormats: [{ type: "aboveAverage", ranges: rangeOnly }],
            }),
          ]),
        ),
      ).not.toThrow();
    });

    it("refuses a reversed iconSet but not a non-reversed one", () => {
      const iconSet = (reverse?: boolean) => ({
        type: "iconSet" as const,
        ranges: rangeOnly,
        iconSetType: "3TrafficLights1",
        thresholds: [
          { type: "percent" as const, value: "33" },
          { type: "percent" as const, value: "67" },
        ],
        reverse,
      });
      expect(() =>
        writeOdsContent(
          documentOf([sheetOf([], { conditionalFormats: [iconSet(true)] })]),
        ),
      ).toThrow(/reversed icon set/);
      expect(() =>
        writeOdsContent(
          documentOf([sheetOf([], { conditionalFormats: [iconSet(false)] })]),
        ),
      ).not.toThrow();
    });

    it("refuses a threshold of the unsupported 'num' cfvo type", () => {
      expect(() =>
        writeOdsContent(
          documentOf([
            sheetOf([], {
              conditionalFormats: [
                {
                  type: "dataBar",
                  ranges: rangeOnly,
                  min: { type: "num", value: "0" },
                  max: { type: "max" },
                  color: { r: 1, g: 0, b: 0 },
                },
              ],
            }),
          ]),
        ),
      ).toThrow(/'num' threshold/);
    });

    it("does not refuse a dataBar whose min/max are both supported cfvo types", () => {
      expect(() =>
        writeOdsContent(
          documentOf([
            sheetOf([], {
              conditionalFormats: [
                {
                  type: "dataBar",
                  ranges: rangeOnly,
                  min: { type: "min" },
                  max: { type: "max" },
                  color: { r: 1, g: 0, b: 0 },
                },
              ],
            }),
          ]),
        ),
      ).not.toThrow();
    });
  });

  describe("the sheet's own master page", () => {
    it("writes style:master-page-name on the table's own style:style[family='table'], not on table:table itself", () => {
      const pkg = writeOdsContent(documentOf([sheetOf([])]));
      const table = firstTable(pkg);
      expect(attrValue(table, "style:master-page-name")).toBeUndefined();
      const tableStyleName = attrValue(table, "table:style-name")!;
      const tableStyle = childrenWithTag(
        contentAutomaticStyles(pkg),
        "style:style",
      ).find(
        (styleElement) =>
          attrValue(styleElement, "style:name") === tableStyleName,
      )!;
      expect(attrValue(tableStyle, "style:family")).toBe("table");
      const masterPageName = attrValue(tableStyle, "style:master-page-name");
      expect(masterPageName).toBeDefined();

      const masterPage = childrenWithTag(
        masterStyles(pkg),
        "style:master-page",
      ).find((element) => attrValue(element, "style:name") === masterPageName)!;
      expect(masterPage).toBeDefined();
      const pageLayoutName = attrValue(masterPage, "style:page-layout-name")!;
      const pageLayout = childrenWithTag(
        stylesAutomaticStyles(pkg),
        "style:page-layout",
      ).find((element) => attrValue(element, "style:name") === pageLayoutName)!;
      expect(pageLayout).toBeDefined();
    });

    it("gives each sheet its own distinct master page", () => {
      const pkg = writeOdsContent(
        documentOf([
          sheetOf([], { name: "First" }),
          sheetOf([], { name: "Second" }),
        ]),
      );
      const tables = childrenWithTag(
        findChildElement(
          findChildElement(
            partRoot(pkg, "content.xml").children,
            "office:body",
          )!.children,
          "office:spreadsheet",
        )!,
        "table:table",
      );
      const styleNames = tables.map((table) =>
        attrValue(table, "table:style-name")!,
      );
      expect(new Set(styleNames).size).toBe(2);
    });
  });

  it("writes gridlines/headers as style:print tokens, present only when true", () => {
    const pkg = writeOdsContent(
      documentOf([
        sheetOf([], {
          printSettings: {
            ...DEFAULT_PRINT_SETTINGS,
            gridlines: true,
            headers: false,
          },
        }),
      ]),
    );
    const pageLayout = childrenWithTag(
      stylesAutomaticStyles(pkg),
      "style:page-layout",
    )[0]!;
    const properties = childrenWithTag(
      pageLayout,
      "style:page-layout-properties",
    )[0]!;
    expect(attrValue(properties, "style:print")).toBe("grid");
  });

  it("writes table:print-ranges with the sheet name qualifying both ends", () => {
    const pkg = writeOdsContent(
      documentOf([
        sheetOf(
          [
            {
              row: 0,
              column: 0,
              value: { kind: "number", value: 1 },
              displayText: "1",
            },
          ],
          {
            name: "Data",
            printSettings: {
              ...DEFAULT_PRINT_SETTINGS,
              printRange: {
                startRow: 0,
                startColumn: 0,
                endRow: 2,
                endColumn: 2,
              },
            },
          },
        ),
      ]),
    );
    const table = firstTable(pkg);
    expect(attrValue(table, "table:print-ranges")).toBe("Data.A1:Data.C3");
  });

  it("wraps repeated header rows/columns in table:table-header-rows/-columns", () => {
    const pkg = writeOdsContent(
      documentOf([
        sheetOf(
          [
            {
              row: 3,
              column: 3,
              value: { kind: "number", value: 1 },
              displayText: "1",
            },
          ],
          {
            printSettings: {
              ...DEFAULT_PRINT_SETTINGS,
              repeatRows: { start: 0, end: 1 },
              repeatColumns: { start: 0, end: 1 },
            },
          },
        ),
      ]),
    );
    const table = firstTable(pkg);
    expect(childrenWithTag(table, "table:table-header-rows")).toHaveLength(1);
    expect(childrenWithTag(table, "table:table-header-columns")).toHaveLength(
      1,
    );
    const headerRows = childrenWithTag(table, "table:table-header-rows")[0]!;
    expect(childrenWithTag(headerRows, "table:table-row")).toHaveLength(2);
  });
});

describe("writeOdsContent: cell comments (ExaDev/documents.js#949)", () => {
  it("writes office:annotation as the cell's first child, with dc:creator before dc:date before its own text:p", () => {
    const pkg = writeOdsContent(
      documentOf([
        sheetOf([
          {
            row: 0,
            column: 0,
            value: { kind: "string", value: "x" },
            displayText: "x",
            comment: {
              text: "A real note",
              author: "Alice",
              createdAt: "2026-01-02T03:04:05",
            },
          },
        ]),
      ]),
    );
    const row = childrenWithTag(firstTable(pkg), "table:table-row")[0]!;
    const cell = childrenWithTag(row, "table:table-cell")[0]!;
    expect(cell.children[0]).toMatchObject({
      type: "element",
      tag: "office:annotation",
    });
    const annotation = findChildElement(cell.children, "office:annotation")!;
    expect(
      annotation.children.map((child) => child.type === "element" && child.tag),
    ).toEqual(["dc:creator", "dc:date", "text:p"]);
    expect(findChildElement(annotation.children, "dc:creator")).toMatchObject({
      children: [{ type: "text", value: "Alice" }],
    });
    expect(findChildElement(annotation.children, "dc:date")).toMatchObject({
      children: [{ type: "text", value: "2026-01-02T03:04:05" }],
    });
    const annotationParagraph = childrenWithTag(annotation, "text:p")[0]!;
    expect(annotationParagraph).toMatchObject({
      children: [{ type: "text", value: "A real note" }],
    });
  });

  it("writes no office:annotation at all for a cell with no comment", () => {
    const pkg = writeOdsContent(
      documentOf([
        sheetOf([
          {
            row: 0,
            column: 0,
            value: { kind: "string", value: "x" },
            displayText: "x",
          },
        ]),
      ]),
    );
    const row = childrenWithTag(firstTable(pkg), "table:table-row")[0]!;
    const cell = childrenWithTag(row, "table:table-cell")[0]!;
    expect(
      findChildElement(cell.children, "office:annotation"),
    ).toBeUndefined();
  });

  it("writes one text:p per '\\n'-separated line of a multi-paragraph comment, with no author/date elements when neither is present", () => {
    const pkg = writeOdsContent(
      documentOf([
        sheetOf([
          {
            row: 0,
            column: 0,
            value: { kind: "string", value: "x" },
            displayText: "x",
            comment: { text: "First line\nSecond line" },
          },
        ]),
      ]),
    );
    const row = childrenWithTag(firstTable(pkg), "table:table-row")[0]!;
    const cell = childrenWithTag(row, "table:table-cell")[0]!;
    const annotation = findChildElement(cell.children, "office:annotation")!;
    expect(findChildElement(annotation.children, "dc:creator")).toBeUndefined();
    expect(findChildElement(annotation.children, "dc:date")).toBeUndefined();
    const paragraphs = childrenWithTag(annotation, "text:p");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]).toMatchObject({
      children: [{ type: "text", value: "First line" }],
    });
    expect(paragraphs[1]).toMatchObject({
      children: [{ type: "text", value: "Second line" }],
    });
  });
});

describe("writeOdsContent: data validation and conditional formatting", () => {
  it("declares the calcext namespace the conditional-format elements need, on the part root", () => {
    const pkg = writeOdsContent(documentOf([sheetOf([])]));
    const root = partRoot(pkg, "content.xml");
    expect(attrValue(root, "xmlns:calcext")).toBe(
      "urn:org:documentfoundation:names:experimental:calc:xmlns:calcext:1.0",
    );
  });

  it("writes one document-wide table:content-validation before the tables, with a LibreOffice-shaped table:condition", () => {
    const pkg = writeOdsContent(
      documentOf([
        sheetOf([], {
          dataValidations: [
            {
              ranges: [
                { startRow: 0, startColumn: 0, endRow: 0, endColumn: 1 },
              ],
              type: "whole",
              operator: "greaterThanOrEqual",
              formula1: "1",
              allowBlank: false,
              showErrorMessage: true,
              errorStyle: "warning",
              error: "Not whole",
            },
          ],
        }),
      ]),
    );
    const spreadsheet = findChildElement(
      findChildElement(partRoot(pkg, "content.xml").children, "office:body")!
        .children,
      "office:spreadsheet",
    )!;
    const definitions = childrenWithTag(
      spreadsheet,
      "table:content-validations",
    )[0]!;
    expect(definitions.children[0]!.type).toBe("element");
    const validation = definitions.children[0] as XmlElement;
    expect(attrValue(validation, "table:name")).toBe("val1");
    // Decoded the way the read side decodes it: the in-memory attribute stores the escaped form, the serialiser writes it verbatim, decodeXmlText reverses it.
    expect(decodeXmlText(attrValue(validation, "table:condition")!)).toBe(
      "of:cell-content-is-whole-number() and cell-content()>=1",
    );
    expect(attrValue(validation, "table:allow-empty-cell")).toBe("false");
    const errorMessage = childrenWithTag(validation, "table:error-message")[0]!;
    expect(attrValue(errorMessage, "table:display")).toBe("true");
    expect(attrValue(errorMessage, "table:message-type")).toBe("warning");
    // The definitions container precedes the tables, matching where every real producer puts it.
    expect(
      spreadsheet.children.findIndex(
        (child) => child.type === "element" && child.tag === "table:table",
      ),
    ).toBeGreaterThan(
      spreadsheet.children.findIndex(
        (child) =>
          child.type === "element" && child.tag === "table:content-validations",
      ),
    );
  });

  it("stamps every in-range cell with table:content-validation-name, including content-less ones", () => {
    const pkg = writeOdsContent(
      documentOf([
        sheetOf(
          [
            {
              row: 0,
              column: 0,
              value: { kind: "number", value: 5 },
              displayText: "5",
            },
          ],
          {
            dataValidations: [
              {
                ranges: [
                  { startRow: 0, startColumn: 0, endRow: 0, endColumn: 1 },
                ],
                type: "list",
                formula1: '"a";"b"',
              },
            ],
          },
        ),
      ]),
    );
    const row = childrenWithTag(firstTable(pkg), "table:table-row")[0]!;
    const cells = childrenWithTag(row, "table:table-cell");
    expect(cells).toHaveLength(2);
    expect(attrValue(cells[0]!, "table:content-validation-name")).toBe("val1");
    expect(attrValue(cells[1]!, "table:content-validation-name")).toBe("val1");
    expect(attrValue(cells[1]!, "office:value-type")).toBeUndefined();
  });

  it("writes one calcext:conditional-format wrapper per distinct range list with calcext:condition, colour-scale, data-bar, icon-set, and date-is children", () => {
    const ranges = [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }];
    const pkg = writeOdsContent(
      documentOf([
        sheetOf([], {
          conditionalFormats: [
            {
              type: "cellIs",
              ranges,
              operator: "between",
              formula1: "1",
              formula2: "10",
            },
            {
              type: "timePeriod",
              ranges,
              timePeriod: "last7Days",
            },
            {
              type: "dataBar",
              ranges,
              min: { type: "min" },
              max: { type: "max" },
              color: { r: 99 / 255, g: 190 / 255, b: 123 / 255 },
              showValue: false,
            },
          ],
        }),
      ]),
    );
    const table = firstTable(pkg);
    const wrapper = childrenWithTag(table, "calcext:conditional-formats")[0]!;
    const formats = childrenWithTag(wrapper, "calcext:conditional-format");
    expect(formats).toHaveLength(1);
    expect(attrValue(formats[0]!, "calcext:target-range-address")).toBe(
      "Sheet1.A1:Sheet1.A1",
    );
    const ruleChildren = formats[0]!.children.filter(
      (child): child is XmlElement => child.type === "element",
    );
    const [condition, dateIs, dataBar] = ruleChildren;
    expect(condition!.tag).toBe("calcext:condition");
    expect(attrValue(condition!, "calcext:value")).toBe("between(1,10)");
    expect(attrValue(condition!, "calcext:base-cell-address")).toBe(
      "Sheet1.A1",
    );
    expect(dateIs!.tag).toBe("calcext:date-is");
    expect(attrValue(dateIs!, "calcext:date")).toBe("last-7-days");
    expect(dataBar!.tag).toBe("calcext:data-bar");
    expect(attrValue(dataBar!, "calcext:positive-color")).toBe("#63be7b");
    expect(attrValue(dataBar!, "calcext:show-value")).toBe("false");
    expect(childrenWithTag(dataBar!, "calcext:formatting-entry")).toHaveLength(
      2,
    );
  });

  it("omits calcext:show-value on a dataBar rule that never set showValue at all", () => {
    const ranges = [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }];
    const pkg = writeOdsContent(
      documentOf([
        sheetOf([], {
          conditionalFormats: [
            {
              type: "dataBar",
              ranges,
              min: { type: "min" },
              max: { type: "max" },
              color: { r: 1, g: 0, b: 0 },
            },
          ],
        }),
      ]),
    );
    const table = firstTable(pkg);
    const wrapper = childrenWithTag(table, "calcext:conditional-formats")[0]!;
    const dataBar = childrenWithTag(
      childrenWithTag(wrapper, "calcext:conditional-format")[0]!,
      "calcext:data-bar",
    )[0]!;
    expect(attrValue(dataBar, "calcext:show-value")).toBeUndefined();
  });

  it("writes no calcext:conditional-formats element when conditionalFormats is an empty (not undefined) array", () => {
    const pkg = writeOdsContent(
      documentOf([sheetOf([], { conditionalFormats: [] })]),
    );
    const table = firstTable(pkg);
    expect(childrenWithTag(table, "calcext:conditional-formats")).toHaveLength(
      0,
    );
  });
});

describe("writeOdsContent: a cell's own runs — bare newline vs. formatted line-break", () => {
  // A run that is EXACTLY {text: "\n"} with every formatting field absent is the shape readCellText's own multi-text:p join synthesises, so the writer must split it into a new text:p rather than emitting it as a text:line-break. Each of the eight cases below carries the identical "\n" text but sets exactly one formatting field, which must all keep it inside a single text:p (as a text:line-break within a formatted text:span), never splitting a second paragraph — this is the exhaustive boundary the writer's isBareNewlineRun predicate checks.
  it("splits a bare '\\n' run (no formatting fields at all) into two text:p elements", () => {
    const pkg = writeOdsContent(
      documentOf([
        sheetOf([
          {
            row: 0,
            column: 0,
            value: { kind: "string", value: "a\nb" },
            displayText: "a\nb",
            runs: [{ text: "a" }, { text: "\n" }, { text: "b" }],
          },
        ]),
      ]),
    );
    const paragraphs = childrenWithTag(firstCell(pkg), "text:p");
    expect(paragraphs).toHaveLength(2);
    expect(buildXml([paragraphs[0]!])).toBe("<text:p>a</text:p>");
    expect(buildXml([paragraphs[1]!])).toBe("<text:p>b</text:p>");
  });

  it.each([
    ["bold", { bold: true }],
    ["italic", { italic: true }],
    ["underline", { underline: true }],
    ["strike", { strike: true }],
    ["fontFamily", { fontFamily: "Arial" }],
    ["sizePt", { sizePt: 14 }],
    ["color", { color: { r: 1, g: 0, b: 0 } }],
    ["hyperlink", { hyperlink: "https://example.com" }],
  ] as const)(
    "keeps a '\\n' run carrying only %s inside a single text:p as a text:line-break, not a paragraph split",
    (_label, field) => {
      const pkg = writeOdsContent(
        documentOf([
          sheetOf([
            {
              row: 0,
              column: 0,
              value: { kind: "string", value: "a\nb" },
              displayText: "a\nb",
              runs: [{ text: "a" }, { text: "\n", ...field }, { text: "b" }],
            },
          ]),
        ]),
      );
      const paragraphs = childrenWithTag(firstCell(pkg), "text:p");
      expect(paragraphs).toHaveLength(1);
      const lineBreaks = paragraphs[0]!.children.filter(
        (child): child is XmlElement =>
          child.type === "element" &&
          (child.tag === "text:line-break" ||
            childrenWithTag(child, "text:line-break").length > 0),
      );
      expect(lineBreaks.length).toBeGreaterThan(0);
    },
  );
});

describe("writeOdsContent: cellSourceRuns fallback", () => {
  it("falls back to a single plain run of displayText when no runs field is present", () => {
    const pkg = writeOdsContent(
      documentOf([
        sheetOf([
          {
            row: 0,
            column: 0,
            value: { kind: "string", value: "hello" },
            displayText: "hello",
          },
        ]),
      ]),
    );
    const paragraphs = childrenWithTag(firstCell(pkg), "text:p");
    expect(paragraphs).toHaveLength(1);
    expect(buildXml([paragraphs[0]!])).toBe("<text:p>hello</text:p>");
  });

  it("writes one empty text:p (planCellTextGroups' own always-one-group floor) for an empty displayText and no runs field", () => {
    const pkg = writeOdsContent(
      documentOf([
        sheetOf([
          {
            row: 0,
            column: 0,
            value: { kind: "empty" },
            displayText: "",
          },
        ]),
      ]),
    );
    const paragraphs = childrenWithTag(firstCell(pkg), "text:p");
    expect(paragraphs).toHaveLength(1);
    expect(buildXml([paragraphs[0]!])).toBe("<text:p></text:p>");
  });

  it("writes one text:p (not zero) for an explicit runs field containing only an empty-text run", () => {
    const pkg = writeOdsContent(
      documentOf([
        sheetOf([
          {
            row: 0,
            column: 0,
            value: { kind: "empty" },
            displayText: "",
            runs: [{ text: "" }],
          },
        ]),
      ]),
    );
    expect(childrenWithTag(firstCell(pkg), "text:p")).toHaveLength(1);
  });
});

describe("writeOdsContent: 'time' cell duration formatting boundaries", () => {
  it("throws for a value that is not the canonical HH:MM:SS spelling", () => {
    expect(() =>
      writeOdsContent(
        documentOf([
          sheetOf([
            {
              row: 0,
              column: 0,
              value: { kind: "time", value: "not-a-time" },
              displayText: "not-a-time",
            },
          ]),
        ]),
      ),
    ).toThrow(/not the canonical ISO 8601 HH:MM:SS/);
  });

  it("formats a fractional-seconds duration keeping the fraction, not rounding it away", () => {
    const pkg = writeOdsContent(
      documentOf([
        sheetOf([
          {
            row: 0,
            column: 0,
            value: { kind: "time", value: "01:02:03.456" },
            displayText: "01:02:03.456",
          },
        ]),
      ]),
    );
    expect(attrValue(firstCell(pkg), "office:time-value")).toBe("PT1H2M3.456S");
  });

  it("rejects a duration with a non-digit fraction (an invalid HH:MM:SS.fraction spelling)", () => {
    expect(() =>
      writeOdsContent(
        documentOf([
          sheetOf([
            {
              row: 0,
              column: 0,
              value: { kind: "time", value: "01:02:03.abc" },
              displayText: "01:02:03.abc",
            },
          ]),
        ]),
      ),
    ).toThrow(/not the canonical ISO 8601 HH:MM:SS/);
  });

  it("rejects a duration missing its seconds component entirely", () => {
    expect(() =>
      writeOdsContent(
        documentOf([
          sheetOf([
            {
              row: 0,
              column: 0,
              value: { kind: "time", value: "01:02" },
              displayText: "01:02",
            },
          ]),
        ]),
      ),
    ).toThrow(/not the canonical ISO 8601 HH:MM:SS/);
  });
});

describe("writeOdsContent: boolean and currency cell value boundaries", () => {
  it("writes office:boolean-value='true' for a true boolean cell", () => {
    const pkg = writeOdsContent(
      documentOf([
        sheetOf([
          {
            row: 0,
            column: 0,
            value: { kind: "boolean", value: true },
            displayText: "TRUE",
          },
        ]),
      ]),
    );
    expect(attrValue(firstCell(pkg), "office:boolean-value")).toBe("true");
  });

  it("writes office:boolean-value='false' for a false boolean cell", () => {
    const pkg = writeOdsContent(
      documentOf([
        sheetOf([
          {
            row: 0,
            column: 0,
            value: { kind: "boolean", value: false },
            displayText: "FALSE",
          },
        ]),
      ]),
    );
    expect(attrValue(firstCell(pkg), "office:boolean-value")).toBe("false");
  });

  it("writes no office:currency attribute when a currency cell carries no currency code", () => {
    const pkg = writeOdsContent(
      documentOf([
        sheetOf([
          {
            row: 0,
            column: 0,
            value: { kind: "currency", value: 9.99 },
            displayText: "9.99",
          },
        ]),
      ]),
    );
    const cell = firstCell(pkg);
    expect(attrValue(cell, "office:value-type")).toBe("currency");
    expect(attrValue(cell, "office:currency")).toBeUndefined();
  });

  it("writes office:currency when a currency cell carries a currency code", () => {
    const pkg = writeOdsContent(
      documentOf([
        sheetOf([
          {
            row: 0,
            column: 0,
            value: { kind: "currency", value: 9.99, currency: "GBP" },
            displayText: "9.99",
          },
        ]),
      ]),
    );
    expect(attrValue(firstCell(pkg), "office:currency")).toBe("GBP");
  });

  it("prefers exactValue's own decimal string over the double when both are present", () => {
    const pkg = writeOdsContent(
      documentOf([
        sheetOf([
          {
            row: 0,
            column: 0,
            value: {
              kind: "number",
              value: 0.1 + 0.2,
              exactValue: "0.3",
            },
            displayText: "0.3",
          },
        ]),
      ]),
    );
    expect(attrValue(firstCell(pkg), "office:value")).toBe("0.3");
  });
});

// normaliseOdsContent applies every canonical* helper below identically to BOTH sides of a round-trip equality check (write.test.ts / write-round-trip.test.ts's own expectRoundTrip: normalise(actual) vs. normalise(expected)), so a mutation confined to one of these helpers changes both sides in lockstep and is invisible to that comparison. Each is pinned here directly instead, against a literal expected return value.
describe("canonical* helpers: direct unit coverage (see the note above on why)", () => {
  it("canonicalColor round-trips a colour through hex unchanged", () => {
    expect(canonicalColor({ r: 0.2, g: 0.4, b: 0.6 })).toStrictEqual({
      r: 0.2,
      g: 0.4,
      b: 0.6,
    });
  });

  it("canonicalCellFill: a solid fill's own colour", () => {
    expect(
      canonicalCellFill({ kind: "solid", color: { r: 1, g: 0, b: 0 } }),
    ).toStrictEqual({ kind: "solid", color: { r: 1, g: 0, b: 0 } });
  });

  it("canonicalCellFill: a pattern's foreground colour, when present", () => {
    expect(
      canonicalCellFill({
        kind: "pattern",
        patternType: "mediumGray",
        foregroundColor: { r: 1, g: 0, b: 0 },
        backgroundColor: { r: 0, g: 0, b: 1 },
      }),
    ).toStrictEqual({ kind: "solid", color: { r: 1, g: 0, b: 0 } });
  });

  it("canonicalCellFill: falls back to a pattern's background colour when foreground is absent", () => {
    expect(
      canonicalCellFill({
        kind: "pattern",
        patternType: "mediumGray",
        backgroundColor: { r: 0, g: 0, b: 1 },
      }),
    ).toStrictEqual({ kind: "solid", color: { r: 0, g: 0, b: 1 } });
  });

  it("canonicalCellFill: undefined when a pattern states neither colour", () => {
    expect(
      canonicalCellFill({ kind: "pattern", patternType: "mediumGray" }),
    ).toBeUndefined();
  });

  it("canonicalRun: keeps only the fields actually stated, one at a time", () => {
    expect(canonicalRun({ text: "a" })).toStrictEqual({ text: "a" });
    expect(canonicalRun({ text: "a", bold: true })).toStrictEqual({
      text: "a",
      bold: true,
    });
    expect(canonicalRun({ text: "a", italic: true })).toStrictEqual({
      text: "a",
      italic: true,
    });
    expect(canonicalRun({ text: "a", underline: true })).toStrictEqual({
      text: "a",
      underline: true,
    });
    expect(canonicalRun({ text: "a", strike: true })).toStrictEqual({
      text: "a",
      strike: true,
    });
    expect(canonicalRun({ text: "a", fontFamily: "Arial" })).toStrictEqual({
      text: "a",
      fontFamily: "Arial",
    });
    expect(canonicalRun({ text: "a", sizePt: 12 })).toStrictEqual({
      text: "a",
      sizePt: 12,
    });
    expect(
      canonicalRun({ text: "a", color: { r: 1, g: 0, b: 0 } }),
    ).toStrictEqual({
      text: "a",
      color: { r: 1, g: 0, b: 0 },
    });
    expect(
      canonicalRun({ text: "a", hyperlink: "https://example.com" }),
    ).toStrictEqual({ text: "a", hyperlink: "https://example.com" });
  });

  it("canonicalCellValue: every value kind", () => {
    expect(
      canonicalCellValue({ kind: "number", value: 1, exactValue: "1.0" }),
    ).toStrictEqual({ kind: "number", value: 1 });
    expect(
      canonicalCellValue({ kind: "percentage", value: 0.5 }),
    ).toStrictEqual({
      kind: "percentage",
      value: 0.5,
    });
    expect(canonicalCellValue({ kind: "currency", value: 9.99 })).toStrictEqual(
      {
        kind: "currency",
        value: 9.99,
      },
    );
    expect(
      canonicalCellValue({ kind: "currency", value: 9.99, currency: "GBP" }),
    ).toStrictEqual({ kind: "currency", value: 9.99, currency: "GBP" });
    expect(canonicalCellValue({ kind: "boolean", value: true })).toStrictEqual({
      kind: "boolean",
      value: true,
    });
    expect(canonicalCellValue({ kind: "boolean", value: false })).toStrictEqual(
      {
        kind: "boolean",
        value: false,
      },
    );
    expect(
      canonicalCellValue({ kind: "date", value: "2026-01-01" }),
    ).toStrictEqual({
      kind: "date",
      value: "2026-01-01",
    });
    expect(
      canonicalCellValue({ kind: "time", value: "01:02:03" }),
    ).toStrictEqual({
      kind: "time",
      value: "PT1H2M3S",
    });
    expect(canonicalCellValue({ kind: "string", value: "hi" })).toStrictEqual({
      kind: "string",
      value: "hi",
    });
    expect(canonicalCellValue({ kind: "empty" })).toStrictEqual({
      kind: "empty",
    });
  });

  it("canonicalCell: a value-less, formula-less, text-less, comment-less cell vanishes entirely", () => {
    expect(
      canonicalCell({
        row: 0,
        column: 0,
        value: { kind: "empty" },
        displayText: "",
      }),
    ).toBeUndefined();
  });

  it("canonicalCell: an otherwise-empty cell survives when it carries a comment", () => {
    const cell = canonicalCell({
      row: 0,
      column: 0,
      value: { kind: "empty" },
      displayText: "",
      comment: { text: "note" },
    });
    expect(cell).toBeDefined();
    expect(cell?.comment).toStrictEqual({ text: "note" });
  });

  it("canonicalCell: an otherwise-empty cell survives when it carries a formula", () => {
    const cell = canonicalCell({
      row: 0,
      column: 0,
      value: { kind: "empty" },
      displayText: "",
      formula: "=1+1",
    });
    expect(cell).toBeDefined();
    expect(cell?.formula).toBe("=1+1");
  });

  it("canonicalCell: carries every optional field through when present", () => {
    const cell = canonicalCell({
      row: 2,
      column: 3,
      value: { kind: "string", value: "x" },
      displayText: "x",
      formula: "=A1",
      colSpan: 2,
      rowSpan: 3,
      background: { kind: "solid", color: { r: 1, g: 1, b: 1 } },
      borders: {
        left: { color: { r: 0, g: 0, b: 0 }, widthPt: 1, style: "solid" },
      },
      alignment: "center",
      verticalAlignment: "middle",
      comment: { text: "hi" },
    });
    expect(cell).toStrictEqual({
      row: 2,
      column: 3,
      value: { kind: "string", value: "x" },
      displayText: "x",
      runs: [{ text: "x" }],
      formula: "=A1",
      colSpan: 2,
      rowSpan: 3,
      background: { kind: "solid", color: { r: 1, g: 1, b: 1 } },
      borders: {
        left: { color: { r: 0, g: 0, b: 0 }, widthPt: 1, style: "solid" },
      },
      alignment: "center",
      verticalAlignment: "middle",
      comment: { text: "hi" },
    });
  });

  it("canonicalCell: carries no optional field at all when none are stated, not one set to undefined", () => {
    const cell = canonicalCell({
      row: 0,
      column: 0,
      value: { kind: "string", value: "x" },
      displayText: "x",
    });
    expect(cell).toStrictEqual({
      row: 0,
      column: 0,
      value: { kind: "string", value: "x" },
      displayText: "x",
      runs: [{ text: "x" }],
    });
  });

  it("canonicalCells: returns [] when the sheet's used range is undefined (no cells at all)", () => {
    expect(
      canonicalCells(
        { name: "s", cells: [], columns: [], rows: [], images: [] } as never,
        undefined,
        undefined,
      ),
    ).toStrictEqual([]);
  });

  it("canonicalColumns/canonicalRows: hidden is exactly true or undefined, never a bare boolean carrying false", () => {
    expect(canonicalColumns({ columns: [] } as never, undefined)).toStrictEqual(
      [],
    );
    const columns = canonicalColumns(
      {
        columns: [
          { index: 0, hidden: true },
          { index: 1, hidden: false },
        ],
      } as never,
      1,
    );
    expect(columns[0]?.hidden).toBe(true);
    expect(columns[1]?.hidden).toBeUndefined();

    expect(canonicalRows({ rows: [] } as never, undefined)).toStrictEqual([]);
    const rows = canonicalRows(
      {
        rows: [
          { index: 0, hidden: true },
          { index: 1, hidden: false },
        ],
      } as never,
      1,
    );
    expect(rows[0]?.hidden).toBe(true);
    expect(rows[1]?.hidden).toBeUndefined();
  });

  it("canonicalSheetImage: carries altText only when present", () => {
    const base = {
      kind: "image" as const,
      format: "png" as const,
      base64: "AA==",
      widthPt: 10,
      heightPt: 10,
      anchorRow: 0,
      anchorColumn: 0,
      offsetXPt: 0,
      offsetYPt: 0,
    };
    expect(canonicalSheetImage(base)).toStrictEqual(base);
    expect(
      canonicalSheetImage({ ...base, altText: "a picture" }),
    ).toStrictEqual({
      ...base,
      altText: "a picture",
    });
  });

  it("canonicalImages: reorders into row-major anchor-position order, breaking ties by original index", () => {
    const imageAt = (anchorRow: number, anchorColumn: number) => ({
      kind: "image" as const,
      format: "png" as const,
      base64: "AA==",
      widthPt: 10,
      heightPt: 10,
      anchorRow,
      anchorColumn,
      offsetXPt: 0,
      offsetYPt: 0,
    });
    const second = imageAt(0, 5);
    const first = imageAt(0, 1);
    const third = imageAt(2, 0);
    const result = canonicalImages({
      images: [second, third, first],
    } as never);
    expect(result).toStrictEqual([first, second, third]);
  });

  it("canonicalPrintSettings: carries every optional field only when present", () => {
    const required = {
      pageSize: PAGE_SIZE_A4,
      margins: MARGINS,
      gridlines: false,
      headers: false,
      pageOrder: "downThenOver" as const,
    };
    expect(canonicalPrintSettings(required)).toStrictEqual(required);
    expect(
      canonicalPrintSettings({
        ...required,
        printRange: { startRow: 0, startColumn: 0, endRow: 1, endColumn: 1 },
        scalePercent: 80,
        fitToPages: { width: 1, height: 1 },
        repeatRows: { start: 0, end: 0 },
        repeatColumns: { start: 0, end: 0 },
        manualBreaks: { rows: [1], columns: [1] },
      }),
    ).toStrictEqual({
      ...required,
      printRange: { startRow: 0, startColumn: 0, endRow: 1, endColumn: 1 },
      scalePercent: 80,
      fitToPages: { width: 1, height: 1 },
      repeatRows: { start: 0, end: 0 },
      repeatColumns: { start: 0, end: 0 },
      manualBreaks: { rows: [1], columns: [1] },
    });
  });

  it("canonicalDataValidations: undefined passes through unchanged", () => {
    expect(
      canonicalDataValidations({
        cells: [],
        dataValidations: undefined,
      } as never),
    ).toBeUndefined();
  });

  it("canonicalDataValidations: a list/custom rule with no formula1 degrades to a bare allow-blank custom rule", () => {
    const result = canonicalDataValidations({
      cells: [],
      dataValidations: [
        {
          type: "list",
          ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
        },
      ],
    } as never);
    expect(result).toStrictEqual([
      {
        type: "custom",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
        allowBlank: true,
      },
    ]);
  });

  it("canonicalDataValidations: a list rule's operator is always forced to 'equal'", () => {
    const result = canonicalDataValidations({
      cells: [],
      dataValidations: [
        {
          type: "list",
          ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
          formula1: "A,B,C",
          operator: "between",
        },
      ],
    } as never);
    expect(result?.[0]?.operator).toBe("equal");
  });

  it("canonicalDataValidations: a custom rule never carries an operator", () => {
    const result = canonicalDataValidations({
      cells: [],
      dataValidations: [
        {
          type: "custom",
          ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
          formula1: "A1>0",
          operator: "greaterThan",
        },
      ],
    } as never);
    expect(result?.[0]).not.toHaveProperty("operator");
  });

  it("canonicalDataValidations: a rule whose every position is covered by a merged cell vanishes", () => {
    const result = canonicalDataValidations({
      cells: [{ row: 0, column: 0, colSpan: 2, rowSpan: 1 } as never],
      dataValidations: [
        {
          type: "whole",
          ranges: [{ startRow: 0, startColumn: 1, endRow: 0, endColumn: 1 }],
          operator: "greaterThan",
          formula1: "0",
        },
      ],
    } as never);
    expect(result).toStrictEqual([]);
  });

  it("canonicalConditionalFormatStyle: textColor wins over background when both are present", () => {
    expect(
      canonicalConditionalFormatStyle({
        textColor: { r: 1, g: 0, b: 0 },
        background: { r: 0, g: 0, b: 1 },
      }),
    ).toStrictEqual({ textColor: { r: 1, g: 0, b: 0 } });
  });

  it("canonicalConditionalFormatStyle: background alone, when textColor is absent", () => {
    expect(
      canonicalConditionalFormatStyle({ background: { r: 0, g: 0, b: 1 } }),
    ).toStrictEqual({ background: { r: 0, g: 0, b: 1 } });
  });

  it("canonicalConditionalFormatStyle: undefined for undefined input and for a style with neither colour", () => {
    expect(canonicalConditionalFormatStyle(undefined)).toBeUndefined();
    expect(canonicalConditionalFormatStyle({})).toBeUndefined();
  });

  it("canonicalConditionalFormats: undefined passes through unchanged", () => {
    expect(
      canonicalConditionalFormats({ conditionalFormats: undefined } as never),
    ).toBeUndefined();
  });

  const CF_RANGES = [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }];

  it("canonicalConditionalFormats: 'cellIs' carries formula2/style only when present", () => {
    const bare = canonicalConditionalFormats({
      conditionalFormats: [
        {
          type: "cellIs",
          ranges: CF_RANGES,
          operator: "greaterThan",
          formula1: "0",
        },
      ],
    } as never);
    expect(bare?.[0]).toStrictEqual({
      type: "cellIs",
      ranges: CF_RANGES,
      operator: "greaterThan",
      formula1: "0",
    });
    const full = canonicalConditionalFormats({
      conditionalFormats: [
        {
          type: "cellIs",
          ranges: CF_RANGES,
          operator: "between",
          formula1: "0",
          formula2: "10",
          style: { textColor: { r: 1, g: 0, b: 0 } },
        },
      ],
    } as never);
    expect(full?.[0]).toStrictEqual({
      type: "cellIs",
      ranges: CF_RANGES,
      operator: "between",
      formula1: "0",
      formula2: "10",
      style: { textColor: { r: 1, g: 0, b: 0 } },
    });
  });

  it("canonicalConditionalFormats: 'top10' carries percent/bottom only when present", () => {
    const result = canonicalConditionalFormats({
      conditionalFormats: [
        {
          type: "top10",
          ranges: CF_RANGES,
          rank: 10,
          percent: true,
          bottom: true,
        },
      ],
    } as never);
    expect(result?.[0]).toStrictEqual({
      type: "top10",
      ranges: CF_RANGES,
      rank: 10,
      percent: true,
      bottom: true,
    });
    const bare = canonicalConditionalFormats({
      conditionalFormats: [{ type: "top10", ranges: CF_RANGES, rank: 10 }],
    } as never);
    expect(bare?.[0]).toStrictEqual({
      type: "top10",
      ranges: CF_RANGES,
      rank: 10,
    });
  });

  it("canonicalConditionalFormats: 'aboveAverage' carries aboveAverage/equalAverage only when present", () => {
    const result = canonicalConditionalFormats({
      conditionalFormats: [
        {
          type: "aboveAverage",
          ranges: CF_RANGES,
          aboveAverage: false,
          equalAverage: true,
        },
      ],
    } as never);
    expect(result?.[0]).toStrictEqual({
      type: "aboveAverage",
      ranges: CF_RANGES,
      aboveAverage: false,
      equalAverage: true,
    });
    const bare = canonicalConditionalFormats({
      conditionalFormats: [{ type: "aboveAverage", ranges: CF_RANGES }],
    } as never);
    expect(bare?.[0]).toStrictEqual({
      type: "aboveAverage",
      ranges: CF_RANGES,
    });
  });

  it("canonicalConditionalFormats: 'dataBar'/'iconSet' carry showValue only when present", () => {
    const dataBar = canonicalConditionalFormats({
      conditionalFormats: [
        {
          type: "dataBar",
          ranges: CF_RANGES,
          min: { type: "min" },
          max: { type: "max" },
          color: { r: 0, g: 1, b: 0 },
          showValue: false,
        },
      ],
    } as never);
    expect(dataBar?.[0]).toHaveProperty("showValue", false);
    const dataBarBare = canonicalConditionalFormats({
      conditionalFormats: [
        {
          type: "dataBar",
          ranges: CF_RANGES,
          min: { type: "min" },
          max: { type: "max" },
          color: { r: 0, g: 1, b: 0 },
        },
      ],
    } as never);
    expect(dataBarBare?.[0]).not.toHaveProperty("showValue");

    const iconSet = canonicalConditionalFormats({
      conditionalFormats: [
        {
          type: "iconSet",
          ranges: CF_RANGES,
          iconSetType: "3TrafficLights1",
          thresholds: [{ type: "percent", value: "33" }],
          showValue: false,
        },
      ],
    } as never);
    expect(iconSet?.[0]).toHaveProperty("showValue", false);
  });

  it("canonicalConditionalFormats: text-predicate and no-argument rule kinds carry style only when present", () => {
    const withStyle = canonicalConditionalFormats({
      conditionalFormats: [
        {
          type: "containsText",
          ranges: CF_RANGES,
          text: "x",
          style: { background: { r: 1, g: 1, b: 0 } },
        },
      ],
    } as never);
    expect(withStyle?.[0]).toHaveProperty("style", {
      background: { r: 1, g: 1, b: 0 },
    });
    const bare = canonicalConditionalFormats({
      conditionalFormats: [{ type: "uniqueValues", ranges: CF_RANGES }],
    } as never);
    expect(bare?.[0]).not.toHaveProperty("style");
  });
});
