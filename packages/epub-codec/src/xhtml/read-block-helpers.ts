import type { MintListNumIdOptions } from "./list-id";
import { mintListNumId } from "./list-id";
import type { XmlElement, XmlNode } from "../xml/node";
import { attrValue, findChildElement, rootElement } from "../xml/query";
import { parseXml } from "../xml/parse";
import { buildXml } from "../xml/build";
import { EpubDiagnosticCodes } from "../diagnostics";
import type { ResolvedAnchorTarget, XhtmlReadContext } from "./context";
import type { InlineResult } from "./inline";
import type {
  ContentBlock,
  ContentListMembership,
  ContentParagraph,
  SourceResidue,
  TextDirection,
} from "document-schema.js";
import { QUOTE_INDENT_PT, QUOTE_STYLE_ID } from "./style-constants";
import { isInertElement } from "./context";

// The pre-walk helpers split from read.ts: tag tables, the id minter, the build-state decorators and the inert-skipping element walker, none of which depend on the block readers themselves.

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

// EPUB 3.3 content documents are well-formed XHTML by spec (not tag-soup HTML), read through the shared fast-xml-parser stack every module in this package uses — no bespoke HTML parser anywhere. This module maps one XHTML content document's <body> to document-schema.js's ContentBlock[], the shape one ContentSection's own `blocks` field carries; src/read.ts calls this once per spine itemref and wraps the result in a section.

export interface ListContext {
  readonly numId: string;
  readonly level: number;
}

export interface ListItemContext {
  readonly numId: string;
  readonly level: number;
  readonly itemId: string;
}

export interface IdMinter {
  mintNumId: (options: MintListNumIdOptions) => string;
  mintItemId: () => string;
}

