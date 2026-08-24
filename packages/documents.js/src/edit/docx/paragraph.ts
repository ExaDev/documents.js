import type { Package, XmlElement, XmlNode } from 'ooxml.js';
import { attr } from 'ooxml.js';
import { addRelationship } from '../../opc/rels';
import type { ContentListMembership, ContentVector } from 'document-schema.js';
import type { MathMlNode } from '../../mathml/nodes';
import type { OmmlWriteResult } from '../../omml/write';
import { buildOfficeMathParagraph } from '../../omml/write';
import { LINE_UNITS_PER_LINE, ptToTwips, twipsToPt } from '../../model/units';
import { getOrCreateChildElement, removeAttr, removeChild, setAttr } from '../../xml/edit';
import { el } from '../../xml/fragment';
import type { ImageInit, MediaContext } from './image';
import { insertImageMedia, nextDrawingId } from './image';
import { ensureFirstChild, getAlignment, getStyleId, PPR_ORDER, setAlignment, setStyleId } from './props';
import type { RunInit } from './run';
import { buildRun, DocxRun, wordprocessingText } from './run';
import { buildAnchoredVectorDrawing } from './vector';

export interface ParagraphInit {
  readonly text?: string;
  readonly styleId?: string;
  readonly headingLevel?: number;
  readonly alignment?: 'left' | 'center' | 'right' | 'justify';
}

function directChild(parent: XmlElement, tag: string): XmlElement | undefined {
  for (const child of parent.children) {
    if (child.type === 'element' && child.tag === tag) {
      return child;
    }
  }
  return undefined;
}

// Threaded through from DocxEditor so a paragraph can add a new image without every caller having to pass the package/document context by hand -- optional because a paragraph built via a table cell (src/edit/docx/table.ts) doesn't currently carry one; insertImageAfter throws a clear error in that case rather than silently doing nothing.
export interface ImageMediaContext {
  readonly pkg: Package;
  readonly documentRoot: XmlElement;
  readonly media: MediaContext;
}

// A live view over a w:p element -- see run.ts's DocxRun for the same live-view rationale.
export class DocxParagraph {
  private readonly container: XmlNode[];
  private readonly node: XmlElement;
  private readonly imageContext: ImageMediaContext | undefined;
  private readonly pkg: Package | undefined;
  private removed = false;

  constructor(container: XmlNode[], node: XmlElement, imageContext?: ImageMediaContext, pkg?: Package) {
    this.container = container;
    this.node = node;
    this.imageContext = imageContext;
    this.pkg = pkg;
  }

  private live(): XmlElement {
    if (this.removed) {
      throw new Error('this DocxParagraph has been removed from its body and can no longer be used');
    }
    return this.node;
  }

  private pPr(create: true): XmlElement;
  private pPr(create: false): XmlElement | undefined;
  private pPr(create: boolean): XmlElement | undefined {
    const node = this.live();
    return create ? ensureFirstChild(node, 'w:pPr') : directChild(node, 'w:pPr');
  }

  get text(): string {
    return wordprocessingText(this.live());
  }

  runs(): DocxRun[] {
    const node = this.live();
    const out: DocxRun[] = [];
    for (const child of node.children) {
      if (child.type === 'element' && child.tag === 'w:r') {
        out.push(new DocxRun(node.children, child));
      }
    }
    return out;
  }

  appendRun(init?: RunInit): DocxRun {
    const node = this.live();
    const runElement = buildRun(init);
    node.children.push(runElement);
    return new DocxRun(node.children, runElement);
  }

  // A tab character inside w:t is not the same as a real tab stop advance -- WordprocessingML represents one as its own w:tab element inside a run, never as a literal tab byte in text content.
  appendTab(): void {
    const node = this.live();
    node.children.push(el('w:r', {}, [el('w:tab')]));
  }

  insertRunAt(index: number, init?: RunInit): DocxRun {
    const node = this.live();
    const runElement = buildRun(init);
    const runIndices: number[] = [];
    node.children.forEach((child, i) => {
      if (child.type === 'element' && child.tag === 'w:r') {
        runIndices.push(i);
      }
    });
    const insertAt = index < runIndices.length ? (runIndices[index] ?? node.children.length) : node.children.length;
    node.children.splice(insertAt, 0, runElement);
    return new DocxRun(node.children, runElement);
  }

  get styleId(): string | undefined {
    return getStyleId(this.pPr(false), 'w:pStyle');
  }

  set styleId(value: string | undefined) {
    if (value === undefined) {
      const pPr = this.pPr(false);
      const existing = pPr === undefined ? undefined : directChild(pPr, 'w:pStyle');
      if (existing !== undefined && pPr !== undefined) {
        removeChild(pPr.children, existing);
      }
      return;
    }
    setStyleId(this.pPr(true), 'w:pStyle', value, PPR_ORDER);
  }

