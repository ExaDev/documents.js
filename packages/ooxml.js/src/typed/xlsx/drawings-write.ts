import type {
  ContentDocument,
  ContentEmbeddedObject,
  ContentSheet,
} from "document-schema.js";
import { columnIndexToLetters } from "document-schema.js";
import type { Part, XmlPart } from "../../model/package";
import type { XmlElement, XmlNode } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import { encodeXmlText } from "../../xml/entities";
import { ptToEmu } from "../shared/units";
import { quoteSheetNameIfNeeded } from "./defined-names";

// The write-side inverse of typed/xlsx/drawings.ts (ExaDev/documents.js#973): a worksheet's own images/embeddedObjects back into a real xl/drawings/drawingN.xml, one xdr:oneCellAnchor per picture or chart graphic frame. oneCellAnchor is chosen over twoCellAnchor throughout -- never absoluteAnchor either -- because every anchor field readAnchorPlacement needs for THIS spelling (the from-marker's column/row/offset, the frame's own width/height) is already exactly what ContentSheetImage/ContentEmbeddedObject carry; a twoCellAnchor's own to-marker would have to be derived by inverting the sheet's column-width/row-height geometry (typed/xlsx/drawings.ts's own SheetGridGeometry, built for the READ direction) for no fidelity gain, since oneCellAnchor's xdr:ext already states the frame size directly and losslessly. This is also a real, common producer spelling -- Excel's own "Move, but don't size with cells" convention for an inserted picture, per drawings.ts's own top-of-file note.
//
// A chart embedded object's own cached series/category model (the small one-sheet spreadsheet ContentDocument typed/xlsx/drawings.ts's chartCells produces) is written back through the SAME cache-only vocabulary the pptx chart reader and this reader's own readChartTable understand: c:tx as a literal c:v, c:cat/c:val as strRef/numRef pairs whose own c:f is a real, sheet-qualified range formula (cosmetic only -- neither reader ever consults it) and whose cache carries every point. No embedded workbook (c:externalData) is written -- the reader never opens one either (typed/pptx/chart.ts's own top comment), so there is nothing on the read side that would ever notice its absence.

const XDR_NS =
  "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const C_NS = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const PKG_RELS_NS =
  "http://schemas.openxmlformats.org/package/2006/relationships";

const REL_IMAGE = `${R_NS}/image`;
const REL_CHART = `${R_NS}/chart`;

// The Content_Types overrides build.ts needs for every drawing/chart part this module writes -- CT_DRAWING for its own xl/drawings/drawingN.xml, CT_CHART for each xl/charts/chartN.xml this module's own extraParts carries.
export const CT_DRAWING =
  "application/vnd.openxmlformats-officedocument.drawing+xml";
export const CT_CHART =
  "application/vnd.openxmlformats-officedocument.drawingml.chart+xml";

function xmlDeclaration(): XmlNode {
  return {
    type: "declaration",
    attributes: [
      { name: "version", value: "1.0" },
      { name: "encoding", value: "UTF-8" },
      { name: "standalone", value: "yes" },
    ],
  };
}

function xmlPart(root: XmlElement): XmlPart {
  return { kind: "xml", nodes: [xmlDeclaration(), root] };
}

function buildOneCellAnchor(
  anchorRow: number,
  anchorColumn: number,
  offsetXPt: number,
  offsetYPt: number,
  widthPt: number,
  heightPt: number,
  content: XmlElement,
): XmlElement {
  return el("xdr:oneCellAnchor", {}, [
    el("xdr:from", {}, [
      el("xdr:col", {}, [txt(String(anchorColumn))]),
      el("xdr:colOff", {}, [txt(String(ptToEmu(offsetXPt)))]),
      el("xdr:row", {}, [txt(String(anchorRow))]),
      el("xdr:rowOff", {}, [txt(String(ptToEmu(offsetYPt)))]),
    ]),
    el("xdr:ext", {
      cx: String(ptToEmu(widthPt)),
      cy: String(ptToEmu(heightPt)),
    }),
    content,
    el("xdr:clientData"),
  ]);
}

