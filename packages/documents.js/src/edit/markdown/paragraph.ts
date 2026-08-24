import type {
  ContentBlock,
  ContentListMembership,
  ContentParagraph as ContentParagraphNode,
} from "document-schema.js";
import {
  headingStyleId,
  parseHeadingStyleId,
  QUOTE_INDENT_PT,
} from "markdown-codec";
import type { RunInit } from "./run";
import { buildRun, MarkdownRun } from "./run";

export interface ParagraphInit {
  readonly text?: string;
  readonly styleId?: string;
}

// A live view over a ContentParagraph object living inside a body/table-cell's own blocks array -- see odt's paragraph.ts (OdtParagraph) for the same live-view rationale, adapted for a format with no XmlElement tree: this holds the plain ContentParagraph object directly, exactly as MarkdownRun holds a ContentRun (see run.ts's own top-of-file note on why that stays live).
//
// alignment is deliberately not exposed at all: markdown-codec's own dist/emit/emit.js (renderParagraphBody/renderParagraph) never reads ContentParagraph.alignment for a body paragraph -- only a GFM table's own per-column delimiter row derives from a header cell's alignment (see table.ts), which is a different code path entirely. spacingBeforePt/spacingAfterPt/lineSpacing/indentFirstLinePt are omitted for the same reason: none of them are read anywhere in markdown-codec's own lower/emit modules. headingLevel and quoteDepth below are convenience views over styleId/indentLeftPt, the two ContentParagraph fields markdown-codec's emit path actually keys its own paragraph-kind detection on.
export class MarkdownParagraph {
  private readonly container: ContentBlock[];
  private readonly node: ContentParagraphNode;
  private removed = false;

  constructor(container: ContentBlock[], node: ContentParagraphNode) {
    this.container = container;
    this.node = node;
  }

  private live(): ContentParagraphNode {
    if (this.removed) {
      throw new Error(
        "this MarkdownParagraph has been removed from its body and can no longer be used",
      );
    }
    return this.node;
  }

  get text(): string {
    return this.live()
      .runs.map((run) => run.text)
      .join("");
  }

  runs(): MarkdownRun[] {
    const node = this.live();
    return node.runs.map((run) => new MarkdownRun(node.runs, run));
  }

  appendRun(init?: RunInit): MarkdownRun {
    const node = this.live();
    const run = buildRun(init);
    node.runs.push(run);
    return new MarkdownRun(node.runs, run);
  }

  insertRunAt(index: number, init?: RunInit): MarkdownRun {
    const node = this.live();
    const run = buildRun(init);
    const insertAt = Math.min(Math.max(index, 0), node.runs.length);
    node.runs.splice(insertAt, 0, run);
    return new MarkdownRun(node.runs, run);
  }

  // A direct pointer at a raw markdown-codec style vocabulary entry (QUOTE_STYLE_ID/CODE_BLOCK_STYLE_ID/HORIZONTAL_RULE_STYLE_ID/HTML_PREFORMATTED_STYLE_ID, a heading styleId via headingStyleId(), or any caller-supplied value) -- the raw escape hatch, mirroring OdtParagraph/DocxParagraph's own styleId setter. An unrecognised value is not an error: markdown-codec's own renderParagraphBody falls back to an ordinary emitted paragraph for any styleId it does not recognise as one of its own quotable/heading/code/rule constants.
  get styleId(): string | undefined {
    return this.live().styleId;
  }

  set styleId(value: string | undefined) {
    const node = this.live();
    if (value === undefined) {
      delete node.styleId;
    } else {
      node.styleId = value;
    }
  }

  // A convenience view over styleId, built on markdown-codec's own headingStyleId/parseHeadingStyleId (dist/shared/style-constants.js): headingLevel = 1 sets styleId to "Heading1", read back via parseHeadingStyleId. Setting undefined clears styleId entirely, reverting to an ordinary paragraph -- this is a raw styleId replacement, so it overwrites whatever styleId (heading or otherwise) was previously set, exactly as the styleId setter above does.
  get headingLevel(): number | undefined {
    const styleId = this.live().styleId;
    return styleId === undefined ? undefined : parseHeadingStyleId(styleId);
  }

  set headingLevel(level: number | undefined) {
    this.styleId = level === undefined ? undefined : headingStyleId(level);
  }

  // A convenience integer view over indentLeftPt, built on markdown-codec's own QUOTE_INDENT_PT (36pt per nesting depth) -- the write-side inverse of that package's own dist/emit/emit.js quoteDepthOf, which reads indentLeftPt back the identical way (Math.max(1, Math.round(indentLeftPt / QUOTE_INDENT_PT)) for any positive indent, 0 otherwise). Setting quoteDepth on a paragraph whose styleId is not one of the five quotable styleIds markdown-codec recognises (QUOTE_STYLE_ID, CODE_BLOCK_STYLE_ID, HORIZONTAL_RULE_STYLE_ID, HTML_PREFORMATTED_STYLE_ID, or any Heading1..6) is not rejected here -- it is silently dropped on save instead, exactly as markdown-codec's own PARAGRAPH_INDENT_DROPPED diagnostic reports through whatever sink the caller's own toMarkdownText/buildMarkdownText call supplies.
  get quoteDepth(): number {
    const indent = this.live().indentLeftPt;
    if (indent === undefined || indent <= 0) {
      return 0;
    }
    return Math.max(1, Math.round(indent / QUOTE_INDENT_PT));
  }

  set quoteDepth(depth: number) {
    const node = this.live();
    if (depth <= 0) {
      delete node.indentLeftPt;
    } else {
      node.indentLeftPt = depth * QUOTE_INDENT_PT;
    }
  }

  // A flat {numId, level} membership, exactly mirroring DocxParagraph.list's own shape (src/edit/docx/paragraph.ts) rather than OdtList's structurally-nested tree -- markdown's own list model is flat like docx's: every list item is an ordinary top-level paragraph carrying its own membership, not a paragraph nested inside a container element. See list.ts's MarkdownList for the numId-minting counterpart.
  get list(): ContentListMembership | undefined {
    return this.live().list;
  }

  set list(value: ContentListMembership | undefined) {
    const node = this.live();
    if (value === undefined) {
      delete node.list;
    } else {
      node.list = value;
    }
  }

  remove(): void {
    const node = this.live();
    const index = this.container.indexOf(node);
    if (index !== -1) {
      this.container.splice(index, 1);
    }
    this.removed = true;
  }
}

// Builds a fresh ContentParagraph from scratch (not a live view -- for constructing new paragraphs to append, whose properties are then read back through MarkdownParagraph once inserted into a body/cell's blocks array). Mirrors odt's paragraph.ts buildParagraph.
export function buildParagraph(init: ParagraphInit = {}): ContentParagraphNode {
  const node: ContentParagraphNode = {
    kind: "paragraph",
    runs: init.text === undefined ? [] : [buildRun({ text: init.text })],
  };
  if (init.styleId !== undefined) {
    node.styleId = init.styleId;
  }
  return node;
}
