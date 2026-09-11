import type {
  ContentEmbeddedObject,
  ContentSheetCell,
  ContentSheetImage,
  LayoutMetadata,
} from "document-schema.js";
import { PAGE_SIZE_LETTER } from "document-schema.js";

import type { FormulaSheetContext } from "../biff/ptg";
import {
  RECORD_MSODRAWING,
  RECORD_OBJ,
  BOF_TYPE_CHART,
} from "../biff/record-types";
import type { RecordGroup, Substream } from "../biff/substreams";
import {
  columnWidthToPoints,
  DEFAULT_COLUMN_WIDTH_CHARS,
  DEFAULT_ROW_HEIGHT_PT,
} from "../units";
import type { BlipImage } from "../drawing/blips";
import { concatBytes } from "../drawing/bytes";
import {
  readSheetShapes,
  type DrawingShape,
  type ShapeAnchor,
} from "../drawing/shapes";
import { SHAPE_TYPE_PICTURE_FRAME } from "../drawing/escher-constants";
import { readObjTypeAndId, readObjPictFmlaStorageId } from "./comments";
import { readChartSeries, type ChartRangeContext } from "./chart";
import { readEmbeddedObjectPackage } from "./embedded-object";
import type { RawColumn, RawRow } from "./sheet";

// One worksheet's own drawing content: pictures (ContentSheetImage) and everything else a shape can hold that has no dedicated image slot -- a chart ([MS-XLS] "Obj" ftCmo objType Chart, resolved through its own nested BOF(dt=chart)...EOF substream, see chart.ts) or a generic autoshape/textbox/line (objectKind 'drawing', a ContentDrawPage of one ContentShape). A shape's own drawing geometry (Sp/Opt/ClientAnchor, drawing/shapes.ts) and the Obj record naming what it actually IS pair up 1:1, in document order, across the worksheet substream's own MsoDrawing/Obj records -- the same positional correlation every real BIFF8 reader (this reader's own design, cross-checked against how Apache POI's EscherAggregate and xlrd both resolve this exact pairing) relies on, since neither record names the other directly.

/** [MS-XLS] "FtCmo" ot enumeration, the values this reader routes on. */
const OBJECT_TYPE_CHART = 0x05;
const OBJECT_TYPE_PICTURE = 0x08;
/** The Note object type comments.ts's own Note/Obj/Txo reading already fully accounts for -- a comment's own callout box carries an MsoDrawing shape too, and pairing it here as well would emit a spurious, contentless 'drawing' embedded object for every cell comment on the sheet. */
const OBJECT_TYPE_NOTE = 0x19;

export interface SheetDrawing {
  readonly images: readonly ContentSheetImage[];
  readonly embeddedObjects: readonly ContentEmbeddedObject[];
}

export interface SheetDrawingContext {
  readonly blipStore: ReadonlyMap<number, BlipImage>;
  readonly columns: readonly RawColumn[];
  readonly rows: readonly RawRow[];
  readonly ownSheetIndex: number;
  readonly formulaSheets: FormulaSheetContext;
  readonly ownSheetCells: readonly ContentSheetCell[];
  readonly metadata: LayoutMetadata;
  /** Every substream the workbook stream carries -- searched for the chart substream a Chart-type Obj record's own nested BOF...EOF produced (splitSubstreams reports it as its own entry, positioned by byte offset rather than nested inside the worksheet's own `records`; see biff/substreams.ts's own top comment for why). */
  readonly allSubstreams: readonly Substream[];
  /** Every "MBD<hex>/Package" Embedding Storage the outer compound file carries, keyed by the storage id a Picture-type Obj record's own FtPictFmla names (container.ts's own readWorkbookStreams) -- resolved here for a Picture Obj record whose data lives in an OLE embedding rather than the workbook-wide Blip Store. */
  readonly embeddingStreams: ReadonlyMap<number, Uint8Array<ArrayBuffer>>;
}

const GRID_UNITS_X = 1024;
const GRID_UNITS_Y = 256;

/** The worksheet grid geometry a cell anchor resolves against -- declared column widths/row heights with Excel's own Normal-style default beneath, mirroring ooxml.js's identical SheetGridGeometry for the xlsx case. */
class SheetGridGeometry {
  private readonly columnWidths = new Map<number, number>();
  private readonly rowHeights = new Map<number, number>();
  private readonly defaultColumnWidthPt = columnWidthToPoints(
    DEFAULT_COLUMN_WIDTH_CHARS * 256,
  );