  get alignment(): 'left' | 'center' | 'right' | 'justify' | undefined {
    return getAlignment(this.pPr(false));
  }

  set alignment(value: 'left' | 'center' | 'right' | 'justify' | undefined) {
    if (value === undefined) {
      const pPr = this.pPr(false);
      const existing = pPr === undefined ? undefined : directChild(pPr, 'w:jc');
      if (existing !== undefined && pPr !== undefined) {
        removeChild(pPr.children, existing);
      }
      return;
    }
    setAlignment(this.pPr(true), value);
  }

  // w:spacing holds before/after/line together in one element (CT_PPrGeneral's own sequence puts it ahead of w:ind, both already in PPR_ORDER), so the three spacing setters share one get-or-create rather than each minting their own -- mirroring how the list setter shares one w:numPr for ilvl+numId. w:before/w:after are twentieths-of-a-point (pt times 20, same as every other WordprocessingML length); w:line is 240ths of a line under w:lineRule="auto", matching LINE_UNITS_PER_LINE. Inlined against this.live() (rather than routed through the literal-only pPr(true)/pPr(false) overload) so a runtime `create: boolean` is accepted.
  private spacingElement(create: boolean): XmlElement | undefined {
    const node = this.live();
    const pPr = create ? ensureFirstChild(node, 'w:pPr') : directChild(node, 'w:pPr');
    if (pPr === undefined) {
      return undefined;
    }
    return create ? getOrCreateChildElement(pPr, 'w:spacing', PPR_ORDER, () => el('w:spacing')) : directChild(pPr, 'w:spacing');
  }

  get spacingBeforePt(): number | undefined {
    const spacing = this.spacingElement(false);
    const before = spacing === undefined ? undefined : attr(spacing, 'w:before');
    return before === undefined ? undefined : twipsToPt(Number(before));
  }

  set spacingBeforePt(value: number | undefined) {
    const spacing = this.spacingElement(value !== undefined);
    if (spacing === undefined) {
      return;
    }
    if (value === undefined) {
      removeAttr(spacing, 'w:before');
      return;
    }
    setAttr(spacing, 'w:before', String(ptToTwips(value)));
  }

  get spacingAfterPt(): number | undefined {
    const spacing = this.spacingElement(false);
    const after = spacing === undefined ? undefined : attr(spacing, 'w:after');
    return after === undefined ? undefined : twipsToPt(Number(after));
  }

  set spacingAfterPt(value: number | undefined) {
    const spacing = this.spacingElement(value !== undefined);
    if (spacing === undefined) {
      return;
    }
    if (value === undefined) {
      removeAttr(spacing, 'w:after');
      return;
    }
    setAttr(spacing, 'w:after', String(ptToTwips(value)));
  }

  // lineSpacing is a line-height multiplier (1.0 = single). It is written as w:line = round(multiplier times 240) with w:lineRule="auto"; ooxml.js's own reader populates lineSpacing ONLY when w:lineRule is "auto" (or absent) -- "exact"/"atLeast" are fixed-point spacing it leaves undefined -- so writing "auto" is what makes the multiplier round-trip rather than collapsing to undefined on read-back.
  get lineSpacing(): number | undefined {
    const spacing = this.spacingElement(false);
    if (spacing === undefined) {
      return undefined;
    }
    const lineRule = attr(spacing, 'w:lineRule');
    if (lineRule === 'exact' || lineRule === 'atLeast') {
      return undefined;
    }
    const line = attr(spacing, 'w:line');
    return line === undefined ? undefined : Number(line) / LINE_UNITS_PER_LINE;
  }

  set lineSpacing(value: number | undefined) {
    const spacing = this.spacingElement(value !== undefined);
    if (spacing === undefined) {
      return;
    }
    if (value === undefined) {
      removeAttr(spacing, 'w:line');
      removeAttr(spacing, 'w:lineRule');
      return;
    }
    setAttr(spacing, 'w:line', String(Math.round(value * LINE_UNITS_PER_LINE)));
    setAttr(spacing, 'w:lineRule', 'auto');
  }

  // w:ind holds left + firstLine/hanging together (CT_PPrGeneral puts it after w:spacing, both in PPR_ORDER). indentLeftPt is w:left (twentieths of a point); indentFirstLinePt is w:firstLine for a positive first-line indent and w:hanging for a negative one, exactly the pair ooxml.js's reader reads back (firstLine if present, else negative of hanging).
  private indElement(create: boolean): XmlElement | undefined {
    const node = this.live();
    const pPr = create ? ensureFirstChild(node, 'w:pPr') : directChild(node, 'w:pPr');
    if (pPr === undefined) {
      return undefined;
    }
    return create ? getOrCreateChildElement(pPr, 'w:ind', PPR_ORDER, () => el('w:ind')) : directChild(pPr, 'w:ind');
  }

