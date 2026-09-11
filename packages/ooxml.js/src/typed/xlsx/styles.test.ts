import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Package } from "../../model/package";
import { el } from "../../xml/fragment";
import { parsePackage } from "../../package-io/read";
import {
  CellFormatTable,
  DEFAULT_CELL_FORMAT_INDEX,
  GENERAL_NUM_FMT_ID,
  readCellFormatCodes,
  readCellStyles,
} from "./styles";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function stylesPackage(styleSheet: ReturnType<typeof el>): Package {
  return { parts: { "xl/styles.xml": { kind: "xml", nodes: [styleSheet] } } };
}

describe("readCellFormatCodes: real LibreOffice output (kitchen-sink.xlsx)", () => {
  const pkg = parsePackage(
    new Uint8Array(readFileSync(join(FIXTURES_DIR, "kitchen-sink.xlsx"))),
  );
  const codes = readCellFormatCodes(pkg);

  it("resolves one code per <cellXfs><xf>, in document order, so the index IS a cell's own s attribute", () => {
    expect(codes).toEqual([
      "General",
      '"TRUE";"TRUE";"FALSE"',
      "[$-809]yyyy\\-mm\\-dd",
      "[$-809]hh:mm:ss",
      "[$-809]0.00%",
      "[$GBP-809]#,##0.00",
      "General",
    ]);
  });

  it("decodes the XML entities a real formatCode attribute carries -- the quoted literals would tokenize as bare codes otherwise", () => {
    expect(codes[1]).not.toContain("&quot;");
  });
});

describe("readCellFormatCodes: the built-in table, the <numFmts> overlay, and the gaps", () => {
  it("resolves an id the file never declares from ECMA-376's own built-in table", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("cellXfs", {}, [
          el("xf", { numFmtId: "9" }),
          el("xf", { numFmtId: "14" }),
        ]),
      ]),
    );
    expect(readCellFormatCodes(pkg)).toEqual(["0%", "mm-dd-yy"]);
  });

  it("lets a producer-declared <numFmt> win UNCONDITIONALLY, even over an id inside the built-in range", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("numFmts", {}, [
          el("numFmt", { numFmtId: "9", formatCode: "[$USD-409]#,##0.00" }),
        ]),
        el("cellXfs", {}, [el("xf", { numFmtId: "9" })]),
      ]),
    );
    expect(readCellFormatCodes(pkg)).toEqual(["[$USD-409]#,##0.00"]);
  });

  it("treats an <xf> with no numFmtId at all as General (CT_Xf/@numFmtId's own schema default)", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [el("cellXfs", {}, [el("xf", {})])]),
    );
    expect(readCellFormatCodes(pkg)).toEqual(["General"]);
  });

  it("reports undefined -- not General -- for an id with no code anywhere (a reserved 23-36 id, or a dangling custom reference)", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("cellXfs", {}, [
          el("xf", { numFmtId: "30" }),
          el("xf", { numFmtId: "9999" }),
          el("xf", { numFmtId: "nonsense" }),
        ]),
      ]),
    );
    expect(readCellFormatCodes(pkg)).toEqual([undefined, undefined, undefined]);
  });

  it("reads an empty list for a package with no xl/styles.xml, and for a styleSheet with no <cellXfs>", () => {
    expect(readCellFormatCodes({ parts: {} })).toEqual([]);
    expect(
      readCellFormatCodes(stylesPackage(el("styleSheet", {}, []))),
    ).toEqual([]);
  });
});

