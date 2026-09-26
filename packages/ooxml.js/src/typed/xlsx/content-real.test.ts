import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ContentSheet } from "document-schema.js";
import type { Package } from "../../model/package";
import type { XmlElement, XmlNode } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import { parsePackage } from "../../package-io/read";
import { readXlsxContent } from "./content";
const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

// toBeCloseTo's precision argument used throughout this file's point-conversion assertions: 5 decimal digits is tight enough to catch a wrong formula or unit while tolerating the ordinary floating-point rounding pixel/EMU/twip conversions produce.
const CLOSE_TO_PRECISION = 5;

// This fixture family's own repeated drawing-anchor geometry, reused verbatim across several of the chart/image describe blocks below: a two-cell-anchored drawing whose <xdr:from> col/colOff names 19050 EMU into column 0, and whose columns are 10 and 20 characters wide.
function loadFixture(name: string): Package {
  const bytes = new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
  return parsePackage(bytes);
}

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

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
    const ROW_OFFSET_PT = 4;
    expect(images[0]?.offsetYPt).toBeCloseTo(ROW_OFFSET_PT, CLOSE_TO_PRECISION);
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
    const EXPECTED_ANCHOR_COLUMN = 5;
    expect(images[0]?.anchorColumn).toBe(EXPECTED_ANCHOR_COLUMN);
  });
});

describe("readXlsxContent: chart graphic frame structural gaps (synthetic packages)", () => {
  function chartGraphicFrame(
    opts: Readonly<{
      withCNvPr?: boolean;
      name?: string;
      graphicUri?: string;
    }> = {},
  ): XmlElement {
    const {
      withCNvPr = true,
      graphicUri = "http://schemas.openxmlformats.org/drawingml/2006/chart",
    } = opts;
    // "name" in opts (not a destructured default) distinguishes "caller omitted the option, use the real default" from "caller explicitly asked for no name attribute at all" — a destructured default would treat {name: undefined} identically to {}, which defeats the one test below that needs a cNvPr with genuinely no name attribute.
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
    // A hyperlink relationship inserted before the genuine drawing relationship in the worksheet's own rels part — resolveRelationships preserves declaration order, so a coverage-bearing loop that stops at the FIRST relationship regardless of type would resolve the hyperlink's own (nonsensical, non-drawing) target as if it were the drawing part.
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

// dataValidation and conditionalFormatting rules, promoted to real vocabulary (ExaDev/documents.js#758) for every rule this package's schema names — the two real-producer fixtures below exercise the structural read/write path; the synthetic packages further down exercise what is deliberately left un-promoted (an 'expression' cfRule, a dataValidation type this schema does not name) through the pre-existing anchor-cell residue mechanism.
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

  // The real fixture's own <alignment horizontal="general" vertical="bottom" textRotation="0" wrapText="false" indent="0" shrinkToFit="false"/> — the "rest of the dxf" once font/fill are structurally absorbed into textColor/background, carried as the style's own residue (empty children serialise as an explicit open/close pair, not self-closing, matching buildXml's own convention elsewhere in this suite).
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

  it("promotes the colorScale rule over C1:C2 with its own inline cfvo/color stops (this fixture's cellIs pair is a known ODF round-trip artifact — missing operator — and is not asserted on here)", () => {
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

  it('parses a real multi-range sqref ("A1 C1") into BOTH ranges, not just the first — the sqref bug fix', () => {
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
