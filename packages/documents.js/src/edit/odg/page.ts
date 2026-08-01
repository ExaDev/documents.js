import type { Package, XmlElement, XmlNode } from 'odf.js';
import type { Box } from 'document-schema.js';
import { removeChild } from '../../xml/edit';
import type { ImageInit, MediaContext } from '../odp/image';
import { insertImageFrameMedia } from '../odp/image';
import { buildTextBoxFrame, OdpShape } from '../odp/shape';
import type { BoxVectorInit, LineVectorInit, PathVectorInit } from './vector';
import { buildEllipseElement, buildLineElement, buildPathElement, buildRectElement, OdgBoxVector, OdgLineVector, OdgPathVector } from './vector';

export interface TextBoxInit {
  readonly frame: Box;
  readonly text: string;
}

export interface PageImageInit extends ImageInit {
  readonly frame: Box;
}

export interface PageContext {
  readonly pkg: Package;
}

// A live view over a draw:page element's own content -- the odg equivalent of odp/slide.ts's own OdpSlide, extended with the vector-primitive setters a drawing carries that a presentation typically doesn't (addRect/addEllipse/addLine/addPath, vector.ts). shapes()/addTextBox/addImage reuse OdpShape/buildTextBoxFrame/insertImageFrameMedia WHOLESALE rather than a separate OdgShape class: odf.js's own readDrawFrame (typed/draw/shapes.ts) is the SAME function odp's walkDrawShapes and odg's walkDrawPageContent both call for a draw:frame, with byte-for-byte identical geometry resolution (resolveOdfShapeGeometry, rotation included) and content-model handling (draw:text-box/draw:image) -- there is no odg-specific divergence in a draw:frame's own semantics to build a second, near-duplicate class for. Vector primitives DO diverge (no rotation, a genuinely different attribute vocabulary per kind), which is exactly why they get their own vector.ts classes instead.
export class OdgPage {
  private readonly container: XmlNode[];
  private readonly node: XmlElement;
  private readonly context: PageContext;
  private removed = false;

  constructor(container: XmlNode[], node: XmlElement, context: PageContext) {
    this.container = container;
    this.node = node;
    this.context = context;
  }

  private live(): XmlElement {
    if (this.removed) {
      throw new Error('this OdgPage has been removed from the drawing and can no longer be used');
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

  addImage(init: PageImageInit): OdpShape {
    const node = this.live();
    const media: MediaContext = { pkg: this.context.pkg };
    const frameElement = insertImageFrameMedia(media, init.frame, init);
    node.children.push(frameElement);
    return new OdpShape(node.children, frameElement, this.context.pkg);
  }

  // Vector primitives (rect/ellipse/line/path) are appended alongside shapes in the SAME draw:page children list -- document order IS paint order for odg, exactly as it is for odp's own slide shapes (see odf.js's own typed/draw/shapes.ts paintOrderKey note: real LibreOffice output never emits an explicit draw:z-index, it reorders elements to already match paint order). A caller wanting a vector to paint behind/in front of a particular shape controls that purely by calling addRect/addEllipse/addLine/addPath/addTextBox/addImage in the desired order.

  addRect(init: BoxVectorInit): OdgBoxVector {
    const node = this.live();
    const element = buildRectElement(this.context.pkg, init);
    node.children.push(element);
    return new OdgBoxVector(node.children, element, this.context.pkg);
  }

  addEllipse(init: BoxVectorInit): OdgBoxVector {
    const node = this.live();
    const element = buildEllipseElement(this.context.pkg, init);
    node.children.push(element);
    return new OdgBoxVector(node.children, element, this.context.pkg);
  }

  addLine(init: LineVectorInit): OdgLineVector {
    const node = this.live();
    const element = buildLineElement(this.context.pkg, init);
    node.children.push(element);
    return new OdgLineVector(node.children, element, this.context.pkg);
  }

  addPath(init: PathVectorInit): OdgPathVector {
    const node = this.live();
    const element = buildPathElement(this.context.pkg, init);
    node.children.push(element);
    return new OdgPathVector(node.children, element, this.context.pkg);
  }

  remove(): void {
    removeChild(this.container, this.live());
    this.removed = true;
  }
}
