import type { ContentVector } from 'document-schema.js';
import type { Package, XmlElement, XmlNode } from 'odf.js';
import { formatOdfLength } from 'odf.js';
import { elementsWithTag } from 'ooxml.js';
import type { Box } from '../../model/geometry';
import { removeChild } from '../../xml/edit';
import { el } from '../../xml/fragment';
import { decodeOdfText } from '../../xml/odf-text';
import type { OdgVector } from '../odg/vector';
import { appendVectorTo } from '../odg/vector';
import { buildParagraph } from '../odt/paragraph';
import type { TableInit } from '../odt/table';
import { buildTable, OdtTable } from '../odt/table';
import type { ImageInit, MediaContext } from './image';
import { insertImageFrameMedia } from './image';
import { buildTableFrame, buildTextBoxFrame, OdpShape } from './shape';

export interface TextBoxInit {
  readonly frame: Box;
  readonly text: string;
}

export interface SlideImageInit extends ImageInit {
  readonly frame: Box;
}

export interface SlideTableInit {
  readonly frame: Box;
  readonly table: TableInit;
}

function directChild(parent: XmlElement, tag: string): XmlElement | undefined {
  for (const child of parent.children) {
    if (child.type === 'element' && child.tag === tag) {
      return child;
    }
  }
  return undefined;
}

// presentation:notes' own frame geometry below (x=20pt, y=400pt, width=300pt, height=100pt) is not an arbitrary UI guess: it is the exact geometry odf.js's own typed/odp/read.test.ts fixture uses for its speaker-notes frame, whose top-of-file comment states the whole fixture was "assembled from XML shapes verified against genuine LibreOffice 26.2 output" -- mirroring how pptx/slide.ts's own buildMinimalNotesSlide cites a real Keynote-exported reference file for its own notes-placeholder geometry.
const NOTES_FRAME_X_PT = 20;
const NOTES_FRAME_Y_PT = 400;
const NOTES_FRAME_WIDTH_PT = 300;
const NOTES_FRAME_HEIGHT_PT = 100;

function buildNotesElement(pkg: Package, value: string): XmlElement {
  const paragraphs = value.split('\n').map((line) => buildParagraph(pkg, { text: line }));
  const textBox = el('draw:text-box', {}, paragraphs);
  const frame = el(
    'draw:frame',
    {
      'svg:x': formatOdfLength(NOTES_FRAME_X_PT),
      'svg:y': formatOdfLength(NOTES_FRAME_Y_PT),
      'svg:width': formatOdfLength(NOTES_FRAME_WIDTH_PT),
      'svg:height': formatOdfLength(NOTES_FRAME_HEIGHT_PT),
    },
    [textBox],
  );
  return el('presentation:notes', {}, [frame]);
}

export interface SlideContext {
  readonly pkg: Package;
}

// The pair a table shape produces from OdpSlide.addTable: the frame itself (for frame/rotationDeg, exactly like any other OdpShape) and a live view over its table:table content (for cell population, exactly like a document-level OdtTable) -- two separate live views over the same draw:frame's own children, since OdpShape's own paragraphs()/text assume draw:text-box content a table shape doesn't have.
export interface OdpTableShape {
  readonly shape: OdpShape;
  readonly table: OdtTable;
}

// A live view over a draw:page element's own shape list -- the odp equivalent of pptx/slide.ts's own PptxSlide. Unlike pptx's p:sldId/p:sldIdLst indirection, a draw:page's position among office:presentation's own children IS slide order (see odf.js's own typed/odp/read.ts top-of-file note), so this needs no id allocation of its own the way pptx/editor.ts's PptxEditor does.
export class OdpSlide {
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
      throw new Error('this OdpSlide has been removed from the presentation and can no longer be used');
    }
    return this.node;
  }

  shapes(): OdpShape[] {
    const node = this.live();
    const out: OdpShape[] = [];
    for (const child of node.children) {
      if (child.type === 'element' && child.tag === 'draw:frame') {
        out.push(new OdpShape(node.children, child, this.context.pkg));
      }
    }
    return out;
  }

  addTextBox(init: TextBoxInit): OdpShape {
    const node = this.live();
    const frameElement = buildTextBoxFrame(this.context.pkg, init.frame, init.text);
    node.children.push(frameElement);
    return new OdpShape(node.children, frameElement, this.context.pkg);
  }

  addImage(init: SlideImageInit): OdpShape {
    const node = this.live();
    const media: MediaContext = { pkg: this.context.pkg };
    const frameElement = insertImageFrameMedia(media, init.frame, init);
    node.children.push(frameElement);
    return new OdpShape(node.children, frameElement, this.context.pkg);
  }

  // A table:table lives DIRECTLY inside its own draw:frame, no draw:text-box wrapper (see shape.ts's own buildTableFrame) -- so it gets its own OdtTable view (reused wholesale, see src/edit/odt/table.ts) rather than OdpShape's paragraphs()/text, which assume text-box content.
  addTable(init: SlideTableInit): OdpTableShape {
    const node = this.live();
    const tableElement = buildTable(this.context.pkg, init.table);
    const frameElement = buildTableFrame(init.frame, tableElement);
    node.children.push(frameElement);
    return {
      shape: new OdpShape(node.children, frameElement, this.context.pkg),
      table: new OdtTable(frameElement.children, tableElement, this.context.pkg),
    };
  }

  // A vector primitive (rect/ellipse/line/path) appended alongside this slide's shapes, in the SAME draw:page children list -- document order is paint order here exactly as it is for an odg page (see OdgPage's own note on why no draw:z-index is ever written). This reuses src/edit/odg/vector.ts's builders WHOLESALE, mirroring how OdpShape/OdtParagraph are themselves reused across formats elsewhere in this package: draw:rect/draw:ellipse/draw:line/draw:path carry byte-for-byte the same attribute vocabulary on a presentation's draw:page as on a drawing's, and odf.js's own readDrawPageContent reads both through one function. A slide is positioned against its page, so nothing here is text-flow anchored.
  addVector(vector: ContentVector): OdgVector {
    return appendVectorTo(this.live().children, this.context.pkg, vector);
  }

  // presentation:notes is a direct child of draw:page, typically wrapping a single draw:frame > draw:text-box with one text:p per line -- mirroring odf.js's own readSlideNotes (typed/odp/read.ts), which is not exported, so this is a small, deliberate reimplementation of the identical deep text:p search + decodeOdfText + join('\n') logic on the write side's own read-back path.
  get notes(): string {
    const notesElement = directChild(this.live(), 'presentation:notes');
    if (notesElement === undefined) {
      return '';
    }
    return elementsWithTag(notesElement.children, 'text:p')
      .map((p) => decodeOdfText(p.children))
      .join('\n');
  }

  set notes(value: string) {
    const node = this.live();
    const existing = directChild(node, 'presentation:notes');
    const notesElement = buildNotesElement(this.context.pkg, value);
    if (existing === undefined) {
      node.children.push(notesElement);
    } else {
      existing.children = notesElement.children;
    }
  }

  remove(): void {
    removeChild(this.container, this.live());
    this.removed = true;
  }
}
