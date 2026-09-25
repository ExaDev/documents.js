import type {
  ContentCellValue,
  ContentSheet,
  ContentSheetCell,
  ContentSheetPrintSettings,
} from "document-schema.js";
import {
  ContentDocumentSchema,
  PAGE_SIZE_LETTER,
  rgbHexToColor,
} from "document-schema.js";
import { readCompoundFile } from "archive-codec";
import { describe, expect, it } from "vitest";

import {} from "./biff/record-types";
import {} from "./biff/records";
import {} from "./biff/xf-colors";
import { BiffWriteError } from "./biff/write-errors";
import type { XlsContentDocument } from "./content";
import { assertNeverContentCellValueKind, readXlsContent } from "./content";
import {} from "./container";
import { writeXlsContent } from "./write";
import {} from "./workbook/conditional-format-write";
import {} from "./workbook/data-validation-write";
import {} from "./workbook/sheet-writer";
import {} from "./workbook/globals-writer";

// Genuine .xls bytes — a real [MS-CFB] compound file holding a real BIFF8 Workbook stream — built by this package's own writer and read back through its own reader, the "primary verification method" this session's writers use throughout (the CFB writer, rtf-codec, wpd-codec). Every test here is a round trip: build a ContentDocument, write it, read it back, and check the read result reflects what was written — exercising the writer against a reader whose own correctness is independently pinned by content.test.ts's hand-built byte sequences.

const POINTS_PER_INCH = 72;
/** Excel's own "Normal" preset, which is what a sheet with nothing else to say about printing carries — and, since the reader falls back to exactly these values for a file stating none of the print records, what a round trip through this pair reproduces either way. The print-settings round trips at the end of this file are the ones that exercise real, non-default values. */
const PRINT_SETTINGS: ContentSheetPrintSettings = {
  pageSize: PAGE_SIZE_LETTER,
  margins: {
    topPt: 0.75 * POINTS_PER_INCH,
    rightPt: 0.7 * POINTS_PER_INCH,
    bottomPt: 0.75 * POINTS_PER_INCH,
    leftPt: 0.7 * POINTS_PER_INCH,
  },
  gridlines: false,
  headers: false,
  pageOrder: "downThenOver",
};

function sheet(
  name: string,
  cells: readonly ContentSheetCell[],
  overrides: Partial<Omit<ContentSheet, "name" | "cells">> = {},
): ContentSheet {
  return {
    name,
    cells: [...cells],
    columns: [],
    rows: [],
    images: [],
    printSettings: PRINT_SETTINGS,
    ...overrides,
  };
}

function cell(
  row: number,
  column: number,
  value: ContentCellValue,
  extra: Partial<ContentSheetCell> = {},
): ContentSheetCell {
  return { row, column, value, displayText: displayTextFor(value), ...extra };
}

/** Mirrors content.ts's own private displayTextOf exactly, so a test fixture's displayText is what a real reader would also produce for the same value — required because ContentSheetCellSchema documents displayText as always present. */
function displayTextFor(value: ContentCellValue): string {
  switch (value.kind) {
    case "number":
    case "percentage":
    case "currency":
      return String(value.value);
    case "boolean":
      return value.value ? "TRUE" : "FALSE";
    case "date":
    case "time":
    case "dateTime":
    case "string":
    case "error":
      return value.value;
    case "empty":
      return "";
  }
  return assertNeverContentCellValueKind(value);
}

function document(sheets: readonly ContentSheet[]): XlsContentDocument {
  return { kind: "spreadsheet", metadata: {}, sheets: [...sheets] };
}

function findCell(
  content: ReturnType<typeof readXlsContent>,
  sheetIndex: number,
  row: number,
  column: number,
): ContentSheetCell | undefined {
  return content.sheets[sheetIndex]?.cells.find(
    (candidate) => candidate.row === row && candidate.column === column,
  );
}

