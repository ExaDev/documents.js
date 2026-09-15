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
import { describe, expect, it, vi } from "vitest";

import {
  RECORD_CALCCOUNT,
  RECORD_CF12,
  RECORD_CONDFMT,
  RECORD_CONDFMT12,
  RECORD_CONTINUE,
  RECORD_DIMENSIONS,
  RECORD_EOF,
  RECORD_EXTERNSHEET,
  RECORD_HORIZONTALPAGEBREAKS,
  RECORD_LBL,
  RECORD_MERGECELLS,
  RECORD_MSODRAWING,
  RECORD_MSODRAWINGGROUP,
  RECORD_ROW,
  RECORD_SETUP,
  RECORD_SUPBOOK,
  RECORD_VERTICALPAGEBREAKS,
} from "./biff/record-types";
import { readRecords } from "./biff/records";
import * as writtenCellsModule from "./written-cells";
import { PALETTE_ENTRY_COUNT } from "./biff/xf-colors";
import { BiffWriteError } from "./biff/write-errors";
import type { XlsContentDocument } from "./content";
import { readXls, readXlsContent } from "./content";
import { isXlsFile } from "./container";
import {
  buildCellXfPlan,
  buildFontPlan,
  buildFormatPlan,
  buildPalettePlan,
  buildSstPlan,
  buildWorkbookStream,
  builtinCode,
  writeXls,
  writeXlsContent,
} from "./write";
import {
  validateRuleCount,
  writeSheetConditionalFormats,
} from "./workbook/conditional-format-write";
import { writeSheetDataValidations } from "./workbook/data-validation-write";
import { buildWorksheetSubstream } from "./workbook/sheet-writer";
import * as drawingWriterModule from "./workbook/drawing-writer";
import { GENERAL_CELL_XF_INDEX } from "./workbook/globals-writer";

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
    expect(findCell(content, 0, 0, 1)?.displayText).toBe("FALSE");
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
    ).toThrow(/is not one of the eight error values/);
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

    it("distinguishes four cells each bordered identically on a different single side", () => {
      // Each cell's own decoration-signature string must name which side it is, not just the style/colour that side shares with every other cell here -- otherwise two of these would collide onto the same interned XF and each other's cell would read back with the wrong side bordered.
      const border = { color: blue, widthPt: 0.75 } as const;
      const bytes = writeXlsContent(
        document([
          sheet("Sheet1", [
            cell(
              0,
              0,
              { kind: "string", value: "l" },
              { borders: { left: border } },
            ),
            cell(
              0,
              1,
              { kind: "string", value: "r" },
              { borders: { right: border } },
            ),
            cell(
              0,
              2,
              { kind: "string", value: "t" },
              { borders: { top: border } },
            ),
            cell(
              0,
              3,
              { kind: "string", value: "b" },
              { borders: { bottom: border } },
            ),
          ]),
        ]),
      );
      const read = readXlsContent(bytes);
      expect(findCell(read, 0, 0, 0)?.borders).toStrictEqual({ left: border });
      expect(findCell(read, 0, 0, 1)?.borders).toStrictEqual({ right: border });
      expect(findCell(read, 0, 0, 2)?.borders).toStrictEqual({ top: border });
      expect(findCell(read, 0, 0, 3)?.borders).toStrictEqual({
        bottom: border,
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
      // Own-property check, not just a value check: a horizontal-only cell must leave the verticalAlignment KEY absent, not merely undefined when read through optional chaining -- a bug materialising the key with an explicit undefined value would pass a plain .toBeUndefined() assertion just as easily as a genuinely absent key would.
      expect(
        Object.hasOwn(findCell(content, 0, 0, 0) ?? {}, "verticalAlignment"),
      ).toBe(false);
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
      // Own-property check, not just a value check: a vertical-only cell must leave the alignment KEY absent, not merely undefined when read through optional chaining -- see the mirrored check in the horizontal-alignment test above for why a plain .toBeUndefined() would not catch this.
      expect(Object.hasOwn(findCell(content, 0, 0, 0) ?? {}, "alignment")).toBe(
        false,
      );
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

    it("round-trips a border-only empty cell through a real Blank record, with neither fill nor alignment involved", () => {
      // Isolates the borders leg of mapCell's own blank-drop conjunction from every sibling leg (background/alignment/verticalAlignment/font) -- a cell whose ONLY reason to survive is its own border must still survive when nothing else about it is decorated.
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
      // Isolates the verticalAlignment leg of mapCell's own blank-drop conjunction from every sibling leg -- a cell whose ONLY reason to survive is its own vertical alignment must still survive when nothing else about it is decorated.
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
    // toStrictEqual on the width, not just .toBeCloseTo: a column carrying only widthPt must not also carry a spuriously-materialised hidden key, which a per-field check reading only widthPt would miss entirely. column3 always round-trips with SOME widthPt too -- a real ColInfo record always states a column's own width, whether or not the document that produced it declared one -- so hidden alone is confirmed directly instead.
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
        document([
          sheet("Sheet1", [cell(0, 256, { kind: "number", value: 1 })]),
        ]),
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
    expect(Object.hasOwn(content.sheets[0] ?? {}, "dataValidations")).toBe(
      false,
    );
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

  it("refuses a non-spreadsheet DocumentTree, naming the offending kind", () => {
    const wordTree: ReturnType<typeof assembleTree> = {
      kind: "wordprocessing",
      metadata: {},
      children: [],
    };
    expect(() => writeXls(wordTree)).toThrow(
      "writeXls was given a DocumentTree of kind 'wordprocessing', but a .xls workbook can only be written from a 'spreadsheet' document",
    );
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

  it("states the Setup record's own fPortrait bit from a custom page size's own dimensions, since no paper code survives to carry it", () => {
    // Custom page sizes never round-trip their dimensions at all (the reader falls back to Letter regardless, per the test above), so the orientation flag this specific case writes is invisible to any round trip through readXlsContent -- reading the raw Setup record's own grbit word is the only way to check it.
    function grbitFor(widthPt: number, heightPt: number): number {
      const bytes = buildWorksheetSubstream(
        sheet("S", [cell(0, 0, { kind: "number", value: 1 })], {
          printSettings: { ...PRINT_SETTINGS, pageSize: { widthPt, heightPt } },
        }),
        { icvOf: () => 0, xfIndexForCell: () => 0, sstIndexFor: () => 0 },
        { msoDrawingRecords: [], objRecords: [] },
      );
      const setup = readRecords(bytes).find(
        (record) => record.type === RECORD_SETUP,
      );
      if (setup === undefined) {
        throw new Error("no Setup record was written");
      }
      return new DataView(
        setup.data.buffer,
        setup.data.byteOffset,
        setup.data.byteLength,
      ).getUint16(10, true);
    }
    const SETUP_FLAG_PORTRAIT = 0x0002;
    expect(grbitFor(400, 500) & SETUP_FLAG_PORTRAIT).not.toBe(0); // taller than wide
    expect(grbitFor(500, 400) & SETUP_FLAG_PORTRAIT).toBe(0); // wider than tall
    // Exactly square: <= (not <) is what decides portrait for the tie, so this is the one case that actually distinguishes the two operators.
    expect(grbitFor(450, 450) & SETUP_FLAG_PORTRAIT).not.toBe(0);
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

  it("keeps a manual page break landing exactly on BIFF8's own last row/column, rather than dropping it too", () => {
    const settings: ContentSheetPrintSettings = {
      ...PRINT_SETTINGS,
      manualBreaks: { rows: [0xffff], columns: [0xff] },
    };
    expect(roundTripped(settings)?.manualBreaks).toStrictEqual({
      rows: [0xffff],
      columns: [0xff],
    });
  });

  it("writes manual page breaks in ascending index order regardless of the order they were declared in", () => {
    const settings: ContentSheetPrintSettings = {
      ...PRINT_SETTINGS,
      manualBreaks: { rows: [20, 5, 15], columns: [9, 1, 4] },
    };
    expect(roundTripped(settings)?.manualBreaks).toStrictEqual({
      rows: [5, 15, 20],
      columns: [1, 4, 9],
    });
  });

  it("round-trips a row-only manual break with no column break, and a column-only one with no row break", () => {
    expect(
      roundTripped({
        ...PRINT_SETTINGS,
        manualBreaks: { rows: [7], columns: [] },
      })?.manualBreaks,
    ).toStrictEqual({ rows: [7], columns: [] });
    expect(
      roundTripped({
        ...PRINT_SETTINGS,
        manualBreaks: { rows: [], columns: [4] },
      })?.manualBreaks,
    ).toStrictEqual({ rows: [], columns: [4] });
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
    const content = document([
      sheet("Sheet1", [
        cell(0, 0, { kind: "error", value: "#DIV/0!" }, { formula: "A1/A2" }),
      ]),
    ]);
    const written = findCell(readXlsContent(writeXlsContent(content)), 0, 0, 0);
    expect(written?.formula).toBe("A1/A2");
    expect(written?.value).toStrictEqual({ kind: "error", value: "#DIV/0!" });
  });

  it("refuses a formula whose cached error result is not one of the eight [MS-XLS] defines", () => {
    expect(() =>
      writeXlsContent(
        document([
          sheet("Sheet1", [
            cell(
              0,
              0,
              { kind: "error", value: "#MADE_UP!" },
              { formula: "A1/A2" },
            ),
          ]),
        ]),
      ),
    ).toThrow(/is not one of the eight error values/);
  });

  it("refuses a formula whose cached value resolves to an empty cell, which no Formula record can express", () => {
    expect(() =>
      writeXlsContent(
        document([
          sheet("Sheet1", [
            cell(0, 0, { kind: "empty" }, { formula: "IF(FALSE,1)" }),
          ]),
        ]),
      ),
    ).toThrow(/resolves to an empty cell/);
  });

  it("round-trips a formula whose cached result is a string, writing the trailing String record it needs", () => {
    const content = document([
      sheet("Sheet1", [
        cell(
          0,
          0,
          { kind: "string", value: "positive" },
          { formula: 'IF(A1>0,"positive","not positive")' },
        ),
      ]),
    ]);
    const written = findCell(readXlsContent(writeXlsContent(content)), 0, 0, 0);
    expect(written?.formula).toBe('IF(A1>0,"positive","not positive")');
    expect(written?.value).toStrictEqual({
      kind: "string",
      value: "positive",
    });
  });

  it("round-trips a formula whose cached result is a date, a time, and a date-time", () => {
    for (const value of [
      { kind: "date", value: "2026-09-03" },
      { kind: "time", value: "13:45:30" },
      { kind: "dateTime", value: "2026-09-03T13:45:30" },
    ] as const) {
      const content = document([
        sheet("Sheet1", [cell(0, 0, value, { formula: "A1" })]),
      ]);
      const written = findCell(
        readXlsContent(writeXlsContent(content)),
        0,
        0,
        0,
      );
      expect(written?.value).toStrictEqual(value);
    }
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

  it("round-trips a notBetween rule's two formulas", () => {
    // 'between' alone does not prove the writer's own isTwoOperand check actually names BOTH two-operand operators rather than just the one the sibling test above already exercises -- a rule refused for missing its second formula only when it should be, or accepted with one only for the operator that never needed it, would pass that test regardless.
    const rule: ContentSheetDataValidation = {
      ranges: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }],
      type: "decimal",
      operator: "notBetween",
      formula1: "1",
      formula2: "10",
    };
    const reread = readXlsContent(
      writeXlsContent(document([sheet("S", [], { dataValidations: [rule] })])),
    );
    expect(reread.sheets[0]?.dataValidations).toStrictEqual([rule]);
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
      // endRow deliberately stays in-grid (0), unlike the other three edges below sharing one deviant field with its own pair: an overRow fixture whose own endRow ALSO exceeds 0xffff would still throw with the startRow check dropped entirely, since the endRow check alone already catches it -- only isolating startRow as the sole out-of-range field actually exercises that check on its own.
      ranges: [{ startRow: 0x10000, endRow: 0, startColumn: 0, endColumn: 0 }],
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

  it("accepts a range sitting exactly on BIFF8's own grid boundary, not just short of it", () => {
    // 0xffff and 0xff are the largest row/column index BIFF8's own u16/u8 fields can carry -- a range naming exactly these values is still addressable, unlike the one-past-the-edge values the previous test throws on, so the boundary check must be a strict `>`, not `>=`.
    const rule: ContentSheetDataValidation = {
      ranges: [
        {
          startRow: 0xffff,
          endRow: 0xffff,
          startColumn: 0xff,
          endColumn: 0xff,
        },
      ],
      type: "whole",
      operator: "greaterThan",
      formula1: "5",
    };
    expect(() =>
      writeXlsContent(document([sheet("S", [], { dataValidations: [rule] })])),
    ).not.toThrow();
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

  it("round-trips a cellIs rule under each of the remaining single-operand operators cpOf's own switch names -- between/notBetween/equal/greaterThan already exercised above", () => {
    const operators = [
      "between",
      "notEqual",
      "lessThan",
      "greaterThanOrEqual",
    ] as const;
    for (const operator of operators) {
      const rule: ContentSheetConditionalFormat = {
        type: "cellIs",
        ranges: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }],
        operator,
        formula1: "5",
      };
      const reread = readXlsContent(
        writeXlsContent(
          document([sheet("S", [], { conditionalFormats: [rule] })]),
        ),
      );
      expect(reread.sheets[0]?.conditionalFormats).toStrictEqual([rule]);
    }
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

  it("refuses a conditional-format rule carrying no range", () => {
    expect(() =>
      writeXlsContent(
        document([
          sheet("S", [], {
            conditionalFormats: [{ type: "uniqueValues", ranges: [] }],
          }),
        ]),
      ),
    ).toThrow(
      "a conditional-format rule carrying no range states nothing; the schema requires at least one",
    );
  });

  it("refuses a conditional-format range outside BIFF8's own grid, at each of its four edges, naming the exact rows/columns", () => {
    const base = { type: "uniqueValues" as const };
    const edges = [
      { startRow: 0x10000, endRow: 0, startColumn: 0, endColumn: 0 },
      { startRow: 0, endRow: 0x10000, startColumn: 0, endColumn: 0 },
      { startRow: 0, endRow: 0, startColumn: 0x100, endColumn: 0 },
      { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0x100 },
    ];
    for (const range of edges) {
      expect(() =>
        writeXlsContent(
          document([
            sheet("S", [], {
              conditionalFormats: [{ ...base, ranges: [range] }],
            }),
          ]),
        ),
      ).toThrow(
        `a conditional-format range (rows ${range.startRow}-${range.endRow}, columns ${range.startColumn}-${range.endColumn}) is outside BIFF8's own grid; a .xls workbook cannot address it`,
      );
    }
  });

  it("accepts a conditional-format range sitting exactly at each of BIFF8's own four grid edges, not one past it", () => {
    const base = { type: "uniqueValues" as const };
    const edges = [
      { startRow: 0xffff, endRow: 0, startColumn: 0, endColumn: 0 },
      { startRow: 0, endRow: 0xffff, startColumn: 0, endColumn: 0 },
      { startRow: 0, endRow: 0, startColumn: 0xff, endColumn: 0 },
      { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0xff },
    ];
    for (const range of edges) {
      expect(() =>
        writeXlsContent(
          document([
            sheet("S", [], {
              conditionalFormats: [{ ...base, ranges: [range] }],
            }),
          ]),
        ),
      ).not.toThrow();
    }
  });

  it("writes no CondFmt/CondFmt12 records at all for a sheet stating an empty conditionalFormats array", () => {
    expect(
      writeSheetConditionalFormats(
        sheet("S", [], { conditionalFormats: [] }),
        () => 0,
      ),
    ).toStrictEqual([]);
  });

  it("refuses a rule count exceeding CondFmt's own 15-bit nID field, naming the exact count", () => {
    expect(() => {
      validateRuleCount(0x8000);
    }).toThrow(
      "this sheet's 32768 conditional-format rules exceed CondFmt's own 15-bit nID field",
    );
  });

  it("accepts a rule count sitting exactly at CondFmt's own 15-bit nID field boundary", () => {
    expect(() => {
      validateRuleCount(0x7fff);
    }).not.toThrow();
  });

  it("refuses 32768 conditional-format rules before writing a single record, rather than silently accepting more than CondFmt's own 15-bit nID field allows", () => {
    const range = { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 };
    const rules: ContentSheetConditionalFormat[] = Array.from(
      { length: 0x8000 },
      () => ({ type: "uniqueValues", ranges: [range] }),
    );
    expect(() =>
      writeSheetConditionalFormats(
        sheet("S", [], { conditionalFormats: rules }),
        () => 0,
      ),
    ).toThrow(
      "this sheet's 32768 conditional-format rules exceed CondFmt's own 15-bit nID field",
    );
  });

  it("assigns each rule its own 1-based nID in declaration order across three rules, not just the two a smaller fixture cannot distinguish from an off-by-one", () => {
    const range = { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 };
    const rules: ContentSheetConditionalFormat[] = [
      { type: "containsText", ranges: [range], text: "a" },
      { type: "containsText", ranges: [range], text: "b" },
      { type: "containsText", ranges: [range], text: "c" },
    ];
    const reread = readXlsContent(
      writeXlsContent(
        document([sheet("S", [], { conditionalFormats: rules })]),
      ),
    );
    expect(
      reread.sheets[0]?.conditionalFormats?.map((rule) =>
        rule.type === "containsText" ? rule.text : undefined,
      ),
    ).toStrictEqual(["a", "b", "c"]);
  });

  // nID only matters to a real consumer resolving a later CFEx record's own cross-reference (this package's own reader never emits or needs one on a self-written file, and explicitly skips CondFmt12's copy of the field as unused) -- so its correctness is invisible to every round-trip test above and has to be read directly out of the raw CondFmt/CondFmt12 bytes instead.
  it("writes each base CondFmt group's own nID as its 1-based position among the sheet's rules, not the position minus one", () => {
    const range = { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 };
    const rules: ContentSheetConditionalFormat[] = [
      { type: "cellIs", ranges: [range], operator: "equal", formula1: "1" },
      { type: "cellIs", ranges: [range], operator: "equal", formula1: "2" },
      { type: "cellIs", ranges: [range], operator: "equal", formula1: "3" },
    ];
    const pieces = writeSheetConditionalFormats(
      sheet("S", [], { conditionalFormats: rules }),
      () => 0,
    );
    const stream = new Uint8Array(
      pieces.reduce((total, piece) => total + piece.length, 0),
    );
    let offset = 0;
    for (const piece of pieces) {
      stream.set(piece, offset);
      offset += piece.length;
    }
    const nIDs = readRecords(stream)
      .filter((record) => record.type === RECORD_CONDFMT)
      .map((record) => {
        const view = new DataView(
          record.data.buffer,
          record.data.byteOffset,
          record.data.byteLength,
        );
        return (view.getUint16(2, true) >>> 1) & 0x7fff;
      });
    expect(nIDs).toStrictEqual([1, 2, 3]);
  });

  it("writes each CF12 group's own nID as its 1-based position among the sheet's rules, not the position minus one", () => {
    const range = { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 };
    const rules: ContentSheetConditionalFormat[] = [
      { type: "uniqueValues", ranges: [range] },
      { type: "duplicateValues", ranges: [range] },
      { type: "containsBlanks", ranges: [range] },
    ];
    const pieces = writeSheetConditionalFormats(
      sheet("S", [], { conditionalFormats: rules }),
      () => 0,
    );
    const stream = new Uint8Array(
      pieces.reduce((total, piece) => total + piece.length, 0),
    );
    let offset = 0;
    for (const piece of pieces) {
      stream.set(piece, offset);
      offset += piece.length;
    }
    const nIDs = readRecords(stream)
      .filter((record) => record.type === RECORD_CONDFMT12)
      .map((record) => {
        const view = new DataView(
          record.data.buffer,
          record.data.byteOffset,
          record.data.byteLength,
        );
        // rt(2) + grbitFrt(2) + refBound's four u16s(8) + ccf(2) = 14 bytes before the fToughRecalc+nID word.
        return (view.getUint16(14, true) >>> 1) & 0x7fff;
      });
    expect(nIDs).toStrictEqual([1, 2, 3]);
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

  it("resolves each of iconSetThresholdCount's own three boundaries to the exact right count, not just one interior set from each band", () => {
    // 3Symbols2 (index 7) and 4Arrows (index 8) straddle the first boundary; 4TrafficLights (index 12) and 5Arrows (index 13) straddle the second -- each pair proves that boundary is <=, not < or <=-one-off.
    const caseFor = (
      iconSetType: string,
      count: number,
    ): ContentSheetConditionalFormat => ({
      type: "iconSet",
      ranges: [RANGE],
      iconSetType,
      thresholds: Array.from({ length: count }, (_unused, index) =>
        index === 0
          ? { type: "min" as const }
          : index === count - 1
            ? { type: "max" as const }
            : {
                type: "percent" as const,
                value: String((index * 100) / (count - 1)),
              },
      ),
    });
    for (const [iconSetType, count] of [
      ["3Symbols2", 3],
      ["4Arrows", 4],
      ["4TrafficLights", 4],
      ["5Arrows", 5],
    ] as const) {
      const rule = caseFor(iconSetType, count);
      expect(roundTripped(rule)).toStrictEqual([{ ...rule, priority: 1 }]);
    }
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

  it("refuses stopIfTrue on each of the other two visual-scale rule types on its own, not only dataBar", () => {
    expect(() =>
      roundTripped({
        type: "colorScale",
        ranges: [RANGE],
        stops: [
          { value: { type: "min" }, color: { r: 1, g: 0, b: 0 } },
          { value: { type: "max" }, color: { r: 0, g: 1, b: 0 } },
        ],
        stopIfTrue: true,
      }),
    ).toThrow(/pins CF12's own fStopIfTrue bit to zero/);
    expect(() =>
      roundTripped({
        type: "iconSet",
        ranges: [RANGE],
        iconSetType: "3Arrows",
        thresholds: [
          { type: "min" },
          { type: "percent", value: "50" },
          { type: "max" },
        ],
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

  it("round-trips a top10 rule selecting from the bottom by count, isolating fTop from fPercent", () => {
    const rule: ContentSheetConditionalFormat = {
      type: "top10",
      ranges: [RANGE],
      rank: 3,
      bottom: true,
    };
    expect(roundTripped(rule)).toStrictEqual([{ ...rule, priority: 1 }]);
  });

  it("round-trips a top10 rule selecting from the top by percent, isolating fPercent from fTop", () => {
    const rule: ContentSheetConditionalFormat = {
      type: "top10",
      ranges: [RANGE],
      rank: 3,
      percent: true,
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

describe("buildWorksheetSubstream: Dimensions bytes content.ts never reads back", () => {
  // content.ts's own readSheetRecords stores RECORD_DIMENSIONS into usedRange, but nothing downstream of that ever reads the field back into a ContentSheet -- so no round trip through readXlsContent can distinguish a correct Dimensions record from a subtly wrong one, and these tests call the writer directly instead.
  const NO_DRAWING = { msoDrawingRecords: [], objRecords: [] };
  const NO_STYLE_CTX = {
    icvOf: () => 0,
    xfIndexForCell: () => 0,
    sstIndexFor: () => 0,
  };

  function dimensionsDataOf(cells: readonly ContentSheetCell[]): Uint8Array {
    const bytes = buildWorksheetSubstream(
      sheet("S", cells),
      NO_STYLE_CTX,
      NO_DRAWING,
    );
    const dimensions = readRecords(bytes).find(
      (record) => record.type === RECORD_DIMENSIONS,
    );
    if (dimensions === undefined) {
      throw new Error("no Dimensions record was written");
    }
    return dimensions.data;
  }

  function u32AtOffset(data: Uint8Array, offset: number): number {
    return new DataView(
      data.buffer,
      data.byteOffset,
      data.byteLength,
    ).getUint32(offset, true);
  }

  function u16AtOffset(data: Uint8Array, offset: number): number {
    return new DataView(
      data.buffer,
      data.byteOffset,
      data.byteLength,
    ).getUint16(offset, true);
  }

  it("writes Dimensions as one past the true max row/column, and the true min, across several cells", () => {
    const data = dimensionsDataOf([
      cell(3, 5, { kind: "number", value: 1 }),
      cell(1, 9, { kind: "number", value: 2 }),
      cell(7, 2, { kind: "number", value: 3 }),
    ]);
    // rwMic(4) rwMac(4) colMic(2) colMac(2)
    expect(u32AtOffset(data, 0)).toBe(1); // rwMic: the smallest row (1)
    expect(u32AtOffset(data, 4)).toBe(8); // rwMac: the largest row (7) + 1
    expect(u16AtOffset(data, 8)).toBe(2); // colMic: the smallest column (2)
    expect(u16AtOffset(data, 10)).toBe(10); // colMac: the largest column (9) + 1
  });

  it("writes Dimensions as all zero for a sheet with no written cells", () => {
    const data = dimensionsDataOf([]);
    expect(u32AtOffset(data, 0)).toBe(0);
    expect(u32AtOffset(data, 4)).toBe(0);
    expect(u16AtOffset(data, 8)).toBe(0);
    expect(u16AtOffset(data, 10)).toBe(0);
  });
});

describe("buildWorksheetSubstream: sheet-writer.ts's own boundary and array-emptiness checks", () => {
  const NO_DRAWING = { msoDrawingRecords: [], objRecords: [] };
  const NO_STYLE_CTX = {
    icvOf: () => 0,
    xfIndexForCell: () => 0,
    sstIndexFor: () => 0,
  };

  function recordsOf(
    cells: readonly ContentSheetCell[],
    overrides: Partial<Omit<ContentSheet, "name" | "cells">> = {},
  ) {
    const bytes = buildWorksheetSubstream(
      sheet("S", cells, overrides),
      NO_STYLE_CTX,
      NO_DRAWING,
    );
    return readRecords(bytes);
  }

  function u16At(data: Uint8Array, offset: number): number {
    return new DataView(
      data.buffer,
      data.byteOffset,
      data.byteLength,
    ).getUint16(offset, true);
  }

  /** RECORD_ROW's own first two u16 fields are rowIndex then colMic -- filters a records list down to the one Row record naming the given index, since a sheet with several rows produces several. */
  function rowRecordAt(
    records: ReturnType<typeof readRecords>,
    rowIndex: number,
  ) {
    const row = records.find(
      (record) =>
        record.type === RECORD_ROW && u16At(record.data, 0) === rowIndex,
    );
    if (row === undefined) {
      throw new Error(`no Row record for index ${rowIndex} was written`);
    }
    return row.data;
  }

  it("writes Row's own colMic/colMac as the row's true min column and one past its true max, across several cells sharing a row", () => {
    const records = recordsOf([
      cell(2, 5, { kind: "number", value: 1 }),
      cell(2, 1, { kind: "number", value: 2 }),
      cell(2, 9, { kind: "number", value: 3 }),
    ]);
    const data = rowRecordAt(records, 2);
    expect(u16At(data, 2)).toBe(1); // colMic: the smallest column (1)
    expect(u16At(data, 4)).toBe(10); // colMac: the largest column (9) + 1
  });

  it("writes Row's own colMic/colMac as 0/0 for a declared row with no cells of its own", () => {
    const records = recordsOf([cell(0, 0, { kind: "number", value: 1 })], {
      rows: [{ index: 4, heightPt: 20 }],
    });
    const data = rowRecordAt(records, 4);
    expect(u16At(data, 2)).toBe(0);
    expect(u16At(data, 4)).toBe(0);
  });

  it("writes no MergeCells record at all for a sheet whose cells carry no real span", () => {
    // Every ordinary cell resolves rowSpan/colSpan to exactly 1 by default -- the degenerate case a real merge (either axis greater than one) must be told apart from, not just "rowSpan or colSpan stated at all".
    const records = recordsOf([cell(0, 0, { kind: "number", value: 1 })]);
    expect(records.some((record) => record.type === RECORD_MERGECELLS)).toBe(
      false,
    );
  });

  it("writes no MergeCells entry for a cell whose rowSpan/colSpan are both explicitly 1", () => {
    const records = recordsOf([
      cell(0, 0, { kind: "number", value: 1 }, { rowSpan: 1, colSpan: 1 }),
    ]);
    expect(records.some((record) => record.type === RECORD_MERGECELLS)).toBe(
      false,
    );
  });

  it("writes CalcCount's own cIter as the real iteration-limit constant, not an empty calculation-state block", () => {
    const records = recordsOf([cell(0, 0, { kind: "number", value: 1 })]);
    const calcCount = records.find(
      (record) => record.type === RECORD_CALCCOUNT,
    );
    if (calcCount === undefined) {
      throw new Error("no CalcCount record was written");
    }
    expect(u16At(calcCount.data, 0)).toBe(100);
  });

  it("refuses a column past BIFF8's own 256-column grid", () => {
    expect(() =>
      buildWorksheetSubstream(
        sheet("S", [], { columns: [{ index: 256, widthPt: 50 }] }),
        NO_STYLE_CTX,
        NO_DRAWING,
      ),
    ).toThrow(/outside BIFF8's own 256-column grid/);
  });

  it("accepts a column exactly at BIFF8's own last column index", () => {
    expect(() =>
      buildWorksheetSubstream(
        sheet("S", [], { columns: [{ index: 255, widthPt: 50 }] }),
        NO_STYLE_CTX,
        NO_DRAWING,
      ),
    ).not.toThrow();
  });

  it("writes ColInfo's own flags as 0, not COLINFO_FLAG_HIDDEN, for a stated-but-not-hidden column", () => {
    const records = recordsOf([], {
      columns: [{ index: 0, widthPt: 100 }],
    });
    const colInfo = records.find((record) => record.type === 0x7d); // RECORD_COLINFO
    if (colInfo === undefined) {
      throw new Error("no ColInfo record was written");
    }
    expect(u16At(colInfo.data, 8)).toBe(0); // grbit
  });

  it("writes the Setup record's own iScale as the inactive-scale sentinel when fitToPages is stated, even if scalePercent is also present", () => {
    // ContentSheetPrintSettings does not enforce the two as mutually exclusive at the type level -- fitToPages being stated is what must win, not merely scalePercent being absent.
    const records = recordsOf([], {
      printSettings: {
        ...PRINT_SETTINGS,
        scalePercent: 55,
        fitToPages: { width: 2, height: 3 },
      },
    });
    const setup = records.find((record) => record.type === RECORD_SETUP);
    if (setup === undefined) {
      throw new Error("no Setup record was written");
    }
    expect(u16At(setup.data, 2)).toBe(100); // iScale: SETUP_INACTIVE_SCALE_PERCENT, not the stated 55
  });

  it("writes no HorizontalPageBreaks/VerticalPageBreaks record for a sheet with declared but empty break arrays", () => {
    const records = recordsOf([], {
      printSettings: {
        ...PRINT_SETTINGS,
        manualBreaks: { rows: [], columns: [] },
      },
    });
    expect(
      records.some((record) => record.type === RECORD_HORIZONTALPAGEBREAKS),
    ).toBe(false);
    expect(
      records.some((record) => record.type === RECORD_VERTICALPAGEBREAKS),
    ).toBe(false);
  });

  it("writes HorizontalPageBreaks' own break indices in ascending order on the wire, not the declared order, before any read-side re-sorting could mask it", () => {
    // Reading a break back through ContentSheetPrintSettings' own round trip re-sorts on the read side too (sheet.ts's ascendingDistinct), so a roundtrip assertion alone cannot tell a writer that sorts from one that does not -- this reads the raw HorizontalPageBreaks record directly instead.
    const records = recordsOf([], {
      printSettings: {
        ...PRINT_SETTINGS,
        manualBreaks: { rows: [20, 5, 15], columns: [] },
      },
    });
    const breaks = records.find(
      (record) => record.type === RECORD_HORIZONTALPAGEBREAKS,
    );
    if (breaks === undefined) {
      throw new Error("no HorizontalPageBreaks record was written");
    }
    expect(u16At(breaks.data, 0)).toBe(3); // cbrk
    expect(u16At(breaks.data, 2)).toBe(5); // first break: the smallest index
    expect(u16At(breaks.data, 8)).toBe(15); // second break: the middle index
    expect(u16At(breaks.data, 14)).toBe(20); // third break: the largest index
  });

  it("writes no MergeCells or comment records at all for a sheet with neither", () => {
    const records = recordsOf([cell(0, 0, { kind: "number", value: 1 })]);
    expect(records.some((record) => record.type === RECORD_MERGECELLS)).toBe(
      false,
    );
    // RECORD_NOTE ([MS-XLS] 0x001C) is writeSheetComments' own leading record -- absent entirely for a sheet with no commented cells.
    expect(records.some((record) => record.type === 0x001c)).toBe(false);
  });

  it("ends every worksheet substream with a real EOF record", () => {
    const records = recordsOf([cell(0, 0, { kind: "number", value: 1 })]);
    expect(records.at(-1)?.type).toBe(RECORD_EOF);
  });

  it("writes a Row record's own cells sorted by column regardless of the order they were given in", () => {
    const records = recordsOf([
      cell(0, 9, { kind: "number", value: 1 }),
      cell(0, 1, { kind: "number", value: 2 }),
      cell(0, 5, { kind: "number", value: 3 }),
    ]);
    const numberRecords = records.filter((record) => record.type === 0x0203); // RECORD_NUMBER
    const columns = numberRecords.map((record) => u16At(record.data, 2));
    expect(columns).toStrictEqual([1, 5, 9]);
  });

  it("writes Row records themselves sorted by row index regardless of the order rows were declared or populated in", () => {
    const records = recordsOf(
      [
        cell(9, 0, { kind: "number", value: 1 }),
        cell(1, 0, { kind: "number", value: 2 }),
      ],
      { rows: [{ index: 5, heightPt: 20 }] },
    );
    const rowIndices = records
      .filter((record) => record.type === RECORD_ROW)
      .map((record) => u16At(record.data, 0));
    expect(rowIndices).toStrictEqual([1, 5, 9]);
  });

  it("throws sheet-writer's own internal-error message when a cell reaches writeCellValueRecord disagreeing with written-cells.ts's own filter about its formatting", () => {
    // written-cells.ts's own writesCellRecord calls cellCarriesFormatting as a same-module, unmocked local binding -- vi.spyOn on the exported name never intercepts that internal call, only a cross-module import of it, which is exactly the call writeCellValueRecord makes. So the cell given here carries REAL formatting (a genuine background), satisfying writesCellRecord's own unmocked check honestly and letting the cell reach the cell table; only writeCellValueRecord's own cross-module call is mocked false, the disagreement this internal-error guard exists to catch -- proving the guard actually fires and says what it claims to, rather than being unreachable dead code.
    const spy = vi
      .spyOn(writtenCellsModule, "cellCarriesFormatting")
      .mockReturnValueOnce(false);
    try {
      expect(() =>
        buildWorksheetSubstream(
          sheet("S", [
            cell(
              0,
              0,
              { kind: "empty" },
              { background: { kind: "solid", color: { r: 1, g: 0, b: 0 } } },
            ),
          ]),
          NO_STYLE_CTX,
          NO_DRAWING,
        ),
      ).toThrow(/internal error/);
    } finally {
      spy.mockRestore();
    }
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

describe("builtinCode", () => {
  it("returns the real BUILTIN_NUMBER_FORMATS string for a genuine built-in id", () => {
    expect(builtinCode(0)).toBe("General");
  });

  it("throws for an id BUILTIN_NUMBER_FORMATS has no entry for", () => {
    expect(() => builtinCode(-1)).toThrow(
      "internal error: BUILTIN_NUMBER_FORMATS has no entry for id -1",
    );
  });
});

describe("buildFormatPlan", () => {
  function planFor(cells: readonly ContentSheetCell[]) {
    return buildFormatPlan([sheet("S", cells)]);
  }

  it("reuses one customFormats entry for two cells sharing an identical custom format code", () => {
    const plan = planFor([
      cell(0, 0, { kind: "number", value: 1 }, { numberFormatCode: "0.0000" }),
      cell(0, 1, { kind: "number", value: 2 }, { numberFormatCode: "0.0000" }),
    ]);
    expect(plan.customFormats).toHaveLength(1);
  });

  it("mints sequential custom format ids starting at FIRST_CUSTOM_FORMAT_ID (164)", () => {
    const plan = planFor([
      cell(
        0,
        0,
        { kind: "number", value: 1 },
        { numberFormatCode: "CUSTOM_A" },
      ),
      cell(
        0,
        1,
        { kind: "number", value: 2 },
        { numberFormatCode: "CUSTOM_B" },
      ),
    ]);
    expect(plan.customFormats.map((format) => format.id)).toStrictEqual([
      164, 165,
    ]);
  });

  it("throws once a workbook needs more than [MS-XLS] 2.4.126's own 164-382 custom-identifier range allows", () => {
    // 220 distinct custom codes: the range holds exactly 219 (164 through 382 inclusive), so the 220th distinct code is the one that overflows it.
    const cells = Array.from({ length: 220 }, (_, index) =>
      cell(
        0,
        index,
        { kind: "number", value: index },
        {
          numberFormatCode: `CUSTOM_${index}`,
        },
      ),
    );
    expect(() => planFor(cells)).toThrow(
      "workbook needs more than 219 distinct custom number formats, more than [MS-XLS] 2.4.126's own 164-382 custom-identifier range allows",
    );
  });

  it("accepts exactly 219 distinct custom codes, filling the 164-382 range without overflowing it", () => {
    const cells = Array.from({ length: 219 }, (_, index) =>
      cell(
        0,
        index,
        { kind: "number", value: index },
        {
          numberFormatCode: `CUSTOM_${index}`,
        },
      ),
    );
    const plan = planFor(cells);
    expect(plan.customFormats).toHaveLength(219);
    expect(plan.customFormats.at(-1)?.id).toBe(382);
  });

  it("never registers the number-format code of a cell writesCellRecord would drop, so an unused custom format is never minted for it", () => {
    // An empty, unformatted, formula-free cell writes no record at all (written-cells.ts's own writesCellRecord), so a numberFormatCode stated on it alone must never mint a customFormats entry no written cell record could ever reference.
    const droppedCell = cell(
      0,
      0,
      { kind: "empty" },
      { numberFormatCode: "NEVER_WRITTEN" },
    );
    expect(planFor([droppedCell]).customFormats).toStrictEqual([]);
  });

  it("refuses to look up a format code the workbook-wide scan never registered", () => {
    const plan = planFor([cell(0, 0, { kind: "number", value: 1 })]);
    expect(() => plan.formatIdOf("never scanned")).toThrow(
      'internal error: number-format code "never scanned" was not registered during the workbook-wide format scan',
    );
  });
});

describe("buildPalettePlan", () => {
  it("refuses to resolve any colour at all when the workbook's cells use none", () => {
    const plan = buildPalettePlan([
      sheet("S", [cell(0, 0, { kind: "number", value: 1 })]),
    ]);
    expect(() => plan.icvOf(rgbHexToColor("ff0000"))).toThrow(
      "internal error: colour ff0000 was not registered during the workbook-wide palette scan",
    );
  });

  it("needs no Palette record when every distinct colour already matches the fixed default table", () => {
    const black = rgbHexToColor("000000"); // DEFAULT_PALETTE_TABLE's own entry 0
    const plan = buildPalettePlan([
      sheet("S", [
        cell(
          0,
          0,
          { kind: "number", value: 1 },
          {
            background: { kind: "solid", color: black },
          },
        ),
      ]),
    ]);
    expect(plan.paletteColors).toBeUndefined();
    expect(() => plan.icvOf(black)).not.toThrow();
  });

  it("builds a real Palette record once at least one colour is not in the fixed default table, including every distinct colour the workbook uses, not just the non-default one", () => {
    const black = rgbHexToColor("000000"); // already in the default table
    const custom = rgbHexToColor("123456"); // not in the default table
    const plan = buildPalettePlan([
      sheet("S", [
        cell(
          0,
          0,
          { kind: "number", value: 1 },
          {
            background: { kind: "solid", color: black },
          },
        ),
        cell(
          0,
          1,
          { kind: "number", value: 2 },
          {
            background: { kind: "solid", color: custom },
          },
        ),
      ]),
    ]);
    expect(plan.paletteColors).toHaveLength(PALETTE_ENTRY_COUNT);
    expect(() => plan.icvOf(black)).not.toThrow();
    expect(() => plan.icvOf(custom)).not.toThrow();
  });

  it("refuses a workbook needing more distinct decoration colours than a Palette record can hold, naming the exact count and ceiling", () => {
    const cells = Array.from({ length: PALETTE_ENTRY_COUNT + 1 }, (_, index) =>
      cell(
        0,
        index,
        { kind: "number", value: index },
        {
          background: {
            kind: "solid",
            color: rgbHexToColor(index.toString(16).padStart(6, "0")),
          },
        },
      ),
    );
    expect(() => buildPalettePlan([sheet("S", cells)])).toThrow(
      `workbook needs ${PALETTE_ENTRY_COUNT + 1} distinct decoration colours, more than the ${PALETTE_ENTRY_COUNT} entries [MS-XLS] 2.4.188's own Palette record can hold`,
    );
  });
});

describe("buildFontPlan", () => {
  it("resolves a cell stating no font at all to font-table index 0, minting no second entry for it", () => {
    const plan = buildFontPlan(
      [sheet("S", [cell(0, 0, { kind: "number", value: 1 })])],
      buildPalettePlan([]),
    );
    expect(plan.fontEntries).toHaveLength(1);
    expect(
      plan.fontIndexForCell(cell(0, 0, { kind: "number", value: 1 })),
    ).toBe(0);
  });

  it("refuses to resolve a cell whose own font the workbook-wide font scan never saw", () => {
    const plan = buildFontPlan(
      [sheet("S", [cell(0, 0, { kind: "number", value: 1 })])],
      buildPalettePlan([]),
    );
    const neverScanned = cell(
      0,
      0,
      { kind: "number", value: 1 },
      {
        font: { bold: true },
      },
    );
    expect(() => plan.fontIndexForCell(neverScanned)).toThrow(
      /resolves to a font the workbook-wide font scan never saw/,
    );
  });

  it("mints two distinct font entries for fonts differing only in colour, not just name/size/weight/style", () => {
    const sheets = [
      sheet("S", [
        cell(
          0,
          0,
          { kind: "number", value: 1 },
          {
            font: { color: rgbHexToColor("ff0000") },
          },
        ),
        cell(
          0,
          1,
          { kind: "number", value: 2 },
          {
            font: { color: rgbHexToColor("0000ff") },
          },
        ),
      ]),
    ];
    const plan = buildFontPlan(sheets, buildPalettePlan(sheets));
    // Entry 0 is Normal; the two colours must each mint their own entry rather than collapsing onto one.
    expect(plan.fontEntries).toHaveLength(3);
  });
});

describe("buildCellXfPlan", () => {
  function planFor(cells: readonly ContentSheetCell[]) {
    const sheets = [sheet("S", cells)];
    const formatPlan = buildFormatPlan(sheets);
    const palettePlan = buildPalettePlan(sheets);
    const fontPlan = buildFontPlan(sheets, palettePlan);
    return buildCellXfPlan(sheets, formatPlan, palettePlan, fontPlan);
  }

  it("resolves a plain, undecorated cell to the implicit General cell XF, minting no entry for it", () => {
    const plan = planFor([cell(0, 0, { kind: "number", value: 1 })]);
    expect(plan.cellXfEntries).toStrictEqual([]);
    expect(plan.xfIndexForCell(cell(0, 0, { kind: "number", value: 1 }))).toBe(
      GENERAL_CELL_XF_INDEX,
    );
  });

  it("reuses one cell-XF entry for two cells sharing an identical format/font/alignment/decoration combination", () => {
    const decorated = (row: number) =>
      cell(
        row,
        0,
        { kind: "number", value: 1 },
        {
          alignment: "center",
          background: { kind: "solid", color: rgbHexToColor("ff0000") },
        },
      );
    const plan = planFor([decorated(0), decorated(1)]);
    expect(plan.cellXfEntries).toHaveLength(1);
  });

  it("gives two cells differing only in alignment two distinct cell-XF entries, not one shared entry", () => {
    const centered = cell(
      0,
      0,
      { kind: "number", value: 1 },
      {
        alignment: "center",
      },
    );
    const rightAligned = cell(
      0,
      1,
      { kind: "number", value: 1 },
      {
        alignment: "right",
      },
    );
    const plan = planFor([centered, rightAligned]);
    expect(plan.cellXfEntries).toHaveLength(2);
  });

  it("gives each of the four border sides its own distinct cell-XF entry, against an otherwise-identical undecorated baseline", () => {
    // Every cell here shares the identical background, so the only thing that could tell two of their cell-Xf signatures apart is which single border side (if any) each one states -- proving each side's own segment of the signature genuinely carries the side's identity, not just its style/colour.
    const backgroundOnly = {
      kind: "solid",
      color: rgbHexToColor("00ff00"),
    } as const;
    const borderEdge = { color: rgbHexToColor("ff0000"), widthPt: 0.75 };
    const withBorder = (
      column: number,
      side: "left" | "right" | "top" | "bottom",
    ) =>
      cell(
        0,
        column,
        { kind: "number", value: 1 },
        {
          background: backgroundOnly,
          borders: { [side]: borderEdge },
        },
      );
    const baseline = cell(
      0,
      0,
      { kind: "number", value: 1 },
      {
        background: backgroundOnly,
      },
    );
    const plan = planFor([
      baseline,
      withBorder(1, "left"),
      withBorder(2, "right"),
      withBorder(3, "top"),
      withBorder(4, "bottom"),
    ]);
    expect(plan.cellXfEntries).toHaveLength(5);
  });

  it("refuses a cell fill of a kind ContentCellFillSchema's own discriminated union does not define", () => {
    const bogusFill = {
      kind: "bogus",
    } as unknown as ContentSheetCell["background"];
    expect(() =>
      planFor([
        cell(0, 0, { kind: "number", value: 1 }, { background: bogusFill }),
      ]),
    ).toThrow(
      "xls-codec cannot write a cell fill with kind 'bogus': ContentCellFillSchema's discriminated union only defines 'solid' and 'pattern'",
    );
  });

  it("mints a real decoration for a cell that carries formatting, rather than treating every cell as undecorated", () => {
    const decorated = cell(
      0,
      0,
      { kind: "number", value: 1 },
      {
        background: { kind: "solid", color: rgbHexToColor("ff0000") },
      },
    );
    const plan = planFor([decorated]);
    expect(plan.cellXfEntries).toHaveLength(1);
    expect(plan.cellXfEntries[0]?.decoration).not.toBeUndefined();
  });

  it("refuses to resolve a cell whose own cell-Xf signature the workbook-wide scan never saw", () => {
    const plan = planFor([cell(0, 0, { kind: "number", value: 1 })]);
    const neverScanned = cell(
      0,
      0,
      { kind: "number", value: 1 },
      {
        alignment: "center",
      },
    );
    expect(() => plan.xfIndexForCell(neverScanned)).toThrow(
      /which the workbook-wide cell-format scan never saw/,
    );
  });
});

describe("buildSstPlan", () => {
  it("is empty for a workbook with no string-kind cells at all", () => {
    const plan = buildSstPlan([
      sheet("S", [cell(0, 0, { kind: "number", value: 1 })]),
    ]);
    expect(plan.strings).toStrictEqual([]);
    expect(plan.totalCount).toBe(0);
  });

  it("counts every string-kind cell towards totalCount, even repeats of the identical value that share one strings-table slot", () => {
    const plan = buildSstPlan([
      sheet("S", [
        cell(0, 0, { kind: "string", value: "Repeat" }),
        cell(0, 1, { kind: "string", value: "Repeat" }),
      ]),
    ]);
    expect(plan.strings).toStrictEqual(["Repeat"]);
    expect(plan.totalCount).toBe(2);
  });

  it("refuses to look up a string the workbook-wide shared-string scan never registered", () => {
    const plan = buildSstPlan([
      sheet("S", [cell(0, 0, { kind: "string", value: "Known" })]),
    ]);
    expect(() => plan.indexOf("Unknown")).toThrow(
      'internal error: string "Unknown" was not registered during the workbook-wide shared-string scan',
    );
  });
});

describe("buildWorkbookStream", () => {
  it("refuses a document with no sheets at all", () => {
    expect(() => buildWorkbookStream(document([]))).toThrow(
      "a .xls workbook must contain at least one sheet ([MS-XLS] 2.1.7.20.3's own BUNDLESHEET production requires 1*BoundSheet8), but the document being written has none",
    );
  });

  it("refuses a workbook whose own drawing plan produced fewer sheet-drawing entries than the document has sheets", () => {
    // buildDrawingWritePlan's own contract guarantees one sheetDrawings entry per sheet, so this can only be reached by a genuine disagreement between the two -- proven here by making the real function lie about it, rather than by a document this writer could ever produce on its own.
    const spy = vi
      .spyOn(drawingWriterModule, "buildDrawingWritePlan")
      .mockReturnValue({
        drawingGroupBytes: undefined,
        sheetDrawings: [],
        embeddingStreams: [],
      });
    try {
      expect(() =>
        buildWorkbookStream(
          document([sheet("S", [cell(0, 0, { kind: "number", value: 1 })])]),
        ),
      ).toThrow(
        "internal error: sheet 0 has no drawing plan entry -- buildDrawingWritePlan produced fewer entries than there are sheets",
      );
    } finally {
      spy.mockRestore();
    }
  });
});
