import {
  isHeadingGroupNode,
  isListGroupNode,
  isSectionConstructGroupNode,
  isTreeBlockLeaf,
  type ContentBlock,
  type ContentImageBlock,
  type ContentParagraph,
  type ContentRun,
  type ContentTable,
  type HeadingGroupNode,
  type ListGroupNode,
  type RunConstructExtent,
  type SectionChild,
  type SectionConstructGroupNode,
  type TreeBlockLeaf,
} from "document-schema.js";
import { decomposeSection } from "document-schema.js/decompose";
import { EpubDiagnosticCodes, type EpubDiagnosticSink } from "../diagnostics";
import { base64ToBytes } from "../util/base64";
import type { Attribute, XmlElement, XmlNode } from "../xml/node";
import { encodeEntities } from "../xml/entities";
import { parseListNumId } from "./list-id";
import {
  HORIZONTAL_RULE_STYLE_ID,
  MONOSPACE_FONT_FAMILY,
} from "./style-constants";

// The structural inverse of src/xhtml/read.ts: document-schema.js's ContentBlock[] back to one XHTML content document's <body>. Rather than re-deriving the flat list's own heading/list/construct nesting by hand -- exactly the grouping decompose() already implements -- this calls document-schema.js's own decomposeSection() to get the properly nested SectionChild[] (heading groups, list groups, construct groups, plain leaves) and walks THAT, which is why this module needs no numbering-stack or heading-scope bookkeeping of its own at all. A `ConstructMarkerImbalanceError` decompose throws for a section whose markers do not pair up surfaces to this module's own caller as EpubUnbalancedConstructMarkersError (src/write.ts wraps it, matching markdown-codec's identical precedent).

export interface XhtmlWriteContext {
  // Registers one image's bytes for the manifest, returning the href this document's own <img src> should use (relative to the XHTML document's own directory). Called once per ContentImageBlock encountered, in document order.
  readonly registerImage: (
    bytes: Uint8Array<ArrayBuffer>,
    format: ContentImageBlock["format"],
  ) => string;
  readonly sink: EpubDiagnosticSink;
  readonly sourceHref: string;
}

function element(
  tag: string,
  attrs: Record<string, string> = {},
  children: XmlNode[] = [],
): XmlElement {
  const attributes: Attribute[] = Object.entries(attrs).map(
    ([name, value]) => ({
      name,
      value,
    }),
  );
  return { type: "element", tag, attributes, children };
}

function text(value: string): XmlNode {
  return { type: "text", value: encodeEntities(value) };
}

// Writes one section's own blocks to the <body>'s child node list.
export function writeXhtmlBody(
  blocks: readonly ContentBlock[],
  context: XhtmlWriteContext,
): XmlElement {
  const { children } = decomposeSection({
    pageSize: { widthPt: 1, heightPt: 1 },
    margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
    blocks: [...blocks],
  });
  return element("body", {}, writeSectionChildren(children, context));
}

function writeSectionChildren(
  children: readonly SectionChild[],
  context: XhtmlWriteContext,
): XmlNode[] {
  const out: XmlNode[] = [];
  let index = 0;
  while (index < children.length) {
    const child = children[index];
    if (child === undefined) {
      break;
    }
    if (isListGroupNode(child)) {
      // Every consecutive run of sibling ListGroupNode entries at this position is one <ul>/<ol> -- decompose emits one list group per item, as flat siblings, never pre-wrapped in a container element (see document-schema.js's own decomposeSectionBlocks/openListGroup).
      let end = index;
      while (end < children.length && isListGroupNode(children[end])) {
        end += 1;
      }
      const items = children.slice(index, end) as ListGroupNode[];
      out.push(writeList(items, context));
      index = end;
      continue;
    }
    out.push(...writeSectionChild(child, context));
    index += 1;
  }
  return out;
}

