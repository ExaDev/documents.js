import type {
  ContentBlock,
  ContentListMembership,
  ContentParagraph,
  ContentTableCell,
  ContentTableRow,
  SourceResidue,
} from "document-schema.js";
import { clampHeadingLevel } from "document-schema.js";
import { EpubDiagnosticCodes } from "../diagnostics";
import {
  detectImageFormat,
  POINTS_PER_PIXEL,
  readImageDimensions,
} from "../image/dimensions";
import { bytesToBase64 } from "../util/base64";
import { buildXml } from "../xml/build";
import type { XmlElement, XmlNode } from "../xml/node";
import {
  attrValue,
  elementsWithTag,
  findChildElement,
  rootElement,
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

export interface ReadXhtmlBodyResult {
  readonly blocks: ContentBlock[];
  // The document's own <head> style declarations (<link rel="stylesheet">, <style>), quarantined verbatim -- CSS is residue, not content, per this package's own scope (ExaDev/documents.js#801: "the schema is content, not styling"). Undefined when the head carries none. Threaded up to src/read.ts, which lands it on the owning ContentSection's own `source` field; src/xhtml/write.ts re-emits it verbatim into the written <head> for a same-format (EPUB-to-EPUB) round trip -- the restorable-fidelity tier this family's every codec already documents for its own residue channel.
  readonly source: SourceResidue | undefined;
}

// The one place a document's own <head> style declarations are found and quarantined -- see ReadXhtmlBodyResult's own note on why CSS rides residue rather than being interpreted.
function readStyleResidue(
  html: XmlElement,
  context: XhtmlReadContext,
): SourceResidue | undefined {
  const head = findChildElement(html.children, "head");
  if (head === undefined) {
    return undefined;
  }
  const styleElements = head.children.filter(
    (node): node is XmlElement =>
      node.type === "element" &&
      (node.tag === "style" ||
        (node.tag === "link" && attrValue(node, "rel") === "stylesheet")),
  );
  if (styleElements.length === 0) {
    return undefined;
  }
  context.sink({
    code: EpubDiagnosticCodes.STYLE_RESIDUE,
    severity: "info",
    message:
      "the document's own <head> style declarations (CSS) are quarantined as residue rather than interpreted; the schema is content, not styling",
    href: context.sourceHref,
  });
  return { format: "epub", xml: buildXml(styleElements) };
}

// The top-level entry: parses one XHTML content document's full text and maps its <body> to ContentBlock[], plus any <head> style declarations quarantined as residue. Throws nothing of its own -- a document with no <body> at all reads as an empty block list, since a spine itemref pointing at genuinely unparsable XML is this package's own EpubParseError territory (src/read.ts), not this module's.
export function readXhtmlBody(
  xml: string,
  options: ReadXhtmlBodyOptions,
): ReadXhtmlBodyResult {
  const nodes = parseXml(xml);
  const html = rootElement(nodes);
  const body =
    html === undefined ? undefined : findChildElement(html.children, "body");
  if (body === undefined || html === undefined) {
    return { blocks: [], source: undefined };
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
  const blocks = readContainerChildren(body.children, state);
  const source = readStyleResidue(html, context);
  return { blocks, source };
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
    // A segment whose only content, once built, is whitespace produces no visible paragraph -- the common real-world case being pretty-printed XHTML's own indentation landing as a bare text node between two block-level siblings (e.g. the newline-plus-indent between <body> and its first real child), which every browser's own block-formatting context already collapses to nothing rather than an empty line. The identical rule also covers a producer's own literal `<p> </p>`/`<p></p>` (used for CSS spacing): both read as "no content here" rather than a bogus empty ContentParagraph, matching this package's own documented choice to drop an empty paragraph entirely on read.
    if (inline.runs.every((run) => run.text.trim().length === 0)) {
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
      return readTable(element, state);
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
  const text = decodeEntities(readPreText(element.children, state.context));
  const paragraph: ContentParagraph = {
    kind: "paragraph",
    runs: text.length > 0 ? [{ text, fontFamily: MONOSPACE_FONT_FAMILY }] : [],
    ...(codeLanguage !== undefined ? { codeLanguage } : {}),
  };
  return decorateParagraph(paragraph, state);
}

// A <pre>/<code> block's own content model is plain text with whitespace preserved verbatim (this never routes through buildInlineRuns's own normalizeWhitespace) -- so an <img> found anywhere inside, at any depth, cannot become a real ContentImageBlock the way one reached transparently through readContainerChildren can: there is no block list here to insert a sibling image block into, the identical structural constraint appendImageFallback (src/xhtml/inline.ts) already applies to an <img> reached while building a flat run sequence. Its alt text is spliced into the extracted text in its place, with a diagnostic naming the loss -- mirroring textContent's own recursive walk (src/xml/query.ts) but for the one element kind that walk cannot represent as text at all. <script>/<template> are skipped for the identical reason src/xhtml/inline.ts's own appendElement skips them: both are legal children of <pre> per the HTML content model, and neither's content (raw JS source, an inert DOM subtree) is ever legitimate document text -- this walk is its own separate recursion, not a call into appendElement, so it needs its own identical guard rather than inheriting one.
function readPreText(
  nodes: readonly XmlNode[],
  context: XhtmlReadContext,
): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text") {
      out += node.value;
    } else if (node.type === "element" && node.tag === "img") {
      out += readPreImageFallbackText(node, context);
    } else if (
      node.type === "element" &&
      (node.tag === "script" || node.tag === "template")
    ) {
      continue;
    } else if (node.type === "element") {
      out += readPreText(node.children, context);
    }
  }
  return out;
}

