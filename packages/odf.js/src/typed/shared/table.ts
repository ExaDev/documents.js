import type {
  Alignment,
  Color,
  ContentBlock,
  ContentBorder,
  ContentCellBorders,
  ContentStrokeStyle,
  ContentTable,
  ContentTableCell,
  ContentTableRow,
} from "document-schema.js";
import type { XmlElement } from "../../model/node";
import type { Package } from "../../model/package";
import type { StyleRegistry } from "../../styles/registry";
import { el } from "../../xml/fragment";
import { encodeXmlText } from "../../xml/entities";
import { attrValue, childrenWithTag } from "../../xml/query";
import { formatOdfLength, parseOdfLength } from "./units";
import { formatOdfColor, parseOdfColor } from "./color";
import { findStyleElement } from "./cascade";
import {
  readParagraphOrHeading,
  readOdfParagraph,
  writeOdfParagraph,
} from "./paragraph";

// Reads a table:table element into document-schema.js's ContentTable -- the same table:table/table:table-row/table:table-cell/table:covered-table-cell markup ODF uses identically across odt/ods/odp (verified against real LibreOffice output: a presentation's own draw:frame-wrapped table uses the exact grammar below, including table:number-columns-spanned/table:covered-table-cell for merged cells), so this module is written to be reusable by a future odt/ods reader rather than living inside typed/draw/shapes.ts, even though odp is this module's only caller today.
//
// Column widths and row heights are dimensional/decorative properties (style:table-column-properties/@style:column-width, style:table-row-properties/@style:row-height) that styles/properties.ts deliberately does not model (see its own top-of-file note: this package's StyleProperties covers only paragraph/run-level text-document formatting) -- so this module resolves them directly via cascade.ts's findStyleElement, a single-level (family, name) lookup with no parent-chain walk, matching how real ODF table-column/table-row/table-cell automatic styles are standalone with no style:parent-style-name chain of their own in practice.

