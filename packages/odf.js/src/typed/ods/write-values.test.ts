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
import { decodeXmlText } from "../../xml/entities";
import { buildXml } from "../../xml/build";
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

function firstCell(pkg: Package): XmlElement {
  return childrenWithTag(
    childrenWithTag(firstTable(pkg), "table:table-row")[0]!,
    "table:table-cell",
  )[0]!;
}

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
    const RGB_CHANNEL_MAX = 255;
    const quantizedRed = 99;
    const quantizedGreen = 190;
    const quantizedBlue = 123;
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
              color: {
                r: quantizedRed / RGB_CHANNEL_MAX,
                g: quantizedGreen / RGB_CHANNEL_MAX,
                b: quantizedBlue / RGB_CHANNEL_MAX,
              },
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
    // The classic floating-point imprecision case: 0.1 + 0.2 !== 0.3 in IEEE 754 double precision, which is exactly why exactValue's own decimal string must win.
    const firstAddend = 0.1;
    const secondAddend = 0.2;
    const impreciseFloatSum = firstAddend + secondAddend;
    const pkg = writeOdsContent(
      documentOf([
        sheetOf([
          {
            row: 0,
            column: 0,
            value: {
              kind: "number",
              value: impreciseFloatSum,
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
