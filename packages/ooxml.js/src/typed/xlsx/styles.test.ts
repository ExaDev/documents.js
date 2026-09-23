import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ContentCellFill } from "document-schema.js";
import type { Package } from "../../model/package";
import { el } from "../../xml/fragment";
import { parsePackage } from "../../package-io/read";
import {
  CellFormatTable,
  DEFAULT_CELL_FORMAT_INDEX,
  GENERAL_NUM_FMT_ID,
  colorFromElement,
  readCellFormatCodes,
  readCellStyles,
  readColorRgb,
} from "./styles";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function stylesPackage(styleSheet: ReturnType<typeof el>): Package {
  return { parts: { "xl/styles.xml": { kind: "xml", nodes: [styleSheet] } } };
}

// True precisely when `key` is an own property of `obj`, regardless of whether its value is `undefined` — unlike `toBeUndefined()`, which is satisfied identically by a key holding `undefined` and by the key's own absence, and so cannot distinguish "never assigned" from "assigned undefined". Several of this module's own optional-field copies are guarded by a presence check specifically to avoid ever assigning the key at all when the source has nothing to offer, and only a key-existence assertion can prove that guard is doing real work.
function hasOwn(obj: object, key: string): boolean {
  return Object.hasOwn(obj, key);
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

  it("decodes the XML entities a real formatCode attribute carries — the quoted literals would tokenize as bare codes otherwise", () => {
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

  it("reports undefined — not General — for an id with no code anywhere (a reserved 23-36 id, or a dangling custom reference)", () => {
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

  it('collapses the dash-dot border tokens onto style "dashed" — the closest ContentStrokeStyle member', () => {
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

describe("readNumberFormatCodesById: a non-integer numFmtId registers no code", () => {
  it("skips a <numFmt> whose numFmtId is not a parseable integer, leaving that id unresolvable", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("numFmts", {}, [
          el("numFmt", { numFmtId: "not-a-number", formatCode: "0.00" }),
        ]),
        el("cellXfs", {}, [el("xf", { numFmtId: "not-a-number" })]),
      ]),
    );
    expect(hasOwn(readCellStyles(pkg)[0] ?? {}, "numberFormatCode")).toBe(
      false,
    );
  });
});

describe("readFontToggle/readFontUnderline: exact val-string behaviour", () => {
  // Diffs a single font against a plain Calibri baseline with NO toggles at all, so bare presence (no val) and val="1" show up as an explicit `true` difference. A `val="0"`/`val="false"` toggle reads as `false`, which is indistinguishable from this baseline via a diff (false against false is no difference) — those two cases use offToggleFont below instead, against an ALL-toggles-on baseline, so turning one off is what shows up as the difference.
  function diffedToggleFont(toggle: ReturnType<typeof el>) {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("fonts", {}, [
          el("font", {}, [el("name", { val: "Calibri" })]),
          el("font", {}, [toggle, el("name", { val: "Calibri" })]),
        ]),
        el("cellXfs", {}, [el("xf", { numFmtId: "0", fontId: "1" })]),
      ]),
    );
    return readCellStyles(pkg)[0]?.font ?? {};
  }

  // Diffs a single font, WITH b/i/strike all on, against a baseline that ALSO has them all on — so replacing one of the baseline's own toggles with an explicit val="0"/"false" version is what shows up as that one property's own false in the diff.
  function offToggleFont(toggle: ReturnType<typeof el>) {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("fonts", {}, [
          el("font", {}, [
            el("b"),
            el("i"),
            el("strike"),
            el("name", { val: "Calibri" }),
          ]),
          el("font", {}, [toggle, el("name", { val: "Calibri" })]),
        ]),
        el("cellXfs", {}, [el("xf", { numFmtId: "0", fontId: "1" })]),
      ]),
    );
    return readCellStyles(pkg)[0]?.font ?? {};
  }

  it("reads a bare <b/> with no val attribute as bold: true", () => {
    expect(diffedToggleFont(el("b"))).toEqual({ bold: true });
  });

  it('reads <b val="1"> (anything other than "0"/"false") as bold: true', () => {
    expect(diffedToggleFont(el("b", { val: "1" }))).toEqual({ bold: true });
  });

  it('reads <b val="0"> as bold: false, distinguishing the val attribute from a bare element', () => {
    expect(offToggleFont(el("b", { val: "0" }, []))).toMatchObject({
      bold: false,
    });
  });

  it('reads <b val="false"> as bold: false too, the alternate xsd:boolean spelling', () => {
    expect(offToggleFont(el("b", { val: "false" }))).toMatchObject({
      bold: false,
    });
  });

  it('reads <i val="0"> as italic: false, proving the "0" check is not bold-specific', () => {
    expect(offToggleFont(el("i", { val: "0" }))).toMatchObject({
      italic: false,
    });
  });

  it('reads <strike val="false"> as strike: false', () => {
    expect(offToggleFont(el("strike", { val: "false" }))).toMatchObject({
      strike: false,
    });
  });
});

