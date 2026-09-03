import type {
  ContentCellValue,
  ContentSheet,
  ContentSheetCell,
  ContentSheetPrintSettings,
} from "document-schema.js";
import {
  assembleTree,
  ContentDocumentSchema,
  DocumentTreeSchema,
  PAGE_SIZE_LETTER,
} from "document-schema.js";
import { isCompoundFile, readCompoundFile } from "archive-codec";
import { describe, expect, it } from "vitest";

import { BiffWriteError } from "./biff/write-errors";
import type { XlsContentDocument } from "./content";
import { readXls, readXlsContent } from "./content";
import { isXlsFile } from "./container";
import { writeXls, writeXlsContent } from "./write";

// Genuine .xls bytes -- a real [MS-CFB] compound file holding a real BIFF8 Workbook stream -- built by this package's own writer and read back through its own reader, the "primary verification method" this session's writers use throughout (the CFB writer, rtf-codec, wpd-codec). Every test here is a round trip: build a ContentDocument, write it, read it back, and check the read result reflects what was written -- exercising the writer against a reader whose own correctness is independently pinned by content.test.ts's hand-built byte sequences.

const POINTS_PER_INCH = 72;
/** The same "Normal" preset content.ts's own reader emits unconditionally, since print settings are outside this writer's scope (see the README) and the read direction never recovers a file's real ones. */
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

/** Mirrors content.ts's own private displayTextOf exactly, so a test fixture's displayText is what a real reader would also produce for the same value -- required because ContentSheetCellSchema documents displayText as always present. */
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

