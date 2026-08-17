import type { XmlElement, XmlNode } from 'ooxml.js';
import { attr, textContent } from 'ooxml.js';
import type { Box } from 'document-schema.js';
import type { Color as LayoutColor } from 'document-schema.js';
import type { MathMlNode } from '../../mathml/nodes';
import { emuToPt, ptToEmu } from '../../model/units';
import type { OmmlWriteResult } from '../../omml/write';
import { buildOfficeMathParagraph } from '../../omml/write';
import type { Alignment } from 'document-schema.js';
import { removeAttr, removeChild, setAttr } from '../../xml/edit';
import { encodeXmlText, needsSpacePreserve } from '../../xml/entities';
import { el, txt } from '../../xml/fragment';
import { drawingMlColorHex } from '../drawingml/vector';

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

  // p:cNvPr lives under p:nvSpPr for a p:sp and under p:nvPicPr for a p:pic (ECMA-376 19.3.1.12/19.3.1.32); either container holds exactly one p:cNvPr carrying the shape's non-visual identity (id + name). Find-or-create the container first, then the p:cNvPr inside it -- mirroring how spPrElement finds the p:spPr regardless of which shape kind this is.
  private cNvPrElement(create: true): XmlElement;
  private cNvPrElement(create: false): XmlElement | undefined;
  private cNvPrElement(create: boolean): XmlElement | undefined {
    const node = this.live();
    let container: XmlElement | undefined;
    for (const tag of ['p:nvSpPr', 'p:nvPicPr'] as const) {
      container = directChild(node, tag);
      if (container !== undefined) {
        break;
      }
    }
    if (container === undefined) {
      if (!create) {
        return undefined;
      }
      container = el('p:nvSpPr');
      node.children.unshift(container);
    }
    const existing = directChild(container, 'p:cNvPr');
    if (existing !== undefined || !create) {
      return existing;
    }
    const created = el('p:cNvPr', { id: '0' });
    container.children.unshift(created);
    return created;
  }

  // a:bodyPr lives as the first child of p:txBody (ECMA-376 21.1.2.2.1), carrying the text-body insets (lIns/tIns/rIns/bIns, all in EMU). Find-or-create the p:txBody first if absent, then ensure the a:bodyPr is its first child -- matching how the `text` setter already ensures a p:txBody exists with an a:bodyPr/a:lstStyle pair.
  private bodyPrElement(create: true): XmlElement;
  private bodyPrElement(create: false): XmlElement | undefined;
  private bodyPrElement(create: boolean): XmlElement | undefined {
    const node = this.live();
    let txBody = directChild(node, 'p:txBody');
    if (txBody === undefined) {
      if (!create) {
        return undefined;
      }
      txBody = el('p:txBody', {}, [el('a:bodyPr'), el('a:lstStyle')]);
      node.children.push(txBody);
    }
    const existing = directChild(txBody, 'a:bodyPr');
    if (existing !== undefined || !create) {
      return existing;
    }
    const created = el('a:bodyPr');
    txBody.children.unshift(created);
    return created;
  }

  // p:cNvPr@name (ECMA-376 19.2.1.3) -- the shape's own non-visual name, read back by ooxml.js's own readPptx (typed/pptx/read.ts's shapeName) straight off this attribute.
  get name(): string | undefined {
    const cNvPr = this.cNvPrElement(false);
    return cNvPr === undefined ? undefined : attr(cNvPr, 'name');
  }

  set name(value: string | undefined) {
    const cNvPr = this.cNvPrElement(true);
    if (value === undefined) {
      removeAttr(cNvPr, 'name');
      return;
    }
    setAttr(cNvPr, 'name', value);
  }

  // a:bodyPr@lIns/tIns/rIns/bIns are in EMU (ECMA-376 21.1.2.2.1), the same unit a:off/a:ext use -- ooxml.js's own readShapeTextExtras divides each by EMU_PER_POINT, so these setters write the identical EMU value the reader divides back. An absent attribute means PowerPoint's own default (91440 EMU left/right, 45720 EMU top/bottom), not zero -- so undefined removes the attribute rather than writing 0.
  get insetLeftPt(): number | undefined {
    return this.readInsetPt('lIns');
  }

  set insetLeftPt(value: number | undefined) {
    this.writeInsetPt('lIns', value);
  }

  get insetTopPt(): number | undefined {
    return this.readInsetPt('tIns');
  }

  set insetTopPt(value: number | undefined) {
    this.writeInsetPt('tIns', value);
  }

  get insetRightPt(): number | undefined {
    return this.readInsetPt('rIns');
  }

  set insetRightPt(value: number | undefined) {
    this.writeInsetPt('rIns', value);
  }

  get insetBottomPt(): number | undefined {
    return this.readInsetPt('bIns');
  }

  set insetBottomPt(value: number | undefined) {
    this.writeInsetPt('bIns', value);
  }

  private readInsetPt(name: 'lIns' | 'tIns' | 'rIns' | 'bIns'): number | undefined {
    const bodyPr = this.bodyPrElement(false);
    if (bodyPr === undefined) {
      return undefined;
    }
    const value = attr(bodyPr, name);
    return value === undefined ? undefined : emuToPt(Number.parseInt(value, 10));
  }

  private writeInsetPt(name: 'lIns' | 'tIns' | 'rIns' | 'bIns', value: number | undefined): void {
    const bodyPr = this.bodyPrElement(true);
    if (value === undefined) {
      removeAttr(bodyPr, name);
      return;
    }
    setAttr(bodyPr, name, String(ptToEmu(value)));
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

  // Replaces the shape's whole text body with a single paragraph carrying a real OOXML equation -- the pptx counterpart to src/edit/docx/paragraph.ts's own DocxParagraph.appendOfficeMath, and what closes ExaDev/documents.js#563's "pptx has zero formula support" gap. m:oMathPara/m:oMath share the identical OMML markup Word and PowerPoint both consume (ECMA-376's math markup is host-application-agnostic -- src/omml/write.ts builds no WordprocessingML-specific wrapper around it), so this is genuinely the same translator docx already uses, not a second one. A formula whose MathML produces no OMML content at all (an empty m:oMath) writes nothing and reports written: false, exactly like the docx counterpart -- the caller falls back to a plain-text stand-in (src/edit/pptx/content.ts's own appendShape).
  appendOfficeMath(mathml: readonly MathMlNode[]): OmmlWriteResult & { readonly written: boolean } {
    const result = buildOfficeMathParagraph(mathml);
    if (result.element === undefined) {
      return { ...result, written: false };
    }
    const node = this.live();
    let txBody = directChild(node, 'p:txBody');
    if (txBody === undefined) {
      txBody = el('p:txBody', {}, [el('a:bodyPr'), el('a:lstStyle')]);
      node.children.push(txBody);
    }
    const nonParagraphChildren = txBody.children.filter((c) => !(c.type === 'element' && c.tag === 'a:p'));
    txBody.children = [...nonParagraphChildren, el('a:p', {}, [result.element])];
    return { ...result, written: true };
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
  readonly underline?: boolean;
  readonly strike?: boolean;
  readonly fontFamily?: string;
  readonly sizePt?: number;
  readonly color?: LayoutColor;
  readonly hyperlinkRId?: string;
}

export interface DrawingParagraphInit {
  readonly runs: readonly DrawingRunInit[];
  readonly alignment?: Alignment;
  readonly spacingBeforePt?: number;
  readonly spacingAfterPt?: number;
  // A line-spacing MULTIPLIER (1.0 = single, 1.5 = one-and-a-half, 2.0 = double) -- the same shape ContentParagraph.lineSpacing carries and ooxml.js's own readPptx produces from a:lnSpc/a:spcPct@val / 100000.
  readonly lineSpacing?: number;
  readonly indentLeftPt?: number;
  readonly indentFirstLinePt?: number;
}

// a:pPr/@algn's own value set (ECMA-376 20.1.10.2) -- distinct spellings from WordprocessingML's w:jc.
const ALIGNMENT_TO_ALGN: Readonly<Record<Alignment, string>> = { left: 'l', center: 'ctr', right: 'r', justify: 'just' };

// a:rPr/@sz is in hundredths of a point (ECMA-376 20.1.10.71), unlike WordprocessingML's half-points.
const HUNDREDTHS_POINT_PER_POINT = 100;

// a:spcPts/@val is in hundredths of a point (ECMA-376 20.1.10.69) -- the identical unit a:rPr/@sz uses, confirmed against ooxml.js's own readAbsoluteSpacingPt (typed/pptx/read.ts), which divides by DRAWINGML_FONT_SIZE_HUNDREDTHS_PER_POINT (100) to recover points.
const SPACING_POINTS_PER_POINT = 100;

// a:spcPct/@val is in thousandths of a percent (ECMA-376 20.1.10.68) -- 100000 = 100% = single spacing. ooxml.js's own readLineSpacingMultiplier divides @val by 100000 to recover the multiplier, so the inverse is multiplier * 100000.
const LINE_SPACING_PERCENT_PER_MULTIPLIER = 100000;

// DrawingML run properties are attribute-based toggles (b="1", i="1" on a:rPr itself), not the element-presence toggles WordprocessingML uses (w:b/w:i as child elements) -- the same distinction ooxml.js's readPptx documents for the read side, mirrored here on write.
function buildDrawingRun(init: DrawingRunInit): XmlElement {
  const rPrAttrs: Record<string, string> = {};
  if (init.bold === true) {
    rPrAttrs.b = '1';
  }
  if (init.italic === true) {
    rPrAttrs.i = '1';
  }
  // a:rPr/@u and a:rPr/@strike are attribute toggles on the same element as b/i (ECMA-376 21.1.2.3.2/21.1.2.3.15), so they mirror bold/italic exactly. ooxml.js's readPptx reads any @u != "none" as underlined and any @strike != "noStrike" as struck, so the single-underline ("sng") and single-strike ("sngStrike") values round-trip back as underline/strike === true.
  if (init.underline === true) {
    rPrAttrs.u = 'sng';
  }
  if (init.strike === true) {
    rPrAttrs.strike = 'sngStrike';
  }
  if (init.sizePt !== undefined) {
    rPrAttrs.sz = String(Math.round(init.sizePt * HUNDREDTHS_POINT_PER_POINT));
  }
  const rPrChildren: XmlNode[] = [];
  if (init.color !== undefined) {
    rPrChildren.push(el('a:solidFill', {}, [el('a:srgbClr', { val: drawingMlColorHex(init.color) })]));
  }
  if (init.fontFamily !== undefined) {
    rPrChildren.push(el('a:latin', { typeface: init.fontFamily }));
  }
  if (init.hyperlinkRId !== undefined) {
    rPrChildren.push(el('a:hlinkClick', { 'r:id': init.hyperlinkRId }));
  }
  const rPr = Object.keys(rPrAttrs).length > 0 || rPrChildren.length > 0 ? [el('a:rPr', rPrAttrs, rPrChildren)] : [];
  const tAttrs: Record<string, string> = needsSpacePreserve(init.text) ? { 'xml:space': 'preserve' } : {};
  return el('a:r', {}, [...rPr, el('a:t', tAttrs, [txt(encodeXmlText(init.text))])]);
}

// Exported for src/edit/pptx/table.ts's own PptxTableCell.setParagraphs -- a:tc's own a:txBody holds the identical a:p/a:r/a:rPr/a:t content model a p:sp's own p:txBody does (ECMA-376 CT_TextBody is shared), so a table cell's paragraphs are built through this exact same function rather than a second implementation.
export function buildDrawingParagraph(init: DrawingParagraphInit): XmlElement {
  const pPrAttrs: Record<string, string> = {};
  if (init.alignment !== undefined) {
    pPrAttrs.algn = ALIGNMENT_TO_ALGN[init.alignment];
  }
  if (init.indentLeftPt !== undefined) {
    pPrAttrs.marL = String(ptToEmu(init.indentLeftPt)); // a:pPr/@marL is in EMU (ECMA-376 21.1.2.2.4), matching ooxml.js's own readParagraph (typed/pptx/read.ts), which divides @marL by EMU_PER_POINT.
  }
  if (init.indentFirstLinePt !== undefined) {
    pPrAttrs.indent = String(ptToEmu(init.indentFirstLinePt)); // a:pPr/@indent is in EMU and may be negative (a hanging indent), matching the read direction's own emuToPt(Number(indent)).
  }
  // CT_TextParagraphProperties element order is lnSpc, spcBef, spcAft (ECMA-376 21.1.2.2.4) -- emit in that sequence so a real consumer never sees the schema's ordered content model violated.
  const pPrChildren: XmlNode[] = [];
  if (init.lineSpacing !== undefined) {
    pPrChildren.push(el('a:lnSpc', {}, [el('a:spcPct', { val: String(Math.round(init.lineSpacing * LINE_SPACING_PERCENT_PER_MULTIPLIER)) })]));
  }
  if (init.spacingBeforePt !== undefined) {
    pPrChildren.push(el('a:spcBef', {}, [el('a:spcPts', { val: String(Math.round(init.spacingBeforePt * SPACING_POINTS_PER_POINT)) })]));
  }
  if (init.spacingAfterPt !== undefined) {
    pPrChildren.push(el('a:spcAft', {}, [el('a:spcPts', { val: String(Math.round(init.spacingAfterPt * SPACING_POINTS_PER_POINT)) })]));
  }
  const children: XmlNode[] = [];
  if (Object.keys(pPrAttrs).length > 0 || pPrChildren.length > 0) {
    children.push(el('a:pPr', pPrAttrs, pPrChildren));
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