describe("CellFormatTable: the write-side interner, mirroring SharedStringTable", () => {
  it("starts with the General default at index 0 and declares nothing until something is interned", () => {
    const table = new CellFormatTable();
    expect(table.cellFormats()).toEqual([GENERAL_NUM_FMT_ID]);
    expect(table.declarations()).toEqual([]);
    expect(table.intern({ kind: "builtin", id: GENERAL_NUM_FMT_ID })).toBe(
      DEFAULT_CELL_FORMAT_INDEX,
    );
    expect(table.cellFormats()).toEqual([GENERAL_NUM_FMT_ID]);
  });

  it("references a built-in format by its own id, declaring no <numFmt> for it", () => {
    const table = new CellFormatTable();
    expect(table.intern({ kind: "builtin", id: 10 })).toBe(1);
    expect(table.cellFormats()).toEqual([GENERAL_NUM_FMT_ID, 10]);
    expect(table.declarations()).toEqual([]);
  });

  it("assigns custom codes ids from 164 upward, the first id a file may declare for itself", () => {
    const table = new CellFormatTable();
    expect(table.intern({ kind: "custom", code: "yyyy\\-mm\\-dd" })).toBe(1);
    expect(
      table.intern({ kind: "custom", code: '"TRUE";"TRUE";"FALSE"' }),
    ).toBe(2);
    expect(table.declarations()).toEqual([
      { id: 164, code: "yyyy\\-mm\\-dd" },
      { id: 165, code: '"TRUE";"TRUE";"FALSE"' },
    ]);
    expect(table.cellFormats()).toEqual([GENERAL_NUM_FMT_ID, 164, 165]);
  });

  it("hands the same index back for a repeated format, interning one xf per FORMAT rather than one per request", () => {
    const table = new CellFormatTable();
    const first = table.intern({ kind: "custom", code: "[$GBP]#,##0.00" });
    expect(table.intern({ kind: "custom", code: "[$GBP]#,##0.00" })).toBe(
      first,
    );
    expect(table.intern({ kind: "builtin", id: 21 })).not.toBe(first);
    expect(table.intern({ kind: "builtin", id: 21 })).toBe(2);
    expect(table.cellFormats()).toEqual([GENERAL_NUM_FMT_ID, 164, 21]);
    expect(table.declarations()).toHaveLength(1);
  });

  it("keeps built-in ids and custom codes in separate key spaces, so a code that looks like an id cannot collide with one", () => {
    const table = new CellFormatTable();
    expect(table.intern({ kind: "builtin", id: 4 })).toBe(1);
    expect(table.intern({ kind: "custom", code: "4" })).toBe(2);
    expect(table.cellFormats()).toEqual([GENERAL_NUM_FMT_ID, 4, 164]);
  });
});

// --- readCellStyles: the richer per-cellXfs entry carrying decoration alongside the number format ---

