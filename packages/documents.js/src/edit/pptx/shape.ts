import type { XmlElement, XmlNode } from 'ooxml.js';
import { attr, textContent } from 'ooxml.js';
import type { Box } from '../../model/geometry';
import { emuToPt, ptToEmu } from '../../model/units';
import { removeChild } from '../../xml/edit';
import { encodeXmlText } from '../../xml/entities';
import { el, txt } from '../../xml/fragment';

function directChild(parent: XmlElement, tag: string): XmlElement | undefined {
  for (const child of parent.children) {
    if (child.type === 'element' && child.tag === tag) {
      return child;
    }
  }
  return undefined;
}

function parseEmuAttr(element: XmlElement, name: string): number | undefined {
  const value = attr(element, name);
  return value === undefined ? undefined : Number.parseInt(value, 10);
}

// A live view over a p:sp (text box/autoshape) or p:pic (picture) element -- frame keeps OOXML's own top-left, y-down convention in points (already converted from EMU); the Y-flip into PDF space happens exactly once, in src/layout/slides.ts.
export class PptxShape {
  private readonly container: XmlNode[];
  private readonly node: XmlElement;
  private removed = false;

  constructor(container: XmlNode[], node: XmlElement) {
    this.container = container;
    this.node = node;
  }

  private live(): XmlElement {
    if (this.removed) {
      throw new Error('this PptxShape has been removed from its slide and can no longer be used');
    }
    return this.node;
  }

  // p:spPr (shape properties, holding a:xfrm) is named identically on both p:sp and p:pic.
  private spPrElement(create: true): XmlElement;
  private spPrElement(create: false): XmlElement | undefined;
  private spPrElement(create: boolean): XmlElement | undefined {
    const node = this.live();
    const existing = directChild(node, 'p:spPr');
    if (existing !== undefined || !create) {
      return existing;
    }
    const created = el('p:spPr');
    node.children.push(created);
    return created;
  }

  get frame(): Box | undefined {
    const spPr = this.spPrElement(false);
    const xfrm = spPr === undefined ? undefined : directChild(spPr, 'a:xfrm');
    if (xfrm === undefined) {
      return undefined;
    }
    const off = directChild(xfrm, 'a:off');
    const ext = directChild(xfrm, 'a:ext');
    if (off === undefined || ext === undefined) {
      return undefined;
    }
    const x = parseEmuAttr(off, 'x');
    const y = parseEmuAttr(off, 'y');
    const cx = parseEmuAttr(ext, 'cx');
    const cy = parseEmuAttr(ext, 'cy');
    if (x === undefined || y === undefined || cx === undefined || cy === undefined) {
      return undefined;
    }
    return { xPt: emuToPt(x), yPt: emuToPt(y), widthPt: emuToPt(cx), heightPt: emuToPt(cy) };
  }

  set frame(value: Box) {
    const spPr = this.spPrElement(true);
    let xfrm = directChild(spPr, 'a:xfrm');
    if (xfrm === undefined) {
      xfrm = el('a:xfrm');
      spPr.children.unshift(xfrm);
    }
    xfrm.children = [
      el('a:off', { x: String(ptToEmu(value.xPt)), y: String(ptToEmu(value.yPt)) }),
      el('a:ext', { cx: String(ptToEmu(value.widthPt)), cy: String(ptToEmu(value.heightPt)) }),
    ];
  }

  get text(): string {
    const txBody = directChild(this.live(), 'p:txBody');
    return txBody === undefined ? '' : textContent(txBody);
  }

  set text(value: string) {
    const node = this.live();
    let txBody = directChild(node, 'p:txBody');
    if (txBody === undefined) {
      txBody = el('p:txBody', {}, [el('a:bodyPr'), el('a:lstStyle')]);
      node.children.push(txBody);
    }
    const nonParagraphChildren = txBody.children.filter((c) => !(c.type === 'element' && c.tag === 'a:p'));
    const paragraph = el('a:p', {}, [el('a:r', {}, [el('a:t', {}, [txt(encodeXmlText(value))])])]);
    txBody.children = [...nonParagraphChildren, paragraph];
  }

  remove(): void {
    removeChild(this.container, this.live());
    this.removed = true;
  }
}

export function buildTextBoxShape(frame: Box, text: string, shapeId: number): XmlElement {
  const nvSpPr = el('p:nvSpPr', {}, [
    el('p:cNvPr', { id: String(shapeId), name: `TextBox ${shapeId}` }),
    el('p:cNvSpPr', { txBox: '1' }),
    el('p:nvPr'),
  ]);
  const spPr = el('p:spPr', {}, [
    el('a:xfrm', {}, [
      el('a:off', { x: String(ptToEmu(frame.xPt)), y: String(ptToEmu(frame.yPt)) }),
      el('a:ext', { cx: String(ptToEmu(frame.widthPt)), cy: String(ptToEmu(frame.heightPt)) }),
    ]),
    el('a:prstGeom', { prst: 'rect' }, [el('a:avLst')]),
  ]);
  const txBody = el('p:txBody', {}, [
    el('a:bodyPr', { wrap: 'square' }),
    el('a:lstStyle'),
    el('a:p', {}, [el('a:r', {}, [el('a:t', {}, [txt(encodeXmlText(text))])])]),
  ]);
  return el('p:sp', {}, [nvSpPr, spPr, txBody]);
}

export function buildPictureShape(frame: Box, relationshipId: string, shapeId: number): XmlElement {
  const nvPicPr = el('p:nvPicPr', {}, [
    el('p:cNvPr', { id: String(shapeId), name: `Picture ${shapeId}` }),
    el('p:cNvPicPr'),
    el('p:nvPr'),
  ]);
  const blipFill = el('p:blipFill', {}, [
    el('a:blip', { 'r:embed': relationshipId }),
    el('a:stretch', {}, [el('a:fillRect')]),
  ]);
  const spPr = el('p:spPr', {}, [
    el('a:xfrm', {}, [
      el('a:off', { x: String(ptToEmu(frame.xPt)), y: String(ptToEmu(frame.yPt)) }),
      el('a:ext', { cx: String(ptToEmu(frame.widthPt)), cy: String(ptToEmu(frame.heightPt)) }),
    ]),
    el('a:prstGeom', { prst: 'rect' }, [el('a:avLst')]),
  ]);
  return el('p:pic', {}, [nvPicPr, blipFill, spPr]);
}