function readRepeatCount(element: XmlElement, attrName: string): number {
  const raw = attrValue(element, attrName);
  if (raw === undefined) {
    return 1;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

// A column with no resolvable width (no table:style-name, no matching style, or a style with no style:table-column-properties/@style:column-width) defaults to 0pt, mirroring ooxml.js's own readTable (`emuToPt(Number(attr(col, 'w') ?? '0'))`) -- an established, deliberate sibling-reader convention, not a fallback invented here.
function resolveColumnWidthPt(columnElement: XmlElement, pkg: Package): number {
  const styleName = attrValue(columnElement, "table:style-name");
  const styleElement =
    styleName === undefined
      ? undefined
      : findStyleElement(styleName, "table-column", pkg);
  const props =
    styleElement === undefined
      ? undefined
      : childrenWithTag(styleElement, "style:table-column-properties")[0];
  const widthValue =
    props === undefined ? undefined : attrValue(props, "style:column-width");
  return widthValue === undefined ? 0 : (parseOdfLength(widthValue) ?? 0);
}

// Unlike column width, ContentTableRow.heightPt is optional -- an unresolvable row height is genuinely "no height specified" (the layout engine measures content instead), not zero, mirroring ooxml.js's own readTable row-height treatment.
function resolveRowHeightPt(
  rowElement: XmlElement,
  pkg: Package,
): number | undefined {
  const styleName = attrValue(rowElement, "table:style-name");
  const styleElement =
    styleName === undefined
      ? undefined
      : findStyleElement(styleName, "table-row", pkg);
  const props =
    styleElement === undefined
      ? undefined
      : childrenWithTag(styleElement, "style:table-row-properties")[0];
  const heightValue =
    props === undefined ? undefined : attrValue(props, "style:row-height");
  return heightValue === undefined ? undefined : parseOdfLength(heightValue);
}

// style:table-cell-properties/@fo:background-color is the standard, portable OASIS attribute for a cell's own fill, and the one this reader resolves. Real LibreOffice-generated PRESENTATION tables specifically favour their own loext:graphic-properties/@draw:fill-color extension instead when SAVING (confirmed via a controlled round trip: a cell written with the standard fo:background-color came back re-serialized under loext: on the very next LibreOffice save) -- a private, unstable vendor namespace this package deliberately does not chase (this package's own convention is OASIS-spec-grounded; see this repository's README on "ground truth over memory"). A cell whose only fill information lives in that loext: extension reads with no background here: a real, verified, narrow gap, not a silently guessed one.
//
// BORDERS/ALIGNMENT/VERTICAL-ALIGNMENT (added alongside background for document-schema.js 2.0.0's Release A, which gave ContentTableCell a `borders` field and ContentSheetCell its own `borders`/`alignment`/`verticalAlignment` fields): fo:border and its four per-edge siblings (fo:border-left/right/top/bottom) share ODF's fixed-order XSL-FO border shorthand -- exactly THREE space-separated tokens, "<length> <border-style> <color>", in that fixed order (this is XSL-FO's own <border> shorthand, not CSS's permutation-tolerant one; e.g. `fo:border="0.05pt solid #000000"`). A border-style token of "none"/"hidden" means the edge genuinely carries NO border at all -- distinct from the attribute being absent entirely, which means "say nothing about this edge, whatever a less specific link in the style chain already set stays in effect" -- so an explicit override can clear an inherited edge, not just add one. A border-style ODF allows but ContentBorderSchema's own vocabulary has no member for (groove/ridge/inset/outset) still yields a real border -- width and colour are both genuine values read straight off the attribute -- just with `style` left unset (ContentBorderSchema's own documented "absent means 'solid'" default), the same "read what's real, leave what doesn't map unmapped rather than fabricating or discarding" precedent typed/draw/shapes.ts's own readOdfFillAndStroke already established for draw:stroke. style:vertical-align is enumerated to "top"/"middle"/"bottom"/"automatic" per the OASIS schema; "automatic" has no member in ContentSheetCell's own three-value verticalAlignment enum, so it is left unread (undefined) rather than guessed at. fo:text-align on a table-cell style's OWN style:paragraph-properties child (confirmed as real, valid structure against real LibreOffice 26.2 output -- style:default-style style:family="table-cell" in a genuine .ods's styles.xml carries a style:paragraph-properties child directly, setting the cell's own default paragraph formatting) is that same four-value vocabulary properties.ts's parseParagraphProperties already restricts to (left/center/right/justify) -- anything else (ODF's own "start"/"end" logical values included) is left unread rather than guessed at.
const BORDER_STYLE_MAP: Readonly<Partial<Record<string, ContentStrokeStyle>>> =
  { solid: "solid", dashed: "dashed", dotted: "dotted", double: "double" };
export type BorderEdgeKey = "left" | "right" | "top" | "bottom";
export const BORDER_EDGE_KEYS: readonly BorderEdgeKey[] = [
  "left",
  "right",
  "top",
  "bottom",
];
export const BORDER_EDGE_ATTRS: Readonly<Record<BorderEdgeKey, string>> = {
  left: "fo:border-left",
  right: "fo:border-right",
  top: "fo:border-top",
  bottom: "fo:border-bottom",
};
// A narrowing guard rather than a Set-membership check + type assertion (this package's own established "no type assertions" convention -- see registry.ts's isStyleFamily for the identical pattern applied to StyleFamily).
function isVerticalAlign(value: string): value is "top" | "middle" | "bottom" {
  return value === "top" || value === "middle" || value === "bottom";
}

// One edge's own parsed fo:border(-*) value: a real border, an explicit "no border" (style token "none"/"hidden"), or undefined for anything this reader cannot interpret (a malformed value, a token count other than three, an unparseable length/colour) -- undefined is deliberately treated by the caller as "this attribute said nothing usable", never as "clear this edge", so a malformed override can never silently erase a perfectly good inherited border.
function parseBorderEdge(
  value: string,
): { border: ContentBorder } | { none: true } | undefined {
  const tokens = value.trim().split(/\s+/);
  if (tokens.length !== 3) {
    return undefined;
  }
  const [widthToken, styleToken, colorToken] = tokens;
  if (
    widthToken === undefined ||
    styleToken === undefined ||
    colorToken === undefined
  ) {
    return undefined;
  }
  if (styleToken === "none" || styleToken === "hidden") {
    return { none: true };
  }
  const widthPt = parseOdfLength(widthToken);
  const color = parseOdfColor(colorToken);
  if (widthPt === undefined || widthPt <= 0 || color === undefined) {
    return undefined;
  }
  const style = BORDER_STYLE_MAP[styleToken];
  return {
    border:
      style === undefined ? { color, widthPt } : { color, widthPt, style },
  };
}

// Applies one style:table-cell-properties element's own fo:border/fo:border-* onto the running per-edge accumulator: the shorthand (if present) seeds all four edges first, then each per-edge attribute (if present on this SAME element) overrides just that one edge -- matching how a single real style element can legitimately carry both (three sides via the shorthand, one side overridden individually).
function applyBorderEdgeUpdates(
  accumulated: Partial<Record<BorderEdgeKey, ContentBorder>>,
  cellProperties: XmlElement,
): void {
  const shorthandValue = attrValue(cellProperties, "fo:border");
  const shorthandUpdate =
    shorthandValue === undefined ? undefined : parseBorderEdge(shorthandValue);
  if (shorthandUpdate !== undefined) {
    for (const edge of BORDER_EDGE_KEYS) {
      applyBorderEdgeUpdate(accumulated, edge, shorthandUpdate);
    }
  }
  for (const edge of BORDER_EDGE_KEYS) {
    const rawValue = attrValue(cellProperties, BORDER_EDGE_ATTRS[edge]);
    const update =
      rawValue === undefined ? undefined : parseBorderEdge(rawValue);
    if (update !== undefined) {
      applyBorderEdgeUpdate(accumulated, edge, update);
    }
  }
}

function applyBorderEdgeUpdate(
  accumulated: Partial<Record<BorderEdgeKey, ContentBorder>>,
  edge: BorderEdgeKey,
  update: { border: ContentBorder } | { none: true },
): void {
  if ("none" in update) {
    Reflect.deleteProperty(accumulated, edge);
  } else {
    accumulated[edge] = update.border;
  }
}

function bordersFromAccumulated(
  accumulated: Partial<Record<BorderEdgeKey, ContentBorder>>,
): ContentCellBorders | undefined {
  if (
    accumulated.left === undefined &&
    accumulated.right === undefined &&
    accumulated.top === undefined &&
    accumulated.bottom === undefined
  ) {
    return undefined;
  }
  const borders: ContentCellBorders = {};
  if (accumulated.left !== undefined) {
    borders.left = accumulated.left;
  }
  if (accumulated.right !== undefined) {
    borders.right = accumulated.right;
  }
  if (accumulated.top !== undefined) {
    borders.top = accumulated.top;
  }
  if (accumulated.bottom !== undefined) {
    borders.bottom = accumulated.bottom;
  }
  return borders;
}

export interface CellStyleDecoration {
  background?: Color;
  borders?: ContentCellBorders;
  alignment?: Alignment;
  verticalAlignment?: "top" | "middle" | "bottom";
}

// Folds a cell's own table-cell-family style chain into background/borders/alignment/verticalAlignment, later elements in `elements` always overriding an earlier one's value for whichever attribute they actually carry (the same fold cascade.ts's own resolveStyle applies for paragraph/run StyleProperties, just over a property vocabulary -- table-cell dimensional/decorative properties -- that module deliberately does not model). Deliberately generic over how many elements are passed and in what order they were resolved: readTableCell below passes a ONE-ELEMENT array from findStyleElement's single-level lookup (this file's own established "table-cell styles are standalone in practice" convention for odt/odp), while ods's readOdsContent passes the FULL root-to-target array from cascade.ts's resolveStyleElementChain (real-world spreadsheet cell styles routinely DO chain via style:parent-style-name -- confirmed against this package's own kitchen-sink.ods fixture, where every cell style sets style:parent-style-name="Default") -- one fold, two callers, each supplying whatever chain its own family's real-world usage actually needs resolved.
export function readCellStyleDecoration(
  elements: readonly XmlElement[],
): CellStyleDecoration {
  let background: Color | undefined;
  let alignment: Alignment | undefined;
  let verticalAlignment: CellStyleDecoration["verticalAlignment"];
  const borderAccumulator: Partial<Record<BorderEdgeKey, ContentBorder>> = {};

  for (const styleElement of elements) {
    const cellProperties = childrenWithTag(
      styleElement,
      "style:table-cell-properties",
    )[0];
    if (cellProperties !== undefined) {
      const backgroundValue = attrValue(cellProperties, "fo:background-color");
      const parsedBackground =
        backgroundValue === undefined
          ? undefined
          : parseOdfColor(backgroundValue);
      if (parsedBackground !== undefined) {
        background = parsedBackground;
      }
      applyBorderEdgeUpdates(borderAccumulator, cellProperties);
      const verticalAlignValue = attrValue(
        cellProperties,
        "style:vertical-align",
      );
      if (
        verticalAlignValue !== undefined &&
        isVerticalAlign(verticalAlignValue)
      ) {
        verticalAlignment = verticalAlignValue;
      }
    }
    const paragraphProperties = childrenWithTag(
      styleElement,
      "style:paragraph-properties",
    )[0];
    const textAlignValue =
      paragraphProperties === undefined
        ? undefined
        : attrValue(paragraphProperties, "fo:text-align");
    if (
      textAlignValue === "left" ||
      textAlignValue === "center" ||
      textAlignValue === "right" ||
      textAlignValue === "justify"
    ) {
      alignment = textAlignValue;
    }
  }

  return {
    background,
    borders: bordersFromAccumulated(borderAccumulator),
    alignment,
    verticalAlignment,
  };
}

function readTableCell(
  cellElement: XmlElement,
  pkg: Package,
): ContentTableCell {
  // A cell's block content is its text:p AND text:h children (a heading paragraph set in a cell is a real text:h under the same convention office:text uses -- typed/shared/paragraph.ts's readParagraphOrHeading derives its identity), walked in document order rather than tag-filtered so a heading between two paragraphs stays between them. A nested text:list or table:table inside a cell remains outside this walk's scope, mirroring the block walks every other shared reader here makes.
  const blocks: ContentBlock[] = [];
  for (const child of cellElement.children) {
    if (child.type !== "element") {
      continue;
    }
    if (child.tag === "text:p") {
      blocks.push(readOdfParagraph(child, pkg));
    } else if (child.tag === "text:h") {
      blocks.push(readParagraphOrHeading(child, readOdfParagraph(child, pkg)));
    }
  }
  const colSpanRaw = attrValue(cellElement, "table:number-columns-spanned");
  const rowSpanRaw = attrValue(cellElement, "table:number-rows-spanned");
  const styleName = attrValue(cellElement, "table:style-name");
  const styleElement =
    styleName === undefined
      ? undefined
      : findStyleElement(styleName, "table-cell", pkg);
  const { background, borders } = readCellStyleDecoration(
    styleElement === undefined ? [] : [styleElement],
  );
  return {
    blocks,
    colSpan:
      colSpanRaw === undefined ? undefined : Number.parseInt(colSpanRaw, 10),
    rowSpan:
      rowSpanRaw === undefined ? undefined : Number.parseInt(rowSpanRaw, 10),
    background,
    borders,
  };
}

function readTableRow(rowElement: XmlElement, pkg: Package): ContentTableRow {
  const cells: ContentTableCell[] = [];
  for (const child of rowElement.children) {
    if (child.type !== "element") {
      continue;
    }
    if (child.tag === "table:covered-table-cell") {
      // A merged-away continuation cell -- the anchor cell's own colSpan/rowSpan already communicates the merge; ContentTableCell has no "covered by a preceding span" concept of its own, mirroring ooxml.js's own readTableCell treatment of hMerge/vMerge continuation cells.
      const repeat = readRepeatCount(child, "table:number-columns-repeated");
      for (let i = 0; i < repeat; i++) {
        cells.push({ blocks: [] });
      }
    } else if (child.tag === "table:table-cell") {
      const cell = readTableCell(child, pkg);
      const repeat = readRepeatCount(child, "table:number-columns-repeated");
      for (let i = 0; i < repeat; i++) {
        cells.push(cell);
      }
    }
  }
  return { cells, heightPt: resolveRowHeightPt(rowElement, pkg) };
}

// --- the write direction: a ContentTable -> the table:table element readOdfTable reads back ---
//
// The dimensional and decorative properties this module reads (a column's style:column-width, a row's style:row-height, a cell's fill and per-edge borders) are exactly the ones styles/properties.ts deliberately does not model, so the write side reaches them through StyleRegistry's `propertyElements` seam: the property elements are built here, where their vocabulary already lives, and the registry still owns naming, collision-checking, and deduplication. One minting authority, one place per property.

function tableColumnStyle(
  widthPt: number,
  registry: StyleRegistry,
): string | undefined {
  // A column with no positive width states nothing -- readOdfTable's own fallback for a column with no resolvable width is 0pt, so a zero-width column and a column with no style are the same fact and only one of them needs a style minted.
  if (widthPt <= 0) {
    return undefined;
  }
  return registry.intern({
    properties: {},
    family: "table-column",
    propertyElements: [
      el("style:table-column-properties", {
        "style:column-width": formatOdfLength(widthPt),
      }),
    ],
  });
}

function tableRowStyle(
  heightPt: number | undefined,
  registry: StyleRegistry,
): string | undefined {
  if (heightPt === undefined) {
    return undefined;
  }
  return registry.intern({
    properties: {},
    family: "table-row",
    propertyElements: [
      el("style:table-row-properties", {
        "style:row-height": formatOdfLength(heightPt),
      }),
    ],
  });
}

// One border edge in ODF's own fixed-order XSL-FO shorthand -- exactly three space-separated tokens, "<length> <border-style> <color>", the same grammar parseBorderEdge above reads. An absent ContentBorder.style is written as "solid", which is what ContentBorderSchema already documents an absent style to mean, so the value written says what the value read says. Exported for typed/ods/write.ts, which writes the identical fo:border-*/style:table-cell-properties shorthand for ContentSheetCell.borders -- the same XSL-FO grammar, on a different content leaf, so the formatting is shared rather than duplicated.
export function formatBorderEdge(border: ContentBorder): string {
  return `${formatOdfLength(border.widthPt)} ${border.style ?? "solid"} ${formatOdfColor(border.color)}`;
}

function tableCellStyle(
  cell: ContentTableCell,
  registry: StyleRegistry,
): string | undefined {
  const attributes: Record<string, string> = {};
  if (cell.background !== undefined) {
    attributes["fo:background-color"] = formatOdfColor(cell.background);
  }
  const borders = cell.borders;
  if (borders !== undefined) {
    for (const edge of BORDER_EDGE_KEYS) {
      const border = borders[edge];
      if (border !== undefined) {
        attributes[BORDER_EDGE_ATTRS[edge]] = formatBorderEdge(border);
      }
    }
  }
  if (Object.keys(attributes).length === 0) {
    return undefined;
  }
  return registry.intern({
    properties: {},
    family: "table-cell",
    propertyElements: [el("style:table-cell-properties", attributes)],
  });
}

// A cell's own block content. ODF's table:table-cell content model admits full block flow, but readOdfTable's cell walk reads only text:p/text:h (see readTableCell above), so writing anything else here would produce a document this package's own reader silently drops content from -- refused outright instead, naming the block kind, rather than written and lost.
function writeCellBlocks(
  cell: ContentTableCell,
  registry: StyleRegistry,
): XmlElement[] {
  return cell.blocks.map((block) => {
    if (block.kind !== "paragraph") {
      throw new Error(
        `writeOdfTable: a table cell carrying a "${block.kind}" block cannot be written -- odf.js's table reader reads only paragraphs and headings out of a cell, so writing one would lose it on the way back in`,
      );
    }
    return writeOdfParagraph(block, registry);
  });
}

function coverageKey(row: number, column: number): string {
  return `${row},${column}`;
}

// Writes one ContentTable as the table:table element readOdfTable reads back. `tableName` is the document-unique table:name every real ODF producer writes; the caller mints it, since uniqueness is a document-wide fact one table has no way to establish on its own.
export function writeOdfTable(
  table: ContentTable,
  registry: StyleRegistry,
  tableName: string,
): XmlElement {
  const columns = table.columnWidthsPt.map((widthPt) => {
    const styleName = tableColumnStyle(widthPt, registry);
    return el(
      "table:table-column",
      styleName === undefined
        ? {}
        : { "table:style-name": encodeXmlText(styleName) },
    );
  });

  // Which grid positions a preceding cell's own span already occupies: ODF spells those out as table:covered-table-cell elements, and readOdfTable reads each back as the empty cell a covered position is in the pivot. The set is built from the spans actually written, never from the input's own placeholder cells, so a colSpan and its covered neighbours can never disagree.
  const covered = new Set<string>();
  const rows = table.rows.map((row, rowIndex) => {
    const cells = row.cells.map((cell, columnIndex) => {
      if (covered.has(coverageKey(rowIndex, columnIndex))) {
        return el("table:covered-table-cell");
      }
      const colSpan = cell.colSpan ?? 1;
      const rowSpan = cell.rowSpan ?? 1;
      for (let r = rowIndex; r < rowIndex + rowSpan; r += 1) {
        for (let c = columnIndex; c < columnIndex + colSpan; c += 1) {
          if (r !== rowIndex || c !== columnIndex) {
            covered.add(coverageKey(r, c));
          }
        }
      }
      const attributes: Record<string, string> = {};
      const styleName = tableCellStyle(cell, registry);
      if (styleName !== undefined) {
        attributes["table:style-name"] = encodeXmlText(styleName);
      }
      if (cell.colSpan !== undefined) {
        attributes["table:number-columns-spanned"] = String(cell.colSpan);
      }
      if (cell.rowSpan !== undefined) {
        attributes["table:number-rows-spanned"] = String(cell.rowSpan);
      }
      return el(
        "table:table-cell",
        attributes,
        writeCellBlocks(cell, registry),
      );
    });
    const rowStyleName = tableRowStyle(row.heightPt, registry);
    return el(
      "table:table-row",
      rowStyleName === undefined
        ? {}
        : { "table:style-name": encodeXmlText(rowStyleName) },
      cells,
    );
  });

  // The table's own style carries the one property a real consumer needs to lay it out at all: its total width, the sum of the column widths it was given. A table whose columns state no width at all gets the alignment alone, since a fabricated width would be worse than none.
  const totalWidthPt = table.columnWidthsPt.reduce(
    (total, widthPt) => total + widthPt,
    0,
  );
  const tableProperties: Record<string, string> = { "table:align": "margins" };
  if (totalWidthPt > 0) {
    tableProperties["style:width"] = formatOdfLength(totalWidthPt);
  }
  const tableStyleName = registry.intern({
    properties: {},
    family: "table",
    propertyElements: [el("style:table-properties", tableProperties)],
  });

  return el(
    "table:table",
    {
      "table:name": encodeXmlText(tableName),
      "table:style-name": encodeXmlText(tableStyleName),
    },
    [...columns, ...rows],
  );
}

export function readOdfTable(
  tableElement: XmlElement,
  pkg: Package,
): ContentTable {
  const columnWidthsPt: number[] = [];
  for (const column of childrenWithTag(tableElement, "table:table-column")) {
    const widthPt = resolveColumnWidthPt(column, pkg);
    const repeat = readRepeatCount(column, "table:number-columns-repeated");
    for (let i = 0; i < repeat; i++) {
      columnWidthsPt.push(widthPt);
    }
  }

  const rows: ContentTableRow[] = [];
  for (const rowElement of childrenWithTag(tableElement, "table:table-row")) {
    const row = readTableRow(rowElement, pkg);
    const repeat = readRepeatCount(rowElement, "table:number-rows-repeated");
    for (let i = 0; i < repeat; i++) {
      rows.push(row);
    }
  }

  return { kind: "table", rows, columnWidthsPt };
}
