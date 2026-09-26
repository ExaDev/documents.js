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

describe("readXlsxContent: drawing pictures", () => {
  it("reads an xdr:pic into ContentSheet.images, media bytes sniffed and anchor fields plus frame resolved from the from/to markers", () => {
    const document = readXlsxContent(pictureDrawingPackage());
    if (document.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(document.sheets[0]?.images).toHaveLength(1);
    const image = document.sheets[0]?.images[0];
    expect(image?.kind).toBe("image");
    // The media part's own bytes decide the format, never the part's .png name — the same contract as the pptx picture reader.
    expect(image?.format).toBe("png");
    expect(image?.base64).toBe(TINY_PNG_BASE64);
    expect(image?.anchorColumn).toBe(0);
    expect(image?.anchorRow).toBe(1);
    // Same anchor geometry as the chart row: anchored at column 0 offset 19050 EMU, row 1, spanning to the start of column 2 and row 4, size the difference of the two anchors.
    const col0 = columnWidthCharsToPt(ANCHOR_COLUMN_0_WIDTH_CHARS);
    const col1 = columnWidthCharsToPt(ANCHOR_COLUMN_1_WIDTH_CHARS);
    expect(image?.offsetXPt).toBeCloseTo(
      ANCHOR_OFFSET_X_PT,
      CLOSE_TO_PRECISION,
    );
    expect(image?.offsetYPt).toBe(0);
    expect(image?.widthPt).toBeCloseTo(
      col0 + col1 - ANCHOR_OFFSET_X_PT,
      CLOSE_TO_PRECISION,
    );
    expect(image?.heightPt).toBeCloseTo(
      THREE_ROW_HEIGHT_PT,
      CLOSE_TO_PRECISION,
    );
    // A drawing carrying only a picture, no chart graphic frame at all, leaves embeddedObjects absent rather than an empty array — the same "undefined means none, [] means none for images specifically" split the module doc comment states.
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

// The oneCellAnchor spelling — Excel's own "Move, but don't size with cells" anchoring for an inserted picture (the common real-producer spelling, per #776): a from-marker positions the frame through the grid geometry exactly as a two-cell anchor's from-marker does, and the anchor's own xdr:ext sizes it, which is the to-marker's job in the two-cell spelling.
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
    expect(image?.offsetXPt).toBeCloseTo(
      ANCHOR_OFFSET_X_PT,
      CLOSE_TO_PRECISION,
    );
    expect(image?.offsetYPt).toBe(0);
    // The size is the anchor's own xdr:ext verbatim: 1828800 x 914400 EMU is 2 x 1 inches, 144 x 72 pt.
    expect(image?.widthPt).toBeCloseTo(TWO_INCH_EXTENT_PT, CLOSE_TO_PRECISION);
    expect(image?.heightPt).toBeCloseTo(POINTS_PER_INCH, CLOSE_TO_PRECISION);
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

// The absoluteAnchor spelling: xdr:pos (x/y EMU, page-absolute) plus xdr:ext sizing, no markers at all. ContentSheetImage's anchor vocabulary is cell-relative, so the landing #776 decides on is the nearest-cell re-basing — the grid geometry's own inverse maps the absolute position onto a containing column/row plus the offset within it, exactly the fields a from-marker spells directly. The fixture grid: column 0 is 10 chars (52.5 pt), column 1 is 20 chars (105 pt), rows default 15 pt; pos 762000 x 190500 EMU is 60 x 15 pt, so column 1 offset 7.5 pt (52.5 + 7.5 = 60) and row 1 offset 0 (15 sits exactly on the row-1 boundary).
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
    const ABSOLUTE_ANCHOR_OFFSET_X_PT = 7.5;
    expect(image?.offsetXPt).toBeCloseTo(
      ABSOLUTE_ANCHOR_OFFSET_X_PT,
      CLOSE_TO_PRECISION,
    );
    expect(image?.offsetYPt).toBe(0);
    // Size verbatim from xdr:ext: 1828800 x 914400 EMU is 144 x 72 pt.
    expect(image?.widthPt).toBeCloseTo(TWO_INCH_EXTENT_PT, CLOSE_TO_PRECISION);
    expect(image?.heightPt).toBeCloseTo(POINTS_PER_INCH, CLOSE_TO_PRECISION);
  });

  it("skips an absolute picture whose ext size is not positive, the same degenerate-anchor guard the marker spellings have", () => {
    const document = readXlsxContent(absolutePicturePackage("1828800", "0"));
    if (document.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(document.sheets[0]?.images).toEqual([]);
  });

  it("locates a position sitting exactly on a column boundary as the start of the next column, not an offset into the previous one", () => {
    // Column 0 is 10 chars = columnWidthCharsToPt(10) pt exactly, i.e. that many EMU at 12700 EMU/pt — pos x lands exactly on the column 0/1 boundary, pos y at 0 keeps the row/height math out of it entirely.
    const EMU_PER_POINT = 12700;
    const boundaryEmu = Math.round(
      columnWidthCharsToPt(ANCHOR_COLUMN_0_WIDTH_CHARS) * EMU_PER_POINT,
    );
    const document = readXlsxContent(
      absolutePicturePackage("1828800", "914400", String(boundaryEmu), "0"),
    );
    if (document.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    const image = document.sheets[0]?.images[0];
    // A position exactly at the boundary belongs to the column it starts (column 1, offset 0), not the tail end of column 0 (column 0, offset = the whole column width).
    expect(image?.anchorColumn).toBe(1);
    expect(image?.offsetXPt).toBeCloseTo(0, CLOSE_TO_PRECISION);
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
