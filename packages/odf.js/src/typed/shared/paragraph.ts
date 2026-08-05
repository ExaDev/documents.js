import type { ContentParagraph, ContentRun } from 'document-schema.js';
import type { XmlElement, XmlNode } from '../../model/node';
import type { Package } from '../../model/package';
import type { StyleProperties } from '../../styles/properties';
import { attrValue } from '../../xml/query';
import { decodeXmlText } from '../../xml/entities';
import { getOdfSpaceCount } from './text';
import { resolveStyle } from './cascade';

// Reads a text:p (any inline-text container ODF shapes this document sits in -- odt is a later task, but a draw:text-box's own text:p is content-model-identical) into document-schema.js's ContentParagraph/ContentRun, the read-and-write counterpart to text.ts's own decodeOdfText: where that module projects a container's children to a plain string, this module projects the SAME node shapes (text, text:s, text:tab, text:line-break, text:span) to per-run objects carrying resolved formatting, dispatching on the identical node shapes text.ts's own top-of-file note establishes -- see that module for why text:s/text:tab/text:line-break must never be treated as zero-length whitespace.
//
// A single text:span's own resolved properties (via the 'text' family cascade) are layered ON TOP of the enclosing paragraph's own resolved properties (via the 'paragraph' family cascade, which itself may carry style:text-properties as the paragraph's own default run formatting) as a base -- mirroring how ooxml.js's own pptx paragraph reader merges a paragraph-level cascade base with each run's own explicit override (see readParagraph/mergeRunProperties in ooxml.js's src/typed/pptx/read.ts). This merge is NOT something cascade.ts's own resolveStyle does for you: resolveStyle only ever resolves ONE style-name reference within ONE family's own default-style + parent-chain (ODF's genuinely two-layer cascade, per cascade.ts's own top-of-file note) -- how a SPAN's resolved properties compose with its ENCLOSING PARAGRAPH's own resolved properties is a separate, consuming-layer concern this module owns.

function collectRuns(nodes: readonly XmlNode[], baseProperties: StyleProperties, pkg: Package, out: ContentRun[], hyperlinkTarget: string | undefined = undefined): void {
  for (const node of nodes) {
    if (node.type === 'text') {
      if (node.value.length > 0) {
        pushRun(out, runFromText(decodeXmlText(node.value), baseProperties), hyperlinkTarget);
      }
      continue;
    }
    if (node.type !== 'element') {
      continue;
    }
    if (node.tag === 'text:s') {
      pushRun(out, runFromText(' '.repeat(getOdfSpaceCount(node)), baseProperties), hyperlinkTarget);
    } else if (node.tag === 'text:tab') {
      pushRun(out, runFromText('\t', baseProperties), hyperlinkTarget);
    } else if (node.tag === 'text:line-break') {
      pushRun(out, runFromText('\n', baseProperties), hyperlinkTarget);
    } else if (node.tag === 'text:span') {
      const styleName = attrValue(node, 'text:style-name');
      const spanProperties: StyleProperties = { ...baseProperties, ...resolveStyle(styleName, 'text', pkg).properties };
      collectRuns(node.children, spanProperties, pkg, out, hyperlinkTarget);
    } else if (node.tag === 'text:a') {
      // A text:a is an inline hyperlink: its xlink:href is the link target, its children (text, text:span, text:s/tab/line-break, even a nested text:a) are the link's visible content. Threading the href as hyperlinkTarget through the recursion lets a text:span inside the link still resolve its own "text"-family formatting AND carry the hyperlink on every run it emits -- mirroring ooxml.js's own docx reader, which threads the resolved w:hyperlink target through w:ins/w:fldSimple recursion and stamps { ...run, hyperlink: target } on every leaf run. A text:a with no xlink:href is malformed (ODF makes href mandatory) but its visible text still reads; an enclosing text:a's own target is inherited in that case so an inner link's text is not lost.
      const href = attrValue(node, 'xlink:href');
      collectRuns(node.children, baseProperties, pkg, out, href ?? hyperlinkTarget);
    }
    // Any other child (a bookmark, a field, change-tracking markup, an anchored draw:frame) contributes no run at all -- matching text.ts's own established zero-length treatment of the same node shapes, not a new gap introduced here.
  }
}

function pushRun(out: ContentRun[], run: ContentRun, hyperlinkTarget: string | undefined): void {
  out.push(hyperlinkTarget === undefined ? run : { ...run, hyperlink: hyperlinkTarget });
}

function runFromText(text: string, properties: StyleProperties): ContentRun {
  return {
    text,
    bold: properties.bold,
    italic: properties.italic,
    underline: properties.underline,
    strike: properties.strike,
    fontFamily: properties.fontFamily,
    sizePt: properties.sizePt,
    color: properties.color,
  };
}

// Reads one text:p element (the caller is responsible for confirming it IS a text:p before calling -- this module has no opinion on where in a document's tree that element sits). Paragraph-level fields (alignment, spacing, indents) come only from the paragraph's OWN resolved 'paragraph'-family properties, never from a span: a text:span's style-name always resolves against the 'text' family, which style.ts/registry.ts's own STYLE_FAMILIES never lets carry paragraph-level properties in practice.
export function readOdfParagraph(pElement: XmlElement, pkg: Package): ContentParagraph {
  const styleName = attrValue(pElement, 'text:style-name');
  const paragraphProperties = resolveStyle(styleName, 'paragraph', pkg).properties;

  const runs: ContentRun[] = [];
  collectRuns(pElement.children, paragraphProperties, pkg, runs);

  return {
    kind: 'paragraph',
    runs,
    styleId: styleName,
    alignment: paragraphProperties.alignment,
    spacingBeforePt: paragraphProperties.spacingBeforePt,
    spacingAfterPt: paragraphProperties.spacingAfterPt,
    lineSpacing: paragraphProperties.lineSpacing,
    indentLeftPt: paragraphProperties.indentLeftPt,
    indentFirstLinePt: paragraphProperties.indentFirstLinePt,
  };
}
