import { describe, expect, it } from "vitest";
import { decodePackage } from "odf.js";
import type { ContentDocument } from "document-schema.js";
import {
  decoratedOdsBytes,
  gridOdsBytes,
  minimalOdsBytes,
  minimalOdsPackage,
  richOdsBytes,
} from "./ods";
import { readOdsContent } from "../odf/ods/read";
const CM_TO_PT = 72 / 2.54;

type SpreadsheetDocument = Extract<ContentDocument, { kind: "spreadsheet" }>;

function readSheet(bytes: Uint8Array<ArrayBuffer>): SpreadsheetDocument {
  const document = readOdsContent(decodePackage(bytes));
  if (document.kind !== "spreadsheet") {
    throw new Error(`expected a spreadsheet document, got ${document.kind}`);
  }
  return document;
}

const minimalDocument = () => readSheet(minimalOdsBytes());
const gridDocument = () => readSheet(gridOdsBytes());
const richDocument = () => readSheet(richOdsBytes());
const decoratedDocument = () => readSheet(decoratedOdsBytes());

describe("minimalOdsBytes: the base fixture, decoded", () => {
  it("carries its dc:title through to document metadata", () => {
    expect(minimalDocument().metadata).toEqual({ title: "My Spreadsheet" });
  });

  it("holds exactly one sheet, named Data", () => {
    const sheets = minimalDocument().sheets;
    expect(sheets).toHaveLength(1);
    expect(sheets[0]?.name).toBe("Data");
  });

  it("decodes every cell with its exact position, value kind and display text", () => {
    expect(minimalDocument().sheets[0]?.cells).toEqual([
      {
        row: 0,
        column: 0,
        value: { kind: "string", value: "Name" },
        displayText: "Name",
        runs: [{ text: "Name" }],
      },
      {
        row: 0,
        column: 1,
        value: { kind: "string", value: "Amount" },
        displayText: "Amount",
        runs: [{ text: "Amount" }],
      },
      {
        row: 1,
        column: 0,
        value: { kind: "string", value: "Acme" },
        displayText: "Acme",
        runs: [{ text: "Acme" }],
      },
      {
        row: 1,
        column: 1,
        value: { kind: "number", value: 123.45 },
        displayText: "123.45",
        runs: [{ text: "123.45" }],
      },
      {
        row: 2,
        column: 0,
        value: { kind: "string", value: "Merged" },
        displayText: "Merged",
        runs: [{ text: "Merged" }],
        colSpan: 2,
      },
    ]);
  });

  it("declares column A at 3cm, column B at 2cm and hidden", () => {
    const columns = minimalDocument().sheets[0]?.columns ?? [];
    expect(columns).toHaveLength(2);
    expect(columns[0]?.index).toBe(0);
    expect(columns[0]?.widthPt).toBeCloseTo(3 * CM_TO_PT, 9);
    expect(columns[0]?.hidden).toBeUndefined();
    expect(columns[1]?.index).toBe(1);
    expect(columns[1]?.widthPt).toBeCloseTo(2 * CM_TO_PT, 9);
    expect(columns[1]?.hidden).toBe(true);
  });

  it("leaves every row at odf.js's own default height, one entry per row", () => {
    expect(minimalDocument().sheets[0]?.rows).toEqual([
      { index: 0, heightPt: 15 },
      { index: 1, heightPt: 15 },
      { index: 2, heightPt: 15 },
    ]);
  });

  it("resolves print settings through the full table style to master page to page-layout chain", () => {
    const printSettings = minimalDocument().sheets[0]?.printSettings;
    expect(printSettings?.pageSize).toEqual({ widthPt: 400, heightPt: 300 });
    expect(printSettings?.margins.topPt).toBeCloseTo(2 * CM_TO_PT, 9);
    expect(printSettings?.margins.rightPt).toBeCloseTo(2 * CM_TO_PT, 9);
    expect(printSettings?.margins.bottomPt).toBeCloseTo(2 * CM_TO_PT, 9);
    expect(printSettings?.margins.leftPt).toBeCloseTo(2 * CM_TO_PT, 9);
    expect(printSettings?.gridlines).toBe(true);
    expect(printSettings?.headers).toBe(true);
    expect(printSettings?.pageOrder).toBe("downThenOver");
    expect(minimalDocument().sheets[0]?.images).toEqual([]);
  });
});

