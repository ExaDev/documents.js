import type {
  ContentBlock,
  ContentListMembership,
  ContentParagraph,
  ContentRun,
  ContentTableCell,
  ContentTableRow,
  RunConstructExtent,
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
import { isTextLikeNode, type XmlElement, type XmlNode } from "../xml/node";
import { attrValue, findChildElement, rootElement } from "../xml/query";
import { decodeEntities, decodeTextLikeNode } from "../xml/entities";
import { parseXml } from "../xml/parse";
import type {
  InlineStyle,
  ResolvedAnchorTarget,
  XhtmlReadContext,
} from "./context";
import { isInertElement, reportInertElementSkip } from "./context";
import {
  isFootnoteAside,
  isFootnoteReference,
  sameDocumentFragment,
} from "./footnote";
import { buildInlineRuns, rebaseConstructs } from "./inline";
import type { InlineResult } from "./inline";
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

// Per-call build state that isn't part of the shared read-only XhtmlReadContext (image/diagnostic/id-map port), since it changes as the block walk descends -- quote depth, a flat extra indent unrelated to quote depth, the current list membership, and the running content-width used to divide a table's columns evenly. extraIndentPt is additive with quoteDepth's own contribution (see decorateParagraph) rather than a replacement for it, so a <dd> nested inside a <blockquote> keeps both its definition-body offset and its quote indent.
interface BuildState {
  readonly context: XhtmlReadContext;
  readonly minter: IdMinter;
  readonly quoteDepth: number;
  readonly extraIndentPt: number;
  readonly listItem: ListItemContext | undefined;
  readonly list: ListContext | undefined;
  readonly contentWidthPt: number;
}

function withQuote(state: BuildState): BuildState {
  return { ...state, quoteDepth: state.quoteDepth + 1 };
}

// A flat additional indent applied to every paragraph a descent produces, on top of quoteDepth's own multiplier -- <dd>'s own DEFINITION_BODY_INDENT_PT offset, threaded through exactly like withQuote threads its own increment, so it reaches every paragraph readContainerChildren builds while descending through a <dd>'s content, not only a single top-level one.
function withExtraIndent(state: BuildState, pt: number): BuildState {
  return { ...state, extraIndentPt: state.extraIndentPt + pt };
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
      indentLeftPt: state.quoteDepth * QUOTE_INDENT_PT + state.extraIndentPt,
      styleId: decorated.styleId ?? QUOTE_STYLE_ID,
    };
  } else if (state.extraIndentPt > 0) {
    decorated = { ...decorated, indentLeftPt: state.extraIndentPt };
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

// The spreadable `constructs` field for a paragraph built directly from one buildInlineRuns result -- shared by every call site that turns a flat inline result into a ContentParagraph, so a run-level construct extent (most commonly a footnote reference) collected while walking that inline content is never silently dropped just because the paragraph itself carries no other property worth spreading in. Two call sites use it directly today: the heading case, and readContainerChildren's own segment flush (ExaDev/documents.js#994's own fix). A table caption, a table cell, a <dt>/<dd>, and a <figcaption> all used to build `{ kind: "paragraph", runs: inline.runs }` directly instead -- the identical defect shape reproduced four more times rather than fixed once -- until ExaDev/documents.js#1023 routed all four through readContainerChildren instead, which carries this helper's own fix (and real block-structure recognition besides) to each of them for free.
function constructsField(
  inline: InlineResult,
): Pick<ContentParagraph, "constructs"> | Record<string, never> {
  return inline.constructs.length > 0 ? { constructs: inline.constructs } : {};
}

// Every arbitrary-descendant walk in this module (the id->element map below, containsHeading, and readXhtmlBody's own footnote-anchor prescan) shares context.ts's own isInertElement guard, since none of them route through appendElement's own dispatch and would otherwise silently index or recognise content that can never actually be read as part of the document.
function buildIdElementMap(nodes: readonly XmlNode[]): Map<string, XmlElement> {
  const map = new Map<string, XmlElement>();
  const stack: XmlNode[] = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node?.type !== "element" || isInertElement(node.tag)) {
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

// A depth-first descendant search for every element with the given tag, mirroring src/xml/query.ts's own generic elementsWithTag -- but scoped to this module's own inert-content policy above, since elementsWithTag is shared by callers elsewhere in this package (src/nav) with no reason to assume the same policy. Used only by readXhtmlBody's own anchor-target prescan: an <a> nested inside an inert element (<template>, <noscript>, ...) is never real, readable document content (it is skipped entirely wherever buildInlineRuns would otherwise reach it), so it must not be allowed to seed anchorTargets and cause some unrelated, genuinely live body element sharing its target id to be wrapped as a footnote/bookmark target it was never really referenced by.
function elementsWithTagSkippingInert(
  nodes: readonly XmlNode[],
  tag: string,
): XmlElement[] {
  const out: XmlElement[] = [];
  const stack: XmlNode[] = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node?.type !== "element" || isInertElement(node.tag)) {
      continue;
    }
    if (node.tag === tag) {
      out.push(node);
    }
    stack.push(...node.children);
  }
  return out;
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
  // Ids in THIS document a caller reading the whole spine already discovered are targeted by ANOTHER document's own href (a footnote reference or an ordinary internal link, src/xhtml/context.ts's own ResolvedAnchorTarget), keyed by fragment -- merged with this function's own local (same-document) prescan of this document's own <a> elements, which defers to an entry already present here rather than minting its own bare-fragment reading of the same id. Absent when a caller reads exactly one document in isolation (every direct call site in this package's own test suite), in which case only same-document anchor targets are ever recognised.
  readonly extraAnchorTargets?: ReadonlyMap<string, ResolvedAnchorTarget>;
  // Resolves a REFERENCE-side href this document's own local (same-document) resolution could not -- because the href's own path portion names a different document -- against the caller's whole-spine registry. Absent when a caller reads exactly one document in isolation, in which case a cross-document href is left unresolved: the existing degrade this package already had before it recognised any internal link target at all, a plain ContentRun.hyperlink carrying the href verbatim.
  readonly resolveCrossDocumentAnchorHref?: (
    href: string,
  ) => ResolvedAnchorTarget | undefined;
}

