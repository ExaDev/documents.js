import type { ContentRun, RunConstructExtent } from "document-schema.js";
import { EpubDiagnosticCodes } from "../diagnostics";
import { isTextLikeNode, type XmlElement, type XmlNode } from "../xml/node";
import { attrValue } from "../xml/query";
import { decodeEntities, decodeTextLikeNode } from "../xml/entities";
import type { InlineStyle, XhtmlReadContext } from "./context";
import { isInertElement, reportInertElementSkip } from "./context";
import { sameDocumentFragment } from "./footnote";
import { MONOSPACE_FONT_FAMILY } from "./style-constants";

export interface InlineResult {
  readonly runs: ContentRun[];
  // Run-level construct extents (footnote/endnote reference points) collected while walking this inline content, to be spliced onto the ENCLOSING paragraph's own `constructs` field by the caller (document-schema.js's RunConstructExtent lives on ContentParagraph, never on the run itself).
  readonly constructs: RunConstructExtent[];
}

// Collapses any run of ASCII whitespace (space/tab/CR/LF) to a single space -- a deliberately simple per-text-node normalisation, not the full HTML5 cross-node whitespace-collapsing algorithm, matching this package's own corpus-tolerance scope (see README): real-world pretty-printed XHTML indentation inside a paragraph reads sensibly, and a producer that never pretty-prints is untouched either way. Never applied inside <pre> (src/xhtml/read.ts reads that content verbatim instead).
function normalizeWhitespace(text: string): string {
  return text.replace(/[ \t\r\n]+/gu, " ");
}

function mergeStyle(
  outer: InlineStyle,
  inner: Partial<InlineStyle>,
): InlineStyle {
  return { ...outer, ...inner };
}

function styledRun(
  text: string,
  style: InlineStyle,
  hyperlink?: string,
): ContentRun {
  const run: ContentRun = { text };
  if (style.bold === true) run.bold = true;
  if (style.italic === true) run.italic = true;
  if (style.underline === true) run.underline = true;
  if (style.strike === true) run.strike = true;
  if (style.fontFamily !== undefined) run.fontFamily = style.fontFamily;
  if (hyperlink !== undefined) run.hyperlink = hyperlink;
  return run;
}

// Builds the ContentRun[] (plus any run-level footnote/endnote construct extents) for one inline block's own children -- the text and inline-formatting content of a <p>/<h1-6>/<li>/<td>/<dt>/<dd>, walked recursively so nested emphasis (<strong><em>...</em></strong>) composes rather than only the innermost tag winning.
export function buildInlineRuns(
  nodes: readonly XmlNode[],
  style: InlineStyle,
  context: XhtmlReadContext,
): InlineResult {
  const runs: ContentRun[] = [];
  const constructs: RunConstructExtent[] = [];

  for (const node of nodes) {
    if (isTextLikeNode(node)) {
      // A text node and a CDATA section (xml/node.ts's own isTextLikeNode) are both real, extractable inline content -- a producer reaches for CDATA only when its own literal text would otherwise need escaping, never as a distinct kind of content -- decoded identically to how a text node has always been decoded here, except CDATA never through decodeEntities (xml/entities.ts's own decodeTextLikeNode comment: CDATA content was never entity-encoded to begin with).
      const text = normalizeWhitespace(decodeTextLikeNode(node));
      if (text.length > 0) {
        runs.push(styledRun(text, style));
      }
      continue;
    }
    if (node.type !== "element") {
      continue;
    }
    appendElement(node, style, context, runs, constructs);
  }

  return { runs, constructs };
}