describe("readCellStyles: per-cellXfs background/borders/alignment (synthetic style sheets)", () => {
  it("resolves a solid fill, per-edge borders, and inline alignment off the one <xf> a cell's s attribute indexes", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("fills", {}, [
          el("fill", {}, [el("patternFill", { patternType: "none" })]),
          el("fill", {}, [el("patternFill", { patternType: "gray125" })]),
          el("fill", {}, [
            el("patternFill", { patternType: "solid" }, [
              el("fgColor", { rgb: "FFFF0000" }),
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
            el("right", { style: "mediumDashed" }, [
              el("color", { rgb: "FF0000FF" }),
            ]),
            el("top", { style: "double" }, [el("color", { rgb: "FF00FF00" })]),
            el("bottom"),
            el("diagonal"),
          ]),
        ]),
        el("cellXfs", {}, [
          el("xf", { numFmtId: "0" }),
          el("xf", { numFmtId: "0", fillId: "2", borderId: "1" }, [
            el("alignment", { horizontal: "right", vertical: "top" }),
          ]),
        ]),
      ]),
    );
    const entries = readCellStyles(pkg);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({ numberFormatCode: "General" });
    expect(entries[1]).toEqual({
      numberFormatCode: "General",
      background: { kind: "solid", color: { r: 1, g: 0, b: 0 } },
      // thin solid left at 0.75pt, mediumDashed right at 1.5pt with style 'dashed', double top at 0.75pt with style 'double'
      borders: {
        left: { color: { r: 0, g: 0, b: 0 }, widthPt: 0.75 },
        right: { color: { r: 0, g: 0, b: 1 }, widthPt: 1.5, style: "dashed" },
        top: { color: { r: 0, g: 1, b: 0 }, widthPt: 0.75, style: "double" },
      },
      alignment: "right",
      verticalAlignment: "top",
    });
  });

  it("reads a genuine two-colour pattern fill instead of dropping it (ExaDev/documents.js#951)", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("fills", {}, [
          el("fill", {}, [el("patternFill", { patternType: "none" })]),
          el("fill", {}, [el("patternFill", { patternType: "gray125" })]),
          el("fill", {}, [
            el("patternFill", { patternType: "mediumGray" }, [
              el("fgColor", { rgb: "FFFF0000" }),
              el("bgColor", { rgb: "FF0000FF" }),
            ]),
          ]),
        ]),
        el("cellXfs", {}, [
          el("xf", { numFmtId: "0" }),
          el("xf", { numFmtId: "0", fillId: "2" }),
        ]),
      ]),
    );
    const entries = readCellStyles(pkg);
    expect(entries[1]?.background).toEqual({
      kind: "pattern",
      patternType: "mediumGray",
      foregroundColor: { r: 1, g: 0, b: 0 },
      backgroundColor: { r: 0, g: 0, b: 1 },
    });
  });

  it('reads no background for patternType="none"', () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("fills", {}, [
          el("fill", {}, [el("patternFill", { patternType: "none" })]),
        ]),
        el("cellXfs", {}, [el("xf", { numFmtId: "0", fillId: "0" })]),
      ]),
    );
    expect(readCellStyles(pkg)[0]?.background).toBeUndefined();
  });

  it("reads an empty entry for a styleSheet with no fills/borders and an unstyled <xf>", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [el("cellXfs", {}, [el("xf", { numFmtId: "0" })])]),
    );
    expect(readCellStyles(pkg)).toEqual([{ numberFormatCode: "General" }]);
  });

  it("reports an out-of-range fillId/borderId as no decoration rather than throwing", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("cellXfs", {}, [
          el("xf", { numFmtId: "0", fillId: "99", borderId: "99" }),
        ]),
      ]),
    );
    expect(readCellStyles(pkg)).toEqual([{ numberFormatCode: "General" }]);
  });

  it('collapses the dash-dot border tokens onto style "dashed" -- the closest ContentStrokeStyle member', () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("borders", {}, [
          el("border", {}, [
            el("left", { style: "dashDot" }, [
              el("color", { rgb: "FF000000" }),
            ]),
            el("right"),
            el("top"),
            el("bottom"),
            el("diagonal"),
          ]),
        ]),
        el("cellXfs", {}, [el("xf", { numFmtId: "0", borderId: "0" })]),
      ]),
    );
    const entry = readCellStyles(pkg)[0];
    if (entry === undefined) {
      throw new Error("expected a cell style entry");
    }
    expect(entry.borders?.left).toEqual({
      color: { r: 0, g: 0, b: 0 },
      widthPt: 0.75,
      style: "dashed",
    });
  });

  it("readCellFormatCodes still returns just the codes (the numFmt-only projection of readCellStyles)", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("fills", {}, [
          el("fill", {}, [
            el("patternFill", { patternType: "solid" }, [
              el("fgColor", { rgb: "FFFF0000" }),
            ]),
          ]),
        ]),
        el("cellXfs", {}, [el("xf", { numFmtId: "0", fillId: "0" })]),
      ]),
    );
    expect(readCellFormatCodes(pkg)).toEqual(["General"]);
  });
});

// --- CellFormatTable: the write-side decoration interning ---

