import type {
  ContentCellBorders,
  ContentStrokeStyle,
  ContentTableCell,
  Color,
} from "document-schema.js";
import { tableCellColumnSpan, tableCellRowSpan } from "document-schema.js";
import type { Package, XmlElement, XmlNode } from "odf.js";
import {
  findStyleElement,
  formatOdfColor,
  formatOdfLength,
  parseOdfColor,
  parseOdfLength,
} from "odf.js";
import { attr } from "ooxml.js";
import { removeAttr, removeChild, setAttr } from "../../xml/edit";
import { el } from "../../xml/fragment";
import {
  COLUMN_REPEAT_ATTR,
  collectRunMembers,
  isCellOrCoveredCell,
  readRunRepeatCount,
  replaceRun,
} from "../odf-repeated-runs";
import type {
  LiveTableGrid,
  PlacedLiveCell,
  TableGridRows,
} from "../table-grid";
import { resolveLiveTableGrid } from "../table-grid";
import { ensureAutomaticStyles, nextStyleName } from "./automatic-styles";
import type { ParagraphInit } from "./paragraph";
import { buildParagraph, OdtParagraph } from "./paragraph";

export interface TableInit {
  readonly rows: number;
  readonly columns: number;
  readonly columnWidthsPt?: readonly number[];
}

// 468pt (6.5in) -- US Letter page width (612pt) minus 1in margins either side (2 x 72pt), matching createEmptyOdtPackage's own default page-layout (scaffold.ts) and docx's identical DEFAULT_TABLE_WIDTH_TWIPS (src/edit/docx/table.ts, in twips: 9360 / 20 = 468pt) -- the content width a new table defaults to when no explicit widths are given.
const DEFAULT_TABLE_WIDTH_PT = 468;

const TABLE_COLUMN_STYLE_PREFIX = "OdtCol";
const TABLE_CELL_STYLE_PREFIX = "OdtCell";
const TABLE_ROW_STYLE_PREFIX = "OdtRow";

// odf.js's own reader resolves a cell's background and borders out of style:table-cell-properties (fo:background-color and fo:border-left/right/top/bottom, each a "<width> <style> <color>" shorthand -- see typed/shared/table.ts readCellStyleDecoration). But odf.js's StyleRegistry/StyleProperties model only text/paragraph formatting and never emit a style:table-cell-properties element at all, exactly the same hole src/edit/odg/style.ts closes for style:graphic-properties. This is the table-cell counterpart: a small, self-contained, append-only writer scoped to exactly the two attributes a cell's background and borders need, reusing ensureAutomaticStyles/nextStyleName (the shared find-or-create office:automatic-styles + mint-next-name logic) rather than a third reimplementation of that lookup -- mirroring both internTableColumnWidth above and odg/style.ts's own graphic-family writer.

const BORDER_EDGE_ATTRS: Readonly<
  Record<"top" | "right" | "bottom" | "left", string>
> = {
  top: "fo:border-top",
  right: "fo:border-right",
  bottom: "fo:border-bottom",
  left: "fo:border-left",
};

function formatBorderShorthand(
  color: Color,
  widthPt: number,
  style?: ContentStrokeStyle,
): string {
  return `${formatOdfLength(widthPt)} ${style ?? "solid"} ${formatOdfColor(color)}`;
}

function findCellPropertiesReadOnly(
  pkg: Package,
  element: XmlElement,
): XmlElement | undefined {
  const styleName = attr(element, "table:style-name");
  if (styleName === undefined) {
    return undefined;
  }
  const part = pkg.parts["content.xml"];
  const root =
    part?.kind === "xml"
      ? part.nodes.find((n): n is XmlElement => n.type === "element")
      : undefined;
  if (root === undefined) {
    return undefined;
  }
  for (const child of root.children) {
    if (child.type === "element" && child.tag === "office:automatic-styles") {
      for (const style of child.children) {
        if (
          style.type === "element" &&
          style.tag === "style:style" &&
          attr(style, "style:name") === styleName &&
          attr(style, "style:family") === "table-cell"
        ) {
          for (const props of style.children) {
            if (
              props.type === "element" &&
              props.tag === "style:table-cell-properties"
            ) {
              return props;
            }
          }
        }
      }
    }
  }
  return undefined;
}

export interface CellDecoration {
  readonly background?: Color;
  readonly borders?: ContentCellBorders;
}

export function readCellDecoration(
  pkg: Package,
  element: XmlElement,
): CellDecoration {
  const props = findCellPropertiesReadOnly(pkg, element);
  if (props === undefined) {
    return {};
  }
  let background: Color | undefined;
  const backgroundValue = attr(props, "fo:background-color");
  if (backgroundValue !== undefined) {
    background = parseOdfColor(backgroundValue);
  }
  const borders: ContentCellBorders = {};
  (["top", "right", "bottom", "left"] as const).forEach((edge) => {
    const raw = attr(props, BORDER_EDGE_ATTRS[edge]);
    if (raw === undefined) {
      return;
    }
    const tokens = raw.trim().split(/\s+/);
    const widthToken = tokens[0];
    const styleToken = tokens[1];
    const colorToken = tokens[2];
    if (
      widthToken === undefined ||
      styleToken === undefined ||
      colorToken === undefined ||
      styleToken === "none" ||
      styleToken === "hidden"
    ) {
      return;
    }
    const widthPt = parseOdfLength(widthToken);
    const color = parseOdfColor(colorToken);
    if (widthPt === undefined || widthPt <= 0 || color === undefined) {
      return;
    }
    const style: ContentStrokeStyle | undefined =
      styleToken === "solid" ||
      styleToken === "dashed" ||
      styleToken === "dotted" ||
      styleToken === "double"
        ? styleToken
        : undefined;
    borders[edge] =
      style === undefined ? { color, widthPt } : { color, widthPt, style };
  });
  return {
    background,
    borders: Object.keys(borders).length === 0 ? undefined : borders,
  };
}