describe("readFontTableEntry: sizePt on a non-numeric <sz val>", () => {
  it("states no sizePt for a <sz val> that does not parse as a number, rather than reporting NaN", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("fonts", {}, [
          el("font", {}, [el("name", { val: "Calibri" })]),
          el("font", {}, [
            el("sz", { val: "not-a-number" }),
            el("name", { val: "Calibri" }),
          ]),
        ]),
        el("cellXfs", {}, [el("xf", { numFmtId: "0", fontId: "1" })]),
      ]),
    );
    expect(hasOwn(readCellStyles(pkg)[0]?.font ?? {}, "sizePt")).toBe(false);
  });
});

describe("contentFontOf: omits fontFamily/sizePt/color entirely (not merely as undefined) when they match the baseline", () => {
  it("omits fontFamily when the entry's own name equals the baseline's, but still states bold", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("fonts", {}, [
          el("font", {}, [
            el("sz", { val: "11" }),
            el("name", { val: "Calibri" }),
          ]),
          el("font", {}, [
            el("b"),
            el("sz", { val: "11" }),
            el("name", { val: "Calibri" }),
          ]),
        ]),
        el("cellXfs", {}, [el("xf", { numFmtId: "0", fontId: "1" })]),
      ]),
    );
    const font = readCellStyles(pkg)[0]?.font ?? {};
    expect(font).toMatchObject({ bold: true });
    expect(hasOwn(font, "fontFamily")).toBe(false);
    expect(hasOwn(font, "sizePt")).toBe(false);
  });

  it("states a colour equal to the baseline's own resolved colour as absent, not restated", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("fonts", {}, [
          el("font", {}, [
            el("color", { rgb: "FFFF0000" }),
            el("name", { val: "Calibri" }),
          ]),
          el("font", {}, [
            el("b"),
            el("color", { rgb: "FFFF0000" }),
            el("name", { val: "Calibri" }),
          ]),
        ]),
        el("cellXfs", {}, [el("xf", { numFmtId: "0", fontId: "1" })]),
      ]),
    );
    const font = readCellStyles(pkg)[0]?.font ?? {};
    expect(font).toEqual({ bold: true });
    expect(hasOwn(font, "color")).toBe(false);
  });

  it("omits fontFamily entirely when the entry states no <name> at all, even though the baseline has one", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("fonts", {}, [
          el("font", {}, [el("name", { val: "Calibri" })]),
          el("font", {}, [el("b")]),
        ]),
        el("cellXfs", {}, [el("xf", { numFmtId: "0", fontId: "1" })]),
      ]),
    );
    const font = readCellStyles(pkg)[0]?.font ?? {};
    expect(font).toEqual({ bold: true });
    expect(hasOwn(font, "fontFamily")).toBe(false);
  });

  it("omits sizePt entirely when the entry states no <sz> at all, even though the baseline has one", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("fonts", {}, [
          el("font", {}, [
            el("sz", { val: "11" }),
            el("name", { val: "Calibri" }),
          ]),
          el("font", {}, [el("b"), el("name", { val: "Calibri" })]),
        ]),
        el("cellXfs", {}, [el("xf", { numFmtId: "0", fontId: "1" })]),
      ]),
    );
    const font = readCellStyles(pkg)[0]?.font ?? {};
    expect(font).toEqual({ bold: true });
    expect(hasOwn(font, "sizePt")).toBe(false);
  });

  it("states an entry's colour when it genuinely differs from the baseline's own resolved colour", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("fonts", {}, [
          el("font", {}, [
            el("color", { rgb: "FFFF0000" }),
            el("name", { val: "Calibri" }),
          ]),
          el("font", {}, [
            el("color", { rgb: "FF0000FF" }),
            el("name", { val: "Calibri" }),
          ]),
        ]),
        el("cellXfs", {}, [el("xf", { numFmtId: "0", fontId: "1" })]),
      ]),
    );
    expect(readCellStyles(pkg)[0]?.font?.color).toEqual({
      r: 0,
      g: 0,
      b: 1,
    });
  });
});

