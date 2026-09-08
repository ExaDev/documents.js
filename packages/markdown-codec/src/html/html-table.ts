// A raw HTML <table> block -> ContentTable: the read-side half of the HTML-table fallback (ExaDev/documents.js#1089), the exact structural inverse of src/emit/html-table.ts. GFM's own pipe-table syntax has no grammar for a cell's colSpan/rowSpan/background, or for a non-inlinable block (a nested table, say) inside a cell (github.github.com/gfm, "Tables (extension)" -- a cell holds inline content only); this module recognises the one shape src/emit/html-table.ts writes for that case back into a real ContentTable, so the write-side fallback is a genuine round trip rather than a one-way improvement. A raw HTML `<table>` block is legal CommonMark (spec 0.31.2, "HTML blocks", start condition 6 names `table` directly -- https://spec.commonmark.org/0.31.2/#html-blocks), and src/html/html.ts's own top comment states this package's html_block handling never parses such a block's content as markup; this module is the one place that changes, for exactly one recognised shape, in the same bounded-recogniser spirit html.ts already establishes for raw HTML generally -- table/tr/td/th and their colspan/rowspan/style attributes specifically, never a general HTML-to-DOM parser. Content inside a raw HTML block is never reprocessed as markdown either (the same top comment), so a cell's own inline formatting is read back from real HTML tags (<strong>/<em>/<del>/<code>/<a href>) rather than markdown syntax.
//
// Whatever shape this parser refuses -- multiple top-level tables in one block, stray text alongside a table, an unrecognised or unquoted attribute, an unterminated element -- is left for src/lower/lower.ts's own existing opaque-preservation path to handle exactly as it always has; this module returns undefined rather than guessing, and never throws.

import type {
  Alignment,
  Color,
  ContentBlock,
  ContentCellFill,
  ContentImageBlock,
  ContentRun,
  ContentTable,
  ContentTableCell,
  ContentTableRow,
} from "document-schema.js";
import { rgbHexToColor } from "document-schema.js";
import { resolveMarkdownImage } from "../lower/image";
import { MONOSPACE_FONT_FAMILY } from "../shared/style-constants";

// --- Bounded balanced-tag scanning -- the one primitive every level of this parser (table -> tr -> td/th -> nested table) shares. ---

interface HtmlElement {
  readonly attrs: string;
  readonly inner: string;
}

// Where the element that opened at `openEnd` (just past its own opening tag's '>') closes, by depth-counting further opens/closes of any tag named in `tagNames` (case-insensitive) -- so a tag nested inside a DIFFERENT same-class element (a <table> nested inside a <td> that is itself inside a <tr>, or a <td> belonging to THAT nested table) is skipped over correctly by depth alone, without this parser ever needing to know which element a given tag "belongs to". Returns the matching close tag's own [start, end) span, or undefined for an unterminated element -- a shape this bounded recogniser refuses to guess about rather than silently truncating.
function findBalancedClose(
  text: string,
  openEnd: number,
  tagNames: readonly string[],
): { readonly start: number; readonly end: number } | undefined {
  const names = tagNames.join("|");
  const openPattern = new RegExp(`<(?:${names})(?=[\\s/>])`, "gi");
  const closePattern = new RegExp(`</(?:${names})\\s*>`, "gi");
  let depth = 1;
  let pos = openEnd;
  while (depth > 0) {
    openPattern.lastIndex = pos;
    closePattern.lastIndex = pos;
    const openMatch = openPattern.exec(text);
    const closeMatch = closePattern.exec(text);
    if (closeMatch === null) {
      return undefined;
    }
    if (openMatch !== null && openMatch.index < closeMatch.index) {
      depth += 1;
      pos = openMatch.index + openMatch[0].length;
      continue;
    }
    depth -= 1;
    pos = closeMatch.index + closeMatch[0].length;
    if (depth === 0) {
      return { start: closeMatch.index, end: pos };
    }
  }
  return undefined;
}