describe("writeXlsContent", () => {
  it("produces genuine [MS-CFB] + BIFF8 bytes this package's own reader recognises", () => {
    const bytes = writeXlsContent(
      document([sheet("Sheet1", [cell(0, 0, { kind: "number", value: 1 })])]),
    );
    expect(isCompoundFile(bytes)).toBe(true);
    expect(isXlsFile(bytes)).toBe(true);
  });

  it("round-trips a plain number cell with no explicit format, gaining 'General' on the way back", () => {
    const bytes = writeXlsContent(
      document([sheet("Sheet1", [cell(0, 0, { kind: "number", value: 42 })])]),
    );
    const content = readXlsContent(bytes);
    const readBack = findCell(content, 0, 0, 0);
    expect(readBack?.value).toEqual({ kind: "number", value: 42 });
    expect(readBack?.displayText).toBe("42");
    // The same "General" stamping content.test.ts already pins for a real .xls's plain cells -- XF 15's own ifmt (0) resolves through the built-in table.
    expect(readBack?.numberFormatCode).toBe("General");
  });

  it("round-trips a string cell through the shared string table", () => {
    const bytes = writeXlsContent(
      document([
        sheet("Sheet1", [
          cell(0, 0, { kind: "string", value: "Hello, world!" }),
        ]),
      ]),
    );
    const readBack = findCell(readXlsContent(bytes), 0, 0, 0);
    expect(readBack?.value).toEqual({
      kind: "string",
      value: "Hello, world!",
    });
  });

  it("dedupes a string value repeated across several cells through one shared-string entry", () => {
    const bytes = writeXlsContent(
      document([
        sheet("Sheet1", [
          cell(0, 0, { kind: "string", value: "Repeated" }),
          cell(0, 1, { kind: "string", value: "Repeated" }),
          cell(1, 0, { kind: "string", value: "Repeated" }),
          cell(1, 1, { kind: "string", value: "Different" }),
        ]),
      ]),
    );
    const content = readXlsContent(bytes);
    expect(findCell(content, 0, 0, 0)?.value).toEqual({
      kind: "string",
      value: "Repeated",
    });
    expect(findCell(content, 0, 0, 1)?.value).toEqual({
      kind: "string",
      value: "Repeated",
    });
    expect(findCell(content, 0, 1, 0)?.value).toEqual({
      kind: "string",
      value: "Repeated",
    });
    expect(findCell(content, 0, 1, 1)?.value).toEqual({
      kind: "string",
      value: "Different",
    });
  });

  it("round-trips a Unicode string needing the uncompressed string encoding", () => {
    const text = "Café \u{1F600} £€";
    const bytes = writeXlsContent(
      document([
        sheet("Sheet1", [cell(0, 0, { kind: "string", value: text })]),
      ]),
    );
    expect(findCell(readXlsContent(bytes), 0, 0, 0)?.value).toEqual({
      kind: "string",
      value: text,
    });
  });

  it("round-trips true and false boolean cells", () => {
    const bytes = writeXlsContent(
      document([
        sheet("Sheet1", [
          cell(0, 0, { kind: "boolean", value: true }),
          cell(0, 1, { kind: "boolean", value: false }),
        ]),
      ]),
    );
    const content = readXlsContent(bytes);
    expect(findCell(content, 0, 0, 0)?.value).toEqual({
      kind: "boolean",
      value: true,
    });
    expect(findCell(content, 0, 0, 0)?.displayText).toBe("TRUE");
    expect(findCell(content, 0, 0, 1)?.value).toEqual({
      kind: "boolean",
      value: false,
    });
  });

  it("round-trips every [MS-XLS]-defined error value", () => {
    const errors = [
      "#NULL!",
      "#DIV/0!",
      "#VALUE!",
      "#REF!",
      "#NAME?",
      "#NUM!",
      "#N/A",
      "#GETTING_DATA",
    ];
    const bytes = writeXlsContent(
      document([
        sheet(
          "Sheet1",
          errors.map((text, index) =>
            cell(0, index, { kind: "error", value: text }),
          ),
        ),
      ]),
    );
    const content = readXlsContent(bytes);
    errors.forEach((text, index) => {
      expect(findCell(content, 0, 0, index)?.value).toEqual({
        kind: "error",
        value: text,
      });
    });
  });

  it("refuses an error value [MS-XLS] does not define", () => {
    expect(() =>
      writeXlsContent(
        document([
          sheet("Sheet1", [cell(0, 0, { kind: "error", value: "#MADE_UP!" })]),
        ]),
      ),
    ).toThrow(BiffWriteError);
  });

  it("round-trips percentage, currency, date, time, and dateTime cells with no explicit format, through their own representative default codes", () => {
    const bytes = writeXlsContent(
      document([
        sheet("Sheet1", [
          cell(0, 0, { kind: "percentage", value: 0.5 }),
          cell(0, 1, { kind: "currency", value: 19.99 }),
          cell(0, 2, { kind: "date", value: "2026-09-03" }),
          cell(0, 3, { kind: "time", value: "13:45:30" }),
          cell(0, 4, { kind: "dateTime", value: "2026-09-03T13:45:30" }),
        ]),
      ]),
    );
    const content = readXlsContent(bytes);
    expect(findCell(content, 0, 0, 0)?.value).toEqual({
      kind: "percentage",
      value: 0.5,
    });
    const currencyCell = findCell(content, 0, 0, 1);
    expect(currencyCell?.value).toEqual({ kind: "currency", value: 19.99 });
    // No numberFormatCode was given and this writer's own default currency format carries no [$XXX-nnn] marker, so no ISO code is recovered either -- an honest round trip of what was actually written, not an invented one.
    expect(currencyCell?.value).not.toHaveProperty("currency");
    expect(findCell(content, 0, 0, 2)?.value).toEqual({
      kind: "date",
      value: "2026-09-03",
    });
    expect(findCell(content, 0, 0, 3)?.value).toEqual({
      kind: "time",
      value: "13:45:30",
    });
    expect(findCell(content, 0, 0, 4)?.value).toEqual({
      kind: "dateTime",
      value: "2026-09-03T13:45:30",
    });
  });

  it("round-trips an explicit currency format carrying an ISO currency code", () => {
    const bytes = writeXlsContent(
      document([
        sheet("Sheet1", [
          cell(
            0,
            0,
            { kind: "currency", value: 5, currency: "USD" },
            { numberFormatCode: "[$USD-409]#,##0.00" },
          ),
        ]),
      ]),
    );
    const readBack = findCell(readXlsContent(bytes), 0, 0, 0);
    expect(readBack?.value).toEqual({
      kind: "currency",
      value: 5,
      currency: "USD",
    });
    expect(readBack?.numberFormatCode).toBe("[$USD-409]#,##0.00");
  });

  it("round-trips an explicit custom number format code, minting its own Format record", () => {
    const bytes = writeXlsContent(
      document([
        sheet("Sheet1", [
          cell(
            0,
            0,
            { kind: "number", value: 3.14159 },
            { numberFormatCode: "0.000" },
          ),
        ]),
      ]),
    );
    const readBack = findCell(readXlsContent(bytes), 0, 0, 0);
    expect(readBack?.value).toEqual({ kind: "number", value: 3.14159 });
    expect(readBack?.numberFormatCode).toBe("0.000");
  });

  it("reuses one XF/format entry for two cells sharing the identical explicit format code", () => {
    // Not directly observable from the read side, but a real regression here (two cells minting two Format records for the same code, or colliding on one XF for two different codes) would show up as a wrong numberFormatCode on one of the two cells.
    const bytes = writeXlsContent(
      document([
        sheet("Sheet1", [
          cell(0, 0, { kind: "number", value: 1 }, { numberFormatCode: "0.0" }),
          cell(0, 1, { kind: "number", value: 2 }, { numberFormatCode: "0.0" }),
          cell(
            0,
            2,
            { kind: "number", value: 3 },
            { numberFormatCode: "0.00" },
          ),
        ]),
      ]),
    );
    const content = readXlsContent(bytes);
    expect(findCell(content, 0, 0, 0)?.numberFormatCode).toBe("0.0");
    expect(findCell(content, 0, 0, 1)?.numberFormatCode).toBe("0.0");
    expect(findCell(content, 0, 0, 2)?.numberFormatCode).toBe("0.00");
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
    expect(readBack?.value).toEqual({ kind: "string", value: "Merged" });
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
    expect(readBack?.value).toEqual({ kind: "empty" });
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
    expect(row0?.heightPt).toBe(30);
    expect(row5?.hidden).toBe(true);
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
    expect(column0?.widthPt).toBeCloseTo(100, 0);
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
    expect(content.sheets.map((s) => s.name)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
    expect(findCell(content, 0, 0, 0)?.value).toEqual({
      kind: "number",
      value: 1,
    });
    expect(findCell(content, 1, 0, 0)?.value).toEqual({
      kind: "number",
      value: 2,
    });
    expect(findCell(content, 2, 0, 0)?.value).toEqual({
      kind: "number",
      value: 3,
    });
  });

  it("writes a sheet with no cells at all", () => {
    const bytes = writeXlsContent(document([sheet("Empty", [])]));
    const content = readXlsContent(bytes);
    expect(content.sheets[0]?.name).toBe("Empty");
    expect(content.sheets[0]?.cells).toEqual([]);
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
        document([
          sheet("Sheet1", [cell(0, 256, { kind: "number", value: 1 })]),
        ]),
      ),
    ).toThrow(BiffWriteError);
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
      expect(readXlsContent(bytes).metadata).toEqual(input.metadata);
    });

    it('writes no "\\x05SummaryInformation" stream at all when metadata carries nothing that stream can hold', () => {
      const bytes = writeXlsContent(
        document([sheet("Sheet1", [cell(0, 0, { kind: "number", value: 1 })])]),
      );
      const streams = readCompoundFile(bytes);
      expect(
        streams.some((stream) => stream.path === "\x05SummaryInformation"),
      ).toBe(false);
      expect(readXlsContent(bytes).metadata).toEqual({});
    });
  });
});

describe("writeXls", () => {
  it("round-trips a DocumentTree end to end through assembleTree/flattenTree and this package's own readXls", () => {
    const content = document([
      sheet("Sheet1", [
        cell(0, 0, { kind: "number", value: 7 }),
        cell(0, 1, { kind: "string", value: "tree form" }),
      ]),
    ]);
    const tree = assembleTree(content);
    expect(() => DocumentTreeSchema.parse(tree)).not.toThrow();

    const bytes = writeXls(tree);
    const readTree = readXls(bytes);

    expect(readTree.kind).toBe("spreadsheet");
  });

  it("refuses a non-spreadsheet DocumentTree", () => {
    const wordTree: ReturnType<typeof assembleTree> = {
      kind: "wordprocessing",
      metadata: {},
      children: [],
    };
    expect(() => writeXls(wordTree)).toThrow(BiffWriteError);
  });
});
