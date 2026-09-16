import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ContentDocumentSchema,
  PAGE_SIZE_A4,
  PAGE_SIZE_LETTER,
} from "document-schema.js";
import type {
  ContentDocument,
  ContentSheet,
  ContentSheetConditionalFormat,
  ContentSheetDataValidation,
} from "document-schema.js";
import type { Package } from "../../model/package";
import type { XmlElement, XmlNode } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import { decodePackage, encodePackage } from "../../codec";
import { parsePackage } from "../../package-io/read";
import { attr, childrenWithTag, rootElement } from "../util";
import { buildXlsxPackageFromContent } from "./build";
import {
  columnWidthCharsToPt,
  DEFAULT_COLUMN_WIDTH_CHARS,
  DEFAULT_ROW_HEIGHT_PT,
} from "./units";
import { readXlsxContent, resolveSheetEntries } from "./content";

// True precisely when `key` is an own property of `obj`, regardless of whether its value is `undefined` -- unlike `toBeUndefined()`, which is satisfied identically by a key holding `undefined` and by the key's own absence, and so cannot distinguish "never assigned" from "assigned undefined". Several of readCell's own optional-field copies (font/background/borders/alignment/verticalAlignment/numberFormatCode) are guarded by a presence check specifically to avoid ever assigning the key at all when the source has nothing to offer, and only a key-existence assertion can prove that guard is doing real work rather than being a no-op the object shape would be identical without.
function hasOwn(obj: object, key: string): boolean {
  return Object.hasOwn(obj, key);
}

