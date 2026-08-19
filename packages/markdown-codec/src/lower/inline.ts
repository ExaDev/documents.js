// Inline content -> ContentRun[]: emphasis/strong/strikethrough become the boolean bold/italic/strike fields every ContentRun already carries, a link/autolink becomes ContentRun.hyperlink, a code span becomes a Courier New run, and hard/soft breaks become literal '\n'/' ' appended to the surrounding run's own text (matching pdf-codec's own text-layout atomiser, which already treats '\n' as an explicit line-break token -- see src/index's own top-of-file Usage note). One run is produced per leaf inline node -- no adjacent-run merging is attempted on this side; src/emit's own writer is the one that has to worry about what two adjacent runs look like once rendered back to markdown.
//
// A TOP-LEVEL image (a direct child of the paragraph these runs belong to) is never passed to lowerInlineNodes at all -- see src/lower/lower.ts's own paragraph-splitting logic, which intercepts it before inline lowering ever runs. An image reached HERE is therefore always a NESTED one (inside emphasis/strong/strikethrough/a link's own text) and is deliberately never resolved to a real ContentImageBlock: splitting a paragraph out from the middle of an open emphasis/link span is a materially larger undertaking than this package's own scope, so a nested image degrades exactly like an unresolved top-level one -- a text run of its own alt text, hyperlinked at its own destination.

import type { ContentRun } from 'document-schema.js';
import type { MarkdownInlineNode } from '../ast/ast';
import type { MarkdownDiagnosticSink } from '../diagnostics/diagnostics';
import { MarkdownDiagnosticCodes } from '../diagnostics/diagnostics';
import { FOOTNOTE_REFERENCE_FONT_MARKER, MATH_INLINE_FONT_MARKER, MONOSPACE_FONT_FAMILY } from '../shared/style-constants';

export interface InlineLowerContext {
  readonly sink: MarkdownDiagnosticSink;
  readonly rawHtml: 'preserve' | 'drop';
}

interface RunStyle {
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly strike?: boolean;
  readonly hyperlink?: string;
}

function buildRun(text: string, style: RunStyle, fontFamily?: string): ContentRun {
  return {
    text,
    ...(style.bold === true ? { bold: true } : {}),
    ...(style.italic === true ? { italic: true } : {}),
    ...(style.strike === true ? { strike: true } : {}),
    ...(style.hyperlink !== undefined ? { hyperlink: style.hyperlink } : {}),
    ...(fontFamily !== undefined ? { fontFamily } : {}),
  };
}

function lowerNestedEmphasisLike(kind: 'italic' | 'bold' | 'strike', node: { children: readonly MarkdownInlineNode[] }, style: RunStyle, context: InlineLowerContext): ContentRun[] {
  const alreadyActive = style[kind] === true;
  if (alreadyActive) {
    context.sink({ code: MarkdownDiagnosticCodes.NESTED_EMPHASIS_FLATTENED, severity: 'info', message: `a ${kind === 'italic' ? 'emphasis' : kind === 'bold' ? 'strong emphasis' : 'strikethrough'} span is nested inside another span of the same kind; ContentRun has no nesting depth of its own, so both collapse to one flat run` });
  }
  const childStyle: RunStyle = { ...style, [kind]: true };
  return node.children.flatMap((child) => lowerInlineNode(child, childStyle, context));
}