function writeSectionChild(
  child: SectionChild,
  context: XhtmlWriteContext,
): XmlNode[] {
  if (isHeadingGroupNode(child)) {
    return [
      writeHeading(child, context),
      ...writeSectionChildren(child.children, context),
    ];
  }
  if (isListGroupNode(child)) {
    // Reached only for a lone list group with no sibling run (writeSectionChildren's own loop always groups runs of one or more before calling this) -- kept for exhaustiveness, never actually hit.
    return [writeList([child], context)];
  }
  if (isSectionConstructGroupNode(child)) {
    return writeSectionConstructGroup(child, context);
  }
  return writeLeafBlock(child, context);
}

function writeHeading(
  group: HeadingGroupNode,
  context: XhtmlWriteContext,
): XmlElement {
  const level = Math.min(6, Math.max(1, group.node.headingLevel));
  return element(
    `h${String(level)}`,
    {},
    writeRunsToNodes(group.node.runs, group.node.constructs, context),
  );
}

// document-schema.js's own ContentListMembership.itemId comment states its whole reason for existing: "it distinguishes 'one item, several blocks' (same itemId) from 'several items sharing this numId/level' (different itemIds)". decomposeSection's own openListGroup, though, opens a fresh ListGroupNode for every list paragraph at a given level regardless of itemId -- two sibling blocks sharing one itemId still arrive here as two separate, adjacent entries in `items`, not one entry with two blocks -- so this function is the one place in the write pipeline that can still honour the field's own documented meaning: it re-groups a run of CONSECUTIVE entries sharing the same defined itemId into one <li>, writing each entry's own anchor content and nested children in turn inside it. An itemId of `undefined` never groups with anything, including another `undefined` neighbour -- absence means "no item identity carried at all" per the same schema comment, and treating two such entries as accidentally the same item would merge genuinely distinct list items a foreign producer's document never combined.
function writeList(
  items: readonly ListGroupNode[],
  context: XhtmlWriteContext,
): XmlElement {
  const numId = items[0]?.node.list.numId;
  const info = numId === undefined ? undefined : parseListNumId(numId);
  const tag = info?.type === "ordered" ? "ol" : "ul";
  const attrs: Record<string, string> =
    info?.type === "ordered" && info.start !== undefined
      ? { start: String(info.start) }
      : {};
  const liNodes: XmlElement[] = [];
  let index = 0;
  while (index < items.length) {
    const itemId = items[index]?.node.list.itemId;
    let end = index + 1;
    if (itemId !== undefined) {
      while (end < items.length && items[end]?.node.list.itemId === itemId) {
        end += 1;
      }
    }
    const liChildren = items
      .slice(index, end)
      .flatMap((item) => [
        ...writeParagraphAsEmbeddedNodes(item.node, context),
        ...writeSectionChildren(item.children, context),
      ]);
    liNodes.push(element("li", {}, liChildren));
    index = end;
  }
  return element(tag, attrs, liNodes);
}

function writeSectionConstructGroup(
  group: SectionConstructGroupNode,
  context: XhtmlWriteContext,
): XmlNode[] {
  const descriptor = group.node;
  if (descriptor.kind === "division") {
    return [
      element("blockquote", {}, writeSectionChildren(group.children, context)),
    ];
  }
  if (descriptor.kind === "anchor" && descriptor.anchorType === "footnote") {
    return [
      element(
        "aside",
        { "epub:type": "footnote", id: descriptor.name },
        writeSectionChildren(group.children, context),
      ),
    ];
  }
  context.sink({
    code: EpubDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
    severity: "info",
    message: `a '${descriptor.kind}' construct has no XHTML spelling in this package's writer; its extent is written, the construct itself is not`,
    href: context.sourceHref,
  });
  return writeSectionChildren(group.children, context);
}