function buildPicElement(
  id: number,
  name: string,
  relId: string,
  widthPt: number,
  heightPt: number,
): XmlElement {
  return el("xdr:pic", {}, [
    el("xdr:nvPicPr", {}, [
      el("xdr:cNvPr", { id: String(id), name: encodeXmlText(name) }),
      el("xdr:cNvPicPr", {}, [el("a:picLocks", { noChangeAspect: "1" })]),
    ]),
    el("xdr:blipFill", {}, [
      el("a:blip", { "r:embed": relId }),
      el("a:stretch", {}, [el("a:fillRect")]),
    ]),
    el("xdr:spPr", {}, [
      el("a:xfrm", {}, [
        el("a:off", { x: "0", y: "0" }),
        el("a:ext", {
          cx: String(ptToEmu(widthPt)),
          cy: String(ptToEmu(heightPt)),
        }),
      ]),
      el("a:prstGeom", { prst: "rect" }, [el("a:avLst")]),
    ]),
  ]);
}

function buildGraphicFrameElement(
  id: number,
  name: string,
  relId: string,
  widthPt: number,
  heightPt: number,
): XmlElement {
  return el("xdr:graphicFrame", {}, [
    el("xdr:nvGraphicFramePr", {}, [
      el("xdr:cNvPr", { id: String(id), name: encodeXmlText(name) }),
      el("xdr:cNvGraphicFramePr"),
    ]),
    el("xdr:xfrm", {}, [
      el("a:off", { x: "0", y: "0" }),
      el("a:ext", {
        cx: String(ptToEmu(widthPt)),
        cy: String(ptToEmu(heightPt)),
      }),
    ]),
    el("a:graphic", {}, [
      el("a:graphicData", { uri: C_NS }, [el("c:chart", { "r:id": relId })]),
    ]),
  ]);
}

interface ChartColumn {
  readonly name: string;
  readonly values: readonly string[];
}

interface ChartSeriesData {
  readonly sheetName: string;
  readonly categories: readonly string[];
  readonly series: readonly ChartColumn[];
}

// The exact inverse of typed/xlsx/drawings.ts's own chartCells: recovers the header-row-of-series-names-over-a-category-column table shape back into per-series columns. A cell missing from the sparse cells array (chartCells never materialises a blank/empty-text cell) reads back as "", the same empty label/value labelCell (typed/pptx/chart.ts) already treats a missing point as.
function chartSeriesFromDocument(document: ContentDocument): ChartSeriesData {
  if (document.kind !== "spreadsheet") {
    throw new Error(
      `buildXlsxPackageFromContent: a chart embedded object's document must be a spreadsheet ContentDocument (the shape typed/xlsx/drawings.ts's own chart reader produces), got "${document.kind}"`,
    );
  }
  const sheet = document.sheets[0];
  if (sheet === undefined) {
    throw new Error(
      "buildXlsxPackageFromContent: a chart embedded object's document must carry exactly one sheet (the cached series/category payload typed/xlsx/drawings.ts's own chart reader produces)",
    );
  }
  const byPosition = new Map<string, string>();
  let maxRow = 0;
  let maxColumn = 0;
  for (const cell of sheet.cells) {
    byPosition.set(`${cell.row}:${cell.column}`, cell.displayText);
    maxRow = Math.max(maxRow, cell.row);
    maxColumn = Math.max(maxColumn, cell.column);
  }
  const cellAt = (row: number, column: number): string =>
    byPosition.get(`${row}:${column}`) ?? "";
  const categories: string[] = [];
  for (let row = 1; row <= maxRow; row++) {
    categories.push(cellAt(row, 0));
  }
  const series: ChartColumn[] = [];
  for (let column = 1; column <= maxColumn; column++) {
    const values: string[] = [];
    for (let row = 1; row <= maxRow; row++) {
      values.push(cellAt(row, column));
    }
    series.push({ name: cellAt(0, column), values });
  }
  return { sheetName: sheet.name, categories, series };
}

// c:catAx/c:valAx need distinct workbook-unique axis ids -- any two literals satisfy real Excel and this ecosystem's own reader (which never reads c:axId at all), so a fixed pair suffices since every chart part is its own standalone XML document with no cross-chart id scope.
const CATEGORY_AXIS_ID = "111111111";
const VALUE_AXIS_ID = "222222222";

