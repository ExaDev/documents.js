// The write suites split from write.test.ts by family (write-a), restating its imports verbatim.

import type {
  ContentCellValue,
  ContentSheet,
  ContentSheetCell,
  ContentSheetPrintSettings,
} from "document-schema.js";
import { PAGE_SIZE_A4, PAGE_SIZE_LETTER } from "document-schema.js";
import { readCompoundFile } from "archive-codec";
import { describe, expect, it } from "vitest";

import {
  RECORD_EXTERNSHEET,
  RECORD_LBL,
  RECORD_SETUP,
  RECORD_SUPBOOK,
} from "./biff/record-types";
import { readRecords } from "./biff/records";
import {} from "./biff/xf-colors";
import { BiffWriteError } from "./biff/write-errors";
import type { XlsContentDocument } from "./content";
import { assertNeverContentCellValueKind, readXlsContent } from "./content";
import {} from "./container";
import { writeXlsContent } from "./write";
import {} from "./workbook/conditional-format-write";

import { buildWorksheetSubstream } from "./workbook/sheet-writer";
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

  /** The same settings with no scalePercent and no repeatColumns — spelled as its own literal rather than derived by deletion, so an optional field a round trip wrongly re-added shows up as an extra key rather than as a matching undefined. */
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
    // The two are mutually exclusive in BIFF8 — WsBool's own fFitToPage decides which of Setup's fields is live — so a fit-to-page sheet states no scale at all, in either direction.
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
    // Nothing in ContentSheetPrintSettings can say "this sheet states nothing", so the writer emits the preset's own values rather than omitting the records — and the reader's own fallback then agrees with them.
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
    // Unlike xlsx's pageSetup element, [MS-XLS] 2.4.257's Setup record addresses paper only by code, so the dimensions genuinely cannot be written. iPaperSize 0 is that section's own "custom printer paper sizes", which is true; substituting Letter would not be. The size therefore does not survive the round trip — the reader falls back to its documented default — but the sheet, its cells, and every other print setting do.
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
    // Custom page sizes never round-trip their dimensions at all (the reader falls back to Letter regardless, per the test above), so the orientation flag this specific case writes is invisible to any round trip through readXlsContent — reading the raw Setup record's own grbit word is the only way to check it.
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
    // ContentSheetPrintSettings bounds neither from above, and Setup's own fields are 16-bit — so an unclamped value would wrap and state a different intent confidently. [MS-XLS] 2.4.257 caps iFitWidth/iFitHeight at 32767; iScale has only its field's own width.
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
    // printRange/repeatRows/repeatColumns are bounded from above by neither ContentSheetPrintRange/ContentSheetRepeatRange nor writeArea3d's own 16-bit field — an unclamped end row of 70000 would wrap to 4464, a plausible-looking coordinate that silently states a smaller range than asked for.
    //
    // repeatRows/repeatColumns both start past 0: a band clamped to first 0/last MAX_*_INDEX on the axis it already fully spans by construction would ALSO fully span the perpendicular one, making it shape-ambiguous with "the whole sheet" (see print-names.ts's own classification note) and reading back as neither band — an existing, documented tradeoff of the shape-based discriminant, not something this clamp introduces or is responsible for working around.
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
    // The SupBook and ExternSheet a defined name's own 3D reference resolves through exist only to serve one — a print name or a document-level name alike — so a workbook needing none stays as minimal as it was before either was written.
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
