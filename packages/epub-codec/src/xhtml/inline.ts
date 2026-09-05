import type { ContentRun, RunConstructExtent } from "document-schema.js";
import { EpubDiagnosticCodes } from "../diagnostics";
import type { XmlElement, XmlNode } from "../xml/node";
import { attrValue } from "../xml/query";
import { decodeEntities } from "../xml/entities";
import type { InlineStyle, XhtmlReadContext } from "./context";
import { isFootnoteReferenceAnchor, sameDocumentFragment } from "./footnote";
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
    if (node.type === "text") {
      const text = normalizeWhitespace(decodeEntities(node.value));
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
    case "script":
    case "template":
      // Script-supporting elements per the HTML Standard's own content model -- their content (raw JS source for <script>, an inert DOM subtree for <template>) is never legitimate document text, so it must never reach the default appendNested passthrough below, which would otherwise recurse into it and emit it as a plain run exactly like real prose. This is the universal safety net: it fires regardless of where a <script>/<template> is reached from -- directly inside a <p>/<td>/<figcaption>, or several levels deep inside a stray <div> a container's own recovery path (e.g. src/xhtml/read.ts's readList/flushListStrayContent) has recursed into -- rather than only the single position that package's own isScriptSupportingElement check happens to guard against.
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

// appendElement is buildInlineRuns's own per-node dispatch, and buildInlineRuns is called from every container that hands its children straight to run-building with no block-splitting step of its own first: a <p>'s own inline segments between block-level siblings (via readContainerChildren), but also a heading's, a <figcaption>'s, a <dt>'s/<dd>'s, and a table cell's own children directly (src/xhtml/read.ts). Only readContainerChildren ever splits a direct-child <img> out into its own ContentImageBlock (see that module's own <p>-with-a-direct-<img> gotcha) -- everywhere else this case fires, whether the <img> sits several levels deep inside a <span>/<a> or is a direct child of one of those other containers, appendElement's recursion has already committed to producing a flat ContentRun[] with no block list to insert a sibling image block into. Rather than let the image vanish the way falling through to appendNested (which recurses into a childless <img> and yields nothing) would, this degrades it to its alt text -- the same honest degrade-with-diagnostic policy this file already applies to <sub>/<sup> and src/xhtml/read.ts's own readImage applies to an unresolved or unsupported-format image.
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

function appendNested(
  element: XmlElement,
  style: InlineStyle,
  context: XhtmlReadContext,
  runs: ContentRun[],
  constructs: RunConstructExtent[],
): void {
  const nested = buildInlineRuns(element.children, style, context);
  runs.push(...nested.runs);
  constructs.push(...nested.constructs);
}

function appendAnchor(
  element: XmlElement,
  style: InlineStyle,
  context: XhtmlReadContext,
  runs: ContentRun[],
  constructs: RunConstructExtent[],
): void {
  const footnoteName = isFootnoteReferenceAnchor(element, context.idElements);
  if (footnoteName !== undefined) {
    const startRun = runs.length;
    const nested = buildInlineRuns(element.children, style, context);
    runs.push(...nested.runs);
    constructs.push(...nested.constructs);
    constructs.push({
      descriptor: {
        kind: "anchor",
        anchorType: "footnote",
        name: footnoteName,
      },
      startRun,
      endRun: runs.length,
    });
    return;
  }

  const href = attrValue(element, "href");
  if (href === undefined || href.length === 0) {
    appendNested(element, style, context, runs, constructs);
    return;
  }
  // Every href round-trips through ContentRun.hyperlink regardless of whether it names an external URI or a same-/cross-document fragment -- a deliberate simplification over document-schema.js's own internal/external `link` construct split (see README Architecture): building the full same-document anchor-target bookkeeping a genuine internal `link` construct needs is a real feature this package does not attempt, and every href still restores byte-for-byte either way. A same-document fragment already recognised as a footnote reference above never reaches this branch.
  const nested = buildInlineRuns(element.children, style, context);
  for (const run of nested.runs) {
    runs.push({ ...run, hyperlink: href });
  }
  constructs.push(...nested.constructs);
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
