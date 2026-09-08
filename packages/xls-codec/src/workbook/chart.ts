import type { ContentSheetCell } from "document-schema.js";

import { BlockCursor } from "../biff/cursor";
import type { FormulaSheetContext } from "../biff/ptg";
import {
  RECORD_AI,
  RECORD_BLANK,
  RECORD_BOOLERR,
  RECORD_LABEL,
  RECORD_NUMBER,
  RECORD_SERIES,
  RECORD_SERIESTEXT,
  RECORD_SIINDEX,
} from "../biff/record-types";
import { errorTextOf } from "../biff/errors";
import { readShortXLUnicodeString, readXLUnicodeString } from "../biff/strings";
import type { RecordGroup } from "../biff/substreams";

// A chart's own substream ([MS-XLS] "Chart Sheet Substream", https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/732ff614-d939-416b-b7c7-6d983471ff11), read only as far as document-schema.js's own chart representation needs: a flattened series/category table (ExaDev/documents.js#719 -- 'chart' is a ContentEmbeddedObject naming a chart frame's cached data as a small spreadsheet ContentDocument, the identical shape ooxml.js's own xlsx/pptx chart readers already produce via readChartTable), not a typed chart-type/axis/legend object model. So this reader walks only Series/AI(BRAI)/SeriesText -- a series' own name and its category/value data links -- and the SERIESDATA cache those links can resolve through, and reads nothing about chart type, axes, or presentation.
//
// A data-role link's own value comes from one of two places, per [MS-XLS] "Chart Data Cache" (https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/e21d24e4-e71f-4fdc-8107-7f0d6a6efa6a): "the chart data cache MUST NOT contain data ... if the corresponding data is specified in the chart or on the same sheet as the chart" -- so an embedded chart plotting its OWN sheet's cells (the overwhelmingly common case) carries no on-disk cache at all, and this reader resolves it instead by reading the AI's own formula reference (a PtgArea3d/PtgRef3d range, the same reference-token family biff/ptg.ts already resolves for a worksheet cell's own Formula record, restricted here to a single already-parsed range rather than that module's full expression grammar) and looking the referenced cells straight up in the OWNING sheet's own already-mapped cells. A chart plotting data from ANOTHER sheet, or genuinely external data, has no such shortcut available and instead carries the real on-disk SERIESDATA cache this reader also reads (`SERIESDATA = Dimensions 3(SIIndex *(Number/BoolErr/Blank/Label))`) -- one shared cache block per data role (values/categories/bubble sizes), each cached record's own `col` field naming which SERIES (0-based, into the Series-record collection) the value belongs to and its own `row` field naming the point's own 0-based position within that series. The cache is consulted FIRST and the same-sheet range fallback only when no cached entry exists for that exact (role, series, point) -- which is never both at once for a real file, per the spec's own "MUST NOT" above, but resolves the same either way if it were.

/** One resolved series: its own name (undefined when neither a SeriesText cache nor a literal/same-sheet-resolvable AI id=0 named it) and its category/value points, in point order, verbatim source text (a cache or a resolved cell's own displayText) -- exactly what readChartTable's own ChartSeries carries for the xlsx/pptx case, so chartCells below can build the identical flattened-table shape. A point this reader cannot resolve at all -- a cross-sheet or external reference with no cache entry, an unsupported AI token -- is an empty string, matching readChartTable's own "absent or empty-text label/value reads as an empty cell" convention. */
export interface ChartSeries {
  readonly name: string | undefined;
  readonly categories: readonly string[];
  readonly values: readonly string[];
}

export interface ChartRangeContext {
  readonly formulaSheets: FormulaSheetContext;
  readonly ownSheetIndex: number;
  readonly ownSheetCells: readonly ContentSheetCell[];
}

/** [MS-XLS] "BRAI" 2.4's own `id` enumeration: which data role a given AI record links. */
const AI_ID_NAME = 0x00;
const AI_ID_VALUES = 0x01;
const AI_ID_CATEGORIES = 0x02;

/** [MS-XLS] "BRAI" 2.4's own `rt` enumeration: 0 auto-generated (no formula/value at all), 1 a literal value/text carried directly in the formula's own token, 2 a genuine cell-range reference. */
const AI_RT_LITERAL = 0x01;
const AI_RT_RANGE = 0x02;

