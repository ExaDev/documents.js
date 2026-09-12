import type {
  ContentCellValue,
  ContentSheet,
  ContentSheetCell,
  ContentSheetConditionalFormat,
  ContentSheetDataValidation,
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
  RECORD_CF12,
  RECORD_CONTINUE,
  RECORD_EXTERNSHEET,
  RECORD_LBL,
  RECORD_MSODRAWING,
  RECORD_MSODRAWINGGROUP,
  RECORD_SUPBOOK,
} from "./biff/record-types";
import { readRecords } from "./biff/records";
import { PALETTE_ENTRY_COUNT } from "./biff/xf-colors";
import { BiffWriteError } from "./biff/write-errors";
import type { XlsContentDocument } from "./content";
import { readXls, readXlsContent } from "./content";
import { isXlsFile } from "./container";
import { writeXls, writeXlsContent } from "./write";
import { writeSheetConditionalFormats } from "./workbook/conditional-format-write";
import { writeSheetDataValidations } from "./workbook/data-validation-write";

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
    expect(readBack?.value).toStrictEqual({ kind: "number", value: 42 });
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
    expect(readBack?.value).toStrictEqual({
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
    expect(findCell(content, 0, 0, 0)?.value).toStrictEqual({
      kind: "string",
      value: "Repeated",
    });
    expect(findCell(content, 0, 0, 1)?.value).toStrictEqual({
      kind: "string",
      value: "Repeated",
    });
    expect(findCell(content, 0, 1, 0)?.value).toStrictEqual({
      kind: "string",
      value: "Repeated",
    });
    expect(findCell(content, 0, 1, 1)?.value).toStrictEqual({
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
    expect(findCell(readXlsContent(bytes), 0, 0, 0)?.value).toStrictEqual({
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
    expect(findCell(content, 0, 0, 0)?.value).toStrictEqual({
      kind: "boolean",
      value: true,
    });
    expect(findCell(content, 0, 0, 0)?.displayText).toBe("TRUE");
    expect(findCell(content, 0, 0, 1)?.value).toStrictEqual({
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
      expect(findCell(content, 0, 0, index)?.value).toStrictEqual({
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
    expect(findCell(content, 0, 0, 0)?.value).toStrictEqual({
      kind: "percentage",
      value: 0.5,
    });
    const currencyCell = findCell(content, 0, 0, 1);
    expect(currencyCell?.value).toStrictEqual({
      kind: "currency",
      value: 19.99,
    });
    // No numberFormatCode was given and this writer's own default currency format carries no [$XXX-nnn] marker, so no ISO code is recovered either -- an honest round trip of what was actually written, not an invented one.
    expect(currencyCell?.value).not.toHaveProperty("currency");
    expect(findCell(content, 0, 0, 2)?.value).toStrictEqual({
      kind: "date",
      value: "2026-09-03",
    });
    expect(findCell(content, 0, 0, 3)?.value).toStrictEqual({
      kind: "time",
      value: "13:45:30",
    });
    expect(findCell(content, 0, 0, 4)?.value).toStrictEqual({
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
    expect(readBack?.value).toStrictEqual({
      kind: "currency",
      value: 5,
      currency: "USD",
    });
    expect(readBack?.numberFormatCode).toBe("[$USD-409]#,##0.00");
  });

  it("round-trips a currency cell's own ISO code through the bracket format that alone can carry it", () => {
    const bytes = writeXlsContent(
      document([
        sheet("Sheet1", [
          cell(0, 0, { kind: "currency", value: 7.99, currency: "USD" }),
          // A lowercase code is still an ISO-code shape; the bracket states it in ISO 4217's own uppercase spelling, which is what reads back.
          cell(0, 1, { kind: "currency", value: 4.5, currency: "gbp" }),
          // A display symbol is not an ISO-code shape and cannot go inside the bracket, so the cell falls back to the plain currency format -- the kind preserved, the code honestly lost.
          cell(0, 2, { kind: "currency", value: 3, currency: "£" }),
        ]),
      ]),
    );
    const content = readXlsContent(bytes);
    expect(findCell(content, 0, 0, 0)?.value).toStrictEqual({
      kind: "currency",
      value: 7.99,
      currency: "USD",
    });
    expect(findCell(content, 0, 0, 0)?.numberFormatCode).toBe("[$USD]#,##0.00");
    expect(findCell(content, 0, 0, 1)?.value).toStrictEqual({
      kind: "currency",
      value: 4.5,
      currency: "GBP",
    });
    expect(findCell(content, 0, 0, 2)?.value).toStrictEqual({
      kind: "currency",
      value: 3,
    });
    expect(findCell(content, 0, 0, 2)?.value).not.toHaveProperty("currency");
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
    expect(readBack?.value).toStrictEqual({ kind: "number", value: 3.14159 });
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
    const redFill = { kind: "solid" as const, color: red };
    const coralFill = { kind: "solid" as const, color: coral };

    it("round-trips a solid background colour", () => {
      const bytes = writeXlsContent(
        document([
          sheet("Sheet1", [
            cell(0, 0, { kind: "string", value: "x" }, { background: redFill }),
          ]),
        ]),
      );
      expect(
        findCell(readXlsContent(bytes), 0, 0, 0)?.background,
      ).toStrictEqual(redFill);
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
      expect(findCell(readXlsContent(bytes), 0, 0, 0)?.borders).toStrictEqual({
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
                background: redFill,
                borders: { bottom: { color: blue, widthPt: 1.5 } },
              },
            ),
          ]),
        ]),
      );
      const readBack = findCell(readXlsContent(bytes), 0, 0, 0);
      expect(readBack?.background).toStrictEqual(redFill);
      expect(readBack?.borders).toStrictEqual({
        bottom: { color: blue, widthPt: 1.5 },
      });
    });

    it("round-trips a genuine two-colour percentage-grey pattern fill instead of dropping it (ExaDev/documents.js#951)", () => {
      const fill = {
        kind: "pattern" as const,
        patternType: "mediumGray" as const,
        foregroundColor: red,
        backgroundColor: blue,
      };
      const bytes = writeXlsContent(
        document([
          sheet("Sheet1", [
            cell(0, 0, { kind: "string", value: "x" }, { background: fill }),
          ]),
        ]),
      );
      expect(
        findCell(readXlsContent(bytes), 0, 0, 0)?.background,
      ).toStrictEqual(fill);
    });

    it("round-trips a genuine two-colour crosshatch pattern fill instead of dropping it (ExaDev/documents.js#951)", () => {
      const fill = {
        kind: "pattern" as const,
        patternType: "darkTrellis" as const,
        foregroundColor: red,
        backgroundColor: blue,
      };
      const bytes = writeXlsContent(
        document([
          sheet("Sheet1", [
            cell(0, 0, { kind: "string", value: "x" }, { background: fill }),
          ]),
        ]),
      );
      expect(
        findCell(readXlsContent(bytes), 0, 0, 0)?.background,
      ).toStrictEqual(fill);
    });

    it("round-trips a pattern fill leaving one of its own colours unstated", () => {
      const fill = {
        kind: "pattern" as const,
        patternType: "lightHorizontal" as const,
        foregroundColor: red,
      };
      const bytes = writeXlsContent(
        document([
          sheet("Sheet1", [
            cell(0, 0, { kind: "string", value: "x" }, { background: fill }),
          ]),
        ]),
      );
      expect(
        findCell(readXlsContent(bytes), 0, 0, 0)?.background,
      ).toStrictEqual(fill);
    });

    it("throws writing a WordprocessingML-only pattern type BIFF8's own FillPattern enumeration has no member for", () => {
      expect(() =>
        writeXlsContent(
          document([
            sheet("Sheet1", [
              cell(
                0,
                0,
                { kind: "string", value: "x" },
                {
                  background: { kind: "pattern", patternType: "diagonalCross" },
                },
              ),
            ]),
          ]),
        ),
      ).toThrow(/diagonalCross/);
    });

    it("writes no Palette record when every decoration colour already matches the fixed default table", () => {
      const bytes = writeXlsContent(
        document([
          sheet("Sheet1", [
            cell(0, 0, { kind: "string", value: "x" }, { background: redFill }),
          ]),
        ]),
      );
      // red (255,0,0) is icv 10 in the fixed default table -- resolvable with no Palette record present, and readXlsContent must still recover it correctly through that fallback.
      expect(
        findCell(readXlsContent(bytes), 0, 0, 0)?.background,
      ).toStrictEqual(redFill);
    });

    it("writes a real Palette record and round-trips a colour outside the fixed default table", () => {
      const bytes = writeXlsContent(
        document([
          sheet("Sheet1", [
            cell(
              0,
              0,
              { kind: "string", value: "x" },
              { background: coralFill },
            ),
          ]),
        ]),
      );
      expect(
        findCell(readXlsContent(bytes), 0, 0, 0)?.background,
      ).toStrictEqual(coralFill);
    });

    it("reuses one XF entry for two cells sharing the identical decoration, and mints a separate one for a cell with none", () => {
      // Not directly observable from the read side (mirroring the equivalent number-format dedup test above), but a real regression here would show up as a wrong background/borders on one of the three cells.
      const bytes = writeXlsContent(
        document([
          sheet("Sheet1", [
            cell(0, 0, { kind: "number", value: 1 }, { background: redFill }),
            cell(0, 1, { kind: "number", value: 2 }, { background: redFill }),
            cell(0, 2, { kind: "number", value: 3 }),
          ]),
        ]),
      );
      const content = readXlsContent(bytes);
      expect(findCell(content, 0, 0, 0)?.background).toStrictEqual(redFill);
      expect(findCell(content, 0, 0, 1)?.background).toStrictEqual(redFill);
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
            { background: { kind: "solid", color: rgbHexToColor(hex) } },
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
          {
            background: {
              kind: "solid",
              color: rgbHexToColor(index.toString(16).padStart(6, "0")),
            },
          },
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
        ).toStrictEqual(written.background);
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
                background: redFill,
                borders: { top: { color: blue, widthPt: 1.5 } },
              },
            ),
          ]),
        ]),
      );

      const readBack = findCell(readXlsContent(bytes), 0, 1, 2);
      expect(readBack?.value).toStrictEqual({ kind: "empty" });
      expect(readBack?.background).toStrictEqual(redFill);
      expect(readBack?.borders).toStrictEqual({
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
              { background: redFill, colSpan: 2, rowSpan: 3 },
            ),
          ]),
        ]),
      );

      const readBack = findCell(readXlsContent(bytes), 0, 0, 0);
      expect(readBack?.value).toStrictEqual({ kind: "empty" });
      expect(readBack?.background).toStrictEqual(redFill);
      expect(readBack?.colSpan).toBe(2);
      expect(readBack?.rowSpan).toBe(3);
    });

    it("shares one XF between a decorated empty cell and a valued cell with the same decoration", () => {
      // A Blank record's ixfe indexes the same cell-XF table every value record's does, so the interning pass has to treat both kinds of cell alike -- a regression would show as the wrong decoration on one of the two.
      const bytes = writeXlsContent(
        document([
          sheet("Sheet1", [
            cell(0, 0, { kind: "empty" }, { background: redFill }),
            cell(0, 1, { kind: "string", value: "x" }, { background: redFill }),
          ]),
        ]),
      );

      const content = readXlsContent(bytes);
      expect(findCell(content, 0, 0, 0)?.background).toStrictEqual(redFill);
      expect(findCell(content, 0, 0, 1)?.background).toStrictEqual(redFill);
    });

    it("refuses one distinct colour past the palette's last slot", () => {
      const cells = [
        ...distinctlyColouredEmptyCells(PALETTE_ENTRY_COUNT),
        cell(1, 0, { kind: "number", value: 1 }, { background: coralFill }),
      ];

      expect(() => writeXlsContent(document([sheet("Sheet1", cells)]))).toThrow(
        BiffWriteError,
      );
    });
  });

  describe("cell alignment", () => {
    it("round-trips each horizontal alignment this package's schema can express", () => {
      const bytes = writeXlsContent(
        document([
          sheet("Sheet1", [
            cell(0, 0, { kind: "string", value: "x" }, { alignment: "left" }),
            cell(
              0,
              1,
              { kind: "string", value: "x" },
              {
                alignment: "center",
              },
            ),
            cell(
              0,
              2,
              { kind: "string", value: "x" },
              {
                alignment: "right",
              },
            ),
            cell(
              0,
              3,
              { kind: "string", value: "x" },
              {
                alignment: "justify",
              },
            ),
          ]),
        ]),
      );
      const content = readXlsContent(bytes);
      expect(findCell(content, 0, 0, 0)?.alignment).toBe("left");
      expect(findCell(content, 0, 0, 1)?.alignment).toBe("center");
      expect(findCell(content, 0, 0, 2)?.alignment).toBe("right");
      expect(findCell(content, 0, 0, 3)?.alignment).toBe("justify");
    });

    it("round-trips each vertical alignment this package's schema can express", () => {
      const bytes = writeXlsContent(
        document([
          sheet("Sheet1", [
            cell(
              0,
              0,
              { kind: "string", value: "x" },
              {
                verticalAlignment: "top",
              },
            ),
            cell(
              0,
              1,
              { kind: "string", value: "x" },
              {
                verticalAlignment: "middle",
              },
            ),
          ]),
        ]),
      );
      const content = readXlsContent(bytes);
      expect(findCell(content, 0, 0, 0)?.verticalAlignment).toBe("top");
      expect(findCell(content, 0, 0, 1)?.verticalAlignment).toBe("middle");
    });

    it("leaves alignment/verticalAlignment absent for a cell that states neither, matching the value-kind default and the schema's own documented bottom default", () => {
      const bytes = writeXlsContent(
        document([
          sheet("Sheet1", [cell(0, 0, { kind: "string", value: "x" })]),
        ]),
      );
      const readBack = findCell(readXlsContent(bytes), 0, 0, 0);
      expect(readBack?.alignment).toBeUndefined();
      expect(readBack?.verticalAlignment).toBeUndefined();
    });

    it("round-trips both alignment and decoration on the same cell", () => {
      const redFill = {
        kind: "solid" as const,
        color: rgbHexToColor("ff0000"),
      };
      const bytes = writeXlsContent(
        document([
          sheet("Sheet1", [
            cell(
              0,
              0,
              { kind: "string", value: "x" },
              {
                alignment: "right",
                verticalAlignment: "top",
                background: redFill,
              },
            ),
          ]),
        ]),
      );
      const readBack = findCell(readXlsContent(bytes), 0, 0, 0);
      expect(readBack?.alignment).toBe("right");
      expect(readBack?.verticalAlignment).toBe("top");
      expect(readBack?.background).toStrictEqual(redFill);
    });

    it("round-trips a decorated-alignment-only empty cell through a real Blank record", () => {
      // No value and no fill/border either -- alignment alone is what makes this cell worth a Blank record, mirroring the equivalent decoration-only empty-cell test above.
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
        document([
          sheet("Sheet1", [cell(0, 256, { kind: "number", value: 1 })]),
        ]),
      ),
    ).toThrow(BiffWriteError);
  });

  describe("per-cell fonts", () => {
    it("round-trips a workbook mixing several distinct cell fonts with plain cells", () => {
      const bytes = writeXlsContent(
        document([
          sheet("Sheet1", [
            // A cell stating no font of its own -- it must read back with no font field, referencing the Normal font's own table entry rather than restating it.
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
      // icv 10 is the default palette's own duplicate of Red, which is what a { r: 1, g: 0, b: 0 } colour resolves to without forcing a Palette record -- the identical quantisation the fill round trips already pin.
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
              cell(
                0,
                0,
                { kind: "number", value: 1 },
                { font: { sizePt: 0.5 } },
              ),
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
    expect(roundTripped(FULL_PRINT_SETTINGS)).toStrictEqual(
      FULL_PRINT_SETTINGS,
    );
  });

  it("round-trips fit-to-page in place of a scale percentage", () => {
    // The two are mutually exclusive in BIFF8 -- WsBool's own fFitToPage decides which of Setup's fields is live -- so a fit-to-page sheet states no scale at all, in either direction.
    const settings: ContentSheetPrintSettings = {
      ...WITHOUT_SCALE_AND_REPEAT_COLUMNS,
      repeatColumns: FULL_PRINT_SETTINGS.repeatColumns,
      fitToPages: { width: 2, height: 3 },
    };
    expect(roundTripped(settings)).toStrictEqual(settings);
  });

  it("round-trips a portrait page size without transposing it", () => {
    // A paper code names its paper in portrait and the orientation flag transposes it, so the two directions have to agree on which way round a page is.
    const settings: ContentSheetPrintSettings = {
      ...PRINT_SETTINGS,
      pageSize: PAGE_SIZE_A4,
    };
    expect(roundTripped(settings)?.pageSize).toStrictEqual(PAGE_SIZE_A4);
  });

  it("round-trips a sheet whose settings are exactly the Normal preset", () => {
    // Nothing in ContentSheetPrintSettings can say "this sheet states nothing", so the writer emits the preset's own values rather than omitting the records -- and the reader's own fallback then agrees with them.
    expect(roundTripped(PRINT_SETTINGS)).toStrictEqual(PRINT_SETTINGS);
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
    expect(roundTripped(settings)).toStrictEqual(settings);
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
    expect(read.sheets[0]?.printSettings).toStrictEqual(FULL_PRINT_SETTINGS);
    expect(read.sheets[1]?.printSettings.printRange).toStrictEqual({
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
    expect(read?.printSettings.pageSize).toStrictEqual(PAGE_SIZE_LETTER);
    expect(read?.printSettings.gridlines).toBe(true);
    expect(read?.cells).toHaveLength(1);
  });

  it("clamps a scale and a fit-to-page count past what their own Setup fields can hold", () => {
    // ContentSheetPrintSettings bounds neither from above, and Setup's own fields are 16-bit -- so an unclamped value would wrap and state a different intent confidently. [MS-XLS] 2.4.257 caps iFitWidth/iFitHeight at 32767; iScale has only its field's own width.
    expect(
      roundTripped({ ...PRINT_SETTINGS, scalePercent: 200_000 })?.scalePercent,
    ).toBe(0xffff);
    expect(
      roundTripped({
        ...PRINT_SETTINGS,
        fitToPages: { width: 100_000, height: 2 },
      })?.fitToPages,
    ).toStrictEqual({ width: 32767, height: 2 });
  });

  it("clamps a print range and a repeated band past BIFF8's own row/column ceiling, rather than wrapping to an in-grid coordinate", () => {
    // printRange/repeatRows/repeatColumns are bounded from above by neither ContentSheetPrintRange/ContentSheetRepeatRange nor writeArea3d's own 16-bit field -- an unclamped end row of 70000 would wrap to 4464, a plausible-looking coordinate that silently states a smaller range than asked for.
    //
    // repeatRows/repeatColumns both start past 0: a band clamped to first 0/last MAX_*_INDEX on the axis it already fully spans by construction would ALSO fully span the perpendicular one, making it shape-ambiguous with "the whole sheet" (see print-names.ts's own classification note) and reading back as neither band -- an existing, documented tradeoff of the shape-based discriminant, not something this clamp introduces or is responsible for working around.
    const settings: ContentSheetPrintSettings = {
      ...PRINT_SETTINGS,
      printRange: {
        startRow: 2,
        startColumn: 2,
        endRow: 99_999,
        endColumn: 300,
      },
      repeatRows: { start: 2, end: 70_000 },
      repeatColumns: { start: 1, end: 300 },
    };
    const read = roundTripped(settings);
    expect(read?.printRange).toStrictEqual({
      startRow: 2,
      startColumn: 2,
      endRow: 0xffff,
      endColumn: 0xff,
    });
    expect(read?.repeatRows).toStrictEqual({ start: 2, end: 0xffff });
    expect(read?.repeatColumns).toStrictEqual({ start: 1, end: 0xff });
  });

  it("drops a manual page break past BIFF8's own row/column ceiling, rather than wrapping to an in-grid index", () => {
    // Dropped rather than clamped, unlike a print range/repeated band above: a page break is a single position, and clamping one would insert a break at the grid's own edge nobody asked for.
    const settings: ContentSheetPrintSettings = {
      ...PRINT_SETTINGS,
      manualBreaks: { rows: [10, 70_000], columns: [3, 400] },
    };
    expect(roundTripped(settings)?.manualBreaks).toStrictEqual({
      rows: [10],
      columns: [3],
    });
  });

  it("writes no defined name at all for a workbook declaring no print range or band", () => {
    // The SupBook and ExternSheet a defined name's own 3D reference resolves through exist only to serve one -- a print name or a document-level name alike -- so a workbook needing none stays as minimal as it was before either was written.
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

describe("formula records", () => {
  function roundTrippedFormula(
    formula: string,
    value: ContentCellValue,
  ): string | undefined {
    const content = document([
      sheet("Sheet1", [cell(0, 0, value, { formula })]),
    ]);
    return findCell(readXlsContent(writeXlsContent(content)), 0, 0, 0)?.formula;
  }

  it("round-trips a plain arithmetic formula over integer literals", () => {
    expect(roundTrippedFormula("A1+A2", { kind: "number", value: 3 })).toBe(
      "A1+A2",
    );
  });

  it("round-trips a formula referencing an absolute and a relative cell", () => {
    expect(roundTrippedFormula("$A$1*B2", { kind: "number", value: 6 })).toBe(
      "$A$1*B2",
    );
  });

  it("round-trips a formula over a cell range passed to a variable-arity function", () => {
    expect(
      roundTrippedFormula("SUM(A1:A10)", { kind: "number", value: 55 }),
    ).toBe("SUM(A1:A10)");
  });

  it("round-trips a fixed-arity function call", () => {
    expect(
      roundTrippedFormula("ROUND(A1,2)", { kind: "number", value: 1.23 }),
    ).toBe("ROUND(A1,2)");
  });

  it("round-trips a nested function call with a comparison and a string literal", () => {
    expect(
      roundTrippedFormula('IF(A1>0,"positive","not positive")', {
        kind: "string",
        value: "positive",
      }),
    ).toBe('IF(A1>0,"positive","not positive")');
  });

  it("round-trips a formula whose cached result is a boolean", () => {
    expect(roundTrippedFormula("A1>A2", { kind: "boolean", value: true })).toBe(
      "A1>A2",
    );
  });

  it("round-trips a formula whose cached result is an error", () => {
    expect(
      roundTrippedFormula("A1/A2", { kind: "error", value: "#DIV/0!" }),
    ).toBe("A1/A2");
  });

  it("round-trips explicit parentheses exactly as written", () => {
    expect(
      roundTrippedFormula("(A1+A2)*A3", { kind: "number", value: 9 }),
    ).toBe("(A1+A2)*A3");
  });

  it("round-trips unary minus binding tighter than exponentiation, matching Excel's own precedence", () => {
    expect(roundTrippedFormula("-A1^2", { kind: "number", value: 4 })).toBe(
      "-A1^2",
    );
  });

  it("round-trips a formula's own cached numeric result alongside its expression", () => {
    const content = document([
      sheet("Sheet1", [
        cell(0, 0, { kind: "number", value: 2 }),
        cell(0, 1, { kind: "number", value: 3 }),
        cell(0, 2, { kind: "number", value: 5 }, { formula: "A1+B1" }),
      ]),
    ]);
    const read = readXlsContent(writeXlsContent(content));
    const written = findCell(read, 0, 0, 2);
    expect(written?.formula).toBe("A1+B1");
    expect(written?.value).toStrictEqual({ kind: "number", value: 5 });
  });

  it("refuses a formula this package's own reader could not read back, rather than writing unreadable bytes", () => {
    const content = document([
      sheet("Sheet1", [
        cell(0, 0, { kind: "number", value: 1 }, { formula: "Sheet2!A1" }),
      ]),
    ]);
    expect(() => writeXlsContent(content)).toThrow(BiffWriteError);
  });

  it("refuses a call to a function outside [MS-XLS]'s own Ftab vocabulary", () => {
    const content = document([
      sheet("Sheet1", [
        cell(
          0,
          0,
          { kind: "number", value: 1 },
          { formula: "XLOOKUP(A1,A2,A3)" },
        ),
      ]),
    ]);
    expect(() => writeXlsContent(content)).toThrow(BiffWriteError);
  });

  it("refuses a fixed-arity function called with the wrong number of arguments", () => {
    const content = document([
      sheet("Sheet1", [
        cell(0, 0, { kind: "number", value: 1 }, { formula: "SIN(A1,A2)" }),
      ]),
    ]);
    expect(() => writeXlsContent(content)).toThrow(BiffWriteError);
  });
});

describe("cell comments", () => {
  it("round-trips a comment's text and author on an otherwise-populated cell", () => {
    const content = document([
      sheet("Sheet1", [
        cell(
          0,
          0,
          { kind: "number", value: 1 },
          { comment: { text: "a note", author: "Reviewer" } },
        ),
      ]),
    ]);
    const read = readXlsContent(writeXlsContent(content));
    expect(findCell(read, 0, 0, 0)?.comment).toStrictEqual({
      text: "a note",
      author: "Reviewer",
    });
  });

  it("round-trips a comment anchored to an otherwise-empty cell", () => {
    const content = document([
      sheet("Sheet1", [
        {
          row: 2,
          column: 2,
          value: { kind: "empty" },
          displayText: "",
          comment: { text: "pinned to nothing" },
        },
      ]),
    ]);
    const read = readXlsContent(writeXlsContent(content));
    expect(findCell(read, 0, 2, 2)?.comment).toStrictEqual({
      text: "pinned to nothing",
    });
  });

  it("round-trips a comment with no author, carrying no author back", () => {
    const content = document([
      sheet("Sheet1", [
        cell(
          0,
          0,
          { kind: "number", value: 1 },
          { comment: { text: "anonymous" } },
        ),
      ]),
    ]);
    const read = readXlsContent(writeXlsContent(content));
    expect(findCell(read, 0, 0, 0)?.comment).toStrictEqual({
      text: "anonymous",
    });
  });

  it("round-trips an empty comment with no text at all", () => {
    const content = document([
      sheet("Sheet1", [
        cell(0, 0, { kind: "number", value: 1 }, { comment: { text: "" } }),
      ]),
    ]);
    const read = readXlsContent(writeXlsContent(content));
    expect(findCell(read, 0, 0, 0)?.comment).toStrictEqual({ text: "" });
  });

  it("round-trips multiple comments on the same sheet, each keeping its own cell and text", () => {
    const content = document([
      sheet("Sheet1", [
        cell(
          0,
          0,
          { kind: "string", value: "first" },
          { comment: { text: "note one" } },
        ),
        cell(
          5,
          1,
          { kind: "string", value: "second" },
          { comment: { text: "note two", author: "Someone" } },
        ),
      ]),
    ]);
    const read = readXlsContent(writeXlsContent(content));
    expect(findCell(read, 0, 0, 0)?.comment).toStrictEqual({
      text: "note one",
    });
    expect(findCell(read, 0, 5, 1)?.comment).toStrictEqual({
      text: "note two",
      author: "Someone",
    });
  });
});

describe("writeXlsContent: images and embedded objects written (#971)", () => {
  // A minimal but genuinely valid 1x1 PNG (a real signature, IHDR, IDAT, IEND chain) -- the identical fixture drawing/blips.test.ts uses, since resolveBlip only checks image.format, never the bytes' own structure.
  const PNG_BYTES = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
    0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d, 0xb0, 0x00, 0x00, 0x00,
    0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);

  function base64Of(bytes: Uint8Array): string {
    let binary = "";
    const chunkSize = 0x2000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(
        ...bytes.subarray(offset, offset + chunkSize),
      );
    }
    return btoa(binary);
  }

  const SMALL_PNG_BASE64 = base64Of(PNG_BYTES);

  /** Bytes large enough on their own to push a single BSE entry (or a single sheet's own shape tree, repeated many times over) past the 8224-byte single-record ceiling, forcing writeRecordChain to split its record onto a Continue chain -- a non-repeating pattern so a byte-exact round trip can't pass by coincidence (e.g. every byte happening to be zero). */
  function largeBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      bytes[index] = index % 251;
    }
    return bytes;
  }

  it("round-trips a sheet image's format, bytes, and cell anchor", () => {
    const content = document([
      sheet("Sheet1", [], {
        images: [
          {
            kind: "image",
            format: "png",
            base64: SMALL_PNG_BASE64,
            widthPt: 40,
            heightPt: 30,
            anchorRow: 2,
            anchorColumn: 1,
            offsetXPt: 5,
            offsetYPt: 3,
          },
        ],
      }),
    ]);
    const read = readXlsContent(writeXlsContent(content));
    const image = read.sheets[0]?.images[0];
    expect(image?.format).toBe("png");
    expect(image?.base64).toBe(SMALL_PNG_BASE64);
    expect(image?.anchorRow).toBe(2);
    expect(image?.anchorColumn).toBe(1);
    expect(image?.widthPt).toBeCloseTo(40, 0);
    expect(image?.heightPt).toBeCloseTo(30, 0);
  });

  it("round-trips an image large enough to force the workbook-wide Blip Store onto a Continue chain", () => {
    const bytes = largeBytes(9000);
    const base64 = base64Of(bytes);
    const content = document([
      sheet("Sheet1", [], {
        images: [
          {
            kind: "image",
            format: "png",
            base64,
            widthPt: 40,
            heightPt: 30,
            anchorRow: 0,
            anchorColumn: 0,
            offsetXPt: 0,
            offsetYPt: 0,
          },
        ],
      }),
    ]);
    const written = writeXlsContent(content);
    // Confirms the test actually exercises the Continue chain rather than passing by coincidence: a MSODRAWINGGROUP record this large MUST be followed by at least one CONTINUE record ([MS-XLS] 2.1.4's own 8224-byte single-record ceiling).
    const globalsRecords = readRecords(
      readCompoundFile(written).find((stream) => stream.path === "Workbook")
        ?.bytes ?? new Uint8Array(),
    );
    const drawingGroupIndex = globalsRecords.findIndex(
      (record) => record.type === RECORD_MSODRAWINGGROUP,
    );
    expect(drawingGroupIndex).toBeGreaterThanOrEqual(0);
    expect(globalsRecords[drawingGroupIndex + 1]?.type).toBe(RECORD_CONTINUE);

    const read = readXlsContent(written);
    const image = read.sheets[0]?.images[0];
    expect(image?.format).toBe("png");
    expect(image?.base64).toBe(base64);
  });

  it("round-trips many images on one sheet, forcing that sheet's own MsoDrawing record onto a Continue chain", () => {
    const imageCount = 150;
    const images = Array.from({ length: imageCount }, (_, index) => ({
      kind: "image" as const,
      format: "png" as const,
      base64: SMALL_PNG_BASE64,
      widthPt: 10,
      heightPt: 10,
      anchorRow: index,
      anchorColumn: 0,
      offsetXPt: 0,
      offsetYPt: 0,
    }));
    const content = document([sheet("Sheet1", [], { images })]);
    const written = writeXlsContent(content);
    const workbookBytes =
      readCompoundFile(written).find((stream) => stream.path === "Workbook")
        ?.bytes ?? new Uint8Array();
    const records = readRecords(workbookBytes);
    const drawingIndex = records.findIndex(
      (record) => record.type === RECORD_MSODRAWING,
    );
    expect(drawingIndex).toBeGreaterThanOrEqual(0);
    expect(records[drawingIndex + 1]?.type).toBe(RECORD_CONTINUE);

    const read = readXlsContent(written);
    expect(read.sheets[0]?.images).toHaveLength(imageCount);
    expect(
      read.sheets[0]?.images.every(
        (image) => image.base64 === SMALL_PNG_BASE64,
      ),
    ).toBe(true);
  });

  it("round-trips a non-chart embedded OLE object through its own Embedding Storage", () => {
    const embeddedDocument = {
      kind: "drawing" as const,
      metadata: {},
      pages: [
        {
          size: { widthPt: 50, heightPt: 40 },
          shapes: [],
          vectors: [],
        },
      ],
    };
    const content = document([
      sheet("Sheet1", [], {
        embeddedObjects: [
          {
            objectKind: "drawing",
            document: embeddedDocument,
            frame: { xPt: 0, yPt: 0, widthPt: 50, heightPt: 40 },
            anchorRow: 3,
            anchorColumn: 2,
            offsetXPt: 4,
            offsetYPt: 2,
          },
        ],
      }),
    ]);
    const written = writeXlsContent(content);
    const streams = readCompoundFile(written);
    expect(
      streams.some((stream) => /^MBD[0-9A-F]{8}\/Package$/.test(stream.path)),
    ).toBe(true);

    const read = readXlsContent(written);
    const embedded = read.sheets[0]?.embeddedObjects?.[0];
    expect(embedded?.objectKind).toBe("drawing");
    expect(embedded?.document).toStrictEqual(embeddedDocument);
  });

  it("throws when asked to write a 'chart' embedded object", () => {
    const content = document([
      sheet("Sheet1", [], {
        embeddedObjects: [
          {
            objectKind: "chart",
            document: {
              kind: "spreadsheet",
              metadata: {},
              sheets: [
                {
                  name: "Chart",
                  cells: [],
                  columns: [],
                  rows: [],
                  images: [],
                  printSettings: PRINT_SETTINGS,
                },
              ],
            },
            frame: { xPt: 0, yPt: 0, widthPt: 50, heightPt: 40 },
          },
        ],
      }),
    ]);
    expect(() => writeXlsContent(content)).toThrow(BiffWriteError);
  });
});

describe("writeXlsContent: data validations written (#971)", () => {
  it("round-trips a whole-number comparison rule with every optional field", () => {
    const rule = {
      ranges: [{ startRow: 0, endRow: 4, startColumn: 0, endColumn: 0 }],
      type: "whole" as const,
      operator: "greaterThan" as const,
      formula1: "5",
      allowBlank: true,
      showInputMessage: true,
      promptTitle: "Enter",
      prompt: "A number over 5",
      showErrorMessage: true,
      errorStyle: "warning" as const,
      errorTitle: "Wrong",
      error: "Must exceed 5",
    };
    const reread = readXlsContent(
      writeXlsContent(document([sheet("S", [], { dataValidations: [rule] })])),
    );
    expect(reread.sheets[0]?.dataValidations).toStrictEqual([rule]);
  });

  it("round-trips a between rule's two formulas, a list rule's quoted literal, and a custom rule's expression", () => {
    const rules: ContentSheetDataValidation[] = [
      {
        ranges: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 2 }],
        type: "decimal",
        operator: "between",
        formula1: "1",
        formula2: "10",
      },
      {
        ranges: [{ startRow: 1, endRow: 1, startColumn: 1, endColumn: 1 }],
        type: "list",
        formula1: '"a,b,c"',
      },
      {
        ranges: [{ startRow: 2, endRow: 2, startColumn: 0, endColumn: 0 }],
        type: "custom",
        formula1: "A1>5",
      },
    ];
    const reread = readXlsContent(
      writeXlsContent(document([sheet("S", [], { dataValidations: rules })])),
    );
    expect(reread.sheets[0]?.dataValidations).toStrictEqual(rules);
  });

  it("refuses an operator-less comparison type and a two-operand operator without its second formula", () => {
    expect(() =>
      writeXlsContent(
        document([
          sheet("S", [], {
            dataValidations: [
              {
                ranges: [
                  { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
                ],
                type: "whole",
                formula1: "5",
              } as unknown as ContentSheetDataValidation,
            ],
          }),
        ]),
      ),
    ).toThrow(/no operator/);
    expect(() =>
      writeXlsContent(
        document([
          sheet("S", [], {
            dataValidations: [
              {
                ranges: [
                  { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
                ],
                type: "decimal",
                operator: "between",
                formula1: "1",
              } as unknown as ContentSheetDataValidation,
            ],
          }),
        ]),
      ),
    ).toThrow(/no second formula/);
  });

  it("refuses a data-validation type or operator the schema's own closed vocabularies never name", () => {
    expect(() =>
      writeXlsContent(
        document([
          sheet("S", [], {
            dataValidations: [
              {
                ranges: [
                  { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
                ],
                type: "notARealType",
                formula1: "5",
              } as unknown as ContentSheetDataValidation,
            ],
          }),
        ]),
      ),
    ).toThrow(/has no Dv valType value/);
    expect(() =>
      writeXlsContent(
        document([
          sheet("S", [], {
            dataValidations: [
              {
                ranges: [
                  { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
                ],
                type: "whole",
                operator: "notARealOperator",
                formula1: "5",
              } as unknown as ContentSheetDataValidation,
            ],
          }),
        ]),
      ),
    ).toThrow(/has no Dv typOperator value/);
  });

  it("refuses a non-two-operand rule carrying a second formula", () => {
    expect(() =>
      writeXlsContent(
        document([
          sheet("S", [], {
            dataValidations: [
              {
                ranges: [
                  { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
                ],
                type: "whole",
                operator: "greaterThan",
                formula1: "5",
                formula2: "10",
              },
            ],
          }),
        ]),
      ),
    ).toThrow(/carries a second formula/);
  });

  it("refuses a rule carrying no range", () => {
    expect(() =>
      writeXlsContent(
        document([
          sheet("S", [], {
            dataValidations: [
              {
                ranges: [],
                type: "whole",
                operator: "greaterThan",
                formula1: "5",
              },
            ],
          }),
        ]),
      ),
    ).toThrow(/carrying no range states nothing/);
  });

  it("refuses a range outside BIFF8's own grid, at each of its four edges", () => {
    const base = {
      type: "whole" as const,
      operator: "greaterThan" as const,
      formula1: "5",
    };
    const overRow: ContentSheetDataValidation = {
      ...base,
      ranges: [
        { startRow: 0x10000, endRow: 0x10000, startColumn: 0, endColumn: 0 },
      ],
    };
    const overEndRow: ContentSheetDataValidation = {
      ...base,
      ranges: [{ startRow: 0, endRow: 0x10000, startColumn: 0, endColumn: 0 }],
    };
    const overColumn: ContentSheetDataValidation = {
      ...base,
      ranges: [{ startRow: 0, endRow: 0, startColumn: 0x100, endColumn: 0 }],
    };
    const overEndColumn: ContentSheetDataValidation = {
      ...base,
      ranges: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0x100 }],
    };
    for (const rule of [overRow, overEndRow, overColumn, overEndColumn]) {
      expect(() =>
        writeXlsContent(
          document([sheet("S", [], { dataValidations: [rule] })]),
        ),
      ).toThrow(/outside BIFF8's own grid/);
    }
  });

  it("writes no Dval/Dv records at all for a sheet stating an empty dataValidations array", () => {
    // A round trip through readXlsContent cannot distinguish this from a Dval-with-zero-Dv-records: mapDataValidations's own result is an empty array either way, and content.ts already omits the field for an empty array regardless of whether a genuinely empty Dval record was written at all. Calling the writer directly is the only way to check that no record is written in the first place.
    expect(
      writeSheetDataValidations(sheet("S", [], { dataValidations: [] })),
    ).toStrictEqual([]);
  });
});

describe("writeXlsContent: conditional formats written (#971)", () => {
  it("round-trips a cellIs rule with its style colours", () => {
    const rule: ContentSheetConditionalFormat = {
      type: "cellIs",
      ranges: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }],
      operator: "greaterThan",
      formula1: "5",
      style: {
        textColor: { r: 1, g: 0, b: 0 },
        background: { r: 1, g: 1, b: 0.8 },
      },
    };
    const reread = readXlsContent(
      writeXlsContent(
        document([sheet("S", [], { conditionalFormats: [rule] })]),
      ),
    );
    expect(reread.sheets[0]?.conditionalFormats).toStrictEqual([rule]);
  });

  it("round-trips a style-less notBetween rule's two formulas", () => {
    const rule: ContentSheetConditionalFormat = {
      type: "cellIs",
      ranges: [{ startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 }],
      operator: "notBetween",
      formula1: "2",
      formula2: "8",
    };
    const reread = readXlsContent(
      writeXlsContent(
        document([sheet("S", [], { conditionalFormats: [rule] })]),
      ),
    );
    expect(reread.sheets[0]?.conditionalFormats).toStrictEqual([rule]);
  });

  it("refuses a rule variant with no BIFF8 spelling rather than dropping it", () => {
    // A colour scale carrying fewer than the schema's own two-stop minimum is malformed input, so the honest refusal fixture is a variant the FORMAT cannot spell: a year-scoped time period, an ODF extension value no icfTemplate names.
    expect(() =>
      writeXlsContent(
        document([
          sheet("S", [], {
            conditionalFormats: [
              {
                type: "timePeriod",
                ranges: [
                  { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
                ],
                timePeriod: "thisYear",
              },
            ],
          }),
        ]),
      ),
    ).toThrow(/no BIFF8 rule names it/);
  });
});

describe("writeXlsContent: CF12-era conditional formats written (#1186)", () => {
  const RANGE = { startRow: 1, endRow: 4, startColumn: 1, endColumn: 3 };

  function roundTripped(
    rule: ContentSheetConditionalFormat,
  ): ContentSheetConditionalFormat[] {
    const reread = readXlsContent(
      writeXlsContent(
        document([sheet("S", [], { conditionalFormats: [rule] })]),
      ),
    );
    return reread.sheets[0]?.conditionalFormats ?? [];
  }

  it("round-trips a two-stop colour scale with an explicit priority", () => {
    const rule: ContentSheetConditionalFormat = {
      type: "colorScale",
      ranges: [RANGE],
      priority: 3,
      stops: [
        { value: { type: "min" }, color: { r: 1, g: 0, b: 0 } },
        { value: { type: "max" }, color: { r: 0, g: 1, b: 0 } },
      ],
    };
    expect(roundTripped(rule)).toStrictEqual([rule]);
  });

  it("round-trips a three-stop colour scale with numeric, percent, and percentile thresholds", () => {
    const rule: ContentSheetConditionalFormat = {
      type: "colorScale",
      ranges: [RANGE],
      stops: [
        { value: { type: "num", value: "0" }, color: { r: 0, g: 0, b: 1 } },
        {
          value: { type: "percent", value: "50" },
          color: { r: 1, g: 1, b: 0 },
        },
        { value: { type: "max" }, color: { r: 1, g: 0, b: 0 } },
      ],
    };
    expect(roundTripped(rule)).toStrictEqual([{ ...rule, priority: 1 }]);
  });

  it("round-trips a data bar with its bar colour, thresholds, and hidden value", () => {
    const rule: ContentSheetConditionalFormat = {
      type: "dataBar",
      ranges: [RANGE],
      min: { type: "num", value: "0" },
      max: { type: "num", value: "100" },
      // 51/255 and 204/255: colour values exact under the reader's own 255ths quantisation, so the round trip is byte-exact rather than approximately equal.
      color: { r: 0, g: 204 / 255, b: 1 },
      showValue: false,
    };
    expect(roundTripped(rule)).toStrictEqual([{ ...rule, priority: 1 }]);
  });

  it("round-trips an icon set with reverse and a five-icon set", () => {
    const rule: ContentSheetConditionalFormat = {
      type: "iconSet",
      ranges: [RANGE],
      iconSetType: "5Quarters",
      reverse: true,
      thresholds: [
        { type: "min" },
        { type: "percent", value: "25" },
        { type: "percent", value: "50" },
        { type: "percent", value: "75" },
        { type: "max" },
      ],
    };
    expect(roundTripped(rule)).toStrictEqual([{ ...rule, priority: 1 }]);
  });

  it("refuses an icon-set threshold count the named set cannot carry", () => {
    expect(() =>
      roundTripped({
        type: "iconSet",
        ranges: [RANGE],
        iconSetType: "3Arrows",
        thresholds: [
          { type: "min" },
          { type: "percent", value: "50" },
          { type: "max" },
          { type: "percent", value: "75" },
        ],
      }),
    ).toThrow(/cStates table fixes the set at 3/);
  });

  it("refuses an icon-set type outside the seventeen built-in sets", () => {
    expect(() =>
      roundTripped({
        type: "iconSet",
        ranges: [RANGE],
        iconSetType: "Custom3Arrows",
        thresholds: [
          { type: "min" },
          { type: "percent", value: "50" },
          { type: "max" },
        ],
      }),
    ).toThrow(/no BIFF8 byte to be written as/);
  });

  it("refuses stopIfTrue on a visual-scale rule, which [MS-XLS] pins to zero", () => {
    expect(() =>
      roundTripped({
        type: "dataBar",
        ranges: [RANGE],
        min: { type: "min" },
        max: { type: "max" },
        color: { r: 0, g: 0, b: 0 },
        stopIfTrue: true,
      }),
    ).toThrow(/pins CF12's own fStopIfTrue bit to zero/);
  });

  it("round-trips a top10 rule with rank, percent, bottom, and style", () => {
    const rule: ContentSheetConditionalFormat = {
      type: "top10",
      ranges: [RANGE],
      rank: 5,
      percent: true,
      bottom: true,
      priority: 2,
      // Red and pale yellow -- the identical pair the cellIs style round trip above uses, both exact under the reader's 255ths colour quantisation and present in the fixed default palette, so the DXFN icv path round-trips them byte-exactly.
      style: {
        textColor: { r: 1, g: 0, b: 0 },
        background: { r: 1, g: 1, b: 0.8 },
      },
    };
    expect(roundTripped(rule)).toStrictEqual([rule]);
  });

  it("round-trips a plain aboveAverage rule and an equal-average below-average one", () => {
    const above: ContentSheetConditionalFormat = {
      type: "aboveAverage",
      ranges: [RANGE],
    };
    const belowEqualStdDev: ContentSheetConditionalFormat = {
      type: "aboveAverage",
      ranges: [RANGE],
      aboveAverage: false,
      equalAverage: true,
      stdDev: 2,
    };
    expect(roundTripped(above)).toStrictEqual([{ ...above, priority: 1 }]);
    expect(roundTripped(belowEqualStdDev)).toStrictEqual([
      { ...belowEqualStdDev, priority: 1 },
    ]);
  });

  it("round-trips an aboveAverage rule carrying a style", () => {
    const rule: ContentSheetConditionalFormat = {
      type: "aboveAverage",
      ranges: [RANGE],
      style: { textColor: { r: 1, g: 0, b: 0 } },
    };
    expect(roundTripped(rule)).toStrictEqual([{ ...rule, priority: 1 }]);
  });

  it("refuses an aboveAverage standard-deviation count beyond [MS-XLS]'s own table", () => {
    expect(() =>
      roundTripped({
        type: "aboveAverage",
        ranges: [RANGE],
        stdDev: 3,
      }),
    ).toThrow(/admits only 0, 1, or 2/);
  });

  it("round-trips a timePeriod rule", () => {
    const rule: ContentSheetConditionalFormat = {
      type: "timePeriod",
      ranges: [RANGE],
      timePeriod: "last7Days",
    };
    expect(roundTripped(rule)).toStrictEqual([{ ...rule, priority: 1 }]);
  });

  it("round-trips a timePeriod rule carrying a style", () => {
    const rule: ContentSheetConditionalFormat = {
      type: "timePeriod",
      ranges: [RANGE],
      timePeriod: "today",
      style: { background: { r: 1, g: 1, b: 0 } },
    };
    expect(roundTripped(rule)).toStrictEqual([{ ...rule, priority: 1 }]);
  });

  it("round-trips the operand-free family", () => {
    for (const type of [
      "containsBlanks",
      "notContainsBlanks",
      "containsErrors",
      "notContainsErrors",
      "uniqueValues",
      "duplicateValues",
    ] as const) {
      const rule: ContentSheetConditionalFormat = {
        type,
        ranges: [RANGE],
        style: { background: { r: 1, g: 1, b: 0.8 } },
      };
      expect(roundTripped(rule)).toStrictEqual([{ ...rule, priority: 1 }]);
    }
  });

  it("round-trips the text family, recovering the search text from the generated formula", () => {
    for (const type of [
      "containsText",
      "notContainsText",
      "beginsWith",
      "endsWith",
    ] as const) {
      const rule: ContentSheetConditionalFormat = {
        type,
        ranges: [RANGE],
        text: 'a "quoted" needle',
        style: { textColor: { r: 1, g: 0, b: 0 } },
      };
      expect(roundTripped(rule)).toStrictEqual([{ ...rule, priority: 1 }]);
    }
  });

  it("mints unique priorities for rules stating none, and keeps stated ones", () => {
    const rules: ContentSheetConditionalFormat[] = [
      {
        type: "timePeriod",
        ranges: [RANGE],
        timePeriod: "today",
      },
      {
        type: "duplicateValues",
        ranges: [RANGE],
        priority: 1,
      },
      {
        type: "uniqueValues",
        ranges: [RANGE],
      },
    ];
    const reread = readXlsContent(
      writeXlsContent(
        document([sheet("S", [], { conditionalFormats: rules })]),
      ),
    );
    expect(reread.sheets[0]?.conditionalFormats).toStrictEqual([
      { ...rules[0], priority: 2 },
      { ...rules[1], priority: 1 },
      { ...rules[2], priority: 3 },
    ]);
  });

  it("refuses two rules declaring the same priority rather than renumbering them", () => {
    expect(() =>
      roundTripped({
        type: "timePeriod",
        ranges: [RANGE],
        timePeriod: "today",
        priority: 7,
      }),
    ).not.toThrow();
    expect(() =>
      writeXlsContent(
        document([
          sheet("S", [], {
            conditionalFormats: [
              {
                type: "timePeriod",
                ranges: [RANGE],
                timePeriod: "today",
                priority: 7,
              },
              {
                type: "timePeriod",
                ranges: [RANGE],
                timePeriod: "tomorrow",
                priority: 7,
              },
            ],
          }),
        ]),
      ),
    ).toThrow(/requires ipriority to be unique/);
  });

  it("keeps base cellIs groups and CF12 groups on one sheet, both reading back", () => {
    const cellIs: ContentSheetConditionalFormat = {
      type: "cellIs",
      ranges: [RANGE],
      operator: "equal",
      formula1: "3",
    };
    const textRule: ContentSheetConditionalFormat = {
      type: "containsText",
      ranges: [RANGE],
      text: "needle",
    };
    const reread = readXlsContent(
      writeXlsContent(
        document([sheet("S", [], { conditionalFormats: [cellIs, textRule] })]),
      ),
    );
    expect(reread.sheets[0]?.conditionalFormats).toStrictEqual([
      cellIs,
      { ...textRule, priority: 1 },
    ]);
  });

  it("round-trips a data bar whose value is shown (the non-default of the earlier hidden-value test)", () => {
    const rule: ContentSheetConditionalFormat = {
      type: "dataBar",
      ranges: [RANGE],
      min: { type: "min" },
      max: { type: "max" },
      color: { r: 1, g: 0, b: 0 },
    };
    expect(roundTripped(rule)).toStrictEqual([{ ...rule, priority: 1 }]);
  });

  it("round-trips an icon set with showValue false and reverse absent (the opposite of the earlier reverse test)", () => {
    const rule: ContentSheetConditionalFormat = {
      type: "iconSet",
      ranges: [RANGE],
      iconSetType: "3Arrows",
      showValue: false,
      thresholds: [
        { type: "min" },
        { type: "percent", value: "50" },
        { type: "max" },
      ],
    };
    expect(roundTripped(rule)).toStrictEqual([{ ...rule, priority: 1 }]);
  });

  it("round-trips a top10 rule selecting from the top rather than the bottom, by count rather than percent", () => {
    const rule: ContentSheetConditionalFormat = {
      type: "top10",
      ranges: [RANGE],
      rank: 3,
    };
    expect(roundTripped(rule)).toStrictEqual([{ ...rule, priority: 1 }]);
  });

  it("round-trips every combination of aboveAverage/equalAverage", () => {
    const aboveEqual: ContentSheetConditionalFormat = {
      type: "aboveAverage",
      ranges: [RANGE],
      equalAverage: true,
    };
    const belowNotEqual: ContentSheetConditionalFormat = {
      type: "aboveAverage",
      ranges: [RANGE],
      aboveAverage: false,
    };
    expect(roundTripped(aboveEqual)).toStrictEqual([
      { ...aboveEqual, priority: 1 },
    ]);
    expect(roundTripped(belowNotEqual)).toStrictEqual([
      { ...belowNotEqual, priority: 1 },
    ]);
  });

  it("round-trips a rule declaring stopIfTrue", () => {
    const rule: ContentSheetConditionalFormat = {
      type: "top10",
      ranges: [RANGE],
      rank: 1,
      stopIfTrue: true,
    };
    expect(roundTripped(rule)).toStrictEqual([{ ...rule, priority: 1 }]);
  });

  it("round-trips a colour-scale stop of every threshold kind, including percentile and formula", () => {
    const rule: ContentSheetConditionalFormat = {
      type: "colorScale",
      ranges: [RANGE],
      stops: [
        {
          value: { type: "percentile", value: "10" },
          color: { r: 0, g: 0, b: 1 },
        },
        {
          value: { type: "formula", value: "A1" },
          color: { r: 1, g: 0, b: 0 },
        },
      ],
    };
    expect(roundTripped(rule)).toStrictEqual([{ ...rule, priority: 1 }]);
  });

  it("refuses a threshold of a value-bearing type carrying no value", () => {
    expect(() =>
      roundTripped({
        type: "colorScale",
        ranges: [RANGE],
        stops: [
          { value: { type: "percent" }, color: { r: 0, g: 0, b: 0 } },
          { value: { type: "max" }, color: { r: 1, g: 1, b: 1 } },
        ],
      }),
    ).toThrow(/carries no value/);
  });
});

describe("writeSheetConditionalFormats: bytes the reader never inspects (#971/#1186)", () => {
  const RANGE = { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 };
  const NO_ICV = (): number => 0;

  function cf12RecordDataOf(rule: ContentSheetConditionalFormat): Uint8Array {
    const pieces = writeSheetConditionalFormats(
      sheet("S", [], { conditionalFormats: [rule] }),
      NO_ICV,
    );
    const total = pieces.reduce((sum, piece) => sum + piece.length, 0);
    const stream = new Uint8Array(total);
    let offset = 0;
    for (const piece of pieces) {
      stream.set(piece, offset);
      offset += piece.length;
    }
    const cf12 = readRecords(stream).find(
      (record) => record.type === RECORD_CF12,
    );
    if (cf12 === undefined) {
      throw new Error("no CF12 record was written");
    }
    return cf12.data;
  }

  function u32At(data: Uint8Array, offset: number): number {
    return new DataView(
      data.buffer,
      data.byteOffset,
      data.byteLength,
    ).getUint32(offset, true);
  }

  function f64At(data: Uint8Array, offset: number): number {
    return new DataView(
      data.buffer,
      data.byteOffset,
      data.byteLength,
    ).getFloat64(offset, true);
  }

  // CF12's own skeleton up to and including cbDxf ([MS-XLS] 2.4.43): frtRefHeader.rt(2) + grbitFrt(2) + ref8(8) + ct(1) + cp(1) + cce1(2) + cce2(2) = 18 bytes, then cbDxf itself as a 4-byte field.
  const CB_DXF_OFFSET = 18;

  it("writes cbDxf as 0 for a rule stating no style at all", () => {
    const data = cf12RecordDataOf({
      type: "aboveAverage",
      ranges: [RANGE],
    });
    expect(u32At(data, CB_DXF_OFFSET)).toBe(0);
  });

  it("writes a non-zero cbDxf for a rule stating a style", () => {
    const data = cf12RecordDataOf({
      type: "aboveAverage",
      ranges: [RANGE],
      style: { textColor: { r: 1, g: 0, b: 0 } },
    });
    expect(u32At(data, CB_DXF_OFFSET)).toBeGreaterThan(0);
  });

  // A colour-scale CF12's rgbCt (CFGradient, [MS-XLS] 2.5.32) starts right after the shared skeleton: cbDxf(4, always reading 0 here since ct 0x03 pins cbDxf to 0) + the empty dxf itself (0 bytes) + fmlaActive.cce(2) + fStopIfTrue(1) + ipriority(2) + icfTemplate(2) + cbTemplateParm(1) + templateParams(16) = 28 bytes after CB_DXF_OFFSET's own 4, i.e. CB_DXF_OFFSET + 4 + 28 = 50 is wrong -- rechecked directly below against the record's own declared cbDxf/cbTemplateParm fields rather than hardcoded a second time, so a change to any one of those fixed sizes cannot silently desync this offset from the real layout.
  function gradientOffsetOf(data: Uint8Array): number {
    const cbDxf = u32At(data, CB_DXF_OFFSET);
    const cbTemplateParmOffset = CB_DXF_OFFSET + 4 + cbDxf + 2 + 1 + 2 + 2; // + fmlaActive.cce + fStopIfTrue + ipriority + icfTemplate
    const cbTemplateParm = data[cbTemplateParmOffset] ?? 0;
    return cbTemplateParmOffset + 1 + cbTemplateParm;
  }

  // CFGradient's own header (unused(2) + reserved1(1) + cInterpCurve(1) + cGradientCurve(1) + flags(1) = 6 bytes), then rgInterp: cInterpCurve entries of CFGradientInterpItem (a CFVO -- 3 bytes for a fixed min/max stop, cce=0 -- then the stop's own interpolation-position float, 8 bytes).
  function interpFractionAt(data: Uint8Array, stopIndex: number): number {
    const rgInterpStart = gradientOffsetOf(data) + 6;
    const stopStart = rgInterpStart + stopIndex * (3 + 8);
    return f64At(data, stopStart + 3);
  }

  it("writes a two-stop gradient's own fixed 0.0/1.0 interpolation fractions, not the three-stop set", () => {
    const data = cf12RecordDataOf({
      type: "colorScale",
      ranges: [RANGE],
      stops: [
        { value: { type: "min" }, color: { r: 0, g: 0, b: 0 } },
        { value: { type: "max" }, color: { r: 1, g: 1, b: 1 } },
      ],
    });
    expect(interpFractionAt(data, 0)).toBe(0.0);
    expect(interpFractionAt(data, 1)).toBe(1.0);
  });

  it("writes a three-stop gradient's own fixed 0.0/0.5/1.0 interpolation fractions, not the two-stop set", () => {
    const data = cf12RecordDataOf({
      type: "colorScale",
      ranges: [RANGE],
      stops: [
        { value: { type: "min" }, color: { r: 0, g: 0, b: 0 } },
        // "min" again (rather than a value-bearing type): every stop here must compile to the identical fixed 3-byte CFVO (cce 0, no rgce) for interpFractionAt's own fixed stride assumption to address the right byte offset -- the middle stop's own threshold value is irrelevant to what this test checks.
        { value: { type: "min" }, color: { r: 0.5, g: 0.5, b: 0.5 } },
        { value: { type: "max" }, color: { r: 1, g: 1, b: 1 } },
      ],
    });
    expect(interpFractionAt(data, 0)).toBe(0.0);
    expect(interpFractionAt(data, 1)).toBe(0.5);
  });
});
