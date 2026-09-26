import { describe, expect, it } from "vitest";
import type { Package } from "../../model/package";
import { el, txt } from "../../xml/fragment";
import { readXlsxContent } from "./content";
function hasOwn(obj: object, key: string): boolean {
  return Object.hasOwn(obj, key);
}

// This suite reads real, unmodified LibreOffice-generated .xlsx fixtures (src/typed/xlsx/fixtures/*.xlsx). Both fixtures are genuine LibreOffice xlsx-exports (`soffice --headless --convert-to xlsx`) of odf.js's own src/typed/ods/fixtures/{kitchen-sink,minimal}.ods — the same feature set that package's own readOds test suite already validates against ODF's equivalent mechanisms, run back through LibreOffice's real SpreadsheetML export filter so this suite exercises genuine, LibreOffice-authored xlsx markup (column-width character units, row heights, hidden rows/columns, every value-type LibreOffice's own xlsx exporter distinguishes, a real merged range, a real cross-sheet formula, and real print settings including Print_Area/Print_Titles defined names) rather than a hand-built approximation of what that markup might look like. A handful of narrow scope-boundary/error-path tests at the end use small, synthetic, hand-built packages instead (via el/txt), mirroring readOds's own established convention for the identical reason.

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

// A styled numeric cell — s="1" points at the numFmts-declared format; s="0" at General.
function numericCell(value: string): ReturnType<typeof el> {
  return el("c", { r: "A1", s: "1" }, [el("v", {}, [txt(value)])]);
}

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

  it("falls back to an all-defaults sheet, rather than throwing, when a <sheet> in xl/workbook.xml points at a part the package doesn't actually have", () => {
    const pkg: Package = {
      parts: {
        "xl/workbook.xml": {
          kind: "xml",
          nodes: [
            el("workbook", {}, [
              el("sheets", {}, [
                el("sheet", { name: "Missing", "r:id": "rId1" }),
              ]),
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
        // No "xl/worksheets/sheet1.xml" part at all — the malformed-package case rootElement's own undefined-part branch exists for.
      },
    };
    const result = readXlsxContent(pkg);
    expect(result.kind).toBe("spreadsheet");
    if (result.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(result.sheets).toHaveLength(1);
    expect(result.sheets[0]).toMatchObject({
      name: "Missing",
      cells: [],
      columns: [],
      rows: [],
      images: [],
    });
    // The fallback's own printSettings comes from readPrintSettings given a childless <worksheet>, which is exercised (and its exact shape asserted) by print-settings.ts's own tests — this only proves the fallback reaches it at all, rather than throwing.
    expect(result.sheets[0]?.printSettings).toBeDefined();
  });
});

// The number format governs only what a NUMERIC cell holds. These build a package carrying a real xl/styles.xml so a cell's own s attribute resolves to a genuine format code, exercising the boundaries the kitchen-sink fixture has no cell for.
describe("readXlsxContent: the number format governs numeric cells only (synthetic packages)", () => {
  it("never reclassifies a cell that already carries its own type — a currency-formatted string, boolean, or error stays what the file says it is", () => {
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

  it("keeps an elapsed-time cell as a raw number — ContentCellValue has no duration kind, and [h]:mm:ss may exceed 24 hours", () => {
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

// Cell decoration (background/borders/alignment/verticalAlignment) resolves through the same cellXfs index the number format does. These build a package with a real xl/styles.xml carrying fills, borders, and inline <alignment> so a cell's own s attribute resolves to a genuinely decorated xf — the boundaries the kitchen-sink fixture (all default styling) has no cell for.
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

  it('leaves horizontal="general" unread — general means "use the value-kind default", the same semantics as an absent alignment', () => {
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

  it("omits the font/background/borders/alignment/verticalAlignment keys entirely on a cell whose s index carries none of them — not merely assigned undefined", () => {
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

// Every one of readColumns/readRows/sheetFormatDefaultRowHeightPt's own conditional branches and index arithmetic, exercised directly against small synthetic worksheets — the kitchen-sink fixture's own real rows/columns don't happen to visit every boundary (a 0-based min, a non-numeric width, a row number exactly at its own lower bound) these functions guard against.