/** [MS-XLS] "SIIndex" 2.4's own `numIndex` enumeration: which of the three SERIESDATA cache blocks follows. */
const SIINDEX_VALUES = 0x0001;
const SIINDEX_CATEGORIES = 0x0002;

type CacheRole = "values" | "categories";

/** A single-cell or rectangular range this reader resolved from an AI's own PtgRef3d/PtgArea3d token, restricted to the OWN sheet a chart is embedded in -- see this module's own top comment for why a cross-sheet reference has no shortcut here and falls back to the on-disk cache instead. */
interface OwnSheetRange {
  readonly startRow: number;
  readonly endRow: number;
  readonly startColumn: number;
  readonly endColumn: number;
}

interface SeriesBuilder {
  literalName: string | undefined;
  cachedName: string | undefined;
  valuesRange: OwnSheetRange | undefined;
  categoriesRange: OwnSheetRange | undefined;
  valueCount: number;
  categoryCount: number;
}

/** Reads one chart substream's records (BOF/EOF already stripped by splitSubstreams) into its flattened series table. */
export function readChartSeries(
  records: readonly RecordGroup[],
  context: ChartRangeContext,
): readonly ChartSeries[] {
  const seriesBuilders: SeriesBuilder[] = [];
  const cache = new Map<CacheRole, Map<number, Map<number, string>>>();
  let currentCacheRole: CacheRole | undefined;
  let pendingNameAiId: number | undefined;

  for (const record of records) {
    switch (record.type) {
      case RECORD_SERIES:
        seriesBuilders.push(readSeriesHeader(record));
        break;
      case RECORD_AI: {
        const current = seriesBuilders[seriesBuilders.length - 1];
        if (current !== undefined) {
          readAiRecord(record, current, context);
        }
        pendingNameAiId = readAiId(record);
        break;
      }
      case RECORD_SERIESTEXT: {
        const current = seriesBuilders[seriesBuilders.length - 1];
        if (current !== undefined && pendingNameAiId === AI_ID_NAME) {
          current.cachedName = readSeriesText(record);
        }
        pendingNameAiId = undefined;
        break;
      }
      case RECORD_SIINDEX:
        currentCacheRole = readCacheRole(record);
        break;
      case RECORD_NUMBER:
      case RECORD_BOOLERR:
      case RECORD_BLANK:
      case RECORD_LABEL:
        if (currentCacheRole !== undefined) {
          addCacheEntry(cache, currentCacheRole, record);
        }
        break;
      default:
        break;
    }
  }

  return seriesBuilders.map((builder, seriesIndex) => ({
    name: builder.cachedName ?? builder.literalName,
    categories: resolvePoints(
      builder.categoryCount,
      seriesIndex,
      builder.categoriesRange,
      cache.get("categories"),
      context,
    ),
    values: resolvePoints(
      builder.valueCount,
      seriesIndex,
      builder.valuesRange,
      cache.get("values"),
      context,
    ),
  }));
}

/** [MS-OGRAPH] "Series" (https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ograph/54527b2d-d529-4128-9a7f-a224cc575080): sdtX, sdtY (both a fixed, ignored data-type tag), cValx (category/point count), cValy (value count), sdtBSize (ignored), cValBSize (bubble-size count, not modelled). Only the two counts this reader actually resolves points against are kept. */
function readSeriesHeader(record: RecordGroup): SeriesBuilder {
  const cursor = new BlockCursor(record.blocks);
  cursor.skip(2); // sdtX
  cursor.skip(2); // sdtY
  const categoryCount = cursor.u16();
  const valueCount = cursor.u16();
  return {
    literalName: undefined,
    cachedName: undefined,
    valuesRange: undefined,
    categoriesRange: undefined,
    valueCount,
    categoryCount,
  };
}

function readAiId(record: RecordGroup): number {
  return new BlockCursor(record.blocks).u8();
}

