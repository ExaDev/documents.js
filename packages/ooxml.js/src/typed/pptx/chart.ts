import type { Box, ContentTable, ContentTableCell } from "document-schema.js";
import type { XmlElement } from "../../model/node";
import { attr, childrenWithTag, elementsWithTag, textContent } from "../util";

// Reads a chart part (a c:chartSpace root) into the same ContentTable shape an a:tbl graphic frame produces, so a chart reaches consumers as the series/category data it carries rather than geometry with empty content. Only the chart part's own cached model is read (c:strCache/c:numCache, or the c:numLit/c:strLit literal forms) -- the linked workbook behind c:externalData is a separate embedded package and is not opened.

// Every point-carrying source in a chart series (c:tx's name reference, c:cat/c:xVal's category axis, c:val/c:yVal's value axis) holds its points in one of three shapes: a cached reference (c:numRef > c:numCache / c:strRef > c:strCache), a multi-level cached string reference whose deepest (last) c:lvl holds the leaf labels actually rendered on the axis tick, or inline literals (c:numLit/c:strLit, whose c:pt sit directly on the source element). Returns each uniformly as idx -> verbatim c:v text.
function readCachedPoints(source: XmlElement): Map<number, string> {
  const numRef = childrenWithTag(source, "c:numRef")[0];
  const strRef = childrenWithTag(source, "c:strRef")[0];
  const multiLvlStrRef = childrenWithTag(source, "c:multiLvlStrRef")[0];
  let ptHolder: XmlElement | undefined;
  if (numRef !== undefined) {
    ptHolder = childrenWithTag(numRef, "c:numCache")[0];
  } else if (strRef !== undefined) {
    ptHolder = childrenWithTag(strRef, "c:strCache")[0];
  } else if (multiLvlStrRef !== undefined) {
    const multiLvlStrCache = childrenWithTag(
      multiLvlStrRef,
      "c:multiLvlStrCache",
    )[0];
    ptHolder =
      multiLvlStrCache === undefined
        ? undefined
        : childrenWithTag(multiLvlStrCache, "c:lvl").at(-1);
  } else {
    ptHolder = source;
  }
  const points = new Map<number, string>();
  if (ptHolder === undefined) {
    return points;
  }
  for (const pt of childrenWithTag(ptHolder, "c:pt")) {
    const idx = attr(pt, "idx");
    const v = childrenWithTag(pt, "c:v")[0];
    if (idx !== undefined && v !== undefined) {
      points.set(Number(idx), textContent(v));
    }
  }
  return points;
}

// c:tx names a series either as a cached string reference or as an inline c:v literal.
function readSeriesName(ser: XmlElement): string | undefined {
  const tx = childrenWithTag(ser, "c:tx")[0];
  if (tx === undefined) {
    return undefined;
  }
  const literal = childrenWithTag(tx, "c:v")[0];
  return literal === undefined
    ? readCachedPoints(tx).get(0)
    : textContent(literal);
}

interface ChartSeries {
  readonly name: string | undefined;
  readonly categories: ReadonlyMap<number, string>;
  readonly values: ReadonlyMap<number, string>;
}

function readSeries(ser: XmlElement): ChartSeries {
  // A scatter series (c:scatterChart) carries its axes as c:xVal/c:yVal instead of c:cat/c:val; the x axis maps onto the category column the same way.
  const catSource =
    childrenWithTag(ser, "c:cat")[0] ?? childrenWithTag(ser, "c:xVal")[0];
  const valSource =
    childrenWithTag(ser, "c:val")[0] ?? childrenWithTag(ser, "c:yVal")[0];
  return {
    name: readSeriesName(ser),
    categories:
      catSource === undefined
        ? new Map<number, string>()
        : readCachedPoints(catSource),
    values:
      valSource === undefined
        ? new Map<number, string>()
        : readCachedPoints(valSource),
  };
}

// An absent or empty-text label/value reads as an empty cell -- ContentTable's own spelling for "nothing here" (the same shape a merged-away continuation cell produces).
function labelCell(text: string | undefined): ContentTableCell {
  if (text === undefined || text === "") {
    return { blocks: [] };
  }
  return { blocks: [{ kind: "paragraph", runs: [{ text }] }] };
}

// The table layout: a header row of series names (empty corner cell over the category column), then one row per category index with each series' cached value at that index in its own column. Values stay verbatim c:v text -- chart caches carry no typed-cell concept to preserve beyond that. Returns undefined when the chart has no series at all, leaving the frame's geometry with empty content.
export function readChartTable(
  chartRoot: XmlElement,
  frame: Box,
): ContentTable | undefined {
  const chart = childrenWithTag(chartRoot, "c:chart")[0];
  const plotArea =
    chart === undefined ? undefined : childrenWithTag(chart, "c:plotArea")[0];
  if (plotArea === undefined) {
    return undefined;
  }
  // Series are taken in document order across all plot groups (c:barChart/c:lineChart/...), so a combo chart's groups concatenate.
  const series = elementsWithTag([plotArea], "c:ser").map(readSeries);
  if (series.length === 0) {
    return undefined;
  }
  // A chart's series share one category axis; the union in series order (first series to label an index wins) keeps values of later series whose cache extends past the first's.
  const categories = new Map<number, string>();
  for (const s of series) {
    for (const [idx, label] of s.categories) {
      if (!categories.has(idx)) {
        categories.set(idx, label);
      }
    }
  }
  const orderedIndexes = [...categories.keys()].sort((a, b) => a - b);
  const rows = [
    { cells: [labelCell(undefined), ...series.map((s) => labelCell(s.name))] },
    ...orderedIndexes.map((idx) => ({
      cells: [
        labelCell(categories.get(idx)),
        ...series.map((s) => labelCell(s.values.get(idx))),
      ],
    })),
  ];
  // A chart part carries no real column widths; the frame's own width split evenly across the columns is the geometry the graphic frame does carry.
  const columnWidthPt = frame.widthPt / (series.length + 1);
  return {
    kind: "table",
    rows,
    columnWidthsPt: Array.from(
      { length: series.length + 1 },
      () => columnWidthPt,
    ),
  };
}
