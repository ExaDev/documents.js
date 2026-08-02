// Inline content -> ContentRun[]: emphasis/strong/strikethrough become the boolean bold/italic/strike fields every ContentRun already carries, a link/autolink becomes ContentRun.hyperlink, a code span becomes a Courier New run, and hard/soft breaks become literal '\n'/' ' appended to the surrounding run's own text (matching pdf-codec's own text-layout atomiser, which already treats '\n' as an explicit line-break token -- see src/index's own top-of-file Usage note). One run is produced per leaf inline node -- no adjacent-run merging is attempted on this side; src/emit's own writer is the one that has to worry about what two adjacent runs look like once rendered back to markdown.
//
// A TOP-LEVEL image (a direct child of the paragraph these runs belong to) is never passed to lowerInlineNodes at all -- see src/lower/lower.ts's own paragraph-splitting logic, which intercepts it before inline lowering ever runs. An image reached HERE is therefore always a NESTED one (inside emphasis/strong/strikethrough/a link's own text) and is deliberately never resolved to a real ContentImageBlock: splitting a paragraph out from the middle of an open emphasis/link span is a materially larger undertaking than this package's own scope, so a nested image degrades exactly like an unresolved top-level one -- a text run of its own alt text, hyperlinked at its own destination.

import type { ContentRun } from 'document-schema.js';
import type { MarkdownInlineNode } from '../ast/ast';
import type { MarkdownDiagnosticSink } from '../diagnostics/diagnostics';
import { MarkdownDiagnosticCodes } from '../diagnostics/diagnostics';
import { MONOSPACE_FONT_FAMILY } from '../shared/style-constants';

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
    case 'autolink': {
      const destination = node.email ? `mailto:${node.destination}` : node.destination;
      return [buildRun(node.destination, { ...style, hyperlink: destination })];
    }
    case 'link': {
      if (node.title !== undefined) {
        context.sink({ code: MarkdownDiagnosticCodes.LINK_TITLE_DROPPED, severity: 'info', message: `link title "${node.title}" has no ContentRun equivalent and was dropped` });
      }
      const childStyle: RunStyle = { ...style, hyperlink: node.destination };
      return node.children.flatMap((child) => lowerInlineNode(child, childStyle, context));
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