  constructor(columns: readonly RawColumn[], rows: readonly RawRow[]) {
    for (const column of columns) {
      if (column.widthPt !== undefined) {
        this.columnWidths.set(column.index, column.widthPt);
      }
    }
    for (const row of rows) {
      if (row.heightPt !== undefined) {
        this.rowHeights.set(row.index, row.heightPt);
      }
    }
  }

  columnWidthPt(index: number): number {
    return this.columnWidths.get(index) ?? this.defaultColumnWidthPt;
  }

  rowHeightPt(index: number): number {
    return this.rowHeights.get(index) ?? DEFAULT_ROW_HEIGHT_PT;
  }

  /** The absolute page-space X of a given column's own left edge -- the cumulative width of every column before it. */
  xPt(column: number): number {
    let x = 0;
    for (let index = 0; index < column; index += 1) {
      x += this.columnWidthPt(index);
    }
    return x;
  }

  yPt(row: number): number {
    let y = 0;
    for (let index = 0; index < row; index += 1) {
      y += this.rowHeightPt(index);
    }
    return y;
  }
}

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

/** Resolves an OfficeArtClientAnchorSheet into the cell-relative placement ContentSheetImage/ContentEmbeddedObject both carry, plus the page-absolute frame box a Box's own xPt/yPt/widthPt/heightPt need -- dxL/dxR in 1/1024ths of the anchor cell's own width, dyT/dyB in 1/256ths of its own height ([MS-XLS] 2.5.163). */
function resolveAnchorPlacement(
  anchor: ShapeAnchor,
  geometry: SheetGridGeometry,
): AnchorPlacement {
  const offsetXPt =
    (geometry.columnWidthPt(anchor.colL) * anchor.dxL) / GRID_UNITS_X;
  const offsetYPt =
    (geometry.rowHeightPt(anchor.rwT) * anchor.dyT) / GRID_UNITS_Y;
  const xPt = geometry.xPt(anchor.colL) + offsetXPt;
  const yPt = geometry.yPt(anchor.rwT) + offsetYPt;
  const rightPt =
    geometry.xPt(anchor.colR) +
    (geometry.columnWidthPt(anchor.colR) * anchor.dxR) / GRID_UNITS_X;
  const bottomPt =
    geometry.yPt(anchor.rwB) +
    (geometry.rowHeightPt(anchor.rwB) * anchor.dyB) / GRID_UNITS_Y;
  return {
    xPt,
    yPt,
    widthPt: rightPt - xPt,
    heightPt: bottomPt - yPt,
    anchorRow: anchor.rwT,
    anchorColumn: anchor.colL,
    offsetXPt,
    offsetYPt,
  };
}

/** Reads one worksheet's own drawing content: every MsoDrawing record's bytes concatenated into one Escher stream (drawing/shapes.ts), each of its real top-level shapes paired 1:1, in document order, with the non-Note Obj records the same substream carries. */
export function readSheetDrawing(
  worksheetRecords: readonly RecordGroup[],
  context: SheetDrawingContext,
): SheetDrawing {
  const drawingChunks: Uint8Array<ArrayBuffer>[] = [];
  // nextOffset bounds where a Chart-type Obj record's own nested substream can be found: the first worksheet record AFTER this Obj in the true stream, which -- because splitSubstreams' own nesting fix carves a chart substream's records out of `worksheetRecords` entirely -- is exactly the byte position a chart's own EOF closed before. Without this upper bound a workbook with more than one embedded chart could match a LATER chart's own BOF instead of the one this specific Obj record actually precedes.
  const objEntries: {
    readonly ot: number;
    readonly offset: number;
    readonly nextOffset: number;
    readonly group: RecordGroup;
  }[] = [];
  for (let index = 0; index < worksheetRecords.length; index += 1) {
    const record = worksheetRecords[index];
    if (record === undefined) {
      continue;
    }
    if (record.type === RECORD_MSODRAWING) {
      // record.blocks is the whole group -- the base MsoDrawing record's own data plus every Continue record chained onto it ([MS-XLS] 2.4.180); a real picture's blip bytes routinely exceed one record's 8224-byte ceiling, so only reading blocks[0] would silently truncate the Escher stream for any sheet carrying an image past that size.
      drawingChunks.push(...record.blocks);
      continue;
    }
    if (record.type === RECORD_OBJ) {
      const { ot } = readObjTypeAndId(record);
      const nextOffset =
        worksheetRecords[index + 1]?.offset ?? Number.POSITIVE_INFINITY;
      objEntries.push({ ot, offset: record.offset, nextOffset, group: record });
    }
  }
  if (drawingChunks.length === 0) {
    return { images: [], embeddedObjects: [] };
  }
  const drawingBytes = concatBytes(drawingChunks);
  const shapes = readSheetShapes(drawingBytes);
  const geometry = new SheetGridGeometry(context.columns, context.rows);

  const images: ContentSheetImage[] = [];
  const embeddedObjects: ContentEmbeddedObject[] = [];
  const pairCount = Math.min(shapes.length, objEntries.length);
  for (let index = 0; index < pairCount; index += 1) {
    const shape = shapes[index];
    const obj = objEntries[index];
    if (
      shape === undefined ||
      obj === undefined ||
      obj.ot === OBJECT_TYPE_NOTE
    ) {
      continue;
    }
    if (
      obj.ot === OBJECT_TYPE_PICTURE ||
      shape.shapeType === SHAPE_TYPE_PICTURE_FRAME
    ) {
      const embedded = embeddedObjectFromObjRecord(
        obj.group,
        shape,
        context,
        geometry,
      );
      if (embedded !== undefined) {
        embeddedObjects.push(embedded);
        continue;
      }
      const image = imageFromShape(shape, context, geometry);
      if (image !== undefined) {
        images.push(image);
      }
      continue;
    }
    if (obj.ot === OBJECT_TYPE_CHART) {
      const chart = chartFromShape(
        shape,
        obj.offset,
        obj.nextOffset,
        context,
        geometry,
      );
      if (chart !== undefined) {
        embeddedObjects.push(chart);
      }
      continue;
    }
    const drawing = drawingObjectFromShape(shape, geometry);
    if (drawing !== undefined) {
      embeddedObjects.push(drawing);
    }
  }
  return { images, embeddedObjects };
}