describe("minimalOdsPackage: the decoded-package form", () => {
  it("round-trips the bytes into a package with exactly the four standard parts", () => {
    const parts = Object.keys(minimalOdsPackage().parts).sort();
    expect(parts).toEqual([
      "content.xml",
      "meta.xml",
      "mimetype",
      "styles.xml",
    ]);
  });
});

describe("gridOdsBytes: the gridline-lattice fixture, decoded", () => {
  it("carries its own title and one Grid sheet of nine string cells", () => {
    expect(gridDocument().metadata).toEqual({ title: "Grid Spreadsheet" });
    const sheets = gridDocument().sheets;
    expect(sheets).toHaveLength(1);
    expect(sheets[0]?.name).toBe("Grid");
    expect(
      gridDocument().sheets[0]?.cells.map((cell) => cell.displayText),
    ).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
      "One",
      "Two",
      "Three",
      "Four",
      "Five",
      "Six",
    ]);
  });

  it("gives all three columns the same explicit 2cm width and none a hidden flag", () => {
    const columns = gridDocument().sheets[0]?.columns ?? [];
    expect(columns).toHaveLength(3);
    for (const [index, column] of columns.entries()) {
      expect(column.index).toBe(index);
      expect(column.widthPt).toBeCloseTo(2 * CM_TO_PT, 9);
      expect(column.hidden).toBeUndefined();
    }
  });

  it("gives all three rows the same explicit 0.6cm height", () => {
    const rows = gridDocument().sheets[0]?.rows ?? [];
    expect(rows).toHaveLength(3);
    for (const [index, row] of rows.entries()) {
      expect(row.index).toBe(index);
      expect(row.heightPt).toBeCloseTo(0.6 * CM_TO_PT, 9);
    }
  });

  it("enables both gridlines and headers via style:print", () => {
    const printSettings = gridDocument().sheets[0]?.printSettings;
    expect(printSettings?.gridlines).toBe(true);
    expect(printSettings?.headers).toBe(true);
    expect(printSettings?.pageSize).toEqual({ widthPt: 400, heightPt: 300 });
    expect(printSettings?.pageOrder).toBe("downThenOver");
  });
});

describe("richOdsBytes: the every-value-type fixture, decoded", () => {
  const cells = () => richDocument().sheets[0]?.cells ?? [];

  it("carries its own title and one Rich sheet", () => {
    expect(richDocument().metadata).toEqual({ title: "Rich Spreadsheet" });
    const sheets = richDocument().sheets;
    expect(sheets).toHaveLength(1);
    expect(sheets[0]?.name).toBe("Rich");
  });

  it("decodes the header and float/boolean data row exactly", () => {
    expect(cells().slice(0, 6)).toEqual([
      {
        row: 0,
        column: 0,
        value: { kind: "string", value: "Name" },
        displayText: "Name",
        runs: [{ text: "Name" }],
      },
      {
        row: 0,
        column: 1,
        value: { kind: "string", value: "Amount" },
        displayText: "Amount",
        runs: [{ text: "Amount" }],
      },
      {
        row: 0,
        column: 2,
        value: { kind: "string", value: "Active" },
        displayText: "Active",
        runs: [{ text: "Active" }],
      },
      {
        row: 1,
        column: 0,
        value: { kind: "string", value: "Widget" },
        displayText: "Widget",
        runs: [{ text: "Widget" }],
      },
      {
        row: 1,
        column: 1,
        value: { kind: "number", value: 42.5 },
        displayText: "42.5",
        runs: [{ text: "42.5" }],
      },
      {
        row: 1,
        column: 2,
        value: { kind: "boolean", value: true },
        displayText: "TRUE",
        runs: [{ text: "TRUE" }],
      },
    ]);
  });

  it("decodes the percentage, currency and date row with each kind's own fields", () => {
    expect(cells().slice(6, 9)).toEqual([
      {
        row: 2,
        column: 0,
        value: { kind: "percentage", value: 0.15 },
        displayText: "15%",
        runs: [{ text: "15%" }],
      },
      {
        row: 2,
        column: 1,
        value: { kind: "currency", value: 9.99, currency: "USD" },
        displayText: "$9.99",
        runs: [{ text: "$9.99" }],
      },
      {
        row: 2,
        column: 2,
        value: { kind: "date", value: "2026-01-15" },
        displayText: "2026-01-15",
        runs: [{ text: "2026-01-15" }],
      },
    ]);
  });

  it("decodes the time value verbatim in ODF's own duration spelling, and the formula cell with its cached float and verbatim formula", () => {
    expect(cells().slice(9, 11)).toEqual([
      {
        row: 3,
        column: 0,
        value: { kind: "time", value: "PT14H30M00S" },
        displayText: "14:30",
        runs: [{ text: "14:30" }],
      },
      {
        row: 3,
        column: 1,
        value: { kind: "number", value: 85 },
        displayText: "85",
        formula: "of:=[.B2]*2",
        runs: [{ text: "85" }],
      },
    ]);
  });

  it("ends on the genuine two-column merge", () => {
    expect(cells().slice(11)).toEqual([
      {
        row: 4,
        column: 0,
        value: { kind: "string", value: "Merged Cell" },
        displayText: "Merged Cell",
        runs: [{ text: "Merged Cell" }],
        colSpan: 2,
      },
    ]);
  });

  it("declares the three distinct explicit widths 3cm, 4cm and 2cm", () => {
    const columns = richDocument().sheets[0]?.columns ?? [];
    expect(columns).toHaveLength(3);
    expect(columns[0]?.widthPt).toBeCloseTo(3 * CM_TO_PT, 9);
    expect(columns[1]?.widthPt).toBeCloseTo(4 * CM_TO_PT, 9);
    expect(columns[2]?.widthPt).toBeCloseTo(2 * CM_TO_PT, 9);
  });

  it("leaves all five rows at the default height", () => {
    const rows = richDocument().sheets[0]?.rows ?? [];
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.heightPt).toBe(15);
    }
  });
});