describe("CellFormatTable: interning decoration alongside the number format", () => {
  it("emits the two reserved fills (none/gray125) plus one solid fill per distinct background colour", () => {
    const table = new CellFormatTable();
    table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { background: { kind: "solid", color: { r: 1, g: 0, b: 0 } } },
    );
    expect(table.fillDeclarations()).toEqual([
      { kind: "none" },
      { kind: "gray125" },
      { kind: "solid", rgb: "ff0000" },
    ]);
  });

  it("interns a genuine two-colour pattern fill instead of dropping it (ExaDev/documents.js#951)", () => {
    const table = new CellFormatTable();
    table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      {
        background: {
          kind: "pattern",
          patternType: "darkTrellis",
          foregroundColor: { r: 1, g: 0, b: 0 },
          backgroundColor: { r: 0, g: 0, b: 1 },
        },
      },
    );
    expect(table.fillDeclarations()).toEqual([
      { kind: "none" },
      { kind: "gray125" },
      {
        kind: "pattern",
        patternType: "darkTrellis",
        fgRgb: "ff0000",
        bgRgb: "0000ff",
      },
    ]);
  });

  it("mints a real cell fill for patternType 'gray125', distinct from the reserved scaffolding entry of the same name", () => {
    const table = new CellFormatTable();
    table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      {
        background: {
          kind: "pattern",
          patternType: "gray125",
          foregroundColor: { r: 0, g: 0, b: 0 },
        },
      },
    );
    expect(table.fillDeclarations()).toEqual([
      { kind: "none" },
      { kind: "gray125" },
      { kind: "pattern", patternType: "gray125", fgRgb: "000000" },
    ]);
  });

  it("references the reserved empty border at index 0, then one real border per distinct edge set", () => {
    const table = new CellFormatTable();
    table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { borders: { left: { color: { r: 0, g: 0, b: 0 }, widthPt: 0.75 } } },
    );
    expect(table.borderDeclarations()).toEqual([
      { edges: {} },
      { edges: { left: { style: "thin", rgb: "000000" } } },
    ]);
  });

  it("buckets a ContentBorder width back to a named weight: 1.5pt solid -> medium", () => {
    const table = new CellFormatTable();
    table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { borders: { top: { color: { r: 0, g: 0, b: 0 }, widthPt: 1.5 } } },
    );
    expect(table.borderDeclarations()[1]).toEqual({
      edges: { top: { style: "medium", rgb: "000000" } },
    });
  });

  it("writes a dashed border at medium weight as mediumDashed", () => {
    const table = new CellFormatTable();
    table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      {
        borders: {
          bottom: {
            color: { r: 0, g: 0, b: 0 },
            widthPt: 1.5,
            style: "dashed",
          },
        },
      },
    );
    expect(table.borderDeclarations()[1]).toEqual({
      edges: { bottom: { style: "mediumDashed", rgb: "000000" } },
    });
  });

  it("carries horizontal/vertical alignment on the cellFormatRecord and deduplicates identical format+decoration", () => {
    const table = new CellFormatTable();
    const first = table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { alignment: "center", verticalAlignment: "middle" },
    );
    expect(first).toBe(1);
    expect(
      table.intern(
        { kind: "builtin", id: GENERAL_NUM_FMT_ID },
        { alignment: "center", verticalAlignment: "middle" },
      ),
    ).toBe(first);
    const records = table.cellFormatRecords();
    expect(records[first]).toEqual({
      numFmtId: GENERAL_NUM_FMT_ID,
      fontId: 0,
      fillId: 0,
      borderId: 0,
      alignment: { horizontal: "center", vertical: "middle" },
    });
  });

  it("keeps the default xf at index 0 free of decoration, so undecorated cells still share it", () => {
    const table = new CellFormatTable();
    expect(table.intern({ kind: "builtin", id: GENERAL_NUM_FMT_ID })).toBe(
      DEFAULT_CELL_FORMAT_INDEX,
    );
    expect(table.cellFormatRecords()[0]).toEqual({
      numFmtId: GENERAL_NUM_FMT_ID,
      fontId: 0,
      fillId: 0,
      borderId: 0,
    });
  });
});

// --- the cell font: read-side diffing against the workbook's own default font ---