/** [MS-XLS] "BRAI": id, rt, a flags/ifmt word this reader skips past, then a ChartParsedFormula (cce + rgce). Only id 0 (name)/1 (values)/2 (categories) are acted on; id 3 (bubble sizes) is read past like any other record this reader recognises but does not model further. */
function readAiRecord(
  record: RecordGroup,
  series: SeriesBuilder,
  context: ChartRangeContext,
): void {
  const cursor = new BlockCursor(record.blocks);
  const id = cursor.u8();
  const rt = cursor.u8();
  cursor.skip(2); // grbit (fUnlinkedIfmt + reserved)
  cursor.skip(2); // ifmt
  const cce = cursor.u16();
  const rgce = cursor.take(cce);
  if (id === AI_ID_NAME) {
    if (rt === AI_RT_LITERAL) {
      series.literalName = readLiteralToken(rgce);
    } else if (rt === AI_RT_RANGE) {
      const range = readRangeToken(rgce, context);
      if (range !== undefined) {
        series.literalName = cellText(
          range.startRow,
          range.startColumn,
          context,
        );
      }
    }
    return;
  }
  if (rt !== AI_RT_RANGE) {
    return;
  }
  const range = readRangeToken(rgce, context);
  if (id === AI_ID_VALUES) {
    series.valuesRange = range;
  } else if (id === AI_ID_CATEGORIES) {
    series.categoriesRange = range;
  }
}

/** [MS-XLS] "SeriesText": a reserved word then a ShortXLUnicodeString (one-byte length prefix -- unlike the double-byte-length XLUnicodeString most other BIFF8 strings use). */
function readSeriesText(record: RecordGroup): string {
  const cursor = new BlockCursor(record.blocks);
  cursor.skip(2); // reserved
  return readShortXLUnicodeString(cursor);
}

function readCacheRole(record: RecordGroup): CacheRole | undefined {
  const numIndex = new BlockCursor(record.blocks).u16();
  if (numIndex === SIINDEX_VALUES) {
    return "values";
  }
  if (numIndex === SIINDEX_CATEGORIES) {
    return "categories";
  }
  return undefined;
}

/** A cached Number/BoolErr/Blank/Label record ([MS-XLS] 2.4.180/2.4.24/2.4.20/2.4.148 -- the identical worksheet cell-record layout, reinterpreted here per "Chart Data Cache": `row` is the point's own 0-based position within its series, `col` the 0-based Series-record index it belongs to, rather than a worksheet cell address). A Blank adds nothing to the cache -- an explicit "no cached value at this point" the same way an absent cache entry already reads. */
function addCacheEntry(
  cache: Map<CacheRole, Map<number, Map<number, string>>>,
  role: CacheRole,
  record: RecordGroup,
): void {
  const cursor = new BlockCursor(record.blocks);
  const point = cursor.u16();
  const series = cursor.u16();
  cursor.skip(2); // xf
  let text: string | undefined;
  switch (record.type) {
    case RECORD_NUMBER:
      text = String(cursor.f64());
      break;
    case RECORD_LABEL:
      text = readXLUnicodeString(cursor);
      break;
    case RECORD_BOOLERR: {
      const value = cursor.u8();
      const isError = cursor.u8() !== 0;
      text = isError ? errorTextOf(value) : value !== 0 ? "TRUE" : "FALSE";
      break;
    }
    default:
      return;
  }
  if (text === undefined) {
    return;
  }
  let bySeries = cache.get(role);
  if (bySeries === undefined) {
    bySeries = new Map();
    cache.set(role, bySeries);
  }
  let byPoint = bySeries.get(series);
  if (byPoint === undefined) {
    byPoint = new Map();
    bySeries.set(series, byPoint);
  }
  byPoint.set(point, text);
}

function resolvePoints(
  count: number,
  seriesIndex: number,
  range: OwnSheetRange | undefined,
  cacheForRole: Map<number, Map<number, string>> | undefined,
  context: ChartRangeContext,
): string[] {
  const cachedForSeries = cacheForRole?.get(seriesIndex);
  const points: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const cached = cachedForSeries?.get(index);
    if (cached !== undefined) {
      points.push(cached);
      continue;
    }
    if (range !== undefined) {
      const cell = pointInRange(range, index);
      points.push(cellText(cell.row, cell.column, context) ?? "");
      continue;
    }
    points.push("");
  }
  return points;
}

/** The Nth cell of a range, in reading order -- a single row walks across its columns, a single column (the common vertical-series case) walks down its rows, and a genuine rectangular box walks row-major. */
function pointInRange(
  range: OwnSheetRange,
  index: number,
): { row: number; column: number } {
  const height = range.endRow - range.startRow + 1;
  const width = range.endColumn - range.startColumn + 1;
  if (height <= 1) {
    return { row: range.startRow, column: range.startColumn + index };
  }
  if (width <= 1) {
    return { row: range.startRow + index, column: range.startColumn };
  }
  return {
    row: range.startRow + Math.floor(index / width),
    column: range.startColumn + (index % width),
  };
}

