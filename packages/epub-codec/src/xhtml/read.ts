import type {
  ContentBlock,
  ContentListMembership,
  ContentParagraph,
  ContentTableCell,
  ContentTableRow,
} from "document-schema.js";
import { clampHeadingLevel } from "document-schema.js";
import { EpubDiagnosticCodes } from "../diagnostics";
import {
  detectImageFormat,
  POINTS_PER_PIXEL,
  readImageDimensions,
} from "../image/dimensions";
import { bytesToBase64 } from "../util/base64";
import type { XmlElement, XmlNode } from "../xml/node";
import {
  attrValue,
  elementsWithTag,
  findChildElement,
  rootElement,
  textContent,
} from "../xml/query";
import { decodeEntities } from "../xml/entities";
import { parseXml } from "../xml/parse";
import type { XhtmlReadContext } from "./context";
import { isFootnoteAside, isFootnoteReferenceAnchor } from "./footnote";
import { buildInlineRuns } from "./inline";
import type { MintListNumIdOptions } from "./list-id";
import { mintListNumId } from "./list-id";
import {
  DEFINITION_BODY_INDENT_PT,
  HORIZONTAL_RULE_STYLE_ID,
  MONOSPACE_FONT_FAMILY,
  QUOTE_INDENT_PT,
  QUOTE_STYLE_ID,
} from "./style-constants";

// EPUB 3.3 content documents are well-formed XHTML by spec (not tag-soup HTML), read through the shared fast-xml-parser stack every module in this package uses -- no bespoke HTML parser anywhere. This module maps one XHTML content document's <body> to document-schema.js's ContentBlock[], the shape one ContentSection's own `blocks` field carries; src/read.ts calls this once per spine itemref and wraps the result in a section.

interface ListContext {
  readonly numId: string;
  readonly level: number;
}

interface ListItemContext {
  readonly numId: string;
  readonly level: number;
  readonly itemId: string;
}

interface IdMinter {
  mintNumId(options: MintListNumIdOptions): string;
  mintItemId(): string;
}

function createIdMinter(): IdMinter {
  let nextList = 0;
  let nextItem = 0;
  return {
    mintNumId: (options) => {
      nextList += 1;
      return mintListNumId(nextList, options);
    },
    mintItemId: () => {
      nextItem += 1;
      return `item${String(nextItem)}`;
    },
  };
}

// Per-call build state that isn't part of the shared read-only XhtmlReadContext (image/diagnostic/id-map port), since it changes as the block walk descends -- quote depth, the current list membership, and the running content-width used to divide a table's columns evenly.
interface BuildState {
  readonly context: XhtmlReadContext;
  readonly minter: IdMinter;
  readonly quoteDepth: number;
  readonly listItem: ListItemContext | undefined;
  readonly list: ListContext | undefined;
  readonly contentWidthPt: number;
}

function withQuote(state: BuildState): BuildState {
  return { ...state, quoteDepth: state.quoteDepth + 1 };
}

function withListItem(
  state: BuildState,
  listItem: ListItemContext,
): BuildState {
  return {
    ...state,
    listItem,
    list: { numId: listItem.numId, level: listItem.level },
  };
}

// Applies the two cross-cutting decorations every leaf paragraph-shaped block picks up from its own enclosing context: blockquote nesting (indentLeftPt, and a Quote styleId only when the block did not already set a more specific one) and list membership -- mirroring markdown-codec's own decorateParagraph exactly, the identical gap in document-schema.js's own vocabulary (there is no dedicated blockquote/list-container node; nesting is carried as a per-paragraph fact).
function decorateParagraph(
  paragraph: ContentParagraph,
  state: BuildState,
): ContentParagraph {
  let decorated = paragraph;
  if (state.quoteDepth > 0) {
    decorated = {
      ...decorated,
      indentLeftPt: state.quoteDepth * QUOTE_INDENT_PT,
      styleId: decorated.styleId ?? QUOTE_STYLE_ID,
    };
  }
  if (state.listItem !== undefined) {
    const membership: ContentListMembership = {
      numId: state.listItem.numId,
      level: state.listItem.level,
      itemId: state.listItem.itemId,
    };
    decorated = { ...decorated, list: membership };
  }
  return decorated;
}

