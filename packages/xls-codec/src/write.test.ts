import type {
  ContentCellValue,
  ContentSheet,
  ContentSheetCell,
  ContentSheetPrintSettings,
} from "document-schema.js";
import { PAGE_SIZE_LETTER, rgbHexToColor } from "document-schema.js";
import { isCompoundFile } from "archive-codec";
import { describe, expect, it } from "vitest";

import {} from "./biff/record-types";
import {} from "./biff/records";
import { PALETTE_ENTRY_COUNT } from "./biff/xf-colors";
import { BiffWriteError } from "./biff/write-errors";
import type { XlsContentDocument } from "./content";
import { assertNeverContentCellValueKind, readXlsContent } from "./content";
import { isXlsFile } from "./container";
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
    // The same "General" stamping content.test.ts already pins for a real .xls's plain cells — XF 15's own ifmt (0) resolves through the built-in table.
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
    // No numberFormatCode was given and this writer's own default currency format carries no [$XXX-nnn] marker, so no ISO code is recovered either — an honest round trip of what was actually written, not an invented one.
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
          // A display symbol is not an ISO-code shape and cannot go inside the bracket, so the cell falls back to the plain currency format — the kind preserved, the code honestly lost.
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
    // Coral: genuinely absent from the fixed default table, so a workbook using it can only be written by minting a real Palette record. Checked against xf-colors.ts's own DEFAULT_PALETTE_TABLE rather than assumed — teal (008080), the obvious candidate, is in fact one of that table's own entries, so a test built on it would have exercised the no-Palette fast path while claiming the opposite.
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
      // Each cell's own decoration-signature string must name which side it is, not just the style/colour that side shares with every other cell here — otherwise two of these would collide onto the same interned XF and each other's cell would read back with the wrong side bordered.
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
      // red (255,0,0) is icv 10 in the fixed default table — resolvable with no Palette record present, and readXlsContent must still recover it correctly through that fallback.
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

    /** `count` cells whose only content is a distinct background colour each — the shape the palette budget has to count exactly, since every one is written (as a Blank record) while carrying no value. */
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
      // The cell has no value at all, so its background and borders live entirely in the XF a Blank record points at. Writing nothing for it — which is right for an undecorated empty cell — would discard them outright.
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
      // A Blank record's ixfe indexes the same cell-XF table every value record's does, so the interning pass has to treat both kinds of cell alike — a regression would show as the wrong decoration on one of the two.
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
      // Own-property check, not just a value check: a horizontal-only cell must leave the verticalAlignment KEY absent, not merely undefined when read through optional chaining — a bug materialising the key with an explicit undefined value would pass a plain .toBeUndefined() assertion just as easily as a genuinely absent key would.
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
      // Own-property check, not just a value check: a vertical-only cell must leave the alignment KEY absent, not merely undefined when read through optional chaining — see the mirrored check in the horizontal-alignment test above for why a plain .toBeUndefined() would not catch this.
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
  });
});
