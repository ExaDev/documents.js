import { describe, expect, it } from "vitest";
import { ContentDocumentSchema } from "document-schema.js";
import type { Package } from "../../model/package";
import { el, txt } from "../../xml/fragment";
import { decodePackage, encodePackage } from "../../codec";
import { buildXlsxPackageFromContent } from "./build";
import { columnWidthCharsToPt, DEFAULT_ROW_HEIGHT_PT } from "./units";
import { EMU_PER_INCH, POINTS_PER_INCH } from "../shared/units";
import { readXlsxContent } from "./content";
const CLOSE_TO_PRECISION = 5;

// This fixture family's own repeated drawing-anchor geometry, reused verbatim across several of the chart/image describe blocks below: a two-cell-anchored drawing whose <xdr:from> col/colOff names 19050 EMU into column 0, and whose columns are 10 and 20 characters wide.
const ANCHOR_OFFSET_X_EMU = 19050;
const ANCHOR_OFFSET_X_PT =
  (ANCHOR_OFFSET_X_EMU / EMU_PER_INCH) * POINTS_PER_INCH;
const ANCHOR_COLUMN_0_WIDTH_CHARS = 10;
const ANCHOR_COLUMN_1_WIDTH_CHARS = 20;
// The xdr:ext size these same fixtures anchor: 1828800 x 914400 EMU, i.e. 2in x 1in.
const TWO_INCH_EXTENT_PT = 2 * POINTS_PER_INCH;

// This fixture family's own default row height (see DEFAULT_ROW_HEIGHT_PT), spanning ROW_SPAN_COUNT rows (1 through 4) for the two-cell-anchored drawings.
const ROW_SPAN_COUNT = 3;
const THREE_ROW_HEIGHT_PT = ROW_SPAN_COUNT * DEFAULT_ROW_HEIGHT_PT;

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
    // The frame: anchored at column 0 offset 19050 EMU, row 1, spanning to the start of column 2 and row 4 — absolute position from the sheet's left edge through the declared column widths and default row height, size the difference of the two anchors.
    const col0 = columnWidthCharsToPt(ANCHOR_COLUMN_0_WIDTH_CHARS);
    const col1 = columnWidthCharsToPt(ANCHOR_COLUMN_1_WIDTH_CHARS);
    expect(chart?.offsetXPt).toBeCloseTo(
      ANCHOR_OFFSET_X_PT,
      CLOSE_TO_PRECISION,
    );
    expect(chart?.frame.xPt).toBeCloseTo(
      ANCHOR_OFFSET_X_PT,
      CLOSE_TO_PRECISION,
    );
    expect(chart?.frame.yPt).toBeCloseTo(
      DEFAULT_ROW_HEIGHT_PT,
      CLOSE_TO_PRECISION,
    );
    expect(chart?.frame.widthPt).toBeCloseTo(
      col0 + col1 - ANCHOR_OFFSET_X_PT,
      CLOSE_TO_PRECISION,
    );
    expect(chart?.frame.heightPt).toBeCloseTo(
      THREE_ROW_HEIGHT_PT,
      CLOSE_TO_PRECISION,
    );
    // The payload is the cached model, verbatim c:v text, laid out the way the pptx chart reader spells its table: a header row of series names over a category column, one row per category.
    expect(chart?.document.kind).toBe("spreadsheet");
    const sheet =
      chart?.document.kind === "spreadsheet"
        ? chart.document.sheets[0]
        : undefined;
    // The graphic frame's own xdr:cNvPr/@name ("Chart 1"), not the "Chart" fallback — the payload sheet is named after the shape that actually held it.
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

  it("quarantines the whole chart part — type, axes, colours, everything the cached-model read does not carry — as xlsx residue on the embedded object", () => {
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
    expect(chart?.offsetXPt).toBeCloseTo(
      ANCHOR_OFFSET_X_PT,
      CLOSE_TO_PRECISION,
    );
    expect(chart?.offsetYPt).toBe(0);
    expect(chart?.frame.xPt).toBeCloseTo(
      ANCHOR_OFFSET_X_PT,
      CLOSE_TO_PRECISION,
    );
    expect(chart?.frame.yPt).toBeCloseTo(
      DEFAULT_ROW_HEIGHT_PT,
      CLOSE_TO_PRECISION,
    );
    expect(chart?.frame.widthPt).toBeCloseTo(
      TWO_INCH_EXTENT_PT,
      CLOSE_TO_PRECISION,
    );
    expect(chart?.frame.heightPt).toBeCloseTo(
      POINTS_PER_INCH,
      CLOSE_TO_PRECISION,
    );
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
