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
  PAGE_SIZE_A4,
  PAGE_SIZE_LETTER,
  rgbHexToColor,
} from "document-schema.js";
import { isCompoundFile, readCompoundFile } from "archive-codec";
import { describe, expect, it } from "vitest";

import {
  RECORD_EXTERNSHEET,
  RECORD_LBL,
  RECORD_SUPBOOK,
} from "./biff/record-types";
import { readRecords } from "./biff/records";
import { PALETTE_ENTRY_COUNT } from "./biff/xf-colors";
import { BiffWriteError } from "./biff/write-errors";
import type { XlsContentDocument } from "./content";
import { readXls, readXlsContent } from "./content";
import { isXlsFile } from "./container";
import { writeXls, writeXlsContent } from "./write";

// Genuine .xls bytes -- a real [MS-CFB] compound file holding a real BIFF8 Workbook stream -- built by this package's own writer and read back through its own reader, the "primary verification method" this session's writers use throughout (the CFB writer, rtf-codec, wpd-codec). Every test here is a round trip: build a ContentDocument, write it, read it back, and check the read result reflects what was written -- exercising the writer against a reader whose own correctness is independently pinned by content.test.ts's hand-built byte sequences.

const POINTS_PER_INCH = 72;
/** Excel's own "Normal" preset, which is what a sheet with nothing else to say about printing carries -- and, since the reader falls back to exactly these values for a file stating none of the print records, what a round trip through this pair reproduces either way. The print-settings round trips at the end of this file are the ones that exercise real, non-default values. */
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

  describe("cell decoration", () => {
    const red = rgbHexToColor("ff0000");
    const blue = rgbHexToColor("0000ff");
    // Coral: genuinely absent from the fixed default table, so a workbook using it can only be written by minting a real Palette record. Checked against xf-colors.ts's own DEFAULT_PALETTE_TABLE rather than assumed -- teal (008080), the obvious candidate, is in fact one of that table's own entries, so a test built on it would have exercised the no-Palette fast path while claiming the opposite.
    const coral = rgbHexToColor("ff7f50");

    it("round-trips a solid background colour", () => {
      const bytes = writeXlsContent(
        document([
          sheet("Sheet1", [
            cell(0, 0, { kind: "string", value: "x" }, { background: red }),
          ]),
        ]),
      );
      expect(findCell(readXlsContent(bytes), 0, 0, 0)?.background).toEqual(red);
    });

    it("round-trips per-side borders, including a non-default style and colour", () => {
      const bytes = writeXlsContent(
        document([
          sheet("Sheet1", [
            cell(
              0,
              0,
              { kind: "string", value: "x" },
              {
                borders: {
                  left: { color: blue, widthPt: 0.75 },
                  top: {
                    color: red,
                    widthPt: 0.75,
                    style: "dashed",
                  },
                },
              },
            ),
          ]),
        ]),
      );
      expect(findCell(readXlsContent(bytes), 0, 0, 0)?.borders).toEqual({
        left: { color: blue, widthPt: 0.75 },
        top: { color: red, widthPt: 0.75, style: "dashed" },
      });
    });

    it("round-trips both a background and borders on the same cell", () => {
      const bytes = writeXlsContent(
        document([
          sheet("Sheet1", [
            cell(
              0,
              0,
              { kind: "number", value: 1 },
              {
                background: red,
                borders: { bottom: { color: blue, widthPt: 1.5 } },
              },
            ),
          ]),
        ]),
      );
      const readBack = findCell(readXlsContent(bytes), 0, 0, 0);
      expect(readBack?.background).toEqual(red);
      expect(readBack?.borders).toEqual({
        bottom: { color: blue, widthPt: 1.5 },
      });
    });

    it("writes no Palette record when every decoration colour already matches the fixed default table", () => {
      const bytes = writeXlsContent(
        document([
          sheet("Sheet1", [
            cell(0, 0, { kind: "string", value: "x" }, { background: red }),
          ]),
        ]),
      );
      // red (255,0,0) is icv 10 in the fixed default table -- resolvable with no Palette record present, and readXlsContent must still recover it correctly through that fallback.
      expect(findCell(readXlsContent(bytes), 0, 0, 0)?.background).toEqual(red);
    });

    it("writes a real Palette record and round-trips a colour outside the fixed default table", () => {
      const bytes = writeXlsContent(
        document([
          sheet("Sheet1", [
            cell(0, 0, { kind: "string", value: "x" }, { background: coral }),
          ]),
        ]),
      );
      expect(findCell(readXlsContent(bytes), 0, 0, 0)?.background).toEqual(
        coral,
      );
    });

    it("reuses one XF entry for two cells sharing the identical decoration, and mints a separate one for a cell with none", () => {
      // Not directly observable from the read side (mirroring the equivalent number-format dedup test above), but a real regression here would show up as a wrong background/borders on one of the three cells.
      const bytes = writeXlsContent(
        document([
          sheet("Sheet1", [
            cell(0, 0, { kind: "number", value: 1 }, { background: red }),
            cell(0, 1, { kind: "number", value: 2 }, { background: red }),
            cell(0, 2, { kind: "number", value: 3 }),
          ]),
        ]),
      );
      const content = readXlsContent(bytes);
      expect(findCell(content, 0, 0, 0)?.background).toEqual(red);
      expect(findCell(content, 0, 0, 1)?.background).toEqual(red);
      expect(findCell(content, 0, 0, 2)?.background).toBeUndefined();
    });

    it("refuses a workbook needing more distinct decoration colours than a Palette record can hold", () => {
      const cells: ContentSheetCell[] = [];
      for (let index = 0; index < 60; index += 1) {
        const hex = index.toString(16).padStart(6, "0");
        cells.push(
          cell(
            0,
            index,
            { kind: "number", value: index },
            { background: rgbHexToColor(hex) },
          ),
        );
      }
      expect(() => writeXlsContent(document([sheet("Sheet1", cells)]))).toThrow(
        BiffWriteError,
      );
    });

    /** `count` cells whose only content is a distinct background colour each -- the shape the palette budget has to count exactly, since every one is written (as a Blank record) while carrying no value. */
    function distinctlyColouredEmptyCells(
      count: number,
    ): readonly ContentSheetCell[] {
      return Array.from({ length: count }, (_unused, index) =>
        cell(
          0,
          index,
          { kind: "empty" },
          { background: rgbHexToColor(index.toString(16).padStart(6, "0")) },
        ),
      );
    }

    it("spends the palette on exactly the cells it writes, filling the record to its last slot", () => {
      // The colour scan and the XF-interning pass have to agree on which cells count, or the budget is wrong in one direction or the other: reading wider than the writer once refused a workbook over colours nothing ever wrote, and reading narrower would leave an XF referencing a colour with no slot allocated to it.
      const cells = distinctlyColouredEmptyCells(PALETTE_ENTRY_COUNT);

      const content = readXlsContent(
        writeXlsContent(document([sheet("Sheet1", cells)])),
      );

      for (const written of cells) {
        expect(
          findCell(content, 0, written.row, written.column)?.background,
        ).toEqual(written.background);
      }
    });

    it("round-trips a decorated empty cell through a real Blank record", () => {
      // The cell has no value at all, so its background and borders live entirely in the XF a Blank record points at. Writing nothing for it -- which is right for an undecorated empty cell -- would discard them outright.
      const bytes = writeXlsContent(
        document([
          sheet("Sheet1", [
            cell(
              1,
              2,
              { kind: "empty" },
              {
                background: red,
                borders: { top: { color: blue, widthPt: 1.5 } },
              },
            ),
          ]),
        ]),
      );

      const readBack = findCell(readXlsContent(bytes), 0, 1, 2);
      expect(readBack?.value).toEqual({ kind: "empty" });
      expect(readBack?.background).toEqual(red);
      expect(readBack?.borders).toEqual({
        top: { color: blue, widthPt: 1.5 },
      });
    });

    it("still writes nothing for an empty cell carrying no decoration", () => {
      // The other half of the same rule: a blank with nothing to show stays absent from the read-back sheet, so the cell array remains sparse.
      const bytes = writeXlsContent(
        document([
          sheet("Sheet1", [
            cell(0, 0, { kind: "number", value: 1 }),
            cell(1, 1, { kind: "empty" }),
            cell(2, 2, { kind: "empty" }, { borders: {} }),
          ]),
        ]),
      );

      const content = readXlsContent(bytes);
      expect(findCell(content, 0, 1, 1)).toBeUndefined();
      expect(findCell(content, 0, 2, 2)).toBeUndefined();
      expect(content.sheets[0]?.cells).toHaveLength(1);
    });

    it("round-trips a merged range whose anchor is empty but decorated", () => {
      // The anchor is materialised by the Blank record this time rather than reconstructed from MergeCells, so both its spans and its decoration have to survive together.
      const bytes = writeXlsContent(
        document([
          sheet("Sheet1", [
            cell(
              0,
              0,
              { kind: "empty" },
              { background: red, colSpan: 2, rowSpan: 3 },
            ),
          ]),
        ]),
      );

      const readBack = findCell(readXlsContent(bytes), 0, 0, 0);
      expect(readBack?.value).toEqual({ kind: "empty" });
      expect(readBack?.background).toEqual(red);
      expect(readBack?.colSpan).toBe(2);
      expect(readBack?.rowSpan).toBe(3);
    });

    it("shares one XF between a decorated empty cell and a valued cell with the same decoration", () => {
      // A Blank record's ixfe indexes the same cell-XF table every value record's does, so the interning pass has to treat both kinds of cell alike -- a regression would show as the wrong decoration on one of the two.
      const bytes = writeXlsContent(
        document([
          sheet("Sheet1", [
            cell(0, 0, { kind: "empty" }, { background: red }),
            cell(0, 1, { kind: "string", value: "x" }, { background: red }),
          ]),
        ]),
      );

      const content = readXlsContent(bytes);
      expect(findCell(content, 0, 0, 0)?.background).toEqual(red);
      expect(findCell(content, 0, 0, 1)?.background).toEqual(red);
    });

    it("refuses one distinct colour past the palette's last slot", () => {
      const cells = [
        ...distinctlyColouredEmptyCells(PALETTE_ENTRY_COUNT),
        cell(1, 0, { kind: "number", value: 1 }, { background: coral }),
      ];

      expect(() => writeXlsContent(document([sheet("Sheet1", cells)]))).toThrow(
        BiffWriteError,
      );
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

describe("print settings", () => {
  /** Every field ContentSheetPrintSettings carries, each at a value distinct from Excel's own Normal preset, so a round trip that silently fell back to that preset would fail rather than pass by coincidence. */
  const FULL_PRINT_SETTINGS: ContentSheetPrintSettings = {
    pageSize: {
      widthPt: PAGE_SIZE_A4.heightPt,
      heightPt: PAGE_SIZE_A4.widthPt,
    },
    margins: { topPt: 72, rightPt: 54, bottomPt: 90, leftPt: 36 },
    printRange: { startRow: 1, startColumn: 1, endRow: 5, endColumn: 3 },
    scalePercent: 80,
    repeatRows: { start: 0, end: 1 },
    repeatColumns: { start: 0, end: 0 },
    gridlines: true,
    headers: true,
    pageOrder: "overThenDown",
    manualBreaks: { rows: [10], columns: [3] },
  };

  function roundTripped(
    settings: ContentSheetPrintSettings,
  ): ContentSheetPrintSettings | undefined {
    const content = document([
      sheet("Printy", [cell(0, 0, { kind: "number", value: 1 })], {
        printSettings: settings,
      }),
    ]);
    return readXlsContent(writeXlsContent(content)).sheets[0]?.printSettings;
  }

  /** The same settings with no scalePercent and no repeatColumns -- spelled as its own literal rather than derived by deletion, so an optional field a round trip wrongly re-added shows up as an extra key rather than as a matching undefined. */
  const WITHOUT_SCALE_AND_REPEAT_COLUMNS: ContentSheetPrintSettings = {
    pageSize: FULL_PRINT_SETTINGS.pageSize,
    margins: FULL_PRINT_SETTINGS.margins,
    printRange: FULL_PRINT_SETTINGS.printRange,
    repeatRows: FULL_PRINT_SETTINGS.repeatRows,
    gridlines: FULL_PRINT_SETTINGS.gridlines,
    headers: FULL_PRINT_SETTINGS.headers,
    pageOrder: FULL_PRINT_SETTINGS.pageOrder,
    manualBreaks: FULL_PRINT_SETTINGS.manualBreaks,
  };

  it("round-trips every field of a fully populated print setting", () => {
    expect(roundTripped(FULL_PRINT_SETTINGS)).toEqual(FULL_PRINT_SETTINGS);
  });

  it("round-trips fit-to-page in place of a scale percentage", () => {
    // The two are mutually exclusive in BIFF8 -- WsBool's own fFitToPage decides which of Setup's fields is live -- so a fit-to-page sheet states no scale at all, in either direction.
    const settings: ContentSheetPrintSettings = {
      ...WITHOUT_SCALE_AND_REPEAT_COLUMNS,
      repeatColumns: FULL_PRINT_SETTINGS.repeatColumns,
      fitToPages: { width: 2, height: 3 },
    };
    expect(roundTripped(settings)).toEqual(settings);
  });

  it("round-trips a portrait page size without transposing it", () => {
    // A paper code names its paper in portrait and the orientation flag transposes it, so the two directions have to agree on which way round a page is.
    const settings: ContentSheetPrintSettings = {
      ...PRINT_SETTINGS,
      pageSize: PAGE_SIZE_A4,
    };
    expect(roundTripped(settings)?.pageSize).toEqual(PAGE_SIZE_A4);
  });

  it("round-trips a sheet whose settings are exactly the Normal preset", () => {
    // Nothing in ContentSheetPrintSettings can say "this sheet states nothing", so the writer emits the preset's own values rather than omitting the records -- and the reader's own fallback then agrees with them.
    expect(roundTripped(PRINT_SETTINGS)).toEqual(PRINT_SETTINGS);
  });

  it("round-trips an explicit 100% scale onto the absence that means the same thing", () => {
    // Setup's own iScale has no spelling for "no declared scale", so the two directions agree on one: 100% is actual size, which is exactly what carrying no scalePercent means. The sheet still prints identically, which is the only thing the field decides.
    expect(
      roundTripped({ ...PRINT_SETTINGS, scalePercent: 100 })?.scalePercent,
    ).toBeUndefined();
  });

  it("round-trips a repeated row band without inventing a column band", () => {
    // A Print_Titles name carrying one band has to come back as one band: the read side tells the two apart by shape, not by position, so a missing column band must not be reconstructed from the row band's own full-width extent.
    const settings: ContentSheetPrintSettings = {
      ...WITHOUT_SCALE_AND_REPEAT_COLUMNS,
      scalePercent: FULL_PRINT_SETTINGS.scalePercent,
    };
    expect(roundTripped(settings)).toEqual(settings);
  });

  it("keeps each sheet's own print settings separate", () => {
    const content = document([
      sheet("First", [cell(0, 0, { kind: "number", value: 1 })], {
        printSettings: FULL_PRINT_SETTINGS,
      }),
      sheet("Second", [cell(0, 0, { kind: "number", value: 2 })], {
        printSettings: {
          ...PRINT_SETTINGS,
          printRange: { startRow: 0, startColumn: 0, endRow: 9, endColumn: 9 },
        },
      }),
    ]);

    const read = readXlsContent(writeXlsContent(content));
    expect(read.sheets[0]?.printSettings).toEqual(FULL_PRINT_SETTINGS);
    expect(read.sheets[1]?.printSettings.printRange).toEqual({
      startRow: 0,
      startColumn: 0,
      endRow: 9,
      endColumn: 9,
    });
    expect(read.sheets[1]?.printSettings.repeatRows).toBeUndefined();
  });

  it("writes a page size no paper code names as custom, rather than as a paper it is not", () => {
    // Unlike xlsx's pageSetup element, [MS-XLS] 2.4.257's Setup record addresses paper only by code, so the dimensions genuinely cannot be written. iPaperSize 0 is that section's own "custom printer paper sizes", which is true; substituting Letter would not be. The size therefore does not survive the round trip -- the reader falls back to its documented default -- but the sheet, its cells, and every other print setting do.
    const content = document([
      sheet("Odd", [cell(0, 0, { kind: "number", value: 1 })], {
        printSettings: {
          ...PRINT_SETTINGS,
          pageSize: { widthPt: 500, heightPt: 400 },
          gridlines: true,
        },
      }),
    ]);

    const read = readXlsContent(writeXlsContent(content)).sheets[0];
    expect(read?.printSettings.pageSize).toEqual(PAGE_SIZE_LETTER);
    expect(read?.printSettings.gridlines).toBe(true);
    expect(read?.cells).toHaveLength(1);
  });

  it("writes no defined name at all for a workbook declaring no print range or band", () => {
    // The SupBook and ExternSheet a print name's own 3D reference resolves through exist only to serve one, so a workbook needing none stays as minimal as it was before print settings were written.
    const bytes = writeXlsContent(
      document([sheet("Plain", [cell(0, 0, { kind: "number", value: 1 })])]),
    );
    const stream = readCompoundFile(bytes).find(
      (entry) => entry.path === "Workbook",
    )?.bytes;
    const types = [...readRecords(stream ?? new Uint8Array())].map(
      (record) => record.type,
    );

    expect(types).not.toContain(RECORD_LBL);
    expect(types).not.toContain(RECORD_SUPBOOK);
    expect(types).not.toContain(RECORD_EXTERNSHEET);
  });
});