describe("writeXlsContent (continued)", () => {
  it("round-trips a decorated-alignment-only empty cell through a real Blank record", () => {
    // No value and no fill/border either — alignment alone is what makes this cell worth a Blank record, mirroring the equivalent decoration-only empty-cell test above.
    const bytes = writeXlsContent(
      document([
        sheet("Sheet1", [
          cell(1, 2, { kind: "empty" }, { alignment: "center" }),
        ]),
      ]),
    );
    const readBack = findCell(readXlsContent(bytes), 0, 1, 2);
    expect(readBack?.value).toStrictEqual({ kind: "empty" });
    expect(readBack?.alignment).toBe("center");
  });

  it("round-trips a border-only empty cell through a real Blank record, with neither fill nor alignment involved", () => {
    // Isolates the borders leg of mapCell's own blank-drop conjunction from every sibling leg (background/alignment/verticalAlignment/font) — a cell whose ONLY reason to survive is its own border must still survive when nothing else about it is decorated.
    const border = { color: rgbHexToColor("0000ff"), widthPt: 0.75 } as const;
    const bytes = writeXlsContent(
      document([
        sheet("Sheet1", [
          cell(1, 2, { kind: "empty" }, { borders: { left: border } }),
        ]),
      ]),
    );
    const readBack = findCell(readXlsContent(bytes), 0, 1, 2);
    expect(readBack?.value).toStrictEqual({ kind: "empty" });
    expect(readBack?.borders).toStrictEqual({ left: border });
  });

  it("round-trips a vertical-alignment-only empty cell through a real Blank record, with neither fill nor a border involved", () => {
    // Isolates the verticalAlignment leg of mapCell's own blank-drop conjunction from every sibling leg — a cell whose ONLY reason to survive is its own vertical alignment must still survive when nothing else about it is decorated.
    const bytes = writeXlsContent(
      document([
        sheet("Sheet1", [
          cell(1, 2, { kind: "empty" }, { verticalAlignment: "top" }),
        ]),
      ]),
    );
    const readBack = findCell(readXlsContent(bytes), 0, 1, 2);
    expect(readBack?.value).toStrictEqual({ kind: "empty" });
    expect(readBack?.verticalAlignment).toBe("top");
  });

  it("still writes nothing for an empty cell carrying no alignment either", () => {
    const bytes = writeXlsContent(
      document([sheet("Sheet1", [cell(1, 1, { kind: "empty" })])]),
    );
    expect(findCell(readXlsContent(bytes), 0, 1, 1)).toBeUndefined();
  });

  it("reuses one XF entry for two cells sharing the identical alignment, and mints a separate one for a cell with none", () => {
    const bytes = writeXlsContent(
      document([
        sheet("Sheet1", [
          cell(0, 0, { kind: "number", value: 1 }, { alignment: "right" }),
          cell(0, 1, { kind: "number", value: 2 }, { alignment: "right" }),
          cell(0, 2, { kind: "number", value: 3 }),
        ]),
      ]),
    );
    const content = readXlsContent(bytes);
    expect(findCell(content, 0, 0, 0)?.alignment).toBe("right");
    expect(findCell(content, 0, 0, 1)?.alignment).toBe("right");
    expect(findCell(content, 0, 0, 2)?.alignment).toBeUndefined();
  });
});

it("round-trips a merged range whose anchor carries a real value", () => {
  const bytes = writeXlsContent(
    document([
      sheet("Sheet1", [
        cell(
          2,
          2,
          { kind: "string", value: "Merged" },
          { colSpan: 2, rowSpan: 1 },
        ),
      ]),
    ]),
  );
  const readBack = findCell(readXlsContent(bytes), 0, 2, 2);
  expect(readBack?.value).toStrictEqual({ kind: "string", value: "Merged" });
  expect(readBack?.colSpan).toBe(2);
  expect(readBack?.rowSpan).toBeUndefined();
});

it("round-trips a merged range whose anchor is empty, reconstructed from MergeCells alone", () => {
  const bytes = writeXlsContent(
    document([
      sheet("Sheet1", [
        cell(
          3,
          0,
          { kind: "empty" },
          { colSpan: 2, rowSpan: 2, displayText: "" },
        ),
      ]),
    ]),
  );
  const readBack = findCell(readXlsContent(bytes), 0, 3, 0);
  expect(readBack?.value).toStrictEqual({ kind: "empty" });
  expect(readBack?.colSpan).toBe(2);
  expect(readBack?.rowSpan).toBe(2);
});

