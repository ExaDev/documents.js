import type { XmlElement, XmlNode } from 'ooxml.js';
import { attr, textContent } from 'ooxml.js';
import type { Box } from '../../model/geometry';
import type { LayoutColor } from '../../model/color';
import { emuToPt, ptToEmu } from '../../model/units';
import type { Alignment } from '../../model/style';
import { removeAttr, removeChild, setAttr } from '../../xml/edit';
import { encodeXmlText, needsSpacePreserve } from '../../xml/entities';
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

// a:xfrm/@rot is measured in 60,000ths of a degree, clockwise (ECMA-376 20.1.7.6) -- the DrawingML analogue of ODF's draw:transform rotation (see src/edit/odp/shape.ts's OdpShape.rotationDeg). ContentShape.rotationDeg (document-schema.js) is already clockwise-positive degrees for a top-level, ungrouped shape -- ooxml.js's own composeShapeRotationDeg collapses to a bare passthrough of xfrm.rotationDeg when there is no parent group transform (typed/shared/drawingml.ts) -- so this needs only the literal degree <-> 60,000ths scale, no sign flip or group composition. Exported for src/edit/pptx/table.ts's own buildTableGraphicFrame, whose p:xfrm uses the identical unit.
export const ROTATION_UNITS_PER_DEGREE = 60000;

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

  get rotationDeg(): number | undefined {
    const spPr = this.spPrElement(false);
    const xfrm = spPr === undefined ? undefined : directChild(spPr, 'a:xfrm');
    const rot = xfrm === undefined ? undefined : attr(xfrm, 'rot');
    return rot === undefined ? undefined : Number(rot) / ROTATION_UNITS_PER_DEGREE;
  }

  set rotationDeg(value: number | undefined) {
    const spPr = this.spPrElement(true);
    let xfrm = directChild(spPr, 'a:xfrm');
    if (xfrm === undefined) {
      xfrm = el('a:xfrm');
      spPr.children.unshift(xfrm);
    }
    if (value === undefined || value === 0) {
      removeAttr(xfrm, 'rot');
      return;
    }
    setAttr(xfrm, 'rot', String(Math.round(value * ROTATION_UNITS_PER_DEGREE)));
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

  // Replaces the shape's whole text body with multiple styled paragraphs -- the richer counterpart to the flat `text` setter above, for callers (the PDF->pptx reconstruction path) that already have per-run bold/italic/font/size/colour and per-paragraph alignment to place, not just a single plain string.
  setParagraphs(paragraphs: readonly DrawingParagraphInit[]): void {
    const node = this.live();
    let txBody = directChild(node, 'p:txBody');
    if (txBody === undefined) {
      txBody = el('p:txBody', {}, [el('a:bodyPr'), el('a:lstStyle')]);
      node.children.push(txBody);
    }
    const nonParagraphChildren = txBody.children.filter((c) => !(c.type === 'element' && c.tag === 'a:p'));
    txBody.children = [...nonParagraphChildren, ...paragraphs.map(buildDrawingParagraph)];
  }

  remove(): void {
    removeChild(this.container, this.live());
    this.removed = true;
  }
}

export interface DrawingRunInit {
  readonly text: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly fontFamily?: string;
  readonly sizePt?: number;
  readonly color?: LayoutColor;
}

export interface DrawingParagraphInit {
  readonly runs: readonly DrawingRunInit[];
  readonly alignment?: Alignment;
}

// a:pPr/@algn's own value set (ECMA-376 20.1.10.2) -- distinct spellings from WordprocessingML's w:jc.
const ALIGNMENT_TO_ALGN: Readonly<Record<Alignment, string>> = { left: 'l', center: 'ctr', right: 'r', justify: 'just' };

// a:rPr/@sz is in hundredths of a point (ECMA-376 20.1.10.71), unlike WordprocessingML's half-points.
const HUNDREDTHS_POINT_PER_POINT = 100;

function colorToHex(color: LayoutColor): string {
  const toByte = (c: number): string => Math.round(c * 255).toString(16).padStart(2, '0');
  return `${toByte(color.r)}${toByte(color.g)}${toByte(color.b)}`.toUpperCase();
}

// DrawingML run properties are attribute-based toggles (b="1", i="1" on a:rPr itself), not the element-presence toggles WordprocessingML uses (w:b/w:i as child elements) -- the same distinction ooxml.js's readPptx documents for the read side, mirrored here on write.
function buildDrawingRun(init: DrawingRunInit): XmlElement {
  const rPrAttrs: Record<string, string> = {};
  if (init.bold === true) {
    rPrAttrs.b = '1';
  }
  if (init.italic === true) {
    rPrAttrs.i = '1';
  }
  if (init.sizePt !== undefined) {
    rPrAttrs.sz = String(Math.round(init.sizePt * HUNDREDTHS_POINT_PER_POINT));
  }
  const rPrChildren: XmlNode[] = [];
  if (init.color !== undefined) {
    rPrChildren.push(el('a:solidFill', {}, [el('a:srgbClr', { val: colorToHex(init.color) })]));
  }
  if (init.fontFamily !== undefined) {
    rPrChildren.push(el('a:latin', { typeface: init.fontFamily }));
  }
  const rPr = Object.keys(rPrAttrs).length > 0 || rPrChildren.length > 0 ? [el('a:rPr', rPrAttrs, rPrChildren)] : [];
  const tAttrs: Record<string, string> = needsSpacePreserve(init.text) ? { 'xml:space': 'preserve' } : {};
  return el('a:r', {}, [...rPr, el('a:t', tAttrs, [txt(encodeXmlText(init.text))])]);
}

// Exported for src/edit/pptx/table.ts's own PptxTableCell.setParagraphs -- a:tc's own a:txBody holds the identical a:p/a:r/a:rPr/a:t content model a p:sp's own p:txBody does (ECMA-376 CT_TextBody is shared), so a table cell's paragraphs are built through this exact same function rather than a second implementation.
export function buildDrawingParagraph(init: DrawingParagraphInit): XmlElement {
  const children: XmlNode[] = [];
  if (init.alignment !== undefined) {
    children.push(el('a:pPr', { algn: ALIGNMENT_TO_ALGN[init.alignment] }));
  }
  if (init.runs.length === 0) {
    children.push(el('a:endParaRPr')); // an empty paragraph still needs some content, matching how PowerPoint itself emits one
  } else {
    children.push(...init.runs.map(buildDrawingRun));
  }
  return el('a:p', {}, children);
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
