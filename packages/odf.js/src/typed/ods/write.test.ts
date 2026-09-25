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
import { writeOdsContent } from "./write";

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

function firstCell(pkg: Package): XmlElement {
  return childrenWithTag(
    childrenWithTag(firstTable(pkg), "table:table-row")[0]!,
    "table:table-cell",
  )[0]!;
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
    const maxExpectedCellElements = 5;
    expect(cells.length).toBeLessThan(maxExpectedCellElements);
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
    const sheets = [
      sheetOf([], { name: "Sheet1" }),
      sheetOf([], { name: "Sheet2" }),
      sheetOf([], { name: "Sheet3" }),
    ];
    const pkg = writeOdsContent(documentOf(sheets));
    const body = findChildElement(
      partRoot(pkg, "content.xml").children,
      "office:body",
    )!;
    const spreadsheet = findChildElement(body.children, "office:spreadsheet")!;
    const tables = childrenWithTag(spreadsheet, "table:table");
    expect(tables).toHaveLength(sheets.length);
    const styleNames = tables.map((table) =>
      attrValue(table, "table:style-name"),
    );
    expect(new Set(styleNames).size).toBe(sheets.length);
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
      const lastColumnIndex = 3;
      const pkg = writeOdsContent(
        documentOf([
          sheetOf([], {
            columns: [{ index: lastColumnIndex, hidden: false }],
          }),
        ]),
      );
      const table = firstTable(pkg);
      expect(childrenWithTag(table, "table:table-column")).toHaveLength(
        lastColumnIndex + 1,
      );
      expect(childrenWithTag(table, "table:table-row")).toHaveLength(0);
    });

    it("a row past the last cell extends table:table-row but not table:table-column", () => {
      const lastRowIndex = 2;
      const pkg = writeOdsContent(
        documentOf([
          sheetOf([], { rows: [{ index: lastRowIndex, hidden: false }] }),
        ]),
      );
      const table = firstTable(pkg);
      expect(childrenWithTag(table, "table:table-row")).toHaveLength(
        lastRowIndex + 1,
      );
      expect(childrenWithTag(table, "table:table-column")).toHaveLength(0);
    });

    it("an image past the last cell extends both axes to its own anchor position", () => {
      const anchorRow = 4;
      const anchorColumn = 2;
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
                anchorRow,
                anchorColumn,
                offsetXPt: 0,
                offsetYPt: 0,
              },
            ],
          }),
        ]),
      );
      const table = firstTable(pkg);
      expect(childrenWithTag(table, "table:table-row")).toHaveLength(
        anchorRow + 1,
      );
      expect(childrenWithTag(table, "table:table-column")).toHaveLength(
        anchorColumn + 1,
      );
    });

    it("an embedded object past the last cell extends both axes to its own anchor position", () => {
      const anchorRow = 3;
      const anchorColumn = 1;
      const pkg = writeOdsContent(
        documentOf([
          sheetOf([], {
            embeddedObjects: [
              {
                objectKind: "wordprocessing",
                frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
                anchorRow,
                anchorColumn,
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
      expect(childrenWithTag(table, "table:table-row")).toHaveLength(
        anchorRow + 1,
      );
      expect(childrenWithTag(table, "table:table-column")).toHaveLength(
        anchorColumn + 1,
      );
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
      const endRow = 6;
      const endColumn = 4;
      const pkg = writeOdsContent(
        documentOf([
          sheetOf([], {
            dataValidations: [
              {
                ranges: [{ startRow: 0, startColumn: 0, endRow, endColumn }],
                type: "list",
                formula1: '"a,b,c"',
              },
            ],
          }),
        ]),
      );
      const table = firstTable(pkg);
      expect(childrenWithTag(table, "table:table-row")).toHaveLength(
        endRow + 1,
      );
      expect(childrenWithTag(table, "table:table-column")).toHaveLength(
        endColumn + 1,
      );
    });

    it("printSettings.repeatColumns/repeatRows each extend only their own axis (wrapped in their own table:table-header-columns/-rows)", () => {
      const repeatColumnsEnd = 2;
      const repeatRowsEnd = 5;
      const pkg = writeOdsContent(
        documentOf([
          sheetOf([], {
            printSettings: {
              ...DEFAULT_PRINT_SETTINGS,
              repeatColumns: { start: 0, end: repeatColumnsEnd },
              repeatRows: { start: 0, end: repeatRowsEnd },
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
        repeatColumnsEnd + 1,
      );
      expect(childrenWithTag(rowHeader, "table:table-row")).toHaveLength(
        repeatRowsEnd + 1,
      );
    });

    it("printSettings.printRange extends both axes to its own end position", () => {
      const printRangeEndRow = 8;
      const printRangeEndColumn = 3;
      const pkg = writeOdsContent(
        documentOf([
          sheetOf([], {
            printSettings: {
              ...DEFAULT_PRINT_SETTINGS,
              printRange: {
                startRow: 0,
                startColumn: 0,
                endRow: printRangeEndRow,
                endColumn: printRangeEndColumn,
              },
            },
          }),
        ]),
      );
      const table = firstTable(pkg);
      expect(childrenWithTag(table, "table:table-row")).toHaveLength(
        printRangeEndRow + 1,
      );
      expect(childrenWithTag(table, "table:table-column")).toHaveLength(
        printRangeEndColumn + 1,
      );
    });

    it("printSettings.manualBreaks rows/columns each extend only their own axis", () => {
      const rowBreakIndex = 7;
      const columnBreakIndex = 3;
      const pkg = writeOdsContent(
        documentOf([
          sheetOf([], {
            printSettings: {
              ...DEFAULT_PRINT_SETTINGS,
              manualBreaks: {
                rows: [rowBreakIndex],
                columns: [columnBreakIndex],
              },
            },
          }),
        ]),
      );
      const table = firstTable(pkg);
      expect(childrenWithTag(table, "table:table-row")).toHaveLength(
        rowBreakIndex + 1,
      );
      expect(childrenWithTag(table, "table:table-column")).toHaveLength(
        columnBreakIndex + 1,
      );
    });
  });
});
