import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { ContentDocumentSchema, PAGE_SIZE_A4 } from "document-schema.js";
import type { Package } from "../../model/package";
import { parsePackage } from "../../package-io/read";
import { attr, childrenWithTag, rootElement } from "../util";
import { buildXlsxPackageFromContent } from "./build";
import { columnWidthCharsToPt } from "./units";
import { POINTS_PER_INCH } from "../shared/units";
import { readXlsxContent, resolveSheetEntries } from "./content";
const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

// toBeCloseTo's precision argument used throughout this file's point-conversion assertions: 5 decimal digits is tight enough to catch a wrong formula or unit while tolerating the ordinary floating-point rounding pixel/EMU/twip conversions produce.
const CLOSE_TO_PRECISION = 5;

// This fixture family's own repeated drawing-anchor geometry, reused verbatim across several of the chart/image describe blocks below: a two-cell-anchored drawing whose <xdr:from> col/colOff names 19050 EMU into column 0, and whose columns are 10 and 20 characters wide.
function loadFixture(name: string): Package {
  const bytes = new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
  return parsePackage(bytes);
}

describe("readXlsxContent: kitchen-sink.xlsx (real LibreOffice output)", () => {
  const document = readXlsxContent(loadFixture("kitchen-sink.xlsx"));
  if (document.kind !== "spreadsheet") {
    throw new Error("expected a spreadsheet ContentDocument");
  }
  const { sheets } = document;
  const data = sheets.find((sheet) => sheet.name === "Data");
  const summary = sheets.find((sheet) => sheet.name === "Summary");
  if (data === undefined || summary === undefined) {
    throw new Error("expected both a Data and a Summary sheet");
  }

  it("reads both sheets in real workbook.xml <sheets> order, not filename order", () => {
    expect(sheets.map((sheet) => sheet.name)).toEqual(["Data", "Summary"]);
  });

  it("produces a ContentDocument envelope directly (kind, metadata, sheets) matching the live ContentDocumentSchema", () => {
    expect(document.kind).toBe("spreadsheet");
    expect(ContentDocumentSchema.safeParse(document).success).toBe(true);
    expect("formatVersion" in document).toBe(false); // retired in document-schema.js 4.0.0 — versioning now lives only at the serialised-artefact boundary ($schema URI), never on the in-process codec-exchange envelope
  });

  it("reads document metadata via docProps/core.xml — this fixture never had a title set", () => {
    expect(document.metadata.title).toBeUndefined();
  });

  describe("column widths (real <col width> character units) and hidden columns", () => {
    it("converts the stored character-unit width to points via the documented MDW=7 pixel formula", () => {
      const widths = data.columns.map((column) => column.widthPt);
      // This fixture's own real, LibreOffice-authored stored character-unit widths for the first three columns.
      const FIRST_COLUMN_WIDTH_CHARS = 15.32;
      const SECOND_COLUMN_WIDTH_CHARS = 12.76;
      const THIRD_COLUMN_WIDTH_CHARS = 10.21;
      expect(widths[0]).toBeCloseTo(
        columnWidthCharsToPt(FIRST_COLUMN_WIDTH_CHARS),
        CLOSE_TO_PRECISION,
      );
      expect(widths[1]).toBeCloseTo(
        columnWidthCharsToPt(SECOND_COLUMN_WIDTH_CHARS),
        CLOSE_TO_PRECISION,
      );
      expect(widths[2]).toBeCloseTo(
        columnWidthCharsToPt(THIRD_COLUMN_WIDTH_CHARS),
        CLOSE_TO_PRECISION,
      );
    });

    it('marks column G (index 6, the Fee column) hidden via <col hidden="true">', () => {
      // Column G, the Fee column.
      const HIDDEN_COLUMN_INDEX = 6;
      const hiddenColumn = data.columns.find(
        (column) => column.index === HIDDEN_COLUMN_INDEX,
      );
      expect(hiddenColumn?.hidden).toBe(true);
      expect(
        data.columns.filter((column) => column.hidden === true),
      ).toHaveLength(1);
    });

    it("does not mark visible columns hidden at all (omitted, not false)", () => {
      const visibleColumn = data.columns.find((column) => column.index === 0);
      expect(visibleColumn?.hidden).toBeUndefined();
    });

    it("reads one ContentSheetColumn per real <col> element (each min=max in this fixture)", () => {
      const COLUMN_COUNT = 9;
      expect(data.columns).toHaveLength(COLUMN_COUNT);
      expect(data.columns.map((column) => column.index)).toEqual(
        Array.from({ length: COLUMN_COUNT }, (_, index) => index),
      );
    });

    // Regression coverage for ExaDev/documents.js#953: this fixture's own real, LibreOffice-authored stored widths (15.32, 12.76, 10.21, ...) are exactly the kind of value that used to keep re-approximating narrower on every further write — see units.test.ts's own convergence suite for the underlying arithmetic proof and units.ts's ptToColumnWidthChars for why rounding up (never to nearest) fixes it.
    function dataSheetColWidthAttrs(pkg: Package): (string | undefined)[] {
      const entry = resolveSheetEntries(pkg).find(
        (sheet) => sheet.name === "Data",
      );
      if (entry === undefined) {
        throw new Error("expected a Data sheet entry");
      }
      const worksheet = rootElement(pkg.parts[entry.path]);
      if (worksheet === undefined) {
        throw new Error(`expected ${entry.path} to have a root element`);
      }
      const colsEl = childrenWithTag(worksheet, "cols")[0];
      if (colsEl === undefined) {
        return [];
      }
      return childrenWithTag(colsEl, "col").map((col) => attr(col, "width"));
    }

    it("read -> write -> read -> write produces byte-identical stored <col width> attributes for the second read/write pair as for the first, rather than a further-narrowed value (ExaDev/documents.js#953)", () => {
      const firstWritePkg = buildXlsxPackageFromContent(document); // write 1, from the ORIGINAL fixture's own stored widths
      const firstWriteRead = readXlsxContent(firstWritePkg); // read 2
      if (firstWriteRead.kind !== "spreadsheet") {
        throw new Error("expected a spreadsheet ContentDocument");
      }
      const secondWritePkg = buildXlsxPackageFromContent(firstWriteRead); // write 2
      const secondWriteRead = readXlsxContent(secondWritePkg); // read 3, only to compare the resolved columns too
      if (secondWriteRead.kind !== "spreadsheet") {
        throw new Error("expected a spreadsheet ContentDocument");
      }

      expect(dataSheetColWidthAttrs(secondWritePkg)).toEqual(
        dataSheetColWidthAttrs(firstWritePkg),
      );

      const firstData = firstWriteRead.sheets.find(
        (sheet) => sheet.name === "Data",
      );
      const secondData = secondWriteRead.sheets.find(
        (sheet) => sheet.name === "Data",
      );
      if (firstData === undefined || secondData === undefined) {
        throw new Error("expected the Data sheet to survive both write cycles");
      }
      expect(secondData.columns).toEqual(firstData.columns);
    });
  });

  describe("row heights (ht is already in points, no conversion) and hidden rows", () => {
    it("reads the header row and first data row's own explicit heights verbatim", () => {
      const headerRow = data.rows.find((row) => row.index === 0);
      const firstDataRow = data.rows.find((row) => row.index === 1);
      // This fixture's own real, LibreOffice-authored stored <row ht="..."> values.
      const HEADER_ROW_HEIGHT_PT = 25.5;
      const FIRST_DATA_ROW_HEIGHT_PT = 17;
      expect(headerRow?.heightPt).toBe(HEADER_ROW_HEIGHT_PT);
      expect(firstDataRow?.heightPt).toBe(FIRST_DATA_ROW_HEIGHT_PT);
    });

    it('marks row 10 (index 9, "Hidden Row Content") hidden via <row hidden="true">, while its own real content still reads', () => {
      const HIDDEN_ROW_INDEX = 9;
      const hiddenRow = data.rows.find((row) => row.index === HIDDEN_ROW_INDEX);
      expect(hiddenRow?.hidden).toBe(true);
      const hiddenCell = data.cells.find(
        (cell) => cell.row === HIDDEN_ROW_INDEX && cell.column === 0,
      );
      expect(hiddenCell?.displayText).toBe("Hidden Row Content");
    });

    it("reads one ContentSheetRow per real <row> element — no repeat-compression mechanism to guard against, unlike ODF", () => {
      // Rows 3, 4, 7, and 8 carry no explicit <row> element in the fixture (no height/hidden override, no cell content of their own), so no ContentSheetRow is produced for them. Row 5 is the A6:B7 merge anchor and row 6 its continuation (see the "merged range" describe block below); row 9 is the hidden row.
      const MERGED_RANGE_ANCHOR_ROW_INDEX = 5;
      const MERGED_RANGE_CONTINUATION_ROW_INDEX = 6;
      const HIDDEN_ROW_INDEX = 9;
      expect(data.rows.map((row) => row.index)).toEqual([
        0,
        1,
        2,
        MERGED_RANGE_ANCHOR_ROW_INDEX,
        MERGED_RANGE_CONTINUATION_ROW_INDEX,
        HIDDEN_ROW_INDEX,
      ]);
    });
  });

  describe("every cell-type xlsx itself distinguishes, on row 2 (index 1)", () => {
    const cellAt = (column: number) => {
      const cell = data.cells.find(
        (candidate) => candidate.row === 1 && candidate.column === column,
      );
      if (cell === undefined) {
        throw new Error(`expected a cell at row 1, column ${column}`);
      }
      return cell;
    };

    // This fixture's own column layout, by role (columns 0/1/2 are exempt from naming: string, number, boolean).
    const DUE_DATE_COLUMN = 3;
    const DUE_TIME_COLUMN = 4;
    const RATE_COLUMN = 5;
    const FEE_COLUMN = 6;
    const FORMULA_COLUMN = 7;
    const ERROR_COLUMN = 8;

    it('reads a shared-string cell (t="s")', () => {
      expect(cellAt(0).value).toEqual({ kind: "string", value: "Acme Corp" });
      expect(cellAt(0).displayText).toBe("Acme Corp");
    });

    it('reads a plain numeric cell (t="n") whose format is General as kind "number"', () => {
      expect(cellAt(1).value).toEqual({ kind: "number", value: 1234.56 }); // Amount, formatted through this fixture's own redefined numFmtId 164 ("General")
      expect(cellAt(1).displayText).toBe("1234.56");
    });

    // Cross-checked against an INDEPENDENT oracle, not just against this reader's own view of the format codes: the source these fixtures were exported from, odf.js's own src/typed/ods/fixtures/kitchen-sink.ods, declares these same four cells explicitly typed — office:value-type="date" office:date-value="2026-07-31", office:value-type="time" office:time-value="PT14H30M00S", office:value-type="percentage" office:value="0.4256", and office:value-type="currency" office:currency="GBP" office:value="99.99". Every kind, value, and the ISO 4217 code recovered below matches what the author originally entered, recovered from nothing but a style index and a numFmt string.
    it("recovers the date/time/percentage/currency kinds xlsx itself has no cell type for, from the numFmt code each cell's own style points at", () => {
      // Due Date: numFmtId 166, "[$-809]yyyy\\-mm\\-dd" — a locale-only bracket (NOT currency) plus real y/m/d codes; serial 46234 in this workbook's 1900 date system (workbookPr@date1904="false").
      expect(cellAt(DUE_DATE_COLUMN).value).toEqual({
        kind: "date",
        value: "2026-07-31",
      });
      // Due Time: numFmtId 167, "[$-809]hh:mm:ss" — the 'mm' resolves to MINUTES here (nearest preceding code is 'hh'), unlike the identical 'mm' in the date format above, where it resolves to a month.
      expect(cellAt(DUE_TIME_COLUMN).value).toEqual({
        kind: "time",
        value: "14:30:00",
      });
      // Rate: numFmtId 168, "[$-809]0.00%" — the value stays the raw stored fraction, not the 42.56 Excel displays.
      expect(cellAt(RATE_COLUMN).value).toEqual({
        kind: "percentage",
        value: 0.4256,
      });
      // Fee: numFmtId 169, "[$GBP-809]#,##0.00" — an ISO 4217 code between the '$' and the '-', so `currency` is populated rather than left honestly absent.
      expect(cellAt(FEE_COLUMN).value).toEqual({
        kind: "currency",
        value: 99.99,
        currency: "GBP",
      });
    });

    it("carries each cell's own raw numFmt code verbatim alongside its classified kind", () => {
      expect(cellAt(DUE_DATE_COLUMN).numberFormatCode).toBe(
        "[$-809]yyyy\\-mm\\-dd",
      );
      expect(cellAt(DUE_TIME_COLUMN).numberFormatCode).toBe("[$-809]hh:mm:ss");
      expect(cellAt(RATE_COLUMN).numberFormatCode).toBe("[$-809]0.00%");
      expect(cellAt(FEE_COLUMN).numberFormatCode).toBe("[$GBP-809]#,##0.00");
      // This fixture's own Amount cell resolves through a redefined numFmtId 164 whose own code IS the literal string "General" (some producers write it out explicitly rather than relying on the built-in default) — carried verbatim like any other resolved code, not specially suppressed.
      expect(cellAt(1).numberFormatCode).toBe("General");
    });

    it("leaves displayText as the plain typed-value spelling — this reader classifies a number format, it does not render through one", () => {
      expect(cellAt(DUE_DATE_COLUMN).displayText).toBe("2026-07-31");
      expect(cellAt(DUE_TIME_COLUMN).displayText).toBe("14:30:00");
      expect(cellAt(RATE_COLUMN).displayText).toBe("0.4256"); // not "42.56%"
      expect(cellAt(FEE_COLUMN).displayText).toBe("99.99"); // not "£99.99"
    });

    it('reads a boolean cell (t="b") and derives an Excel-style TRUE/FALSE displayText — its own numFmtId 165 ("TRUE";"TRUE";"FALSE") style never gets a say, since only numeric cells are classified', () => {
      expect(cellAt(2).value).toEqual({ kind: "boolean", value: true });
      expect(cellAt(2).displayText).toBe("TRUE");
    });

    it("carries a real formula string verbatim, alongside its own cached numeric result", () => {
      const formulaCell = cellAt(FORMULA_COLUMN);
      expect(formulaCell.formula).toBe("SUM(B2:B3)");
      expect(formulaCell.value).toEqual({ kind: "number", value: 1276.56 });
    });

    it('reads a genuine formula-error cell (=1/0) as kind "error", carrying the real #DIV/0! text as both value and displayText', () => {
      const errorCell = cellAt(ERROR_COLUMN);
      expect(errorCell.formula).toBe("1/0");
      expect(errorCell.value).toEqual({ kind: "error", value: "#DIV/0!" });
      expect(errorCell.displayText).toBe("#DIV/0!");
    });
  });

  describe('merged range (<mergeCells><mergeCell ref="A6:B7"/></mergeCells>)', () => {
    // A6:B7, 0-based: row 5 (the anchor, A6) through row 6 (the continuation, row 7).
    const MERGED_RANGE_ANCHOR_ROW = 5;
    const MERGED_RANGE_CONTINUATION_ROW = 6;

    it("reads the anchor cell with its own colSpan/rowSpan and text", () => {
      const anchor = data.cells.find(
        (cell) => cell.row === MERGED_RANGE_ANCHOR_ROW && cell.column === 0,
      );
      expect(anchor).toMatchObject({
        colSpan: 2,
        rowSpan: 2,
        displayText: "Merged Cell",
      });
    });

    it('emits nothing at all for the covered positions (B6, A7, B7) — xlsx writes a bare, valueless <c> for each, and readCell\'s own "no v/is/f -> skip" rule already drops them', () => {
      expect(
        data.cells.find(
          (cell) => cell.row === MERGED_RANGE_ANCHOR_ROW && cell.column === 1,
        ),
      ).toBeUndefined();
      expect(
        data.cells.find(
          (cell) =>
            cell.row === MERGED_RANGE_CONTINUATION_ROW && cell.column === 0,
        ),
      ).toBeUndefined();
      expect(
        data.cells.find(
          (cell) =>
            cell.row === MERGED_RANGE_CONTINUATION_ROW && cell.column === 1,
        ),
      ).toBeUndefined();
    });
  });

  describe("cross-sheet formula", () => {
    it("carries a real cross-sheet formula reference verbatim and its own cached result", () => {
      const totalCell = summary.cells.find(
        (cell) => cell.row === 1 && cell.column === 1,
      );
      expect(totalCell?.formula).toBe("SUM(Data!B2:B3)");
      expect(totalCell?.value).toEqual({ kind: "number", value: 1276.56 });
    });
  });

  describe("print settings (real <pageSetup>/<printOptions>/<pageMargins>, and sheet-scoped _xlnm.Print_Area/_xlnm.Print_Titles)", () => {
    it('resolves the Data sheet\'s own A4 page size (paperSize="9") and inch-based margins converted to points', () => {
      expect(data.printSettings.pageSize).toEqual(PAGE_SIZE_A4);
      // This fixture's own stored <pageMargins left="..."/top="..."> values, in inches.
      const LEFT_MARGIN_INCHES = 0.590277777777778;
      const TOP_MARGIN_INCHES = 0.570833333333333;
      const MARGIN_CLOSE_TO_PRECISION = 6;
      expect(data.printSettings.margins.leftPt).toBeCloseTo(
        LEFT_MARGIN_INCHES * POINTS_PER_INCH,
        MARGIN_CLOSE_TO_PRECISION,
      );
      expect(data.printSettings.margins.topPt).toBeCloseTo(
        TOP_MARGIN_INCHES * POINTS_PER_INCH,
        MARGIN_CLOSE_TO_PRECISION,
      );
    });

    it('parses _xlnm.Print_Area ("Data!$A$1:$I$20") into 0-based row/column bounds', () => {
      expect(data.printSettings.printRange).toEqual({
        startRow: 0,
        startColumn: 0,
        endRow: 19,
        endColumn: 8,
      });
    });

    it('reads a percentage scale from pageSetup@scale="150" when sheetPr/pageSetUpPr@fitToPage is "false"', () => {
      // This fixture's own stored pageSetup@scale.
      const DATA_SHEET_SCALE_PERCENT = 150;
      expect(data.printSettings.scalePercent).toBe(DATA_SHEET_SCALE_PERCENT);
      expect(data.printSettings.fitToPages).toBeUndefined();
    });

    it('reads a fit-to-N-pages scale from pageSetup@fitToWidth/@fitToHeight on the Summary sheet, whose sheetPr/pageSetUpPr@fitToPage is "true"', () => {
      expect(summary.printSettings.fitToPages).toEqual({ width: 1, height: 2 });
      expect(summary.printSettings.scalePercent).toBeUndefined();
    });

    it('parses _xlnm.Print_Titles ("Data!$A:$A,Data!$1:$1") into repeatColumns/repeatRows', () => {
      expect(data.printSettings.repeatRows).toEqual({ start: 0, end: 0 });
      expect(data.printSettings.repeatColumns).toEqual({ start: 0, end: 0 });
    });

    it("reads gridlines/headers from printOptions@gridLines/@headings", () => {
      expect(data.printSettings.gridlines).toBe(true);
      expect(data.printSettings.headers).toBe(true);
      expect(summary.printSettings.gridlines).toBe(false);
      expect(summary.printSettings.headers).toBe(false);
    });

    it("reads page order from pageSetup@pageOrder", () => {
      expect(data.printSettings.pageOrder).toBe("overThenDown");
      expect(summary.printSettings.pageOrder).toBe("downThenOver");
    });

    it('reads manual page breaks from rowBreaks/colBreaks <brk id="..."> at the break\'s own real 0-based index', () => {
      // This fixture's own stored <rowBreaks>/<colBreaks> brk id values, 0-based.
      const ROW_BREAK_INDEX = 15;
      const COLUMN_BREAK_INDEX = 3;
      expect(data.printSettings.manualBreaks).toEqual({
        rows: [ROW_BREAK_INDEX],
        columns: [COLUMN_BREAK_INDEX],
      });
      expect(summary.printSettings.manualBreaks).toBeUndefined();
    });

    it("the Summary sheet has no _xlnm.Print_Area/_xlnm.Print_Titles of its own", () => {
      expect(summary.printSettings.printRange).toBeUndefined();
      expect(summary.printSettings.repeatRows).toBeUndefined();
      expect(summary.printSettings.repeatColumns).toBeUndefined();
    });
  });

  describe("the workbook's own defined names (names, refersTo verbatim)", () => {
    it("carries every definedName the fixture declares, the two _xlnm print built-ins included, refersTo verbatim", () => {
      expect(document.names).toEqual([
        {
          name: "_xlnm.Print_Area",
          refersTo: "Data!$A$1:$I$20",
          scopeSheetIndex: 0,
        },
        {
          name: "_xlnm.Print_Titles",
          refersTo: "Data!$A:$A,Data!$1:$1",
          scopeSheetIndex: 0,
        },
      ]);
    });
  });
});

