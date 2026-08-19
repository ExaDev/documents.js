import type { Box } from 'document-schema.js';
import type { XmlElement, XmlNode } from 'ooxml.js';
import { childrenWithTag } from 'ooxml.js';
import type { OmmlDiagnostic } from '../../omml/shared';

// Shared pieces src/ooxml/docx/embedded-objects.ts's own spliceDocxEmbeddedObjects builds on: locating every body paragraph the upstream reader itself walked, the "is this paragraph nothing but non-content markers" test's own shared tag set, and an OOXML equation's own stand-in frame. The splice itself (the combined formula-and-vector pass, replacing what used to be this module's own spliceDocxFormulas) now lives in embedded-objects.ts, alongside the vector-only paragraph test it needs too -- see that module's own top comment.

export type OmmlDiagnosticSink = (diagnostic: OmmlDiagnostic, context: { readonly sourcePath?: string }) => void;

// The containers the upstream reader's own body walk descends into, mirrored exactly. Every w:p produces exactly one top-level ContentParagraph block and nothing else produces one at all (a w:tbl becomes a table block, a w:drawing an image block, w:pageBreakBefore a pageBreak block), so the Nth w:p in the body IS the Nth paragraph-kind block across the sections that reader returned. This walk mirrors exactly the containers that reader's own readSections/readBodyBlocks descend into, so that correspondence holds for a paragraph nested in a w:sdt, a w:ins, or an mc:AlternateContent branch too.
export function collectBodyParagraphs(nodes: readonly XmlNode[], out: XmlElement[]): void {
  for (const node of nodes) {
    if (node.type !== 'element') {
      continue;
    }
    if (node.tag === 'w:p') {
      out.push(node);
    } else if (node.tag === 'w:sdt') {
      const content = childrenWithTag(node, 'w:sdtContent')[0];
      if (content !== undefined) {
        collectBodyParagraphs(content.children, out);
      }
    } else if (node.tag === 'w:ins') {
      collectBodyParagraphs(node.children, out);
    } else if (node.tag === 'mc:AlternateContent') {
      // The upstream reader prefers mc:Fallback over mc:Choice, so this must too -- picking the other branch could see a different paragraph count entirely.
      const target = childrenWithTag(node, 'mc:Fallback')[0] ?? childrenWithTag(node, 'mc:Choice')[0];
      if (target !== undefined) {
        collectBodyParagraphs(target.children, out);
      }
    }
  }
}

// The table counterpart to collectBodyParagraphs: every w:tbl produces exactly one top-level ContentTable block (and every w:tbl nested inside a table cell produces exactly one cell-level table block), so the Nth w:tbl IS the Nth table-kind block at whichever level this is called for -- section.blocks for the body, or a cell's own blocks for a nested table. Descends into the same w:sdt/w:ins/mc:AlternateContent wrappers collectBodyParagraphs does, for the same reason and with the same branch preference.
export function collectBodyTables(nodes: readonly XmlNode[], out: XmlElement[]): void {
  for (const node of nodes) {
    if (node.type !== 'element') {
      continue;
    }
    if (node.tag === 'w:tbl') {
      out.push(node);
    } else if (node.tag === 'w:sdt') {
      const content = childrenWithTag(node, 'w:sdtContent')[0];
      if (content !== undefined) {
        collectBodyTables(content.children, out);
      }
    } else if (node.tag === 'w:ins') {
      collectBodyTables(node.children, out);
    } else if (node.tag === 'mc:AlternateContent') {
      const target = childrenWithTag(node, 'mc:Fallback')[0] ?? childrenWithTag(node, 'mc:Choice')[0];
      if (target !== undefined) {
        collectBodyTables(target.children, out);
      }
    }
  }
}

// A w:p carrying nothing but its equation(s)/vector(s) and non-content markers IS the equation or drawing, not a paragraph that happens to contain one -- which is exactly what src/edit/docx/content.ts's own appendEmbeddedObject writes (a fresh, otherwise-empty w:p holding one m:oMathPara, or one carrying nothing but vector-anchor runs) and what Word writes for a display equation on its own line. Consuming it, rather than emitting an empty paragraph block alongside the recovered block, is what keeps a docx -> odt -> docx round trip from accumulating one spurious blank paragraph per embedded object per hop. A paragraph carrying real text alongside an inline equation or drawing keeps its own block and takes the recovered block immediately after it, the same position src/odf/odt/read.ts gives an inline ODF formula frame.
export const PARAGRAPH_NON_CONTENT_TAGS: ReadonlySet<string> = new Set(['w:pPr', 'w:bookmarkStart', 'w:bookmarkEnd', 'w:proofErr', 'w:commentRangeStart', 'w:commentRangeEnd']);

// OMML records no geometry for an equation at all -- no frame, no size, nothing an ODF draw:frame's own svg:width/svg:height would correspond to -- so a formula block recovered from a docx needs a stand-in frame. Only its heightPt is ever read: src/layout/engine.ts's own formulaSizePtFromFrame picks a rendered point size from it (half the frame height, a single-line formula being roughly twice its base size tall), and the rendered WIDTH comes from the laid-out formula itself, never from the frame. This states the exact inverse of that heuristic, so a recovered equation renders at the size the source document actually asked for rather than at an invented one.
const FRAME_HEIGHT_PER_SIZE_PT = 2;

// Word's own default body text size, and therefore the size an equation renders at in a document that never overrides it. Used only when the equation's own runs carry no explicit size at all -- see mathRunSizePt below.
const DEFAULT_MATH_SIZE_PT = 11;

// The first explicit run size anywhere inside the equation, in points. A math run's size lives in an ordinary WordprocessingML w:rPr/w:sz nested inside the m:r (half-points, ST_HpsMeasure), which is genuinely present whenever Word's own equation size differs from the document default -- real source data, preferred over the fallback constant above wherever the document states it.
function mathRunSizePt(equation: XmlElement): number | undefined {
  const stack: XmlNode[] = [equation];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node?.type !== 'element') {
      continue;
    }
    if (node.tag === 'w:sz') {
      const halfPoints = Number.parseFloat(node.attributes.find((attribute) => attribute.name === 'w:val')?.value ?? '');
      if (Number.isFinite(halfPoints) && halfPoints > 0) {
        return halfPoints / 2;
      }
    }
    for (let index = node.children.length - 1; index >= 0; index--) {
      const child = node.children[index];
      if (child !== undefined) {
        stack.push(child);
      }
    }
  }
  return undefined;
}

export function equationFrame(equation: XmlElement): Box {
  return { xPt: 0, yPt: 0, widthPt: 0, heightPt: (mathRunSizePt(equation) ?? DEFAULT_MATH_SIZE_PT) * FRAME_HEIGHT_PER_SIZE_PT };
}