function readPreImageFallbackText(
  element: XmlElement,
  context: XhtmlReadContext,
): string {
  const src = attrValue(element, "src");
  const alt = attrValue(element, "alt");
  const label = src === undefined ? "<img>" : `<img src="${src}">`;
  context.sink({
    code: EpubDiagnosticCodes.IMAGE_PRE_UNSUPPORTED,
    severity: "warning",
    message: `${label} inside a <pre>/<code> block cannot become a real image block (a <pre>'s own content model is plain text, with no block list to insert one into); degraded to its alt text`,
    href: context.sourceHref,
  });
  return alt ?? "";
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

// The HTML Standard's own content model for <ul>/<ol> is "Zero or more li and script-supporting elements", explicitly naming <script> and <template> as legal direct children alongside <li> -- so these are ignored entirely here: no stray collection, no diagnostic, and never routed through readContainerChildren (which has no case for either tag, and readList's own document-content mapping has no use for embedded script/template content regardless). This check exists purely to suppress the LIST_CONTENT_OUTSIDE_ITEM diagnostic below for a legal child position; the actual leak this content would otherwise cause if it reached a run sequence some other way is closed universally by src/xhtml/inline.ts's own appendElement, which skips a <script>/<template> the same way regardless of where it is reached from.
function isScriptSupportingElement(tag: string): boolean {
  return tag === "script" || tag === "template";
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
  let previousItem: ListItemContext | undefined;
  let strayNodes: XmlNode[] = [];
  for (const child of element.children) {
    if (child.type === "element" && child.tag === "li") {
      blocks.push(
        ...flushListStrayContent(strayNodes, previousItem, element.tag, state),
      );
      strayNodes = [];
      const itemId = state.minter.mintItemId();
      previousItem = { numId, level, itemId };
      blocks.push(
        ...readContainerChildren(
          child.children,
          withListItem(state, previousItem),
        ),
      );
      continue;
    }
    if (child.type === "element" && isScriptSupportingElement(child.tag)) {
      continue;
    }
    if (child.type === "element" || child.type === "text") {
      strayNodes.push(child);
    }
  }
  blocks.push(
    ...flushListStrayContent(strayNodes, previousItem, element.tag, state),
  );
  return blocks;
}

// A <ul>/<ol> content model admits only <li> and script-supporting (<script>/<template>) children -- so any *other* content sitting directly inside one is not valid HTML5, most commonly a <ul>/<ol> nested as a sibling rather than wrapped in its own <li> (a shape real-world producers and converters emit even though it is not conformant), but any other stray content (a bare <img>, a run of text) shares the identical malformed shape and the identical most-likely producer intent: it was meant to continue the content of the <li> immediately before it. Recovered by feeding it through the exact same readContainerChildren dispatch that <li>'s own real children already go through, under that preceding item's own list membership -- so a stray <ul>/<ol> becomes a properly nested list one level deeper sharing the enclosing numId (readBlockElementInner's own "ul"/"ol" case calls back into this function with that membership already on the state, incrementing level exactly as genuine nesting would), a stray <img> becomes its own real image block, and stray text becomes its own paragraph, rather than each needing its own hand-rolled special case. Content sitting before the very first <li> has no preceding item to attach to and is dropped, unchanged from this function's own prior behaviour -- that narrower shape is not evidenced by any real producer and has no sensible single-item owner to recover onto. Script-supporting elements never reach this function at all -- readList filters them out before they are ever collected as stray nodes, since their content is never legitimate document text in the first place. Inter-element whitespace, by contrast, DOES reach here: the HTML Standard's own "must be ignored when establishing whether an element's contents match the content model" rule (section 3.2.5 "Content models") governs conformance-checking alone, not deletion of the character data itself, so real whitespace sitting between two stray inline siblings (the single space that keeps two words apart) is still live text that must survive a round trip. What decides whether the diagnostic-and-recovery step below fires is the actual readContainerChildren result, not a speculative text-only probe: a bare block-level construct with no text projection at all (a stray <img>, an <hr>, a table or figure whose only content is an image) still produces a real, non-empty block list and must still be recovered and reported, exactly like the common pretty-printed-list shape of a bare newline-plus-indent text node, which readContainerChildren's own segment-flush already reduces to an empty block list on its own (see its whitespace-only-segment comment) -- so nodes.length === 0 is the only cheap short-circuit worth taking before paying for the real read.
function flushListStrayContent(
  nodes: readonly XmlNode[],
  previousItem: ListItemContext | undefined,
  tag: string,
  state: BuildState,
): ContentBlock[] {
  if (nodes.length === 0 || previousItem === undefined) {
    return [];
  }
  const blocks = readContainerChildren(
    nodes,
    withListItem(state, previousItem),
  );
  if (blocks.length === 0) {
    return [];
  }
  state.context.sink({
    code: EpubDiagnosticCodes.LIST_CONTENT_OUTSIDE_ITEM,
    severity: "info",
    message: `content sits directly inside a <${tag}> rather than inside an <li> (not valid HTML5); recovered as a continuation of the preceding <li>'s own content`,
    href: state.context.sourceHref,
  });
  return blocks;
}

function startAttr(element: XmlElement): number | undefined {
  return positiveIntAttr(element, "start");
}

function readDefinitionList(
  element: XmlElement,
  state: BuildState,
): ContentBlock[] {
  return readDefinitionListEntries(element.children, state);
}

// HTML5's own <dl> content model explicitly permits wrapping one or more dt/dd pairs in a <div> (a producer idiom for a per-entry styling hook), as an alternative to dt/dd sitting directly under the <dl> -- recursing into a <div> child finds the pairs it wraps exactly as if they sat directly in the <dl>. No diagnostic: the <div> itself carries no property document-schema.js's own vocabulary can express, identical to every other <div> this package already reads transparently (readBlockElementInner's own default passthrough case), so there is no loss here for a diagnostic to name.
function readDefinitionListEntries(
  nodes: readonly XmlNode[],
  state: BuildState,
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const child of nodes) {
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
    } else if (child.tag === "div") {
      blocks.push(...readDefinitionListEntries(child.children, state));
    }
  }
  return blocks;
}