describe("colorFromElement/readColorRgb: hex length boundary and validation", () => {
  it("returns undefined — not a garbage colour — for a 6-character rgb that is not valid hex", () => {
    expect(colorFromElement(el("color", { rgb: "ZZZZZZ" }))).toBeUndefined();
  });

  it("returns undefined for an rgb attribute shorter than 6 characters", () => {
    expect(colorFromElement(el("color", { rgb: "FF00" }))).toBeUndefined();
  });

  it("resolves an 8-digit AARRGGBB rgb by its last 6 (real) digits, dropping the alpha prefix", () => {
    expect(
      readColorRgb(el("x", {}, [el("color", { rgb: "80112233" })]), "color"),
    ).toEqual({ r: 0x11 / 255, g: 0x22 / 255, b: 0x33 / 255 });
  });

  it("returns undefined when the element carries no rgb attribute at all", () => {
    expect(
      readColorRgb(el("x", {}, [el("color", {})]), "color"),
    ).toBeUndefined();
  });

  // The regex's own "^"/"$" anchors are a genuinely irreducible equivalent mutation opportunity here, not merely an untested one: `hex` is constructed immediately above as either exactly 6 characters (raw.slice(-6), whenever raw.length >= 6) or fewer than 6 (raw itself, otherwise) — never more. A {6}-quantified pattern can only ever match a 6-character string across its ENTIRE length regardless of anchors (there is no room for a partial match either before or after), and can never match a shorter one at all, so no input this function can ever construct `hex` from can tell an anchored and an unanchored match apart. The same reasoning makes the raw.length ">= 6" vs "> 6" boundary equivalent too: at raw.length exactly 6, slice(-6) returns the whole (unchanged) string, identical to what the ">" branch's bare `raw` would have returned directly.
});

describe("readFillBackground: fgColor/bgColor tag names and presence", () => {
  it("falls back to bgColor for a solid fill whose fgColor is absent", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("fills", {}, [
          el("fill", {}, [
            el("patternFill", { patternType: "solid" }, [
              el("bgColor", { rgb: "FF00FF00" }),
            ]),
          ]),
        ]),
        el("cellXfs", {}, [el("xf", { numFmtId: "0", fillId: "0" })]),
      ]),
    );
    expect(readCellStyles(pkg)[0]?.background).toEqual({
      kind: "solid",
      color: { r: 0, g: 1, b: 0 },
    });
  });

  it("carries only foregroundColor (never a phantom backgroundColor) for a pattern fill with fgColor alone", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("fills", {}, [
          el("fill", {}, [
            el("patternFill", { patternType: "darkGrid" }, [
              el("fgColor", { rgb: "FFFF0000" }),
            ]),
          ]),
        ]),
        el("cellXfs", {}, [el("xf", { numFmtId: "0", fillId: "0" })]),
      ]),
    );
    const background = readCellStyles(pkg)[0]?.background ?? {};
    expect(hasOwn(background, "foregroundColor")).toBe(true);
    expect(hasOwn(background, "backgroundColor")).toBe(false);
  });

  it("carries only backgroundColor (never a phantom foregroundColor) for a pattern fill with bgColor alone", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("fills", {}, [
          el("fill", {}, [
            el("patternFill", { patternType: "darkGrid" }, [
              el("bgColor", { rgb: "FF0000FF" }),
            ]),
          ]),
        ]),
        el("cellXfs", {}, [el("xf", { numFmtId: "0", fillId: "0" })]),
      ]),
    );
    const background = readCellStyles(pkg)[0]?.background ?? {};
    expect(hasOwn(background, "foregroundColor")).toBe(false);
    expect(hasOwn(background, "backgroundColor")).toBe(true);
  });
});

