import type { Package, XmlElement } from 'ooxml.js';
import { decodePackage, encodePackage, resolveRelationships, rootElement } from 'ooxml.js';
import { ensureContentTypeOverride } from '../../opc/content-types';
import { addRelationship } from '../../opc/rels';
import { el } from '../../xml/fragment';
import { createEmptyPptxPackage } from './scaffold';
import type { SlideContext } from './slide';
import { PptxSlide } from './slide';

const PRESENTATION_PART_PATH = 'ppt/presentation.xml';
const MEDIA_DIR = 'ppt/media';
const SLIDE_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';
const SLIDE_RELATIONSHIP_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide';

// The ECMA-376 minimum value for a p:sldId/@id -- ids 0..255 are reserved.
const MIN_SLIDE_ID = 256;

function directChild(parent: XmlElement, tag: string): XmlElement | undefined {
  for (const child of parent.children) {
    if (child.type === 'element' && child.tag === tag) {
      return child;
    }
  }
  return undefined;
}

function attrValue(element: XmlElement, name: string): string | undefined {
  for (const a of element.attributes) {
    if (a.name === name) {
      return a.value;
    }
  }
  return undefined;
}

function findPresentationRoot(pkg: Package): XmlElement {
  const root = rootElement(pkg.parts[PRESENTATION_PART_PATH]);
  if (root === undefined) {
    throw new Error(`package has no root element at ${PRESENTATION_PART_PATH}`);
  }
  return root;
}

function findSldIdLst(presentationRoot: XmlElement): XmlElement {
  const sldIdLst = directChild(presentationRoot, 'p:sldIdLst');
  if (sldIdLst === undefined) {
    throw new Error(`${PRESENTATION_PART_PATH} has no p:sldIdLst element`);
  }
  return sldIdLst;
}

function nextSlideId(sldIdLst: XmlElement): number {
  let max = MIN_SLIDE_ID - 1;
  for (const child of sldIdLst.children) {
    if (child.type !== 'element' || child.tag !== 'p:sldId') {
      continue;
    }
    const id = attrValue(child, 'id');
    if (id === undefined) {
      continue;
    }
    const n = Number.parseInt(id, 10);
    if (!Number.isNaN(n) && n > max) {
      max = n;
    }
  }
  return max + 1;
}

function nextSlidePartIndex(pkg: Package): number {
  const pattern = /^ppt\/slides\/slide(\d+)\.xml$/;
  let max = 0;
  for (const path of Object.keys(pkg.parts)) {
    const match = pattern.exec(path);
    if (match === null) {
      continue;
    }
    const digits = match[1];
    if (digits === undefined) {
      continue;
    }
    const n = Number.parseInt(digits, 10);
    if (n > max) {
      max = n;
    }
  }
  return max + 1;
}

function buildEmptySlideRoot(): XmlElement {
  return el('p:sld', {}, [el('p:cSld', {}, [el('p:spTree')])]);
}

export class PptxEditor {
  private readonly pkg: Package;

  constructor(pkg: Package) {
    this.pkg = pkg;
  }

  slides(): PptxSlide[] {
    const presentationRoot = findPresentationRoot(this.pkg);
    const sldIdLst = findSldIdLst(presentationRoot);
    const presentationRels = resolveRelationships(this.pkg, PRESENTATION_PART_PATH);
    const out: PptxSlide[] = [];
    for (const child of sldIdLst.children) {
      if (child.type !== 'element' || child.tag !== 'p:sldId') {
        continue;
      }
      const rId = attrValue(child, 'r:id');
      if (rId === undefined) {
        continue;
      }
      const rel = presentationRels.get(rId);
      if (rel === undefined) {
        continue;
      }
      const slideRoot = rootElement(this.pkg.parts[rel.target]);
      if (slideRoot === undefined) {
        continue;
      }
      const context: SlideContext = { pkg: this.pkg, slidePartPath: rel.target, mediaDir: MEDIA_DIR };
      out.push(new PptxSlide(sldIdLst.children, slideRoot, context));
    }
    return out;
  }

  addSlide(): PptxSlide {
    const presentationRoot = findPresentationRoot(this.pkg);
    const sldIdLst = findSldIdLst(presentationRoot);

    const partIndex = nextSlidePartIndex(this.pkg);
    const slidePartPath = `ppt/slides/slide${partIndex}.xml`;
    const slideRoot = buildEmptySlideRoot();
    this.pkg.parts[slidePartPath] = { kind: 'xml', nodes: [slideRoot] };
    ensureContentTypeOverride(this.pkg, slidePartPath, SLIDE_CONTENT_TYPE);
    const relationshipId = addRelationship(this.pkg, PRESENTATION_PART_PATH, {
      type: SLIDE_RELATIONSHIP_TYPE,
      target: `slides/slide${partIndex}.xml`,
    });

    const slideId = nextSlideId(sldIdLst);
    sldIdLst.children.push(el('p:sldId', { id: String(slideId), 'r:id': relationshipId }));

    const context: SlideContext = { pkg: this.pkg, slidePartPath, mediaDir: MEDIA_DIR };
    return new PptxSlide(sldIdLst.children, slideRoot, context);
  }

  removeSlideAt(index: number): void {
    const presentationRoot = findPresentationRoot(this.pkg);
    const sldIdLst = findSldIdLst(presentationRoot);
    const sldIdElements = sldIdLst.children.filter((c) => c.type === 'element' && c.tag === 'p:sldId');
    const target = sldIdElements[index];
    if (target?.type !== 'element') {
      throw new Error(`slide index ${index} does not exist`);
    }
    const rId = attrValue(target, 'r:id');
    const listIndex = sldIdLst.children.indexOf(target);
    sldIdLst.children.splice(listIndex, 1);
    if (rId !== undefined) {
      const rel = resolveRelationships(this.pkg, PRESENTATION_PART_PATH).get(rId);
      if (rel !== undefined) {
        delete this.pkg.parts[rel.target];
      }
    }
  }

  moveSlide(from: number, to: number): void {
    const presentationRoot = findPresentationRoot(this.pkg);
    const sldIdLst = findSldIdLst(presentationRoot);
    const sldIdIndices: number[] = [];
    sldIdLst.children.forEach((child, i) => {
      if (child.type === 'element' && child.tag === 'p:sldId') {
        sldIdIndices.push(i);
      }
    });
    const fromChildIndex = sldIdIndices[from];
    if (fromChildIndex === undefined) {
      throw new Error(`slide index ${from} does not exist`);
    }
    const [moved] = sldIdLst.children.splice(fromChildIndex, 1);
    if (moved === undefined) {
      throw new Error(`slide index ${from} does not exist`);
    }
    const updatedIndices: number[] = [];
    sldIdLst.children.forEach((child, i) => {
      if (child.type === 'element' && child.tag === 'p:sldId') {
        updatedIndices.push(i);
      }
    });
    const insertAt = to < updatedIndices.length ? (updatedIndices[to] ?? sldIdLst.children.length) : sldIdLst.children.length;
    sldIdLst.children.splice(insertAt, 0, moved);
  }

  toPackage(): Package {
    return this.pkg;
  }

  toBytes(): Uint8Array<ArrayBuffer> {
    return encodePackage(this.pkg);
  }
}

export function openPptx(bytes: Uint8Array<ArrayBuffer>): PptxEditor {
  return new PptxEditor(decodePackage(bytes));
}

export function createPptx(): PptxEditor {
  return new PptxEditor(createEmptyPptxPackage());
}