function writeLeafBlock(
  block: TreeBlockLeaf,
  context: XhtmlWriteContext,
): XmlNode[] {
  switch (block.kind) {
    case "paragraph":
      return [writeParagraph(block, context)];
    case "table":
      return [writeTable(block, context)];
    case "image":
      return [writeImage(block, context)];
    case "pageBreak":
      return [];
    case "embeddedObject":
      context.sink({
        code: EpubDiagnosticCodes.ELEMENT_UNMAPPED,
        severity: "warning",
        message:
          "an embedded object has no XHTML representation in this package's writer and was dropped",
        href: context.sourceHref,
      });
      return [];
  }
}

// A paragraph carrying document-schema.js's own preformatted flag, or codeLanguage, or (for a foreign producer's document that sets neither) exactly one monospace run whose text embeds a literal newline (an inline code span essentially never does; a <pre> block's own single run, read verbatim including its real line breaks, always might), is this package's own <pre><code> round-trip shape (src/xhtml/read.ts's readPre). The preformatted check is checked first and alone decides the common case: readPre sets it unconditionally on every paragraph it produces, so this is the one reliable signal for a paragraph this package itself read out of a <pre> -- unlike run count, which a footnote reference (or any other construct) nested inside the block changes with no bearing on whether the block is preformatted (a <pre> containing one recognised construct produces 2+ runs via readPreRuns, which a runs.length===1 check would misclassify as an ordinary paragraph, silently losing the block's own verbatim whitespace on write). Every other paragraph is an ordinary <p>/<hr>.
function isPreBlockParagraph(paragraph: ContentParagraph): boolean {
  if (paragraph.preformatted === true) {
    return true;
  }
  if (paragraph.codeLanguage !== undefined) {
    return true;
  }
  return (
    paragraph.runs.length === 1 &&
    paragraph.runs[0]?.fontFamily === MONOSPACE_FONT_FAMILY &&
    paragraph.runs[0].text.includes("\n")
  );
}

// The horizontal-rule sentinel writeParagraph and writeParagraphAsEmbeddedNodes both recognise: document-schema.js has no dedicated horizontal-rule block kind, so readBlockElementInner's own "hr" case (src/xhtml/read.ts) stands one in as an empty paragraph carrying this styleId, and both write-side dispatchers must agree on exactly the same shape or a <hr> read inside one container (a section, a list item) silently stops being one when written back from another.
function isHorizontalRuleParagraph(paragraph: ContentParagraph): boolean {
  return (
    paragraph.styleId === HORIZONTAL_RULE_STYLE_ID &&
    paragraph.runs.length === 0
  );
}

function writePreElement(
  paragraph: ContentParagraph,
  context: XhtmlWriteContext,
): XmlElement {
  const codeAttrs: Record<string, string> =
    paragraph.codeLanguage === undefined
      ? {}
      : { class: `language-${paragraph.codeLanguage}` };
  return element("pre", {}, [
    element(
      "code",
      codeAttrs,
      writePreRunsToNodes(paragraph.runs, paragraph.constructs, context),
    ),
  ]);
}

function writeParagraph(
  paragraph: ContentParagraph,
  context: XhtmlWriteContext,
): XmlElement {
  if (isHorizontalRuleParagraph(paragraph)) {
    return element("hr");
  }
  if (isPreBlockParagraph(paragraph)) {
    return writePreElement(paragraph, context);
  }
  return element(
    "p",
    {},
    writeRunsToNodes(paragraph.runs, paragraph.constructs, context),
  );
}