  get indentLeftPt(): number | undefined {
    const ind = this.indElement(false);
    const left = ind === undefined ? undefined : attr(ind, 'w:left');
    return left === undefined ? undefined : twipsToPt(Number(left));
  }

  set indentLeftPt(value: number | undefined) {
    const ind = this.indElement(value !== undefined);
    if (ind === undefined) {
      return;
    }
    if (value === undefined) {
      removeAttr(ind, 'w:left');
      return;
    }
    setAttr(ind, 'w:left', String(ptToTwips(value)));
  }

  get indentFirstLinePt(): number | undefined {
    const ind = this.indElement(false);
    if (ind === undefined) {
      return undefined;
    }
    const firstLine = attr(ind, 'w:firstLine');
    if (firstLine !== undefined) {
      return twipsToPt(Number(firstLine));
    }
    const hanging = attr(ind, 'w:hanging');
    return hanging === undefined ? undefined : -twipsToPt(Number(hanging));
  }

  set indentFirstLinePt(value: number | undefined) {
    const ind = this.indElement(value !== undefined);
    if (ind === undefined) {
      return;
    }
    if (value === undefined) {
      removeAttr(ind, 'w:firstLine');
      removeAttr(ind, 'w:hanging');
      return;
    }
    if (value >= 0) {
      removeAttr(ind, 'w:hanging');
      setAttr(ind, 'w:firstLine', String(ptToTwips(value)));
    } else {
      removeAttr(ind, 'w:firstLine');
      setAttr(ind, 'w:hanging', String(ptToTwips(-value)));
    }
  }

  get list(): ContentListMembership | undefined {
    const pPr = this.pPr(false);
    const numPr = pPr === undefined ? undefined : directChild(pPr, 'w:numPr');
    if (numPr === undefined) {
      return undefined;
    }
    const numIdElement = directChild(numPr, 'w:numId');
    const numId = numIdElement === undefined ? undefined : attr(numIdElement, 'w:val');
    if (numId === undefined) {
      return undefined;
    }
    const ilvlElement = directChild(numPr, 'w:ilvl');
    const ilvl = ilvlElement === undefined ? undefined : attr(ilvlElement, 'w:val');
    return { numId, level: ilvl === undefined ? 0 : Number.parseInt(ilvl, 10) };
  }

  set list(value: ContentListMembership | undefined) {
    const pPr = this.pPr(true);
    if (value === undefined) {
      const existing = directChild(pPr, 'w:numPr');
      if (existing !== undefined) {
        removeChild(pPr.children, existing);
      }
      return;
    }
    // A docx list membership is meaningless without a numId naming the numbering definition that carries its marker -- CT_NumPr's own shape requires w:numId, and schema 4.0.0's optional numId describes memberships from sources that have none (OOXML drawing paragraphs, level-only). Those memberships get a numId minted by buildDocxPackage's numbering pre-pass before they ever reach a DocxParagraph; a live-view caller writing { level } directly gets this loud refusal naming the fix rather than a silently unnumbered bullet.
    if (value.numId === undefined) {
      throw new Error('DocxParagraph.list requires a numId -- buildDocxPackage mints one for memberships that lack it; set numId explicitly (see src/edit/docx/numbering.ts)');
    }
    const numPr = getOrCreateChildElement(pPr, 'w:numPr', PPR_ORDER, () => el('w:numPr'));
    // CT_NumPr's sequence is ilvl before numId.
    numPr.children = [el('w:ilvl', { 'w:val': String(value.level) }), el('w:numId', { 'w:val': value.numId })];
  }

  // The canonical heading depth (document-schema.js's headingLevel, 1-based), stored as w:outlineLvl (0-based -- the identical +1 mapping ooxml.js's own docx reader applies reading it back). This is the depth signal Word's navigation pane and TOC fields read; the heading's VISUAL style is a separate fact carried by w:pStyle, which is why both are written for a heading rather than one standing in for the other.
  get headingLevel(): number | undefined {
    const pPr = this.pPr(false);
    const outlineLvl = pPr === undefined ? undefined : directChild(pPr, 'w:outlineLvl');
    const val = outlineLvl === undefined ? undefined : attr(outlineLvl, 'w:val');
    return val === undefined ? undefined : Number(val) + 1;
  }

  set headingLevel(value: number | undefined) {
    if (value === undefined) {
      const pPr = this.pPr(false);
      const existing = pPr === undefined ? undefined : directChild(pPr, 'w:outlineLvl');
      if (existing !== undefined && pPr !== undefined) {
        removeChild(pPr.children, existing);
      }
      return;
    }
    const outlineLvl = getOrCreateChildElement(this.pPr(true), 'w:outlineLvl', PPR_ORDER, () => el('w:outlineLvl'));
    setAttr(outlineLvl, 'w:val', String(value - 1));
  }