function buildIdElementMap(nodes: readonly XmlNode[]): Map<string, XmlElement> {
  const map = new Map<string, XmlElement>();
  const stack: XmlNode[] = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node?.type !== "element") {
      continue;
    }
    const id = attrValue(node, "id");
    if (id !== undefined && !map.has(id)) {
      map.set(id, node);
    }
    stack.push(...node.children);
  }
  return map;
}

export interface ReadXhtmlBodyOptions {
  readonly resolveImage: (href: string) => Uint8Array<ArrayBuffer> | undefined;
  readonly sink: (diagnostic: {
    code: string;
    severity: "info" | "warning";
    message: string;
    href?: string;
  }) => void;
  readonly sourceHref: string;
  readonly contentWidthPt: number;
}

// The top-level entry: parses one XHTML content document's full text and maps its <body> to ContentBlock[]. Throws nothing of its own -- a document with no <body> at all reads as an empty block list, since a spine itemref pointing at genuinely unparsable XML is this package's own EpubParseError territory (src/read.ts), not this module's.
export function readXhtmlBody(
  xml: string,
  options: ReadXhtmlBodyOptions,
): ContentBlock[] {
  const nodes = parseXml(xml);
  const html = rootElement(nodes);
  const body =
    html === undefined ? undefined : findChildElement(html.children, "body");
  if (body === undefined) {
    return [];
  }
  const idElements = buildIdElementMap(body.children);
  const footnoteTargetIds = new Set<string>();
  for (const anchor of elementsWithTag(body.children, "a")) {
    const name = isFootnoteReferenceAnchor(anchor, idElements);
    if (name !== undefined) {
      footnoteTargetIds.add(name);
    }
  }
  const context: XhtmlReadContext = {
    resolveImage: options.resolveImage,
    sink: options.sink,
    sourceHref: options.sourceHref,
    idElements,
    footnoteTargetIds,
    quoteDepth: 0,
  };
  const state: BuildState = {
    context,
    minter: createIdMinter(),
    quoteDepth: 0,
    listItem: undefined,
    list: undefined,
    contentWidthPt: options.contentWidthPt,
  };
  return readContainerChildren(body.children, state);
}

// Every container this package maps transparently (li, blockquote, aside, div/section/..., and the top-level body itself) is, per the XHTML content model, legally allowed to mix real block-level children with bare phrasing content (text and inline markup with no block wrapper) as siblings -- <li>text<ul>...</ul></li> is exactly as real as <li><p>text</p><ul>...</ul></li>, and both idioms appear in real EPUBs. A dispatcher that only recurses into element children whose own tag it recognises as a block would silently drop the phrasing case outright: any stray text node sitting among block siblings is skipped, wherever it falls. This walks the children in source order instead, accumulating a run of phrasing content into its own implicit paragraph (dropped if it produces no runs) and flushing it the moment a real block-level element is reached -- the same "anonymous block box" rule every browser's own HTML block-formatting context applies to inline content sitting beside block siblings. Every block-level dispatch point in this module (a <p>'s own children, a <li>'s, a <blockquote>'s, an <aside>'s, and every other container's default passthrough) reaches content exclusively through this one function; nothing else in the module walks a raw children array directly.
const BLOCK_LEVEL_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "dl",
  "table",
  "blockquote",
  "pre",
  "hr",
  "figure",
  "figcaption",
  "div",
  "section",
  "article",
  "aside",
  "nav",
  "img",
]);

function readContainerChildren(
  nodes: readonly XmlNode[],
  state: BuildState,
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  let segment: XmlNode[] = [];
  const flush = (): void => {
    if (segment.length === 0) {
      return;
    }
    const inline = buildInlineRuns(segment, {}, state.context);
    segment = [];
    if (inline.runs.length === 0) {
      return;
    }
    const paragraph: ContentParagraph = {
      kind: "paragraph",
      runs: inline.runs,
      ...(inline.constructs.length > 0
        ? { constructs: inline.constructs }
        : {}),
    };
    blocks.push(decorateParagraph(paragraph, state));
  };
  for (const node of nodes) {
    if (node.type === "element" && BLOCK_LEVEL_TAGS.has(node.tag)) {
      flush();
      blocks.push(...readBlockElement(node, state));
      continue;
    }
    if (node.type === "element" || node.type === "text") {
      segment.push(node);
    }
  }
  flush();
  return blocks;
}