/** A Picture-type Obj record whose FtPictFmla names an Embedding Storage this workbook's own outer compound file carries: resolved through readEmbeddedObjectPackage rather than the plain Blip Store path imageFromShape covers, since an OLE-embedded object's data lives in that storage's own Package stream instead of a pib reference into the workbook-wide Blip Store. Undefined for a plain picture (no FtPictFmla at all), an FtPictFmla naming a storage id this workbook's container did not report, or a storage whose Package stream is not this codec's own payload (readEmbeddedObjectPackage's own foreign-payload degrade) -- each falls through to imageFromShape instead. */
function embeddedObjectFromObjRecord(
  objGroup: RecordGroup,
  shape: DrawingShape,
  context: SheetDrawingContext,
  geometry: SheetGridGeometry,
): ContentEmbeddedObject | undefined {
  const storageId = readObjPictFmlaStorageId(objGroup);
  if (storageId === undefined) {
    return undefined;
  }
  const packageBytes = context.embeddingStreams.get(storageId);
  if (packageBytes === undefined) {
    return undefined;
  }
  const placement = resolveAnchorPlacement(shape.anchor, geometry);
  if (placement.widthPt <= 0 || placement.heightPt <= 0) {
    return undefined;
  }
  return readEmbeddedObjectPackage(packageBytes, {
    xPt: placement.xPt,
    yPt: placement.yPt,
    widthPt: placement.widthPt,
    heightPt: placement.heightPt,
  });
}

function imageFromShape(
  shape: DrawingShape,
  context: SheetDrawingContext,
  geometry: SheetGridGeometry,
): ContentSheetImage | undefined {
  if (shape.blipIndex === undefined) {
    return undefined;
  }
  const blip = context.blipStore.get(shape.blipIndex);
  if (blip === undefined) {
    return undefined;
  }
  const placement = resolveAnchorPlacement(shape.anchor, geometry);
  if (placement.widthPt <= 0 || placement.heightPt <= 0) {
    return undefined;
  }
  return {
    kind: "image",
    format: blip.format,
    base64: blip.base64,
    widthPt: placement.widthPt,
    heightPt: placement.heightPt,
    anchorRow: placement.anchorRow,
    anchorColumn: placement.anchorColumn,
    offsetXPt: placement.offsetXPt,
    offsetYPt: placement.offsetYPt,
  };
}