describe("decoratedOdsBytes: the per-cell decoration fixture, decoded", () => {
  const cells = () => decoratedDocument().sheets[0]?.cells ?? [];

  it("carries no metadata and one Decorated sheet of exactly two cells", () => {
    expect(decoratedDocument().metadata).toEqual({});
    const sheets = decoratedDocument().sheets;
    expect(sheets).toHaveLength(1);
    expect(sheets[0]?.name).toBe("Decorated");
    expect(cells()).toHaveLength(2);
  });

  it("gives A1 the yellow background, the full blue border shorthand, right alignment and top vertical alignment", () => {
    expect(cells()[0]).toEqual({
      row: 0,
      column: 0,
      value: { kind: "string", value: "A" },
      displayText: "A",
      runs: [{ text: "A" }],
      background: { kind: "solid", color: { r: 1, g: 1, b: 0 } },
      borders: {
        left: { color: { r: 0, g: 0, b: 1 }, widthPt: 2, style: "solid" },
        right: { color: { r: 0, g: 0, b: 1 }, widthPt: 2, style: "solid" },
        top: { color: { r: 0, g: 0, b: 1 }, widthPt: 2, style: "solid" },
        bottom: { color: { r: 0, g: 0, b: 1 }, widthPt: 2, style: "solid" },
      },
      alignment: "right",
      verticalAlignment: "top",
    });
  });

  it("gives B1 only a red bottom border, with no background and no alignment of its own", () => {
    expect(cells()[1]).toEqual({
      row: 0,
      column: 1,
      value: { kind: "string", value: "B" },
      displayText: "B",
      runs: [{ text: "B" }],
      borders: {
        bottom: { color: { r: 1, g: 0, b: 0 }, widthPt: 1, style: "solid" },
      },
    });
  });

  it("shares one 3cm column style across both columns and one 1cm row height", () => {
    const columns = decoratedDocument().sheets[0]?.columns ?? [];
    expect(columns).toHaveLength(2);
    expect(columns[0]?.widthPt).toBeCloseTo(3 * CM_TO_PT, 9);
    expect(columns[1]?.widthPt).toBeCloseTo(3 * CM_TO_PT, 9);
    const rows = decoratedDocument().sheets[0]?.rows ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.heightPt).toBeCloseTo(1 * CM_TO_PT, 9);
  });

  it("omits style:print entirely, so gridlines and headers both read back false", () => {
    const printSettings = decoratedDocument().sheets[0]?.printSettings;
    expect(printSettings?.gridlines).toBe(false);
    expect(printSettings?.headers).toBe(false);
    expect(printSettings?.pageSize).toEqual({ widthPt: 400, heightPt: 300 });
  });
});