// The identical horizontal-rule/preformatted/ordinary-runs dispatch writeParagraph itself uses immediately above, reused by writeList to embed a paragraph's own body directly inside a container OTHER than a fresh <p> -- a list item's own anchor content. This dispatch is deliberately NOT used for a heading's own runs (writeHeading writes them directly via writeRunsToNodes): h1-h6 admit only phrasing content per the HTML Standard, and both <pre> and <hr> are flow content, so routing a heading through this dispatcher would let a foreign producer's input (e.g. a heading styled entirely in a monospace font with an embedded line break, tripping isPreBlockParagraph's own legacy heuristic) write a non-conformant <pre>/<hr> nested inside an <hN> -- a shape real EPUB validators reject. "This reader can't produce that shape" is not a safe argument for the writer, since the writer's own job is round-tripping whatever a foreign producer's document actually contains, and a heading's content model already rules the shape out unconditionally regardless of provenance. Before this existed, writeList built its own anchor content via writeRunsToNodes alone, so a <pre> or an <hr> nested directly inside an <li> -- both ordinary, real-world HTML, since <li>'s content model is flow content -- silently lost its own block shape on write despite reading back correctly as a preformatted or horizontal-rule paragraph: the reader's own list-membership decoration (decorateParagraph) applies uniformly to every paragraph shape reached inside a list item, but the writer's list path checked none of the shapes writeParagraph itself already knew how to recognise. The horizontal-rule and preformatted cases each return their own single, already-complete block element (<hr>, <pre><code>...); the ordinary case returns the paragraph's own inline run nodes with no wrapper, since the wrapper differs by call site (a fresh <p> in writeParagraph, nothing extra when embedding directly in <li>).
function writeParagraphAsEmbeddedNodes(
  paragraph: ContentParagraph,
  context: XhtmlWriteContext,
): XmlNode[] {
  if (isHorizontalRuleParagraph(paragraph)) {
    return [element("hr")];
  }
  if (isPreBlockParagraph(paragraph)) {
    return [writePreElement(paragraph, context)];
  }
  return writeRunsToNodes(paragraph.runs, paragraph.constructs, context);
}

type FootnoteExtent = RunConstructExtent & {
  descriptor: { kind: "anchor"; anchorType: "footnote"; name: string };
};

// Only the "footnote" member of document-schema.js's own AnchorTypeSchema ("bookmark" | "footnote" | "endnote" | "comment") is recognised here -- a run-level construct extent whose anchorType is anything else (a bookmark or comment range that ooxml.js's own docx reader can and does emit at run scope, e.g. runRangeMarkerExtents in src/typed/docx/constructs.ts) is filtered out below with no representation and no diagnostic at all. Tracked as ExaDev/documents.js#1025 rather than fixed here: a genuinely distinct construct-kind gap, not a bug in this function's own footnote handling.
function isFootnoteExtent(
  construct: RunConstructExtent,
): construct is FootnoteExtent {
  return (
    construct.descriptor.kind === "anchor" &&
    construct.descriptor.anchorType === "footnote"
  );
}

// Describes, for CONSTRUCT_UNREPRESENTED's own message field, what actually happens to one footnote-reference extent writeRunRangeNodes below could not emit as its own <a> element -- covering every extent its own post-walk sweep finds unemitted, whatever the reason. A point extent (startRun === endRun) goes unemitted either because it sits strictly inside another extent's own winning run range (the walk advances straight from that winning extent's own startRun to its endRun and never revisits any index in between, so the point's own boundary is simply never checked against the current index at all), or because its own startRun sits beyond this paragraph's actual run count, past every index the walk's own 0..runs.length range ever visits. Since a point anchor wraps zero runs of its own, nothing besides its own <a> link marker is missing from the output either way. A range extent (endRun > startRun) goes unemitted for any of several reasons: another extent sharing its exact startRun was tried first (a same-startRun collision), another extent's own winning range already claims part of the run sequence before this one's startRun would otherwise be reached (a crossing overlap), or its own run range is malformed -- a startRun beyond this paragraph's actual run count, or an endRun smaller than its own startRun (an inverted range, which still reaches this branch rather than the point one above, since only a strict startRun === endRun check routes an extent there). In the first two cases the run text underneath its own range is never lost: every run in it is still written, wrapped by whichever extent's range actually claims it, or written unwrapped by the ordinary per-run path wherever no extent's range reaches it. In the malformed-range cases there is no other extent actually responsible for the omission. Either way, only this specific reference's own <a> link is not emitted.
function describeUnrepresentedFootnoteExtent(extent: FootnoteExtent): string {
  if (extent.endRun === extent.startRun) {
    return `a footnote reference ('${extent.descriptor.name}') marking the boundary before run ${extent.startRun} is never reached by the write walk -- either because it sits inside another footnote reference's own winning run range, or because its own run range falls outside this paragraph's actual runs; a point anchor wraps no run text of its own, so nothing besides this reference's own <a> link is missing from the output`;
  }
  return `a footnote reference ('${extent.descriptor.name}') is never reached by the write walk and cannot be represented as its own <a> element -- either because it overlaps another footnote reference's own winning run range, or because its own run range falls outside this paragraph's actual runs; wherever an overlap is the cause, the run text underneath it is not lost, since it is still written, wrapped by whichever extent's range actually claims it, or written unwrapped past it, but this reference's own anchor link is not emitted regardless of cause`;
}

