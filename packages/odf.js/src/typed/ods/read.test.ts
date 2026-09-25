import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { PAGE_SIZE_A4 } from "document-schema.js";
import type { Package } from "../../model/package";
import { parsePackage } from "../../package-io/read";
import { parseOdfLength } from "../shared/units";
import {} from "../../test-support/document-tree";
import { readOdsContent } from "./read";

// This suite reads real, unmodified LibreOffice 26.2-generated .ods fixtures (src/typed/ods/fixtures/*.ods, built via a headless UNO Basic macro driving the SAME UNO calls the Calc UI itself uses — Format > Columns > Width, Format > Rows > Height, Format > Print Areas, Format > Page Style's Sheet tab — never hand-edited afterwards) rather than programmatically reconstructing the expected XML shapes, mirroring readOdtContent's own established convention: this reader's own design brief is explicit that print-settings attribute names and the repeat-row/repeat-column mechanism must each be proven against genuine producer output, not just this package's own idea of what that output looks like. A handful of narrow scope-boundary/hazard-proof tests at the end use small, synthetic, hand-built packages instead (via el/txt), since a genuinely million-row repeat isn't something worth shipping as a binary fixture when the exact real repeat count is already established (typed/shared/a1.test.ts, citing a real LibreOffice-shipped .ots template).

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadFixture(name: string): Package {
  const bytes = new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
  return parsePackage(bytes);
}

function knownLength(value: string): number {
  const parsed = parseOdfLength(value);
  if (parsed === undefined) {
    throw new Error(
      `test fixture error: "${value}" is not a valid ODF length literal`,
    );
  }
  return parsed;
}

// Column/row width fixtures compare at a coarser precision than image/frame geometry, since LibreOffice itself rounds column/row lengths to fewer digits on write.
const COARSE_LENGTH_PRECISION_DIGITS = 3;
const FINE_LENGTH_PRECISION_DIGITS = 6;

