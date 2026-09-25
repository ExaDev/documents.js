// The write suites split from write.test.ts by family (write-a), restating its imports verbatim.

import type {
  ContentCellValue,
  ContentSheet,
  ContentSheetCell,
  ContentSheetDataValidation,
  ContentSheetPrintSettings,
} from "document-schema.js";
import {
  assembleTree,
  DocumentTreeSchema,
  PAGE_SIZE_A4,
  PAGE_SIZE_LETTER,
} from "document-schema.js";
import { readCompoundFile } from "archive-codec";
import { describe, expect, it } from "vitest";

import {
  RECORD_CONTINUE,
  RECORD_EXTERNSHEET,
  RECORD_LBL,
  RECORD_MSODRAWING,
  RECORD_MSODRAWINGGROUP,
  RECORD_SETUP,
  RECORD_SUPBOOK,
} from "./biff/record-types";
import { readRecords } from "./biff/records";
import {} from "./biff/xf-colors";
import { BiffWriteError } from "./biff/write-errors";
import type { XlsContentDocument } from "./content";
import {
  assertNeverContentCellValueKind,
  readXls,
  readXlsContent,
} from "./content";
import {} from "./container";
import { writeXls, writeXlsContent } from "./write";
import {} from "./workbook/conditional-format-write";
import { writeSheetDataValidations } from "./workbook/data-validation-write";
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
  // A minimal but genuinely valid 1x1 PNG (a real signature, IHDR, IDAT, IEND chain) — the identical fixture drawing/blips.test.ts uses, since resolveBlip only checks image.format, never the bytes' own structure.
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

  /** Bytes large enough on their own to push a single BSE entry (or a single sheet's own shape tree, repeated many times over) past the 8224-byte single-record ceiling, forcing writeRecordChain to split its record onto a Continue chain — a non-repeating pattern so a byte-exact round trip can't pass by coincidence (e.g. every byte happening to be zero). */
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
    // 'between' alone does not prove the writer's own isTwoOperand check actually names BOTH two-operand operators rather than just the one the sibling test above already exercises — a rule refused for missing its second formula only when it should be, or accepted with one only for the operator that never needed it, would pass that test regardless.
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
      // endRow deliberately stays in-grid (0), unlike the other three edges below sharing one deviant field with its own pair: an overRow fixture whose own endRow ALSO exceeds 0xffff would still throw with the startRow check dropped entirely, since the endRow check alone already catches it — only isolating startRow as the sole out-of-range field actually exercises that check on its own.
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
    // 0xffff and 0xff are the largest row/column index BIFF8's own u16/u8 fields can carry — a range naming exactly these values is still addressable, unlike the one-past-the-edge values the previous test throws on, so the boundary check must be a strict `>`, not `>=`.
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