it("round-trips declared row heights and hidden rows", () => {
  const bytes = writeXlsContent(
    document([
      sheet("Sheet1", [cell(0, 0, { kind: "number", value: 1 })], {
        rows: [
          { index: 0, heightPt: 30 },
          { index: 5, hidden: true },
        ],
      }),
    ]),
  );
  const content = readXlsContent(bytes);
  const row0 = content.sheets[0]?.rows.find((row) => row.index === 0);
  const row5 = content.sheets[0]?.rows.find((row) => row.index === 5);
  // toStrictEqual, not just a per-field .toBe: a row carrying only heightPt must not also carry a spuriously-materialised hidden key (and vice versa for row5), which a per-field check reading only the key it expects would miss entirely.
  expect(row0).toStrictEqual({ index: 0, heightPt: 30 });
  expect(row5).toStrictEqual({ index: 5, hidden: true });
});

it("round-trips declared column widths and hidden columns", () => {
  const bytes = writeXlsContent(
    document([
      sheet("Sheet1", [cell(0, 0, { kind: "number", value: 1 })], {
        columns: [
          { index: 0, widthPt: 100 },
          { index: 3, hidden: true },
        ],
      }),
    ]),
  );
  const content = readXlsContent(bytes);
  const column0 = content.sheets[0]?.columns.find((col) => col.index === 0);
  const column3 = content.sheets[0]?.columns.find((col) => col.index === 3);
  // toStrictEqual on the width, not just .toBeCloseTo: a column carrying only widthPt must not also carry a spuriously-materialised hidden key, which a per-field check reading only widthPt would miss entirely. column3 always round-trips with SOME widthPt too — a real ColInfo record always states a column's own width, whether or not the document that produced it declared one — so hidden alone is confirmed directly instead.
  expect(column0?.widthPt).toBeCloseTo(100, 0);
  expect(column0).toStrictEqual({ index: 0, widthPt: column0?.widthPt });
  expect(column3?.hidden).toBe(true);
});

it("round-trips several sheets, preserving name and tab order", () => {
  const bytes = writeXlsContent(
    document([
      sheet("First", [cell(0, 0, { kind: "number", value: 1 })]),
      sheet("Second", [cell(0, 0, { kind: "number", value: 2 })]),
      sheet("Third", [cell(0, 0, { kind: "number", value: 3 })]),
    ]),
  );
  const content = readXlsContent(bytes);
  expect(content.sheets.map((s) => s.name)).toStrictEqual([
    "First",
    "Second",
    "Third",
  ]);
  expect(findCell(content, 0, 0, 0)?.value).toStrictEqual({
    kind: "number",
    value: 1,
  });
  expect(findCell(content, 1, 0, 0)?.value).toStrictEqual({
    kind: "number",
    value: 2,
  });
  expect(findCell(content, 2, 0, 0)?.value).toStrictEqual({
    kind: "number",
    value: 3,
  });
});

it("writes a sheet with no cells at all", () => {
  const bytes = writeXlsContent(document([sheet("Empty", [])]));
  const content = readXlsContent(bytes);
  expect(content.sheets[0]?.name).toBe("Empty");
  expect(content.sheets[0]?.cells).toStrictEqual([]);
});

it("produces a document valid against document-schema.js's own ContentDocumentSchema", () => {
  const bytes = writeXlsContent(
    document([
      sheet("Sheet1", [
        cell(0, 0, { kind: "number", value: 1 }),
        cell(0, 1, { kind: "string", value: "text" }),
      ]),
    ]),
  );
  const content = readXlsContent(bytes);
  expect(() => ContentDocumentSchema.parse(content)).not.toThrow();
});

it("refuses a document with no sheets", () => {
  expect(() => writeXlsContent(document([]))).toThrow(BiffWriteError);
});