// This suite reads real, unmodified LibreOffice-generated .xlsx fixtures (src/typed/xlsx/fixtures/*.xlsx). Both fixtures are genuine LibreOffice xlsx-exports (`soffice --headless --convert-to xlsx`) of odf.js's own src/typed/ods/fixtures/{kitchen-sink,minimal}.ods -- the same feature set that package's own readOds test suite already validates against ODF's equivalent mechanisms, run back through LibreOffice's real SpreadsheetML export filter so this suite exercises genuine, LibreOffice-authored xlsx markup (column-width character units, row heights, hidden rows/columns, every value-type LibreOffice's own xlsx exporter distinguishes, a real merged range, a real cross-sheet formula, and real print settings including Print_Area/Print_Titles defined names) rather than a hand-built approximation of what that markup might look like. A handful of narrow scope-boundary/error-path tests at the end use small, synthetic, hand-built packages instead (via el/txt), mirroring readOds's own established convention for the identical reason.

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

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
    expect("formatVersion" in document).toBe(false); // retired in document-schema.js 4.0.0 -- versioning now lives only at the serialised-artefact boundary ($schema URI), never on the in-process codec-exchange envelope
  });

  it("reads document metadata via docProps/core.xml -- this fixture never had a title set", () => {
    expect(document.metadata.title).toBeUndefined();
  });

  describe("column widths (real <col width> character units) and hidden columns", () => {
    it("converts the stored character-unit width to points via the documented MDW=7 pixel formula", () => {
      const widths = data.columns.map((column) => column.widthPt);
      expect(widths[0]).toBeCloseTo(columnWidthCharsToPt(15.32), 5);
      expect(widths[1]).toBeCloseTo(columnWidthCharsToPt(12.76), 5);
      expect(widths[2]).toBeCloseTo(columnWidthCharsToPt(10.21), 5);
    });

    it('marks column G (index 6, the Fee column) hidden via <col hidden="true">', () => {
      const hiddenColumn = data.columns.find((column) => column.index === 6);
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
      expect(data.columns).toHaveLength(9);
      expect(data.columns.map((column) => column.index)).toEqual([
        0, 1, 2, 3, 4, 5, 6, 7, 8,
      ]);
    });

    // Regression coverage for ExaDev/documents.js#953: this fixture's own real, LibreOffice-authored stored widths (15.32, 12.76, 10.21, ...) are exactly the kind of value that used to keep re-approximating narrower on every further write -- see units.test.ts's own convergence suite for the underlying arithmetic proof and units.ts's ptToColumnWidthChars for why rounding up (never to nearest) fixes it.
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
      expect(headerRow?.heightPt).toBe(25.5);
      expect(firstDataRow?.heightPt).toBe(17);
    });

    it('marks row 10 (index 9, "Hidden Row Content") hidden via <row hidden="true">, while its own real content still reads', () => {
      const hiddenRow = data.rows.find((row) => row.index === 9);
      expect(hiddenRow?.hidden).toBe(true);
      const hiddenCell = data.cells.find(
        (cell) => cell.row === 9 && cell.column === 0,
      );
      expect(hiddenCell?.displayText).toBe("Hidden Row Content");
    });

    it("reads one ContentSheetRow per real <row> element -- no repeat-compression mechanism to guard against, unlike ODF", () => {
      expect(data.rows.map((row) => row.index)).toEqual([0, 1, 2, 5, 6, 9]);
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

    it('reads a shared-string cell (t="s")', () => {
      expect(cellAt(0).value).toEqual({ kind: "string", value: "Acme Corp" });
      expect(cellAt(0).displayText).toBe("Acme Corp");
    });

    it('reads a plain numeric cell (t="n") whose format is General as kind "number"', () => {
      expect(cellAt(1).value).toEqual({ kind: "number", value: 1234.56 }); // Amount, formatted through this fixture's own redefined numFmtId 164 ("General")
      expect(cellAt(1).displayText).toBe("1234.56");
    });

    // Cross-checked against an INDEPENDENT oracle, not just against this reader's own view of the format codes: the source these fixtures were exported from, odf.js's own src/typed/ods/fixtures/kitchen-sink.ods, declares these same four cells explicitly typed -- office:value-type="date" office:date-value="2026-07-31", office:value-type="time" office:time-value="PT14H30M00S", office:value-type="percentage" office:value="0.4256", and office:value-type="currency" office:currency="GBP" office:value="99.99". Every kind, value, and the ISO 4217 code recovered below matches what the author originally entered, recovered from nothing but a style index and a numFmt string.
    it("recovers the date/time/percentage/currency kinds xlsx itself has no cell type for, from the numFmt code each cell's own style points at", () => {
      // Due Date: numFmtId 166, "[$-809]yyyy\\-mm\\-dd" -- a locale-only bracket (NOT currency) plus real y/m/d codes; serial 46234 in this workbook's 1900 date system (workbookPr@date1904="false").
      expect(cellAt(3).value).toEqual({ kind: "date", value: "2026-07-31" });
      // Due Time: numFmtId 167, "[$-809]hh:mm:ss" -- the 'mm' resolves to MINUTES here (nearest preceding code is 'hh'), unlike the identical 'mm' in the date format above, where it resolves to a month.
      expect(cellAt(4).value).toEqual({ kind: "time", value: "14:30:00" });
      // Rate: numFmtId 168, "[$-809]0.00%" -- the value stays the raw stored fraction, not the 42.56 Excel displays.
      expect(cellAt(5).value).toEqual({ kind: "percentage", value: 0.4256 });
      // Fee: numFmtId 169, "[$GBP-809]#,##0.00" -- an ISO 4217 code between the '$' and the '-', so `currency` is populated rather than left honestly absent.
      expect(cellAt(6).value).toEqual({
        kind: "currency",
        value: 99.99,
        currency: "GBP",
      });
    });

    it("carries each cell's own raw numFmt code verbatim alongside its classified kind", () => {
      expect(cellAt(3).numberFormatCode).toBe("[$-809]yyyy\\-mm\\-dd");
      expect(cellAt(4).numberFormatCode).toBe("[$-809]hh:mm:ss");
      expect(cellAt(5).numberFormatCode).toBe("[$-809]0.00%");
      expect(cellAt(6).numberFormatCode).toBe("[$GBP-809]#,##0.00");
      // This fixture's own Amount cell resolves through a redefined numFmtId 164 whose own code IS the literal string "General" (some producers write it out explicitly rather than relying on the built-in default) -- carried verbatim like any other resolved code, not specially suppressed.
      expect(cellAt(1).numberFormatCode).toBe("General");
    });

    it("leaves displayText as the plain typed-value spelling -- this reader classifies a number format, it does not render through one", () => {
      expect(cellAt(3).displayText).toBe("2026-07-31");
      expect(cellAt(4).displayText).toBe("14:30:00");
      expect(cellAt(5).displayText).toBe("0.4256"); // not "42.56%"
      expect(cellAt(6).displayText).toBe("99.99"); // not "£99.99"
    });

    it('reads a boolean cell (t="b") and derives an Excel-style TRUE/FALSE displayText -- its own numFmtId 165 ("TRUE";"TRUE";"FALSE") style never gets a say, since only numeric cells are classified', () => {
      expect(cellAt(2).value).toEqual({ kind: "boolean", value: true });
      expect(cellAt(2).displayText).toBe("TRUE");
    });

    it("carries a real formula string verbatim, alongside its own cached numeric result", () => {
      const formulaCell = cellAt(7);
      expect(formulaCell.formula).toBe("SUM(B2:B3)");
      expect(formulaCell.value).toEqual({ kind: "number", value: 1276.56 });
    });

    it('reads a genuine formula-error cell (=1/0) as kind "error", carrying the real #DIV/0! text as both value and displayText', () => {
      const errorCell = cellAt(8);
      expect(errorCell.formula).toBe("1/0");
      expect(errorCell.value).toEqual({ kind: "error", value: "#DIV/0!" });
      expect(errorCell.displayText).toBe("#DIV/0!");
    });
  });

  describe('merged range (<mergeCells><mergeCell ref="A6:B7"/></mergeCells>)', () => {
    it("reads the anchor cell with its own colSpan/rowSpan and text", () => {
      const anchor = data.cells.find(
        (cell) => cell.row === 5 && cell.column === 0,
      );
      expect(anchor).toMatchObject({
        colSpan: 2,
        rowSpan: 2,
        displayText: "Merged Cell",
      });
    });

    it('emits nothing at all for the covered positions (B6, A7, B7) -- xlsx writes a bare, valueless <c> for each, and readCell\'s own "no v/is/f -> skip" rule already drops them', () => {
      expect(
        data.cells.find((cell) => cell.row === 5 && cell.column === 1),
      ).toBeUndefined();
      expect(
        data.cells.find((cell) => cell.row === 6 && cell.column === 0),
      ).toBeUndefined();
      expect(
        data.cells.find((cell) => cell.row === 6 && cell.column === 1),
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
      expect(data.printSettings.margins.leftPt).toBeCloseTo(
        0.590277777777778 * 72,
        6,
      );
      expect(data.printSettings.margins.topPt).toBeCloseTo(
        0.570833333333333 * 72,
        6,
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
      expect(data.printSettings.scalePercent).toBe(150);
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
      expect(data.printSettings.manualBreaks).toEqual({
        rows: [15],
        columns: [3],
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

  it("emits nothing for the sheet's own single, genuinely empty cell -- and no <cols>/<row> elements at all", () => {
    expect(sheet.cells).toEqual([]);
    expect(sheet.columns).toEqual([]);
    expect(sheet.rows).toEqual([]);
  });

  it("reads real default print settings: A4, default margins, gridlines/headers off, down-then-over page order, an explicit (default-valued) scale", () => {
    expect(sheet.printSettings.pageSize).toEqual(PAGE_SIZE_A4);
    expect(sheet.printSettings.gridlines).toBe(false);
    expect(sheet.printSettings.headers).toBe(false);
    expect(sheet.printSettings.pageOrder).toBe("downThenOver");
    expect(sheet.printSettings.scalePercent).toBe(100);
    expect(sheet.printSettings.fitToPages).toBeUndefined();
    expect(sheet.printSettings.printRange).toBeUndefined();
    expect(sheet.printSettings.repeatRows).toBeUndefined();
    expect(sheet.printSettings.repeatColumns).toBeUndefined();
    expect(sheet.printSettings.manualBreaks).toBeUndefined();
  });

  it("has no xl/sharedStrings.xml part at all (no string cells) -- readXlsxContent tolerates its absence", () => {
    const pkg = loadFixture("minimal.xlsx");
    expect(pkg.parts["xl/sharedStrings.xml"]).toBeUndefined();
  });
});

// A minimal single-sheet package wrapping a hand-built <worksheet> element -- shared by every synthetic test below, since each one only cares about a single cell's own markup.
function buildMinimalPackage(worksheet: ReturnType<typeof el>): Package {
  return {
    parts: {
      "xl/workbook.xml": {
        kind: "xml",
        nodes: [
          el("workbook", {}, [
            el("sheets", {}, [el("sheet", { name: "Sheet1", "r:id": "rId1" })]),
          ]),
        ],
      },
      "xl/_rels/workbook.xml.rels": {
        kind: "xml",
        nodes: [
          el("Relationships", {}, [
            el("Relationship", {
              Id: "rId1",
              Type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
              Target: "worksheets/sheet1.xml",
            }),
          ]),
        ],
      },
      "xl/worksheets/sheet1.xml": { kind: "xml", nodes: [worksheet] },
    },
  };
}

function readFirstCell(worksheet: ReturnType<typeof el>) {
  const result = readXlsxContent(buildMinimalPackage(worksheet));
  if (result.kind !== "spreadsheet") {
    throw new Error("expected a spreadsheet ContentDocument");
  }
  return { cells: result.sheets[0]?.cells ?? [], result };
}

describe("readXlsxContent: scope boundaries and error/fallback paths (synthetic packages)", () => {
  it("reads an empty sheets array for a package with no xl/workbook.xml at all", () => {
    const result = readXlsxContent({ parts: {} });
    expect(result.kind).toBe("spreadsheet");
    if (result.kind === "spreadsheet") {
      expect(result.sheets).toEqual([]);
      expect(result.names).toBeUndefined();
    }
  });

  it('carries a formula cell that has an <f> but no cached <v> as kind "empty" with an empty displayText, rather than dropping it', () => {
    const worksheet = el("worksheet", {}, [
      el("sheetData", {}, [
        el("row", { r: "1" }, [
          el("c", { r: "A1" }, [el("f", {}, [txt("1+1")])]),
        ]),
      ]),
    ]);
    const { cells } = readFirstCell(worksheet);
    expect(cells).toEqual([
      {
        row: 0,
        column: 0,
        value: { kind: "empty" },
        formula: "1+1",
        displayText: "",
      },
    ]);
  });

  it('reads an inline string cell (t="inlineStr") by concatenating its own <is> runs', () => {
    const worksheet = el("worksheet", {}, [
      el("sheetData", {}, [
        el("row", { r: "1" }, [
          el("c", { r: "A1", t: "inlineStr" }, [
            el("is", {}, [
              el("r", {}, [el("t", {}, [txt("Hello ")])]),
              el("r", {}, [el("t", {}, [txt("World")])]),
            ]),
          ]),
        ]),
      ]),
    ]);
    const { cells } = readFirstCell(worksheet);
    expect(cells[0]).toMatchObject({
      value: { kind: "string", value: "Hello World" },
      displayText: "Hello World",
    });
  });

  it('reads a formula cell whose cached result is a string (t="str") as kind "string", literally, not shared-string-indexed', () => {
    const worksheet = el("worksheet", {}, [
      el("sheetData", {}, [
        el("row", { r: "1" }, [
          el("c", { r: "A1", t: "str" }, [
            el("f", {}, [txt('CONCATENATE("a","b")')]),
            el("v", {}, [txt("ab")]),
          ]),
        ]),
      ]),
    ]);
    const { cells } = readFirstCell(worksheet);
    expect(cells[0]).toMatchObject({
      formula: 'CONCATENATE("a","b")',
      value: { kind: "string", value: "ab" },
      displayText: "ab",
    });
  });

  it('reads the rare t="d" ISO-8601 combined date-and-time cell type verbatim, unparsed, as ContentCellValue\'s own dateTime kind', () => {
    const worksheet = el("worksheet", {}, [
      el("sheetData", {}, [
        el("row", { r: "1" }, [
          el("c", { r: "A1", t: "d" }, [
            el("v", {}, [txt("2026-07-31T00:00:00Z")]),
          ]),
        ]),
      ]),
    ]);
    const { cells } = readFirstCell(worksheet);
    expect(cells[0]).toMatchObject({
      value: { kind: "dateTime", value: "2026-07-31T00:00:00Z" },
      displayText: "2026-07-31T00:00:00Z",
    });
  });
});

// The number format governs only what a NUMERIC cell holds. These build a package carrying a real xl/styles.xml so a cell's own s attribute resolves to a genuine format code, exercising the boundaries the kitchen-sink fixture has no cell for.
function buildStyledPackage(
  formatCode: string,
  cell: ReturnType<typeof el>,
  date1904?: string,
): Package {
  const workbookChildren = [
    ...(date1904 === undefined ? [] : [el("workbookPr", { date1904 })]),
    el("sheets", {}, [el("sheet", { name: "Sheet1", "r:id": "rId1" })]),
  ];
  return {
    parts: {
      "xl/workbook.xml": {
        kind: "xml",
        nodes: [el("workbook", {}, workbookChildren)],
      },
      "xl/_rels/workbook.xml.rels": {
        kind: "xml",
        nodes: [
          el("Relationships", {}, [
            el("Relationship", {
              Id: "rId1",
              Type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
              Target: "worksheets/sheet1.xml",
            }),
          ]),
        ],
      },
      "xl/styles.xml": {
        kind: "xml",
        nodes: [
          el("styleSheet", {}, [
            el("numFmts", {}, [el("numFmt", { numFmtId: "164", formatCode })]),
            el("cellXfs", {}, [
              el("xf", { numFmtId: "0" }),
              el("xf", { numFmtId: "164" }),
            ]),
          ]),
        ],
      },
      "xl/worksheets/sheet1.xml": {
        kind: "xml",
        nodes: [
          el("worksheet", {}, [
            el("sheetData", {}, [el("row", { r: "1" }, [cell])]),
          ]),
        ],
      },
    },
  };
}

function readStyledCell(
  formatCode: string,
  cell: ReturnType<typeof el>,
  date1904?: string,
) {
  const result = readXlsxContent(
    buildStyledPackage(formatCode, cell, date1904),
  );
  if (result.kind !== "spreadsheet") {
    throw new Error("expected a spreadsheet ContentDocument");
  }
  return result.sheets[0]?.cells[0];
}

// A styled numeric cell -- s="1" points at the numFmts-declared format; s="0" at General.
function numericCell(value: string): ReturnType<typeof el> {
  return el("c", { r: "A1", s: "1" }, [el("v", {}, [txt(value)])]);
}

describe("readXlsxContent: the number format governs numeric cells only (synthetic packages)", () => {
  it("never reclassifies a cell that already carries its own type -- a currency-formatted string, boolean, or error stays what the file says it is", () => {
    expect(
      readStyledCell(
        "[$GBP-809]#,##0.00",
        el("c", { r: "A1", s: "1", t: "str" }, [el("v", {}, [txt("99.99")])]),
      )?.value,
    ).toEqual({ kind: "string", value: "99.99" });
    expect(
      readStyledCell(
        "[$-809]yyyy-mm-dd",
        el("c", { r: "A1", s: "1", t: "b" }, [el("v", {}, [txt("1")])]),
      )?.value,
    ).toEqual({ kind: "boolean", value: true });
    expect(
      readStyledCell(
        "0.00%",
        el("c", { r: "A1", s: "1", t: "e" }, [el("v", {}, [txt("#N/A")])]),
      )?.value,
    ).toEqual({ kind: "error", value: "#N/A" });
  });

  it("reads a numeric cell with no s attribute at all through cell format 0 (CT_Cell/@s's own schema default)", () => {
    expect(
      readStyledCell("0.00%", el("c", { r: "A1" }, [el("v", {}, [txt("0.5")])]))
        ?.value,
    ).toEqual({ kind: "number", value: 0.5 });
  });

  it("honours the workbook's own 1904 date system, shifting the same serial by 1462 days", () => {
    expect(
      readStyledCell("yyyy-mm-dd", numericCell("46234"), "false")?.value,
    ).toEqual({ kind: "date", value: "2026-07-31" });
    expect(
      readStyledCell("yyyy-mm-dd", numericCell("46234"), "true")?.value,
    ).toEqual({ kind: "date", value: "2030-08-01" });
  });

  it("degrades a date-formatted serial that names no real date to the plain number it literally is", () => {
    expect(readStyledCell("yyyy-mm-dd", numericCell("60"))?.value).toEqual({
      kind: "number",
      value: 60,
    });
    expect(readStyledCell("yyyy-mm-dd", numericCell("-5"))?.value).toEqual({
      kind: "number",
      value: -5,
    });
  });

  it("keeps an elapsed-time cell as a raw number -- ContentCellValue has no duration kind, and [h]:mm:ss may exceed 24 hours", () => {
    expect(readStyledCell("[h]:mm:ss", numericCell("2.5"))?.value).toEqual({
      kind: "number",
      value: 2.5,
    });
  });

  it("omits `currency` entirely when the format identifies money by symbol rather than by ISO code", () => {
    expect(
      readStyledCell("[$£-809]#,##0.00", numericCell("99.99"))?.value,
    ).toEqual({ kind: "currency", value: 99.99 });
    expect(
      readStyledCell("[$USD-409]#,##0.00", numericCell("99.99"))?.value,
    ).toEqual({ kind: "currency", value: 99.99, currency: "USD" });
  });

  it("reads a combined date-and-time format as the dateTime kind, not as a date that silently drops its time", () => {
    expect(
      readStyledCell(
        "yyyy-mm-dd hh:mm:ss",
        numericCell("46234.604166666666667"),
      )?.value,
    ).toEqual({ kind: "dateTime", value: "2026-07-31T14:30:00" });
  });
});

// Cell decoration (background/borders/alignment/verticalAlignment) resolves through the same cellXfs index the number format does. These build a package with a real xl/styles.xml carrying fills, borders, and inline <alignment> so a cell's own s attribute resolves to a genuinely decorated xf -- the boundaries the kitchen-sink fixture (all default styling) has no cell for.
function buildDecoratedPackage(
  styleSheet: ReturnType<typeof el>,
  cell: ReturnType<typeof el>,
): Package {
  return {
    parts: {
      "xl/workbook.xml": {
        kind: "xml",
        nodes: [
          el("workbook", {}, [
            el("sheets", {}, [el("sheet", { name: "Sheet1", "r:id": "rId1" })]),
          ]),
        ],
      },
      "xl/_rels/workbook.xml.rels": {
        kind: "xml",
        nodes: [
          el("Relationships", {}, [
            el("Relationship", {
              Id: "rId1",
              Type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
              Target: "worksheets/sheet1.xml",
            }),
          ]),
        ],
      },
      "xl/styles.xml": { kind: "xml", nodes: [styleSheet] },
      "xl/worksheets/sheet1.xml": {
        kind: "xml",
        nodes: [
          el("worksheet", {}, [
            el("sheetData", {}, [el("row", { r: "1" }, [cell])]),
          ]),
        ],
      },
    },
  };
}

function readDecoratedCell(
  styleSheet: ReturnType<typeof el>,
  cell: ReturnType<typeof el>,
) {
  const result = readXlsxContent(buildDecoratedPackage(styleSheet, cell));
  if (result.kind !== "spreadsheet") {
    throw new Error("expected a spreadsheet ContentDocument");
  }
  return result.sheets[0]?.cells[0];
}

describe("readXlsxContent: cell decoration (background/borders/alignment/verticalAlignment)", () => {
  // A styleSheet whose cellXfs entry at index 1 carries a solid red fill (fgColor rgb), a thin solid left edge + a dashed blue right edge, a centred horizontal alignment, and a centred vertical alignment. Index 0 is the default General/no-decoration entry.
  const styledSheet = el("styleSheet", {}, [
    el("fills", {}, [
      el("fill", {}, [el("patternFill", { patternType: "none" })]),
      el("fill", {}, [el("patternFill", { patternType: "gray125" })]),
      el("fill", {}, [
        el("patternFill", { patternType: "solid" }, [
          el("fgColor", { rgb: "FFFF0000" }),
          el("bgColor", { indexed: "64" }),
        ]),
      ]),
    ]),
    el("borders", {}, [
      el("border", {}, [
        el("left"),
        el("right"),
        el("top"),
        el("bottom"),
        el("diagonal"),
      ]),
      el("border", {}, [
        el("left", { style: "thin" }, [el("color", { rgb: "FF000000" })]),
        el("right", { style: "dashed" }, [el("color", { rgb: "FF0000FF" })]),
        el("top"),
        el("bottom"),
        el("diagonal"),
      ]),
    ]),
    el("cellXfs", {}, [
      el("xf", { numFmtId: "0" }),
      el(
        "xf",
        {
          numFmtId: "0",
          fillId: "2",
          borderId: "1",
          applyFill: "1",
          applyBorder: "1",
          applyAlignment: "1",
        },
        [el("alignment", { horizontal: "center", vertical: "center" })],
      ),
    ]),
  ]);

  it("reads a solid fill background from the solid pattern's fgColor rgb", () => {
    const cell = readDecoratedCell(
      styledSheet,
      el("c", { r: "A1", s: "1" }, [el("v", {}, [txt("42")])]),
    );
    expect(cell?.background).toEqual({
      kind: "solid",
      color: { r: 1, g: 0, b: 0 },
    });
  });

  it("reads each present border edge with its derived widthPt and style, and omits absent edges", () => {
    const cell = readDecoratedCell(
      styledSheet,
      el("c", { r: "A1", s: "1" }, [el("v", {}, [txt("42")])]),
    );
    expect(cell?.borders).toEqual({
      left: { color: { r: 0, g: 0, b: 0 }, widthPt: 0.75 },
      right: { color: { r: 0, g: 0, b: 1 }, widthPt: 0.75, style: "dashed" },
    });
  });

  it('reads horizontal and vertical alignment, mapping vertical "center" to the schema\'s "middle"', () => {
    const cell = readDecoratedCell(
      styledSheet,
      el("c", { r: "A1", s: "1" }, [el("v", {}, [txt("42")])]),
    );
    expect(cell?.alignment).toBe("center");
    expect(cell?.verticalAlignment).toBe("middle");
  });

  it("leaves all four decoration fields unset on a cell whose s index carries none of them", () => {
    const cell = readDecoratedCell(
      styledSheet,
      el("c", { r: "A1", s: "0" }, [el("v", {}, [txt("42")])]),
    );
    expect(cell?.background).toBeUndefined();
    expect(cell?.borders).toBeUndefined();
    expect(cell?.alignment).toBeUndefined();
    expect(cell?.verticalAlignment).toBeUndefined();
  });

  it('leaves horizontal="general" unread -- general means "use the value-kind default", the same semantics as an absent alignment', () => {
    const generalSheet = el("styleSheet", {}, [
      el("cellXfs", {}, [
        el("xf", { numFmtId: "0" }, [
          el("alignment", { horizontal: "general", vertical: "bottom" }),
        ]),
      ]),
    ]);
    const cell = readDecoratedCell(
      generalSheet,
      el("c", { r: "A1" }, [el("v", {}, [txt("42")])]),
    );
    expect(cell?.alignment).toBeUndefined();
    expect(cell?.verticalAlignment).toBeUndefined();
  });

  it('reads vertical="top" but leaves vertical="bottom" unread (the documented default)', () => {
    const topSheet = el("styleSheet", {}, [
      el("cellXfs", {}, [
        el("xf", { numFmtId: "0" }, [el("alignment", { vertical: "top" })]),
      ]),
    ]);
    expect(
      readDecoratedCell(
        topSheet,
        el("c", { r: "A1" }, [el("v", {}, [txt("1")])]),
      )?.verticalAlignment,
    ).toBe("top");
  });

  it("leaves a theme/indexed-only fill colour unread rather than substituting a fixed colour", () => {
    const themeSheet = el("styleSheet", {}, [
      el("fills", {}, [
        el("fill", {}, [el("patternFill", { patternType: "none" })]),
        el("fill", {}, [
          el("patternFill", { patternType: "solid" }, [
            el("fgColor", { theme: "0" }),
          ]),
        ]),
      ]),
      el("cellXfs", {}, [
        el("xf", { numFmtId: "0" }),
        el("xf", { numFmtId: "0", fillId: "1" }),
      ]),
    ]);
    expect(
      readDecoratedCell(
        themeSheet,
        el("c", { r: "A1", s: "1" }, [el("v", {}, [txt("1")])]),
      )?.background,
    ).toBeUndefined();
  });

  it("omits the font/background/borders/alignment/verticalAlignment keys entirely on a cell whose s index carries none of them -- not merely assigned undefined", () => {
    const cell = readDecoratedCell(
      styledSheet,
      el("c", { r: "A1", s: "0" }, [el("v", {}, [txt("42")])]),
    );
    expect(cell).toBeDefined();
    if (cell === undefined) {
      throw new Error("expected a cell");
    }
    expect(hasOwn(cell, "font")).toBe(false);
    expect(hasOwn(cell, "background")).toBe(false);
    expect(hasOwn(cell, "borders")).toBe(false);
    expect(hasOwn(cell, "alignment")).toBe(false);
    expect(hasOwn(cell, "verticalAlignment")).toBe(false);
  });

  it("sets the numberFormatCode key when the cell's style resolves one, verbatim", () => {
    const cell = readDecoratedCell(
      styledSheet,
      el("c", { r: "A1", s: "1" }, [el("v", {}, [txt("42")])]),
    );
    expect(hasOwn(cell ?? {}, "numberFormatCode")).toBe(true);
  });

  it("omits numberFormatCode entirely (not merely as undefined) for an out-of-range style index that resolves to no entry at all", () => {
    const cell = readDecoratedCell(
      styledSheet,
      el("c", { r: "A1", s: "99" }, [el("v", {}, [txt("42")])]),
    );
    expect(hasOwn(cell ?? {}, "numberFormatCode")).toBe(false);
  });

  it("omits numberFormatCode entirely (not merely as undefined) for a resolvable style entry whose own numFmtId names no code anywhere", () => {
    const noCodeSheet = el("styleSheet", {}, [
      el("cellXfs", {}, [
        el("xf", { numFmtId: "0" }),
        el("xf", { numFmtId: "999" }),
      ]),
    ]);
    const cell = readDecoratedCell(
      noCodeSheet,
      el("c", { r: "A1", s: "1" }, [el("v", {}, [txt("42")])]),
    );
    expect(hasOwn(cell ?? {}, "numberFormatCode")).toBe(false);
  });
});

// Every one of readColumns/readRows/sheetFormatDefaultRowHeightPt's own conditional branches and index arithmetic, exercised directly against small synthetic worksheets -- the kitchen-sink fixture's own real rows/columns don't happen to visit every boundary (a 0-based min, a non-numeric width, a row number exactly at its own lower bound) these functions guard against.
function readSheetFromWorksheet(
  worksheet: ReturnType<typeof el>,
): ContentSheet {
  const result = readXlsxContent(buildMinimalPackage(worksheet));
  if (result.kind !== "spreadsheet") {
    throw new Error("expected a spreadsheet ContentDocument");
  }
  const sheet = result.sheets[0];
  if (sheet === undefined) {
    throw new Error("expected a sheet");
  }
  return sheet;
}

describe("readXlsxContent: row/column geometry edge cases (synthetic packages)", () => {
  it("falls back to DEFAULT_ROW_HEIGHT_PT for a row with no ht attribute when the worksheet carries no sheetFormatPr at all", () => {
    const worksheet = el("worksheet", {}, [
      el("sheetData", {}, [el("row", { r: "1" })]),
    ]);
    expect(readSheetFromWorksheet(worksheet).rows).toEqual([
      { index: 0, heightPt: DEFAULT_ROW_HEIGHT_PT },
    ]);
  });

  it("falls back to the sheetFormatPr's own declared defaultRowHeight, not the package-wide default, for a row with no ht of its own", () => {
    const worksheet = el("worksheet", {}, [
      el("sheetFormatPr", { defaultRowHeight: "22.5" }),
      el("sheetData", {}, [el("row", { r: "1" })]),
    ]);
    expect(readSheetFromWorksheet(worksheet).rows).toEqual([
      { index: 0, heightPt: 22.5 },
    ]);
  });

  it("prefers a row's own ht over the sheetFormatPr default", () => {
    const worksheet = el("worksheet", {}, [
      el("sheetFormatPr", { defaultRowHeight: "22.5" }),
      el("sheetData", {}, [el("row", { r: "1", ht: "30" })]),
    ]);
    expect(readSheetFromWorksheet(worksheet).rows).toEqual([
      { index: 0, heightPt: 30 },
    ]);
  });

  it("drops a row whose own r is 0 (below CT_Row/@r's 1-based lower bound) but keeps one whose r is exactly 1", () => {
    const worksheet = el("worksheet", {}, [
      el("sheetData", {}, [el("row", { r: "0" }), el("row", { r: "1" })]),
    ]);
    expect(readSheetFromWorksheet(worksheet).rows).toEqual([
      { index: 0, heightPt: DEFAULT_ROW_HEIGHT_PT },
    ]);
  });

  it('recovers row index 4 -- not 6 -- from r="5", proving the 1-based-to-0-based conversion subtracts rather than adds', () => {
    const worksheet = el("worksheet", {}, [
      el("sheetData", {}, [el("row", { r: "5" })]),
    ]);
    expect(readSheetFromWorksheet(worksheet).rows[0]?.index).toBe(4);
  });

  it("marks a row hidden only when its own hidden attribute reads true, never as a side effect of any other attribute", () => {
    const worksheet = el("worksheet", {}, [
      el("sheetData", {}, [
        el("row", { r: "1", hidden: "true" }),
        el("row", { r: "2" }),
      ]),
    ]);
    const rows = readSheetFromWorksheet(worksheet).rows;
    expect(rows[0]).toEqual({
      index: 0,
      heightPt: DEFAULT_ROW_HEIGHT_PT,
      hidden: true,
    });
    expect(hasOwn(rows[1] ?? {}, "hidden")).toBe(false);
  });

  it("drops a <col> whose min is 0 (below CT_Col/@min's 1-based lower bound) but keeps one whose min is exactly 1", () => {
    const worksheet = el("worksheet", {}, [
      el("cols", {}, [
        el("col", { min: "0", max: "0" }),
        el("col", { min: "1", max: "1" }),
      ]),
      el("sheetData", {}),
    ]);
    expect(readSheetFromWorksheet(worksheet).columns).toEqual([{ index: 0 }]);
  });

  it("sets widthPt from a numeric width attribute, and omits the key entirely when width is absent", () => {
    const worksheet = el("worksheet", {}, [
      el("cols", {}, [
        el("col", { min: "1", max: "1", width: "20" }),
        el("col", { min: "2", max: "2" }),
      ]),
      el("sheetData", {}),
    ]);
    const columns = readSheetFromWorksheet(worksheet).columns;
    expect(columns[0]?.widthPt).toBeCloseTo(columnWidthCharsToPt(20), 10);
    expect(hasOwn(columns[1] ?? {}, "widthPt")).toBe(false);
  });

  it("omits widthPt for a non-numeric width attribute, rather than reporting a NaN width", () => {
    const worksheet = el("worksheet", {}, [
      el("cols", {}, [
        el("col", { min: "1", max: "1", width: "not-a-number" }),
      ]),
      el("sheetData", {}),
    ]);
    expect(
      hasOwn(readSheetFromWorksheet(worksheet).columns[0] ?? {}, "widthPt"),
    ).toBe(false);
  });

  it("marks a column hidden only when its own hidden attribute reads true", () => {
    const worksheet = el("worksheet", {}, [
      el("cols", {}, [
        el("col", { min: "1", max: "1", hidden: "true" }),
        el("col", { min: "2", max: "2" }),
      ]),
      el("sheetData", {}),
    ]);
    const columns = readSheetFromWorksheet(worksheet).columns;
    expect(columns[0]).toEqual({ index: 0, hidden: true });
    expect(hasOwn(columns[1] ?? {}, "hidden")).toBe(false);
  });
});

describe("readXlsxContent: readSheet's own optional-field keys are absent, not undefined, when a sheet carries none of them", () => {
  it("omits embeddedObjects/dataValidations/conditionalFormats entirely from a sheet with no drawing, validation, or conditional format at all", () => {
    const sheet = readSheetFromWorksheet(
      el("worksheet", {}, [el("sheetData", {})]),
    );
    expect(hasOwn(sheet, "embeddedObjects")).toBe(false);
    expect(hasOwn(sheet, "dataValidations")).toBe(false);
    expect(hasOwn(sheet, "conditionalFormats")).toBe(false);
  });
});

describe("readXlsxContent: deriveDisplayText/resolveNumericValue exact per-kind coverage (synthetic packages)", () => {
  it("renders a numeric-format dateTime cell's displayText as its ISO spelling, not the boolean-branch TRUE/FALSE fallthrough text", () => {
    const cell = readStyledCell(
      "yyyy-mm-dd hh:mm:ss",
      numericCell("46234.604166666666667"),
    );
    expect(cell?.displayText).toBe("2026-07-31T14:30:00");
  });

  it("renders a percentage cell's displayText as the raw stored fraction, not TRUE", () => {
    const cell = readStyledCell("0.00%", numericCell("0.4256"));
    expect(cell?.displayText).toBe("0.4256");
  });

  it("omits the currency key entirely (not merely as undefined) when the format names money by symbol alone", () => {
    const cell = readStyledCell("[$£-809]#,##0.00", numericCell("99.99"));
    expect(cell?.value.kind).toBe("currency");
    expect(hasOwn(cell?.value ?? {}, "currency")).toBe(false);
  });

  it('renders FALSE, not just "not TRUE", for a false boolean cell', () => {
    expect(
      readFirstCell(
        el("worksheet", {}, [
          el("sheetData", {}, [
            el("row", { r: "1" }, [
              el("c", { r: "A1", t: "b" }, [el("v", {}, [txt("0")])]),
            ]),
          ]),
        ]),
      ).cells[0],
    ).toMatchObject({
      value: { kind: "boolean", value: false },
      displayText: "FALSE",
    });
  });
});

describe("readXlsxContent: readCellValue's boolean/numeric branch precision (synthetic packages)", () => {
  it('reads t="b" true from an upper-, lower-, or mixed-case spelling of "true", not just the literal "1"', () => {
    for (const raw of ["TRUE", "True", "true"]) {
      const { cells } = readFirstCell(
        el("worksheet", {}, [
          el("sheetData", {}, [
            el("row", { r: "1" }, [
              el("c", { r: "A1", t: "b" }, [el("v", {}, [txt(raw)])]),
            ]),
          ]),
        ]),
      );
      expect(cells[0]?.value).toEqual({ kind: "boolean", value: true });
    }
  });

  it('reads t="b" as false for any raw text that is neither "1" nor a case-insensitive "true"', () => {
    const { cells } = readFirstCell(
      el("worksheet", {}, [
        el("sheetData", {}, [
          el("row", { r: "1" }, [
            el("c", { r: "A1", t: "b" }, [el("v", {}, [txt("false")])]),
          ]),
        ]),
      ]),
    );
    expect(cells[0]?.value).toEqual({ kind: "boolean", value: false });
  });

  it("drops an untyped cell whose <v> text is not a parseable number at all, rather than reporting NaN", () => {
    const { cells } = readFirstCell(
      el("worksheet", {}, [
        el("sheetData", {}, [
          el("row", { r: "1" }, [
            el("c", { r: "A1" }, [el("v", {}, [txt("not-a-number")])]),
          ]),
        ]),
      ]),
    );
    expect(cells).toEqual([]);
  });
});

describe("readXlsxContent: readCell's formula key presence (synthetic packages)", () => {
  it("omits the formula key entirely for a plain value cell with no <f> child", () => {
    const { cells } = readFirstCell(
      el("worksheet", {}, [
        el("sheetData", {}, [
          el("row", { r: "1" }, [
            el("c", { r: "A1" }, [el("v", {}, [txt("42")])]),
          ]),
        ]),
      ]),
    );
    expect(hasOwn(cells[0] ?? {}, "formula")).toBe(false);
  });
});

describe("readXlsxContent: merged-range span arithmetic (synthetic packages)", () => {
  // Anchored at B2, not A1: with a zero-valued start, endColumn-startColumn and endColumn+startColumn (the ArithmeticOperator mutant's own replacement) coincide, so a genuine test needs a nonzero start on both axes to actually distinguish subtraction from addition.
  function mergedWorksheet(
    ref: string,
    anchorRef: string,
  ): ReturnType<typeof el> {
    return el("worksheet", {}, [
      el("sheetData", {}, [
        el("row", { r: "2" }, [
          el("c", { r: anchorRef }, [el("v", {}, [txt("1")])]),
        ]),
      ]),
      el("mergeCells", {}, [el("mergeCell", { ref })]),
    ]);
  }

  it("computes colSpan and rowSpan from the true end-minus-start distance, not an end-plus-start sum, for a merge anchored away from row/column 0", () => {
    const { cells } = readFirstCell(mergedWorksheet("B2:D4", "B2"));
    const anchor = cells[0];
    expect(anchor?.colSpan).toBe(3);
    expect(anchor?.rowSpan).toBe(3);
  });

  it("sets colSpan alone for a 1-row, multi-column merge, never fabricating a rowSpan", () => {
    const { cells } = readFirstCell(mergedWorksheet("B2:D2", "B2"));
    const anchor = cells[0];
    expect(anchor?.colSpan).toBe(3);
    expect(hasOwn(anchor ?? {}, "rowSpan")).toBe(false);
  });

  it("sets rowSpan alone for a 1-column, multi-row merge, never fabricating a colSpan", () => {
    const { cells } = readFirstCell(mergedWorksheet("B2:B4", "B2"));
    const anchor = cells[0];
    expect(anchor?.rowSpan).toBe(3);
    expect(hasOwn(anchor ?? {}, "colSpan")).toBe(false);
  });

  it("sets neither colSpan nor rowSpan for a single-cell 'merge' (B2:B2) -- a span of exactly 1 on both axes", () => {
    const { cells } = readFirstCell(mergedWorksheet("B2:B2", "B2"));
    const anchor = cells[0];
    expect(hasOwn(anchor ?? {}, "colSpan")).toBe(false);
    expect(hasOwn(anchor ?? {}, "rowSpan")).toBe(false);
  });
});

// A chart graphic frame reached the way a real workbook reaches one: the worksheet's own <drawing r:id> names a drawing part through the worksheet's relationships, the drawing's xdr:twoCellAnchor carries an xdr:graphicFrame whose a:graphicData names the chart part through the DRAWING's relationships. The anchor geometry resolves through the sheet's own declared column widths and row heights, exactly as a spreadsheet renderer would place it.
function chartDrawingPackage(): Package {
  const revenue = el("c:ser", {}, [
    el("c:tx", {}, [
      el("c:strRef", {}, [
        el("c:f", {}, [txt("Sheet1!$B$1")]),
        el("c:strCache", {}, [
          el("c:ptCount", { val: "1" }),
          el("c:pt", { idx: "0" }, [el("c:v", {}, [txt("Revenue")])]),
        ]),
      ]),
    ]),
    el("c:cat", {}, [
      el("c:strRef", {}, [
        el("c:strCache", {}, [
          el("c:ptCount", { val: "2" }),
          el("c:pt", { idx: "0" }, [el("c:v", {}, [txt("Q1")])]),
          el("c:pt", { idx: "1" }, [el("c:v", {}, [txt("Q2")])]),
        ]),
      ]),
    ]),
    el("c:val", {}, [
      el("c:numRef", {}, [
        el("c:numCache", {}, [
          el("c:ptCount", { val: "2" }),
          el("c:pt", { idx: "0" }, [el("c:v", {}, [txt("8.5")])]),
          el("c:pt", { idx: "1" }, [el("c:v", {}, [txt("12")])]),
        ]),
      ]),
    ]),
  ]);
  const chartSpace = el("c:chartSpace", {}, [
    el("c:chart", {}, [
      el("c:plotArea", {}, [el("c:barChart", {}, [revenue])]),
    ]),
  ]);
  // CT_TwoCellAnchor's own shape: the from/to markers are the ANCHOR's children, with the anchored object (the graphic frame) between them and xdr:clientData last.
  const graphicFrame = el("xdr:graphicFrame", {}, [
    el("xdr:nvGraphicFramePr", {}, [
      el("xdr:cNvPr", { id: "2", name: "Chart 1" }),
    ]),
    el("a:graphic", {}, [
      el(
        "a:graphicData",
        { uri: "http://schemas.openxmlformats.org/drawingml/2006/chart" },
        [el("c:chart", { "r:id": "rIdChart" })],
      ),
    ]),
  ]);
  const drawing = el("xdr:wsDr", {}, [
    el("xdr:twoCellAnchor", {}, [
      el("xdr:from", {}, [
        el("xdr:col", {}, [txt("0")]),
        el("xdr:colOff", {}, [txt("19050")]),
        el("xdr:row", {}, [txt("1")]),
        el("xdr:rowOff", {}, [txt("0")]),
      ]),
      el("xdr:to", {}, [
        el("xdr:col", {}, [txt("2")]),
        el("xdr:colOff", {}, [txt("0")]),
        el("xdr:row", {}, [txt("4")]),
        el("xdr:rowOff", {}, [txt("0")]),
      ]),
      graphicFrame,
      el("xdr:clientData"),
    ]),
  ]);
  const worksheet = el("worksheet", {}, [
    el("cols", {}, [
      el("col", { min: "1", max: "1", width: "10" }),
      el("col", { min: "2", max: "2", width: "20" }),
    ]),
    el("sheetData", {}, [
      el("row", { r: "1" }, [el("c", { r: "A1" }, [el("v", {}, [txt("1")])])]),
    ]),
    el("drawing", { "r:id": "rIdDrawing" }),
  ]);
  const relationship = (id: string, type: string, target: string) =>
    el("Relationship", { Id: id, Type: type, Target: target });
  return {
    parts: {
      "xl/workbook.xml": {
        kind: "xml",
        nodes: [
          el("workbook", {}, [
            el("sheets", {}, [
              el("sheet", { name: "Data", sheetId: "1", "r:id": "rIdSheet" }),
            ]),
          ]),
        ],
      },
      "xl/_rels/workbook.xml.rels": {
        kind: "xml",
        nodes: [
          el("Relationships", {}, [
            relationship(
              "rIdSheet",
              "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
              "worksheets/sheet1.xml",
            ),
          ]),
        ],
      },
      "xl/worksheets/sheet1.xml": { kind: "xml", nodes: [worksheet] },
      "xl/worksheets/_rels/sheet1.xml.rels": {
        kind: "xml",
        nodes: [
          el("Relationships", {}, [
            relationship(
              "rIdDrawing",
              "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing",
              "../drawings/drawing1.xml",
            ),
          ]),
        ],
      },
      "xl/drawings/drawing1.xml": { kind: "xml", nodes: [drawing] },
      "xl/drawings/_rels/drawing1.xml.rels": {
        kind: "xml",
        nodes: [
          el("Relationships", {}, [
            relationship(
              "rIdChart",
              "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart",
              "../charts/chart1.xml",
            ),
          ]),
        ],
      },
      "xl/charts/chart1.xml": { kind: "xml", nodes: [chartSpace] },
    },
  };
}

describe("readXlsxContent: chart graphic frames", () => {
  it("reads a chart graphic frame as an embedded chart object carrying the chart part's cached series/category model as a one-sheet spreadsheet document", () => {
    const document = readXlsxContent(chartDrawingPackage());
    if (document.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(document.sheets[0]?.embeddedObjects).toHaveLength(1);
    const chart = document.sheets[0]?.embeddedObjects?.[0];
    expect(chart?.objectKind).toBe("chart");
    expect(chart?.origin).toBe("chart");
    expect(chart?.anchorColumn).toBe(0);
    expect(chart?.anchorRow).toBe(1);
    // The frame: anchored at column 0 offset 19050 EMU, row 1, spanning to the start of column 2 and row 4 -- absolute position from the sheet's left edge through the declared column widths and default row height, size the difference of the two anchors.
    const col0 = columnWidthCharsToPt(10);
    const col1 = columnWidthCharsToPt(20);
    const offsetX = (19050 / 914400) * 72;
    expect(chart?.offsetXPt).toBeCloseTo(offsetX, 5);
    expect(chart?.frame.xPt).toBeCloseTo(offsetX, 5);
    expect(chart?.frame.yPt).toBeCloseTo(15, 5);
    expect(chart?.frame.widthPt).toBeCloseTo(col0 + col1 - offsetX, 5);
    expect(chart?.frame.heightPt).toBeCloseTo(45, 5);
    // The payload is the cached model, verbatim c:v text, laid out the way the pptx chart reader spells its table: a header row of series names over a category column, one row per category.
    expect(chart?.document.kind).toBe("spreadsheet");
    const sheet =
      chart?.document.kind === "spreadsheet"
        ? chart.document.sheets[0]
        : undefined;
    // The graphic frame's own xdr:cNvPr/@name ("Chart 1"), not the "Chart" fallback -- the payload sheet is named after the shape that actually held it.
    expect(sheet?.name).toBe("Chart 1");
    expect(sheet?.cells).toEqual([
      {
        row: 0,
        column: 1,
        value: { kind: "string", value: "Revenue" },
        displayText: "Revenue",
      },
      {
        row: 1,
        column: 0,
        value: { kind: "string", value: "Q1" },
        displayText: "Q1",
      },
      {
        row: 1,
        column: 1,
        value: { kind: "string", value: "8.5" },
        displayText: "8.5",
      },
      {
        row: 2,
        column: 0,
        value: { kind: "string", value: "Q2" },
        displayText: "Q2",
      },
      {
        row: 2,
        column: 1,
        value: { kind: "string", value: "12" },
        displayText: "12",
      },
    ]);
  });

  it("round-trips the whole document through ContentDocumentSchema, so the embedded chart object is schema-valid as read", () => {
    expect(
      ContentDocumentSchema.safeParse(readXlsxContent(chartDrawingPackage()))
        .success,
    ).toBe(true);
  });

  it("quarantines the whole chart part -- type, axes, colours, everything the cached-model read does not carry -- as xlsx residue on the embedded object", () => {
    const document = readXlsxContent(chartDrawingPackage());
    if (document.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    const chart = document.sheets[0]?.embeddedObjects?.[0];
    expect(chart?.source?.format).toBe("xlsx");
    expect(chart?.source?.xml).toContain("c:chartSpace");
    expect(chart?.source?.xml).toContain("c:barChart");
  });

  it("survives the write pair: buildXlsxPackageFromContent writes a real drawing/chart part pair, and reading it back recovers the same cached series/category model (ExaDev/documents.js#973)", () => {
    const rewritten = readXlsxContent(
      decodePackage(
        encodePackage(
          buildXlsxPackageFromContent(readXlsxContent(chartDrawingPackage())),
        ),
      ),
    );
    if (rewritten.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(rewritten.sheets[0]?.embeddedObjects).toHaveLength(1);
    const chart = rewritten.sheets[0]?.embeddedObjects?.[0];
    expect(chart?.objectKind).toBe("chart");
    const sheet =
      chart?.document.kind === "spreadsheet"
        ? chart.document.sheets[0]
        : undefined;
    expect(sheet?.cells).toEqual([
      {
        row: 0,
        column: 1,
        value: { kind: "string", value: "Revenue" },
        displayText: "Revenue",
      },
      {
        row: 1,
        column: 0,
        value: { kind: "string", value: "Q1" },
        displayText: "Q1",
      },
      {
        row: 1,
        column: 1,
        value: { kind: "string", value: "8.5" },
        displayText: "8.5",
      },
      {
        row: 2,
        column: 0,
        value: { kind: "string", value: "Q2" },
        displayText: "Q2",
      },
      {
        row: 2,
        column: 1,
        value: { kind: "string", value: "12" },
        displayText: "12",
      },
    ]);
  });
});

// The same chart graphic frame as chartDrawingPackage carries, under a oneCellAnchor instead: both rows share the drawing walk, so the one-cell spelling extends charts exactly as it extends pictures (#776's own "both rows" note). Position from the from-marker, size from the anchor's own xdr:ext.
function oneCellChartPackage(): Package {
  const revenue = el("c:ser", {}, [
    el("c:tx", {}, [
      el("c:strRef", {}, [
        el("c:f", {}, [txt("Sheet1!$B$1")]),
        el("c:strCache", {}, [
          el("c:ptCount", { val: "1" }),
          el("c:pt", { idx: "0" }, [el("c:v", {}, [txt("Revenue")])]),
        ]),
      ]),
    ]),
    el("c:cat", {}, [
      el("c:strRef", {}, [
        el("c:strCache", {}, [
          el("c:ptCount", { val: "2" }),
          el("c:pt", { idx: "0" }, [el("c:v", {}, [txt("Q1")])]),
          el("c:pt", { idx: "1" }, [el("c:v", {}, [txt("Q2")])]),
        ]),
      ]),
    ]),
    el("c:val", {}, [
      el("c:numRef", {}, [
        el("c:numCache", {}, [
          el("c:ptCount", { val: "2" }),
          el("c:pt", { idx: "0" }, [el("c:v", {}, [txt("8.5")])]),
          el("c:pt", { idx: "1" }, [el("c:v", {}, [txt("12")])]),
        ]),
      ]),
    ]),
  ]);
  const chartSpace = el("c:chartSpace", {}, [
    el("c:chart", {}, [
      el("c:plotArea", {}, [el("c:barChart", {}, [revenue])]),
    ]),
  ]);
  const graphicFrame = el("xdr:graphicFrame", {}, [
    el("xdr:nvGraphicFramePr", {}, [
      el("xdr:cNvPr", { id: "2", name: "Chart 1" }),
    ]),
    el("a:graphic", {}, [
      el(
        "a:graphicData",
        { uri: "http://schemas.openxmlformats.org/drawingml/2006/chart" },
        [el("c:chart", { "r:id": "rIdChart" })],
      ),
    ]),
  ]);
  const drawing = el("xdr:wsDr", {}, [
    el("xdr:oneCellAnchor", {}, [
      el("xdr:from", {}, [
        el("xdr:col", {}, [txt("0")]),
        el("xdr:colOff", {}, [txt("19050")]),
        el("xdr:row", {}, [txt("1")]),
        el("xdr:rowOff", {}, [txt("0")]),
      ]),
      el("xdr:ext", { cx: "1828800", cy: "914400" }),
      graphicFrame,
      el("xdr:clientData"),
    ]),
  ]);
  const worksheet = el("worksheet", {}, [
    el("cols", {}, [
      el("col", { min: "1", max: "1", width: "10" }),
      el("col", { min: "2", max: "2", width: "20" }),
    ]),
    el("sheetData", {}, [
      el("row", { r: "1" }, [el("c", { r: "A1" }, [el("v", {}, [txt("1")])])]),
    ]),
    el("drawing", { "r:id": "rIdDrawing" }),
  ]);
  const relationship = (id: string, type: string, target: string) =>
    el("Relationship", { Id: id, Type: type, Target: target });
  return {
    parts: {
      "xl/workbook.xml": {
        kind: "xml",
        nodes: [
          el("workbook", {}, [
            el("sheets", {}, [
              el("sheet", { name: "Data", sheetId: "1", "r:id": "rIdSheet" }),
            ]),
          ]),
        ],
      },
      "xl/_rels/workbook.xml.rels": {
        kind: "xml",
        nodes: [
          el("Relationships", {}, [
            relationship(
              "rIdSheet",
              "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
              "worksheets/sheet1.xml",
            ),
          ]),
        ],
      },
      "xl/worksheets/sheet1.xml": { kind: "xml", nodes: [worksheet] },
      "xl/worksheets/_rels/sheet1.xml.rels": {
        kind: "xml",
        nodes: [
          el("Relationships", {}, [
            relationship(
              "rIdDrawing",
              "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing",
              "../drawings/drawing1.xml",
            ),
          ]),
        ],
      },
      "xl/drawings/drawing1.xml": { kind: "xml", nodes: [drawing] },
      "xl/drawings/_rels/drawing1.xml.rels": {
        kind: "xml",
        nodes: [
          el("Relationships", {}, [
            relationship(
              "rIdChart",
              "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart",
              "../charts/chart1.xml",
            ),
          ]),
        ],
      },
      "xl/charts/chart1.xml": { kind: "xml", nodes: [chartSpace] },
    },
  };
}

describe("readXlsxContent: chart graphic frames (oneCellAnchor)", () => {
  it("reads an xdr:oneCellAnchor graphic frame with its frame sized from the anchor's own xdr:ext and its cached model intact", () => {
    const document = readXlsxContent(oneCellChartPackage());
    if (document.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(document.sheets[0]?.embeddedObjects).toHaveLength(1);
    const chart = document.sheets[0]?.embeddedObjects?.[0];
    expect(chart?.objectKind).toBe("chart");
    expect(chart?.anchorColumn).toBe(0);
    expect(chart?.anchorRow).toBe(1);
    // Position from the from-marker through the same grid geometry the two-cell spelling uses; size verbatim from xdr:ext (1828800 x 914400 EMU = 144 x 72 pt).
    const offsetX = (19050 / 914400) * 72;
    expect(chart?.offsetXPt).toBeCloseTo(offsetX, 5);
    expect(chart?.offsetYPt).toBe(0);
    expect(chart?.frame.xPt).toBeCloseTo(offsetX, 5);
    expect(chart?.frame.yPt).toBeCloseTo(15, 5);
    expect(chart?.frame.widthPt).toBeCloseTo(144, 5);
    expect(chart?.frame.heightPt).toBeCloseTo(72, 5);
    expect(chart?.document.kind).toBe("spreadsheet");
    const sheet =
      chart?.document.kind === "spreadsheet"
        ? chart.document.sheets[0]
        : undefined;
    expect(sheet?.cells).toEqual([
      {
        row: 0,
        column: 1,
        value: { kind: "string", value: "Revenue" },
        displayText: "Revenue",
      },
      {
        row: 1,
        column: 0,
        value: { kind: "string", value: "Q1" },
        displayText: "Q1",
      },
      {
        row: 1,
        column: 1,
        value: { kind: "string", value: "8.5" },
        displayText: "8.5",
      },
      {
        row: 2,
        column: 0,
        value: { kind: "string", value: "Q2" },
        displayText: "Q2",
      },
      {
        row: 2,
        column: 1,
        value: { kind: "string", value: "12" },
        displayText: "12",
      },
    ]);
  });

  it("round-trips the whole document through ContentDocumentSchema, so the one-cell-anchored chart object is schema-valid as read", () => {
    expect(
      ContentDocumentSchema.safeParse(readXlsxContent(oneCellChartPackage()))
        .success,
    ).toBe(true);
  });
});

// A drawing picture reached through the same cascade as the chart fixture above: the worksheet's <drawing r:id> names a drawing part, whose xdr:twoCellAnchor this time carries an xdr:pic whose a:blip names a media part through the DRAWING's relationships. Anchor fields and frame come from the from/to markers through the same grid geometry the chart row resolves against.
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function pictureDrawingPackage(mediaBase64: string = TINY_PNG_BASE64): Package {
  const picture = el("xdr:pic", {}, [
    el("xdr:nvPicPr", {}, [el("xdr:cNvPr", { id: "2", name: "Picture 1" })]),
    el("xdr:blipFill", {}, [el("a:blip", { "r:embed": "rIdImage" })]),
    el("xdr:spPr", {}, [
      el("a:xfrm", {}, [
        el("a:off", { x: "0", y: "0" }),
        el("a:ext", { cx: "4781525", cy: "2765425" }),
      ]),
      el("a:prstGeom", { prst: "rect" }, [el("a:avLst")]),
    ]),
  ]);
  const drawing = el("xdr:wsDr", {}, [
    el("xdr:twoCellAnchor", {}, [
      el("xdr:from", {}, [
        el("xdr:col", {}, [txt("0")]),
        el("xdr:colOff", {}, [txt("19050")]),
        el("xdr:row", {}, [txt("1")]),
        el("xdr:rowOff", {}, [txt("0")]),
      ]),
      el("xdr:to", {}, [
        el("xdr:col", {}, [txt("2")]),
        el("xdr:colOff", {}, [txt("0")]),
        el("xdr:row", {}, [txt("4")]),
        el("xdr:rowOff", {}, [txt("0")]),
      ]),
      picture,
      el("xdr:clientData"),
    ]),
  ]);
  const worksheet = el("worksheet", {}, [
    el("cols", {}, [
      el("col", { min: "1", max: "1", width: "10" }),
      el("col", { min: "2", max: "2", width: "20" }),
    ]),
    el("sheetData", {}, [
      el("row", { r: "1" }, [el("c", { r: "A1" }, [el("v", {}, [txt("1")])])]),
    ]),
    el("drawing", { "r:id": "rIdDrawing" }),
  ]);
  const relationship = (id: string, type: string, target: string) =>
    el("Relationship", { Id: id, Type: type, Target: target });
  return {
    parts: {
      "xl/workbook.xml": {
        kind: "xml",
        nodes: [
          el("workbook", {}, [
            el("sheets", {}, [
              el("sheet", { name: "Data", sheetId: "1", "r:id": "rIdSheet" }),
            ]),
          ]),
        ],
      },
      "xl/_rels/workbook.xml.rels": {
        kind: "xml",
        nodes: [
          el("Relationships", {}, [
            relationship(
              "rIdSheet",
              "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
              "worksheets/sheet1.xml",
            ),
          ]),
        ],
      },
      "xl/worksheets/sheet1.xml": { kind: "xml", nodes: [worksheet] },
      "xl/worksheets/_rels/sheet1.xml.rels": {
        kind: "xml",
        nodes: [
          el("Relationships", {}, [
            relationship(
              "rIdDrawing",
              "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing",
              "../drawings/drawing1.xml",
            ),
          ]),
        ],
      },
      "xl/drawings/drawing1.xml": { kind: "xml", nodes: [drawing] },
      "xl/drawings/_rels/drawing1.xml.rels": {
        kind: "xml",
        nodes: [
          el("Relationships", {}, [
            relationship(
              "rIdImage",
              "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
              "../media/image1.png",
            ),
          ]),
        ],
      },
      "xl/media/image1.png": { kind: "binary", base64: mediaBase64 },
    },
  };
}

describe("readXlsxContent: drawing pictures", () => {
  it("reads an xdr:pic into ContentSheet.images, media bytes sniffed and anchor fields plus frame resolved from the from/to markers", () => {
    const document = readXlsxContent(pictureDrawingPackage());
    if (document.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(document.sheets[0]?.images).toHaveLength(1);
    const image = document.sheets[0]?.images[0];
    expect(image?.kind).toBe("image");
    // The media part's own bytes decide the format, never the part's .png name -- the same contract as the pptx picture reader.
    expect(image?.format).toBe("png");
    expect(image?.base64).toBe(TINY_PNG_BASE64);
    expect(image?.anchorColumn).toBe(0);
    expect(image?.anchorRow).toBe(1);
    // Same anchor geometry as the chart row: anchored at column 0 offset 19050 EMU, row 1, spanning to the start of column 2 and row 4, size the difference of the two anchors.
    const col0 = columnWidthCharsToPt(10);
    const col1 = columnWidthCharsToPt(20);
    const offsetX = (19050 / 914400) * 72;
    expect(image?.offsetXPt).toBeCloseTo(offsetX, 5);
    expect(image?.offsetYPt).toBe(0);
    expect(image?.widthPt).toBeCloseTo(col0 + col1 - offsetX, 5);
    expect(image?.heightPt).toBeCloseTo(45, 5);
    // A drawing carrying only a picture, no chart graphic frame at all, leaves embeddedObjects absent rather than an empty array -- the same "undefined means none, [] means none for images specifically" split the module doc comment states.
    expect(document.sheets[0]?.embeddedObjects).toBeUndefined();
  });

  it("leaves a picture whose media bytes do not sniff as PNG/JPEG unread rather than emitting an unsniffable image", () => {
    const document = readXlsxContent(pictureDrawingPackage("aGVsbG8gd29ybGQ="));
    if (document.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(document.sheets[0]?.images).toEqual([]);
  });

  it("round-trips the whole document through ContentDocumentSchema, so the sheet image is schema-valid as read", () => {
    expect(
      ContentDocumentSchema.safeParse(readXlsxContent(pictureDrawingPackage()))
        .success,
    ).toBe(true);
  });

  it("survives the write pair: buildXlsxPackageFromContent writes a real drawing/media part pair, and reading it back recovers the same image (ExaDev/documents.js#973)", () => {
    const rewritten = readXlsxContent(
      decodePackage(
        encodePackage(
          buildXlsxPackageFromContent(readXlsxContent(pictureDrawingPackage())),
        ),
      ),
    );
    if (rewritten.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(rewritten.sheets[0]?.images).toHaveLength(1);
    const image = rewritten.sheets[0]?.images[0];
    expect(image?.format).toBe("png");
    expect(image?.base64).toBe(TINY_PNG_BASE64);
  });
});

// The oneCellAnchor spelling -- Excel's own "Move, but don't size with cells" anchoring for an inserted picture (the common real-producer spelling, per #776): a from-marker positions the frame through the grid geometry exactly as a two-cell anchor's from-marker does, and the anchor's own xdr:ext sizes it, which is the to-marker's job in the two-cell spelling.
function oneCellPicturePackage(extCx = "1828800", extCy = "914400"): Package {
  const picture = el("xdr:pic", {}, [
    el("xdr:nvPicPr", {}, [el("xdr:cNvPr", { id: "2", name: "Picture 1" })]),
    el("xdr:blipFill", {}, [el("a:blip", { "r:embed": "rIdImage" })]),
    el("xdr:spPr", {}, [
      el("a:xfrm", {}, [
        el("a:off", { x: "0", y: "0" }),
        el("a:ext", { cx: "0", cy: "0" }),
      ]),
      el("a:prstGeom", { prst: "rect" }, [el("a:avLst")]),
    ]),
  ]);
  const drawing = el("xdr:wsDr", {}, [
    el("xdr:oneCellAnchor", {}, [
      el("xdr:from", {}, [
        el("xdr:col", {}, [txt("0")]),
        el("xdr:colOff", {}, [txt("19050")]),
        el("xdr:row", {}, [txt("1")]),
        el("xdr:rowOff", {}, [txt("0")]),
      ]),
      el("xdr:ext", { cx: extCx, cy: extCy }),
      picture,
      el("xdr:clientData"),
    ]),
  ]);
  const worksheet = el("worksheet", {}, [
    el("cols", {}, [
      el("col", { min: "1", max: "1", width: "10" }),
      el("col", { min: "2", max: "2", width: "20" }),
    ]),
    el("sheetData", {}, [
      el("row", { r: "1" }, [el("c", { r: "A1" }, [el("v", {}, [txt("1")])])]),
    ]),
    el("drawing", { "r:id": "rIdDrawing" }),
  ]);
  const relationship = (id: string, type: string, target: string) =>
    el("Relationship", { Id: id, Type: type, Target: target });
  return {
    parts: {
      "xl/workbook.xml": {
        kind: "xml",
        nodes: [
          el("workbook", {}, [
            el("sheets", {}, [
              el("sheet", { name: "Data", sheetId: "1", "r:id": "rIdSheet" }),
            ]),
          ]),
        ],
      },
      "xl/_rels/workbook.xml.rels": {
        kind: "xml",
        nodes: [
          el("Relationships", {}, [
            relationship(
              "rIdSheet",
              "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
              "worksheets/sheet1.xml",
            ),
          ]),
        ],
      },
      "xl/worksheets/sheet1.xml": { kind: "xml", nodes: [worksheet] },
      "xl/worksheets/_rels/sheet1.xml.rels": {
        kind: "xml",
        nodes: [
          el("Relationships", {}, [
            relationship(
              "rIdDrawing",
              "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing",
              "../drawings/drawing1.xml",
            ),
          ]),
        ],
      },
      "xl/drawings/drawing1.xml": { kind: "xml", nodes: [drawing] },
      "xl/drawings/_rels/drawing1.xml.rels": {
        kind: "xml",
        nodes: [
          el("Relationships", {}, [
            relationship(
              "rIdImage",
              "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
              "../media/image1.png",
            ),
          ]),
        ],
      },
      "xl/media/image1.png": { kind: "binary", base64: TINY_PNG_BASE64 },
    },
  };
}

describe("readXlsxContent: drawing pictures (oneCellAnchor)", () => {
  it("reads an xdr:oneCellAnchor xdr:pic with its size from the anchor's own xdr:ext rather than a to-marker difference", () => {
    const document = readXlsxContent(oneCellPicturePackage());
    if (document.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(document.sheets[0]?.images).toHaveLength(1);
    const image = document.sheets[0]?.images[0];
    expect(image?.kind).toBe("image");
    expect(image?.format).toBe("png");
    expect(image?.base64).toBe(TINY_PNG_BASE64);
    // Position and anchor fields come from the from-marker exactly as in the two-cell spelling: column 0 offset 19050 EMU, row 1, no offset.
    expect(image?.anchorColumn).toBe(0);
    expect(image?.anchorRow).toBe(1);
    const offsetX = (19050 / 914400) * 72;
    expect(image?.offsetXPt).toBeCloseTo(offsetX, 5);
    expect(image?.offsetYPt).toBe(0);
    // The size is the anchor's own xdr:ext verbatim: 1828800 x 914400 EMU is 2 x 1 inches, 144 x 72 pt.
    expect(image?.widthPt).toBeCloseTo(144, 5);
    expect(image?.heightPt).toBeCloseTo(72, 5);
  });

  it("skips a one-cell picture whose ext size is not positive, the same degenerate-anchor guard the two-cell spelling has", () => {
    const document = readXlsxContent(oneCellPicturePackage("0", "914400"));
    if (document.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(document.sheets[0]?.images).toEqual([]);
  });

  it("round-trips the whole document through ContentDocumentSchema, so the one-cell-anchored sheet image is schema-valid as read", () => {
    expect(
      ContentDocumentSchema.safeParse(readXlsxContent(oneCellPicturePackage()))
        .success,
    ).toBe(true);
  });

  it("survives the write pair: buildXlsxPackageFromContent writes a real drawing/media part pair, and reading it back recovers the same image (ExaDev/documents.js#973)", () => {
    const rewritten = readXlsxContent(
      decodePackage(
        encodePackage(
          buildXlsxPackageFromContent(readXlsxContent(oneCellPicturePackage())),
        ),
      ),
    );
    if (rewritten.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(rewritten.sheets[0]?.images).toHaveLength(1);
    const image = rewritten.sheets[0]?.images[0];
    expect(image?.format).toBe("png");
    expect(image?.base64).toBe(TINY_PNG_BASE64);
  });
});

// The absoluteAnchor spelling: xdr:pos (x/y EMU, page-absolute) plus xdr:ext sizing, no markers at all. ContentSheetImage's anchor vocabulary is cell-relative, so the landing #776 decides on is the nearest-cell re-basing -- the grid geometry's own inverse maps the absolute position onto a containing column/row plus the offset within it, exactly the fields a from-marker spells directly. The fixture grid: column 0 is 10 chars (52.5 pt), column 1 is 20 chars (105 pt), rows default 15 pt; pos 762000 x 190500 EMU is 60 x 15 pt, so column 1 offset 7.5 pt (52.5 + 7.5 = 60) and row 1 offset 0 (15 sits exactly on the row-1 boundary).
function absolutePicturePackage(
  extCx = "1828800",
  extCy = "914400",
  posX = "762000",
  posY = "190500",
): Package {
  const picture = el("xdr:pic", {}, [
    el("xdr:nvPicPr", {}, [el("xdr:cNvPr", { id: "2", name: "Picture 1" })]),
    el("xdr:blipFill", {}, [el("a:blip", { "r:embed": "rIdImage" })]),
    el("xdr:spPr", {}, [
      el("a:xfrm", {}, [
        el("a:off", { x: "0", y: "0" }),
        el("a:ext", { cx: "0", cy: "0" }),
      ]),
      el("a:prstGeom", { prst: "rect" }, [el("a:avLst")]),
    ]),
  ]);
  const drawing = el("xdr:wsDr", {}, [
    el("xdr:absoluteAnchor", {}, [
      el("xdr:pos", { x: posX, y: posY }),
      el("xdr:ext", { cx: extCx, cy: extCy }),
      picture,
      el("xdr:clientData"),
    ]),
  ]);
  const worksheet = el("worksheet", {}, [
    el("cols", {}, [
      el("col", { min: "1", max: "1", width: "10" }),
      el("col", { min: "2", max: "2", width: "20" }),
    ]),
    el("sheetData", {}, [
      el("row", { r: "1" }, [el("c", { r: "A1" }, [el("v", {}, [txt("1")])])]),
    ]),
    el("drawing", { "r:id": "rIdDrawing" }),
  ]);
  const relationship = (id: string, type: string, target: string) =>
    el("Relationship", { Id: id, Type: type, Target: target });
  return {
    parts: {
      "xl/workbook.xml": {
        kind: "xml",
        nodes: [
          el("workbook", {}, [
            el("sheets", {}, [
              el("sheet", { name: "Data", sheetId: "1", "r:id": "rIdSheet" }),
            ]),
          ]),
        ],
      },
      "xl/_rels/workbook.xml.rels": {
        kind: "xml",
        nodes: [
          el("Relationships", {}, [
            relationship(
              "rIdSheet",
              "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
              "worksheets/sheet1.xml",
            ),
          ]),
        ],
      },
      "xl/worksheets/sheet1.xml": { kind: "xml", nodes: [worksheet] },
      "xl/worksheets/_rels/sheet1.xml.rels": {
        kind: "xml",
        nodes: [
          el("Relationships", {}, [
            relationship(
              "rIdDrawing",
              "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing",
              "../drawings/drawing1.xml",
            ),
          ]),
        ],
      },
      "xl/drawings/drawing1.xml": { kind: "xml", nodes: [drawing] },
      "xl/drawings/_rels/drawing1.xml.rels": {
        kind: "xml",
        nodes: [
          el("Relationships", {}, [
            relationship(
              "rIdImage",
              "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
              "../media/image1.png",
            ),
          ]),
        ],
      },
      "xl/media/image1.png": { kind: "binary", base64: TINY_PNG_BASE64 },
    },
  };
}

describe("readXlsxContent: drawing pictures (absoluteAnchor)", () => {
  it("reads an xdr:absoluteAnchor xdr:pic, its page-absolute position re-based into the cell anchor vocabulary through the grid geometry's own inverse", () => {
    const document = readXlsxContent(absolutePicturePackage());
    if (document.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(document.sheets[0]?.images).toHaveLength(1);
    const image = document.sheets[0]?.images[0];
    expect(image?.kind).toBe("image");
    expect(image?.format).toBe("png");
    // pos 60 pt sits 7.5 pt into column 1 (52.5 pt wide column 0 first); pos 15 pt sits exactly on the row-1 boundary, the same cell a from-marker row=1 rowOff=0 names.
    expect(image?.anchorColumn).toBe(1);
    expect(image?.anchorRow).toBe(1);
    expect(image?.offsetXPt).toBeCloseTo(7.5, 5);
    expect(image?.offsetYPt).toBe(0);
    // Size verbatim from xdr:ext: 1828800 x 914400 EMU is 144 x 72 pt.
    expect(image?.widthPt).toBeCloseTo(144, 5);
    expect(image?.heightPt).toBeCloseTo(72, 5);
  });

  it("skips an absolute picture whose ext size is not positive, the same degenerate-anchor guard the marker spellings have", () => {
    const document = readXlsxContent(absolutePicturePackage("1828800", "0"));
    if (document.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(document.sheets[0]?.images).toEqual([]);
  });

  it("locates a position sitting exactly on a column boundary as the start of the next column, not an offset into the previous one", () => {
    // Column 0 is 10 chars = columnWidthCharsToPt(10) pt exactly, i.e. that many EMU at 12700 EMU/pt -- pos x lands exactly on the column 0/1 boundary, pos y at 0 keeps the row/height math out of it entirely.
    const boundaryEmu = Math.round(columnWidthCharsToPt(10) * 12700);
    const document = readXlsxContent(
      absolutePicturePackage("1828800", "914400", String(boundaryEmu), "0"),
    );
    if (document.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    const image = document.sheets[0]?.images[0];
    // A position exactly at the boundary belongs to the column it starts (column 1, offset 0), not the tail end of column 0 (column 0, offset = the whole column width).
    expect(image?.anchorColumn).toBe(1);
    expect(image?.offsetXPt).toBeCloseTo(0, 5);
  });

  it("round-trips the whole document through ContentDocumentSchema, so the absolute-anchored sheet image is schema-valid as read", () => {
    expect(
      ContentDocumentSchema.safeParse(readXlsxContent(absolutePicturePackage()))
        .success,
    ).toBe(true);
  });

  it("survives the write pair: buildXlsxPackageFromContent writes a real drawing/media part pair, and reading it back recovers the same image (ExaDev/documents.js#973)", () => {
    const rewritten = readXlsxContent(
      decodePackage(
        encodePackage(
          buildXlsxPackageFromContent(
            readXlsxContent(absolutePicturePackage()),
          ),
        ),
      ),
    );
    if (rewritten.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(rewritten.sheets[0]?.images).toHaveLength(1);
    const image = rewritten.sheets[0]?.images[0];
    expect(image?.format).toBe("png");
    expect(image?.base64).toBe(TINY_PNG_BASE64);
  });
});

// The same absoluteAnchor carrying a chart graphic frame: the embedded object's frame keeps the page-absolute position verbatim (60 x 15 pt) while its anchor fields carry the same re-based cell the picture row lands on.
function absoluteChartPackage(): Package {
  const revenue = el("c:ser", {}, [
    el("c:tx", {}, [
      el("c:strRef", {}, [
        el("c:f", {}, [txt("Sheet1!$B$1")]),
        el("c:strCache", {}, [
          el("c:ptCount", { val: "1" }),
          el("c:pt", { idx: "0" }, [el("c:v", {}, [txt("Revenue")])]),
        ]),
      ]),
    ]),
    el("c:cat", {}, [
      el("c:strRef", {}, [
        el("c:strCache", {}, [
          el("c:ptCount", { val: "2" }),
          el("c:pt", { idx: "0" }, [el("c:v", {}, [txt("Q1")])]),
          el("c:pt", { idx: "1" }, [el("c:v", {}, [txt("Q2")])]),
        ]),
      ]),
    ]),
    el("c:val", {}, [
      el("c:numRef", {}, [
        el("c:numCache", {}, [
          el("c:ptCount", { val: "2" }),
          el("c:pt", { idx: "0" }, [el("c:v", {}, [txt("8.5")])]),
          el("c:pt", { idx: "1" }, [el("c:v", {}, [txt("12")])]),
        ]),
      ]),
    ]),
  ]);
  const chartSpace = el("c:chartSpace", {}, [
    el("c:chart", {}, [
      el("c:plotArea", {}, [el("c:barChart", {}, [revenue])]),
    ]),
  ]);
  const graphicFrame = el("xdr:graphicFrame", {}, [
    el("xdr:nvGraphicFramePr", {}, [
      el("xdr:cNvPr", { id: "2", name: "Chart 1" }),
    ]),
    el("a:graphic", {}, [
      el(
        "a:graphicData",
        { uri: "http://schemas.openxmlformats.org/drawingml/2006/chart" },
        [el("c:chart", { "r:id": "rIdChart" })],
      ),
    ]),
  ]);
  const drawing = el("xdr:wsDr", {}, [
    el("xdr:absoluteAnchor", {}, [
      el("xdr:pos", { x: "762000", y: "190500" }),
      el("xdr:ext", { cx: "1828800", cy: "914400" }),
      graphicFrame,
      el("xdr:clientData"),
    ]),
  ]);
  const worksheet = el("worksheet", {}, [
    el("cols", {}, [
      el("col", { min: "1", max: "1", width: "10" }),
      el("col", { min: "2", max: "2", width: "20" }),
    ]),
    el("sheetData", {}, [
      el("row", { r: "1" }, [el("c", { r: "A1" }, [el("v", {}, [txt("1")])])]),
    ]),
    el("drawing", { "r:id": "rIdDrawing" }),
  ]);
  const relationship = (id: string, type: string, target: string) =>
    el("Relationship", { Id: id, Type: type, Target: target });
  return {
    parts: {
      "xl/workbook.xml": {
        kind: "xml",
        nodes: [
          el("workbook", {}, [
            el("sheets", {}, [
              el("sheet", { name: "Data", sheetId: "1", "r:id": "rIdSheet" }),
            ]),
          ]),
        ],
      },
      "xl/_rels/workbook.xml.rels": {
        kind: "xml",
        nodes: [
          el("Relationships", {}, [
            relationship(
              "rIdSheet",
              "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
              "worksheets/sheet1.xml",
            ),
          ]),
        ],
      },
      "xl/worksheets/sheet1.xml": { kind: "xml", nodes: [worksheet] },
      "xl/worksheets/_rels/sheet1.xml.rels": {
        kind: "xml",
        nodes: [
          el("Relationships", {}, [
            relationship(
              "rIdDrawing",
              "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing",
              "../drawings/drawing1.xml",
            ),
          ]),
        ],
      },
      "xl/drawings/drawing1.xml": { kind: "xml", nodes: [drawing] },
      "xl/drawings/_rels/drawing1.xml.rels": {
        kind: "xml",
        nodes: [
          el("Relationships", {}, [
            relationship(
              "rIdChart",
              "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart",
              "../charts/chart1.xml",
            ),
          ]),
        ],
      },
      "xl/charts/chart1.xml": { kind: "xml", nodes: [chartSpace] },
    },
  };
}

describe("readXlsxContent: chart graphic frames (absoluteAnchor)", () => {
  it("reads an xdr:absoluteAnchor graphic frame, its frame at the pos verbatim and its anchor fields on the re-based cell", () => {
    const document = readXlsxContent(absoluteChartPackage());
    if (document.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(document.sheets[0]?.embeddedObjects).toHaveLength(1);
    const chart = document.sheets[0]?.embeddedObjects?.[0];
    expect(chart?.objectKind).toBe("chart");
    // The frame keeps the page-absolute position verbatim (762000 x 190500 EMU = 60 x 15 pt); the anchor fields name the same re-based cell the picture row lands on: column 1 offset 7.5 pt, row 1 offset 0.
    expect(chart?.frame.xPt).toBeCloseTo(60, 5);
    expect(chart?.frame.yPt).toBeCloseTo(15, 5);
    expect(chart?.frame.widthPt).toBeCloseTo(144, 5);
    expect(chart?.frame.heightPt).toBeCloseTo(72, 5);
    expect(chart?.anchorColumn).toBe(1);
    expect(chart?.anchorRow).toBe(1);
    expect(chart?.offsetXPt).toBeCloseTo(7.5, 5);
    expect(chart?.offsetYPt).toBe(0);
    expect(chart?.document.kind).toBe("spreadsheet");
  });

  it("round-trips the whole document through ContentDocumentSchema, so the absolute-anchored chart object is schema-valid as read", () => {
    expect(
      ContentDocumentSchema.safeParse(readXlsxContent(absoluteChartPackage()))
        .success,
    ).toBe(true);
  });
});

// One drawing part mixing all three anchor spellings over pictures (each resolving the same media part): the rows land in the part's own document order, not grouped by spelling -- the walk iterates the drawing's children once.
function mixedAnchorsPicturePackage(): Package {
  const picture = el("xdr:pic", {}, [
    el("xdr:nvPicPr", {}, [el("xdr:cNvPr", { id: "2", name: "Picture 1" })]),
    el("xdr:blipFill", {}, [el("a:blip", { "r:embed": "rIdImage" })]),
    el("xdr:spPr", {}, [
      el("a:xfrm", {}, [
        el("a:off", { x: "0", y: "0" }),
        el("a:ext", { cx: "0", cy: "0" }),
      ]),
      el("a:prstGeom", { prst: "rect" }, [el("a:avLst")]),
    ]),
  ]);
  const drawing = el("xdr:wsDr", {}, [
    el("xdr:oneCellAnchor", {}, [
      el("xdr:from", {}, [
        el("xdr:col", {}, [txt("0")]),
        el("xdr:colOff", {}, [txt("0")]),
        el("xdr:row", {}, [txt("2")]),
        el("xdr:rowOff", {}, [txt("0")]),
      ]),
      el("xdr:ext", { cx: "1828800", cy: "914400" }),
      picture,
      el("xdr:clientData"),
    ]),
    el("xdr:absoluteAnchor", {}, [
      el("xdr:pos", { x: "762000", y: "190500" }),
      el("xdr:ext", { cx: "1828800", cy: "914400" }),
      picture,
      el("xdr:clientData"),
    ]),
    el("xdr:twoCellAnchor", {}, [
      el("xdr:from", {}, [
        el("xdr:col", {}, [txt("0")]),
        el("xdr:colOff", {}, [txt("0")]),
        el("xdr:row", {}, [txt("3")]),
        el("xdr:rowOff", {}, [txt("0")]),
      ]),
      el("xdr:to", {}, [
        el("xdr:col", {}, [txt("1")]),
        el("xdr:colOff", {}, [txt("0")]),
        el("xdr:row", {}, [txt("4")]),
        el("xdr:rowOff", {}, [txt("0")]),
      ]),
      picture,
      el("xdr:clientData"),
    ]),
  ]);
  const worksheet = el("worksheet", {}, [
    el("cols", {}, [
      el("col", { min: "1", max: "1", width: "10" }),
      el("col", { min: "2", max: "2", width: "20" }),
    ]),
    el("sheetData", {}, [
      el("row", { r: "1" }, [el("c", { r: "A1" }, [el("v", {}, [txt("1")])])]),
    ]),
    el("drawing", { "r:id": "rIdDrawing" }),
  ]);
  const relationship = (id: string, type: string, target: string) =>
    el("Relationship", { Id: id, Type: type, Target: target });
  return {
    parts: {
      "xl/workbook.xml": {
        kind: "xml",
        nodes: [
          el("workbook", {}, [
            el("sheets", {}, [
              el("sheet", { name: "Data", sheetId: "1", "r:id": "rIdSheet" }),
            ]),
          ]),
        ],
      },
      "xl/_rels/workbook.xml.rels": {
        kind: "xml",
        nodes: [
          el("Relationships", {}, [
            relationship(
              "rIdSheet",
              "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
              "worksheets/sheet1.xml",
            ),
          ]),
        ],
      },
      "xl/worksheets/sheet1.xml": { kind: "xml", nodes: [worksheet] },
      "xl/worksheets/_rels/sheet1.xml.rels": {
        kind: "xml",
        nodes: [
          el("Relationships", {}, [
            relationship(
              "rIdDrawing",
              "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing",
              "../drawings/drawing1.xml",
            ),
          ]),
        ],
      },
      "xl/drawings/drawing1.xml": { kind: "xml", nodes: [drawing] },
      "xl/drawings/_rels/drawing1.xml.rels": {
        kind: "xml",
        nodes: [
          el("Relationships", {}, [
            relationship(
              "rIdImage",
              "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
              "../media/image1.png",
            ),
          ]),
        ],
      },
      "xl/media/image1.png": { kind: "binary", base64: TINY_PNG_BASE64 },
    },
  };
}

describe("readXlsxContent: drawing pictures (mixed anchor spellings)", () => {
  it("lands pictures from all three spellings in the drawing part's own document order, not grouped by spelling", () => {
    const document = readXlsxContent(mixedAnchorsPicturePackage());
    if (document.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(document.sheets[0]?.images.map((image) => image.anchorRow)).toEqual([
      2, 1, 3,
    ]);
    expect(
      document.sheets[0]?.images.map((image) => image.anchorColumn),
    ).toEqual([0, 1, 0]);
  });
});

// A drawing-bearing package for SheetGridGeometry and anchor-walk edge cases the fixtures above don't happen to exercise: the caller supplies the worksheet's own children (cols/sheetFormatPr/sheetData) and the drawing's own single anchor element directly, everything else (workbook, every relationship, the one media part) fixed to the same tiny PNG the picture fixtures above already use.
function customDrawingPackage(
  worksheetChildren: XmlNode[],
  anchor: XmlElement,
): Package {
  const worksheet = el("worksheet", {}, [
    ...worksheetChildren,
    el("drawing", { "r:id": "rIdDrawing" }),
  ]);
  const drawing = el("xdr:wsDr", {}, [anchor]);
  const relationship = (id: string, type: string, target: string) =>
    el("Relationship", { Id: id, Type: type, Target: target });
  return {
    parts: {
      "xl/workbook.xml": {
        kind: "xml",
        nodes: [
          el("workbook", {}, [
            el("sheets", {}, [
              el("sheet", { name: "Data", sheetId: "1", "r:id": "rIdSheet" }),
            ]),
          ]),
        ],
      },
      "xl/_rels/workbook.xml.rels": {
        kind: "xml",
        nodes: [
          el("Relationships", {}, [
            relationship(
              "rIdSheet",
              "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
              "worksheets/sheet1.xml",
            ),
          ]),
        ],
      },
      "xl/worksheets/sheet1.xml": { kind: "xml", nodes: [worksheet] },
      "xl/worksheets/_rels/sheet1.xml.rels": {
        kind: "xml",
        nodes: [
          el("Relationships", {}, [
            relationship(
              "rIdDrawing",
              "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing",
              "../drawings/drawing1.xml",
            ),
          ]),
        ],
      },
      "xl/drawings/drawing1.xml": { kind: "xml", nodes: [drawing] },
      "xl/drawings/_rels/drawing1.xml.rels": {
        kind: "xml",
        nodes: [
          el("Relationships", {}, [
            relationship(
              "rIdImage",
              "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
              "../media/image1.png",
            ),
            relationship(
              "rIdChart",
              "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart",
              "../charts/chart1.xml",
            ),
          ]),
        ],
      },
      "xl/media/image1.png": { kind: "binary", base64: TINY_PNG_BASE64 },
      "xl/charts/chart1.xml": {
        kind: "xml",
        nodes: [
          el("c:chartSpace", {}, [
            el("c:chart", {}, [el("c:plotArea", {}, [el("c:barChart", {})])]),
          ]),
        ],
      },
    },
  };
}

// A twoCellAnchor carrying a single xdr:pic, from col0/row0 (offset 0) to col1/row1 (offset 0) unless overridden -- the minimal shape for exercising SheetGridGeometry's own column/row reading via the resulting frame size, independent of the anchor-placement arithmetic the fixtures above already cover.
function onePicTwoCellAnchor(
  opts: {
    toCol?: number;
    toRow?: number;
    editAs?: string;
    fromColOffEmu?: number;
    fromRowOffEmu?: number;
    fromColNodes?: XmlNode[];
  } = {},
): XmlElement {
  const {
    toCol = 1,
    toRow = 1,
    editAs,
    fromColOffEmu = 0,
    fromRowOffEmu = 0,
    fromColNodes,
  } = opts;
  const picture = el("xdr:pic", {}, [
    el("xdr:nvPicPr", {}, [el("xdr:cNvPr", { id: "2", name: "Picture 1" })]),
    el("xdr:blipFill", {}, [el("a:blip", { "r:embed": "rIdImage" })]),
    el("xdr:spPr", {}, [
      el("a:xfrm", {}, [
        el("a:off", { x: "0", y: "0" }),
        el("a:ext", { cx: "914400", cy: "914400" }),
      ]),
      el("a:prstGeom", { prst: "rect" }, [el("a:avLst")]),
    ]),
  ]);
  return el("xdr:twoCellAnchor", editAs === undefined ? {} : { editAs }, [
    el("xdr:from", {}, [
      el("xdr:col", {}, fromColNodes ?? [txt("0")]),
      el("xdr:colOff", {}, [txt(String(fromColOffEmu))]),
      el("xdr:row", {}, [txt("0")]),
      el("xdr:rowOff", {}, [txt(String(fromRowOffEmu))]),
    ]),
    el("xdr:to", {}, [
      el("xdr:col", {}, [txt(String(toCol))]),
      el("xdr:colOff", {}, [txt("0")]),
      el("xdr:row", {}, [txt(String(toRow))]),
      el("xdr:rowOff", {}, [txt("0")]),
    ]),
    picture,
    el("xdr:clientData"),
  ]);
}

function imagesOf(pkg: Package): ContentSheet["images"] {
  const document = readXlsxContent(pkg);
  if (document.kind !== "spreadsheet") {
    throw new Error("expected a spreadsheet ContentDocument");
  }
  return document.sheets[0]?.images ?? [];
}

describe("readXlsxContent: SheetGridGeometry (synthetic packages)", () => {
  it("ignores a declared column range whose min is below 1, falling back to the default column width", () => {
    const images = imagesOf(
      customDrawingPackage(
        [
          el("cols", {}, [el("col", { min: "0", max: "1", width: "999" })]),
          el("sheetData", {}, []),
        ],
        onePicTwoCellAnchor({ toCol: 1 }),
      ),
    );
    // Column 0 must fall back to the default width, not the malformed range's huge declared one.
    expect(images[0]?.widthPt).toBeCloseTo(
      columnWidthCharsToPt(DEFAULT_COLUMN_WIDTH_CHARS),
      5,
    );
  });

  it("prefers a covering column range's own declared width over a narrower range with no width at all", () => {
    // Two declared ranges both cover column 0 -- an outer 1..5 range with no width (a real producer's habit for "these columns use the sheet default"), and an inner 1..1 range that actually states one. The inner range's real width must win, not the wider range's undefined one merely because .find() met it first.
    const images = imagesOf(
      customDrawingPackage(
        [
          el("cols", {}, [
            el("col", { min: "1", max: "5" }),
            el("col", { min: "1", max: "1", width: "40" }),
          ]),
          el("sheetData", {}, []),
        ],
        onePicTwoCellAnchor({ toCol: 1 }),
      ),
    );
    expect(images[0]?.widthPt).toBeCloseTo(columnWidthCharsToPt(40), 5);
  });

  it("reads a real sheetFormatPr defaultRowHeight rather than falling back to the built-in default", () => {
    const images = imagesOf(
      customDrawingPackage(
        [
          el("sheetFormatPr", { defaultRowHeight: "30" }),
          el("sheetData", {}, []),
        ],
        onePicTwoCellAnchor({ toRow: 1 }),
      ),
    );
    expect(images[0]?.heightPt).toBeCloseTo(30, 5);
  });

  it("reads a declared row's own height, offset by one from its 1-based r, in preference to the default", () => {
    const images = imagesOf(
      customDrawingPackage(
        [
          el("sheetFormatPr", { defaultRowHeight: "15" }),
          el("sheetData", {}, [el("row", { r: "1", ht: "50" })]),
        ],
        onePicTwoCellAnchor({ toRow: 1 }),
      ),
    );
    // r="1" names the FIRST row (0-based index 0) -- the very row this anchor spans, not the one after it.
    expect(images[0]?.heightPt).toBeCloseTo(50, 5);
  });

  it("ignores a declared row whose r is below 1, or whose ht does not parse, falling back to the default height", () => {
    const images = imagesOf(
      customDrawingPackage(
        [
          el("sheetFormatPr", { defaultRowHeight: "15" }),
          el("sheetData", {}, [
            el("row", { r: "0", ht: "999" }),
            el("row", { r: "1", ht: "not a number" }),
          ]),
        ],
        onePicTwoCellAnchor({ toRow: 1 }),
      ),
    );
    expect(images[0]?.heightPt).toBeCloseTo(15, 5);
  });

  it("defaults editAs to twoCell (sizing from the to-marker) when the attribute is absent, and reads it when present", () => {
    const defaulted = imagesOf(
      customDrawingPackage(
        [el("sheetData", {}, [])],
        onePicTwoCellAnchor({ toCol: 2 }),
      ),
    );
    // No editAs at all: sized from the to-marker difference (2 default-width columns), not the picture's own 1"x1" (72pt) xdr:ext.
    expect(defaulted[0]?.widthPt).toBeCloseTo(
      2 * columnWidthCharsToPt(DEFAULT_COLUMN_WIDTH_CHARS),
      5,
    );

    const oneCell = imagesOf(
      customDrawingPackage(
        [el("sheetData", {}, [])],
        onePicTwoCellAnchor({ toCol: 2, editAs: "oneCell" }),
      ),
    );
    // editAs="oneCell" on a twoCellAnchor (Excel's real spelling for "move but don't size with cells"): sized from the shape's own transform extent (1in = 72pt) instead, ignoring the to-marker entirely.
    expect(oneCell[0]?.widthPt).toBeCloseTo(72, 5);
  });

  it("never applies a declared column range to an index below its own min, even when that index is within the range's max", () => {
    const images = imagesOf(
      customDrawingPackage(
        [
          el("cols", {}, [el("col", { min: "3", max: "5", width: "999" })]),
          el("sheetData", {}, []),
        ],
        onePicTwoCellAnchor({ toCol: 1 }),
      ),
    );
    // Column 0 sits below the declared range's own min (2, 0-based) -- it must fall back to the default width, not the range's huge declared one merely because 0 <= the range's own max.
    expect(images[0]?.widthPt).toBeCloseTo(
      columnWidthCharsToPt(DEFAULT_COLUMN_WIDTH_CHARS),
      5,
    );
  });
});

describe("readXlsxContent: anchor marker fields (synthetic packages)", () => {
  it("reads a marker's own rowOff distinctly from its colOff, rather than one child tag's value doing double duty for both", () => {
    const images = imagesOf(
      customDrawingPackage(
        [el("sheetData", {}, [])],
        // Small enough to stay well inside the default 15pt row height, so the anchor's own height stays positive (4pt = 50800 EMU).
        onePicTwoCellAnchor({ fromRowOffEmu: 50_800 }),
      ),
    );
    // The row axis carries a real offset; the column axis stays at its own default (0).
    expect(images[0]?.offsetXPt).toBe(0);
    expect(images[0]?.offsetYPt).toBeCloseTo(4, 5);
  });

  it("extracts a marker child's numeric text past a non-text sibling node, rather than letting that sibling corrupt the joined value", () => {
    const images = imagesOf(
      customDrawingPackage(
        [el("sheetData", {}, [])],
        onePicTwoCellAnchor({
          fromColNodes: [{ type: "comment", value: "producer note" }, txt("5")],
          toCol: 6,
        }),
      ),
    );
    // The comment sibling contributes nothing to the joined text; the real numeric value is "5", not corrupted by whatever a non-text node's own placeholder text would join in as.
    expect(images[0]?.anchorColumn).toBe(5);
  });
});

describe("readXlsxContent: chart graphic frame structural gaps (synthetic packages)", () => {
  function chartGraphicFrame(
    opts: {
      withCNvPr?: boolean;
      name?: string;
      graphicUri?: string;
    } = {},
  ): XmlElement {
    const {
      withCNvPr = true,
      graphicUri = "http://schemas.openxmlformats.org/drawingml/2006/chart",
    } = opts;
    // "name" in opts (not a destructured default) distinguishes "caller omitted the option, use the real default" from "caller explicitly asked for no name attribute at all" -- a destructured default would treat {name: undefined} identically to {}, which defeats the one test below that needs a cNvPr with genuinely no name attribute.
    const name = "name" in opts ? opts.name : "Chart 1";
    const nvGraphicFramePrChildren = withCNvPr
      ? [
          el(
            "xdr:cNvPr",
            name === undefined ? { id: "2" } : { id: "2", name },
            [],
          ),
        ]
      : [];
    return el("xdr:graphicFrame", {}, [
      el("xdr:nvGraphicFramePr", {}, nvGraphicFramePrChildren),
      el("a:graphic", {}, [
        el("a:graphicData", { uri: graphicUri }, [
          el("c:chart", { "r:id": "rIdChart" }),
        ]),
      ]),
    ]);
  }

  function chartFrameAnchor(frame: XmlElement): XmlElement {
    return el("xdr:twoCellAnchor", {}, [
      el("xdr:from", {}, [
        el("xdr:col", {}, [txt("0")]),
        el("xdr:colOff", {}, [txt("0")]),
        el("xdr:row", {}, [txt("0")]),
        el("xdr:rowOff", {}, [txt("0")]),
      ]),
      el("xdr:to", {}, [
        el("xdr:col", {}, [txt("1")]),
        el("xdr:colOff", {}, [txt("0")]),
        el("xdr:row", {}, [txt("1")]),
        el("xdr:rowOff", {}, [txt("0")]),
      ]),
      frame,
      el("xdr:clientData"),
    ]);
  }

  function embeddedChartOf(pkg: Package) {
    const document = readXlsxContent(pkg);
    if (document.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    return document.sheets[0]?.embeddedObjects;
  }

  it("treats a graphicData whose uri names something other than a chart as carrying no embeddable content at all", () => {
    const objects = embeddedChartOf(
      customDrawingPackage(
        [el("sheetData", {}, [])],
        chartFrameAnchor(
          chartGraphicFrame({ graphicUri: "http://example.com/not-a-chart" }),
        ),
      ),
    );
    expect(objects).toBeUndefined();
  });

  it("names the payload sheet 'Chart' when the graphic frame carries no xdr:cNvPr at all", () => {
    const objects = embeddedChartOf(
      customDrawingPackage(
        [el("sheetData", {}, [])],
        chartFrameAnchor(chartGraphicFrame({ withCNvPr: false })),
      ),
    );
    const sheet =
      objects?.[0]?.document.kind === "spreadsheet"
        ? objects[0].document.sheets[0]
        : undefined;
    expect(sheet?.name).toBe("Chart");
  });

  it("names the payload sheet 'Chart' when xdr:cNvPr carries no name attribute", () => {
    const objects = embeddedChartOf(
      customDrawingPackage(
        [el("sheetData", {}, [])],
        chartFrameAnchor(chartGraphicFrame({ name: undefined })),
      ),
    );
    const sheet =
      objects?.[0]?.document.kind === "spreadsheet"
        ? objects[0].document.sheets[0]
        : undefined;
    expect(sheet?.name).toBe("Chart");
  });

  it("never resolves an unrelated relationship type as the worksheet's own drawing part, even when it sorts before the real one", () => {
    // A hyperlink relationship inserted before the genuine drawing relationship in the worksheet's own rels part -- resolveRelationships preserves declaration order, so a coverage-bearing loop that stops at the FIRST relationship regardless of type would resolve the hyperlink's own (nonsensical, non-drawing) target as if it were the drawing part.
    const relationship = (id: string, type: string, target: string) =>
      el("Relationship", { Id: id, Type: type, Target: target });
    const pkg = customDrawingPackage(
      [el("sheetData", {}, [])],
      chartFrameAnchor(chartGraphicFrame()),
    );
    const sheetRels = pkg.parts["xl/worksheets/_rels/sheet1.xml.rels"];
    if (sheetRels?.kind !== "xml") {
      throw new Error("expected the worksheet rels part to be xml");
    }
    const relationships = sheetRels.nodes[0];
    if (relationships?.type !== "element") {
      throw new Error("expected a Relationships root element");
    }
    pkg.parts["xl/worksheets/_rels/sheet1.xml.rels"] = {
      kind: "xml",
      nodes: [
        el("Relationships", {}, [
          relationship(
            "rIdHyperlink",
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
            "https://example.com",
          ),
          ...relationships.children,
        ]),
      ],
    };
    const objects = embeddedChartOf(pkg);
    expect(objects).toHaveLength(1);
  });
});

// dataValidation and conditionalFormatting rules, promoted to real vocabulary (ExaDev/documents.js#758) for every rule this package's schema names -- the two real-producer fixtures below exercise the structural read/write path; the synthetic packages further down exercise what is deliberately left un-promoted (an 'expression' cfRule, a dataValidation type this schema does not name) through the pre-existing anchor-cell residue mechanism.
function worksheetOnlyPackage(worksheet: ReturnType<typeof el>): Package {
  const workbook = el("workbook", {}, [
    el("sheets", {}, [
      el("sheet", { name: "Data", sheetId: "1", "r:id": "rIdSheet" }),
    ]),
  ]);
  const relsRoot = el("Relationships", {}, [
    el("Relationship", {
      Id: "rIdSheet",
      Type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
      Target: "worksheets/sheet1.xml",
    }),
  ]);
  return {
    parts: {
      "xl/workbook.xml": { kind: "xml", nodes: [workbook] },
      "xl/_rels/workbook.xml.rels": { kind: "xml", nodes: [relsRoot] },
      "xl/worksheets/sheet1.xml": { kind: "xml", nodes: [worksheet] },
    },
  };
}

describe("readXlsxContent: real-producer-validation-and-cellis.xlsx (real LibreOffice output)", () => {
  const document = readXlsxContent(
    loadFixture("real-producer-validation-and-cellis.xlsx"),
  );
  if (document.kind !== "spreadsheet") {
    throw new Error("expected a spreadsheet ContentDocument");
  }
  const sheet = document.sheets[0];
  if (sheet === undefined) {
    throw new Error("expected one sheet");
  }

  // The real fixture's own <alignment horizontal="general" vertical="bottom" textRotation="0" wrapText="false" indent="0" shrinkToFit="false"/> -- the "rest of the dxf" once font/fill are structurally absorbed into textColor/background, carried as the style's own residue (empty children serialise as an explicit open/close pair, not self-closing, matching buildXml's own convention elsewhere in this suite).
  const DXF_ALIGNMENT_RESIDUE = {
    format: "xlsx",
    xml: '<alignment horizontal="general" vertical="bottom" textRotation="0" wrapText="false" indent="0" shrinkToFit="false"></alignment>',
  } as const;

  it("promotes both cellIs rules sharing B1:B2, each resolving its own dxf into a textColor/background style", () => {
    expect(sheet.conditionalFormats).toEqual([
      {
        type: "cellIs",
        ranges: [{ startRow: 0, startColumn: 1, endRow: 1, endColumn: 1 }],
        priority: 2,
        operator: "greaterThan",
        formula1: "10",
        style: {
          textColor: { r: 0, g: 0.4, b: 0 },
          background: { r: 0.8, g: 1, b: 0.8 },
          source: DXF_ALIGNMENT_RESIDUE,
        },
      },
      {
        type: "cellIs",
        ranges: [{ startRow: 0, startColumn: 1, endRow: 1, endColumn: 1 }],
        priority: 3,
        operator: "greaterThan",
        formula1: "20",
        style: {
          textColor: { r: 0.8, g: 0, b: 0 },
          background: { r: 1, g: 0.8, b: 0.8 },
          source: DXF_ALIGNMENT_RESIDUE,
        },
      },
    ]);
  });

  it("promotes the list dataValidation over A1:B1, dropping its stray operator/formula2 (meaningless for 'list') and keeping showDropDown as attribute-level residue", () => {
    expect(sheet.dataValidations).toEqual([
      {
        ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 1 }],
        type: "list",
        formula1: '"A,B,C"',
        allowBlank: true,
        showErrorMessage: true,
        error: "Pick A, B or C.",
        source: {
          format: "xlsx",
          xml: '<dataValidation showDropDown="false"></dataValidation>',
        },
      },
    ]);
  });

  it("resolves B1's dual dataValidation+conditionalFormatting collision as BOTH structural, dropping the old anchor-cell residue entirely", () => {
    const a1 = sheet.cells.find((cell) => cell.row === 0 && cell.column === 0);
    const b1 = sheet.cells.find((cell) => cell.row === 0 && cell.column === 1);
    expect(a1?.source).toBeUndefined();
    expect(b1?.source).toBeUndefined();
  });
});

describe("readXlsxContent: real-producer-colorscale.xlsx (real LibreOffice output)", () => {
  const document = readXlsxContent(
    loadFixture("real-producer-colorscale.xlsx"),
  );
  if (document.kind !== "spreadsheet") {
    throw new Error("expected a spreadsheet ContentDocument");
  }
  const sheet = document.sheets[0];
  if (sheet === undefined) {
    throw new Error("expected one sheet");
  }

  it("promotes the colorScale rule over C1:C2 with its own inline cfvo/color stops (this fixture's cellIs pair is a known ODF round-trip artifact -- missing operator -- and is not asserted on here)", () => {
    const colorScale = sheet.conditionalFormats?.find(
      (format) => format.type === "colorScale",
    );
    expect(colorScale).toEqual({
      type: "colorScale",
      ranges: [{ startRow: 0, startColumn: 2, endRow: 1, endColumn: 2 }],
      priority: 4,
      stops: [
        { value: { type: "num", value: "0" }, color: { r: 1, g: 0, b: 0 } },
        { value: { type: "num", value: "0" }, color: { r: 0, g: 1, b: 0 } },
      ],
    });
  });

  it('parses a real multi-range sqref ("A1 C1") into BOTH ranges, not just the first -- the sqref bug fix', () => {
    expect(sheet.dataValidations).toEqual([
      {
        ranges: [
          { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 },
          { startRow: 0, startColumn: 2, endRow: 0, endColumn: 2 },
        ],
        type: "list",
        formula1: '"A,B,C"',
        allowBlank: true,
        showErrorMessage: true,
        error: "Pick A, B or C.",
        source: {
          format: "xlsx",
          xml: '<dataValidation showDropDown="false"></dataValidation>',
        },
      },
    ]);
  });
});

describe("readXlsxContent: dataValidation and conditionalFormatting -- what is NOT promoted still lands as anchor-cell residue (synthetic packages)", () => {
  function readFirstCellOf(worksheet: ReturnType<typeof el>) {
    const read = readXlsxContent(worksheetOnlyPackage(worksheet));
    if (read.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    return read.sheets[0]?.cells ?? [];
  }

  it("still quarantines an 'expression' cfRule verbatim on its anchor cell -- the one deliberate ECMA-376 member this union does not promote", () => {
    const cells = readFirstCellOf(
      el("worksheet", {}, [
        el("sheetData", {}, [
          el("row", { r: "1" }, [
            el("c", { r: "A1" }, [el("v", {}, [txt("5")])]),
          ]),
        ]),
        el("conditionalFormatting", { sqref: "A1:A2" }, [
          el("cfRule", { type: "expression", dxfId: "0", priority: "1" }, [
            el("formula", {}, [txt("1")]),
          ]),
        ]),
      ]),
    );
    const anchor = cells.find((cell) => cell.row === 0 && cell.column === 0);
    expect(anchor?.source).toEqual({
      format: "xlsx",
      xml: '<conditionalFormatting sqref="A1:A2"><cfRule type="expression" dxfId="0" priority="1"><formula>1</formula></cfRule></conditionalFormatting>',
    });
  });

  it("still quarantines a dataValidation whose type this package's schema does not name (ECMA-376's own 'none') verbatim on its anchor cell, materialising an empty cell to host it when none exists", () => {
    const cells = readFirstCellOf(
      el("worksheet", {}, [
        el("sheetData", {}, []),
        el("dataValidations", { count: "1" }, [
          el("dataValidation", { type: "none", sqref: "B2:D4" }),
        ]),
      ]),
    );
    const anchor = cells.find((cell) => cell.row === 1 && cell.column === 1);
    expect(anchor?.source).toEqual({
      format: "xlsx",
      xml: '<dataValidation type="none" sqref="B2:D4"></dataValidation>',
    });
    // The covered-but-not-anchor cells stay untouched: the sqref inside the residue names the whole range, so one copy reconstructs it.
    expect(
      cells.find((cell) => cell.row === 1 && cell.column === 2)?.source,
    ).toBeUndefined();
  });

  it("leaves a rule whose sqref is the empty string unattached, the same as one that does not parse at all", () => {
    const cells = readFirstCellOf(
      el("worksheet", {}, [
        el("sheetData", {}, []),
        el("dataValidations", { count: "1" }, [
          el("dataValidation", { type: "none", sqref: "" }),
        ]),
      ]),
    );
    expect(cells).toEqual([]);
  });

  it("materialises a residue-only anchor cell as kind empty with an empty displayText, not a placeholder marker string", () => {
    const cells = readFirstCellOf(
      el("worksheet", {}, [
        el("sheetData", {}, []),
        el("dataValidations", { count: "1" }, [
          el("dataValidation", { type: "none", sqref: "F6" }),
        ]),
      ]),
    );
    const anchor = cells.find((cell) => cell.row === 5 && cell.column === 5);
    expect(anchor).toMatchObject({ value: { kind: "empty" }, displayText: "" });
  });

  it("keeps the first residue-eligible rule when two anchor at the same cell -- one residue slot per cell -- and leaves a rule whose sqref does not parse unattached", () => {
    const cells = readFirstCellOf(
      el("worksheet", {}, [
        el("sheetData", {}, []),
        el("dataValidations", { count: "2" }, [
          el("dataValidation", { type: "none", sqref: "C3" }, [
            el("formula1", {}, [txt("a,b,c")]),
          ]),
          el("dataValidation", { type: "none", sqref: "C3:E5" }, [
            el("formula1", {}, [txt("x,y,z")]),
          ]),
        ]),
        el("dataValidations", { count: "1" }, [
          el("dataValidation", { type: "none", sqref: "not a ref" }),
        ]),
      ]),
    );
    const anchor = cells.find((cell) => cell.row === 2 && cell.column === 2);
    expect(anchor?.source?.xml).toContain("a,b,c");
    expect(cells.filter((cell) => cell.source !== undefined)).toHaveLength(1);
  });
});

// --- round-trip coverage for every rule type the real fixtures above do not happen to carry ------------------------

const ROUND_TRIP_PRINT_SETTINGS: ContentSheet["printSettings"] = {
  pageSize: PAGE_SIZE_LETTER,
  margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
  gridlines: false,
  headers: false,
  pageOrder: "downThenOver",
};

function roundTripSheet(
  sheet: Partial<ContentSheet> & Pick<ContentSheet, "name">,
): ContentSheet {
  const document: ContentDocument = {
    kind: "spreadsheet",
    metadata: {},
    sheets: [
      {
        cells: [],
        columns: [],
        rows: [],
        images: [],
        printSettings: ROUND_TRIP_PRINT_SETTINGS,
        ...sheet,
      },
    ],
  };
  const read = readXlsxContent(buildXlsxPackageFromContent(document));
  if (read.kind !== "spreadsheet") {
    throw new Error("expected a spreadsheet ContentDocument");
  }
  const roundTripped = read.sheets[0];
  if (roundTripped === undefined) {
    throw new Error("expected one sheet");
  }
  return roundTripped;
}

describe("buildXlsxPackageFromContent + readXlsxContent: dataValidation round trip, every type the real fixtures don't cover", () => {
  it("whole, operator between", () => {
    const validation: ContentSheetDataValidation = {
      ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
      type: "whole",
      operator: "between",
      formula1: "1",
      formula2: "10",
      allowBlank: true,
    };
    const sheet = roundTripSheet({
      name: "Sheet1",
      dataValidations: [validation],
    });
    expect(sheet.dataValidations).toEqual([validation]);
  });

  it("decimal, operator greaterThan, with error message fields", () => {
    const validation: ContentSheetDataValidation = {
      ranges: [{ startRow: 1, startColumn: 1, endRow: 1, endColumn: 1 }],
      type: "decimal",
      operator: "greaterThan",
      formula1: "0.5",
      showErrorMessage: true,
      errorTitle: "Bad value",
      error: "Enter a number greater than 0.5",
    };
    const sheet = roundTripSheet({
      name: "Sheet1",
      dataValidations: [validation],
    });
    expect(sheet.dataValidations).toEqual([validation]);
  });

  it("date, operator greaterThanOrEqual, with input message fields", () => {
    const validation: ContentSheetDataValidation = {
      ranges: [{ startRow: 2, startColumn: 0, endRow: 2, endColumn: 0 }],
      type: "date",
      operator: "greaterThanOrEqual",
      formula1: "45000",
      showInputMessage: true,
      promptTitle: "Date",
      prompt: "Enter a date on or after 2023-03-15",
    };
    const sheet = roundTripSheet({
      name: "Sheet1",
      dataValidations: [validation],
    });
    expect(sheet.dataValidations).toEqual([validation]);
  });

  it("time, operator lessThan, errorStyle warning", () => {
    const validation: ContentSheetDataValidation = {
      ranges: [{ startRow: 3, startColumn: 0, endRow: 3, endColumn: 0 }],
      type: "time",
      operator: "lessThan",
      formula1: "0.5",
      errorStyle: "warning",
    };
    const sheet = roundTripSheet({
      name: "Sheet1",
      dataValidations: [validation],
    });
    expect(sheet.dataValidations).toEqual([validation]);
  });

  it("textLength, operator lessThanOrEqual, errorStyle information", () => {
    const validation: ContentSheetDataValidation = {
      ranges: [{ startRow: 4, startColumn: 0, endRow: 4, endColumn: 0 }],
      type: "textLength",
      operator: "lessThanOrEqual",
      formula1: "50",
      errorStyle: "information",
    };
    const sheet = roundTripSheet({
      name: "Sheet1",
      dataValidations: [validation],
    });
    expect(sheet.dataValidations).toEqual([validation]);
  });

  it("custom, no operator, arbitrary formula", () => {
    const validation: ContentSheetDataValidation = {
      ranges: [{ startRow: 5, startColumn: 0, endRow: 5, endColumn: 0 }],
      type: "custom",
      formula1: "ISNUMBER(A6)",
    };
    const sheet = roundTripSheet({
      name: "Sheet1",
      dataValidations: [validation],
    });
    expect(sheet.dataValidations).toEqual([validation]);
  });
});

describe("buildXlsxPackageFromContent + readXlsxContent: conditionalFormat round trip, every rule family the real fixtures don't cover", () => {
  it("containsText, with a dxf-resolved textColor style", () => {
    const format: ContentSheetConditionalFormat = {
      type: "containsText",
      ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
      priority: 1,
      text: "foo",
      style: { textColor: { r: 1, g: 0, b: 0 } },
    };
    const sheet = roundTripSheet({
      name: "Sheet1",
      conditionalFormats: [format],
    });
    expect(sheet.conditionalFormats).toEqual([format]);
  });

  it("uniqueValues, the operand-free family, with stopIfTrue", () => {
    const format: ContentSheetConditionalFormat = {
      type: "uniqueValues",
      ranges: [{ startRow: 1, startColumn: 1, endRow: 2, endColumn: 1 }],
      priority: 2,
      stopIfTrue: true,
    };
    const sheet = roundTripSheet({
      name: "Sheet1",
      conditionalFormats: [format],
    });
    expect(sheet.conditionalFormats).toEqual([format]);
  });

  it("top10, with percent and a dxf-resolved background style", () => {
    const format: ContentSheetConditionalFormat = {
      type: "top10",
      ranges: [{ startRow: 0, startColumn: 3, endRow: 5, endColumn: 3 }],
      priority: 5,
      rank: 3,
      percent: true,
      style: { background: { r: 0, g: 1, b: 0 } },
    };
    const sheet = roundTripSheet({
      name: "Sheet1",
      conditionalFormats: [format],
    });
    expect(sheet.conditionalFormats).toEqual([format]);
  });

  it("aboveAverage, explicit false with equalAverage and stdDev", () => {
    const format: ContentSheetConditionalFormat = {
      type: "aboveAverage",
      ranges: [{ startRow: 0, startColumn: 4, endRow: 3, endColumn: 4 }],
      priority: 6,
      aboveAverage: false,
      equalAverage: true,
      stdDev: 2,
    };
    const sheet = roundTripSheet({
      name: "Sheet1",
      conditionalFormats: [format],
    });
    expect(sheet.conditionalFormats).toEqual([format]);
  });

  it("timePeriod, with a dxf-resolved textColor style", () => {
    const format: ContentSheetConditionalFormat = {
      type: "timePeriod",
      ranges: [{ startRow: 0, startColumn: 5, endRow: 0, endColumn: 5 }],
      priority: 7,
      timePeriod: "thisWeek",
      style: { textColor: { r: 0, g: 0, b: 1 } },
    };
    const sheet = roundTripSheet({
      name: "Sheet1",
      conditionalFormats: [format],
    });
    expect(sheet.conditionalFormats).toEqual([format]);
  });

  it("dataBar, min/max cfvo and an explicit showValue false", () => {
    const format: ContentSheetConditionalFormat = {
      type: "dataBar",
      ranges: [{ startRow: 0, startColumn: 6, endRow: 4, endColumn: 6 }],
      priority: 8,
      min: { type: "min" },
      max: { type: "max" },
      color: { r: 0, g: 1, b: 0 },
      showValue: false,
    };
    const sheet = roundTripSheet({
      name: "Sheet1",
      conditionalFormats: [format],
    });
    expect(sheet.conditionalFormats).toEqual([format]);
  });

  it("iconSet, a non-default iconSetType with reverse and showValue false", () => {
    const format: ContentSheetConditionalFormat = {
      type: "iconSet",
      ranges: [{ startRow: 0, startColumn: 7, endRow: 6, endColumn: 7 }],
      priority: 9,
      iconSetType: "3Arrows",
      thresholds: [
        { type: "percent", value: "0" },
        { type: "percent", value: "33" },
        { type: "percent", value: "67" },
      ],
      reverse: true,
      showValue: false,
    };
    const sheet = roundTripSheet({
      name: "Sheet1",
      conditionalFormats: [format],
    });
    expect(sheet.conditionalFormats).toEqual([format]);
  });
});