// Mints a fresh style:style[family="table-cell"] automatic style carrying `decoration`'s background/borders in its style:table-cell-properties, and returns its style:name for a caller to set as the cell's own table:style-name. Each call mints its own style (never mutates an existing one), matching the append-only invariant every other hand-rolled style writer in this codebase follows.
export function buildCellStyle(
  pkg: Package,
  decoration: CellDecoration,
): string {
  const automaticStyles = ensureAutomaticStyles(pkg);
  const name = nextStyleName(
    automaticStyles,
    "style:style",
    TABLE_CELL_STYLE_PREFIX,
  );
  const propsAttrs: Record<string, string> = {};
  if (decoration.background !== undefined) {
    propsAttrs["fo:background-color"] = formatOdfColor(decoration.background);
  }
  if (decoration.borders !== undefined) {
    (["top", "right", "bottom", "left"] as const).forEach((edge) => {
      const border = decoration.borders![edge];
      if (border !== undefined) {
        propsAttrs[BORDER_EDGE_ATTRS[edge]] = formatBorderShorthand(
          border.color,
          border.widthPt,
          border.style,
        );
      }
    });
  }
  const properties =
    Object.keys(propsAttrs).length === 0
      ? []
      : [el("style:table-cell-properties", propsAttrs)];
  automaticStyles.children.push(
    el(
      "style:style",
      { "style:name": name, "style:family": "table-cell" },
      properties,
    ),
  );
  return name;
}

// odf.js's StyleRegistry cannot express a table column's width at all -- StylePropertiesSchema (src/styles/properties.ts) has no columnWidthPt field, so style:table-column-properties/@style:column-width (the only place ODF records it) is entirely outside what StyleRegistry.intern can produce. This is therefore hand-rolled, mirroring StyleRegistry.intern's own append-only, fingerprint-deduplicated contract by hand: reuse an existing table-column style if one with the exact same formatted width is already present, otherwise mint a fresh name (via automatic-styles.ts's nextStyleName) and append a new entry -- never mutate or remove an existing one.
function internTableColumnWidth(pkg: Package, widthPt: number): string {
  const automaticStyles = ensureAutomaticStyles(pkg);
  const formatted = formatOdfLength(widthPt, "pt");
  for (const child of automaticStyles.children) {
    if (
      child.type !== "element" ||
      child.tag !== "style:style" ||
      attr(child, "style:family") !== "table-column"
    ) {
      continue;
    }
    const props = child.children.find(
      (c): c is XmlElement =>
        c.type === "element" && c.tag === "style:table-column-properties",
    );
    if (
      props !== undefined &&
      attr(props, "style:column-width") === formatted
    ) {
      const existingName = attr(child, "style:name");
      if (existingName !== undefined) {
        return existingName;
      }
    }
  }
  const name = nextStyleName(
    automaticStyles,
    "style:style",
    TABLE_COLUMN_STYLE_PREFIX,
  );
  automaticStyles.children.push(
    el("style:style", { "style:name": name, "style:family": "table-column" }, [
      el("style:table-column-properties", { "style:column-width": formatted }),
    ]),
  );
  return name;
}

// The row's own CURRENT style:table-row-properties element -- via table:style-name -> style:style[family="table-row"] -> style:table-row-properties -- or undefined when the row carries no style, or its style has no such properties element. findStyleElement itself resolves across BOTH content.xml and styles.xml (including office:styles' common/named styles), so a row referencing a shared named style rather than its own automatic one still resolves here -- but cloneCurrentRowProperties below copies only the resolved style's own style:table-row-properties element, discarding that style's own style:parent-style-name and any sibling properties element a named style might also carry (style:table-cell-properties and the like); harmless within this ecosystem, since a table-row family style never carries anything but style:table-row-properties in practice and odf.js's own table-row resolution does no parent-chain walk either (typed/shared/table.ts's own resolveRowHeightPt convention, for the identical "standalone in practice" reason).
function currentRowPropertiesElement(
  pkg: Package,
  rowElement: XmlElement,
): XmlElement | undefined {
  const styleName = attr(rowElement, "table:style-name");
  const styleElement =
    styleName === undefined
      ? undefined
      : findStyleElement(styleName, "table-row", pkg);
  return styleElement === undefined
    ? undefined
    : styleElement.children.find(
        (c): c is XmlElement =>
          c.type === "element" && c.tag === "style:table-row-properties",
      );
}

// A structural clone of the row's own current style:table-row-properties element (currentRowPropertiesElement above), or a fresh empty one when the row has none -- structuredClone is safe here exactly as it is at src/edit/ods/address.ts's own identical use: an XmlElement is plain, serializable data with no methods or non-cloneable values. Cloning the WHOLE element, rather than reconstructing it attribute-by-attribute the way this file's own previous version did, is what lets every OTHER property already on it survive a heightPt write untouched -- fo:break-before, fo:keep-together, and fo:background-color are all properties this file has NO dedicated getter/setter for at all (heightPt/style:row-height is the only one), which is exactly why cloning the whole element, rather than enumerating named properties one at a time, is the right approach; it also carries across this element's one permitted CHILD, style:background-image (OASIS ODF 1.3 RelaxNG: style:table-row-properties-content permits exactly that one optional child), without this file ever needing to enumerate each one by name. style:use-optimal-row-height is the one exception: the caller deliberately mutates it (alongside style:row-height itself) on the returned clone; see the heightPt setter below for why.
function cloneCurrentRowProperties(
  pkg: Package,
  rowElement: XmlElement,
): XmlElement {
  const props = currentRowPropertiesElement(pkg, rowElement);
  return props === undefined
    ? el("style:table-row-properties")
    : structuredClone(props);
}

// Structural equality between two XML nodes -- used by xmlElementsEqual below to compare a style:table-row-properties element's CHILDREN, not just its attributes. style:background-image, the one child the schema permits here, is itself an element, so the element branch is the one that actually matters; text/cdata/comment are covered too since a hand-pretty-printed source document could carry whitespace between an opening tag and its child. An XmlDeclaration/XmlPi can never occur as an element's own child in a tree odf.js's parser produces (both appear only at the document root), so either one simply compares unequal to anything here rather than this function pretending to model a case that cannot arise.
function xmlNodesEqual(a: XmlNode, b: XmlNode): boolean {
  if (a.type === "element" && b.type === "element") {
    return xmlElementsEqual(a, b);
  }
  if (a.type === "text" && b.type === "text") {
    return a.value === b.value;
  }
  if (a.type === "cdata" && b.type === "cdata") {
    return a.value === b.value;
  }
  if (a.type === "comment" && b.type === "comment") {
    return a.value === b.value;
  }
  return false;
}

