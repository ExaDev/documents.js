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

// The write side's XML-shape suite: what writeOdsContent actually emits, construct by construct -- the sibling suite (write-round-trip.test.ts) proves the output reads back as the document it came from; this one proves the output is the ODF a real consumer expects, which a round trip through this package's own reader cannot (a writer and reader that agreed on the same wrong spelling would round-trip perfectly and open nowhere). This mirrors typed/odt/write.test.ts's own stated split of responsibility.

const MARGINS = { topPt: 36, rightPt: 36, bottomPt: 36, leftPt: 36 };

const DEFAULT_PRINT_SETTINGS = {
  pageSize: PAGE_SIZE_A4,
  margins: MARGINS,
  gridlines: false,
  headers: false,
  pageOrder: "downThenOver" as const,
};

function sheetOf(
  cells: ContentSheetCell[],
  overrides: Partial<ContentSheet> = {},
): ContentSheet {
  return {
    name: "Sheet1",
    cells,
    columns: [],
    rows: [],
    images: [],
    printSettings: DEFAULT_PRINT_SETTINGS,
    ...overrides,
  };
}

function documentOf(sheets: ContentSheet[]): ContentDocument {
  return { kind: "spreadsheet", metadata: {}, sheets };
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
    // anchor cell, one compressed filler run, the far cell -- not 21 individual elements.
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
