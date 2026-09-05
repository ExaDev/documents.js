import type {
  ContentCellBorders,
  ContentStrokeStyle,
  Color,
} from "document-schema.js";
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

// Reads rowElement's CURRENT table:style-name -> style:style[family="table-row"] -> style:table-row-properties chain (mirroring src/edit/ods/column-row.ts's own currentRowStyleProperties), returning every attribute EXCEPT style:row-height, which the caller owns. A row opened via openOdt() can carry a style with properties this editor has no dedicated getter/setter for at all -- fo:break-before, style:use-optimal-row-height, fo:keep-together, fo:background-color -- and every one of them must survive a heightPt write untouched, not just the ones this file happens to model by name.
function currentRowStylePropertiesExceptHeight(
  pkg: Package,
  rowElement: XmlElement,
): Record<string, string> {
  const styleName = attr(rowElement, "table:style-name");
  const styleElement =
    styleName === undefined
      ? undefined
      : findStyleElement(styleName, "table-row", pkg);
  const props =
    styleElement === undefined
      ? undefined
      : styleElement.children.find(
          (c): c is XmlElement =>
            c.type === "element" && c.tag === "style:table-row-properties",
        );
  const result: Record<string, string> = {};
  if (props === undefined) {
    return result;
  }
  for (const a of props.attributes) {
    if (a.name !== "style:row-height") {
      result[a.name] = a.value;
    }
  }
  return result;
}

// True only when props carries EXACTLY `expected`'s attributes -- same count, same values -- never a superset or a subset. A plain count-plus-per-key comparison rather than attr() lookups alone, so a style carrying one extra property (say style:use-optimal-row-height alongside a matching style:row-height) is correctly rejected as a candidate rather than silently reused, which would import that extra property onto a row that never had it.
function rowStylePropertiesMatch(
  props: XmlElement,
  expected: Readonly<Record<string, string>>,
): boolean {
  const expectedKeys = Object.keys(expected);
  return (
    props.attributes.length === expectedKeys.length &&
    expectedKeys.every((key) => attr(props, key) === expected[key])
  );
}

// The row-height counterpart to internTableColumnWidth above, generalised beyond a single height value: mints (or reuses) a style:style[family="table-row"] carrying exactly `properties` in its style:table-row-properties -- reuse requires an EXACT property-set match (rowStylePropertiesMatch above), otherwise mint a fresh name and append a new entry. Callers pass the row's own current non-height properties merged with the height change (or with the height key omitted, when clearing a height on a row whose style also carries something else), matching src/edit/ods/column-row.ts's applyRowStyleProperties: read current, merge, mint fresh -- never mutate an existing style in place, since other rows may still reference it.
function internTableRowProperties(
  pkg: Package,
  properties: Readonly<Record<string, string>>,
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
    if (props !== undefined && rowStylePropertiesMatch(props, properties)) {
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
      el("style:table-row-properties", { ...properties }),
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
    const current = readCellDecoration(this.pkg, this.node);
    const name = buildCellStyle(this.pkg, {
      background: value,
      borders: current.borders,
    });
    setAttr(this.node, "table:style-name", name);
  }

  get borders(): ContentCellBorders | undefined {
    return readCellDecoration(this.pkg, this.node).borders;
  }

  set borders(value: ContentCellBorders | undefined) {
    const current = readCellDecoration(this.pkg, this.node);
    const name = buildCellStyle(this.pkg, {
      background: current.background,
      borders: value,
    });
    setAttr(this.node, "table:style-name", name);
  }
}

export class OdtTableRow {
  private readonly node: XmlElement;
  private readonly pkg: Package;

  constructor(node: XmlElement, pkg: Package) {
    this.node = node;
    this.pkg = pkg;
  }

  cells(): OdtTableCell[] {
    const out: OdtTableCell[] = [];
    for (const child of this.node.children) {
      if (child.type === "element" && child.tag === "table:table-cell") {
        out.push(new OdtTableCell(child, this.pkg));
      }
    }
    return out;
  }

