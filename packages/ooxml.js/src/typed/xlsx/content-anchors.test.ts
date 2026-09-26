import { describe, expect, it } from "vitest";
import { ContentDocumentSchema } from "document-schema.js";
import type { ContentSheet } from "document-schema.js";
import type { Package } from "../../model/package";
import type { XmlElement, XmlNode } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import {
  columnWidthCharsToPt,
  DEFAULT_COLUMN_WIDTH_CHARS,
  DEFAULT_ROW_HEIGHT_PT,
} from "./units";
import { POINTS_PER_INCH } from "../shared/units";
import { readXlsxContent } from "./content";
const CLOSE_TO_PRECISION = 5;

// This fixture family's own repeated drawing-anchor geometry, reused verbatim across several of the chart/image describe blocks below: a two-cell-anchored drawing whose <xdr:from> col/colOff names 19050 EMU into column 0, and whose columns are 10 and 20 characters wide.
const TWO_INCH_EXTENT_PT = 2 * POINTS_PER_INCH;

// This fixture family's own default row height (see DEFAULT_ROW_HEIGHT_PT), spanning ROW_SPAN_COUNT rows (1 through 4) for the two-cell-anchored drawings.

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

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

function customDrawingPackage(
  worksheetChildren: readonly XmlNode[],
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

// A twoCellAnchor carrying a single xdr:pic, from col0/row0 (offset 0) to col1/row1 (offset 0) unless overridden — the minimal shape for exercising SheetGridGeometry's own column/row reading via the resulting frame size, independent of the anchor-placement arithmetic the fixtures above already cover.
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
    const ABSOLUTE_FRAME_X_PT = 60;
    const ABSOLUTE_ANCHOR_OFFSET_X_PT = 7.5;
    expect(chart?.frame.xPt).toBeCloseTo(
      ABSOLUTE_FRAME_X_PT,
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
    expect(chart?.anchorColumn).toBe(1);
    expect(chart?.anchorRow).toBe(1);
    expect(chart?.offsetXPt).toBeCloseTo(
      ABSOLUTE_ANCHOR_OFFSET_X_PT,
      CLOSE_TO_PRECISION,
    );
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

// One drawing part mixing all three anchor spellings over pictures (each resolving the same media part): the rows land in the part's own document order, not grouped by spelling — the walk iterates the drawing's children once.
describe("readXlsxContent: drawing pictures (mixed anchor spellings)", () => {
  it("lands pictures from all three spellings in the drawing part's own document order, not grouped by spelling", () => {
    const document = readXlsxContent(mixedAnchorsPicturePackage());
    if (document.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    // This fixture's own third picture (absolute-anchor spelling) is the only one whose anchorRow needs naming; the others fall inside the ignored small-integer range.
    const THIRD_PICTURE_ANCHOR_ROW = 3;
    expect(document.sheets[0]?.images.map((image) => image.anchorRow)).toEqual([
      2,
      1,
      THIRD_PICTURE_ANCHOR_ROW,
    ]);
    expect(
      document.sheets[0]?.images.map((image) => image.anchorColumn),
    ).toEqual([0, 1, 0]);
  });
});

// A drawing-bearing package for SheetGridGeometry and anchor-walk edge cases the fixtures above don't happen to exercise: the caller supplies the worksheet's own children (cols/sheetFormatPr/sheetData) and the drawing's own single anchor element directly, everything else (workbook, every relationship, the one media part) fixed to the same tiny PNG the picture fixtures above already use.
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
      CLOSE_TO_PRECISION,
    );
  });

  it("prefers a covering column range's own declared width over a narrower range with no width at all", () => {
    // Two declared ranges both cover column 0 — an outer 1..5 range with no width (a real producer's habit for "these columns use the sheet default"), and an inner 1..1 range that actually states one. The inner range's real width must win, not the wider range's undefined one merely because .find() met it first.
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
    const INNER_RANGE_WIDTH_CHARS = 40;
    expect(images[0]?.widthPt).toBeCloseTo(
      columnWidthCharsToPt(INNER_RANGE_WIDTH_CHARS),
      CLOSE_TO_PRECISION,
    );
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
    const DECLARED_DEFAULT_ROW_HEIGHT_PT = 30;
    expect(images[0]?.heightPt).toBeCloseTo(
      DECLARED_DEFAULT_ROW_HEIGHT_PT,
      CLOSE_TO_PRECISION,
    );
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
    // r="1" names the FIRST row (0-based index 0) — the very row this anchor spans, not the one after it.
    const DECLARED_ROW_HEIGHT_PT = 50;
    expect(images[0]?.heightPt).toBeCloseTo(
      DECLARED_ROW_HEIGHT_PT,
      CLOSE_TO_PRECISION,
    );
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
    // Coincidentally the same value as this package's own DEFAULT_ROW_HEIGHT_PT, but asserting the fixture's real, explicit sheetFormatPr@defaultRowHeight="15" is honoured, not merely that the built-in fallback happens to match it.
    const FIXTURE_DEFAULT_ROW_HEIGHT_PT = 15;
    expect(images[0]?.heightPt).toBeCloseTo(
      FIXTURE_DEFAULT_ROW_HEIGHT_PT,
      CLOSE_TO_PRECISION,
    );
  });

  it("defaults editAs to twoCell (sizing from the to-marker) when the attribute is absent, and reads it when present", () => {
    const defaulted = imagesOf(
      customDrawingPackage(
        [el("sheetData", {}, [])],
        onePicTwoCellAnchor({ toCol: 2 }),
      ),
    );
    // No editAs at all: sized from the to-marker difference (2 default-width columns), not the picture's own 1"x1" (72pt) xdr:ext.
    const TO_MARKER_COLUMN_SPAN = 2;
    expect(defaulted[0]?.widthPt).toBeCloseTo(
      TO_MARKER_COLUMN_SPAN * columnWidthCharsToPt(DEFAULT_COLUMN_WIDTH_CHARS),
      CLOSE_TO_PRECISION,
    );

    const oneCell = imagesOf(
      customDrawingPackage(
        [el("sheetData", {}, [])],
        onePicTwoCellAnchor({ toCol: 2, editAs: "oneCell" }),
      ),
    );
    // editAs="oneCell" on a twoCellAnchor (Excel's real spelling for "move but don't size with cells"): sized from the shape's own transform extent (1in = 72pt) instead, ignoring the to-marker entirely.
    expect(oneCell[0]?.widthPt).toBeCloseTo(
      POINTS_PER_INCH,
      CLOSE_TO_PRECISION,
    );
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
    // Column 0 sits below the declared range's own min (2, 0-based) — it must fall back to the default width, not the range's huge declared one merely because 0 <= the range's own max.
    expect(images[0]?.widthPt).toBeCloseTo(
      columnWidthCharsToPt(DEFAULT_COLUMN_WIDTH_CHARS),
      CLOSE_TO_PRECISION,
    );
  });
});