// Structural equality between two elements: the same tag, the identical set of attributes (order-independent, mirroring this file's own established attribute-set comparison), and the identical children in the same document order. internTableRowProperties below uses this to decide whether an existing automatic style's own style:table-row-properties element can be reused for a new request -- comparing attributes alone (this file's previous rowStylePropertiesMatch) let a plain height-only row reuse a style that also carried an extra child element such as style:background-image, silently importing it onto a row that never had one. Comparing the WHOLE element closes that generally, for any property or child this file has never enumerated by name, rather than special-casing style:background-image specifically.
function xmlElementsEqual(a: XmlElement, b: XmlElement): boolean {
  if (a.tag !== b.tag || a.attributes.length !== b.attributes.length) {
    return false;
  }
  if (
    !a.attributes.every(
      (candidate) => attr(b, candidate.name) === candidate.value,
    )
  ) {
    return false;
  }
  if (a.children.length !== b.children.length) {
    return false;
  }
  for (let index = 0; index < a.children.length; index++) {
    const childA = a.children[index];
    const childB = b.children[index];
    if (childA === undefined || childB === undefined) {
      return false;
    }
    if (!xmlNodesEqual(childA, childB)) {
      return false;
    }
  }
  return true;
}

// The row-height counterpart to internTableColumnWidth above, generalised beyond a single attribute: mints (or reuses) a style:style[family="table-row"] carrying `properties` -- already a full style:table-row-properties element, attributes and any children both -- as its own child. Reuse requires the FULL element to match (xmlElementsEqual above: same attributes, same children, same order), never attributes alone, so a request carrying no extra child never reuses a style whose element carries one. Callers pass a clone of the row's own current properties element with heightPt's own change already applied (cloneCurrentRowProperties plus the heightPt setter's own mutation below) -- never mutate an existing automatic style in place, since other rows may still reference it.
function internTableRowProperties(
  pkg: Package,
  properties: XmlElement,
): string {
  const automaticStyles = ensureAutomaticStyles(pkg);
  for (const child of automaticStyles.children) {
    if (
      child.type !== "element" ||
      child.tag !== "style:style" ||
      attr(child, "style:family") !== "table-row"
    ) {
      continue;
    }
    const props = child.children.find(
      (c): c is XmlElement =>
        c.type === "element" && c.tag === "style:table-row-properties",
    );
    if (props !== undefined && xmlElementsEqual(props, properties)) {
      const existingName = attr(child, "style:name");
      if (existingName !== undefined) {
        return existingName;
      }
    }
  }
  const name = nextStyleName(
    automaticStyles,
    "style:style",
    TABLE_ROW_STYLE_PREFIX,
  );
  automaticStyles.children.push(
    el("style:style", { "style:name": name, "style:family": "table-row" }, [
      properties,
    ]),
  );
  return name;
}

export class OdtTableCell {
  private readonly node: XmlElement;
  private readonly pkg: Package;

  constructor(node: XmlElement, pkg: Package) {
    this.node = node;
    this.pkg = pkg;
  }

  // A cell's direct paragraph-level children -- text:p and text:h both, exactly the two tags odf.js's own cell reader walks (typed/shared/table.ts) and the same both-tag scope OdtBody.paragraphs gives office:text, so a heading promoted into a cell (by OdtParagraph's headingLevel setter or buildOdtPackage's cell population) stays visible here with its headingLevel readable rather than vanishing from the editor surface.
  paragraphs(): OdtParagraph[] {
    const out: OdtParagraph[] = [];
    for (const child of this.node.children) {
      if (
        child.type === "element" &&
        (child.tag === "text:p" || child.tag === "text:h")
      ) {
        out.push(new OdtParagraph(this.node.children, child, this.pkg));
      }
    }
    return out;
  }

  appendParagraph(init?: ParagraphInit): OdtParagraph {
    const paragraphElement = buildParagraph(this.pkg, init);
    this.node.children.push(paragraphElement);
    return new OdtParagraph(this.node.children, paragraphElement, this.pkg);
  }

  get text(): string {
    return this.paragraphs()
      .map((p) => p.text)
      .join("\n");
  }

  get colSpan(): number | undefined {
    const raw = attr(this.node, "table:number-columns-spanned");
    return raw === undefined ? undefined : Number(raw);
  }

  // Marks this cell as the top-left of an N-column merge (ODF's own table:number-columns-spanned) -- the write-side inverse of odf.js's own readTableCell, whose ContentTableCell.colSpan this mirrors. Unlike docx's gridSpan, ODF still needs one real element per covered grid column even for a horizontal merge -- OdtTableRow.appendCoveredCell writes those, this setter only marks the merge's own starting cell.
  set colSpan(value: number | undefined) {
    if (value === undefined) {
      removeAttr(this.node, "table:number-columns-spanned");
      return;
    }
    setAttr(this.node, "table:number-columns-spanned", String(value));
  }

  get rowSpan(): number | undefined {
    const raw = attr(this.node, "table:number-rows-spanned");
    return raw === undefined ? undefined : Number(raw);
  }

  // Marks this cell as the top of an N-row merge (ODF's own table:number-rows-spanned) -- the write-side inverse of odf.js's own readTableCell, whose ContentTableCell.rowSpan this mirrors. The rows below still need a real table:covered-table-cell element at the same grid column (OdtTableRow.appendCoveredCell) -- ODF has no attribute-only way to express "this cell continues one above it" the way docx's w:vMerge does.
  set rowSpan(value: number | undefined) {
    if (value === undefined) {
      removeAttr(this.node, "table:number-rows-spanned");
      return;
    }
    setAttr(this.node, "table:number-rows-spanned", String(value));
  }

  // Cell background and per-edge borders live in style:table-cell-properties (fo:background-color and fo:border-top/right/bottom/left) -- outside what odf.js's StyleRegistry can express, so each setter re-mints a fresh table-cell automatic style carrying BOTH the change and the other decoration already on the cell (read back via readCellDecoration), repointing table:style-name at the result. Mirrors src/edit/odg/style.ts's setGraphicFill/setGraphicStroke (read-current, merge, mint) so setting background then borders -- or vice versa -- lands both in one style rather than the second clobbering the first.
  get background(): Color | undefined {
    return readCellDecoration(this.pkg, this.node).background;
  }

  set background(value: Color | undefined) {
    writeCellBackground(this.pkg, this.node, value);
  }

