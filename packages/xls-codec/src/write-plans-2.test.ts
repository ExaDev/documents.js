// The builtin-code and plan-builder suites, split from write-plans.test.ts, restating its harness verbatim.

// The write suites split from write.test.ts by family (write-c), restating its imports verbatim.

import type {
  ContentCellValue,
  ContentSheet,
  ContentSheetCell,
  ContentSheetPrintSettings,
} from "document-schema.js";
import { PAGE_SIZE_LETTER, rgbHexToColor } from "document-schema.js";
import {} from "archive-codec";
import { describe, expect, it, vi } from "vitest";

import {} from "./biff/record-types";
import {} from "./biff/records";

import { PALETTE_ENTRY_COUNT } from "./biff/xf-colors";
import {} from "./biff/write-errors";
import type { XlsContentDocument } from "./content";
import { assertNeverContentCellValueKind } from "./content";
import {} from "./container";
import {
  buildCellXfPlan,
  buildFontPlan,
  buildFormatPlan,
  buildPalettePlan,
  buildSstPlan,
  buildWorkbookStream,
  builtinCode,
} from "./write";
import {} from "./workbook/conditional-format-write";
import {} from "./workbook/data-validation-write";
import {} from "./workbook/sheet-writer";
import * as drawingWriterModule from "./workbook/drawing-writer";
import { GENERAL_CELL_XF_INDEX } from "./workbook/globals-writer";

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
    // Every cell here shares the identical background, so the only thing that could tell two of their cell-Xf signatures apart is which single border side (if any) each one states — proving each side's own segment of the signature genuinely carries the side's identity, not just its style/colour.
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
    // buildDrawingWritePlan's own contract guarantees one sheetDrawings entry per sheet, so this can only be reached by a genuine disagreement between the two — proven here by making the real function lie about it, rather than by a document this writer could ever produce on its own.
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
        "internal error: sheet 0 has no drawing plan entry — buildDrawingWritePlan produced fewer entries than there are sheets",
      );
    } finally {
      spy.mockRestore();
    }
  });
});