// A whole-spine pre-pass helper: parses one XHTML content document's <body> just far enough to expose its own id-bearing elements and its own <a href> elements, without walking the rest of the body into ContentBlock[] the way readXhtmlBody itself does. src/read.ts's own cross-document anchor registry (ExaDev/documents.js#963) calls this once per spine document before any document's own full body read, since a target's own eligibility (BLOCK_LEVEL_TAGS membership) has to be known before the referencing document's own read can decide whether to build an internal-link construct or degrade to a plain hyperlink.
export interface XhtmlAnchorScan {
  readonly idElements: ReadonlyMap<string, XmlElement>;
  readonly anchors: readonly XmlElement[];
}

export function scanXhtmlAnchors(xml: string): XhtmlAnchorScan {
  const nodes = parseXml(xml);
  const html = rootElement(nodes);
  const body =
    html === undefined ? undefined : findChildElement(html.children, "body");
  if (body === undefined) {
    return { idElements: new Map(), anchors: [] };
  }
  return {
    idElements: buildIdElementMap(body.children),
    anchors: elementsWithTagSkippingInert(body.children, "a").filter(
      (anchor) => attrValue(anchor, "href") !== undefined,
    ),
  };
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
  const anchorTargets = new Map<string, ResolvedAnchorTarget>(
    options.extraAnchorTargets,
  );
  for (const anchor of elementsWithTagSkippingInert(body.children, "a")) {
    // A same-document href that resolves to a real, block-level element: either a footnote/endnote reference (src/xhtml/footnote.ts's isFootnoteReference) or an ordinary internal link target (document-schema.js's own `link` construct -- see src/xhtml/inline.ts's appendAnchor). Only a BLOCK_LEVEL_TAGS member is eligible -- an id living on an inline element (a <span id> mid-sentence) never reaches src/xhtml/read.ts's own readBlockElement, which is the one place a target actually gets wrapped in its own anchor marker, so recognising it here would mint a reference to a name nothing ever anchors. A fragment already present in anchorTargets (seeded from options.extraAnchorTargets) keeps whatever the whole-spine pass already decided rather than being overwritten with a bare-fragment reading here.
    const fragment = sameDocumentFragment(attrValue(anchor, "href"));
    const target =
      fragment === undefined ? undefined : idElements.get(fragment);
    if (
      fragment === undefined ||
      target === undefined ||
      !BLOCK_LEVEL_TAGS.has(target.tag) ||
      anchorTargets.has(fragment)
    ) {
      continue;
    }
    anchorTargets.set(fragment, {
      anchorType: isFootnoteReference(anchor, target) ? "footnote" : "bookmark",
      name: fragment,
    });
  }
  const context: XhtmlReadContext = {
    resolveImage: options.resolveImage,
    sink: options.sink,
    sourceHref: options.sourceHref,
    idElements,
    anchorTargets,
    resolveAnchorHref: (href) => {
      const fragment = sameDocumentFragment(href);
      if (fragment !== undefined) {
        return anchorTargets.get(fragment);
      }
      return options.resolveCrossDocumentAnchorHref?.(href);
    },
    quoteDepth: 0,
  };
  const state: BuildState = {
    context,
    minter: createIdMinter(),
    quoteDepth: 0,
    extraIndentPt: 0,
    listItem: undefined,
    list: undefined,
    contentWidthPt: options.contentWidthPt,
  };
  const blocks = readContainerChildren(body.children, state);
  const source = readStyleResidue(html, context);
  return { blocks, source };
}