  get borders(): ContentCellBorders | undefined {
    return readCellDecoration(this.pkg, this.node).borders;
  }

  set borders(value: ContentCellBorders | undefined) {
    writeCellBorders(this.pkg, this.node, value);
  }
}

function writeCellBackground(
  pkg: Package,
  node: XmlElement,
  value: Color | undefined,
): void {
  const current = readCellDecoration(pkg, node);
  const name = buildCellStyle(pkg, {
    background: value,
    borders: current.borders,
  });
  setAttr(node, "table:style-name", name);
}

function writeCellBorders(
  pkg: Package,
  node: XmlElement,
  value: ContentCellBorders | undefined,
): void {
  const current = readCellDecoration(pkg, node);
  const name = buildCellStyle(pkg, {
    background: current.background,
    borders: value,
  });
  setAttr(node, "table:style-name", name);
}

// A live view over a table:covered-table-cell -- the grid position a merge anchored elsewhere covers. It carries no content and no span of its own, but ODF gives the element its own table:style-name like any cell, so it holds its own background and borders through the same style mint OdtTableCell uses; that is what lets a ContentTable's covered entry, which may carry them, round-trip.
export class OdtCoveredTableCell {
  private readonly node: XmlElement;
  private readonly pkg: Package;

  constructor(node: XmlElement, pkg: Package) {
    this.node = node;
    this.pkg = pkg;
  }

  get background(): Color | undefined {
    return readCellDecoration(this.pkg, this.node).background;
  }

  set background(value: Color | undefined) {
    writeCellBackground(this.pkg, this.node, value);
  }

  get borders(): ContentCellBorders | undefined {
    return readCellDecoration(this.pkg, this.node).borders;
  }

  set borders(value: ContentCellBorders | undefined) {
    writeCellBorders(this.pkg, this.node, value);
  }
}

// The one attribute a table:covered-table-cell keeps when a cell is retagged into one: its own table:style-name, which is what states the covered position's background and borders (the build path in content.ts writes exactly that). Everything else the cell carried is the anchor's or the position's content, not the position's own, and is dropped with it: the spans that made it an anchor, and the value, type and formula attributes that described its content.
const COVERED_CELL_KEPT_ATTRIBUTE = "table:style-name";

// Retags a cell in place to table:covered-table-cell, clearing its content and every attribute but its own style. The element is never removed and reinserted, since ODF's grid model requires one child element per grid position whatever the merge state.
function retagAsCovered(element: XmlElement): void {
  element.tag = "table:covered-table-cell";
  element.attributes = element.attributes.filter(
    (attribute) => attribute.name === COVERED_CELL_KEPT_ATTRIBUTE,
  );
  element.children = [];
}

// A row's own true grid columns, one entry per logical position, in document order: BOTH real table:table-cell and placeholder table:covered-table-cell children, each expanded by its own table:number-columns-repeated (ExaDev/documents.js#1374) -- a repeated element stands for that many IDENTICAL adjacent grid columns (ODF's own repeat semantics, matching odf.js's read-side expansion in typed/shared/table.ts's readTableRow), not one, so this is the count every grid-addressed read or write in this file must reckon against, never a row's own physical child count. Every entry past the first for a given element shares that SAME element: the row genuinely has fewer physical children than grid columns until something individuates one of them (individuateGridColumn below).
function gridColumnElements(
  row: XmlElement,
): { readonly columnIndex: number; readonly element: XmlElement }[] {
  const out: { columnIndex: number; element: XmlElement }[] = [];
  let columnIndex = 0;
  for (const member of collectRunMembers(
    row.children,
    isCellOrCoveredCell,
    undefined,
  )) {
    const repeat = readRunRepeatCount(member.node, COLUMN_REPEAT_ATTR);
    for (let offset = 0; offset < repeat; offset++) {
      out.push({ columnIndex: columnIndex + offset, element: member.node });
    }
    columnIndex += repeat;
  }
  return out;
}

// The row's own grid width: the count of logical positions its real and covered cells together stand for, honouring repeats -- the bound every grid-column-addressed read or write in this file validates against, never the row's own physical child count.
function rowGridColumnCount(row: XmlElement): number {
  return collectRunMembers(row.children, isCellOrCoveredCell, undefined).reduce(
    (sum, member) => sum + readRunRepeatCount(member.node, COLUMN_REPEAT_ATTR),
    0,
  );
}

// Reads the element at grid column `columnIndex` of `row` without mutating anything, even when that column falls inside a repeated run -- used for a check (planMerge's anchor lookup) that must inspect a position's tag before deciding whether the operation is even valid, so that a refusal leaves the table exactly as it found it. Returns undefined for a negative or out-of-range columnIndex, matching this file's own established "does not exist" error wording at every call site.
function locateGridColumnElement(
  row: XmlElement,
  columnIndex: number,
): XmlElement | undefined {
  if (columnIndex < 0) {
    return undefined;
  }
  let cursor = 0;
  for (const member of collectRunMembers(
    row.children,
    isCellOrCoveredCell,
    undefined,
  )) {
    const count = readRunRepeatCount(member.node, COLUMN_REPEAT_ATTR);
    if (columnIndex < cursor + count) {
      return member.node;
    }
    cursor += count;
  }
  return undefined;
}

// Individuates grid column `columnIndex` of `row`: when it falls inside a repeated run, splits that run in place (odf-repeated-runs.ts's replaceRun) into an optional shortened "before" run, a single un-repeated element at exactly this column, and an optional shortened "after" run -- the un-repeat an edit to one repeated column needs, applied only to the column the edit actually touches, so the rest of the run (and whatever content it carries) survives untouched. Callers must bounds-check columnIndex against rowGridColumnCount first: replaceRun's own gap-filling fallback (its third case, for ODS's sparse-sheet addressing) would otherwise silently grow this row with a placeholder cell it was never asked to have, which is never correct for an ODT table -- every grid column an odt row states already has a real backing element, repeated or not, so an out-of-range column is always a caller error, not a gap to fill.
function individuateGridColumn(
  row: XmlElement,
  columnIndex: number,
): XmlElement {
  return replaceRun(
    row.children,
    isCellOrCoveredCell,
    columnIndex,
    COLUMN_REPEAT_ATTR,
    () => {
      throw new Error(
        `individuateGridColumn: column ${columnIndex} has no existing element to individuate in this row -- callers must bounds-check against rowGridColumnCount first`,
      );
    },
  );
}