// The run-range walk shared by writeRunsToNodes and its <pre> twin writePreRunsToNodes below: both need to walk one paragraph's own runs in order, recognising wherever a footnote-reference construct extent starts and bracketing that extent's own run range in an <a epub:type="noteref">, and both differ only in HOW a run (or an extent's own range of them) becomes XML nodes -- writeRunsToNodes wraps a run in its own formatting elements and splits an embedded newline into a <br/>, while writePreRunsToNodes emits a run's text verbatim with neither -- so the extent-finding loop itself is written once here and parameterised over that one difference, rather than duplicated with the same footnote-matching logic copied into both.
//
// The walk bounds itself with `index <= runs.length`, not `<`, and treats a point anchor (document-schema.js's own RunConstructExtent: startRun === endRun, "a point anchor at the boundary before run startRun") as consuming no run at all, for two reasons that share one root cause. First, a point anchor can sit at the boundary past the last real run -- a construct-only paragraph (zero runs, one footnote reference with startRun === endRun === 0) has runs.length === 0, so an index bound of `< runs.length` would never let the loop body run even once, silently dropping the extent along with the empty anchor markup it should still produce. Second, a point anchor sitting strictly inside the run sequence marks a boundary, not a range: renderExtentRange over its own empty rangeRuns correctly emits an empty <a>, but the run actually sitting at that same index is a separate run the anchor does not wrap and must still be rendered in its own right -- treating the point extent as "consuming" that index (as if it were an ordinary non-empty extent advancing past its own endRun) would silently delete that run's text instead of merely failing to wrap it.
//
// EVERY extent whose own startRun equals the current index is collected, not just the first found -- document-schema.js's own RunConstructExtentSchema comment states extents are "data, not brackets" and "two entries may cross freely", so more than one footnote reference legitimately sharing a startRun is real, representable input (two point-anchor references back-to-back with nothing between them; a construct-only paragraph that reads two footnote markers in immediate succession) and must not depend on which one a `.find()` happened to see first. Every point anchor collected here (startRun === endRun) is emitted as its own empty <a>, in the order the input's own constructs array carries them, since a point anchor wraps zero runs and therefore never conflicts with a sibling point anchor at the same boundary. A non-point range extent is different: it claims a contiguous run of `runs` for its own <a>, so at most one of them can actually advance the walk from this index -- the first one in the input's own array order is written normally (matching this loop's pre-existing single-extent behaviour when there is no collision at all).
//
// That "at most one wins" rule creates two distinct ways for a range extent to go unrepresented, only one of which this loop can actually see: a same-startRun collision is visible right here, at the index where both extents start, since extentsHere legitimately holds more than one range extent and only the first becomes primaryRange; a crossing overlap (a second extent's own startRun falls strictly INSIDE the first extent's already-claimed range, e.g. one spanning runs 0-2 and another spanning runs 1-3) is invisible to this loop, because a winning range extent advances `index` straight from its own startRun to its own endRun -- skipping every index in between entirely -- so the second extent's own startRun is never compared against `index` at all, and the same is true of a point anchor whose own startRun happens to fall in that skipped interior. Reporting only the collision this loop can see (as an earlier version of this function did, inline, the moment extentsHere held more than one range extent) left the crossing/nested case silently unrepresented with no diagnostic at all -- the identical silent-drop class this function exists to close, just one input shape further. So rather than reporting inline, the walk instead records every extent it actually emits in `emittedExtents`, and a single sweep after the walk completes reports CONSTRUCT_UNREPRESENTED (via describeUnrepresentedFootnoteExtent above) for every extent in the candidate set the walk never emitted -- the same mechanism covering both the same-startRun collision and the crossing/nested case, since both leave an extent absent from `emittedExtents` regardless of which reason caused it.
function writeRunRangeNodes(
  runs: readonly ContentRun[],
  constructs: readonly RunConstructExtent[] | undefined,
  renderRun: (run: ContentRun) => XmlNode[],
  renderExtentRange: (rangeRuns: readonly ContentRun[]) => XmlNode[],
  context: XhtmlWriteContext,
): XmlNode[] {
  const footnoteExtents = (constructs ?? []).filter(isFootnoteExtent);
  const emittedExtents = new Set<FootnoteExtent>();
  const out: XmlNode[] = [];
  let index = 0;
  while (index <= runs.length) {
    const extentsHere = footnoteExtents.filter((e) => e.startRun === index);
    for (const point of extentsHere.filter((e) => e.endRun === e.startRun)) {
      emittedExtents.add(point);
      out.push(
        element(
          "a",
          { "epub:type": "noteref", href: `#${point.descriptor.name}` },
          renderExtentRange([]),
        ),
      );
    }
    const [primaryRange] = extentsHere.filter((e) => e.endRun > e.startRun);
    if (primaryRange !== undefined) {
      emittedExtents.add(primaryRange);
      const rangeRuns = runs.slice(primaryRange.startRun, primaryRange.endRun);
      out.push(
        element(
          "a",
          { "epub:type": "noteref", href: `#${primaryRange.descriptor.name}` },
          renderExtentRange(rangeRuns),
        ),
      );
      index = primaryRange.endRun;
      continue;
    }
    const run = runs[index];
    if (run !== undefined) {
      out.push(...renderRun(run));
    }
    index += 1;
  }
  for (const extent of footnoteExtents) {
    if (emittedExtents.has(extent)) continue;
    context.sink({
      code: EpubDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
      severity: "info",
      message: describeUnrepresentedFootnoteExtent(extent),
      href: context.sourceHref,
    });
  }
  return out;
}