// Every container this package maps transparently (li, blockquote, aside, div/section/..., and the top-level body itself) is, per the XHTML content model, legally allowed to mix real block-level children with bare phrasing content (text and inline markup with no block wrapper) as siblings -- <li>text<ul>...</ul></li> is exactly as real as <li><p>text</p><ul>...</ul></li>, and both idioms appear in real EPUBs. A dispatcher that only recurses into element children whose own tag it recognises as a block would silently drop the phrasing case outright: any stray text node sitting among block siblings is skipped, wherever it falls. This walks the children in source order instead, accumulating a run of phrasing content into its own implicit paragraph (dropped if it produces no runs) and flushing it the moment a real block-level element is reached -- the same "anonymous block box" rule every browser's own HTML block-formatting context applies to inline content sitting beside block siblings. Every block-level dispatch point in this module (a <p>'s own children, a <li>'s, a <blockquote>'s, an <aside>'s, and every other container's default passthrough) reaches content exclusively through this one function; nothing else in the module walks a raw children array directly.
export const BLOCK_LEVEL_TAGS = new Set([
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
  // The base inline style every direct-child phrasing segment starts from -- <th>'s own implied bold, threaded no further than this function's own buildInlineRuns call. A block-level child reached via readBlockElement below (a nested <ul>, another <table>) builds its own runs through its own dispatch, which has no style-injection parameter of its own, so this base style does not reach content nested that deep -- a narrow, documented degrade for a genuinely rare shape (rich block structure inside a <th>), not a silent one.
  baseStyle: InlineStyle = {},
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  let segment: XmlNode[] = [];
  const flush = (): void => {
    if (segment.length === 0) {
      return;
    }
    const inline = buildInlineRuns(segment, baseStyle, state.context);
    segment = [];
    // A segment whose only content, once built, is whitespace produces no visible paragraph -- the common real-world case being pretty-printed XHTML's own indentation landing as a bare text node between two block-level siblings (e.g. the newline-plus-indent between <body> and its first real child), which every browser's own block-formatting context already collapses to nothing rather than an empty line. The identical rule also covers a producer's own literal `<p> </p>`/`<p></p>` (used for CSS spacing): both read as "no content here" rather than a bogus empty ContentParagraph, matching this package's own documented choice to drop an empty paragraph entirely on read. The construct check alongside it exists for the identical reason readTable's own caption guard needs one: a segment carrying only a footnote-reference anchor with empty text (`<a epub:type="noteref" href="#fn1"></a>` sitting bare between two block siblings) produces zero text runs but one real RunConstructExtent, and text-emptiness alone would drop that construct along with the whitespace it is vacuously indistinguishable from.
    if (
      inline.runs.every((run) => run.text.trim().length === 0) &&
      inline.constructs.length === 0
    ) {
      return;
    }
    const paragraph: ContentParagraph = {
      kind: "paragraph",
      runs: inline.runs,
      ...constructsField(inline),
    };
    blocks.push(decorateParagraph(paragraph, state));
  };
  for (const node of nodes) {
    if (node.type === "element" && BLOCK_LEVEL_TAGS.has(node.tag)) {
      flush();
      blocks.push(...readBlockElement(node, state));
      continue;
    }
    if (node.type === "element" || isTextLikeNode(node)) {
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

// Wraps readBlockElementInner's own result in an anchor construct pair (footnote or bookmark) when this element's own id is a recognised anchor target -- src/xhtml/read.ts's own whole-document (and, via ReadXhtmlBodyOptions.extraAnchorTargets, whole-spine, ExaDev/documents.js#963) anchor-target registry, run over every <a> once by readXhtmlBody -- the target-side half of the EPUB 2 linked-anchor idiom and of an ordinary internal link, symmetric with an EPUB 3 <aside epub:type="footnote"> (readAside below), which instead recognises itself directly rather than needing this reverse lookup. An element already handled as such an aside is excluded here to avoid double-wrapping.
function readBlockElement(
  element: XmlElement,
  state: BuildState,
): ContentBlock[] {
  const id = attrValue(element, "id");
  const blocks = readBlockElementInner(element, state);
  if (id === undefined) {
    return blocks;
  }
  const target = state.context.anchorTargets.get(id);
  if (target === undefined || isFootnoteAside(element)) {
    return blocks;
  }
  return [
    {
      kind: "constructStart",
      descriptor: {
        kind: "anchor",
        anchorType: target.anchorType,
        name: target.name,
      },
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
      ...constructsField(inline),
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
    case "figcaption":
      // <figcaption> is Flow content per the HTML Standard: a <pre>, a nested list, or more than one paragraph is real, conformant markup, not something this reader can flatten to one buildInlineRuns call without losing block shape and fusing sibling paragraphs together with no break between them (ExaDev/documents.js#1023).
      return readContainerChildren(element.children, state);
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

// A <pre>'s own inline content can carry a run-level construct (most commonly a footnote reference) exactly like any other paragraph's, but a <pre>'s own content model needs its text preserved verbatim -- so this cannot simply call buildInlineRuns (src/xhtml/inline.ts), which normalizes whitespace. containsFootnoteReference below decides which of the two walks actually builds the paragraph's runs: the common case (no footnote reference anywhere in the <pre>) takes the cheap, unchanged single-string readPreText path with no construct to lose; only a <pre> that genuinely carries one pays for readPreRuns' own run-splitting recursion.
function readPre(element: XmlElement, state: BuildState): ContentBlock {
  const codeElement = findChildElement(element.children, "code");
  const languageSource = codeElement ?? element;
  const codeLanguage = languageFromClass(attrValue(languageSource, "class"));
  const inline: InlineResult = containsFootnoteReference(
    element.children,
    state.context,
  )
    ? readPreRuns(element.children, state.context)
    : {
        runs: readPreFlatRuns(element.children, state.context),
        constructs: [],
      };
  const paragraph: ContentParagraph = {
    kind: "paragraph",
    runs: inline.runs,
    preformatted: true, // document-schema.js's own discriminating signal for "this paragraph's whitespace must survive verbatim" -- set unconditionally here (every call to readPre corresponds to a real <pre> element) rather than left for the writer to infer from run shape, which src/xhtml/write.ts's own isPreBlockParagraph cannot do reliably: a footnote reference (or any other recognised construct) nested inside a <pre> splits its content into further runs via readPreRuns above, with no bearing on whether the block is preformatted, so run count is never a safe proxy for this fact
    ...(codeLanguage !== undefined ? { codeLanguage } : {}),
    ...constructsField(inline),
  };
  return decorateParagraph(paragraph, state);
}

function readPreFlatRuns(
  nodes: readonly XmlNode[],
  context: XhtmlReadContext,
): ContentRun[] {
  const text = readPreText(nodes, context); // already decoded -- see readPreText's own comment for why decoding happens per-leaf inside it rather than once on its returned string
  return text.length > 0 ? [{ text, fontFamily: MONOSPACE_FONT_FAMILY }] : [];
}

// The <pre> twin of appendAnchor's own footnote branch (src/xhtml/inline.ts): resolves an <a> (same-document or cross-document, via context.resolveAnchorHref -- ExaDev/documents.js#963) to its footnote-reference name, or undefined for anything else (an unresolved href, or one that resolves to an ordinary bookmark target). Used by both containsFootnoteReference's own prescan and readPreRuns' own per-node dispatch below, so the two never drift on what counts as a footnote reference inside a <pre>.
function preFootnoteReferenceName(
  anchor: XmlElement,
  context: XhtmlReadContext,
): string | undefined {
  const href = attrValue(anchor, "href");
  if (href === undefined) {
    return undefined;
  }
  const target = context.resolveAnchorHref(href);
  return target?.anchorType === "footnote" ? target.name : undefined;
}

// Whether a <pre>'s own subtree carries a recognised footnote-reference anchor anywhere, at any depth -- mirrors containsHeading's own inert-skipping descendant walk above. This is the cheap pre-check readPre uses to decide whether it can take readPreText's own flat-string shortcut (nothing structural to lose) or must pay for readPreRuns' own run-splitting recursion (needed only to bracket a footnote reference's own text as a distinct run range a RunConstructExtent can point at).
function containsFootnoteReference(
  nodes: readonly XmlNode[],
  context: XhtmlReadContext,
): boolean {
  for (const node of nodes) {
    if (node.type !== "element" || isInertElement(node.tag)) {
      continue;
    }
    if (
      node.tag === "a" &&
      preFootnoteReferenceName(node, context) !== undefined
    ) {
      return true;
    }
    if (containsFootnoteReference(node.children, context)) {
      return true;
    }
  }
  return false;
}

// The <pre> twin of buildInlineRuns (src/xhtml/inline.ts), only ever reached once containsFootnoteReference above has confirmed the subtree actually carries a footnote reference: builds the ContentRun[] plus any run-level construct extents for one <pre>'s own children, still never routing through buildInlineRuns' own normalizeWhitespace (a <pre>'s content model preserves whitespace verbatim, exactly like readPreText above). A recognised footnote-reference anchor's own text becomes its own run range so a RunConstructExtent can bracket exactly it, mirroring src/xhtml/inline.ts's own appendAnchor; every nested call's own constructs are rebased onto the outer runs array's own length at the point of the merge, since a fresh recursive call always starts counting its own runs from zero. Every other wrapping element this file does not otherwise recognise inside a <pre> (<span>, <strong>, a non-footnote <a>, ...) still degrades to its own flattened text via readPreText, exactly as it always has -- a <pre>'s own content model has no rich formatting of its own to preserve structurally; only the footnote-reference construct itself is worth the extra run boundary. Every leaf added to `buffer` below is decoded at the point it is added (a text/CDATA node via decodeTextLikeNode, an <img>'s alt text via decodeEntities, a wrapping element's own flattened text via readPreText, which is decoded internally for the identical reason) rather than once over the whole accumulated buffer on flush: CDATA content must never be run through decodeEntities at all (xml/entities.ts's own decodeTextLikeNode comment), so once any leaf in the buffer is CDATA a single trailing decode over the mixed buffer would be wrong regardless of ordering.
function readPreRuns(
  nodes: readonly XmlNode[],
  context: XhtmlReadContext,
): InlineResult {
  const runs: ContentRun[] = [];
  const constructs: RunConstructExtent[] = [];
  let buffer = "";
  const flush = (): void => {
    if (buffer.length === 0) {
      return;
    }
    runs.push({ text: buffer, fontFamily: MONOSPACE_FONT_FAMILY });
    buffer = "";
  };
  for (const node of nodes) {
    if (isTextLikeNode(node)) {
      buffer += decodeTextLikeNode(node);
      continue;
    }
    if (node.type !== "element") {
      continue;
    }
    if (isInertElement(node.tag)) {
      reportInertElementSkip(node.tag, context);
      continue;
    }
    if (node.tag === "img") {
      buffer += decodeEntities(readPreImageFallbackText(node, context));
      continue;
    }
    if (node.tag === "br") {
      buffer += "\n";
      continue;
    }
    const footnoteName =
      node.tag === "a" ? preFootnoteReferenceName(node, context) : undefined;
    if (
      footnoteName === undefined &&
      !containsFootnoteReference([node], context)
    ) {
      buffer += readPreText(node.children, context);
      continue;
    }
    flush();
    const startRun = runs.length;
    const nested = readPreRuns(node.children, context);
    runs.push(...nested.runs);
    constructs.push(...rebaseConstructs(nested.constructs, startRun));
    if (footnoteName !== undefined) {
      constructs.push({
        descriptor: {
          kind: "anchor",
          anchorType: "footnote",
          name: footnoteName,
        },
        startRun,
        endRun: runs.length,
      });
    }
  }
  flush();
  return { runs, constructs };
}

// The HTML Standard's own content model for <pre> is Phrasing content (https://html.spec.whatwg.org/multipage/grouping-content.html#the-pre-element), not plain text -- that is exactly why an <a>, <code>, <span>, <img>, or <br> nested inside a <pre> is real, conformant markup and readPreRuns/readPreText below have to handle each of them explicitly, with whitespace preserved verbatim throughout (this never routes through buildInlineRuns's own normalizeWhitespace). The real constraint an <img> runs into here is this package's own mapping, not HTML's: readPre always produces a single text-model ContentParagraph, whose ContentRun[] carries text, not blocks, so an <img> found anywhere inside, at any depth, cannot become a real ContentImageBlock the way one reached transparently through readContainerChildren can -- there is no block list here to insert a sibling image block into, the identical structural constraint appendImageFallback (src/xhtml/inline.ts) already applies to an <img> reached while building a flat run sequence. Its alt text is spliced into the extracted text in its place, with a diagnostic naming the loss -- mirroring textContent's own recursive walk (src/xml/query.ts) but for the one element kind that walk cannot represent as text at all. A <br> is mapped to a literal "\n" character rather than dropped, matching src/xhtml/inline.ts's own appendElement (which maps a <br> to its own run of "\n" for an ordinary paragraph) and the writer's own writePreRunsToNodes (src/xhtml/write.ts), which already emits an embedded newline in a <pre> run's text the identical literal way -- a <br> has no children of its own, so without this explicit case the recursive walk below would silently contribute nothing for it. An inert element (context.ts's own isInertElement) is skipped for the identical reason src/xhtml/inline.ts's own appendElement skips it: none of <script>/<template>/<style>/<noscript>'s own content is ever legitimate document text -- this walk is its own separate recursion, not a call into appendElement, so it needs its own identical guard rather than inheriting one. A text node and a CDATA section (xml/node.ts's own isTextLikeNode) are both real, extractable <pre> content and decoded the same way this function has always decoded a text node -- except CDATA never through decodeEntities, since CDATA content was never entity-encoded to begin with (xml/entities.ts's own decodeTextLikeNode comment); every leaf this function returns is already decoded by the time it reaches its own return, which is why every caller uses that string as-is rather than decoding it again.
function readPreText(
  nodes: readonly XmlNode[],
  context: XhtmlReadContext,
): string {
  let out = "";
  for (const node of nodes) {
    if (isTextLikeNode(node)) {
      out += decodeTextLikeNode(node);
    } else if (node.type === "element" && node.tag === "br") {
      out += "\n";
    } else if (node.type === "element" && node.tag === "img") {
      out += decodeEntities(readPreImageFallbackText(node, context));
    } else if (node.type === "element" && isInertElement(node.tag)) {
      reportInertElementSkip(node.tag, context);
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
    message: `${label} inside a <pre>/<code> block cannot become a real image block (this package reads a <pre> as a single text-content paragraph, so there is no block list to insert an image block into); degraded to its alt text`,
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

// Whether a blockquote's own subtree carries a heading anywhere -- a construct extent may never open or close a heading scope (document-schema.js's own decompose is the enforcement point), so a quote containing one cannot carry the division construct pair and degrades to indent-only structure instead, matching markdown-codec's identical rule for the identical schema constraint. Never descends into an inert subtree (context.ts's own isInertElement -- <script>/<template>/<style>/<noscript>): a heading sitting inside one is never real, readable document content (nothing in this module's own dispatch ever reaches it as a heading either), so it must not be allowed to suppress a real division construct the blockquote's actual, live content is otherwise entitled to.
function containsHeading(nodes: readonly XmlNode[]): boolean {
  for (const node of nodes) {
    if (node.type !== "element" || isInertElement(node.tag)) {
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
    // The HTML Standard's own content model for <ul>/<ol> is "Zero or more li and script-supporting elements", explicitly naming <script>/<template> as legal direct children alongside <li> -- so those two are ignored entirely here: no stray collection, no LIST_CONTENT_OUTSIDE_ITEM diagnostic, and never routed through readContainerChildren (which has no case for either tag, and readList's own document-content mapping has no use for embedded script/template content regardless). This uses the shared isInertElement predicate (context.ts) rather than a narrower spec-accurate script/template-only check, deliberately extending the identical exemption to <style>/<noscript> too -- neither is actually legal here per the content model above, but both are just as unrepresentable and just as safe to skip silently as the two that are, and a single shared definition is worth more than a spec-perfect distinction no diagnostic here would ever need to draw. reportInertElementSkip still fires its own dedicated diagnostic for <noscript> specifically (the one member of the set whose subtree can be genuine document content) -- this filter only suppresses the unrelated stray-content diagnostic that would otherwise misrepresent a spec-legal position as malformed.
    if (child.type === "element" && isInertElement(child.tag)) {
      reportInertElementSkip(child.tag, state.context);
      continue;
    }
    if (child.type === "element" || isTextLikeNode(child)) {
      strayNodes.push(child);
    }
  }
  blocks.push(
    ...flushListStrayContent(strayNodes, previousItem, element.tag, state),
  );
  return blocks;
}

// A <ul>/<ol> content model admits only <li> and script-supporting (<script>/<template>) children -- so any *other* content sitting directly inside one is not valid HTML5, most commonly a <ul>/<ol> nested as a sibling rather than wrapped in its own <li> (a shape real-world producers and converters emit even though it is not conformant), but any other stray content (a bare <img>, a run of text) shares the identical malformed shape and the identical most-likely producer intent. Content sitting between or after real <li> siblings is recovered by feeding it through the exact same readContainerChildren dispatch that <li>'s own real children already go through, under that preceding item's own list membership -- so a stray <ul>/<ol> becomes a properly nested list one level deeper sharing the enclosing numId (readBlockElementInner's own "ul"/"ol" case calls back into this function with that membership already on the state, incrementing level exactly as genuine nesting would), a stray <img> becomes its own real image block, and stray text becomes its own paragraph, rather than each needing its own hand-rolled special case. Content sitting BEFORE the very first <li> has no preceding item to attach to, but that is not a reason to drop it: it is recovered through the identical readContainerChildren dispatch, inheriting whatever list membership its own enclosing context already carries (none, unless the <ul>/<ol> it sits directly inside is itself nested inside another list's <li>), and lands in the returned block sequence immediately before the list's own real items -- matching a browser's rendering ORDER for this malformed shape, but not necessarily its nesting DEPTH: when the enclosing <ul>/<ol> is itself nested inside an outer list's own <li>, a browser indents this recovered content at the enclosing (inner) list's own depth, one level deeper than the outer item's own text (inside that inner list's own content box), while this recovery always emits it at that outer item's own depth instead -- a top-level sibling of the enclosing list only in the un-nested case, where the enclosing <ul>/<ol> itself carries no list membership at all. Silently dropping this case (this function's own prior behaviour) lost real content with no diagnostic at all: ExaDev/documents.js#994's own headline repro, `<ul><ul><li>b</li></ul><li>a</li></ul>`, discarded the entire nested list. A stray <script>/<template>/<style>/<noscript> sitting as a DIRECT child of the <ul>/<ol> itself never reaches this function at all -- readList's own loop above filters it out (isInertElement) before it is ever collected as a stray node in the first place. One nested a level or more deeper, though -- e.g. a <script> inside a stray <div> -- still reaches this function's own readContainerChildren call above, which resolves it to zero blocks via src/xhtml/inline.ts's own appendElement guard, the identical narrower claim flushDefinitionListStrayContent's own comment below already states for the <dl> case. Inter-element whitespace, by contrast, DOES reach here: the HTML Standard's own "must be ignored when establishing whether an element's contents match the content model" rule (section 3.2.5 "Content models") governs conformance-checking alone, not deletion of the character data itself, so real whitespace sitting between two stray inline siblings (the single space that keeps two words apart) is still live text that must survive a round trip. What decides whether the diagnostic-and-recovery step below fires is the actual readContainerChildren result, not a speculative text-only probe: a bare block-level construct with no text projection at all (a stray <img>, an <hr>, a table or figure whose only content is an image) still produces a real, non-empty block list and must still be recovered and reported, exactly like the common pretty-printed-list shape of a bare newline-plus-indent text node, which readContainerChildren's own segment-flush already reduces to an empty block list on its own (see its whitespace-only-segment comment) -- so nodes.length === 0 is the only cheap short-circuit worth taking before paying for the real read, whether or not a preceding item exists to attach the result to. The read always runs exactly once, and this function's OWN diagnostic (LIST_CONTENT_OUTSIDE_ITEM) fires only when the recovered block list is non-empty -- but an empty block list does not mean the read underneath it was a no-op: a nested list nested directly in the stray content (e.g. an empty `<ul>` with no `<li>` of its own) still mints a real numId via readList's own eager `mintNumId` call before discovering it has nothing to attach to, and any diagnostic fired by content reached deeper in the recovered subtree (most commonly `epub/image-unresolved`, when a stray `<img>` fails to resolve) still reaches the sink regardless of whether the surrounding recovery is ultimately reported or discarded. Both are harmless in practice -- a numId is an opaque per-list key with no significance beyond uniqueness (src/xhtml/list-id.ts), so a skipped integer costs nothing, and the deeper diagnostic already names its own loss on its own terms -- but they mean the minter and the sink are not, in fact, insulated from a discarded read's side effects the way LIST_CONTENT_OUTSIDE_ITEM's own absence might suggest.
function flushListStrayContent(
  nodes: readonly XmlNode[],
  previousItem: ListItemContext | undefined,
  tag: string,
  state: BuildState,
): ContentBlock[] {
  if (nodes.length === 0) {
    return [];
  }
  const blocks = readContainerChildren(
    nodes,
    previousItem === undefined ? state : withListItem(state, previousItem),
  );
  if (blocks.length === 0) {
    return [];
  }
  state.context.sink({
    code: EpubDiagnosticCodes.LIST_CONTENT_OUTSIDE_ITEM,
    severity: "info",
    message:
      previousItem === undefined
        ? `content sits directly inside a <${tag}> before its first <li> (not valid HTML5); recovered as ordinary content immediately before the list, inheriting whatever list membership its own enclosing context already carries (none, unless this <${tag}> is itself nested inside another list's <li>)`
        : `content sits directly inside a <${tag}> rather than inside an <li> (not valid HTML5); recovered as a continuation of the preceding <li>'s own content`,
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

// HTML5's own <dl> content model explicitly permits wrapping one or more dt/dd pairs in a <div> (a producer idiom for a per-entry styling hook), as an alternative to dt/dd sitting directly under the <dl> -- recursing into a <div> child finds the pairs it wraps exactly as if they sat directly in the <dl>. No diagnostic: the <div> itself carries no property document-schema.js's own vocabulary can express, identical to every other <div> this package already reads transparently (readBlockElementInner's own default passthrough case), so there is no loss here for a diagnostic to name. <div> is the only wrapper this narrower rule recognises, deliberately: it is the one shape HTML5's own <dl> content model actually names as legal, so recursing into it and reporting nothing is a statement about conformant markup, not an arbitrary choice of which tag to special-case. Anything else that is not dt/dd/div -- a stray <p>, stray text, a stray <img>, a non-conformant wrapper like <section> used in <div>'s place -- gets the same general treatment readList already applies to its own analogous whitelist (route the stray run through readContainerChildren and report a real diagnostic naming the loss), via flushDefinitionListStrayContent below, rather than being silently dropped the way this function used to drop everything outside its three named tags with zero diagnostics -- reachable one tag away from ExaDev/documents.js#994's own headline shape. A non-conformant wrapper's own dt/dd children lose their distinct term/definition treatment once routed this way (readContainerChildren has no notion of dt/dd, so they degrade to plain concatenated inline text) -- a real, documented fidelity cost, but a text-preserving one, matching the "recovered as ordinary content" tier every other stray-content gap in this file resolves to.
function readDefinitionListEntries(
  nodes: readonly XmlNode[],
  state: BuildState,
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  let strayNodes: XmlNode[] = [];
  const flushStray = (): void => {
    blocks.push(...flushDefinitionListStrayContent(strayNodes, state));
    strayNodes = [];
  };
  for (const child of nodes) {
    if (child.type === "element" && child.tag === "dt") {
      flushStray();
      // <dt> is Flow content per the HTML Standard: block-level content inside one is real, conformant markup, not something to flatten to a single inline paragraph and lose (ExaDev/documents.js#1023).
      blocks.push(...readContainerChildren(child.children, state));
      continue;
    }
    if (child.type === "element" && child.tag === "dd") {
      flushStray();
      // Same reasoning as <dt> above, plus DEFINITION_BODY_INDENT_PT threaded through withExtraIndent so every paragraph the descent produces -- not only a single top-level one -- picks up the definition-body offset.
      blocks.push(
        ...readContainerChildren(
          child.children,
          withExtraIndent(state, DEFINITION_BODY_INDENT_PT),
        ),
      );
      continue;
    }
    if (child.type === "element" && child.tag === "div") {
      flushStray();
      blocks.push(...readDefinitionListEntries(child.children, state));
      continue;
    }
    if (child.type === "element" && isInertElement(child.tag)) {
      reportInertElementSkip(child.tag, state.context);
      continue;
    }
    if (child.type === "element" || isTextLikeNode(child)) {
      strayNodes.push(child);
    }
  }
  flushStray();
  return blocks;
}

// The <dl> twin of flushListStrayContent above: content that is not dt/dd/div (nor an inert element) sitting directly inside a <dl> or one of its <div> wrappers is not valid HTML5, but silently dropping it loses real content with no diagnostic at all -- exactly the defect class ExaDev/documents.js#994 was filed about, reachable here one tag away from the shape that issue's own fix already covers. Recovered through the same readContainerChildren dispatch dt/dd's own real children go through, under the plain `state` (a <dl> entry carries no numId/level membership the way a list item does for stray content to inherit, so there is no withListItem-equivalent to apply here). Reported only when the recovery actually produces content, matching flushListStrayContent's own rule: genuine inter-element whitespace (the common pretty-printed-<dl> shape) and a stray <script>/<template>/<style>/<noscript> collected here (isInertElement's own check above already filters most of these before they are ever collected, but a nested one -- e.g. a <script> inside a stray <section> -- still reaches this function's own readContainerChildren call, which resolves it to zero blocks via src/xhtml/inline.ts's own appendElement guard) both produce an empty recovered block list and fire nothing.
function flushDefinitionListStrayContent(
  nodes: readonly XmlNode[],
  state: BuildState,
): ContentBlock[] {
  if (nodes.length === 0) {
    return [];
  }
  const blocks = readContainerChildren(nodes, state);
  if (blocks.length === 0) {
    return [];
  }
  state.context.sink({
    code: EpubDiagnosticCodes.DEFINITION_LIST_CONTENT_OUTSIDE_ENTRY,
    severity: "info",
    message:
      "content sits directly inside a <dl> (or one of its <div> wrappers) outside any dt/dd (not valid HTML5); recovered as ordinary content -- a non-conformant wrapper's own dt/dd children, if any, lose their distinct term/definition treatment and degrade to plain concatenated text",
    href: state.context.sourceHref,
  });
  return blocks;
}

// The <table> content model per HTML5 is, in order: an optional <caption>, zero or more <colgroup>, an optional <thead>, either zero or more <tbody> or one or more bare <tr>, an optional <tfoot>, optionally intermixed with script-supporting elements -- so an inert element (isInertElement) sitting directly inside the <table> carries nothing document-schema.js's own vocabulary can represent and is silently skipped exactly like a <div>'s own class/id elsewhere in this file. A <colgroup> is legal here too, but is not skipped wholesale the same way: its own conforming content (<col>, and the same script-supporting elements) carries nothing to represent either, but anything else inside one -- a stray <p>, stray text, a stray <img> -- is not valid HTML5 and shares the identical malformed shape and identical most-likely producer intent as content sitting directly inside the <table> itself, so collectColgroupStrayContent below folds it into this very same strayNodes collection rather than the wholesale skip silently discarding it. Anything else that is not tr/thead/tbody/tfoot/caption/colgroup/inert -- a stray <p>, a stray <div>, stray text -- is not valid HTML5, but was previously dropped with zero diagnostics; it is now collected into strayNodes below and recovered through the same readContainerChildren dispatch as everything else this file recovers, reported via the TABLE_CONTENT_UNRECOGNIZED diagnostic further down (there is no separate flushTableStrayContent helper -- the collection and the recovery both live inline in this function) -- the real output order is the recovered stray content FIRST, then any caption paragraph(s), then the table itself (see this function's own closing `return`), mirroring the "recovered as ordinary content, positioned relative to the block it describes" convention this file already applies to a list's own before-the-first-item stray content -- a table's own rows fold into one indivisible ContentTable block, so there is no position WITHIN the table's own structure to reinsert interleaved stray content into without misrepresenting it as more than one table. A <thead>/<tbody>/<tfoot>'s own content model is narrower still: zero or more <tr> and script-supporting elements only, per the HTML Standard -- so any OTHER content sitting directly inside one of those row groups (a stray text node, a stray <p>, a stray <img>, an entire nested list) shares the identical malformed shape and is folded into this very same strayNodes collection by collectRowGroupRows below, exactly one level of nesting deeper than the table-direct case, rather than being silently dropped the way it once was.
function readTable(element: XmlElement, state: BuildState): ContentBlock[] {
  const captionElements = element.children.filter(
    (c): c is XmlElement => c.type === "element" && c.tag === "caption",
  );
  const rows: ContentTableRow[] = [];
  let columnCount = 0;
  const strayNodes: XmlNode[] = [];
  for (const section of element.children) {
    if (section.type === "element" && section.tag === "caption") {
      continue; // every <caption>, first or duplicate, is handled in full by readTableCaption below regardless of where in source order it sits
    }
    if (section.type !== "element") {
      if (isTextLikeNode(section)) {
        strayNodes.push(section);
      }
      continue;
    }
    if (section.tag === "colgroup") {
      collectColgroupStrayContent(section, strayNodes, state.context);
      continue;
    }
    if (isInertElement(section.tag)) {
      reportInertElementSkip(section.tag, state.context);
      continue;
    }
    const rowContainers =
      section.tag === "tr"
        ? [section]
        : section.tag === "thead" ||
            section.tag === "tbody" ||
            section.tag === "tfoot"
          ? collectRowGroupRows(section, strayNodes, state.context)
          : undefined;
    if (rowContainers === undefined) {
      strayNodes.push(section);
      continue;
    }
    for (const tr of rowContainers) {
      const cells: ContentTableCell[] = [];
      let strayCellNodes: XmlNode[] = [];
      const flushStrayCell = (): void => {
        if (strayCellNodes.length === 0) {
          return;
        }
        const recovered = readContainerChildren(strayCellNodes, state);
        strayCellNodes = [];
        if (recovered.length === 0) {
          return;
        }
        state.context.sink({
          code: EpubDiagnosticCodes.TABLE_ROW_CONTENT_OUTSIDE_CELL,
          severity: "info",
          message:
            "content sits directly inside a <tr> rather than inside a <td>/<th> (not valid HTML5); recovered as its own cell in the row's own column sequence",
          href: state.context.sourceHref,
        });
        cells.push({ blocks: recovered });
      };
      for (const cellNode of tr.children) {
        if (
          cellNode.type === "element" &&
          (cellNode.tag === "td" || cellNode.tag === "th")
        ) {
          flushStrayCell();
          const isHeader = cellNode.tag === "th";
          const cellStyle = isHeader ? { bold: true } : {};
          // <td>/<th> are Flow content per the HTML Standard: a <pre>, a nested list, or more than one paragraph is real, conformant markup, not something to flatten and lose (ExaDev/documents.js#1023). An empty or whitespace-only cell produces no blocks at all here, matching readContainerChildren's own empty-segment rule elsewhere, rather than the single bogus empty paragraph a bare buildInlineRuns call used to always produce.
          const cellBlocks = readContainerChildren(
            cellNode.children,
            state,
            cellStyle,
          );
          const colSpan = positiveIntAttr(cellNode, "colspan");
          const rowSpan = positiveIntAttr(cellNode, "rowspan");
          cells.push({
            blocks: cellBlocks,
            ...(colSpan !== undefined ? { colSpan } : {}),
            ...(rowSpan !== undefined ? { rowSpan } : {}),
          });
          continue;
        }
        if (cellNode.type === "element" && isInertElement(cellNode.tag)) {
          reportInertElementSkip(cellNode.tag, state.context);
          continue;
        }
        if (cellNode.type === "element" || isTextLikeNode(cellNode)) {
          strayCellNodes.push(cellNode);
        }
      }
      flushStrayCell();
      columnCount = Math.max(columnCount, cells.length);
      rows.push({ cells });
    }
  }
  const strayBlocks =
    strayNodes.length === 0 ? [] : readContainerChildren(strayNodes, state);
  if (strayBlocks.length > 0) {
    state.context.sink({
      code: EpubDiagnosticCodes.TABLE_CONTENT_UNRECOGNIZED,
      severity: "info",
      message:
        "content sits directly inside a <table> (or one of its <thead>/<tbody>/<tfoot> row groups) outside any row, caption, or colgroup, or inside a <colgroup> itself (not valid HTML5); recovered as ordinary content immediately before the table",
      href: state.context.sourceHref,
    });
  }
  const width =
    columnCount > 0 ? state.contentWidthPt / columnCount : state.contentWidthPt;
  const table: ContentBlock = {
    kind: "table",
    rows,
    columnWidthsPt: new Array<number>(Math.max(columnCount, 1)).fill(width),
  };
  const captionBlocks = captionElements.flatMap((captionElement, index) =>
    readTableCaption(captionElement, index > 0, state),
  );
  return [...strayBlocks, ...captionBlocks, table];
}

// The <thead>/<tbody>/<tfoot> twin of readTable's own table-direct stray-content collection above: a row group's content model per the HTML Standard is "zero or more tr and script-supporting elements" only, so anything else sitting directly inside one -- stray text, a stray <p>, a stray <img>, a whole nested list -- is not valid HTML5, but shares the identical malformed shape and identical most-likely producer intent as content sitting directly inside the <table> one level up. Rather than a separate recovery path (and a separate diagnostic positioned somewhere inside the table's own row sequence, which would misrepresent it as belonging to a particular row when it does not), this feeds the caller's own shared strayNodes accumulator directly, so it is recovered and reported exactly once, in exactly the same place, via readTable's own TABLE_CONTENT_UNRECOGNIZED diagnostic and readContainerChildren call.
function collectRowGroupRows(
  section: XmlElement,
  strayNodes: XmlNode[],
  context: XhtmlReadContext,
): XmlElement[] {
  const trs: XmlElement[] = [];
  for (const child of section.children) {
    if (child.type === "element" && child.tag === "tr") {
      trs.push(child);
      continue;
    }
    if (child.type === "element" && isInertElement(child.tag)) {
      reportInertElementSkip(child.tag, context);
      continue;
    }
    if (child.type === "element" || isTextLikeNode(child)) {
      strayNodes.push(child);
    }
  }
  return trs;
}

// The <colgroup> twin of collectRowGroupRows immediately above: a <colgroup>'s own content model per the HTML Standard is "zero or more <col> and <template> elements" (nothing at all when the <colgroup> itself carries a span attribute) -- narrower than the "script-supporting elements" category (<script> and <template>) this file's other content-model comments cite, since a <colgroup> admits <template> alone, not <script>. Conforming content here carries nothing document-schema.js's own vocabulary can represent either way (a column's own width/span belongs on ContentTable.columnWidthsPt, not a per-column node), so a <col> is silently skipped here exactly like an inert element is; a stray <script>, though non-conformant in this position, is skipped by the same isInertElement guard as any other inert element, so the narrower spec model has no behavioural consequence here. Anything else -- a stray <p>, stray text, a stray <img> -- is not valid HTML5 but shares the identical malformed shape and identical most-likely producer intent as content sitting directly inside the <table> one level up, so it feeds the caller's own shared strayNodes accumulator directly, mirroring collectRowGroupRows' own reasoning: recovered and reported exactly once, via readTable's own TABLE_CONTENT_UNRECOGNIZED diagnostic and readContainerChildren call, rather than a separate recovery path that would misrepresent it as belonging to a particular column.
function collectColgroupStrayContent(
  section: XmlElement,
  strayNodes: XmlNode[],
  context: XhtmlReadContext,
): void {
  for (const child of section.children) {
    if (child.type === "element" && child.tag === "col") {
      continue;
    }
    if (child.type === "element" && isInertElement(child.tag)) {
      reportInertElementSkip(child.tag, context);
      continue;
    }
    if (child.type === "element" || isTextLikeNode(child)) {
      strayNodes.push(child);
    }
  }
}

// A <caption>'s own content, read as one or more ordinary blocks immediately before the table it describes, via readContainerChildren -- document-schema.js's ContentTable carries no field of its own for a caption distinct from ordinary content, exactly like readBlockElementInner's own <figcaption> case. <caption> is Flow content per the HTML Standard (ExaDev/documents.js#1023), so a <pre>, a nested list, more than one paragraph, or a direct-child <img> (split into its own real ContentImageBlock, the same treatment a <p>'s own direct-child <img> already gets) are all recognised rather than flattened into one undelimited inline run. `isDuplicate` fires an additional diagnostic for every caption beyond the first: HTML5 permits at most one <caption> per <table>, so a second is a producer mistake this package now recovers rather than silently discards -- readTable used to resolve its caption via findChildElement, which only ever returns the first match for a given tag, so a second <caption> was lost with no trace and no diagnostic at all.
function readTableCaption(
  captionElement: XmlElement,
  isDuplicate: boolean,
  state: BuildState,
): ContentBlock[] {
  // <caption> is Flow content per the HTML Standard: a <pre>, a nested list, or more than one paragraph is real, conformant markup (ExaDev/documents.js#1023). readContainerChildren's own empty-segment rule already drops an empty or whitespace-only caption with no construct of its own to lose, matching this function's prior dedicated check.
  const captionBlocks = readContainerChildren(captionElement.children, state);
  if (captionBlocks.length === 0) {
    return [];
  }
  if (isDuplicate) {
    state.context.sink({
      code: EpubDiagnosticCodes.TABLE_DUPLICATE_CAPTION,
      severity: "info",
      message:
        "<table> carries more than one <caption> (HTML5 permits at most one); every caption beyond the first is still read as its own ordinary paragraph immediately before the table, rather than being silently discarded",
      href: state.context.sourceHref,
    });
  }
  state.context.sink({
    code: EpubDiagnosticCodes.TABLE_CAPTION_UNSUPPORTED,
    severity: "info",
    message:
      "<caption> has no document-schema.js table-caption field to carry its own distinct tag; read as an ordinary paragraph immediately before the table",
    href: state.context.sourceHref,
  });
  return captionBlocks;
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
  const id = attrValue(element, "id");
  if (id === undefined) {
    state.context.sink({
      code: EpubDiagnosticCodes.FOOTNOTE_TARGET_UNRESOLVED,
      severity: "warning",
      message:
        "a footnote <aside> carries no id and cannot be referenced; read as ordinary content",
      href: state.context.sourceHref,
    });
    return readContainerChildren(element.children, state);
  }
  // This <aside> recognises itself as a footnote body directly, via its own epub:type, regardless of whether anything actually references it -- but the NAME it carries still has to agree with whatever the reference side committed to (state.context.anchorTargets, ExaDev/documents.js#963's cross-document-qualified name when a referrer lives in a different spine document), or a cross-document reference and this body would carry two different names for the same construct. An unreferenced footnote <aside> (anchorTargets carries no entry for its own id) falls back to the bare id, exactly as before this package recognised cross-document references at all.
  const name = state.context.anchorTargets.get(id)?.name ?? id;
  return [
    {
      kind: "constructStart",
      descriptor: { kind: "anchor", anchorType: "footnote", name },
    },
    ...readContainerChildren(element.children, state),
    { kind: "constructEnd" },
  ];
}