// The table:table-row children of a table:table element, in document order.
function tableRowElements(table: XmlElement): XmlElement[] {
  return table.children.filter(
    (child): child is XmlElement =>
      child.type === "element" && child.tag === "table:table-row",
  );
}

// The real cells of one row, each with the grid column its element sits at. A covered position has no cell of its own to place: the anchor that covers it owns it. A cell carrying its own table:number-columns-repeated (ExaDev/documents.js#1374) places once per logical column it stands for (gridColumnElements above), each entry wrapping the SAME underlying element -- reading any of those positions reads the same live content, exactly as ODF's repeat semantics say they are the same cell repeated, until an edit that touches one of them individuates it (OdtTableRow.mergeCellsHorizontally/markCellCovered, OdtTable.mergeCells).
function placedCells(
  row: XmlElement,
  pkg: Package,
): PlacedLiveCell<OdtTableCell>[] {
  return gridColumnElements(row).flatMap(({ columnIndex, element }) => {
    if (element.tag !== "table:table-cell") {
      return [];
    }
    const cell = new OdtTableCell(element, pkg);
    return [
      { columnIndex, cell, colSpan: cell.colSpan, rowSpan: cell.rowSpan },
    ];
  });
}

// The grid of one table:table element: its declared table:table-column count (honouring a column's own table:number-columns-repeated, exactly like a row's cells) and every table:table-row's real cells, resolved through the same walkTableGrid classification the content pivot uses.
function resolveOdtGrid(
  table: XmlElement,
  pkg: Package,
): LiveTableGrid<OdtTableCell> {
  const placedRows: PlacedLiveCell<OdtTableCell>[][] = [];
  let declaredColumns = 0;
  for (const child of table.children) {
    if (child.type !== "element") {
      continue;
    }
    if (child.tag === "table:table-column") {
      declaredColumns += readRunRepeatCount(child, COLUMN_REPEAT_ATTR);
    } else if (child.tag === "table:table-row") {
      placedRows.push(placedCells(child, pkg));
    }
  }
  return resolveLiveTableGrid(placedRows, declaredColumns);
}

// A block of grid positions: the rows from `row` up to `row + rowSpan` and the columns from `column` up to `column + columnSpan`.
interface GridRegion {
  readonly row: number;
  readonly column: number;
  readonly rowSpan: number;
  readonly columnSpan: number;
}

function regionCovers(
  region: GridRegion,
  rowIndex: number,
  columnIndex: number,
): boolean {
  return (
    region.row <= rowIndex &&
    rowIndex < region.row + region.rowSpan &&
    region.column <= columnIndex &&
    columnIndex < region.column + region.columnSpan
  );
}

function regionsIntersect(a: GridRegion, b: GridRegion): boolean {
  return (
    a.row < b.row + b.rowSpan &&
    b.row < a.row + a.rowSpan &&
    a.column < b.column + b.columnSpan &&
    b.column < a.column + a.columnSpan
  );
}

function regionContains(outer: GridRegion, inner: GridRegion): boolean {
  return (
    outer.row <= inner.row &&
    outer.column <= inner.column &&
    inner.row + inner.rowSpan <= outer.row + outer.rowSpan &&
    inner.column + inner.columnSpan <= outer.column + outer.columnSpan
  );
}

// The region every anchor of the grid occupies, from the spans its own element states: an unmerged cell is a one-position region. A covered position is never an anchor, so a position no anchor's region reaches is one no merge owns.
function anchorRegions(grid: LiveTableGrid<OdtTableCell>): GridRegion[] {
  return grid.rows.flatMap((positions, row) =>
    positions.flatMap((position, column) => {
      if (!position?.isAnchor) {
        return [];
      }
      const spans: ContentTableCell = {
        blocks: [],
        colSpan: position.cell.colSpan,
        rowSpan: position.cell.rowSpan,
      };
      return [
        {
          row,
          column,
          rowSpan: tableCellRowSpan(spans),
          columnSpan: tableCellColumnSpan(spans),
        },
      ];
    }),
  );
}

// Whether merging `target` over `region` would change nothing: a rectangle one row high over a region anchored at the rectangle's own first column that already spans exactly the rectangle's columns. Such a merge states the anchor's column span again and consumes nothing, whatever the region's row span. The region is anchored in the rectangle's row because it reaches that row and the rectangle's first position is not one a merge covers, which planMerge has already established.
function isUnchangedAnchor(region: GridRegion, target: GridRegion): boolean {
  return (
    target.rowSpan === 1 &&
    region.column === target.column &&
    region.columnSpan === target.columnSpan
  );
}

// Names a merge by the grid position it is anchored at.
function describeRegionAnchor(region: GridRegion): string {
  return `the merge anchored at row ${region.row}, column ${region.column}`;
}

// A single grid position: the table:table-row element it belongs to and its grid column within that row. planMerge below resolves a merge's anchor and every consumed position to positions rather than to elements, since a position inside a repeated run (ExaDev/documents.js#1374) has no element of its own until applyMerge's own individuateGridColumn call gives it one -- resolving straight to an element here, the way this used to, would mutate whichever OTHER grid columns happened to share that element's repeat run at the time planMerge ran.
interface GridPosition {
  readonly row: XmlElement;
  readonly column: number;
}

// A merge the table allows: the grid position that becomes the merged region's anchor and the positions the merge retags to table:covered-table-cell.
interface MergeAllowed {
  readonly anchor: GridPosition;
  readonly consumed: readonly GridPosition[];
  readonly refusal?: never;
}

// A merge the table refuses, the row of the rectangle it was found in, and why, phrased to follow the name of the operation that refused it.
interface MergeRefused {
  readonly refusal: { readonly rowIndex: number; readonly reason: string };
  readonly anchor?: never;
  readonly consumed?: never;
}

type MergePlan = MergeAllowed | MergeRefused;

function refuseMerge(rowIndex: number, reason: string): MergeRefused {
  return { refusal: { rowIndex, reason } };
}