function appendElement(
  element: XmlElement,
  style: InlineStyle,
  context: XhtmlReadContext,
  runs: ContentRun[],
  constructs: RunConstructExtent[],
): void {
  if (isInertElement(element.tag)) {
    // Never legitimate document text -- see context.ts's own isInertElement for why <script>/<template>/<style>/<noscript> all share this treatment. This is the universal safety net: it fires regardless of where one of these is reached from -- directly inside a <p>/<td>/<figcaption>, or several levels deep inside a stray <div> a container's own recovery path (e.g. src/xhtml/read.ts's readList/flushListStrayContent) has recursed into -- rather than only the single position a narrower, call-site-specific check would guard against.
    reportInertElementSkip(element.tag, context);
    return;
  }
  switch (element.tag) {
    case "strong":
    case "b":
      appendNested(
        element,
        mergeStyle(style, { bold: true }),
        context,
        runs,
        constructs,
      );
      return;
    case "em":
    case "i":
      appendNested(
        element,
        mergeStyle(style, { italic: true }),
        context,
        runs,
        constructs,
      );
      return;
    case "u":
      appendNested(
        element,
        mergeStyle(style, { underline: true }),
        context,
        runs,
        constructs,
      );
      return;
    case "s":
    case "strike":
    case "del":
      appendNested(
        element,
        mergeStyle(style, { strike: true }),
        context,
        runs,
        constructs,
      );
      return;
    case "code":
    case "kbd":
    case "samp":
      appendNested(
        element,
        mergeStyle(style, { fontFamily: MONOSPACE_FONT_FAMILY }),
        context,
        runs,
        constructs,
      );
      return;
    case "sub":
    case "sup": {
      // document-schema.js's ContentRun carries no subscript/superscript field at all -- a genuine, family-wide schema gap (no sibling codec has ever needed one; docx's own w:vertAlign has no reader anywhere in this workspace either), not something specific to this package. The text survives; the vertical-position styling does not.
      context.sink({
        code: EpubDiagnosticCodes.ELEMENT_UNMAPPED,
        severity: "info",
        message: `<${element.tag}> has no document-schema.js run-level field to carry its vertical position; the text is kept, the styling is not`,
        href: context.sourceHref,
      });
      appendNested(element, style, context, runs, constructs);
      return;
    }
    case "br":
      runs.push(styledRun("\n", style));
      return;
    case "a": {
      appendAnchor(element, style, context, runs, constructs);
      return;
    }
    case "img": {
      appendImageFallback(element, style, context, runs);
      return;
    }
    case "span":
    default:
      appendNested(element, style, context, runs, constructs);
  }
}

// appendElement is buildInlineRuns's own per-node dispatch, and buildInlineRuns is called from every container that hands its children straight to run-building with no block-splitting step of its own first: a heading's own children directly, and every readContainerChildren-routed container's own inline segments between block-level siblings (a <p>'s, a <figcaption>'s, a <dt>'s/<dd>'s, a table cell's, a <caption>'s -- all via src/xhtml/read.ts, ExaDev/documents.js#1023 having moved the latter four off a bare buildInlineRuns call). Only readContainerChildren ever splits a direct-child <img> out into its own ContentImageBlock (see that module's own <p>-with-a-direct-<img> gotcha) -- everywhere else this case fires, an <img> sitting several levels deep inside a <span>/<a> (nested inside any container, readContainerChildren-routed or not), appendElement's recursion has already committed to producing a flat ContentRun[] with no block list to insert a sibling image block into. Rather than let the image vanish the way falling through to appendNested (which recurses into a childless <img> and yields nothing) would, this degrades it to its alt text -- the same honest degrade-with-diagnostic policy this file already applies to <sub>/<sup> and src/xhtml/read.ts's own readImage applies to an unresolved or unsupported-format image.
function appendImageFallback(
  element: XmlElement,
  style: InlineStyle,
  context: XhtmlReadContext,
  runs: ContentRun[],
): void {
  const src = attrValue(element, "src");
  const alt = attrValue(element, "alt");
  const label = src === undefined ? "<img>" : `<img src="${src}">`;
  context.sink({
    code: EpubDiagnosticCodes.IMAGE_INLINE_UNSUPPORTED,
    severity: "warning",
    message: `${label} is reached while building a flat run sequence with no block list left to insert a separate image block into; degraded to its alt text`,
    href: context.sourceHref,
  });
  if (alt !== undefined && alt.length > 0) {
    runs.push(styledRun(decodeEntities(alt), style));
  }
}