// Every top-level (not nested inside another same-class element) <tagName ...>...</tagName> in `text`, tolerating only whitespace between and around them -- any other stray content refuses the whole parse rather than guessing which parts to keep. `tagNames` lets td/th share one pass: a table cell is one or the other, and ContentTableRow never itself distinguishes them -- row position alone marks the header row (src/lower/table.ts's own top comment, mirrored on the write side by src/emit/html-table.ts).
function extractTopLevelElements(
  text: string,
  tagNames: readonly string[],
): HtmlElement[] | undefined {
  const openPattern = new RegExp(`<(?:${tagNames.join("|")})\\b([^>]*)>`, "gi");
  const elements: HtmlElement[] = [];
  let pos = 0;
  for (;;) {
    openPattern.lastIndex = pos;
    const match = openPattern.exec(text);
    if (match === null) {
      break;
    }
    if (text.slice(pos, match.index).trim().length > 0) {
      return undefined;
    }
    const attrs = match[1] ?? "";
    const openEnd = match.index + match[0].length;
    const close = findBalancedClose(text, openEnd, tagNames);
    if (close === undefined) {
      return undefined;
    }
    elements.push({ attrs, inner: text.slice(openEnd, close.start) });
    pos = close.end;
  }
  if (text.slice(pos).trim().length > 0) {
    return undefined;
  }
  return elements;
}

// --- Attribute reading -- double-quoted values only, matching exactly what src/emit/html-table.ts itself always writes; a single-quoted or unquoted attribute value is a real HTML shape this bounded recogniser simply does not attempt (the same deliberate boundary html.ts draws around a general parser). ---

function readAttr(attrs: string, name: string): string | undefined {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i");
  return pattern.exec(attrs)?.[1];
}