// Decides the merge of `target` without changing anything, so that a merge covering several rows finds out that a later row refuses before any earlier row has changed. `rows` are the table:table-row elements of the rectangle, top row first.
//
// A merge is refused when it would leave the grid rule broken, which is when its rectangle cuts through a merged region: a region the rectangle reaches that is not wholly inside it would either keep positions the new merge takes while losing its anchor, or lose positions to the new merge while keeping its anchor. A merged region wholly inside the rectangle is swallowed whole, as any unmerged cell in it is, so it leaves no orphan behind. The one merge that reaches a region without being wholly around it is one that changes nothing: a rectangle one row high over an anchor that already spans exactly its columns.
//
// The refusal names the row of the rectangle it was found in, the grid column, and the anchor of the region in the way. Every column this reads is a GRID column (locateGridColumnElement/rowGridColumnCount, honouring table:number-columns-repeated -- ExaDev/documents.js#1374): a position an earlier repeated cell stands for is reached the same way any other position is. Nothing here mutates the row: the anchor and every consumed position are resolved to plain (row, column) pairs, never to an element, so a refusal leaves the table exactly as it found it and a later individuation (applyMerge) is the only thing that ever splits a repeated run.
function planMerge(
  table: XmlElement,
  pkg: Package,
  target: GridRegion,
  rows: readonly [XmlElement, ...XmlElement[]],
): MergePlan {
  const [anchorRow, ...coveredRows] = rows;
  const anchorElement = locateGridColumnElement(anchorRow, target.column);
  if (anchorElement === undefined) {
    return refuseMerge(
      target.row,
      `column ${target.column} does not exist in this row`,
    );
  }
  const endColumn = target.column + target.columnSpan;
  for (const [offset, row] of rows.entries()) {
    const totalColumns = rowGridColumnCount(row);
    if (endColumn > totalColumns) {
      return refuseMerge(
        target.row + offset,
        `colSpan ${target.columnSpan} starting at column ${target.column} exceeds this row's own ${totalColumns} grid columns`,
      );
    }
  }
  const regions = anchorRegions(resolveOdtGrid(table, pkg));
  if (anchorElement.tag === "table:covered-table-cell") {
    const covering = regions.find((region) =>
      regionCovers(region, target.row, target.column),
    );
    return refuseMerge(
      target.row,
      covering === undefined
        ? `column ${target.column} is a covered position that no merge anchors`
        : `column ${target.column} is covered by ${describeRegionAnchor(covering)}`,
    );
  }
  const cutting = regions.find(
    (region) =>
      regionsIntersect(region, target) &&
      !regionContains(target, region) &&
      !isUnchangedAnchor(region, target),
  );
  if (cutting !== undefined) {
    const column = Math.max(cutting.column, target.column);
    return refuseMerge(
      Math.max(cutting.row, target.row),
      `column ${column} belongs to ${describeRegionAnchor(cutting)}, which reaches outside the region being merged and cannot be merged over`,
    );
  }
  const consumed: GridPosition[] = [];
  for (let column = target.column + 1; column < endColumn; column++) {
    consumed.push({ row: anchorRow, column });
  }
  for (const row of coveredRows) {
    for (let column = target.column; column < endColumn; column++) {
      consumed.push({ row, column });
    }
  }
  return { anchor: { row: anchorRow, column: target.column }, consumed };
}

// Carries out a merge planMerge allowed: individuates and retags every consumed position (individuateGridColumn, un-repeating exactly the columns this merge touches -- ExaDev/documents.js#1374 -- and leaving the rest of any repeated run, and whatever content it carries, untouched) and states the region's spans on its own individuated anchor. A rectangle one row high leaves the anchor's row span alone, since it is either unstated or a vertical merge the rectangle leaves as it is.
function applyMerge(
  plan: MergeAllowed,
  target: GridRegion,
  pkg: Package,
): OdtTableCell {
  for (const position of plan.consumed) {
    retagAsCovered(individuateGridColumn(position.row, position.column));
  }
  const anchorElement = individuateGridColumn(
    plan.anchor.row,
    plan.anchor.column,
  );
  const anchor = new OdtTableCell(anchorElement, pkg);
  anchor.colSpan = target.columnSpan;
  if (target.rowSpan > 1) {
    anchor.rowSpan = target.rowSpan;
  }
  return anchor;
}

export class OdtTableRow {
  private readonly node: XmlElement;
  private readonly pkg: Package;
  private readonly table: XmlElement;

  constructor(node: XmlElement, pkg: Package, table: XmlElement) {
    this.node = node;
    this.pkg = pkg;
    this.table = table;
  }

  // The row's PHYSICAL real cells: one view per table:table-cell, with every table:covered-table-cell omitted. A merged region's covered positions are elements of their own in ODF, so after a merge this holds fewer cells than the table has grid columns and an index into it is not a grid column. OdtTable.gridRows is the grid-addressed view; OdtTableRow.mergeCellsHorizontally takes a grid column, not an index into this list.
  cells(): OdtTableCell[] {
    const out: OdtTableCell[] = [];
    for (const child of this.node.children) {
      if (child.type === "element" && child.tag === "table:table-cell") {
        out.push(new OdtTableCell(child, this.pkg));
      }
    }
    return out;
  }

  // Row height (ODF's own style:table-row-properties/@style:row-height, on the row's own referenced table:style-name) -- the ODF-side mirror of DocxTableRow.heightPt (src/edit/docx/table.ts), read via currentRowPropertiesElement above (family "table-row", a single-level lookup with no parent-chain walk, matching typed/shared/table.ts's own resolveRowHeightPt convention for the identical reason: real ODF table-row automatic styles are standalone in practice) and written via internTableRowProperties's append-only, fingerprint-deduplicated mint above. An unresolvable height is genuinely "no height specified" (the layout engine measures content instead), never 0, matching odf.js's own reader.
  get heightPt(): number | undefined {
    const props = currentRowPropertiesElement(this.pkg, this.node);
    const raw =
      props === undefined ? undefined : attr(props, "style:row-height");
    return raw === undefined ? undefined : parseOdfLength(raw);
  }

