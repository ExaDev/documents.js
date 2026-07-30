import type { Package, XmlElement, XmlNode } from 'ooxml.js';
import { resolveRelationships, rootElement, textContent } from 'ooxml.js';
import type { Box } from '../../model/geometry';
import { ensureContentTypeOverride } from '../../opc/content-types';
import { buildRelativeTarget } from '../../opc/paths';
import { addRelationship } from '../../opc/rels';
import { removeChild } from '../../xml/edit';
import { encodeXmlText } from '../../xml/entities';
import { el, txt } from '../../xml/fragment';
import type { ImageInit, MediaContext } from './image';
import { insertPictureShapeMedia } from './image';
import { buildTextBoxShape, PptxShape } from './shape';

export interface TextBoxInit {
  readonly frame: Box;
  readonly text: string;
}

export interface SlideImageInit extends ImageInit {
  readonly frame: Box;
}

function directChild(parent: XmlElement, tag: string): XmlElement | undefined {
  for (const child of parent.children) {
    if (child.type === 'element' && child.tag === tag) {
      return child;
    }
  }
  return undefined;
}

function findSpTree(slideRoot: XmlElement): XmlElement {
  const cSld = directChild(slideRoot, 'p:cSld');
  const spTree = cSld === undefined ? undefined : directChild(cSld, 'p:spTree');
  if (spTree === undefined) {
    throw new Error('slide has no p:cSld/p:spTree element');
  }
  return spTree;
}

function nextIdIn(root: XmlElement): number {
  let max = 0;
  const stack: XmlElement[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) {
      continue;
    }
    if (node.tag === 'p:cNvPr') {
      for (const a of node.attributes) {
        if (a.name === 'id') {
          const n = Number.parseInt(a.value, 10);
          if (!Number.isNaN(n) && n > max) {
            max = n;
          }
        }
      }
    }
    for (const child of node.children) {
      if (child.type === 'element') {
        stack.push(child);
      }
    }
  }
  return max + 1;
}

const NOTES_SLIDE_RELATIONSHIP_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide';
const NOTES_SLIDE_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml';

function buildMinimalNotesSlide(text: string): XmlElement {
  // Intentionally minimal: a single body placeholder holding the text, with no notesMaster/ notesLayout relationship chain -- a documented scope limitation for this editor, not a silent one.
  const body = el('p:sp', {}, [
    el('p:nvSpPr', {}, [
      el('p:cNvPr', { id: '2', name: 'Notes Placeholder' }),
      el('p:cNvSpPr', {}, [el('a:spLocks', { noGrp: '1' })]),
      el('p:nvPr', {}, [el('p:ph', { type: 'body', idx: '1' })]),
    ]),
    el('p:spPr'),
    el('p:txBody', {}, [
      el('a:bodyPr'),
      el('a:lstStyle'),
      el('a:p', {}, [el('a:r', {}, [el('a:t', {}, [txt(encodeXmlText(text))])])]),
    ]),
  ]);
  return el('p:notes', {}, [el('p:cSld', {}, [el('p:spTree', {}, [body])])]);
}

export interface SlideContext {
  readonly pkg: Package;
  readonly slidePartPath: string;
  readonly mediaDir: string;
}

// A live view over a p:sld element's shape tree.
export class PptxSlide {
  private readonly container: XmlNode[];
  private readonly node: XmlElement;
  private readonly context: SlideContext;
  private removed = false;

  constructor(container: XmlNode[], node: XmlElement, context: SlideContext) {
    this.container = container;
    this.node = node;
    this.context = context;
  }

  private live(): XmlElement {
    if (this.removed) {
      throw new Error('this PptxSlide has been removed from the presentation and can no longer be used');
    }
    return this.node;
  }

  shapes(): PptxShape[] {
    const spTree = findSpTree(this.live());
    const out: PptxShape[] = [];
    for (const child of spTree.children) {
      if (child.type === 'element' && (child.tag === 'p:sp' || child.tag === 'p:pic')) {
        out.push(new PptxShape(spTree.children, child));
      }
    }
    return out;
  }

  addTextBox(init: TextBoxInit): PptxShape {
    const spTree = findSpTree(this.live());
    const id = nextIdIn(spTree);
    const shapeElement = buildTextBoxShape(init.frame, init.text, id);
    spTree.children.push(shapeElement);
    return new PptxShape(spTree.children, shapeElement);
  }

  addImage(init: SlideImageInit): PptxShape {
    const slideRoot = this.live();
    const spTree = findSpTree(slideRoot);
    const media: MediaContext = {
      pkg: this.context.pkg,
      partPath: this.context.slidePartPath,
      mediaDir: this.context.mediaDir,
    };
    const shapeElement = insertPictureShapeMedia(media, slideRoot, init.frame, init);
    spTree.children.push(shapeElement);
    return new PptxShape(spTree.children, shapeElement);
  }

  get notes(): string {
    const rels = resolveRelationships(this.context.pkg, this.context.slidePartPath);
    const notesRel = [...rels.values()].find((r) => r.type === NOTES_SLIDE_RELATIONSHIP_TYPE);
    if (notesRel === undefined) {
      return '';
    }
    const notesRoot = rootElement(this.context.pkg.parts[notesRel.target]);
    return notesRoot === undefined ? '' : textContent(notesRoot);
  }

  set notes(value: string) {
    const { pkg, slidePartPath } = this.context;
    const rels = resolveRelationships(pkg, slidePartPath);
    const existingRel = [...rels.values()].find((r) => r.type === NOTES_SLIDE_RELATIONSHIP_TYPE);
    let notesPartPath: string;
    if (existingRel === undefined) {
      const nextIndex = Object.keys(pkg.parts).filter((p) => p.startsWith('ppt/notesSlides/')).length + 1;
      notesPartPath = `ppt/notesSlides/notesSlide${nextIndex}.xml`;
      ensureContentTypeOverride(pkg, notesPartPath, NOTES_SLIDE_CONTENT_TYPE);
      addRelationship(pkg, slidePartPath, {
        type: NOTES_SLIDE_RELATIONSHIP_TYPE,
        target: buildRelativeTarget(slidePartPath, notesPartPath),
      });
    } else {
      notesPartPath = existingRel.target;
    }
    pkg.parts[notesPartPath] = { kind: 'xml', nodes: [buildMinimalNotesSlide(value)] };
  }

  remove(): void {
    removeChild(this.container, this.live());
    this.removed = true;
  }
}