describe('readBorderEdge: style="none" means no border, distinct from an absent style', () => {
  it('reads undefined for an edge whose style is explicitly "none"', () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("borders", {}, [
          el("border", {}, [
            el("left", { style: "none" }, [el("color", { rgb: "FF000000" })]),
            el("right"),
            el("top"),
            el("bottom"),
          ]),
        ]),
        el("cellXfs", {}, [el("xf", { numFmtId: "0", borderId: "0" })]),
      ]),
    );
    expect(readCellStyles(pkg)[0]?.borders).toBeUndefined();
  });
});

describe("readBorders: each edge's own presence is independent", () => {
  it("returns undefined for a <border> whose every edge resolves to no border at all", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("borders", {}, [
          el("border", {}, [el("left"), el("right"), el("top"), el("bottom")]),
        ]),
        el("cellXfs", {}, [el("xf", { numFmtId: "0", borderId: "0" })]),
      ]),
    );
    expect(readCellStyles(pkg)[0]?.borders).toBeUndefined();
  });

  it("carries exactly the right edge — none of left/top/bottom — for a border naming only right", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("borders", {}, [
          el("border", {}, [
            el("left"),
            el("right", { style: "thin" }, [el("color", { rgb: "FF000000" })]),
            el("top"),
            el("bottom"),
          ]),
        ]),
        el("cellXfs", {}, [el("xf", { numFmtId: "0", borderId: "0" })]),
      ]),
    );
    const borders = readCellStyles(pkg)[0]?.borders ?? {};
    expect(hasOwn(borders, "left")).toBe(false);
    expect(hasOwn(borders, "right")).toBe(true);
    expect(hasOwn(borders, "top")).toBe(false);
    expect(hasOwn(borders, "bottom")).toBe(false);
  });

  it("carries exactly the top edge for a border naming only top", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("borders", {}, [
          el("border", {}, [
            el("left"),
            el("right"),
            el("top", { style: "thin" }, [el("color", { rgb: "FF000000" })]),
            el("bottom"),
          ]),
        ]),
        el("cellXfs", {}, [el("xf", { numFmtId: "0", borderId: "0" })]),
      ]),
    );
    const borders = readCellStyles(pkg)[0]?.borders ?? {};
    expect(hasOwn(borders, "top")).toBe(true);
    expect(hasOwn(borders, "left")).toBe(false);
    expect(hasOwn(borders, "right")).toBe(false);
    expect(hasOwn(borders, "bottom")).toBe(false);
  });

  it("carries exactly the bottom edge for a border naming only bottom", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("borders", {}, [
          el("border", {}, [
            el("left"),
            el("right"),
            el("top"),
            el("bottom", { style: "thin" }, [el("color", { rgb: "FF000000" })]),
          ]),
        ]),
        el("cellXfs", {}, [el("xf", { numFmtId: "0", borderId: "0" })]),
      ]),
    );
    const borders = readCellStyles(pkg)[0]?.borders ?? {};
    expect(hasOwn(borders, "bottom")).toBe(true);
    expect(hasOwn(borders, "left")).toBe(false);
    expect(hasOwn(borders, "right")).toBe(false);
    expect(hasOwn(borders, "top")).toBe(false);
  });
});

describe("readHorizontalAlignment: every recognised member, not just center/right", () => {
  function alignedEntry(horizontal: string) {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("cellXfs", {}, [
          el("xf", { numFmtId: "0" }, [el("alignment", { horizontal })]),
        ]),
      ]),
    );
    return readCellStyles(pkg)[0];
  }

  it('reads horizontal="left"', () => {
    expect(alignedEntry("left")?.alignment).toBe("left");
  });

  it('reads horizontal="justify"', () => {
    expect(alignedEntry("justify")?.alignment).toBe("justify");
  });
});