it("refuses a cell outside BIFF8's own row/column grid", () => {
  expect(() =>
    writeXlsContent(
      document([sheet("Sheet1", [cell(0, 256, { kind: "number", value: 1 })])]),
    ),
  ).toThrow(/outside BIFF8's own grid/);
});

it("refuses a cell whose row alone is outside the grid", () => {
  expect(() =>
    writeXlsContent(
      document([
        sheet("Sheet1", [cell(65536, 0, { kind: "number", value: 1 })]),
      ]),
    ),
  ).toThrow(BiffWriteError);
});

it("accepts a cell exactly at BIFF8's own last row and column", () => {
  expect(() =>
    writeXlsContent(
      document([
        sheet("Sheet1", [cell(65535, 255, { kind: "number", value: 1 })]),
      ]),
    ),
  ).not.toThrow();
});

it("leaves rows and columns empty for a sheet whose cells carry no declared row/column metadata", () => {
  const bytes = writeXlsContent(
    document([
      sheet("Sheet1", [
        cell(0, 0, { kind: "number", value: 1 }),
        cell(3, 2, { kind: "number", value: 2 }),
      ]),
    ]),
  );
  const content = readXlsContent(bytes);
  expect(content.sheets[0]?.rows).toStrictEqual([]);
  expect(content.sheets[0]?.columns).toStrictEqual([]);
});

it("leaves dataValidations and conditionalFormats entirely absent for a sheet declaring neither", () => {
  // Own-property check, not a value check: a bug materialising either key with an explicit empty-array value would pass a plain .toStrictEqual([]) assertion just as easily as a genuinely absent key would.
  const bytes = writeXlsContent(
    document([sheet("Sheet1", [cell(0, 0, { kind: "number", value: 1 })])]),
  );
  const content = readXlsContent(bytes);
  expect(Object.hasOwn(content.sheets[0] ?? {}, "dataValidations")).toBe(false);
  expect(Object.hasOwn(content.sheets[0] ?? {}, "conditionalFormats")).toBe(
    false,
  );
});

it("round-trips a merge spanning only rows, and one spanning only columns", () => {
  const bytes = writeXlsContent(
    document([
      sheet("Sheet1", [
        cell(0, 0, { kind: "number", value: 1 }, { rowSpan: 2 }),
        cell(2, 0, { kind: "number", value: 2 }, { colSpan: 2 }),
      ]),
    ]),
  );
  const content = readXlsContent(bytes);
  expect(findCell(content, 0, 0, 0)?.rowSpan).toBe(2);
  expect(findCell(content, 0, 0, 0)?.colSpan).toBeUndefined();
  expect(findCell(content, 0, 2, 0)?.colSpan).toBe(2);
  expect(findCell(content, 0, 2, 0)?.rowSpan).toBeUndefined();
});

describe("per-cell fonts", () => {
  it("round-trips a workbook mixing several distinct cell fonts with plain cells", () => {
    const bytes = writeXlsContent(
      document([
        sheet("Sheet1", [
          // A cell stating no font of its own — it must read back with no font field, referencing the Normal font's own table entry rather than restating it.
          cell(0, 0, { kind: "string", value: "plain" }),
          cell(
            0,
            1,
            { kind: "string", value: "bold" },
            { font: { bold: true } },
          ),
          cell(
            0,
            2,
            { kind: "string", value: "italic small" },
            { font: { italic: true, sizePt: 8 } },
          ),
          cell(
            0,
            3,
            { kind: "string", value: "typed" },
            {
              font: {
                fontFamily: "Courier New",
                underline: true,
                strike: true,
                color: { r: 1, g: 0, b: 0 },
              },
            },
          ),
        ]),
      ]),
    );
    const content = readXlsContent(bytes);
    expect(findCell(content, 0, 0, 0)?.font).toBeUndefined();
    expect(findCell(content, 0, 0, 1)?.font).toStrictEqual({ bold: true });
    expect(findCell(content, 0, 0, 2)?.font).toStrictEqual({
      italic: true,
      sizePt: 8,
    });
    // icv 10 is the default palette's own duplicate of Red, which is what a { r: 1, g: 0, b: 0 } colour resolves to without forcing a Palette record — the identical quantisation the fill round trips already pin.
    expect(findCell(content, 0, 0, 3)?.font).toStrictEqual({
      fontFamily: "Courier New",
      underline: true,
      strike: true,
      color: { r: 1, g: 0, b: 0 },
    });
  });

  it("shares one font-table entry between two cells stating the same font, in either sheet", () => {
    const bytes = writeXlsContent(
      document([
        sheet("First", [
          cell(0, 0, { kind: "number", value: 1 }, { font: { bold: true } }),
        ]),
        sheet("Second", [
          cell(0, 0, { kind: "number", value: 2 }, { font: { bold: true } }),
        ]),
      ]),
    );
    const content = readXlsContent(bytes);
    expect(findCell(content, 0, 0, 0)?.font).toStrictEqual({ bold: true });
    expect(findCell(content, 1, 0, 0)?.font).toStrictEqual({ bold: true });
  });

  it("round-trips a font combined with a fill on the same cell, through the XF the two share", () => {
    const bytes = writeXlsContent(
      document([
        sheet("Sheet1", [
          cell(
            0,
            0,
            { kind: "string", value: "loud" },
            {
              font: { bold: true },
              background: { kind: "solid", color: { r: 1, g: 0, b: 0 } },
            },
          ),
        ]),
      ]),
    );
    const readBack = findCell(readXlsContent(bytes), 0, 0, 0);
    expect(readBack?.font).toStrictEqual({ bold: true });
    expect(readBack?.background).toStrictEqual({
      kind: "solid",
      color: { r: 1, g: 0, b: 0 },
    });
  });

  it("round-trips an empty cell whose only formatting is a font, as the Blank record that font earns", () => {
    const bytes = writeXlsContent(
      document([
        sheet("Sheet1", [
          cell(0, 0, { kind: "empty" }, { font: { bold: true } }),
        ]),
      ]),
    );
    const readBack = findCell(readXlsContent(bytes), 0, 0, 0);
    expect(readBack?.value).toStrictEqual({ kind: "empty" });
    expect(readBack?.font).toStrictEqual({ bold: true });
  });

  it("writes no font of a cell's own for a ContentFont that merely restates the Normal font's values", () => {
    const bytes = writeXlsContent(
      document([
        sheet("Sheet1", [
          cell(0, 0, { kind: "number", value: 1 }, { font: {} }),
          cell(
            0,
            1,
            { kind: "number", value: 2 },
            { font: { bold: false, fontFamily: "Arial", sizePt: 10 } },
          ),
        ]),
      ]),
    );
    const content = readXlsContent(bytes);
    expect(findCell(content, 0, 0, 0)?.font).toBeUndefined();
    expect(findCell(content, 0, 0, 1)?.font).toBeUndefined();
  });

  it("refuses a font height outside dyHeight's own 20-8191 twip range", () => {
    expect(() =>
      writeXlsContent(
        document([
          sheet("Sheet1", [
            cell(0, 0, { kind: "number", value: 1 }, { font: { sizePt: 0.5 } }),
          ]),
        ]),
      ),
    ).toThrow(BiffWriteError);
  });
});

describe("defined names written", () => {
  it("round-trips a workbook-scoped and a sheet-scoped named range", () => {
    const bytes = writeXlsContent({
      ...document([
        sheet("Sheet1", [cell(0, 0, { kind: "number", value: 1 })]),
        sheet("Sheet2", [cell(1, 2, { kind: "number", value: 2 })]),
      ]),
      names: [
        { name: "SalesData", refersTo: "Sheet1!$A$1:$B$2" },
        { name: "LocalRange", refersTo: "Sheet2!$C$2", scopeSheetIndex: 1 },
      ],
    });
    expect(readXlsContent(bytes).names).toStrictEqual([
      { name: "SalesData", refersTo: "Sheet1!$A$1:$B$2" },
      {
        name: "LocalRange",
        refersTo: "Sheet2!$C$2:$C$2",
        scopeSheetIndex: 1,
      },
    ]);
  });

  it("round-trips a relative reference and a quoted sheet name, each preserving its own spelling", () => {
    const bytes = writeXlsContent({
      ...document([sheet("My Sheet", []), sheet("Other", [])]),
      names: [
        // A relative coordinate is genuine formula semantics, not a display detail, so the $ markers survive verbatim through the ColRelU relative bits.
        { name: "Rel", refersTo: "'My Sheet'!A1:B2" },
        { name: "Abs", refersTo: "Other!$A$1" },
      ],
    });
    expect(readXlsContent(bytes).names).toStrictEqual([
      { name: "Rel", refersTo: "'My Sheet'!A1:B2" },
      { name: "Abs", refersTo: "Other!$A$1:$A$1" },
    ]);
  });

  it("round-trips a non-print built-in under its single-character built-in encoding", () => {
    const bytes = writeXlsContent({
      ...document([sheet("Sheet1", [])]),
      names: [
        {
          name: "_xlnm._FilterDatabase",
          refersTo: "Sheet1!$A$1:$C$1",
          scopeSheetIndex: 0,
        },
      ],
    });
    expect(readXlsContent(bytes).names).toStrictEqual([
      {
        name: "_xlnm._FilterDatabase",
        refersTo: "Sheet1!$A$1:$C$1",
        scopeSheetIndex: 0,
      },
    ]);
  });

  it("refuses a refersTo outside the sheet-qualified reference vocabulary", () => {
    expect(() =>
      writeXlsContent({
        ...document([sheet("Sheet1", [])]),
        names: [{ name: "Total", refersTo: "SUM(Sheet1!$A$1:$A$9)" }],
      }),
    ).toThrow(BiffWriteError);
    expect(() =>
      writeXlsContent({
        ...document([sheet("Sheet1", [])]),
        names: [{ name: "Missing", refersTo: "Sheet9!$A$1" }],
      }),
    ).toThrow(BiffWriteError);
  });

  it("refuses the two print built-ins and a name shaped like a cell reference", () => {
    expect(() =>
      writeXlsContent({
        ...document([sheet("Sheet1", [])]),
        names: [{ name: "_xlnm.Print_Area", refersTo: "Sheet1!$A$1:$B$2" }],
      }),
    ).toThrow(BiffWriteError);
    expect(() =>
      writeXlsContent({
        ...document([sheet("Sheet1", [])]),
        names: [{ name: "A1", refersTo: "Sheet1!$A$1" }],
      }),
    ).toThrow(BiffWriteError);
  });

  it("refuses a name past Lbl's own 255-character cch field", () => {
    expect(() =>
      writeXlsContent({
        ...document([sheet("Sheet1", [])]),
        names: [{ name: "x".repeat(256), refersTo: "Sheet1!$A$1" }],
      }),
    ).toThrow(BiffWriteError);
    expect(() =>
      writeXlsContent({
        ...document([sheet("Sheet1", [])]),
        names: [{ name: "x".repeat(255), refersTo: "Sheet1!$A$1" }],
      }),
    ).not.toThrow();
  });

  it("refuses a scopeSheetIndex past the end of the document's own sheets", () => {
    expect(() =>
      writeXlsContent({
        ...document([sheet("Sheet1", [])]),
        names: [
          {
            name: "Bad",
            refersTo: "Sheet1!$A$1",
            scopeSheetIndex: 1,
          },
        ],
      }),
    ).toThrow(BiffWriteError);
  });

  it("accepts a reference exactly at BIFF8's own grid boundary, and refuses one past it", () => {
    expect(() =>
      writeXlsContent({
        ...document([sheet("Sheet1", [])]),
        names: [{ name: "AtEdge", refersTo: "Sheet1!$A$65536" }],
      }),
    ).not.toThrow();
    expect(() =>
      writeXlsContent({
        ...document([sheet("Sheet1", [])]),
        names: [{ name: "PastEdge", refersTo: "Sheet1!$A$65537" }],
      }),
    ).toThrow(BiffWriteError);
  });
});

describe("metadata", () => {
  it('round-trips title/subject/author/keywords/dates through a real "\\x05SummaryInformation" stream', () => {
    const input: XlsContentDocument = {
      ...document([
        sheet("Sheet1", [cell(0, 0, { kind: "number", value: 1 })]),
      ]),
      metadata: {
        title: "Budget",
        subject: "Finance",
        author: "Joe",
        keywords: ["finance", "quarterly"],
        createdIso: "2024-01-15T09:00:00.000Z",
        modifiedIso: "2024-03-20T14:30:00.000Z",
      },
    };
    const bytes = writeXlsContent(input);
    expect(readXlsContent(bytes).metadata).toStrictEqual(input.metadata);
  });

  it('writes no "\\x05SummaryInformation" stream at all when metadata carries nothing that stream can hold', () => {
    const bytes = writeXlsContent(
      document([sheet("Sheet1", [cell(0, 0, { kind: "number", value: 1 })])]),
    );
    const streams = readCompoundFile(bytes);
    expect(
      streams.some((stream) => stream.path === "\x05SummaryInformation"),
    ).toBe(false);
    expect(readXlsContent(bytes).metadata).toStrictEqual({});
  });

  it("throws a BiffWriteError, not a raw RangeError, for a malformed createdIso", () => {
    const input: XlsContentDocument = {
      ...document([
        sheet("Sheet1", [cell(0, 0, { kind: "number", value: 1 })]),
      ]),
      metadata: { createdIso: "not-a-real-date" },
    };
    expect(() => writeXlsContent(input)).toThrow(BiffWriteError);
  });

  it("throws a BiffWriteError, not a raw RangeError, for a malformed modifiedIso", () => {
    const input: XlsContentDocument = {
      ...document([
        sheet("Sheet1", [cell(0, 0, { kind: "number", value: 1 })]),
      ]),
      metadata: { modifiedIso: "not-a-real-date" },
    };
    expect(() => writeXlsContent(input)).toThrow(BiffWriteError);
  });
});