  // Row height (ODF's own style:table-row-properties/@style:row-height, on the row's own referenced table:style-name) -- the ODF-side mirror of DocxTableRow.heightPt (src/edit/docx/table.ts), read via odf.js's own exported findStyleElement (family "table-row", a single-level lookup with no parent-chain walk, matching typed/shared/table.ts's own resolveRowHeightPt convention for the identical reason: real ODF table-row automatic styles are standalone in practice) and written via internTableRowProperties's append-only, fingerprint-deduplicated mint above. An unresolvable height is genuinely "no height specified" (the layout engine measures content instead), never 0, matching odf.js's own reader.
  get heightPt(): number | undefined {
    const styleName = attr(this.node, "table:style-name");
    const styleElement =
      styleName === undefined
        ? undefined
        : findStyleElement(styleName, "table-row", this.pkg);
    const props =
      styleElement === undefined
        ? undefined
        : styleElement.children.find(
            (c): c is XmlElement =>
              c.type === "element" && c.tag === "style:table-row-properties",
          );
    const raw =
      props === undefined ? undefined : attr(props, "style:row-height");
    return raw === undefined ? undefined : parseOdfLength(raw);
  }

  // Reads the row's CURRENT style first (currentRowStylePropertiesExceptHeight) so a property this editor has no dedicated getter/setter for -- fo:break-before, style:use-optimal-row-height, fo:keep-together, fo:background-color, exactly what a document opened via openOdt() can already carry -- survives the write, mirroring src/edit/ods/column-row.ts's applyRowStyleProperties (read current, merge, mint fresh). Clearing the height keeps those other properties too, minting a style carrying them alone; only when nothing else remains does clearing remove table:style-name outright, since only then does the row's style exist purely to carry a height.
  set heightPt(value: number | undefined) {
    const otherProperties = currentRowStylePropertiesExceptHeight(
      this.pkg,
      this.node,
    );
    if (value === undefined) {
      if (Object.keys(otherProperties).length === 0) {
        removeAttr(this.node, "table:style-name");
        return;
      }
      setAttr(
        this.node,
        "table:style-name",
        internTableRowProperties(this.pkg, otherProperties),
      );
      return;
    }
    setAttr(
      this.node,
      "table:style-name",
      internTableRowProperties(this.pkg, {
        ...otherProperties,
        "style:row-height": formatOdfLength(value, "pt"),
      }),
    );
  }

  // Appends one ordinary table:table-cell to this row, for a caller (buildOdtPackage's own appendTable) building a row's cells one at a time rather than all at once via OdtTable.appendRow -- needed so a merged table's covered grid positions can be interleaved with real cells in document order.
  appendCell(): OdtTableCell {
    const cellElement = buildCell(this.pkg);
    this.node.children.push(cellElement);
    return new OdtTableCell(cellElement, this.pkg);
  }

  // Appends a table:covered-table-cell -- ODF's own placeholder for a grid position consumed by a horizontal (table:number-columns-spanned) or vertical (table:number-rows-spanned) merge starting elsewhere. Carries no content at all, matching odf.js's own readTableRow, which reads one back as a bare `{ blocks: [] }` regardless of what (if anything) real-world producers ever put inside one.
  appendCoveredCell(): void {
    this.node.children.push(el("table:covered-table-cell"));
  }

  // This row's own true grid-column list -- BOTH real table:table-cell and placeholder table:covered-table-cell children, in document order. ODF's grid model guarantees exactly one child element (of either tag) per grid position in every row, which is why walking both tags (rather than cells()' own real-cell-only filter) gives a startColumnIndex that is correct even for a row a prior vertical merge already covered.
  private gridCells(): XmlElement[] {
    const out: XmlElement[] = [];
    for (const child of this.node.children) {
      if (
        child.type === "element" &&
        (child.tag === "table:table-cell" ||
          child.tag === "table:covered-table-cell")
      ) {
        out.push(child);
      }
    }
    return out;
  }

