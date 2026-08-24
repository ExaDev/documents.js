import type {
  ContentDocument,
  ContentEmbeddedObject,
  ContentSheetCell,
  ContentSheetImage,
} from "document-schema.js";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { readChartTable } from "../pptx/chart";
import { readCoreProperties } from "../shared/metadata";
import { emuToPt } from "../shared/units";
import {
  attr,
  childrenWithTag,
  elementsWithTag,
  resolveRelationships,
  rootElement,
} from "../util";
import type { ImageFormat } from "../../image/sniff";
import { sniffImageFormat } from "../../image/sniff";
import { base64ToBytes } from "../../util/base64";
import { readPrintSettings } from "./print-settings";
import {
  columnWidthCharsToPt,
  DEFAULT_COLUMN_WIDTH_CHARS,
  DEFAULT_ROW_HEIGHT_PT,
} from "./units";

// A worksheet's drawing layer (xl/drawings/drawingN.xml, reached through the worksheet's own relationships): the xlsx counterpart of pptx's chart/SmartArt/OLE readers. A chart graphic frame's cached series/category model is read through the SAME chart reader the pptx side uses (readChartTable), and lands as a ContentEmbeddedObject with objectKind 'chart' -- the one member that names what the frame held rather than a ContentDocument kind, carrying the cached model as a small spreadsheet document (one sheet whose cells are that table), because a sheet is the honest document-granularity spelling of tabular data and a xlsx sheet has no block flow to host a table block the way a pptx shape does. A picture (xdr:pic) resolves its a:blip through the drawing part's own relationships to the sniffed media bytes and lands as a ContentSheetImage -- the same blip-resolution contract as the pptx picture reader, anchor fields and frame resolved through the same grid geometry the chart row uses.
//
// Scope: all three anchor spellings a drawing part carries (charts and pictures), every spelling resolving to one placement shape -- a from-marker positions a two-cell or one-cell anchor through the same grid geometry, with the frame's size the to-marker difference (two-cell) or the anchor's own xdr:ext (one-cell, Excel's "Move, but don't size with cells" spelling for inserted pictures); an absoluteAnchor's page-absolute xdr:pos is re-based into the cell-relative anchor vocabulary through that same geometry's inverse (the nearest-cell landing #776 decides on, rather than a schema extension -- the geometry is a bijection between cell-plus-offset and absolute position, and the frame keeps the absolute position verbatim, so the re-basing loses nothing). Real-producer verification is outstanding: the fixtures this is built against are hand-built ECMA-376 markup, the corpus gate the construct inventory itself states.

const CHART_GRAPHIC_URI =
  "http://schemas.openxmlformats.org/drawingml/2006/chart";
const DRAWING_REL_SUFFIX = "/drawing";

// One declared <col min max width> range, kept as the RANGE the anchor geometry needs -- readColumns deliberately materialises only each element's starting index (the repeat-hazard policy), but a column in the middle of a min..max span has a real width a drawing placed against it must resolve through.
interface DeclaredColumn {
  readonly min: number;
  readonly max: number;
  readonly widthPt: number | undefined;
}

// The cell-grid geometry an anchor resolves against: declared column-width ranges (defaulting elsewhere), declared row heights with the worksheet's own default beneath, both read straight off the worksheet element rather than off the reader's own already-narrowed ContentSheet projections.
class SheetGridGeometry {
  private readonly columns: DeclaredColumn[] = [];
  private readonly rowHeights = new Map<number, number>();
  private readonly defaultRowHeightPt: number;