function headingLevelOf(tag: string): number | undefined {
  const match = /^h([1-6])$/u.exec(tag);
  return match?.[1] === undefined
    ? undefined
    : clampHeadingLevel(Number(match[1]));
}

// Wraps readBlockElementInner's own result in a footnote anchor construct pair when this element's own id is a recognised EPUB 2 linked-anchor footnote/endnote body target (src/xhtml/footnote.ts's isFootnoteReferenceAnchor, run over every <a> once per document by readXhtmlBody) -- the target-side half of that idiom, symmetric with an EPUB 3 <aside epub:type="footnote"> (readAside below), which instead recognises itself directly rather than needing this reverse lookup. An element already handled as such an aside is excluded here to avoid double-wrapping.
function readBlockElement(
  element: XmlElement,
  state: BuildState,
): ContentBlock[] {
  const id = attrValue(element, "id");
  const isFootnoteTarget =
    id !== undefined &&
    state.context.footnoteTargetIds.has(id) &&
    !isFootnoteAside(element);
  const blocks = readBlockElementInner(element, state);
  if (!isFootnoteTarget) {
    return blocks;
  }
  return [
    {
      kind: "constructStart",
      descriptor: { kind: "anchor", anchorType: "footnote", name: id },
    },
    ...blocks,
    { kind: "constructEnd" },
  ];
}

function readBlockElementInner(
  element: XmlElement,
  state: BuildState,
): ContentBlock[] {
  const headingLevel = headingLevelOf(element.tag);
  if (headingLevel !== undefined) {
    const inline = buildInlineRuns(element.children, {}, state.context);
    const paragraph: ContentParagraph = {
      kind: "paragraph",
      headingLevel,
      runs: inline.runs,
      ...(inline.constructs.length > 0
        ? { constructs: inline.constructs }
        : {}),
    };
    return [decorateParagraph(paragraph, state)];
  }

  switch (element.tag) {
    case "p":
      // A <p> containing a direct <img> (some producers/editors wrap every floating image in a paragraph tag rather than a <figure>) cannot become one ContentParagraph -- an image is its own top-level ContentBlock kind, not a run a paragraph can carry inline. readContainerChildren's own phrasing/block split handles this identically to any other container: the text before and after the image becomes its own paragraph (dropped entirely when empty, so a bare `<p><img/></p>` degrades to just the image block), and the image becomes its own block in between, in source order.
      return readContainerChildren(element.children, state);
    case "hr": {
      const paragraph: ContentParagraph = {
        kind: "paragraph",
        runs: [],
        styleId: HORIZONTAL_RULE_STYLE_ID,
      };
      return [decorateParagraph(paragraph, state)];
    }
    case "pre":
      return [readPre(element, state)];
    case "blockquote":
      return readBlockquote(element, state);
    case "ul":
    case "ol":
      return readList(element, state);
    case "dl":
      return readDefinitionList(element, state);
    case "table":
      return [readTable(element, state)];
    case "figure":
      return readContainerChildren(element.children, state);
    case "figcaption": {
      const inline = buildInlineRuns(element.children, {}, state.context);
      const paragraph: ContentParagraph = {
        kind: "paragraph",
        runs: inline.runs,
      };
      return [decorateParagraph(paragraph, state)];
    }
    case "img": {
      const block = readImage(element, state);
      return block === undefined ? [] : [block];
    }
    case "aside":
      return readAside(element, state);
    default:
      // Every other block-level container (div, section, article, nav that isn't the toc/landmarks/page-list nav src/nav.ts already reads separately, body itself never reaches here) carries no content of its own in document-schema.js's vocabulary -- it is read transparently, descending into its own children at the same nesting level. This is a deliberate, documented simplification: a div's own CSS class/id is residue this package does not interpret (the schema is content, not styling).
      return readContainerChildren(element.children, state);
  }
}