describe("readCellStyles: numFmtId/numberFormatCode/alignment key presence", () => {
  it("leaves numberFormatCode absent for a non-integer numFmtId on the xf itself", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("cellXfs", {}, [el("xf", { numFmtId: "not-a-number" })]),
      ]),
    );
    expect(hasOwn(readCellStyles(pkg)[0] ?? {}, "numberFormatCode")).toBe(
      false,
    );
  });

  it("leaves numberFormatCode absent for a well-formed numFmtId that resolves to no code at all", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("cellXfs", {}, [el("xf", { numFmtId: "200" })]),
      ]),
    );
    expect(hasOwn(readCellStyles(pkg)[0] ?? {}, "numberFormatCode")).toBe(
      false,
    );
  });

  it("leaves alignment absent (not undefined) when the xf's own <alignment> states no recognised horizontal value, but still states verticalAlignment", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("cellXfs", {}, [
          el("xf", { numFmtId: "0" }, [
            el("alignment", { horizontal: "fill", vertical: "top" }),
          ]),
        ]),
      ]),
    );
    const entry = readCellStyles(pkg)[0] ?? {};
    expect(hasOwn(entry, "alignment")).toBe(false);
    expect(entry.verticalAlignment).toBe("top");
  });

  it("leaves verticalAlignment absent when the xf's own <alignment> states no recognised vertical value, but still states alignment", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("cellXfs", {}, [
          el("xf", { numFmtId: "0" }, [
            el("alignment", { horizontal: "center", vertical: "bottom" }),
          ]),
        ]),
      ]),
    );
    const entry = readCellStyles(pkg)[0] ?? {};
    expect(hasOwn(entry, "verticalAlignment")).toBe(false);
    expect(entry.alignment).toBe("center");
  });
});

describe("CellFormatTable: font signature isolates every one of its own segments", () => {
  // Interns two fonts differing in exactly ONE property and asserts they mint DISTINCT font entries — if a signature segment were ever dropped (a template literal collapsed, a boolean-to-string comparison broken), the two would wrongly collide onto the same fontId instead.
  function internedFontIds(
    fontA: {
      bold?: boolean;
      italic?: boolean;
      underline?: boolean;
      strike?: boolean;
      color?: { r: number; g: number; b: number };
      sizePt?: number;
      fontFamily?: string;
    },
    fontB: typeof fontA,
  ): [number, number] {
    const table = new CellFormatTable();
    const a = table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { font: fontA },
    );
    const b = table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { font: fontB },
    );
    return [a, b];
  }

  it("bold alone distinguishes two otherwise-identical fonts", () => {
    const [a, b] = internedFontIds({ bold: true }, { bold: false });
    expect(a).not.toBe(b);
  });

  it("italic alone distinguishes two otherwise-identical fonts", () => {
    const [a, b] = internedFontIds({ italic: true }, { italic: false });
    expect(a).not.toBe(b);
  });

  it("underline alone distinguishes two otherwise-identical fonts", () => {
    const [a, b] = internedFontIds({ underline: true }, { underline: false });
    expect(a).not.toBe(b);
  });

  it("strike alone distinguishes two otherwise-identical fonts", () => {
    const [a, b] = internedFontIds({ strike: true }, { strike: false });
    expect(a).not.toBe(b);
  });

  it("colour alone distinguishes two otherwise-identical fonts", () => {
    const [a, b] = internedFontIds(
      { color: { r: 1, g: 0, b: 0 } },
      { color: { r: 0, g: 0, b: 1 } },
    );
    expect(a).not.toBe(b);
  });

  it("size alone distinguishes two otherwise-identical fonts", () => {
    const [a, b] = internedFontIds({ sizePt: 11 }, { sizePt: 14 });
    expect(a).not.toBe(b);
  });

  it("fontFamily alone distinguishes two otherwise-identical fonts", () => {
    const [a, b] = internedFontIds(
      { fontFamily: "Arial" },
      { fontFamily: "Courier New" },
    );
    expect(a).not.toBe(b);
  });

  it("declares underline as undefined, not false, for a ContentFont whose own underline is explicitly false", () => {
    const table = new CellFormatTable();
    table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { font: { underline: false, bold: true } },
    );
    expect(table.fontDeclarations()[1]?.underline).toBeUndefined();
  });

  it("caches a font interned twice under DIFFERENT number formats to the same fontId, minting only one <fonts> entry", () => {
    const table = new CellFormatTable();
    const first = table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { font: { bold: true } },
    );
    const second = table.intern(
      { kind: "builtin", id: 9 },
      { font: { bold: true } },
    );
    expect(table.cellFormatRecords()[first]?.fontId).toBe(
      table.cellFormatRecords()[second]?.fontId,
    );
    // Exactly one real font entry beyond the default: had the font-level cache write been skipped, this second, differently-outer-keyed intern() would have missed the cache and minted a duplicate.
    expect(table.fontDeclarations()).toHaveLength(2);
  });
});

