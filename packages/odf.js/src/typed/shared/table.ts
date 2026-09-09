import type {
  Alignment,
  Color,
  ContentBlock,
  ContentBorder,
  ContentCellBorders,
  ContentCellFill,
  ContentParagraph,
  ContentTable,
  ContentTableCell,
  ContentTableRow,
} from "document-schema.js";
import { resolveCellFillColor } from "document-schema.js";
import type { DefinitionEntry, ProvenanceDescriptor } from "document-schema.js";
import type { XmlElement, XmlNode } from "../../model/node";
import type { Package } from "../../model/package";
import type { StyleRegistry } from "../../styles/registry";
import { el } from "../../xml/fragment";
import { encodeXmlText } from "../../xml/entities";
import { attrValue, childrenWithTag } from "../../xml/query";
import { formatOdfLength, parseOdfLength } from "./units";
import { formatOdfColor, parseOdfColor } from "./color";
import { findStyleElement } from "./cascade";
import {
  BORDER_EDGE_ATTRS,
  BORDER_EDGE_KEYS,
  type BorderEdgeKey,
  formatBorderEdge,
  parseBorderEdge,
} from "./border";
import {
  readParagraphOrHeading,
  readOdfParagraph,
  writeOdfParagraph,
} from "./paragraph";
import {
  mintOdfListNumId,
  readOdfListParagraphs,
  listKindOf,
  writeOdfList,
  type OdfListIdState,
  type OdfListEntry,
} from "./list";

// Reads a table:table element into document-schema.js's ContentTable -- the same table:table/table:table-row/table:table-cell/table:covered-table-cell markup ODF uses identically across odt/ods/odp (verified against real LibreOffice output: a presentation's own draw:frame-wrapped table uses the exact grammar below, including table:number-columns-spanned/table:covered-table-cell for merged cells), so this module is shared rather than living inside typed/draw/shapes.ts: odt's own office:text walk reads a top-level table:table straight through it, and typed/draw/shapes.ts/typed/draw/embedded.ts read the identical grammar for a table nested inside an odp/odg draw:frame or an embedded chart's own local data cache.
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
// BORDERS/ALIGNMENT/VERTICAL-ALIGNMENT (added alongside background for document-schema.js 2.0.0's Release A, which gave ContentTableCell a `borders` field and ContentSheetCell its own `borders`/`alignment`/`verticalAlignment` fields): fo:border and its four per-edge siblings (fo:border-left/right/top/bottom) share ODF's fixed-order XSL-FO border shorthand -- see typed/shared/border.ts's own top-of-file note for the grammar and parseBorderEdge/formatBorderEdge, now shared with styles/properties.ts's paragraph-level border reading and typed/ods/write.ts's sheet-cell border writing. style:vertical-align is enumerated to "top"/"middle"/"bottom"/"automatic" per the OASIS schema; "automatic" has no member in ContentSheetCell's own three-value verticalAlignment enum, so it is left unread (undefined) rather than guessed at. fo:text-align on a table-cell style's OWN style:paragraph-properties child (confirmed as real, valid structure against real LibreOffice 26.2 output -- style:default-style style:family="table-cell" in a genuine .ods's styles.xml carries a style:paragraph-properties child directly, setting the cell's own default paragraph formatting) is that same four-value vocabulary properties.ts's parseParagraphProperties already restricts to (left/center/right/justify) -- anything else (ODF's own "start"/"end" logical values included) is left unread rather than guessed at. A narrowing guard rather than a Set-membership check + type assertion (this package's own established "no type assertions" convention -- see registry.ts's isStyleFamily for the identical pattern applied to StyleFamily).
function isVerticalAlign(value: string): value is "top" | "middle" | "bottom" {
  return value === "top" || value === "middle" || value === "bottom";
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

// background is always a 'solid' ContentCellFill, never a 'pattern' -- style:table-cell-properties/@fo:background-color is OASIS's own flat-colour attribute, with no two-colour pattern-fill vocabulary at all (unlike WordprocessingML's w:shd or SpreadsheetML's patternFill, ExaDev/documents.js#951). tableCellStyle below writes the inverse: resolveCellFillColor's own single-colour approximation for a 'pattern' fill this format has no way to state.
export interface CellStyleDecoration {
  background?: ContentCellFill;
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
    background:
      background === undefined
        ? undefined
        : { kind: "solid", color: background },
    borders: bordersFromAccumulated(borderAccumulator),
    alignment,
    verticalAlignment,
  };
}