describe("readOdsContent: kitchen-sink.ods (real LibreOffice output)", () => {
  const { metadata, sheets } = readOdsContent(loadFixture("kitchen-sink.ods"));
  const data = sheets.find((sheet) => sheet.name === "Data");
  const summary = sheets.find((sheet) => sheet.name === "Summary");
  if (data === undefined || summary === undefined) {
    throw new Error("expected both a Data and a Summary sheet");
  }

  it("reads both sheets in native document order, no sldIdLst-style indirection to resolve", () => {
    expect(sheets.map((sheet) => sheet.name)).toEqual(["Data", "Summary"]);
  });

  it("reads document metadata via meta.xml", () => {
    expect(metadata.title).toBeUndefined(); // this fixture's own meta.xml was never touched by the build macro — no title was ever set.
  });

  describe("column widths and hidden columns (real style:table-column-properties, real table:visibility)", () => {
    it("reads real column widths in the exact units LibreOffice itself rounded them to", () => {
      const widths = data.columns.map((column) => column.widthPt);
      expect(widths[0]).toBeCloseTo(
        knownLength("3cm"),
        COARSE_LENGTH_PRECISION_DIGITS,
      );
      expect(widths[1]).toBeCloseTo(
        knownLength("2.499cm"),
        COARSE_LENGTH_PRECISION_DIGITS,
      );
      expect(widths[2]).toBeCloseTo(
        knownLength("2cm"),
        COARSE_LENGTH_PRECISION_DIGITS,
      );
      expect(widths[3]).toBeCloseTo(
        knownLength("2.6cm"),
        COARSE_LENGTH_PRECISION_DIGITS,
      );
    });

    it('marks column G (index 6, the Fee column) hidden via table:visibility="collapse"', () => {
      const feeColumnIndex = 6;
      const hiddenColumn = data.columns.find(
        (column) => column.index === feeColumnIndex,
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

    it('compresses two identically-styled columns into ONE ContentSheetColumn entry on the Summary sheet (real table:number-columns-repeated="2"), not two', () => {
      expect(summary.columns).toHaveLength(1);
      expect(summary.columns[0]).toMatchObject({ index: 0 });
    });
  });

  describe("row heights and hidden rows (real style:table-row-properties, real table:visibility)", () => {
    it("reads the header row and first data row's own explicit heights", () => {
      const headerRow = data.rows.find((row) => row.index === 0);
      const firstDataRow = data.rows.find((row) => row.index === 1);
      expect(headerRow?.heightPt).toBeCloseTo(
        knownLength("0.9cm"),
        COARSE_LENGTH_PRECISION_DIGITS,
      );
      expect(firstDataRow?.heightPt).toBeCloseTo(
        knownLength("0.6cm"),
        COARSE_LENGTH_PRECISION_DIGITS,
      );
    });

    it('marks row 10 (index 9, "Hidden Row Content") hidden via table:visibility="collapse", while its own real content still reads', () => {
      const hiddenRowIndex = 9;
      const hiddenRow = data.rows.find((row) => row.index === hiddenRowIndex);
      expect(hiddenRow?.hidden).toBe(true);
      const hiddenCell = data.cells.find(
        (cell) => cell.row === hiddenRowIndex && cell.column === 0,
      );
      expect(hiddenCell?.displayText).toBe("Hidden Row Content");
    });
  });

  describe("every office:value-type variant on row 2 (index 1)", () => {
    const cellAt = (column: number) => {
      const cell = data.cells.find(
        (candidate) => candidate.row === 1 && candidate.column === column,
      );
      if (cell === undefined) {
        throw new Error(`expected a cell at row 1, column ${column}`);
      }
      return cell;
    };

    it('reads a plain string cell (office:value-type="string", no office:string-value — the cell\'s own text:p content is the value)', () => {
      expect(cellAt(0).value).toEqual({ kind: "string", value: "Acme Corp" });
    });

    it('translates office:value-type="float" to kind "number" (NOT "float" — ContentCellValueSchema has no "float" member)', () => {
      const floatColumnIndex = 1;
      expect(cellAt(floatColumnIndex).value).toEqual({
        kind: "number",
        value: 1234.56,
      });
    });

    it("reads a boolean cell from office:boolean-value", () => {
      const booleanColumnIndex = 2;
      expect(cellAt(booleanColumnIndex).value).toEqual({
        kind: "boolean",
        value: true,
      });
    });

    it("reads a date cell's bare office:date-value string, unparsed", () => {
      const dateColumnIndex = 3;
      expect(cellAt(dateColumnIndex).value).toEqual({
        kind: "date",
        value: "2026-07-31",
      });
    });

    it("reads a time cell's bare office:time-value ISO-8601-duration string, unparsed", () => {
      const timeColumnIndex = 4;
      expect(cellAt(timeColumnIndex).value).toEqual({
        kind: "time",
        value: "PT14H30M00S",
      });
    });

    it("reads a percentage cell as its own fraction, not multiplied by 100", () => {
      const percentageColumnIndex = 5;
      expect(cellAt(percentageColumnIndex).value).toEqual({
        kind: "percentage",
        value: 0.4256,
      });
    });

    it("reads a currency cell with its real ISO currency code from office:currency", () => {
      const currencyColumnIndex = 6;
      expect(cellAt(currencyColumnIndex).value).toEqual({
        kind: "currency",
        value: 99.99,
        currency: "GBP",
      });
    });

    it("carries a real OpenFormula table:formula string verbatim, alongside its own cached numeric result", () => {
      const formulaColumnIndex = 7;
      const formulaCell = cellAt(formulaColumnIndex);
      expect(formulaCell.formula).toBe("of:=SUM([.B2:.B3])");
      expect(formulaCell.value).toEqual({ kind: "number", value: 1276.56 });
    });

    it('reads a genuine formula-error cell (=1/0) as kind "string" with an empty office:string-value — ODF itself has no "error" value-type — while still carrying the real #DIV/0! text as displayText', () => {
      const errorColumnIndex = 8;
      const errorCell = cellAt(errorColumnIndex);
      expect(errorCell.formula).toBe("of:=1/0");
      expect(errorCell.value).toEqual({ kind: "string", value: "" });
      expect(errorCell.displayText).toBe("#DIV/0!");
    });
  });

  describe("merged range (table:number-columns-spanned/table:number-rows-spanned, table:covered-table-cell)", () => {
    const anchorRow = 5;
    const anchorColumn = 0;
    const colSpan = 2;
    const rowSpan = 2;

    it("reads the anchor cell with its own colSpan/rowSpan and text", () => {
      const anchor = data.cells.find(
        (cell) => cell.row === anchorRow && cell.column === anchorColumn,
      );
      expect(anchor).toMatchObject({
        colSpan,
        rowSpan,
        displayText: "Merged Cell",
      });
    });

    it('emits nothing at all for the covered positions (B6, A7, B7) — no placeholder cell object, matching the repeat-hazard\'s "skip empty" rule', () => {
      expect(
        data.cells.find(
          (cell) => cell.row === anchorRow && cell.column === anchorColumn + 1,
        ),
      ).toBeUndefined();
      expect(
        data.cells.find(
          (cell) => cell.row === anchorRow + 1 && cell.column === anchorColumn,
        ),
      ).toBeUndefined();
      expect(
        data.cells.find(
          (cell) =>
            cell.row === anchorRow + 1 && cell.column === anchorColumn + 1,
        ),
      ).toBeUndefined();
    });
  });

  describe("cross-sheet formula", () => {
    it("carries a real cross-sheet OpenFormula reference verbatim and its own cached result", () => {
      const totalCell = summary.cells.find(
        (cell) => cell.row === 1 && cell.column === 1,
      );
      expect(totalCell?.formula).toBe("of:=SUM([Data.B2:.B3])");
      expect(totalCell?.value).toEqual({ kind: "number", value: 1276.56 });
    });
  });

  describe('print settings (real style:page-layout-properties, resolved through table:table -> style:style[family="table"] -> style:master-page-name)', () => {
    it("resolves the Data sheet's own explicit page size and margins", () => {
      expect(data.printSettings.pageSize.widthPt).toBeCloseTo(
        knownLength("21.001cm"),
        COARSE_LENGTH_PRECISION_DIGITS,
      );
      expect(data.printSettings.pageSize.heightPt).toBeCloseTo(
        knownLength("29.7cm"),
        COARSE_LENGTH_PRECISION_DIGITS,
      );
      expect(data.printSettings.margins.topPt).toBeCloseTo(
        knownLength("1.199cm"),
        COARSE_LENGTH_PRECISION_DIGITS,
      );
      expect(data.printSettings.margins.leftPt).toBeCloseTo(
        knownLength("1.499cm"),
        COARSE_LENGTH_PRECISION_DIGITS,
      );
    });

    it('parses table:print-ranges ("Data.A1:Data.I20") into 0-based row/column bounds', () => {
      expect(data.printSettings.printRange).toEqual({
        startRow: 0,
        startColumn: 0,
        endRow: 19,
        endColumn: 8,
      });
    });

    it('reads a percentage scale from style:scale-to="150%"', () => {
      const scalePercent = 150;
      expect(data.printSettings.scalePercent).toBe(scalePercent);
      expect(data.printSettings.fitToPages).toBeUndefined();
    });

    it("reads a fit-to-N-pages scale from style:scale-to-X/style:scale-to-Y on the Summary sheet", () => {
      expect(summary.printSettings.fitToPages).toEqual({ width: 1, height: 2 });
      expect(summary.printSettings.scalePercent).toBeUndefined();
    });

    it("reads repeat rows/columns from the REAL table:table-header-rows/table:table-header-columns wrapper elements — not a named range", () => {
      expect(data.printSettings.repeatRows).toEqual({ start: 0, end: 0 });
      expect(data.printSettings.repeatColumns).toEqual({ start: 0, end: 0 });
    });

    it('reads gridlines/headers from the style:print token list\'s "grid"/"headers" membership', () => {
      expect(data.printSettings.gridlines).toBe(true);
      expect(data.printSettings.headers).toBe(true);
      expect(summary.printSettings.gridlines).toBe(false);
      expect(summary.printSettings.headers).toBe(false);
    });

    it('reads page order: style:print-page-order="ltr" -> overThenDown (Data), "ttb" -> downThenOver (Summary)', () => {
      expect(data.printSettings.pageOrder).toBe("overThenDown");
      expect(summary.printSettings.pageOrder).toBe("downThenOver");
    });

    it("reads manual page breaks from fo:break-before=\"page\" on the row/column's own style, at the row/column's real index", () => {
      const rowBreakIndex = 15;
      const columnBreakIndex = 3;
      expect(data.printSettings.manualBreaks).toEqual({
        rows: [rowBreakIndex],
        columns: [columnBreakIndex],
      });
      expect(summary.printSettings.manualBreaks).toBeUndefined();
    });

    it("falls back to the default A4/2cm page geometry on the Summary sheet, whose own page style never had an explicit size set", () => {
      expect(summary.printSettings.pageSize.widthPt).toBeCloseTo(
        knownLength("21.001cm"),
        1,
      );
      expect(summary.printSettings.margins.topPt).toBeCloseTo(
        knownLength("2cm"),
        1,
      );
    });
  });
});

describe("readOdsContent: minimal.ods (real LibreOffice output, default/unmodified sheet)", () => {
  const { sheets } = readOdsContent(loadFixture("minimal.ods"));
  const sheet = sheets[0];
  if (sheet === undefined) {
    throw new Error("expected at least one sheet");
  }

  it("reads the single default sheet", () => {
    expect(sheets).toHaveLength(1);
    expect(sheet.name).toBe("Sheet1");
  });

  it("emits nothing for the sheet's own single, genuinely empty cell", () => {
    expect(sheet.cells).toEqual([]);
  });

  it("still reads one column/row entry each, from the real (untouched) default column/row style", () => {
    expect(sheet.columns).toHaveLength(1);
    expect(sheet.rows).toHaveLength(1);
    expect(sheet.columns[0]?.hidden).toBeUndefined();
    expect(sheet.rows[0]?.hidden).toBeUndefined();
  });

  it("reads LibreOffice's own real default print settings: no explicit page size/margins written at all, gridlines/headers off, down-then-over page order", () => {
    expect(sheet.printSettings.pageSize).toEqual(PAGE_SIZE_A4);
    expect(sheet.printSettings.margins.topPt).toBeCloseTo(
      knownLength("2cm"),
      COARSE_LENGTH_PRECISION_DIGITS,
    );
    expect(sheet.printSettings.gridlines).toBe(false);
    expect(sheet.printSettings.headers).toBe(false);
    expect(sheet.printSettings.pageOrder).toBe("downThenOver");
    expect(sheet.printSettings.printRange).toBeUndefined();
    expect(sheet.printSettings.scalePercent).toBeUndefined();
    expect(sheet.printSettings.fitToPages).toBeUndefined();
    expect(sheet.printSettings.repeatRows).toBeUndefined();
    expect(sheet.printSettings.repeatColumns).toBeUndefined();
    expect(sheet.printSettings.manualBreaks).toBeUndefined();
  });
});

// sheet-anchors.ods was built via a Java UNO client against a headless LibreOffice 26.2 (the same "drive the calls the UI itself makes" technique the other fixtures use — LibreOffice's own bundled Python cannot be launched directly on macOS 26, which kills it with a code-signing Launch Constraint Violation, and command-line `macro:///` dispatch never fired at all in this sandbox, so the Java UNO bridge shipped in LibreOffice's own Resources/java was used instead). Three real anchored drawings, saved with the calc8 filter and never hand-edited afterwards:
//   - an 8x8 PNG anchored TO CELL C5 (column index 2, row index 4), sized 3cm x 2cm, positioned 0.5cm/0.3cm past its anchor cell's own top-left, with a real UNO Title and Description set (svg:title/svg:desc);
//   - a LibreOffice Draw document embedded as an OLE object anchored TO CELL B8 (column index 1, row index 7), sized 4cm x 3cm, offset 0.2cm/0.1cm, containing one real orange rectangle;
//   - the same PNG anchored TO PAGE at an absolute 7cm/0.9cm, sized 1.5cm x 1cm.
describe("readOdsContent: sheet-anchors.ods (real LibreOffice output — anchored images and an embedded object)", () => {
  const { sheets } = readOdsContent(loadFixture("sheet-anchors.ods"));
  const sheet = sheets[0];
  if (sheet === undefined) {
    throw new Error("expected at least one sheet");
  }

  it("reads both anchored images — the page-anchored one (table:shapes, first in document order) then the cell-anchored one", () => {
    expect(sheet.images).toHaveLength(2);
    expect(sheet.images.map((image) => image.format)).toEqual(["png", "png"]);
  });

  it("resolves the cell-anchored image to its real anchor cell (C5) with its own cell-relative offsets, never a fabricated address attribute", () => {
    const anchorCellRow = 4;
    const anchored = sheet.images[1];
    expect(anchored?.anchorColumn).toBe(2);
    expect(anchored?.anchorRow).toBe(anchorCellRow);
    expect(anchored?.offsetXPt).toBeCloseTo(
      knownLength("0.5cm"),
      FINE_LENGTH_PRECISION_DIGITS,
    );
    expect(anchored?.offsetYPt).toBeCloseTo(
      knownLength("0.3cm"),
      FINE_LENGTH_PRECISION_DIGITS,
    );
  });

  it("sizes the cell-anchored image to its own frame, not to the source PNG's 8x8 native pixels", () => {
    expect(sheet.images[1]?.widthPt).toBeCloseTo(
      knownLength("3cm"),
      FINE_LENGTH_PRECISION_DIGITS,
    );
    expect(sheet.images[1]?.heightPt).toBeCloseTo(
      knownLength("2cm"),
      FINE_LENGTH_PRECISION_DIGITS,
    );
  });

  it("carries the image's real bytes through as base64, sniffed to png from its own magic bytes", () => {
    expect(sheet.images[1]?.base64.startsWith("iVBORw0KGgo")).toBe(true);
  });

  it("reads the frame's own svg:title as altText", () => {
    expect(sheet.images[1]?.altText).toBe("Chequered swatch");
  });

  it("reports the page-anchored image (a real table:shapes child) against cell (0, 0) with its absolute sheet coordinates carried through unchanged", () => {
    const pageAnchored = sheet.images[0];
    expect(pageAnchored?.anchorRow).toBe(0);
    expect(pageAnchored?.anchorColumn).toBe(0);
    expect(pageAnchored?.offsetXPt).toBeCloseTo(
      knownLength("7cm"),
      FINE_LENGTH_PRECISION_DIGITS,
    );
    expect(pageAnchored?.offsetYPt).toBeCloseTo(
      knownLength("0.9cm"),
      FINE_LENGTH_PRECISION_DIGITS,
    );
    expect(pageAnchored?.altText).toBeUndefined();
  });

  it("reads the embedded OLE object as a real, fully-read drawing ContentDocument — not a placeholder, and not its ObjectReplacements preview image", () => {
    expect(sheet.embeddedObjects).toHaveLength(1);
    const embedded = sheet.embeddedObjects?.[0];
    expect(embedded?.objectKind).toBe("drawing");
    expect(embedded?.document.kind).toBe("drawing");
    if (embedded?.document.kind !== "drawing") {
      throw new Error("expected a drawing ContentDocument");
    }
    const vectors = embedded.document.pages[0]?.vectors;
    expect(vectors).toHaveLength(1);
    const vector = vectors?.[0];
    if (vector?.kind !== "rect") {
      throw new Error("expected the embedded drawing's own rectangle");
    }
    const RGB_CHANNEL_MAX = 255;
    const quantizedGreen = 0x88;
    expect(vector.fill).toEqual({
      r: 1,
      g: quantizedGreen / RGB_CHANNEL_MAX,
      b: 0,
    });
  });

  it("reads the embedded object's own frame from the draw:frame, keeping the cell-relative coordinates the format itself states", () => {
    const frame = sheet.embeddedObjects?.[0]?.frame;
    expect(frame?.xPt).toBeCloseTo(
      knownLength("0.2cm"),
      FINE_LENGTH_PRECISION_DIGITS,
    );
    expect(frame?.yPt).toBeCloseTo(
      knownLength("0.1cm"),
      FINE_LENGTH_PRECISION_DIGITS,
    );
    expect(frame?.widthPt).toBeCloseTo(
      knownLength("4cm"),
      FINE_LENGTH_PRECISION_DIGITS,
    );
    expect(frame?.heightPt).toBeCloseTo(
      knownLength("3cm"),
      FINE_LENGTH_PRECISION_DIGITS,
    );
  });

  it("resolves the embedded object to its real anchor cell (B8) with the same cell-relative offsets an anchored image gets", () => {
    const anchorCellRow = 7;
    const embedded = sheet.embeddedObjects?.[0];
    expect(embedded?.anchorColumn).toBe(1);
    expect(embedded?.anchorRow).toBe(anchorCellRow);
    expect(embedded?.offsetXPt).toBeCloseTo(
      knownLength("0.2cm"),
      FINE_LENGTH_PRECISION_DIGITS,
    );
    expect(embedded?.offsetYPt).toBeCloseTo(
      knownLength("0.1cm"),
      FINE_LENGTH_PRECISION_DIGITS,
    );
  });

  it("never mistakes the embedded object's own ObjectReplacements preview for anchored picture content", () => {
    expect(
      sheet.images.some((image) => image.widthPt > knownLength("3.5cm")),
    ).toBe(false);
  });

  it("still reads the sheet's ordinary cell content alongside its drawings, and never materializes the drawing-only anchor cells as cells of their own", () => {
    expect(sheet.cells.map((cell) => cell.displayText)).toEqual([
      "Label",
      "Value",
      "Alpha",
      "42",
    ]);
  });

  it("leaves embeddedObjects undefined on a sheet that has none, rather than writing an empty array", () => {
    expect(
      readOdsContent(loadFixture("kitchen-sink.ods")).sheets[0]
        ?.embeddedObjects,
    ).toBeUndefined();
    expect(
      readOdsContent(loadFixture("kitchen-sink.ods")).sheets[0]?.images,
    ).toEqual([]);
  });
});

// sheet-formula.ods was built the same way as sheet-anchors.ods above (a Java UNO client against a headless LibreOffice 26.2, saved with the calc8 filter, never hand-edited afterwards): a one-sheet Calc document named "Formulas" carrying two ordinary cells and ONE real LibreOffice Math object — a com.sun.star.drawing.OLE2Shape with Math's own CLSID 078B7ABA-54FC-457F-8551-6147E776A997, its Formula property set to the StarMath expression "f(x) = {x^2} over {2} + sqrt {x}", anchored TO CELL C4 (column index 2, row index 3) at a 0.4cm/0.2cm cell-relative offset. Its saved shape confirms, on a genuinely produced file, everything typed/draw/embedded.ts's formula path is built on: the frame is an ordinary draw:frame with a draw:object href of "./Object 1" plus the usual ObjectReplacements preview sibling, the outer manifest declares "Object 1/" as application/vnd.oasis.opendocument.formula, and that sub-document's own content.xml is a BARE <math> root with no office:body (and, notably, no meta.xml part of its own at all).
describe("readOdsContent: sheet-formula.ods (real LibreOffice output — a Math object anchored to a cell)", () => {
  const { sheets } = readOdsContent(loadFixture("sheet-formula.ods"));
  const sheet = sheets[0];
  if (sheet === undefined) {
    throw new Error("expected at least one sheet");
  }

  it("reads the embedded Math object as a real formula ContentDocument, not as its ObjectReplacements preview image", () => {
    expect(sheet.images).toEqual([]);
    expect(sheet.embeddedObjects).toHaveLength(1);
    expect(sheet.embeddedObjects?.[0]?.objectKind).toBe("formula");
    expect(sheet.embeddedObjects?.[0]?.document.kind).toBe("formula");
  });

  it("carries the formula's real MathML through, with its own StarMath annotation — the same payload readOdfFormulaContent produces for a standalone .odf", () => {
    const document = sheet.embeddedObjects?.[0]?.document;
    if (document?.kind !== "formula") {
      throw new Error("expected a formula ContentDocument");
    }
    expect(document.formula.starMath).toBe("f(x) = {x^2} over {2} + sqrt {x}");
    // The MathML root's own children, exactly as read: one <semantics> wrapping the presentation MathML plus the annotation.
    const [semantics] = document.formula.mathml;
    if (semantics?.type !== "element") {
      throw new Error("expected a <semantics> element");
    }
    expect(semantics.tag).toBe("semantics");
    expect(
      semantics.children
        .filter((child) => child.type === "element")
        .map((child) => child.tag),
    ).toEqual(["mrow", "annotation"]);
  });

  it("resolves the formula object to its real anchor cell (C4) with its own cell-relative offsets", () => {
    const anchorCellRow = 3;
    const embedded = sheet.embeddedObjects?.[0];
    expect(embedded?.anchorColumn).toBe(2);
    expect(embedded?.anchorRow).toBe(anchorCellRow);
    expect(embedded?.offsetXPt).toBeCloseTo(
      knownLength("0.4cm"),
      FINE_LENGTH_PRECISION_DIGITS,
    );
    expect(embedded?.offsetYPt).toBeCloseTo(
      knownLength("0.2cm"),
      FINE_LENGTH_PRECISION_DIGITS,
    );
    expect(embedded?.frame.xPt).toBeCloseTo(
      knownLength("0.4cm"),
      FINE_LENGTH_PRECISION_DIGITS,
    );
    expect(embedded?.frame.yPt).toBeCloseTo(
      knownLength("0.2cm"),
      FINE_LENGTH_PRECISION_DIGITS,
    );
  });

  it("reads the frame at the size LibreOffice itself sized the rendered formula to, not at the size the OLE shape was created with", () => {
    // LibreOffice resizes a Math OLE object's own frame to its rendered formula: the shape was created 4cm x 2cm and saved as 2.701cm x 4.515cm.
    expect(sheet.embeddedObjects?.[0]?.frame.widthPt).toBeCloseTo(
      knownLength("2.701cm"),
      FINE_LENGTH_PRECISION_DIGITS,
    );
    expect(sheet.embeddedObjects?.[0]?.frame.heightPt).toBeCloseTo(
      knownLength("4.515cm"),
      FINE_LENGTH_PRECISION_DIGITS,
    );
  });

  it("reports empty metadata for a sub-document that ships no meta.xml of its own, rather than throwing", () => {
    expect(sheet.embeddedObjects?.[0]?.document.metadata).toEqual({});
  });

  it("still reads the sheet's ordinary cells alongside the formula, and never materializes the formula's own anchor cell as a cell of its own", () => {
    expect(sheet.name).toBe("Formulas");
    expect(sheet.cells.map((cell) => cell.displayText)).toEqual([
      "Quantity",
      "7",
    ]);
  });
});