describe("CellFormatTable: fill signature isolates colour, and caches across different outer formats", () => {
  it("two different solid colours mint two distinct fill entries, not one shared by signature collapse", () => {
    const table = new CellFormatTable();
    table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { background: { kind: "solid", color: { r: 1, g: 0, b: 0 } } },
    );
    table.intern(
      { kind: "builtin", id: 9 },
      { background: { kind: "solid", color: { r: 0, g: 0, b: 1 } } },
    );
    expect(table.fillDeclarations()).toEqual([
      { kind: "none" },
      { kind: "gray125" },
      { kind: "solid", rgb: "ff0000" },
      { kind: "solid", rgb: "0000ff" },
    ]);
  });

  it("two pattern fills differing only in backgroundColor mint two distinct entries", () => {
    const table = new CellFormatTable();
    const shared = {
      kind: "pattern" as const,
      patternType: "darkGrid" as const,
      foregroundColor: { r: 1, g: 0, b: 0 },
    };
    table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { background: { ...shared, backgroundColor: { r: 0, g: 0, b: 1 } } },
    );
    table.intern(
      { kind: "builtin", id: 9 },
      { background: { ...shared, backgroundColor: { r: 0, g: 1, b: 0 } } },
    );
    expect(table.fillDeclarations()).toHaveLength(4);
  });

  it("caches a fill interned twice under different number formats to the same fillId, minting only one real <fills> entry", () => {
    const table = new CellFormatTable();
    const first = table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { background: { kind: "solid", color: { r: 1, g: 0, b: 0 } } },
    );
    const second = table.intern(
      { kind: "builtin", id: 9 },
      { background: { kind: "solid", color: { r: 1, g: 0, b: 0 } } },
    );
    expect(table.cellFormatRecords()[first]?.fillId).toBe(
      table.cellFormatRecords()[second]?.fillId,
    );
    expect(table.fillDeclarations()).toHaveLength(3);
  });
});

describe("CellFormatTable: border signature and caching across different outer formats", () => {
  it("caches a border interned twice under different number formats to the same borderId, minting only one real <borders> entry", () => {
    const table = new CellFormatTable();
    const border = { left: { color: { r: 0, g: 0, b: 0 }, widthPt: 0.75 } };
    const first = table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { borders: border },
    );
    const second = table.intern(
      { kind: "builtin", id: 9 },
      { borders: border },
    );
    expect(table.cellFormatRecords()[first]?.borderId).toBe(
      table.cellFormatRecords()[second]?.borderId,
    );
    expect(table.borderDeclarations()).toHaveLength(2);
  });

  it("writes a double-style border as the double token verbatim, ignoring widthPt entirely", () => {
    const table = new CellFormatTable();
    table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      {
        borders: {
          left: { color: { r: 0, g: 0, b: 0 }, widthPt: 0.75, style: "double" },
        },
      },
    );
    expect(table.borderDeclarations()[1]).toEqual({
      edges: { left: { style: "double", rgb: "000000" } },
    });
  });

  it("writes a dotted-style border as the dotted token verbatim, ignoring widthPt entirely", () => {
    const table = new CellFormatTable();
    table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      {
        borders: {
          left: { color: { r: 0, g: 0, b: 0 }, widthPt: 0.75, style: "dotted" },
        },
      },
    );
    expect(table.borderDeclarations()[1]).toEqual({
      edges: { left: { style: "dotted", rgb: "000000" } },
    });
  });

  it("writes a dashed border at thin weight as plain dashed, not mediumDashed — the medium check is not a no-op", () => {
    const table = new CellFormatTable();
    table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      {
        borders: {
          left: {
            color: { r: 0, g: 0, b: 0 },
            widthPt: 0.75,
            style: "dashed",
          },
        },
      },
    );
    expect(table.borderDeclarations()[1]).toEqual({
      edges: { left: { style: "dashed", rgb: "000000" } },
    });
  });

  it("dedupes a whole cellXfs entry across an implicit-vs-explicit-'solid' border, at the outer decoration-signature level", () => {
    // Deliberately the SAME number format on both calls, so the outer cellFormat-level cache (signatureOfDecoration, not internBorder's own separate borderIndexBySignature) is what is actually exercised here: a second intern() with a different numFmtId would call internBorder again regardless of the outer signature, proving nothing about this specific "?? 'solid'" fallback.
    const table = new CellFormatTable();
    const implicit = table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { borders: { left: { color: { r: 0, g: 0, b: 0 }, widthPt: 0.75 } } },
    );
    const explicit = table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      {
        borders: {
          left: { color: { r: 0, g: 0, b: 0 }, widthPt: 0.75, style: "solid" },
        },
      },
    );
    expect(explicit).toBe(implicit);
    expect(table.cellFormatRecords()).toHaveLength(2);
  });

  it("two genuinely different real borders mint two distinct entries, not one shared by an edge-segment collapse", () => {
    // Deliberately two REAL, non-empty borders (not an empty-vs-real pair): an empty `{}` decoration hits the outer cellFormat-level default seed before internBorder is ever called at all (its own signature already coincides with EMPTY_DECORATION's), so it can never exercise internBorder's own per-edge signature segment either way. Two distinct real borders, by contrast, both genuinely reach internBorder, so only a real per-edge signature can tell them apart.
    const table = new CellFormatTable();
    const thin = table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { borders: { left: { color: { r: 0, g: 0, b: 0 }, widthPt: 0.75 } } },
    );
    const thick = table.intern(
      { kind: "builtin", id: 9 },
      { borders: { left: { color: { r: 1, g: 0, b: 0 }, widthPt: 1.5 } } },
    );
    expect(table.cellFormatRecords()[thin]?.borderId).not.toBe(
      table.cellFormatRecords()[thick]?.borderId,
    );
    expect(table.borderDeclarations()).toHaveLength(3);
  });
});

