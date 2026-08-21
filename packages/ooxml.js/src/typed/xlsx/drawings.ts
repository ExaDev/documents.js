import type { ContentDocument, ContentEmbeddedObject, ContentSheetCell, ContentSheetImage } from 'document-schema.js';
import type { Package } from '../../model/package';
import type { XmlElement } from '../../model/node';
import { readChartTable } from '../pptx/chart';
import { readCoreProperties } from '../shared/metadata';
import { resolveBlipMedia } from '../shared/drawingml';
import { emuToPt } from '../shared/units';
import type { Relationship } from '../util';
import { attr, childrenWithTag, elementsWithTag, resolveRelationships, rootElement } from '../util';
import { readPrintSettings } from './print-settings';
import { columnWidthCharsToPt, DEFAULT_COLUMN_WIDTH_CHARS, DEFAULT_ROW_HEIGHT_PT } from './units';

// A worksheet's drawing layer (xl/drawings/drawingN.xml, reached through the worksheet's own relationships): the xlsx counterpart of pptx's chart/SmartArt/OLE/picture readers. A chart graphic frame's cached series/category model is read through the SAME chart reader the pptx side uses (readChartTable), and lands as a ContentEmbeddedObject with objectKind 'chart' -- the one member that names what the frame held rather than a ContentDocument kind, carrying the cached model as a small spreadsheet document (one sheet whose cells are that table), because a sheet is the honest document-granularity spelling of tabular data and a xlsx sheet has no block flow to host a table block the way a pptx shape does. A drawing's pictures (xdr:pic) are blip-resolved through the SAME shared primitive the pptx picture reader uses (resolveBlipMedia) and land as ContentSheet.images -- the sheet-anchored image shape, since a spreadsheet anchors its pictures to cells rather than hosting an image block in a flow.
//
// Scope limits: an xdr:absoluteAnchor (page-absolute placement, which a spreadsheet's cell grid cannot express anyway) is skipped, as is any other anchor content this module does not name. Real-producer verification is outstanding: the fixtures this is built against are hand-built ECMA-376 markup, the corpus gate the construct inventory itself states.

const CHART_GRAPHIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const DRAWING_REL_SUFFIX = '/drawing';

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
    const cols = childrenWithTag(worksheet, 'cols')[0];
    if (cols !== undefined) {
      for (const col of childrenWithTag(cols, 'col')) {
        const min = Number.parseInt(attr(col, 'min') ?? '', 10);
        const max = Number.parseInt(attr(col, 'max') ?? '', 10);
        const widthRaw = attr(col, 'width');
        const widthPt = widthRaw === undefined ? undefined : columnWidthCharsToPt(Number(widthRaw));
        if (Number.isInteger(min) && Number.isInteger(max) && min >= 1 && max >= min) {
          this.columns.push({ min: min - 1, max: max - 1, widthPt: Number.isFinite(widthPt) ? widthPt : undefined });
        }
      }
    }
    const sheetFormatPr = childrenWithTag(worksheet, 'sheetFormatPr')[0];
    const defaultRaw = sheetFormatPr === undefined ? undefined : attr(sheetFormatPr, 'defaultRowHeight');
    const parsed = defaultRaw === undefined ? Number.NaN : Number(defaultRaw);
    this.defaultRowHeightPt = Number.isFinite(parsed) ? parsed : DEFAULT_ROW_HEIGHT_PT;
    const sheetData = childrenWithTag(worksheet, 'sheetData')[0];
    if (sheetData !== undefined) {
      for (const row of childrenWithTag(sheetData, 'row')) {
        const r = Number.parseInt(attr(row, 'r') ?? '', 10);
        const htRaw = attr(row, 'ht');
        const ht = htRaw === undefined ? Number.NaN : Number(htRaw);
        if (Number.isInteger(r) && r >= 1 && Number.isFinite(ht)) {
          this.rowHeights.set(r - 1, ht);
        }
      }
    }
  }

  columnWidthPt(index: number): number {
    const covering = this.columns.find((column) => index >= column.min && index <= column.max && column.widthPt !== undefined);
    return covering?.widthPt ?? columnWidthCharsToPt(DEFAULT_COLUMN_WIDTH_CHARS);
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
}

interface AnchorMarker {
  readonly column: number;
  readonly colOffEmu: number;
  readonly row: number;
  readonly rowOffEmu: number;
}