function writeRunsToNodes(
  runs: readonly ContentRun[],
  constructs: readonly RunConstructExtent[] | undefined,
  context: XhtmlWriteContext,
): XmlNode[] {
  return writeRunRangeNodes(
    runs,
    constructs,
    writeRunNodes,
    (rangeRuns) => rangeRuns.flatMap((run) => writeRunNodes(run)),
    context,
  );
}

// The <pre> twin of writeRunsToNodes immediately above, sharing its extent-finding walk (writeRunRangeNodes) but never its per-run rendering: a <pre>'s content model preserves whitespace verbatim (mirroring src/xhtml/read.ts's readPre/readPreRuns, which never route through buildInlineRuns' own whitespace normalisation either), so a run's embedded newline must survive as a literal newline character, not the <br/> element writeRunNodes emits for one -- readPreText/readPreRuns have no <br> handling of their own (a <br> element has no children, so recursing into it yields nothing), so a newline written that way would silently vanish on the next read rather than round-tripping. Each run's own text is instead emitted as one plain text node, verbatim, exactly as readPre's own readPreFlatRuns/readPreRuns already assume a <pre>'s text content is: no per-run formatting wrapper either (<pre>'s content model has no rich formatting to preserve structurally beyond the block's own single monospace font, already carried by the enclosing <code>).
function writePreRunsToNodes(
  runs: readonly ContentRun[],
  constructs: readonly RunConstructExtent[] | undefined,
  context: XhtmlWriteContext,
): XmlNode[] {
  return writeRunRangeNodes(
    runs,
    constructs,
    (run) => (run.text.length > 0 ? [text(run.text)] : []),
    (rangeRuns) => [text(rangeRuns.map((run) => run.text).join(""))],
    context,
  );
}