describe("readCellStyles: the cell font, diffed against <fonts> entry 0", () => {
  it("states only the properties that genuinely differ from the workbook's own default font", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("fonts", {}, [
          el("font", {}, [
            el("sz", { val: "11" }),
            el("name", { val: "Calibri" }),
          ]),
          el("font", {}, [
            el("b"),
            el("i"),
            el("strike"),
            el("sz", { val: "14" }),
            el("name", { val: "Courier New" }),
            el("color", { rgb: "FFFF0000" }),
          ]),
        ]),
        el("cellXfs", {}, [
          el("xf", { numFmtId: "0", fontId: "0" }),
          el("xf", { numFmtId: "0", fontId: "1" }),
        ]),
      ]),
    );
    const entries = readCellStyles(pkg);
    expect(entries[0]?.font).toBeUndefined();
    expect(entries[1]?.font).toEqual({
      bold: true,
      italic: true,
      strike: true,
      sizePt: 14,
      fontFamily: "Courier New",
      color: { r: 1, g: 0, b: 0 },
    });
  });

  it("states bold: false for a cell font whose only difference is turning the default's bold off", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("fonts", {}, [
          el("font", {}, [el("b"), el("name", { val: "Calibri" })]),
          el("font", {}, [el("name", { val: "Calibri" })]),
        ]),
        el("cellXfs", {}, [el("xf", { numFmtId: "0", fontId: "1" })]),
      ]),
    );
    expect(readCellStyles(pkg)[0]?.font).toEqual({ bold: false });
  });

  it("states underline: true for any named underline style, and nothing for u val=none", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("fonts", {}, [
          el("font", {}, [el("name", { val: "Calibri" })]),
          el("font", {}, [
            el("u", { val: "double" }),
            el("name", { val: "Calibri" }),
          ]),
          el("font", {}, [
            el("u", { val: "none" }),
            el("name", { val: "Calibri" }),
          ]),
        ]),
        el("cellXfs", {}, [
          el("xf", { numFmtId: "0", fontId: "1" }),
          el("xf", { numFmtId: "0", fontId: "2" }),
        ]),
      ]),
    );
    const entries = readCellStyles(pkg);
    expect(entries[0]?.font).toEqual({ underline: true });
    expect(entries[1]?.font).toBeUndefined();
  });

  it("leaves a theme- or indexed-carried colour unstated, matching the fill/border colour policy", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("fonts", {}, [
          el("font", {}, [el("name", { val: "Calibri" })]),
          el("font", {}, [
            el("color", { theme: "1" }),
            el("name", { val: "Calibri" }),
          ]),
        ]),
        el("cellXfs", {}, [el("xf", { numFmtId: "0", fontId: "1" })]),
      ]),
    );
    expect(readCellStyles(pkg)[0]?.font).toBeUndefined();
  });

  it("reads past a <vertAlign> ContentFont has no member for, stating the differences it can", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("fonts", {}, [
          el("font", {}, [el("name", { val: "Calibri" })]),
          el("font", {}, [
            el("vertAlign", { val: "superscript" }),
            el("b"),
            el("name", { val: "Calibri" }),
          ]),
        ]),
        el("cellXfs", {}, [el("xf", { numFmtId: "0", fontId: "1" })]),
      ]),
    );
    expect(readCellStyles(pkg)[0]?.font).toEqual({ bold: true });
  });

  it("states no font for an out-of-range fontId or a workbook with no <fonts> table", () => {
    const outOfRange = stylesPackage(
      el("styleSheet", {}, [
        el("cellXfs", {}, [el("xf", { numFmtId: "0", fontId: "99" })]),
      ]),
    );
    expect(readCellStyles(outOfRange)[0]?.font).toBeUndefined();
    expect(readCellStyles(stylesPackage(el("styleSheet", {}, [])))).toEqual([]);
  });
});

// --- the cell font: write-side interning ---

describe("CellFormatTable: interning the cell font alongside the number format", () => {
  it("always carries the default Calibri-11 font at index 0, and a font normalising back to it references that entry", () => {
    const table = new CellFormatTable();
    expect(table.fontDeclarations()).toEqual([{ sz: "11", name: "Calibri" }]);
    expect(
      table.intern(
        { kind: "builtin", id: GENERAL_NUM_FMT_ID },
        { font: { bold: false } },
      ),
    ).toBe(DEFAULT_CELL_FORMAT_INDEX);
    // bold: false against THIS writer's not-bold entry 0 is a restatement of the default, so nothing was minted.
    expect(table.fontDeclarations()).toEqual([{ sz: "11", name: "Calibri" }]);
  });

  it("mints one entry per distinct font and deduplicates identical ones", () => {
    const table = new CellFormatTable();
    const boldRed = table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { font: { bold: true, color: { r: 1, g: 0, b: 0 } } },
    );
    expect(
      table.intern(
        { kind: "builtin", id: GENERAL_NUM_FMT_ID },
        { font: { bold: true, color: { r: 1, g: 0, b: 0 } } },
      ),
    ).toBe(boldRed);
    expect(table.fontDeclarations()).toEqual([
      { sz: "11", name: "Calibri" },
      { bold: true, colorRgb: "ff0000", sz: "11", name: "Calibri" },
    ]);
    const courierBig = table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { font: { fontFamily: "Courier New", sizePt: 14, strike: true } },
    );
    expect(courierBig).not.toBe(boldRed);
    expect(table.fontDeclarations()[2]).toEqual({
      strike: true,
      sz: "14",
      name: "Courier New",
    });
  });

  it("carries fontId on the cellFormatRecord, distinct from the default font's 0", () => {
    const table = new CellFormatTable();
    const index = table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { font: { italic: true } },
    );
    expect(table.cellFormatRecords()[index]).toEqual({
      numFmtId: GENERAL_NUM_FMT_ID,
      fontId: 1,
      fillId: 0,
      borderId: 0,
    });
  });
});
