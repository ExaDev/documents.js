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

// A structural clone of the row's own current style:table-row-properties element (currentRowPropertiesElement above), or a fresh empty one when the row has none -- structuredClone is safe here exactly as it is at src/edit/ods/address.ts's own identical use: an XmlElement is plain, serializable data with no methods or non-cloneable values. Cloning the WHOLE element, rather than reconstructing it attribute-by-attribute the way this file's own previous version did, is what lets EVERY property already on it survive a heightPt write untouched -- not just the ones this file has a dedicated getter/setter for (fo:break-before, style:use-optimal-row-height, fo:keep-together, fo:background-color) but also this element's one permitted CHILD, style:background-image (OASIS ODF 1.3 RelaxNG: style:table-row-properties-content permits exactly that one optional child) -- without this file ever needing to enumerate each one by name. The caller mutates only style:row-height (and, conditionally, style:use-optimal-row-height) on the returned clone; see the heightPt setter below.
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