function buildChartRoot(document: ContentDocument): XmlElement {
  const { sheetName, categories, series } = chartSeriesFromDocument(document);
  const quotedSheet = quoteSheetNameIfNeeded(sheetName);
  const serElements = series.map((column, index) => {
    const catRange = `${quotedSheet}!$A$2:$A$${categories.length + 1}`;
    const columnLetters = columnIndexToLetters(index + 1);
    const valRange = `${quotedSheet}!$${columnLetters}$2:$${columnLetters}$${categories.length + 1}`;
    return el("c:ser", {}, [
      el("c:idx", { val: String(index) }),
      el("c:order", { val: String(index) }),
      el("c:tx", {}, [el("c:v", {}, [txt(encodeXmlText(column.name))])]),
      el("c:cat", {}, [
        el("c:strRef", {}, [
          el("c:f", {}, [txt(encodeXmlText(catRange))]),
          el("c:strCache", {}, [
            el("c:ptCount", { val: String(categories.length) }),
            ...categories.map((label, idx) =>
              el("c:pt", { idx: String(idx) }, [
                el("c:v", {}, [txt(encodeXmlText(label))]),
              ]),
            ),
          ]),
        ]),
      ]),
      el("c:val", {}, [
        el("c:numRef", {}, [
          el("c:f", {}, [txt(encodeXmlText(valRange))]),
          el("c:numCache", {}, [
            el("c:ptCount", { val: String(column.values.length) }),
            ...column.values.map((value, idx) =>
              el("c:pt", { idx: String(idx) }, [
                el("c:v", {}, [txt(encodeXmlText(value))]),
              ]),
            ),
          ]),
        ]),
      ]),
    ]);
  });
  const plotArea = el("c:plotArea", {}, [
    el("c:layout"),
    el("c:barChart", {}, [
      el("c:barDir", { val: "col" }),
      el("c:grouping", { val: "clustered" }),
      ...serElements,
      el("c:axId", { val: CATEGORY_AXIS_ID }),
      el("c:axId", { val: VALUE_AXIS_ID }),
    ]),
    el("c:catAx", {}, [
      el("c:axId", { val: CATEGORY_AXIS_ID }),
      el("c:scaling", {}, [el("c:orientation", { val: "minMax" })]),
      el("c:delete", { val: "0" }),
      el("c:axPos", { val: "b" }),
      el("c:crossAx", { val: VALUE_AXIS_ID }),
    ]),
    el("c:valAx", {}, [
      el("c:axId", { val: VALUE_AXIS_ID }),
      el("c:scaling", {}, [el("c:orientation", { val: "minMax" })]),
      el("c:delete", { val: "0" }),
      el("c:axPos", { val: "l" }),
      el("c:crossAx", { val: CATEGORY_AXIS_ID }),
    ]),
  ]);
  return el(
    "c:chartSpace",
    { "xmlns:c": C_NS, "xmlns:a": A_NS, "xmlns:r": R_NS },
    [el("c:chart", {}, [plotArea])],
  );
}

// Global, workbook-wide counters for chart and media file numbering -- shared across every sheet's own buildSheetDrawing call (build.ts threads one instance through its own sequential sheet walk), so chart1.xml/image1.png number up across the whole workbook the way a real producer's own output does, never restarting per sheet.
export interface DrawingCounters {
  nextChart: number;
  nextMedia: number;
}

export function newDrawingCounters(): DrawingCounters {
  return { nextChart: 1, nextMedia: 1 };
}

export interface SheetDrawingWrite {
  readonly drawingRoot: XmlElement;
  readonly drawingRelsRoot: XmlElement;
  readonly extraParts: Record<string, Part>;
  readonly chartPartNames: readonly string[];
  readonly usedImageFormats: ReadonlySet<"png" | "jpeg" | "gif">;
}

function requireChartObject(
  object: ContentEmbeddedObject,
): ContentEmbeddedObject {
  if (object.objectKind !== "chart") {
    throw new Error(
      `buildXlsxPackageFromContent: a spreadsheet-anchored embedded object of kind "${object.objectKind}" has no OOXML drawing payload this writer can produce (only a "chart" object anchors into a worksheet's own drawing layer, typed/xlsx/drawings.ts's own read-side scope)`,
    );
  }
  return object;
}