  // Clones the row's CURRENT style:table-row-properties element (cloneCurrentRowProperties above) and mutates only the attributes this setter itself owns, so every other property already on it -- including its one permitted child element -- survives untouched; see cloneCurrentRowProperties's own comment for why cloning the whole element, rather than continuing to merge named attributes one at a time, is the general fix. Setting an explicit height ALSO forces a pre-existing style:use-optimal-row-height="true" to "false": left alone, that flag tells a real consumer (LibreOffice confirmed) to auto-fit the row to its own content and ignore style:row-height entirely, so the height this setter just wrote would silently never render even though the getter above keeps reporting it back -- an explicit height is a stronger, more recent statement of intent than a pre-existing autofit flag, so it wins, and is stated as an explicit "false" (never merely removed) so the outcome holds even against a consumer that treats an absent attribute as inheriting some other default rather than the OASIS-stated one. The flag is left untouched when it was never "true" to begin with, so a plain height write on a row with no pre-existing style never grows one it didn't need. Clearing the height removes only style:row-height and leaves every other property -- use-optimal-row-height included, whichever way an earlier call left it -- exactly as found, minting a style carrying them alone; only when nothing else remains does clearing remove table:style-name outright, since only then does the row's style exist purely to carry a height.
  set heightPt(value: number | undefined) {
    const props = cloneCurrentRowProperties(this.pkg, this.node);
    if (value === undefined) {
      removeAttr(props, "style:row-height");
    } else {
      setAttr(props, "style:row-height", formatOdfLength(value, "pt"));
      if (attr(props, "style:use-optimal-row-height") === "true") {
        setAttr(props, "style:use-optimal-row-height", "false");
      }
    }
    if (props.attributes.length === 0 && props.children.length === 0) {
      removeAttr(this.node, "table:style-name");
      return;
    }
    setAttr(
      this.node,
      "table:style-name",
      internTableRowProperties(this.pkg, props),
    );
  }

  // Appends one ordinary table:table-cell to this row, for a caller (buildOdtPackage's own appendTable) building a row's cells one at a time rather than all at once via OdtTable.appendRow -- needed so a merged table's covered grid positions can be interleaved with real cells in document order.
  appendCell(): OdtTableCell {
    const cellElement = buildCell(this.pkg);
    this.node.children.push(cellElement);
    return new OdtTableCell(cellElement, this.pkg);
  }

  // Appends a table:covered-table-cell -- ODF's own placeholder for a grid position consumed by a horizontal (table:number-columns-spanned) or vertical (table:number-rows-spanned) merge starting elsewhere. Carries no content at all, matching odf.js's own readTableRow, which reads one back as a block-less entry regardless of what (if anything) real-world producers ever put inside one; the returned view is for stating the position's own background and borders, which readTableRow reads back onto that entry.
  appendCoveredCell(): OdtCoveredTableCell {
    const coveredElement = el("table:covered-table-cell");
    this.node.children.push(coveredElement);
    return new OdtCoveredTableCell(coveredElement, this.pkg);
  }

  // Merges colSpan grid columns of THIS row into one cell: the anchor at startColumnIndex gets table:number-columns-spanned (via OdtTableCell.colSpan), and every OTHER position in the region is RETAGGED in place to table:covered-table-cell (see retagAsCovered: the cell keeps its own table:style-name and loses its content and spans), never removed and reinserted, since ODF's grid model requires one child element per grid position regardless of merge state. Consumed cells' own content is discarded silently and unconditionally, as it is throughout the spreadsheet and docx editors: documented, intentional behaviour, not a silent trap.
  //
  // startColumnIndex is a GRID column. The merge is refused, with an error naming the grid column and the anchor of the merge in the way, when it cannot be carried out without breaking the grid rule (ContentTableCell in document-schema.js): the start column is covered by a merge anchored elsewhere, or the region would cut through a merged region, whether that region runs down from a row above, down from this row, or along this row past the last merged column. A merged region wholly inside the region is swallowed whole. The cases that cut through a vertical merge are refused rather than extended because widening one row of a merged chain means rewriting every row of it and swallowing whatever those rows hold in the widened columns, which may belong to other merges; that is a rectangle merge, and OdtTable.mergeCells is where it is decided, after the vertical merge has been unmerged. A merge that would change nothing is never refused.
  mergeCellsHorizontally(
    startColumnIndex: number,
    colSpan: number,
  ): OdtTableCell {
    if (!Number.isInteger(colSpan) || colSpan < 1) {
      throw new Error(
        `mergeCellsHorizontally: colSpan must be a positive integer, got ${colSpan}`,
      );
    }
    const target: GridRegion = {
      row: tableRowElements(this.table).indexOf(this.node),
      column: startColumnIndex,
      rowSpan: 1,
      columnSpan: colSpan,
    };
    const plan = planMerge(this.table, this.pkg, target, [this.node]);
    if (plan.refusal !== undefined) {
      throw new Error(`mergeCellsHorizontally: ${plan.refusal.reason}`);
    }
    return applyMerge(plan, target, this.pkg);
  }

  // Marks the grid position at columnIndex as covered by a merge anchored elsewhere, retagging it in place through retagAsCovered. It is refused, naming the position, when the position is itself the anchor of a merged region: covering it would leave the rest of that region covered with nothing anchoring it, so a merge over an anchor is made through OdtTable.mergeCells, which swallows the whole region or refuses. A position another merge already covers, and an unmerged cell, are retagged. columnIndex is a grid column (rowGridColumnCount, honouring table:number-columns-repeated -- ExaDev/documents.js#1374): the bounds and anchor-orphan checks read the row without mutating it, and only once both pass does individuateGridColumn split whatever repeated run columnIndex falls inside before retagAsCovered retags the one resulting element.
  markCellCovered(columnIndex: number): void {
    const totalColumns = rowGridColumnCount(this.node);
    if (columnIndex < 0 || columnIndex >= totalColumns) {
      throw new Error(
        `markCellCovered: column ${columnIndex} does not exist in this row`,
      );
    }
    const rowIndex = tableRowElements(this.table).indexOf(this.node);
    const anchored = anchorRegions(resolveOdtGrid(this.table, this.pkg)).find(
      (region) =>
        region.row === rowIndex &&
        region.column === columnIndex &&
        (region.rowSpan > 1 || region.columnSpan > 1),
    );
    if (anchored !== undefined) {
      throw new Error(
        `markCellCovered: column ${columnIndex} anchors a merge with rowSpan ${anchored.rowSpan} and colSpan ${anchored.columnSpan}, so covering it would leave the rest of that merge without an anchor`,
      );
    }
    retagAsCovered(individuateGridColumn(this.node, columnIndex));
  }
}

function buildCell(pkg: Package): XmlElement {
  return el("table:table-cell", {}, [buildParagraph(pkg)]);
}