// The readParagraph callback readOdfListParagraphs (typed/shared/list.ts) needs: a text:list-item's own text:p/text:h child reads exactly as readTableCell's own direct walk reads one, so a heading inside a list item inside a cell gets the identical heading-identity step a heading directly in the cell gets.
function readCellListParagraph(
  element: XmlElement,
  pkg: Package,
): ContentParagraph {
  return readParagraphOrHeading(element, readOdfParagraph(element, pkg));
}

function readTableCell(
  cellElement: XmlElement,
  pkg: Package,
  listIdState: OdfListIdState,
): ContentTableCell {
  // A cell's block content mirrors the general block-content reading every other shared/odt-specific walker here applies: text:p/text:h read as paragraphs/headings (a heading paragraph set in a cell is a real text:h under the same convention office:text uses -- typed/shared/paragraph.ts's readParagraphOrHeading derives its identity), text:list reads through the SAME shared list walker (typed/shared/list.ts's readOdfListParagraphs/mintOdfListNumId) office:text and a slide text-box both use, and table:table recurses back into readOdfTable -- a table nested inside a cell is still just a table:table element, read by the identical function that reads a top-level one. All four are walked in document order rather than tag-filtered, so a heading or a nested list/table between two paragraphs stays between them.
  const blocks: ContentBlock[] = [];
  for (const child of cellElement.children) {
    if (child.type !== "element") {
      continue;
    }
    if (child.tag === "text:p") {
      blocks.push(readOdfParagraph(child, pkg));
    } else if (child.tag === "text:h") {
      blocks.push(readParagraphOrHeading(child, readOdfParagraph(child, pkg)));
    } else if (child.tag === "text:list") {
      const numId = mintOdfListNumId(pkg, child, listIdState);
      blocks.push(
        ...readOdfListParagraphs(child, { numId, level: 0 }, (element) =>
          readCellListParagraph(element, pkg),
        ),
      );
    } else if (child.tag === "table:table") {
      blocks.push(readOdfTable(child, pkg, listIdState));
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

function readTableRow(
  rowElement: XmlElement,
  pkg: Package,
  listIdState: OdfListIdState,
): ContentTableRow {
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
      const cell = readTableCell(child, pkg, listIdState);
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

function tableCellStyle(
  cell: ContentTableCell,
  registry: StyleRegistry,
): string | undefined {
  const attributes: Record<string, string> = {};
  // ODF's fo:background-color states one flat colour with no pattern-fill vocabulary at all, so a 'pattern' fill approximates through resolveCellFillColor's own single representative colour (its foreground, falling back to its background) -- the same degradation this schema function exists for, rather than a bespoke one-off here. A pattern stating neither colour resolves to undefined and writes no attribute at all, exactly like an absent background.
  const backgroundColor =
    cell.background === undefined
      ? undefined
      : resolveCellFillColor(cell.background);
  if (backgroundColor !== undefined) {
    attributes["fo:background-color"] = formatOdfColor(backgroundColor);
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

// What writeOdfTable needs beyond the registry, to write a cell's own nested content back exactly as readOdfTable's own recursive read reads it: a table nested inside a cell needs a document-unique table:name from the SAME counter a top-level table's name comes from (never a cell-local counter, which could mint a name a sibling top-level table already used), and consecutive list-membership paragraphs grouped into a text:list need the SAME named list-style a top-level list run would reuse or mint (never a second, cell-local style for the identical kind). Both callers -- typed/odt/write.ts's writeSectionBlocks and typed/draw/write-shapes.ts's writeDrawFrame -- already own exactly this state (OdtWriteState.nextTable/listStyleByKind, DrawShapeWriteState's own identically-shaped fields) for their own top-level tables and lists, so this context is built from that existing state rather than duplicating it.
export interface OdfTableWriteContext {
  readonly registry: StyleRegistry;
  // Mints the next document-unique table:name -- called once per table:table element this function writes, including a nested table found inside a cell, off the caller's own document-wide counter.
  mintTableName(): string;
  // Mints (or reuses) the named text:list-style for one list kind, off the caller's own memoized cache -- one text:list-style per kind for the WHOLE document, not one per table.
  mintListStyleName(kind: "ordered" | "bullet"): string;
  // The construct-writing context a cell's own paragraphs resolve their run-level construct extents against, identical to the body-paragraph and shape-text threading: the definitions table note/comment anchors resolve against and the tracked-change id map (ExaDev/documents.js#969 closed the last allowConstructs=false gap these close). Absent means the caller has no tree context and the paragraph writer itself refuses the construct kinds that need one.
  readonly definitions?: Readonly<Record<string, DefinitionEntry>>;
  readonly changeIds?: ReadonlyMap<ProvenanceDescriptor, string>;
}

// A cell's own block content, mirroring readTableCell's own recursive scope (typed/shared/table.ts's read side): a paragraph writes as itself; consecutive paragraphs sharing one list membership group into a single text:list, nested per level via typed/shared/list.ts's own writeOdfList -- the identical grouping typed/odt/write.ts's writeSectionBlocks and typed/draw/write-shapes.ts's writeShapeTextBox already apply at their own top level; and a nested table writes by recursing back into writeOdfTable itself, the identical function that writes a top-level one. Any other block kind is refused outright, naming it, rather than written and lost -- exactly what readTableCell's own scope stops it from reading back.
function writeCellBlocks(
  cell: ContentTableCell,
  context: OdfTableWriteContext,
): XmlNode[] {
  const out: XmlNode[] = [];
  let openList:
    | {
        readonly numId: string;
        readonly entries: OdfListEntry[];
        readonly element: XmlElement;
      }
    | undefined;

  const closeList = (): void => {
    if (openList === undefined) {
      return;
    }
    const kind = listKindOf(openList.numId);
    const built = writeOdfList(
      openList.entries,
      kind === undefined ? undefined : context.mintListStyleName(kind),
    );
    openList.element.attributes = built.attributes;
    openList.element.children = built.children;
    openList = undefined;
  };

  for (const block of cell.blocks) {
    if (block.kind === "table") {
      closeList();
      out.push(writeOdfTable(block, context));
      continue;
    }
    if (block.kind !== "paragraph") {
      throw new Error(
        `writeOdfTable: a table cell carrying a "${block.kind}" block cannot be written -- odf.js's table reader reads only paragraphs, headings, lists, and nested tables out of a cell, so writing one would lose it on the way back in`,
      );
    }
    const element = writeOdfParagraph(block, context.registry, {
      definitions: context.definitions,
      changeIds: context.changeIds,
    });
    const membership = block.list;
    // context is never asked to canonicalise membership itself (unlike typed/draw/write-shapes.ts's own planShapeContent seam): a cell's own paragraphs pass through writeOdfTable's caller's normalisation exactly as a top-level table's do, so a membership here already carries a real numId whenever it carries one at all.
    if (membership?.numId === undefined) {
      closeList();
      out.push(element);
      continue;
    }
    if (openList !== undefined && openList.numId !== membership.numId) {
      closeList();
    }
    if (openList === undefined) {
      const listElement = el("text:list");
      openList = {
        numId: membership.numId,
        entries: [],
        element: listElement,
      };
      out.push(listElement);
    }
    openList.entries.push({ level: membership.level, element });
  }
  closeList();
  return out;
}

function coverageKey(row: number, column: number): string {
  return `${row},${column}`;
}

// Writes one ContentTable as the table:table element readOdfTable reads back. Its own table:name is minted by context.mintTableName() -- the caller's document-wide counter, shared with every nested table this call's own cells may recurse into (see writeCellBlocks), so uniqueness holds across the whole document regardless of nesting depth.
export function writeOdfTable(
  table: ContentTable,
  context: OdfTableWriteContext,
): XmlElement {
  const { registry } = context;
  const tableName = context.mintTableName();
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
      return el("table:table-cell", attributes, writeCellBlocks(cell, context));
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

// `listIdState` mints numId identity for a text:list found inside one of this table's own cells (readTableCell's own recursive walk), threaded through every nested table the same way -- so two lists in two different cells (or in a cell of a table nested inside another cell) get different identities exactly as two lists in different sections of an odt body do. Defaults to a fresh per-call counter, matching typed/draw/shapes.ts's own readDrawFrame convention, so every pre-existing call site that has no document-wide state to thread (a chart's own local data table, this module's own tests) keeps working unchanged; a caller walking a whole document threads its own state so identities stay unique across the whole read.
export function readOdfTable(
  tableElement: XmlElement,
  pkg: Package,
  listIdState: OdfListIdState = { next: 1 },
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
    const row = readTableRow(rowElement, pkg, listIdState);
    const repeat = readRepeatCount(rowElement, "table:number-rows-repeated");
    for (let i = 0; i < repeat; i++) {
      rows.push(row);
    }
  }

  return { kind: "table", rows, columnWidthsPt };
}