function readPositiveIntAttr(attrs: string, name: string): number | undefined {
  const raw = readAttr(attrs, name);
  if (raw === undefined) {
    return undefined;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

// A `style="...background-color: #rrggbb..."` declaration -- the one CSS shape src/emit/html-table.ts's own writer ever produces for a cell's solid ContentCellFill, and the only one this reader recognises back; a pattern fill has no such CSS equivalent to begin with (see that module's own top comment) so there is nothing here for a pattern to round-trip through. The 3-digit shorthand (#rgb) is accepted too since it is completely unambiguous, even though the writer itself always emits the 6-digit form.
const BACKGROUND_COLOR_PATTERN =
  /background-color\s*:\s*#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/i;

function readBackgroundFill(attrs: string): ContentCellFill | undefined {
  const style = readAttr(attrs, "style");
  if (style === undefined) {
    return undefined;
  }
  const hex = BACKGROUND_COLOR_PATTERN.exec(style)?.[1];
  if (hex === undefined) {
    return undefined;
  }
  const normalised =
    hex.length === 3
      ? hex
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : hex;
  const color: Color = rgbHexToColor(normalised);
  return { kind: "solid", color };
}

// A `style="...text-align: <value>..."` declaration -- src/emit/html-table.ts's own exact mirror of the alignment it reads from a cell's own paragraph, richer than a plain GFM table's single per-column marker (see that module's own top comment) so it is read back per cell here too, applied onto whichever block ends up as the cell's own sole/first content when that block is a paragraph.
const TEXT_ALIGN_PATTERN = /text-align\s*:\s*(left|right|center|justify)\b/i;

function readTextAlign(attrs: string): Alignment | undefined {
  const style = readAttr(attrs, "style");
  if (style === undefined) {
    return undefined;
  }
  switch (TEXT_ALIGN_PATTERN.exec(style)?.[1]?.toLowerCase()) {
    case "left":
      return "left";
    case "right":
      return "right";
    case "center":
      return "center";
    case "justify":
      return "justify";
    default:
      return undefined;
  }
}

// --- HTML entity decoding -- the fixed handful src/emit/html-table.ts's own escapeHtmlText/escapeHtmlAttribute ever produce, decoded in an order that never double-unescapes an already-literal "&amp;lt;" back into "<". ---

function unescapeHtml(text: string): string {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

// --- Inline content: the small, closed HTML tag vocabulary mirroring exactly what src/emit/inline.ts already spells in markdown syntax for a plain GFM table cell (bold/italic/strike/hyperlink/Courier-New-as-code-span -- see that module's own top comment) -- retargeted to real HTML tags here because raw HTML block content is never reprocessed as markdown (this module's own top comment). Recognised tags nest in any order and any combination; a run's own accumulated style merges every enclosing recognised tag's flag regardless of nesting order, so the write side is free to pick one fixed order (src/emit/html-table.ts does) without this reader depending on it. ---

type RunStyle = Pick<
  ContentRun,
  "bold" | "italic" | "strike" | "hyperlink" | "fontFamily"
>;

const INLINE_TAG_PATTERN = /<(a|strong|b|em|i|del|s|strike|code)\b([^>]*)>/i;

function applyTagStyle(
  style: RunStyle,
  tagName: string,
  attrs: string,
): RunStyle {
  switch (tagName) {
    case "strong":
    case "b":
      return { ...style, bold: true };
    case "em":
    case "i":
      return { ...style, italic: true };
    case "del":
    case "s":
    case "strike":
      return { ...style, strike: true };
    case "code":
      return { ...style, fontFamily: MONOSPACE_FONT_FAMILY };
    case "a": {
      const href = readAttr(attrs, "href");
      return href === undefined
        ? style
        : { ...style, hyperlink: unescapeHtml(href) };
    }
    default:
      return style;
  }
}

function pushPlainRun(runs: ContentRun[], text: string, style: RunStyle): void {
  if (text.length === 0) {
    return;
  }
  runs.push({ text: unescapeHtml(text), ...style });
}

function parseInlineHtml(text: string, style: RunStyle): ContentRun[] {
  const runs: ContentRun[] = [];
  let pos = 0;
  for (;;) {
    const rest = text.slice(pos);
    const match = INLINE_TAG_PATTERN.exec(rest);
    if (match === null) {
      pushPlainRun(runs, rest, style);
      return runs;
    }
    pushPlainRun(runs, rest.slice(0, match.index), style);
    const tagName = match[1]!.toLowerCase();
    const attrs = match[2] ?? "";
    const openEnd = pos + match.index + match[0].length;
    const close = findBalancedClose(text, openEnd, [tagName]);
    if (close === undefined) {
      // An unterminated recognised tag is not a shape worth guessing about -- the rest of this cell's own text stays literal, tag markup included, exactly as an unrecognised construct elsewhere in this package degrades to its own escaped/literal spelling rather than a best-effort repair.
      pushPlainRun(runs, rest, style);
      return runs;
    }
    runs.push(
      ...parseInlineHtml(
        text.slice(openEnd, close.start),
        applyTagStyle(style, tagName, attrs),
      ),
    );
    pos = close.end;
  }
}

// --- Block content: an <img> tag on its own recognises as an image block (reusing src/lower/image.ts's own data: URI decoder, the identical mechanism a markdown image destination already resolves through); anything else splits on the same literal <br> src/emit/html-table.ts's own writer joins multiple blocks with, one paragraph per segment; a cell whose ENTIRE content is one nested <table> recognises as that nested ContentTable directly, recursing through this module's own top-level table parser -- the one shape a nested block in a cell is bounded to (see this module's own top comment and ExaDev/documents.js#1089's own issue text). ---

const IMG_TAG_PATTERN = /^<img\b([^>]*?)\/?>$/i;

function parseHtmlImage(piece: string): ContentImageBlock | undefined {
  const attrs = IMG_TAG_PATTERN.exec(piece)?.[1];
  if (attrs === undefined) {
    return undefined;
  }
  const src = readAttr(attrs, "src");
  if (src === undefined) {
    return undefined;
  }
  const alt = unescapeHtml(readAttr(attrs, "alt") ?? "");
  const resolved = resolveMarkdownImage(src, { alt }, undefined);
  if (resolved === undefined) {
    return undefined;
  }
  return {
    kind: "image",
    format: resolved.format,
    base64: resolved.base64,
    widthPt: resolved.widthPt,
    heightPt: resolved.heightPt,
    altText: alt,
  };
}

function parseCellBlocks(
  inner: string,
  contentWidthPt: number,
): ContentBlock[] {
  const trimmed = inner.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const nestedTable = parseWholeTable(trimmed, contentWidthPt);
  if (nestedTable !== undefined) {
    return [nestedTable];
  }
  const blocks: ContentBlock[] = [];
  for (const segment of trimmed.split(/<br\s*\/?>/i)) {
    const piece = segment.trim();
    if (piece.length === 0) {
      continue;
    }
    const image = parseHtmlImage(piece);
    blocks.push(
      image ?? { kind: "paragraph", runs: parseInlineHtml(piece, {}) },
    );
  }
  return blocks;
}

// Applies a cell's own `text-align` (see readTextAlign above) onto its first block, when that block is a paragraph -- the same "first block only" scope src/emit/html-table.ts's own textAlignStyleAttr reads from on the way out, so this is a genuine inverse rather than a wider or narrower one.
function applyTextAlign(
  blocks: ContentBlock[],
  alignment: Alignment | undefined,
): ContentBlock[] {
  const first = blocks[0];
  if (alignment === undefined || first?.kind !== "paragraph") {
    return blocks;
  }
  return [{ ...first, alignment }, ...blocks.slice(1)];
}

function buildCell(
  cell: HtmlElement,
  contentWidthPt: number,
): ContentTableCell {
  const colSpan = readPositiveIntAttr(cell.attrs, "colspan");
  const rowSpan = readPositiveIntAttr(cell.attrs, "rowspan");
  const background = readBackgroundFill(cell.attrs);
  const textAlign = readTextAlign(cell.attrs);
  const parsedBlocks = parseCellBlocks(cell.inner, contentWidthPt);
  const blocks = applyTextAlign(
    parsedBlocks.length > 0
      ? parsedBlocks
      : [{ kind: "paragraph" as const, runs: [] }],
    textAlign,
  );
  return {
    blocks,
    ...(colSpan === undefined ? {} : { colSpan }),
    ...(rowSpan === undefined ? {} : { rowSpan }),
    ...(background === undefined ? {} : { background }),
  };
}

function parseTableRows(
  inner: string,
  contentWidthPt: number,
): ContentTableRow[] | undefined {
  const rowElements = extractTopLevelElements(inner, ["tr"]);
  if (rowElements === undefined || rowElements.length === 0) {
    return undefined;
  }
  const rows: ContentTableRow[] = [];
  for (const row of rowElements) {
    const cellElements = extractTopLevelElements(row.inner, ["td", "th"]);
    if (cellElements === undefined || cellElements.length === 0) {
      return undefined;
    }
    rows.push({
      cells: cellElements.map((cell) => buildCell(cell, contentWidthPt)),
    });
  }
  return rows;
}

// Column count and evenly-distributed columnWidthsPt read from the header row's own cells (rows[0], summing each cell's own colSpan -- default 1 -- across it), the identical convention src/lower/table.ts's own lowerTable already uses for a plain GFM table; absolute widths were never something either grammar carries, so this is a minted approximation on read exactly as it already is there.
function buildContentTable(
  rows: ContentTableRow[],
  contentWidthPt: number,
): ContentTable {
  const header = rows[0]!;
  const columnCount = Math.max(
    1,
    header.cells.reduce((sum, cell) => sum + (cell.colSpan ?? 1), 0),
  );
  const columnWidthsPt = Array.from(
    { length: columnCount },
    () => contentWidthPt / columnCount,
  );
  return { kind: "table", rows, columnWidthsPt };
}

// Whether `text`, in its ENTIRETY (only surrounding whitespace tolerated), is exactly one <table>...</table> element -- shared by parseHtmlTable's own top-level entry point and parseCellBlocks' "is this cell's whole content one nested table" check above, since both ask the identical question.
function parseWholeTable(
  text: string,
  contentWidthPt: number,
): ContentTable | undefined {
  const tableElements = extractTopLevelElements(text, ["table"]);
  if (tableElements?.length !== 1) {
    return undefined;
  }
  const rows = parseTableRows(tableElements[0]!.inner, contentWidthPt);
  return rows === undefined
    ? undefined
    : buildContentTable(rows, contentWidthPt);
}

// The public entry point: an html_block's own literal source text (src/ast/ast.ts's MarkdownHtmlBlockNode.literal) -> a ContentTable, or undefined when it is not -- in full -- one well-formed <table> this bounded recogniser understands, in which case src/lower/lower.ts's own lowerHtmlBlock falls through to its existing opaque-preservation path exactly as it always has. `contentWidthPt` is the same section-wide content width src/lower/table.ts's own lowerTable already threads through for a plain GFM table (this package invents no page geometry of its own beyond that one shared default -- MarkdownDiagnosticCodes.INVENTED_PAGE_GEOMETRY).
export function parseHtmlTable(
  literal: string,
  contentWidthPt: number,
): ContentTable | undefined {
  const trimmed = literal.trim();
  if (!/^<table\b/i.test(trimmed)) {
    return undefined;
  }
  return parseWholeTable(trimmed, contentWidthPt);
}