function readTable(element: XmlElement, state: BuildState): ContentBlock[] {
  const captionElement = findChildElement(element.children, "caption");
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
  const table: ContentBlock = {
    kind: "table",
    rows,
    columnWidthsPt: new Array<number>(Math.max(columnCount, 1)).fill(width),
  };
  if (captionElement === undefined) {
    return [table];
  }
  // A <caption> is a legal direct child of <table> (HTML5's own content model puts it first), but document-schema.js's ContentTable carries no field of its own for a caption distinct from an ordinary paragraph -- so, exactly like readBlockElementInner's own <figcaption> case immediately below, it is read as a plain paragraph, placed immediately before the table it describes. Any <img> the caption itself carries degrades to alt text via the same inline-recursion path (and epub/image-inline-unsupported diagnostic) a <figcaption>'s own direct-child <img> already does, rather than becoming a real image block, for the identical reason -- buildInlineRuns has already committed to a flat run sequence by the time it reaches one.
  const captionInline = buildInlineRuns(
    captionElement.children,
    {},
    state.context,
  );
  // An empty or whitespace-only <caption> carries nothing to lose -- dropped entirely, with no diagnostic, matching this package's own documented rule (enforced elsewhere by readContainerChildren's own flush guard) that an empty or whitespace-only paragraph is dropped entirely on read rather than becoming a bogus empty ContentParagraph.
  if (captionInline.runs.every((run) => run.text.trim().length === 0)) {
    return [table];
  }
  state.context.sink({
    code: EpubDiagnosticCodes.TABLE_CAPTION_UNSUPPORTED,
    severity: "info",
    message:
      "<caption> has no document-schema.js table-caption field to carry its own distinct tag; read as an ordinary paragraph immediately before the table",
    href: state.context.sourceHref,
  });
  const captionParagraph: ContentParagraph = {
    kind: "paragraph",
    runs: captionInline.runs,
    ...(captionInline.constructs.length > 0
      ? { constructs: captionInline.constructs }
      : {}),
  };
  return [decorateParagraph(captionParagraph, state), table];
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