/** Locates the chart's own nested BOF(dt=chart)...EOF substream: the one whose own BOF offset falls strictly between this Obj record's offset and whichever worksheet record comes right after it in the ORIGINAL stream -- splitSubstreams' own nesting fix (biff/substreams.ts) pulls a nested chart's records out of the worksheet substream's own `records` array entirely and reports it as its own top-level Substream instead, so byte-offset containment, not array position, is what still ties the two together. */
function chartFromShape(
  shape: DrawingShape,
  objOffset: number,
  nextOffset: number,
  context: SheetDrawingContext,
  geometry: SheetGridGeometry,
): ContentEmbeddedObject | undefined {
  const chartSubstream = context.allSubstreams.find(
    (candidate) =>
      candidate.documentType === BOF_TYPE_CHART &&
      candidate.offset > objOffset &&
      candidate.offset < nextOffset,
  );
  if (chartSubstream === undefined) {
    return undefined;
  }
  const placement = resolveAnchorPlacement(shape.anchor, geometry);
  const rangeContext: ChartRangeContext = {
    formulaSheets: context.formulaSheets,
    ownSheetIndex: context.ownSheetIndex,
    ownSheetCells: context.ownSheetCells,
  };
  const series = readChartSeries(chartSubstream.records, rangeContext);
  return {
    objectKind: "chart",
    document: {
      kind: "spreadsheet",
      metadata: context.metadata,
      sheets: [
        {
          name: "Chart",
          cells: chartTableCells(series),
          columns: [],
          rows: [],
          images: [],
          printSettings: {
            pageSize: PAGE_SIZE_LETTER,
            margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
            gridlines: false,
            headers: false,
            pageOrder: "downThenOver",
          },
        },
      ],
    },
    frame: {
      xPt: placement.xPt,
      yPt: placement.yPt,
      widthPt: placement.widthPt,
      heightPt: placement.heightPt,
    },
    anchorRow: placement.anchorRow,
    anchorColumn: placement.anchorColumn,
    offsetXPt: placement.offsetXPt,
    offsetYPt: placement.offsetYPt,
  };
}

/** Lays a chart's own series out as ooxml.js's readChartTable does for the identical xlsx/pptx case: a header row of series names over the category column, then one row per category with each series' own value -- see workbook/chart.ts's own top comment for why this flattened shape, not a typed chart object, is what document-schema.js's 'chart' objectKind actually carries. */
export function chartTableCells(
  series: readonly {
    readonly name: string | undefined;
    readonly categories: readonly string[];
    readonly values: readonly string[];
  }[],
): ContentSheetCell[] {
  const cells: ContentSheetCell[] = [];
  series.forEach((entry, seriesIndex) => {
    const name = entry.name ?? "";
    if (name !== "") {
      cells.push({
        row: 0,
        column: seriesIndex + 1,
        value: { kind: "string", value: name },
        displayText: name,
      });
    }
    entry.values.forEach((value, pointIndex) => {
      if (value === "") {
        return;
      }
      cells.push({
        row: pointIndex + 1,
        column: seriesIndex + 1,
        value: { kind: "string", value },
        displayText: value,
      });
    });
  });
  // A chart's series share one category axis: the union across every series, in series order (the first series to label a given point wins), matching readChartTable's own identical convention for the xlsx/pptx case -- written once here rather than once per series, which would otherwise push one cell per series at the SAME (row, 0) position whenever two series' own category arrays disagree.
  const categories = new Map<number, string>();
  for (const entry of series) {
    entry.categories.forEach((category, pointIndex) => {
      if (category !== "" && !categories.has(pointIndex)) {
        categories.set(pointIndex, category);
      }
    });
  }
  for (const [pointIndex, category] of categories) {
    cells.push({
      row: pointIndex + 1,
      column: 0,
      value: { kind: "string", value: category },
      displayText: category,
    });
  }
  return cells;
}

/** A shape this reader recognises as neither a picture nor a chart -- an autoshape, a text box, a line, a group -- carried as a 'drawing' embedded object: a single-page ContentDocument holding one ContentShape sized and positioned at the shape's own anchor. Undefined for the patriarch/group-only case readSheetShapes already excludes, and for a shape whose own anchor collapses to zero size. */
function drawingObjectFromShape(
  shape: DrawingShape,
  geometry: SheetGridGeometry,
): ContentEmbeddedObject | undefined {
  const placement = resolveAnchorPlacement(shape.anchor, geometry);
  if (placement.widthPt <= 0 || placement.heightPt <= 0) {
    return undefined;
  }
  return {
    objectKind: "drawing",
    document: {
      kind: "drawing",
      metadata: {},
      pages: [
        {
          size: { widthPt: placement.widthPt, heightPt: placement.heightPt },
          shapes: [
            {
              frame: {
                xPt: 0,
                yPt: 0,
                widthPt: placement.widthPt,
                heightPt: placement.heightPt,
              },
              insetLeftPt: 0,
              insetTopPt: 0,
              insetRightPt: 0,
              insetBottomPt: 0,
              blocks: [],
            },
          ],
          vectors: [],
        },
      ],
    },
    frame: {
      xPt: placement.xPt,
      yPt: placement.yPt,
      widthPt: placement.widthPt,
      heightPt: placement.heightPt,
    },
    anchorRow: placement.anchorRow,
    anchorColumn: placement.anchorColumn,
    offsetXPt: placement.offsetXPt,
    offsetYPt: placement.offsetYPt,
  };
}