export function createIdMinter(): IdMinter {
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

// Per-call build state that isn't part of the shared read-only XhtmlReadContext (image/diagnostic/id-map port), since it changes as the block walk descends — quote depth, a flat extra indent unrelated to quote depth, the current list membership, and the running content-width used to divide a table's columns evenly. extraIndentPt is additive with quoteDepth's own contribution (see decorateParagraph) rather than a replacement for it, so a <dd> nested inside a <blockquote> keeps both its definition-body offset and its quote indent.
export interface BuildState {
  readonly context: XhtmlReadContext;
  readonly minter: IdMinter;
  readonly quoteDepth: number;
  readonly extraIndentPt: number;
  readonly listItem: ListItemContext | undefined;
  readonly list: ListContext | undefined;
  readonly contentWidthPt: number;
  // The nearest block-ancestor dir attribute's stated direction, threaded exactly like quoteDepth so every paragraph a descent produces picks it up — XHTML's dir attribute inherits, so a <div dir="rtl"> governs the paragraphs nested arbitrarily deep inside it until one of them states a dir of its own, which is what withDirection's override-or-inherit rule below reproduces.
  readonly direction: TextDirection | undefined;
}

export function withQuote(state: BuildState): BuildState {
  return { ...state, quoteDepth: state.quoteDepth + 1 };
}

// A flat additional indent applied to every paragraph a descent produces, on top of quoteDepth's own multiplier — <dd>'s own DEFINITION_BODY_INDENT_PT offset, threaded through exactly like withQuote threads its own increment, so it reaches every paragraph readContainerChildren builds while descending through a <dd>'s content, not only a single top-level one.
export function withExtraIndent(state: BuildState, pt: number): BuildState {
  return { ...state, extraIndentPt: state.extraIndentPt + pt };
}

// Threads the element's own dir attribute into the descent's BuildState, reproducing XHTML's own inheritance rule: a stated "ltr"/"rtl" overrides whatever the nearest dir-stating ancestor established, while an absent dir (and dir="auto", whose direction is resolved from the content's own first strong character at render time — a fact ContentParagraph.direction's closed ltr/rtl vocabulary has no member for) leaves the inherited value standing rather than resetting it.
export function withDirection(
  state: BuildState,
  element: XmlElement,
): BuildState {
  const dir = attrValue(element, "dir");
  if (dir === "ltr" || dir === "rtl") {
    return { ...state, direction: dir };
  }
  return state;
}

export function withListItem(
  state: BuildState,
  listItem: ListItemContext,
): BuildState {
  return {
    ...state,
    listItem,
    list: { numId: listItem.numId, level: listItem.level },
  };
}

// Applies the two cross-cutting decorations every leaf paragraph-shaped block picks up from its own enclosing context: blockquote nesting (indentLeftPt, and a Quote styleId only when the block did not already set a more specific one) and list membership — mirroring markdown-codec's own decorateParagraph exactly, the identical gap in document-schema.js's own vocabulary (there is no dedicated blockquote/list-container node; nesting is carried as a per-paragraph fact).
export function decorateParagraph(
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
  if (state.direction !== undefined) {
    decorated = { ...decorated, direction: state.direction };
  }
  return decorated;
}

// The spreadable `constructs` field for a paragraph built directly from one buildInlineRuns result — shared by every call site that turns a flat inline result into a ContentParagraph, so a run-level construct extent (most commonly a footnote reference) collected while walking that inline content is never silently dropped just because the paragraph itself carries no other property worth spreading in. Two call sites use it directly today: the heading case, and readContainerChildren's own segment flush (ExaDev/documents.js#994's own fix). A table caption, a table cell, a <dt>/<dd>, and a <figcaption> all used to build `{ kind: "paragraph", runs: inline.runs }` directly instead — the identical defect shape reproduced four more times rather than fixed once — until ExaDev/documents.js#1023 routed all four through readContainerChildren instead, which carries this helper's own fix (and real block-structure recognition besides) to each of them for free.
export function constructsField(
  inline: InlineResult,
): Pick<ContentParagraph, "constructs"> | Record<string, never> {
  return inline.constructs.length > 0 ? { constructs: inline.constructs } : {};
}

// Every arbitrary-descendant walk in this module (the id->element map below, containsHeading, and readXhtmlBody's own footnote-anchor prescan) shares context.ts's own isInertElement guard, since none of them route through appendElement's own dispatch and would otherwise silently index or recognise content that can never actually be read as part of the document.
export function buildIdElementMap(
  nodes: readonly XmlNode[],
): Map<string, XmlElement> {
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

// A depth-first descendant search for every element with the given tag, mirroring src/xml/query.ts's own generic elementsWithTag — but scoped to this module's own inert-content policy above, since elementsWithTag is shared by callers elsewhere in this package (src/nav) with no reason to assume the same policy. Used only by readXhtmlBody's own anchor-target prescan: an <a> nested inside an inert element (<template>, <noscript>, ...) is never real, readable document content (it is skipped entirely wherever buildInlineRuns would otherwise reach it), so it must not be allowed to seed anchorTargets and cause some unrelated, genuinely live body element sharing its target id to be wrapped as a footnote/bookmark target it was never really referenced by.
export function elementsWithTagSkippingInert(
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
  readonly sink: (
    diagnostic: Readonly<{
      code: string;
      severity: "info" | "warning";
      message: string;
      href?: string;
    }>,
  ) => void;
  readonly sourceHref: string;
  readonly contentWidthPt: number;
  // Ids in THIS document a caller reading the whole spine already discovered are targeted by ANOTHER document's own href (a footnote reference or an ordinary internal link, src/xhtml/context.ts's own ResolvedAnchorTarget), keyed by fragment — merged with this function's own local (same-document) prescan of this document's own <a> elements, which defers to an entry already present here rather than minting its own bare-fragment reading of the same id. Absent when a caller reads exactly one document in isolation (every direct call site in this package's own test suite), in which case only same-document anchor targets are ever recognised.
  readonly extraAnchorTargets?: ReadonlyMap<string, ResolvedAnchorTarget>;
  // Resolves a REFERENCE-side href this document's own local (same-document) resolution could not — because the href's own path portion names a different document — against the caller's whole-spine registry. Absent when a caller reads exactly one document in isolation, in which case a cross-document href is left unresolved: the existing degrade this package already had before it recognised any internal link target at all, a plain ContentRun.hyperlink carrying the href verbatim.
  readonly resolveCrossDocumentAnchorHref?: (
    href: string,
  ) => ResolvedAnchorTarget | undefined;
}

// A whole-spine pre-pass helper: parses one XHTML content document's <body> just far enough to expose its own id-bearing elements and its own <a href> elements, without walking the rest of the body into ContentBlock[] the way readXhtmlBody itself does. src/read.ts's own cross-document anchor registry (ExaDev/documents.js#963) calls this once per spine document before any document's own full body read, since a target's own eligibility (BLOCK_LEVEL_TAGS membership) has to be known before the referencing document's own read can decide whether to build an internal-link construct or degrade to a plain hyperlink.
export interface XhtmlAnchorScan {
  readonly idElements: ReadonlyMap<string, XmlElement>;
  readonly anchors: readonly XmlElement[];
}

// The anchor prescan and style-residue reader split from read.ts with the other pre-walk helpers: neither depends on the block readers.

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
  // The document's own <head> style declarations (<link rel="stylesheet">, <style>), quarantined verbatim — CSS is residue, not content, per this package's own scope (ExaDev/documents.js#801: "the schema is content, not styling"). Undefined when the head carries none. Threaded up to src/read.ts, which lands it on the owning ContentSection's own `source` field; src/xhtml/write.ts re-emits it verbatim into the written <head> for a same-format (EPUB-to-EPUB) round trip — the restorable-fidelity tier this family's every codec already documents for its own residue channel.
  readonly source: SourceResidue | undefined;
}

// The one place a document's own <head> style declarations are found and quarantined — see ReadXhtmlBodyResult's own note on why CSS rides residue rather than being interpreted.
export function readStyleResidue(
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

// The top-level entry: parses one XHTML content document's full text and maps its <body> to ContentBlock[], plus any <head> style declarations quarantined as residue. Throws nothing of its own — a document with no <body> at all reads as an empty block list, since a spine itemref pointing at genuinely unparsable XML is this package's own EpubParseError territory (src/read.ts), not this module's.

// The positive-integer attribute helper split from read.ts: both the caption and image readers use it.

export function positiveIntAttr(
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