  constructor(worksheet: XmlElement) {
    const cols = childrenWithTag(worksheet, "cols")[0];
    if (cols !== undefined) {
      for (const col of childrenWithTag(cols, "col")) {
        const min = Number.parseInt(attr(col, "min") ?? "", 10);
        const max = Number.parseInt(attr(col, "max") ?? "", 10);
        const widthRaw = attr(col, "width");
        const widthPt =
          widthRaw === undefined
            ? undefined
            : columnWidthCharsToPt(Number(widthRaw));
        if (
          Number.isInteger(min) &&
          Number.isInteger(max) &&
          min >= 1 &&
          max >= min
        ) {
          this.columns.push({
            min: min - 1,
            max: max - 1,
            widthPt: Number.isFinite(widthPt) ? widthPt : undefined,
          });
        }
      }
    }
    const sheetFormatPr = childrenWithTag(worksheet, "sheetFormatPr")[0];
    const defaultRaw =
      sheetFormatPr === undefined
        ? undefined
        : attr(sheetFormatPr, "defaultRowHeight");
    const parsed = defaultRaw === undefined ? Number.NaN : Number(defaultRaw);
    this.defaultRowHeightPt = Number.isFinite(parsed)
      ? parsed
      : DEFAULT_ROW_HEIGHT_PT;
    const sheetData = childrenWithTag(worksheet, "sheetData")[0];
    if (sheetData !== undefined) {
      for (const row of childrenWithTag(sheetData, "row")) {
        const r = Number.parseInt(attr(row, "r") ?? "", 10);
        const htRaw = attr(row, "ht");
        const ht = htRaw === undefined ? Number.NaN : Number(htRaw);
        if (Number.isInteger(r) && r >= 1 && Number.isFinite(ht)) {
          this.rowHeights.set(r - 1, ht);
        }
      }
    }
  }

  columnWidthPt(index: number): number {
    const covering = this.columns.find(
      (column) =>
        index >= column.min &&
        index <= column.max &&
        column.widthPt !== undefined,
    );
    return (
      covering?.widthPt ?? columnWidthCharsToPt(DEFAULT_COLUMN_WIDTH_CHARS)
    );
  }

  rowHeightPt(index: number): number {
    return this.rowHeights.get(index) ?? this.defaultRowHeightPt;
  }

  xPt(column: number, colOffEmu: number): number {
    let xPt = emuToPt(colOffEmu);
    for (let index = 0; index < column; index++) {
      xPt += this.columnWidthPt(index);
    }
    return xPt;
  }

  yPt(row: number, rowOffEmu: number): number {
    let yPt = emuToPt(rowOffEmu);
    for (let index = 0; index < row; index++) {
      yPt += this.rowHeightPt(index);
    }
    return yPt;
  }

  // The inverse of xPt: the containing column plus the offset within it, for a page-absolute position an xdr:absoluteAnchor carries directly (its xdr:pos) and the cell-relative anchor vocabulary must re-base. Widths the grid resolves are positive -- a declared zero-width span ends where the next default-width column begins -- so the walk terminates, and because it accumulates in the same order xPt does, xPt(locateColumn(x).index, 0) + locateColumn(x).offsetPt lands back on x exactly: the re-basing loses nothing.
  locateColumn(xPt: number): { index: number; offsetPt: number } {
    let index = 0;
    let boundaryPt = 0;
    let widthPt = this.columnWidthPt(index);
    while (boundaryPt + widthPt <= xPt) {
      boundaryPt += widthPt;
      index += 1;
      widthPt = this.columnWidthPt(index);
    }
    return { index, offsetPt: xPt - boundaryPt };
  }

  locateRow(yPt: number): { index: number; offsetPt: number } {
    let index = 0;
    let boundaryPt = 0;
    let heightPt = this.rowHeightPt(index);
    while (boundaryPt + heightPt <= yPt) {
      boundaryPt += heightPt;
      index += 1;
      heightPt = this.rowHeightPt(index);
    }
    return { index, offsetPt: yPt - boundaryPt };
  }
}

interface AnchorMarker {
  readonly column: number;
  readonly colOffEmu: number;
  readonly row: number;
  readonly rowOffEmu: number;
}

// The placement vocabulary every anchor spelling resolves to: a frame in absolute points plus the cell-relative anchor fields ContentSheetImage and ContentEmbeddedObject carry, so the content walk below (graphic frames, pictures) is shared across spellings.
interface AnchorPlacement {
  readonly xPt: number;
  readonly yPt: number;
  readonly widthPt: number;
  readonly heightPt: number;
  readonly anchorRow: number;
  readonly anchorColumn: number;
  readonly offsetXPt: number;
  readonly offsetYPt: number;
}