function readPre(element: XmlElement, state: BuildState): ContentBlock {
  const codeElement = findChildElement(element.children, "code");
  const languageSource = codeElement ?? element;
  const codeLanguage = languageFromClass(attrValue(languageSource, "class"));
  const text = decodeEntities(textContent(element.children));
  const paragraph: ContentParagraph = {
    kind: "paragraph",
    runs: text.length > 0 ? [{ text, fontFamily: MONOSPACE_FONT_FAMILY }] : [],
    ...(codeLanguage !== undefined ? { codeLanguage } : {}),
  };
  return decorateParagraph(paragraph, state);
}

// A common real-world convention (highlight.js, Prism, and this package's own writer alike): a fenced code block's language rides a "language-xxx" class on the <code> element.
function languageFromClass(className: string | undefined): string | undefined {
  if (className === undefined) {
    return undefined;
  }
  const match = /(?:^|\s)language-(\S+)/u.exec(className);
  return match?.[1];
}

// Whether a blockquote's own subtree carries a heading anywhere -- a construct extent may never open or close a heading scope (document-schema.js's own decompose is the enforcement point), so a quote containing one cannot carry the division construct pair and degrades to indent-only structure instead, matching markdown-codec's identical rule for the identical schema constraint.
function containsHeading(nodes: readonly XmlNode[]): boolean {
  for (const node of nodes) {
    if (node.type !== "element") {
      continue;
    }
    if (headingLevelOf(node.tag) !== undefined) {
      return true;
    }
    if (containsHeading(node.children)) {
      return true;
    }
  }
  return false;
}

function readBlockquote(
  element: XmlElement,
  state: BuildState,
): ContentBlock[] {
  const nestedState = withQuote(state);
  const blocks = readContainerChildren(element.children, nestedState);
  if (containsHeading(element.children)) {
    return blocks;
  }
  return [
    { kind: "constructStart", descriptor: { kind: "division" } },
    ...blocks,
    { kind: "constructEnd" },
  ];
}

function readList(element: XmlElement, state: BuildState): ContentBlock[] {
  const numId =
    state.list?.numId ??
    state.minter.mintNumId({
      type: element.tag === "ol" ? "ordered" : "bullet",
      start: startAttr(element),
    });
  const level = state.list === undefined ? 0 : state.list.level + 1;
  const blocks: ContentBlock[] = [];
  for (const child of element.children) {
    if (child.type !== "element" || child.tag !== "li") {
      continue;
    }
    const itemId = state.minter.mintItemId();
    const itemState = withListItem(state, { numId, level, itemId });
    blocks.push(...readContainerChildren(child.children, itemState));
  }
  return blocks;
}

function startAttr(element: XmlElement): number | undefined {
  return positiveIntAttr(element, "start");
}

function readDefinitionList(
  element: XmlElement,
  state: BuildState,
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const child of element.children) {
    if (child.type !== "element") {
      continue;
    }
    if (child.tag === "dt") {
      const inline = buildInlineRuns(child.children, {}, state.context);
      blocks.push(
        decorateParagraph({ kind: "paragraph", runs: inline.runs }, state),
      );
    } else if (child.tag === "dd") {
      const inline = buildInlineRuns(child.children, {}, state.context);
      blocks.push(
        decorateParagraph(
          {
            kind: "paragraph",
            runs: inline.runs,
            indentLeftPt:
              DEFINITION_BODY_INDENT_PT + state.quoteDepth * QUOTE_INDENT_PT,
          },
          state,
        ),
      );
    }
  }
  return blocks;
}