// One MarkdownInlineNode -> zero or more ContentRun-shaped values, threading the accumulated style (bold/italic/strike/hyperlink) down through nested emphasis/strong/strikethrough/link -- CommonMark permits arbitrary nesting of all four, and ContentRun's own flat bold/italic/strike/hyperlink fields represent any COMBINATION of them correctly (an italic link inside a bold span is genuinely bold+italic+hyperlink on one run); only nesting the SAME construct inside itself loses information (see lowerNestedEmphasisLike above).
export function lowerInlineNode(node: MarkdownInlineNode, style: RunStyle, context: InlineLowerContext): ContentRun[] {
  switch (node.type) {
    case 'text':
      return node.value.length === 0 ? [] : [buildRun(node.value, style)];
    case 'entity':
      return node.value.length === 0 ? [] : [buildRun(node.value, style)];
    case 'softBreak':
      return [buildRun(' ', style)];
    case 'hardBreak':
      return [buildRun('\n', style)];
    case 'codeSpan':
      // A code span's own fontFamily is indistinguishable from a genuinely monospace run on the way back out -- see MarkdownDiagnosticCodes.CODE_SPAN_AS_MONOSPACE_RUN (src/emit/inline.ts), the write-side half of this same mapping.
      return [buildRun(node.literal, style, MONOSPACE_FONT_FAMILY)];
    case 'rawHtml':
      if (context.rawHtml === 'drop') {
        context.sink({ code: MarkdownDiagnosticCodes.RAW_HTML_DROPPED, severity: 'info', message: 'inline raw HTML was dropped per the rawHtml: "drop" option' });
        return [];
      }
      context.sink({ code: MarkdownDiagnosticCodes.RAW_HTML_PRESERVED_AS_TEXT, severity: 'info', message: 'inline raw HTML was preserved as literal text; it will not be rendered as HTML by any consumer of the resulting ContentDocument' });
      return node.literal.length === 0 ? [] : [buildRun(node.literal, style)];
    case 'mathInline':
      // Marked with MATH_INLINE_FONT_MARKER, the same opportunistic-reuse trick a code span's own Courier New marker plays -- src/emit/inline.ts's renderLeaf reconstructs the \( \) delimiters around this run's own text (rather than escaping it as ordinary punctuation) specifically because it carries this marker, not because of anything about the text's own shape (see src/ast/ast.ts's own MarkdownMathInlineNode comment for why a text-pattern-based approach was tried and reverted).
      context.sink({ code: MarkdownDiagnosticCodes.MATH_INLINE_PRESERVED_AS_TEXT, severity: 'info', message: 'inline math (\\( \\)) was preserved as literal raw LaTeX text; it is not parsed as LaTeX or converted to MathML by this package' });
      return [buildRun(node.literal, style, MATH_INLINE_FONT_MARKER)];
    case 'footnoteReference':
      // The one half of a footnote this package cannot lower to the `anchor` construct document-schema.js defines for it: a construct's extent is block-scoped, and a reference sits inside a paragraph between two runs. The run keeps the reference's own source spelling as its text (so a consumer that knows nothing about footnotes still shows `[^1]` rather than nothing) and carries FOOTNOTE_REFERENCE_FONT_MARKER so src/emit/inline.ts's renderLeaf can tell it apart from a literal `\[^1\]` an author escaped deliberately -- see that constant's own note in src/shared/style-constants.ts for the full reasoning, and the DEFINITION half in src/lower/lower.ts for the anchor construct it does produce.
      context.sink({ code: MarkdownDiagnosticCodes.FOOTNOTE_REFERENCE_PRESERVED_AS_TEXT, severity: 'info', message: `footnote reference "[^${node.label}]" is preserved as a marked text run rather than an anchor construct: a construct's extent is block-scoped, and a reference site sits between two runs inside a paragraph, which no block-level boundary marker can bracket` });
      return [buildRun(`[^${node.label}]`, style, FOOTNOTE_REFERENCE_FONT_MARKER)];
    case 'autolink': {
      const destination = node.email ? `mailto:${node.destination}` : node.destination;
      return [buildRun(node.destination, { ...style, hyperlink: destination })];
    }
    case 'link': {
      if (node.title !== undefined) {
        context.sink({ code: MarkdownDiagnosticCodes.LINK_TITLE_DROPPED, severity: 'info', message: `link title "${node.title}" has no ContentRun equivalent and was dropped` });
      }
      const childStyle: RunStyle = { ...style, hyperlink: node.destination };
      const runs = node.children.flatMap((child) => lowerInlineNode(child, childStyle, context));
      // A link with no visible text at all ("[](/url)") produces no child runs to carry the hyperlink on -- ContentRun is the only place `hyperlink` can live, so an empty-text link still needs one run (empty text, the hyperlink set) or the link itself silently disappears rather than degrading.
      return runs.length > 0 ? runs : [buildRun('', childStyle)];
    }
    case 'image':
      if (node.title !== undefined) {
        context.sink({ code: MarkdownDiagnosticCodes.LINK_TITLE_DROPPED, severity: 'info', message: `image title "${node.title}" has no ContentRun equivalent and was dropped` });
      }
      return [buildRun(node.alt, { ...style, hyperlink: node.destination })];
    case 'emphasis':
      return lowerNestedEmphasisLike('italic', node, style, context);
    case 'strong':
      return lowerNestedEmphasisLike('bold', node, style, context);
    case 'strikethrough':
      return lowerNestedEmphasisLike('strike', node, style, context);
  }
}

export function lowerInlineNodes(nodes: readonly MarkdownInlineNode[], context: InlineLowerContext): ContentRun[] {
  return nodes.flatMap((node) => lowerInlineNode(node, {}, context));
}

// A code block's literal content -> a single monospace run -- shared by the fenced- and indented-code-block lowering in src/lower/lower.ts, kept here since it is genuinely inline-run construction, just for a whole block's worth of text at once rather than a parsed inline tree.
export function lowerCodeBlockRun(literal: string): ContentRun {
  return { text: literal, fontFamily: MONOSPACE_FONT_FAMILY };
}