function buildRow(pkg: Package, columnCount: number): XmlElement {
  const cells: XmlElement[] = [];
  for (let i = 0; i < columnCount; i++) {
    cells.push(buildCell(pkg));
  }
  return el("table:table-row", {}, cells);
}

export class OdtTable {
  private readonly container: XmlNode[];
  private readonly node: XmlElement;
  private readonly pkg: Package;
  private removed = false;

  constructor(container: XmlNode[], node: XmlElement, pkg: Package) {
    this.container = container;
    this.node = node;
    this.pkg = pkg;
  }

  private live(): XmlElement {
    if (this.removed) {
      throw new Error(
        "this OdtTable has been removed and can no longer be used",
      );
    }
    return this.node;
  }

  rows(): OdtTableRow[] {
    const out: OdtTableRow[] = [];
    for (const child of this.live().children) {
      if (child.type === "element" && child.tag === "table:table-row") {
        out.push(new OdtTableRow(child, this.pkg, this.node));
      }
    }
    return out;
  }

  // The grid's own view of the table: gridRows()[r][c] is the position at grid row r and grid column c, and every row is gridColumnCount() wide. A position a merged region covers resolves to the region's anchor cell, with isAnchor false, whether the region reaches it along its own row or from a row above; that is the cell to read or edit for any position inside the region. Unlike rows()[r].cells(), which omits every covered position so that its index is a physical position, the column here is the same grid column OdtTableRow.mergeCellsHorizontally and OdtTable.mergeCells take.
  gridRows(): TableGridRows<OdtTableCell> {
    return this.grid().rows;
  }

  // The table's width in grid columns: the number of table:table-column elements or the widest row's count of grid positions, whichever is larger, which is what a merge leaves unchanged and what rows()[r].cells().length under-reports once a row holds a merge.
  gridColumnCount(): number {
    return this.grid().columnCount;
  }

  private grid() {
    return resolveOdtGrid(this.live(), this.pkg);
  }

  // The PHYSICAL real cell at columnIndex of row rowIndex: an index into OdtTableRow.cells(), which omits covered positions, not a grid column, so once a row holds a merge it is not the cell at that grid column. gridRows() is the grid-addressed lookup.
  cell(rowIndex: number, columnIndex: number): OdtTableCell {
    const row = this.rows()[rowIndex];
    if (row === undefined) {
      throw new Error(`row ${rowIndex} does not exist in this table`);
    }
    const cell = row.cells()[columnIndex];
    if (cell === undefined) {
      throw new Error(
        `column ${columnIndex} does not exist in row ${rowIndex}`,
      );
    }
    return cell;
  }

  appendRow(columnCount: number): OdtTableRow {
    const node = this.live();
    const row = buildRow(this.pkg, columnCount);
    node.children.push(row);
    return new OdtTableRow(row, this.pkg, node);
  }

  // Appends an empty table:table-row with no cells yet, for a caller (buildOdtPackage's own appendTable) that needs to build a merged table's cells one at a time via OdtTableRow.appendCell/appendCoveredCell rather than the uniform-grid shape appendRow(columnCount) always produces.
  appendEmptyRow(): OdtTableRow {
    const node = this.live();
    const row = el("table:table-row");
    node.children.push(row);
    return new OdtTableRow(row, this.pkg, node);
  }

  // Merges the rowSpan x colSpan rectangle anchored at (startRow, startColumn), both columns being grid columns: the anchor gets table:number-columns-spanned, and table:number-rows-spanned when rowSpan > 1, and every other position of the rectangle is retagged to table:covered-table-cell. Unlike docx, ODF's grid model needs no per-row merge on the rows below the anchor: table:number-rows-spanned on the anchor already says how many rows the merge covers, and each of those rows only needs its own covered positions stamped.
  //
  // Every row of the rectangle is checked before any row changes, so a refusal leaves the table exactly as it was. The rectangle is refused, naming the row and the grid column, wherever OdtTableRow.mergeCellsHorizontally would refuse: when it starts in a position covered by a merge anchored elsewhere, or cuts through a merged region. A merged region wholly inside the rectangle is swallowed whole, with the content of its anchor, like any unmerged cell in it.
  mergeCells(
    startRow: number,
    startColumn: number,
    rowSpan: number,
    colSpan: number,
  ): OdtTableCell {
    if (
      !Number.isInteger(rowSpan) ||
      rowSpan < 1 ||
      !Number.isInteger(colSpan) ||
      colSpan < 1
    ) {
      throw new Error(
        `mergeCells: rowSpan and colSpan must be positive integers, got rowSpan=${rowSpan}, colSpan=${colSpan}`,
      );
    }
    const rows = tableRowElements(this.live());
    const anchorRow = rows[startRow];
    if (anchorRow === undefined) {
      throw new Error(
        `mergeCells: row ${startRow} does not exist in this table`,
      );
    }
    if (startRow + rowSpan > rows.length) {
      throw new Error(
        `mergeCells: rowSpan ${rowSpan} starting at row ${startRow} exceeds this table's own ${rows.length} rows`,
      );
    }
    const target: GridRegion = {
      row: startRow,
      column: startColumn,
      rowSpan,
      columnSpan: colSpan,
    };
    const plan = planMerge(this.live(), this.pkg, target, [
      anchorRow,
      ...rows.slice(startRow + 1, startRow + rowSpan),
    ]);
    if (plan.refusal !== undefined) {
      throw new Error(
        `mergeCells: row ${plan.refusal.rowIndex}: ${plan.refusal.reason}`,
      );
    }
    return applyMerge(plan, target, this.pkg);
  }

  remove(): void {
    removeChild(this.container, this.live());
    this.removed = true;
  }
}

export function buildTable(pkg: Package, init: TableInit): XmlElement {
  const defaultWidth = DEFAULT_TABLE_WIDTH_PT / init.columns;
  const columns: XmlElement[] = [];
  for (let i = 0; i < init.columns; i++) {
    const widthPt = init.columnWidthsPt?.[i] ?? defaultWidth;
    columns.push(
      el("table:table-column", {
        "table:style-name": internTableColumnWidth(pkg, widthPt),
      }),
    );
  }
  const rows: XmlElement[] = [];
  for (let r = 0; r < init.rows; r++) {
    rows.push(buildRow(pkg, init.columns));
  }
  return el("table:table", {}, [...columns, ...rows]);
}