// A marker's own child values: xdr:col/xdr:colOff/xdr:row/xdr:rowOff carry their numbers as TEXT content, not attributes, unlike most of the numeric vocabulary this package reads. A malformed value degrades to 0 the way this family's other numeric readers degrade, never to a NaN frame; a marker's col/row are 0-based grid indices.
function readAnchorChild(marker: XmlElement, tag: string): number {
  const child = childrenWithTag(marker, tag)[0];
  const text =
    child === undefined
      ? undefined
      : child.children
          .map((node) => (node.type === "text" ? node.value : ""))
          .join("");
  const parsed = text === undefined || text === "" ? Number.NaN : Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

// An anchor-level numeric attribute (xdr:ext's cx/cy): the same degrade-to-0 contract readAnchorChild gives a marker's child-text values, never a NaN frame.
function numericAttr(element: XmlElement, name: string): number {
  const raw = attr(element, name);
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readAnchorMarker(
  parent: XmlElement,
  tag: string,
): AnchorMarker | undefined {
  const marker = childrenWithTag(parent, tag)[0];
  if (marker === undefined) {
    return undefined;
  }
  return {
    column: readAnchorChild(marker, "xdr:col"),
    colOffEmu: readAnchorChild(marker, "xdr:colOff"),
    row: readAnchorChild(marker, "xdr:row"),
    rowOffEmu: readAnchorChild(marker, "xdr:rowOff"),
  };
}

// The anchor's own xdr:ext sizing (cx/cy EMU) -- the to-marker's job in the one-cell and absolute spellings, where the frame's size rides the anchor rather than a second marker.
function readAnchorExtEmu(
  anchor: XmlElement,
): { readonly cxEmu: number; readonly cyEmu: number } | undefined {
  const ext = childrenWithTag(anchor, "xdr:ext")[0];
  if (ext === undefined) {
    return undefined;
  }
  return { cxEmu: numericAttr(ext, "cx"), cyEmu: numericAttr(ext, "cy") };
}

// One anchor's placement: a two-cell anchor is positioned by its from-marker and sized by the to-marker difference, a one-cell anchor by its from-marker and its own xdr:ext, an absolute anchor by its page-absolute xdr:pos (re-based into the cell anchor vocabulary through the grid geometry's own inverse, since ContentSheetImage and ContentEmbeddedObject anchor cell-relatively) and its own xdr:ext. Undefined when the anchor's own geometry is malformed (a missing marker, pos, or ext), which skips the anchor the way the walk always has.
function readAnchorPlacement(
  anchor: XmlElement,
  geometry: SheetGridGeometry,
): AnchorPlacement | undefined {
  if (anchor.tag === "xdr:twoCellAnchor") {
    const from = readAnchorMarker(anchor, "xdr:from");
    const to = readAnchorMarker(anchor, "xdr:to");
    if (from === undefined || to === undefined) {
      return undefined;
    }
    const xPt = geometry.xPt(from.column, from.colOffEmu);
    const yPt = geometry.yPt(from.row, from.rowOffEmu);
    return {
      xPt,
      yPt,
      widthPt: geometry.xPt(to.column, to.colOffEmu) - xPt,
      heightPt: geometry.yPt(to.row, to.rowOffEmu) - yPt,
      anchorRow: from.row,
      anchorColumn: from.column,
      offsetXPt: emuToPt(from.colOffEmu),
      offsetYPt: emuToPt(from.rowOffEmu),
    };
  }
  if (anchor.tag === "xdr:oneCellAnchor") {
    const from = readAnchorMarker(anchor, "xdr:from");
    const ext = readAnchorExtEmu(anchor);
    if (from === undefined || ext === undefined) {
      return undefined;
    }
    return {
      xPt: geometry.xPt(from.column, from.colOffEmu),
      yPt: geometry.yPt(from.row, from.rowOffEmu),
      widthPt: emuToPt(ext.cxEmu),
      heightPt: emuToPt(ext.cyEmu),
      anchorRow: from.row,
      anchorColumn: from.column,
      offsetXPt: emuToPt(from.colOffEmu),
      offsetYPt: emuToPt(from.rowOffEmu),
    };
  }
  // xdr:absoluteAnchor, the one other spelling the walk admits.
  const pos = childrenWithTag(anchor, "xdr:pos")[0];
  const ext = readAnchorExtEmu(anchor);
  if (pos === undefined || ext === undefined) {
    return undefined;
  }
  const xPt = emuToPt(numericAttr(pos, "x"));
  const yPt = emuToPt(numericAttr(pos, "y"));
  const column = geometry.locateColumn(xPt);
  const row = geometry.locateRow(yPt);
  return {
    xPt,
    yPt,
    widthPt: emuToPt(ext.cxEmu),
    heightPt: emuToPt(ext.cyEmu),
    anchorRow: row.index,
    anchorColumn: column.index,
    offsetXPt: column.offsetPt,
    offsetYPt: row.offsetPt,
  };
}

// A minimal, childless worksheet element for the payload sheet's own print settings -- the same all-defaults ContentSheetPrintSettings readPrintSettings produces for an empty worksheet, which is the honest spelling for a synthesized sheet that never had a page setup of its own.
function emptyWorksheet(): XmlElement {
  return { type: "element", tag: "worksheet", attributes: [], children: [] };
}

// readChartTable's table laid out as the payload sheet's sparse cells: the header row's series names over the category column, one row per category, values verbatim c:v text -- chart caches carry no typed-cell concept to preserve beyond the string itself, which is why every populated cell is the string kind.
function chartCells(
  chartRoot: XmlElement,
  frame: ContentEmbeddedObject["frame"],
): ContentSheetCell[] {
  const table = readChartTable(chartRoot, frame);
  if (table === undefined) {
    return [];
  }
  const cells: ContentSheetCell[] = [];
  table.rows.forEach((row, rowIndex) => {
    row.cells.forEach((cell, columnIndex) => {
      const text = cell.blocks
        .map((block) =>
          block.kind === "paragraph"
            ? block.runs.map((run) => run.text).join("")
            : "",
        )
        .join("");
      if (text !== "") {
        cells.push({
          row: rowIndex,
          column: columnIndex,
          value: { kind: "string", value: text },
          displayText: text,
        });
      }
    });
  });
  return cells;
}

// One worksheet's whole drawing read: chart graphic frames as embedded objects (undefined when the sheet references no drawing part or carries no chart frame, so the sheet's embeddedObjects field stays absent in the common case) and pictures as sheet images ([] for the same reasons -- ContentSheetSchema demands the array itself, so empty is spelled empty rather than absent).
export interface SheetDrawing {
  readonly embeddedObjects: ContentEmbeddedObject[] | undefined;
  readonly images: ContentSheetImage[];
}

// The anchor spellings a drawing part carries that this reader walks, in the drawing's own document order -- a real drawing mixes spellings (a twoCellAnchor chart beside oneCellAnchor pictures), and each row lands in the order the part spells them.
const ANCHOR_TAGS = [
  "xdr:twoCellAnchor",
  "xdr:oneCellAnchor",
  "xdr:absoluteAnchor",
];

// Reads one worksheet's drawing anchors in a single walk -- the drawing part is resolved, its relationships parsed, and the grid geometry built once for both rows, each anchor's placement computed once for whatever content it carries.
export function readSheetDrawing(
  pkg: Package,
  worksheetPath: string,
  worksheet: XmlElement,
): SheetDrawing {
  let drawingPath: string | undefined;
  for (const rel of resolveRelationships(pkg, worksheetPath).values()) {
    if (rel.type.endsWith(DRAWING_REL_SUFFIX)) {
      drawingPath = rel.target;
      break;
    }
  }
  if (drawingPath === undefined) {
    return { embeddedObjects: undefined, images: [] };
  }
  const drawingRoot = rootElement(pkg.parts[drawingPath]);
  if (drawingRoot === undefined) {
    return { embeddedObjects: undefined, images: [] };
  }
  const drawingRels = resolveRelationships(pkg, drawingPath);
  const geometry = new SheetGridGeometry(worksheet);
  const objects: ContentEmbeddedObject[] = [];
  const images: ContentSheetImage[] = [];
  for (const node of drawingRoot.children) {
    if (node.type !== "element" || !ANCHOR_TAGS.includes(node.tag)) {
      continue;
    }
    const placement = readAnchorPlacement(node, geometry);
    if (placement === undefined) {
      continue;
    }
    const frameBox = {
      xPt: placement.xPt,
      yPt: placement.yPt,
      widthPt: placement.widthPt,
      heightPt: placement.heightPt,
    };
    for (const frame of elementsWithTag([node], "xdr:graphicFrame")) {
      const chart = readChartFrame(pkg, frame, drawingRels);
      if (chart === undefined) {
        continue;
      }
      objects.push({
        objectKind: "chart",
        document: chartDocument(pkg, chart.root, frameBox, chart.name),
        frame: frameBox,
        anchorRow: placement.anchorRow,
        anchorColumn: placement.anchorColumn,
        offsetXPt: placement.offsetXPt,
        offsetYPt: placement.offsetYPt,
      });
    }
    for (const pic of elementsWithTag([node], "xdr:pic")) {
      const media = readPictureMedia(pkg, pic, drawingRels);
      if (media === undefined) {
        continue;
      }
      // ContentSheetImage's widthPt/heightPt are positive by schema, so a degenerate anchor -- a to-marker sitting at or before its from-marker, or a non-positive ext size -- has no spelling here and is skipped rather than emitted invalid.
      if (placement.widthPt <= 0 || placement.heightPt <= 0) {
        continue;
      }
      images.push({
        kind: "image",
        format: media.format,
        base64: media.base64,
        widthPt: placement.widthPt,
        heightPt: placement.heightPt,
        anchorRow: placement.anchorRow,
        anchorColumn: placement.anchorColumn,
        offsetXPt: placement.offsetXPt,
        offsetYPt: placement.offsetYPt,
      });
    }
  }
  return {
    embeddedObjects: objects.length === 0 ? undefined : objects,
    images,
  };
}

// Resolves an xdr:pic's a:blip/@r:embed through the drawing part's relationships to sniffed media bytes -- undefined when the id, relationship, part, or magic bytes don't line up, the same contract as the pptx picture reader's readBlipImage, never trusting the media part's own extension.
function readPictureMedia(
  pkg: Package,
  pic: XmlElement,
  drawingRels: ReadonlyMap<string, { readonly target: string }>,
): { format: ImageFormat; base64: string } | undefined {
  const blip = elementsWithTag([pic], "a:blip")[0];
  const rId = blip === undefined ? undefined : attr(blip, "r:embed");
  const target = rId === undefined ? undefined : drawingRels.get(rId)?.target;
  const mediaPart = target === undefined ? undefined : pkg.parts[target];
  if (mediaPart?.kind !== "binary") {
    return undefined;
  }
  const format = sniffImageFormat(base64ToBytes(mediaPart.base64));
  return format === undefined
    ? undefined
    : { format, base64: mediaPart.base64 };
}

function readChartFrame(
  pkg: Package,
  frame: XmlElement,
  drawingRels: ReadonlyMap<string, { readonly target: string }> | undefined,
): { root: XmlElement; name: string } | undefined {
  const graphic = childrenWithTag(frame, "a:graphic")[0];
  const graphicData =
    graphic === undefined
      ? undefined
      : childrenWithTag(graphic, "a:graphicData")[0];
  if (
    graphicData === undefined ||
    attr(graphicData, "uri") !== CHART_GRAPHIC_URI
  ) {
    return undefined;
  }
  const chartRef = childrenWithTag(graphicData, "c:chart")[0];
  const rId = chartRef === undefined ? undefined : attr(chartRef, "r:id");
  const target = rId === undefined ? undefined : drawingRels?.get(rId)?.target;
  const chartRoot =
    target === undefined ? undefined : rootElement(pkg.parts[target]);
  if (chartRoot === undefined) {
    return undefined;
  }
  const cNvPr = elementsWithTag([frame], "xdr:cNvPr")[0];
  return {
    root: chartRoot,
    name: cNvPr === undefined ? "Chart" : (attr(cNvPr, "name") ?? "Chart"),
  };
}

function chartDocument(
  pkg: Package,
  chartRoot: XmlElement,
  frame: ContentEmbeddedObject["frame"],
  name: string,
): ContentDocument {
  return {
    kind: "spreadsheet",
    metadata: readCoreProperties(pkg),
    sheets: [
      {
        name,
        cells: chartCells(chartRoot, frame),
        columns: [],
        rows: [],
        images: [],
        printSettings: readPrintSettings(emptyWorksheet(), 0, new Map()),
      },
    ],
  };
}