describe("CellFormatTable: internFill's own default branch for a wholly unrecognised fill kind", () => {
  it("throws naming the unrecognised kind, for a fill this discriminated union genuinely has no member for", () => {
    const table = new CellFormatTable();
    const bogus = { kind: "gradient" } as unknown as ContentCellFill;
    expect(() =>
      table.intern(
        { kind: "builtin", id: GENERAL_NUM_FMT_ID },
        { background: bogus },
      ),
    ).toThrow(/gradient/);
  });
});

describe("CellFormatTable: intern's own alignment-presence OR, not AND", () => {
  it("still creates a record.alignment when only horizontal is given, with no vertical at all", () => {
    const table = new CellFormatTable();
    const index = table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { alignment: "center" },
    );
    expect(table.cellFormatRecords()[index]?.alignment).toEqual({
      horizontal: "center",
      vertical: undefined,
    });
  });

  it("still creates a record.alignment when only vertical is given, with no horizontal at all", () => {
    const table = new CellFormatTable();
    const index = table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { verticalAlignment: "middle" },
    );
    expect(table.cellFormatRecords()[index]?.alignment).toEqual({
      horizontal: undefined,
      vertical: "middle",
    });
  });

  it("a decoration with only alignment set does not collide with one that also sets a fill", () => {
    const table = new CellFormatTable();
    const alignedOnly = table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { alignment: "left" },
    );
    const alignedAndFilled = table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      {
        alignment: "left",
        background: { kind: "solid", color: { r: 1, g: 0, b: 0 } },
      },
    );
    expect(alignedOnly).not.toBe(alignedAndFilled);
  });

  it("a decoration with alignment set does not collide with an otherwise-identical one with no alignment at all", () => {
    const table = new CellFormatTable();
    const noAlignment = table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { background: { kind: "solid", color: { r: 1, g: 0, b: 0 } } },
    );
    const withAlignment = table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      {
        alignment: "left",
        background: { kind: "solid", color: { r: 1, g: 0, b: 0 } },
      },
    );
    expect(noAlignment).not.toBe(withAlignment);
  });

  it("a decoration with verticalAlignment set does not collide with an otherwise-identical one with no verticalAlignment at all", () => {
    const table = new CellFormatTable();
    const noVertical = table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { background: { kind: "solid", color: { r: 1, g: 0, b: 0 } } },
    );
    const withVertical = table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      {
        verticalAlignment: "top",
        background: { kind: "solid", color: { r: 1, g: 0, b: 0 } },
      },
    );
    expect(noVertical).not.toBe(withVertical);
  });
});