function readTable(element: XmlElement, state: BuildState): ContentBlock {
  const rows: ContentTableRow[] = [];
  let columnCount = 0;
  for (const section of element.children) {
    if (section.type !== "element") {
      continue;
    }
    const rowContainers =
      section.tag === "tr"
        ? [section]
        : section.tag === "thead" ||
            section.tag === "tbody" ||
            section.tag === "tfoot"
          ? section.children.filter(
              (c): c is XmlElement => c.type === "element" && c.tag === "tr",
            )
          : [];
    for (const tr of rowContainers) {
      const cells: ContentTableCell[] = [];
      for (const cellNode of tr.children) {
        if (
          cellNode.type !== "element" ||
          (cellNode.tag !== "td" && cellNode.tag !== "th")
        ) {
          continue;
        }
        const isHeader = cellNode.tag === "th";
        const cellStyle = isHeader ? { bold: true } : {};
        const inline = buildInlineRuns(
          cellNode.children,
          cellStyle,
          state.context,
        );
        const paragraph: ContentParagraph = {
          kind: "paragraph",
          runs: inline.runs,
        };
        const colSpan = positiveIntAttr(cellNode, "colspan");
        const rowSpan = positiveIntAttr(cellNode, "rowspan");
        cells.push({
          blocks: [paragraph],
          ...(colSpan !== undefined ? { colSpan } : {}),
          ...(rowSpan !== undefined ? { rowSpan } : {}),
        });
      }
      columnCount = Math.max(columnCount, cells.length);
      rows.push({ cells });
    }
  }
  const width =
    columnCount > 0 ? state.contentWidthPt / columnCount : state.contentWidthPt;
  return {
    kind: "table",
    rows,
    columnWidthsPt: new Array<number>(Math.max(columnCount, 1)).fill(width),
  };
}

function positiveIntAttr(
  element: XmlElement,
  name: string,
): number | undefined {
  const raw = attrValue(element, name);
  if (raw === undefined) {
    return undefined;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function readImage(
  element: XmlElement,
  state: BuildState,
): ContentBlock | undefined {
  const src = attrValue(element, "src");
  const alt = attrValue(element, "alt");
  if (src === undefined) {
    return undefined;
  }
  const bytes = state.context.resolveImage(src);
  if (bytes === undefined) {
    state.context.sink({
      code: EpubDiagnosticCodes.IMAGE_UNRESOLVED,
      severity: "warning",
      message: `<img src="${src}"> names no resolvable manifest part; degraded to its alt text`,
      href: state.context.sourceHref,
    });
    return alt === undefined || alt.length === 0
      ? undefined
      : decorateParagraph(
          { kind: "paragraph", runs: [{ text: decodeEntities(alt) }] },
          state,
        );
  }
  const format = detectImageFormat(bytes);
  const dimensions = readImageDimensions(bytes);
  if (format === undefined || dimensions === undefined) {
    state.context.sink({
      code: EpubDiagnosticCodes.IMAGE_FORMAT_UNSUPPORTED,
      severity: "warning",
      message: `<img src="${src}"> is neither a PNG nor a JPEG (document-schema.js's ContentImageBlock supports only those two); degraded to its alt text`,
      href: state.context.sourceHref,
    });
    return alt === undefined || alt.length === 0
      ? undefined
      : decorateParagraph(
          { kind: "paragraph", runs: [{ text: decodeEntities(alt) }] },
          state,
        );
  }
  return {
    kind: "image",
    format,
    base64: bytesToBase64(bytes),
    widthPt: dimensions.widthPx * POINTS_PER_PIXEL,
    heightPt: dimensions.heightPx * POINTS_PER_PIXEL,
    ...(alt !== undefined && alt.length > 0
      ? { altText: decodeEntities(alt) }
      : {}),
  };
}

function readAside(element: XmlElement, state: BuildState): ContentBlock[] {
  if (!isFootnoteAside(element)) {
    return readContainerChildren(element.children, state);
  }
  const name = attrValue(element, "id");
  if (name === undefined) {
    state.context.sink({
      code: EpubDiagnosticCodes.FOOTNOTE_TARGET_UNRESOLVED,
      severity: "warning",
      message:
        "a footnote <aside> carries no id and cannot be referenced; read as ordinary content",
      href: state.context.sourceHref,
    });
    return readContainerChildren(element.children, state);
  }
  return [
    {
      kind: "constructStart",
      descriptor: { kind: "anchor", anchorType: "footnote", name },
    },
    ...readContainerChildren(element.children, state),
    { kind: "constructEnd" },
  ];
}