// One run's own text, split on embedded newlines into <br/>-separated segments (the inverse of src/xhtml/inline.ts's own <br> -> "\n" run), wrapped in the formatting elements its own fields name -- innermost the text/br sequence, then <code> (fontFamily===MONOSPACE_FONT_FAMILY), <strong>, <em>, <u>, <s>, and finally <a href> for an external/internal hyperlink. This fixed wrapping order does not attempt to reproduce a source document's own original tag nesting (<strong><em> vs <em><strong> both read identically), only its semantic formatting -- exactly the "restorable, not byte-identical" tier this family's every codec already documents for markup order.
function writeRunNodes(run: ContentRun): XmlNode[] {
  const segments = run.text.split("\n");
  let nodes: XmlNode[] = [];
  segments.forEach((segment, i) => {
    if (i > 0) {
      nodes.push(element("br"));
    }
    if (segment.length > 0) {
      nodes.push(text(segment));
    }
  });
  if (nodes.length === 0) {
    nodes = [text("")];
  }
  if (run.fontFamily === MONOSPACE_FONT_FAMILY) {
    nodes = [element("code", {}, nodes)];
  }
  if (run.bold === true) {
    nodes = [element("strong", {}, nodes)];
  }
  if (run.italic === true) {
    nodes = [element("em", {}, nodes)];
  }
  if (run.underline === true) {
    nodes = [element("u", {}, nodes)];
  }
  if (run.strike === true) {
    nodes = [element("s", {}, nodes)];
  }
  if (run.hyperlink !== undefined) {
    nodes = [element("a", { href: run.hyperlink }, nodes)];
  }
  return nodes;
}

function writeTable(
  table: ContentTable,
  context: XhtmlWriteContext,
): XmlElement {
  const rows = table.rows.map((row) =>
    element(
      "tr",
      {},
      row.cells.map((cell) => {
        const attrs: Record<string, string> = {};
        if (cell.colSpan !== undefined) attrs.colspan = String(cell.colSpan);
        if (cell.rowSpan !== undefined) attrs.rowspan = String(cell.rowSpan);
        // A cell's own blocks are never decomposed (document-schema.js's own decompose treats a table as one leaf and never descends into its cells -- see package-node.ts's SheetChild/TreeLeaf commentary), so this is a raw ContentBlock[] that could in principle carry a construct-boundary marker; this package's own reader never puts one there, but a foreign producer's document might. isTreeBlockLeaf filters those out (with a diagnostic) rather than asserting the array's shape.
        for (const block of cell.blocks) {
          if (!isTreeBlockLeaf(block)) {
            context.sink({
              code: EpubDiagnosticCodes.ELEMENT_UNMAPPED,
              severity: "info",
              message:
                "a construct-boundary marker inside a table cell has no XHTML representation in this package's writer and was dropped",
              href: context.sourceHref,
            });
          }
        }
        const cellChildren = cell.blocks
          .filter(isTreeBlockLeaf)
          .flatMap((block) => writeLeafBlock(block, context));
        return element("td", attrs, cellChildren);
      }),
    ),
  );
  return element("table", {}, rows);
}

function writeImage(
  image: ContentImageBlock,
  context: XhtmlWriteContext,
): XmlElement {
  const bytes = base64ToBytes(image.base64);
  const href = context.registerImage(bytes, image.format);
  const attrs: Record<string, string> = { src: href };
  attrs.alt = image.altText ?? "";
  return element("img", attrs);
}
