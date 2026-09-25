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

describe("writeOdsContent XML shapes", () => {
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
      const fourthRuleRow = 3;
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
                ranges: [rangeAt(fourthRuleRow)],
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
      expect(nameOfRow(2)).not.toBe(nameOfRow(fourthRuleRow));
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