describe("readXlsxContent: minimal.xlsx (real LibreOffice output, default/unmodified sheet)", () => {
  const document = readXlsxContent(loadFixture("minimal.xlsx"));
  if (document.kind !== "spreadsheet") {
    throw new Error("expected a spreadsheet ContentDocument");
  }
  const sheet = document.sheets[0];
  if (sheet === undefined) {
    throw new Error("expected at least one sheet");
  }

  it("reads the single default sheet", () => {
    expect(document.sheets).toHaveLength(1);
    expect(sheet.name).toBe("Sheet1");
  });

  it("emits nothing for the sheet's own single, genuinely empty cell — and no <cols>/<row> elements at all", () => {
    expect(sheet.cells).toEqual([]);
    expect(sheet.columns).toEqual([]);
    expect(sheet.rows).toEqual([]);
  });

  it("reads real default print settings: A4, default margins, gridlines/headers off, down-then-over page order, an explicit (default-valued) scale", () => {
    expect(sheet.printSettings.pageSize).toEqual(PAGE_SIZE_A4);
    expect(sheet.printSettings.gridlines).toBe(false);
    expect(sheet.printSettings.headers).toBe(false);
    expect(sheet.printSettings.pageOrder).toBe("downThenOver");
    // Excel's own default explicit scale for an unmodified worksheet.
    const DEFAULT_SCALE_PERCENT = 100;
    expect(sheet.printSettings.scalePercent).toBe(DEFAULT_SCALE_PERCENT);
    expect(sheet.printSettings.fitToPages).toBeUndefined();
    expect(sheet.printSettings.printRange).toBeUndefined();
    expect(sheet.printSettings.repeatRows).toBeUndefined();
    expect(sheet.printSettings.repeatColumns).toBeUndefined();
    expect(sheet.printSettings.manualBreaks).toBeUndefined();
  });

  it("has no xl/sharedStrings.xml part at all (no string cells) — readXlsxContent tolerates its absence", () => {
    const pkg = loadFixture("minimal.xlsx");
    expect(pkg.parts["xl/sharedStrings.xml"]).toBeUndefined();
  });
});

// A minimal single-sheet package wrapping a hand-built <worksheet> element — shared by every synthetic test below, since each one only cares about a single cell's own markup.