// A marker's own child values: xdr:col/xdr:colOff/xdr:row/xdr:rowOff carry their numbers as TEXT content, not attributes, unlike most of the numeric vocabulary this package reads. A malformed value degrades to 0 the way this family's other numeric readers degrade, never to a NaN frame; a marker's col/row are 0-based grid indices.
function readAnchorChild(marker: XmlElement, tag: string): number {
  const child = childrenWithTag(marker, tag)[0];
  const text = child === undefined ? undefined : child.children.map((node) => (node.type === 'text' ? node.value : '')).join('');
  const parsed = text === undefined || text === '' ? Number.NaN : Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readAnchorMarker(parent: XmlElement, tag: string): AnchorMarker | undefined {
  const marker = childrenWithTag(parent, tag)[0];
  if (marker === undefined) {
    return undefined;
  }
  return { column: readAnchorChild(marker, 'xdr:col'), colOffEmu: readAnchorChild(marker, 'xdr:colOff'), row: readAnchorChild(marker, 'xdr:row'), rowOffEmu: readAnchorChild(marker, 'xdr:rowOff') };
}

// A minimal, childless worksheet element for the payload sheet's own print settings -- the same all-defaults ContentSheetPrintSettings readPrintSettings produces for an empty worksheet, which is the honest spelling for a synthesized sheet that never had a page setup of its own.
function emptyWorksheet(): XmlElement {
  return { type: 'element', tag: 'worksheet', attributes: [], children: [] };
}

// readChartTable's table laid out as the payload sheet's sparse cells: the header row's series names over the category column, one row per category, values verbatim c:v text -- chart caches carry no typed-cell concept to preserve beyond the string itself, which is why every populated cell is the string kind.
function chartCells(chartRoot: XmlElement, frame: ContentEmbeddedObject['frame']): ContentSheetCell[] {
  const table = readChartTable(chartRoot, frame);
  if (table === undefined) {
    return [];
  }
  const cells: ContentSheetCell[] = [];
  table.rows.forEach((row, rowIndex) => {
    row.cells.forEach((cell, columnIndex) => {
      const text = cell.blocks.map((block) => (block.kind === 'paragraph' ? block.runs.map((run) => run.text).join('') : '')).join('');
      if (text !== '') {
        cells.push({ row: rowIndex, column: columnIndex, value: { kind: 'string', value: text }, displayText: text });
      }
    });
  });
  return cells;
}

// Reads one worksheet's whole drawing layer -- its pictures and its chart graphic frames -- in one walk, since both anchor kinds resolve their geometry through the same anchor markers and the same SheetGridGeometry. Returns undefined when the sheet references no drawing part, so a drawing-less sheet's images stay empty and its embeddedObjects field absent.
export function readSheetDrawing(pkg: Package, worksheetPath: string, worksheet: XmlElement): { images: ContentSheetImage[]; embeddedObjects: ContentEmbeddedObject[] } | undefined {
  const drawingRel = [...resolveRelationships(pkg, worksheetPath).values()].find((rel) => rel.type.endsWith(DRAWING_REL_SUFFIX));
  const drawingRoot = drawingRel === undefined ? undefined : rootElement(pkg.parts[drawingRel.target]);
  if (drawingRel === undefined || drawingRoot === undefined) {
    return undefined;
  }
  const drawingRels = resolveRelationships(pkg, drawingRel.target);
  const geometry = new SheetGridGeometry(worksheet);
  const images: ContentSheetImage[] = [];
  const objects: ContentEmbeddedObject[] = [];
  for (const anchor of childrenWithTag(drawingRoot, 'xdr:twoCellAnchor')) {
    const from = readAnchorMarker(anchor, 'xdr:from');
    const to = readAnchorMarker(anchor, 'xdr:to');
    if (from === undefined || to === undefined) {
      continue;
    }
    const xPt = geometry.xPt(from.column, from.colOffEmu);
    const yPt = geometry.yPt(from.row, from.rowOffEmu);
    const frameBox = { xPt, yPt, widthPt: geometry.xPt(to.column, to.colOffEmu) - xPt, heightPt: geometry.yPt(to.row, to.rowOffEmu) - yPt };
    // The anchor's own anchored object is one of the anchor's direct children per CT_TwoCellAnchor's choice group; the descendant search mirrors the graphic-frame arm's own spelling and tolerates a producer wrapping the object one level deeper.
    for (const pic of elementsWithTag([anchor], 'xdr:pic')) {
      const media = resolveBlipMedia(pic, drawingRels, pkg);
      if (media === undefined) {
        continue;
      }
      images.push({ kind: 'image', format: media.format, base64: media.base64, widthPt: frameBox.widthPt, heightPt: frameBox.heightPt, anchorRow: from.row, anchorColumn: from.column, offsetXPt: emuToPt(from.colOffEmu), offsetYPt: emuToPt(from.rowOffEmu) });
    }
    for (const frame of elementsWithTag([anchor], 'xdr:graphicFrame')) {
      const chart = readChartFrame(pkg, frame, drawingRels);
      if (chart === undefined) {
        continue;
      }
      objects.push({
        objectKind: 'chart',
        document: chartDocument(pkg, chart.root, frameBox, chart.name),
        frame: frameBox,
        anchorRow: from.row,
        anchorColumn: from.column,
        offsetXPt: emuToPt(from.colOffEmu),
        offsetYPt: emuToPt(from.rowOffEmu),
      });
    }
  }
  return { images, embeddedObjects: objects };
}

function readChartFrame(pkg: Package, frame: XmlElement, drawingRels: ReadonlyMap<string, Relationship>): { root: XmlElement; name: string } | undefined {
  const graphic = childrenWithTag(frame, 'a:graphic')[0];
  const graphicData = graphic === undefined ? undefined : childrenWithTag(graphic, 'a:graphicData')[0];
  if (graphicData === undefined || attr(graphicData, 'uri') !== CHART_GRAPHIC_URI) {
    return undefined;
  }
  const chartRef = childrenWithTag(graphicData, 'c:chart')[0];
  const rId = chartRef === undefined ? undefined : attr(chartRef, 'r:id');
  const target = rId === undefined ? undefined : drawingRels?.get(rId)?.target;
  const chartRoot = target === undefined ? undefined : rootElement(pkg.parts[target]);
  if (chartRoot === undefined) {
    return undefined;
  }
  const cNvPr = elementsWithTag([frame], 'xdr:cNvPr')[0];
  return { root: chartRoot, name: cNvPr === undefined ? 'Chart' : (attr(cNvPr, 'name') ?? 'Chart') };
}

function chartDocument(pkg: Package, chartRoot: XmlElement, frame: ContentEmbeddedObject['frame'], name: string): ContentDocument {
  return {
    kind: 'spreadsheet',
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