function cellText(
  row: number,
  column: number,
  context: ChartRangeContext,
): string | undefined {
  return context.ownSheetCells.find(
    (cell) => cell.row === row && cell.column === column,
  )?.displayText;
}

/** A literal AI value/text -- id=0 (name) only meets this in practice, real files always resolving categories/values through a real range. Reads exactly one leading token (skipping a PtgParen display wrapper first, since a literal is sometimes wrapped in one), and only the literal-operand family: PtgInt/PtgNum/PtgStr. Anything else is a construct this reader does not resolve, exactly like a formula token this package's own biff/ptg.ts declines to resolve elsewhere. */
function readLiteralToken(rgce: Uint8Array<ArrayBuffer>): string | undefined {
  const cursor = new BlockCursor([rgce]);
  if (!cursor.hasMore()) {
    return undefined;
  }
  let opcode = cursor.u8();
  if (opcode === 0x15 && cursor.hasMore()) {
    // PtgParen -- a display-only wrapper carrying no bytes of its own.
    opcode = cursor.u8();
  }
  switch (opcode) {
    case 0x1e: // PtgInt
      return String(cursor.u16());
    case 0x1f: // PtgNum
      return String(cursor.f64());
    case 0x17: // PtgStr
      return readShortXLUnicodeString(cursor);
    default:
      return undefined;
  }
}

/** A range-reference AI value: PtgRef3d/PtgArea3d only, restricted to a reference INTO THE CHART'S OWN OWNING SHEET (see this module's own top comment for why a cross-sheet reference has no shortcut here) -- every other token this restricted BRAI grammar permits (PtgUnion, PtgNameX, PtgMemFunc, the RefErr/AreaErr variants) is a construct this reader does not resolve, matching biff/ptg.ts's own "unsupported construct -> absent" convention for a worksheet cell's ordinary Formula record. */
function readRangeToken(
  rgce: Uint8Array<ArrayBuffer>,
  context: ChartRangeContext,
): OwnSheetRange | undefined {
  const cursor = new BlockCursor([rgce]);
  if (!cursor.hasMore()) {
    return undefined;
  }
  let opcode = cursor.u8();
  if (opcode === 0x15 && cursor.hasMore()) {
    opcode = cursor.u8();
  }
  const COLUMN_INDEX_MASK = 0x3fff;
  if (opcode === 0x3a || opcode === 0x5a || opcode === 0x7a) {
    // PtgRef3d family
    const ixti = cursor.u16();
    const row = cursor.u16();
    const column = cursor.u16() & COLUMN_INDEX_MASK;
    if (!isOwnSheetRef(ixti, context)) {
      return undefined;
    }
    return {
      startRow: row,
      endRow: row,
      startColumn: column,
      endColumn: column,
    };
  }
  if (opcode === 0x3b || opcode === 0x5b || opcode === 0x7b) {
    // PtgArea3d family
    const ixti = cursor.u16();
    const rowFirst = cursor.u16();
    const rowLast = cursor.u16();
    const columnFirst = cursor.u16() & COLUMN_INDEX_MASK;
    const columnLast = cursor.u16() & COLUMN_INDEX_MASK;
    if (!isOwnSheetRef(ixti, context)) {
      return undefined;
    }
    return {
      startRow: Math.min(rowFirst, rowLast),
      endRow: Math.max(rowFirst, rowLast),
      startColumn: Math.min(columnFirst, columnLast),
      endColumn: Math.max(columnFirst, columnLast),
    };
  }
  return undefined;
}

/** Whether ixti resolves (through EXTERNSHEET/SupBook -- the identical resolution biff/ptg.ts's resolveSheetLabel performs for a worksheet formula's own 3D references) to a single-sheet range naming exactly the chart's own owning sheet -- the only case this reader has a cell table to resolve against at all. */
function isOwnSheetRef(ixti: number, context: ChartRangeContext): boolean {
  const range = context.formulaSheets.sheetRanges[ixti];
  if (range === undefined || "label" in range) {
    return false;
  }
  return (
    range.firstSheetIndex === range.lastSheetIndex &&
    range.firstSheetIndex === context.ownSheetIndex
  );
}
