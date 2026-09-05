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
      writeHeading(child),
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

function writeHeading(group: HeadingGroupNode): XmlElement {
  const level = Math.min(6, Math.max(1, group.node.headingLevel));
  return element(
    `h${String(level)}`,
    {},
    writeRunsToNodes(group.node.runs, group.node.constructs),
  );
}

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
  const liNodes = items.map((item) => {
    const paragraph = item.node;
    const anchorNodes = writeRunsToNodes(paragraph.runs, paragraph.constructs);
    const nested = writeSectionChildren(item.children, context);
    return element("li", {}, [...anchorNodes, ...nested]);
  });
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
      return [writeParagraph(block)];
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

function writeParagraph(paragraph: ContentParagraph): XmlElement {
  if (
    paragraph.styleId === HORIZONTAL_RULE_STYLE_ID &&
    paragraph.runs.length === 0
  ) {
    return element("hr");
  }
  if (isPreBlockParagraph(paragraph)) {
    const codeAttrs: Record<string, string> =
      paragraph.codeLanguage === undefined
        ? {}
        : { class: `language-${paragraph.codeLanguage}` };
    const codeNodes = writePreRunsToNodes(paragraph.runs, paragraph.constructs);
    return element("pre", {}, [element("code", codeAttrs, codeNodes)]);
  }
  return element(
    "p",
    {},
    writeRunsToNodes(paragraph.runs, paragraph.constructs),
  );
}

function isFootnoteExtent(
  construct: RunConstructExtent,
): construct is RunConstructExtent & {
  descriptor: { kind: "anchor"; anchorType: "footnote"; name: string };
} {
  return (
    construct.descriptor.kind === "anchor" &&
    construct.descriptor.anchorType === "footnote"
  );
}

// The run-range walk shared by writeRunsToNodes and its <pre> twin writePreRunsToNodes below: both need to walk one paragraph's own runs in order, recognising wherever a footnote-reference construct extent starts and bracketing that extent's own run range in an <a epub:type="noteref">, and both differ only in HOW a run (or an extent's own range of them) becomes XML nodes -- writeRunsToNodes wraps a run in its own formatting elements and splits an embedded newline into a <br/>, while writePreRunsToNodes emits a run's text verbatim with neither -- so the extent-finding loop itself is written once here and parameterised over that one difference, rather than duplicated with the same footnote-matching logic copied into both.
function writeRunRangeNodes(
  runs: readonly ContentRun[],
  constructs: readonly RunConstructExtent[] | undefined,
  renderRun: (run: ContentRun) => XmlNode[],
  renderExtentRange: (rangeRuns: readonly ContentRun[]) => XmlNode[],
): XmlNode[] {
  const footnoteExtents = (constructs ?? []).filter(isFootnoteExtent);
  const out: XmlNode[] = [];
  let index = 0;
  while (index < runs.length) {
    const extent = footnoteExtents.find((e) => e.startRun === index);
    if (extent !== undefined) {
      const rangeRuns = runs.slice(extent.startRun, extent.endRun);
      out.push(
        element(
          "a",
          { "epub:type": "noteref", href: `#${extent.descriptor.name}` },
          renderExtentRange(rangeRuns),
        ),
      );
      index = Math.max(extent.endRun, index + 1);
      continue;
    }
    const run = runs[index];
    if (run !== undefined) {
      out.push(...renderRun(run));
    }
    index += 1;
  }
  return out;
}

function writeRunsToNodes(
  runs: readonly ContentRun[],
  constructs: readonly RunConstructExtent[] | undefined,
): XmlNode[] {
  return writeRunRangeNodes(runs, constructs, writeRunNodes, (rangeRuns) =>
    rangeRuns.flatMap((run) => writeRunNodes(run)),
  );
}

// The <pre> twin of writeRunsToNodes immediately above, sharing its extent-finding walk (writeRunRangeNodes) but never its per-run rendering: a <pre>'s content model preserves whitespace verbatim (mirroring src/xhtml/read.ts's readPre/readPreRuns, which never route through buildInlineRuns' own whitespace normalisation either), so a run's embedded newline must survive as a literal newline character, not the <br/> element writeRunNodes emits for one -- readPreText/readPreRuns have no <br> handling of their own (a <br> element has no children, so recursing into it yields nothing), so a newline written that way would silently vanish on the next read rather than round-tripping. Each run's own text is instead emitted as one plain text node, verbatim, exactly as readPre's own readPreFlatRuns/readPreRuns already assume a <pre>'s text content is: no per-run formatting wrapper either (<pre>'s content model has no rich formatting to preserve structurally beyond the block's own single monospace font, already carried by the enclosing <code>).
function writePreRunsToNodes(
  runs: readonly ContentRun[],
  constructs: readonly RunConstructExtent[] | undefined,
): XmlNode[] {
  return writeRunRangeNodes(
    runs,
    constructs,
    (run) => (run.text.length > 0 ? [text(run.text)] : []),
    (rangeRuns) => [text(rangeRuns.map((run) => run.text).join(""))],
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
