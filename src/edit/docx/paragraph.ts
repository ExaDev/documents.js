import type { Package, XmlElement, XmlNode } from 'ooxml.js';
import { attr, textContent } from 'ooxml.js';
import type { ContentListMembership } from 'document-schema.js';
import { getOrCreateChildElement, removeChild } from '../../xml/edit';
import { el } from '../../xml/fragment';
import type { ImageInit, MediaContext } from './image';
import { insertImageMedia } from './image';
import { ensureFirstChild, getAlignment, getStyleId, PPR_ORDER, setAlignment, setStyleId } from './props';
import type { RunInit } from './run';
import { buildRun, DocxRun } from './run';

export interface ParagraphInit {
  readonly text?: string;
  readonly styleId?: string;
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
  private removed = false;

  constructor(container: XmlNode[], node: XmlElement, imageContext?: ImageMediaContext) {
    this.container = container;
    this.node = node;
    this.imageContext = imageContext;
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
    return textContent(this.live());
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
    const numPr = getOrCreateChildElement(pPr, 'w:numPr', PPR_ORDER, () => el('w:numPr'));
    // CT_NumPr's sequence is ilvl before numId.
    numPr.children = [el('w:ilvl', { 'w:val': String(value.level) }), el('w:numId', { 'w:val': value.numId })];
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

  remove(): void {
    removeChild(this.container, this.live());
    this.removed = true;
  }
}

export function buildParagraph(init: ParagraphInit = {}): XmlElement {
  const paragraph = el('w:p');
  if (init.styleId !== undefined || init.alignment !== undefined) {
    const pPr = el('w:pPr');
    if (init.styleId !== undefined) {
      pPr.children.push(el('w:pStyle', { 'w:val': init.styleId }));
    }
    if (init.alignment !== undefined) {
      pPr.children.push(el('w:jc', { 'w:val': init.alignment === 'justify' ? 'both' : init.alignment }));
    }
    paragraph.children.push(pPr);
  }
  if (init.text !== undefined) {
    paragraph.children.push(buildRun({ text: init.text }));
  }
  return paragraph;
}