  // Appends a real OMML display equation (m:oMathPara > m:oMath) to the end of this paragraph, translated from `mathml` by src/omml/write.ts -- genuinely editable Word math, not a picture and not a plain-text stand-in. m:oMathPara is a member of WordprocessingML's own EG_PContent, so it is a direct child of w:p exactly as a w:r is, and needs no run to sit inside.
  //
  // Returns the translation's own result: `written` is false when the MathML produced no OMML content at all (an empty formula), which is a caller's signal to fall back to its own stand-in rather than leave the paragraph empty; `diagnostics` reports every construct that degraded or was approximated on the way through.
  appendOfficeMath(mathml: readonly MathMlNode[]): OmmlWriteResult & { readonly written: boolean } {
    const node = this.live();
    const result = buildOfficeMathParagraph(mathml);
    if (result.element === undefined) {
      return { ...result, written: false };
    }
    node.children.push(result.element);
    return { ...result, written: true };
  }

  // Appends one run per vector, each carrying a real page-anchored DrawingML shape (src/edit/docx/vector.ts) -- the docx counterpart to OdtBody.appendVectors. Every anchor hangs off this one paragraph, since they came from a single embedded drawing block covering one page's worth of geometry and a floating anchor takes no vertical space of its own; `relativeHeight` is stamped from each vector's own position in the run, so the paint order they were recovered in survives as Word's own floating-object z-order.
  //
  // Requires the paragraph to have been opened through a DocxEditor, for the same reason insertImageAfter below does: the document root is where a document-unique wp:docPr id is allocated from.
  appendVectorAnchors(vectors: readonly ContentVector[]): void {
    const node = this.live();
    if (this.imageContext === undefined) {
      throw new Error('appendVectorAnchors requires a paragraph opened through a DocxEditor');
    }
    const { documentRoot } = this.imageContext;
    vectors.forEach((vector, index) => {
      node.children.push(el('w:r', {}, [buildAnchoredVectorDrawing(vector, nextDrawingId(documentRoot), index)]));
    });
  }

  // Appends a new run containing an inline image to the end of this paragraph. Requires the paragraph to have been opened through a DocxEditor (table-cell paragraphs currently have no image context -- see ImageMediaContext's own doc comment).
  insertImageAfter(image: ImageInit): void {
    const node = this.live();
    if (this.imageContext === undefined) {
      throw new Error('insertImageAfter requires a paragraph opened through a DocxEditor');
    }
    const drawing = insertImageMedia(this.imageContext.media, this.imageContext.documentRoot, image);
    const run = el('w:r', {}, [drawing]);
    node.children.push(run);
  }

  // Wraps the paragraph's last w:r child in a w:hyperlink element carrying an external r:id, turning a just-appended run into a clickable hyperlink. Called AFTER appendRun + all property setters, since w:hyperlink wraps the whole run. The relationship is registered against word/document.xml with TargetMode External. Requires the paragraph to carry a Package reference (threaded from DocxEditor); a paragraph without one (e.g. hand-constructed for testing) silently skips the wrapping.
  wrapLastRunInHyperlink(url: string): void {
    if (this.pkg === undefined) {
      return;
    }
    const node = this.live();
    const lastChildIndex = node.children.length - 1;
    const lastChild = node.children[lastChildIndex];
    if (lastChild?.type !== 'element' || lastChild.tag !== 'w:r') {
      return;
    }
    const rId = addRelationship(this.pkg, 'word/document.xml', { type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink', target: url, targetMode: 'External' });
    node.children[lastChildIndex] = el('w:hyperlink', { 'r:id': rId }, [lastChild]);
  }

  remove(): void {
    removeChild(this.container, this.live());
    this.removed = true;
  }
}

export function buildParagraph(init: ParagraphInit = {}): XmlElement {
  const paragraph = el('w:p');
  if (init.styleId !== undefined || init.alignment !== undefined || init.headingLevel !== undefined) {
    const pPr = el('w:pPr');
    if (init.styleId !== undefined) {
      pPr.children.push(el('w:pStyle', { 'w:val': init.styleId }));
    }
    if (init.alignment !== undefined) {
      pPr.children.push(el('w:jc', { 'w:val': init.alignment === 'justify' ? 'both' : init.alignment }));
    }
    // Pushed last of the three: CT_PPrGeneral puts w:outlineLvl after w:jc, and this builder's push order is already the schema order.
    if (init.headingLevel !== undefined) {
      pPr.children.push(el('w:outlineLvl', { 'w:val': String(init.headingLevel - 1) }));
    }
    paragraph.children.push(pPr);
  }
  if (init.text !== undefined) {
    paragraph.children.push(buildRun({ text: init.text }));
  }
  return paragraph;
}