function requireAnchorFields(object: ContentEmbeddedObject): {
  anchorRow: number;
  anchorColumn: number;
  offsetXPt: number;
  offsetYPt: number;
} {
  const { anchorRow, anchorColumn, offsetXPt, offsetYPt } = object;
  if (
    anchorRow === undefined ||
    anchorColumn === undefined ||
    offsetXPt === undefined ||
    offsetYPt === undefined
  ) {
    throw new Error(
      "buildXlsxPackageFromContent: a chart embedded object held in ContentSheet.embeddedObjects must carry anchorRow, anchorColumn, offsetXPt, and offsetYPt",
    );
  }
  return { anchorRow, anchorColumn, offsetXPt, offsetYPt };
}

// One worksheet's own drawing layer: every image and chart embedded object it carries, laid out as xdr:oneCellAnchor entries in the sheet's own array order (images first, then embedded objects, mirroring ContentSheetSchema's own field order). undefined for a sheet carrying neither, which is the common case and gets no drawing part, no worksheet relationship, and no Content_Types override at all -- exactly the existing threaded-comments precedent (comments-write.ts's own sheetHasComments gate).
export function buildSheetDrawing(
  sheet: ContentSheet,
  counters: DrawingCounters,
): SheetDrawingWrite | undefined {
  const images = sheet.images;
  const charts = (sheet.embeddedObjects ?? []).map(requireChartObject);
  if (images.length === 0 && charts.length === 0) {
    return undefined;
  }

  const relationshipElements: XmlElement[] = [];
  const anchors: XmlElement[] = [];
  const extraParts: Record<string, Part> = {};
  const chartPartNames: string[] = [];
  const usedImageFormats = new Set<"png" | "jpeg" | "gif">();
  let nextObjectId = 2;
  let relCounter = 0;
  const nextRelId = (): string => {
    relCounter += 1;
    return `rId${relCounter}`;
  };

  for (const image of images) {
    if (image.format === "svg") {
      throw new Error(
        "buildXlsxPackageFromContent: a sheet image in svg format has no OOXML blip this writer can produce (SpreadsheetML's a:blip only references a raster part Excel decodes directly -- png/jpeg/gif)",
      );
    }
    const mediaName = `image${counters.nextMedia++}.${image.format}`;
    extraParts[`xl/media/${mediaName}`] = {
      kind: "binary",
      base64: image.base64,
    };
    usedImageFormats.add(image.format);
    const relId = nextRelId();
    relationshipElements.push(
      el("Relationship", {
        Id: relId,
        Type: REL_IMAGE,
        Target: `../media/${mediaName}`,
      }),
    );
    const id = nextObjectId++;
    anchors.push(
      buildOneCellAnchor(
        image.anchorRow,
        image.anchorColumn,
        image.offsetXPt,
        image.offsetYPt,
        image.widthPt,
        image.heightPt,
        buildPicElement(
          id,
          `Picture ${id}`,
          relId,
          image.widthPt,
          image.heightPt,
        ),
      ),
    );
  }

  for (const chart of charts) {
    const { anchorRow, anchorColumn, offsetXPt, offsetYPt } =
      requireAnchorFields(chart);
    const chartName = `chart${counters.nextChart++}.xml`;
    const chartPartPath = `xl/charts/${chartName}`;
    extraParts[chartPartPath] = xmlPart(buildChartRoot(chart.document));
    chartPartNames.push(chartPartPath);
    const relId = nextRelId();
    relationshipElements.push(
      el("Relationship", {
        Id: relId,
        Type: REL_CHART,
        Target: `../charts/${chartName}`,
      }),
    );
    const id = nextObjectId++;
    anchors.push(
      buildOneCellAnchor(
        anchorRow,
        anchorColumn,
        offsetXPt,
        offsetYPt,
        chart.frame.widthPt,
        chart.frame.heightPt,
        buildGraphicFrameElement(
          id,
          `Chart ${id}`,
          relId,
          chart.frame.widthPt,
          chart.frame.heightPt,
        ),
      ),
    );
  }

  return {
    drawingRoot: el(
      "xdr:wsDr",
      { "xmlns:xdr": XDR_NS, "xmlns:a": A_NS, "xmlns:r": R_NS },
      anchors,
    ),
    drawingRelsRoot: el(
      "Relationships",
      { xmlns: PKG_RELS_NS },
      relationshipElements,
    ),
    extraParts,
    chartPartNames,
    usedImageFormats,
  };
}