// A nested buildInlineRuns (or readPreRuns) call always starts counting its own runs from zero, so its constructs' startRun/endRun are relative to ITS OWN runs array, not the outer one they are about to be spliced into -- shifting each by however many runs the outer array already held before the splice is what src/xhtml/read.ts's own readPreRuns already does inline; exported so appendNested and both appendAnchor branches below can share the identical fix rather than each reimplementing it (ExaDev/documents.js#1038).
export function rebaseConstructs(
  constructs: readonly RunConstructExtent[],
  offset: number,
): RunConstructExtent[] {
  return constructs.map((construct) => ({
    ...construct,
    startRun: construct.startRun + offset,
    endRun: construct.endRun + offset,
  }));
}

function appendNested(
  element: XmlElement,
  style: InlineStyle,
  context: XhtmlReadContext,
  runs: ContentRun[],
  constructs: RunConstructExtent[],
): void {
  const offset = runs.length;
  const nested = buildInlineRuns(element.children, style, context);
  runs.push(...nested.runs);
  constructs.push(...rebaseConstructs(nested.constructs, offset));
}

function appendAnchor(
  element: XmlElement,
  style: InlineStyle,
  context: XhtmlReadContext,
  runs: ContentRun[],
  constructs: RunConstructExtent[],
): void {
  const href = attrValue(element, "href");
  // A same-/cross-document href resolving to a real, block-level element anywhere in the spine (ExaDev/documents.js#963): a footnote/endnote reference, or an ordinary internal link target (document-schema.js's own `link` construct, README Architecture) otherwise -- rather than the plain ContentRun.hyperlink degrade below. context.resolveAnchorHref (src/xhtml/read.ts's own whole-document, and src/read.ts's own whole-spine, prescan) is the single place same-document vs. cross-document resolution, footnote-vs-bookmark classification, and eligibility (BLOCK_LEVEL_TAGS membership) are all decided; this call site only builds the run-level construct extent once it already has a target to build one with.
  const target =
    href === undefined ? undefined : context.resolveAnchorHref(href);
  if (target !== undefined) {
    const startRun = runs.length;
    const nested = buildInlineRuns(element.children, style, context);
    runs.push(...nested.runs);
    constructs.push(...rebaseConstructs(nested.constructs, startRun));
    constructs.push({
      descriptor:
        target.anchorType === "footnote"
          ? { kind: "anchor", anchorType: "footnote", name: target.name }
          : {
              kind: "link",
              target: { kind: "internal", anchor: target.name },
            },
      startRun,
      endRun: runs.length,
    });
    return;
  }

  if (href === undefined || href.length === 0) {
    appendNested(element, style, context, runs, constructs);
    return;
  }
  // Every href this package cannot resolve to a real, addressable in-package element -- an external URI, or an internal-looking href naming no element this package's own read pass ever wraps in an anchor marker -- rides ContentRun.hyperlink verbatim; every href still restores byte-for-byte either way. A same-/cross-document fragment already recognised as a footnote reference or an ordinary internal link target above never reaches this branch.
  const offset = runs.length;
  const nested = buildInlineRuns(element.children, style, context);
  for (const run of nested.runs) {
    runs.push({ ...run, hyperlink: href });
  }
  constructs.push(...rebaseConstructs(nested.constructs, offset));
  if (
    sameDocumentFragment(href) === undefined &&
    !/^[a-z][a-z0-9+.-]*:/iu.test(href)
  ) {
    context.sink({
      code: EpubDiagnosticCodes.LINK_TARGET_EXTERNAL_ONLY,
      severity: "info",
      message: `href "${href}" carries no URI scheme and is not a same-document fragment; it is stored verbatim on ContentRun.hyperlink without resolution against the package's own manifest`,
      href: context.sourceHref,
    });
  }
}