  // Merges colSpan grid columns of THIS row into one cell: the anchor at startColumnIndex gets table:number-columns-spanned (via OdtTableCell.colSpan), and every OTHER covered position is RETAGGED in place to table:covered-table-cell -- exactly OdsSheet.mergeCells' own technique (src/edit/ods/sheet.ts: `element.tag = ...; element.attributes = []; element.children = [];`), never removed and reinserted, since ODF's grid model requires one child element per grid position regardless of merge state. Consumed cells' own content is discarded silently and unconditionally -- no check, no guard -- matching that same precedent exactly: documented, intentional behaviour, not a silent trap.
  mergeCellsHorizontally(
    startColumnIndex: number,
    colSpan: number,
  ): OdtTableCell {
    if (!Number.isInteger(colSpan) || colSpan < 1) {
      throw new Error(
        `mergeCellsHorizontally: colSpan must be a positive integer, got ${colSpan}`,
      );
    }
    const gridCells = this.gridCells();
    const anchorElement = gridCells[startColumnIndex];
    if (anchorElement === undefined) {
      throw new Error(
        `mergeCellsHorizontally: column ${startColumnIndex} does not exist in this row`,
      );
    }
    if (anchorElement.tag === "table:covered-table-cell") {
      throw new Error(
        `mergeCellsHorizontally: column ${startColumnIndex} is already covered by another merge -- address that merge's own anchor cell instead`,
      );
    }
    if (startColumnIndex + colSpan > gridCells.length) {
      throw new Error(
        `mergeCellsHorizontally: colSpan ${colSpan} starting at column ${startColumnIndex} exceeds this row's own ${gridCells.length} grid columns`,
      );
    }
    for (let i = 1; i < colSpan; i++) {
      const consumedElement = gridCells[startColumnIndex + i];
      if (consumedElement !== undefined) {
        consumedElement.tag = "table:covered-table-cell";
        consumedElement.attributes = [];
        consumedElement.children = [];
      }
    }
    const anchor = new OdtTableCell(anchorElement, this.pkg);
    anchor.colSpan = colSpan;
    return anchor;
  }

  // Marks the grid position at columnIndex as covered by a merge anchored elsewhere (typically a different row, in a vertical merge's own covered rows) -- the single-position primitive OdtTable.mergeCells uses to stamp every covered position in a rowSpan x colSpan rectangle below the anchor row. Retags in place, exactly like mergeCellsHorizontally's own consumed-cell handling above.
  markCellCovered(columnIndex: number): void {
    const gridCells = this.gridCells();
    const element = gridCells[columnIndex];
    if (element === undefined) {
      throw new Error(
        `markCellCovered: column ${columnIndex} does not exist in this row`,
      );
    }
    element.tag = "table:covered-table-cell";
    element.attributes = [];
    element.children = [];
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
        out.push(new OdtTableRow(child, this.pkg));
      }
    }
    return out;
  }

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
    return new OdtTableRow(row, this.pkg);
  }

  // Appends an empty table:table-row with no cells yet, for a caller (buildOdtPackage's own appendTable) that needs to build a merged table's cells one at a time via OdtTableRow.appendCell/appendCoveredCell rather than the uniform-grid shape appendRow(columnCount) always produces.
  appendEmptyRow(): OdtTableRow {
    const node = this.live();
    const row = el("table:table-row");
    node.children.push(row);
    return new OdtTableRow(row, this.pkg);
  }

  // Merges the rowSpan x colSpan rectangle anchored at (startRow, startColumn): calls OdtTableRow.mergeCellsHorizontally on the anchor row (which sets the anchor's own colSpan), sets rowSpan on that same anchor cell when rowSpan > 1, then calls markCellCovered for every column the rectangle covers on every row below the anchor -- unlike docx, ODF's grid model means only the FIRST row of a vertical merge needs a real horizontal merge; every row below it just needs its own covered positions stamped, since table:number-rows-spanned on the anchor already says how many rows the merge covers.
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
    const rows = this.rows();
    const anchorRow = rows[startRow];
    if (anchorRow === undefined) {
      throw new Error(
        `mergeCells: row ${startRow} does not exist in this table`,
      );
    }
    const anchor = anchorRow.mergeCellsHorizontally(startColumn, colSpan);
    if (rowSpan > 1) {
      anchor.rowSpan = rowSpan;
      for (let r = 1; r < rowSpan; r++) {
        const coveredRow = rows[startRow + r];
        if (coveredRow === undefined) {
          throw new Error(
            `mergeCells: rowSpan ${rowSpan} starting at row ${startRow} exceeds this table's own ${rows.length} rows`,
          );
        }
        for (let c = 0; c < colSpan; c++) {
          coveredRow.markCellCovered(startColumn + c);
        }
      }
    }
    return anchor;
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
