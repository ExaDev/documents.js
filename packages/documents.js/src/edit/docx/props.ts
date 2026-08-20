import type { XmlElement } from 'ooxml.js';
import { attr } from 'ooxml.js';
import type { Color as LayoutColor } from 'document-schema.js';
import { colorToRgbHex, rgbHexToColor } from 'document-schema.js';
import { halfPointsToPt, ptToHalfPoints } from '../../model/units';
import { directChildElement, getOrCreateChildElement, insertInSchemaOrder, removeAttr, setAttr } from '../../xml/edit';
import { el } from '../../xml/fragment';

// Order constants derived from ECMA-376's CT_RPr / CT_PPr content models (abbreviated to the properties this editor supports, in their true relative sequence) -- Word rejects a file whose child element sequence violates these, so every property setter below inserts via insertInSchemaOrder (src/xml/edit.ts), never by appending.
export const RPR_ORDER: readonly string[] = [
  'w:rStyle',
  'w:rFonts',
  'w:b',
  'w:bCs',
  'w:i',
  'w:iCs',
  'w:strike',
  'w:color',
  'w:sz',
  'w:szCs',
  'w:u',
];

// w:outlineLvl sits between w:jc and w:rPr in CT_PPrGeneral's own sequence (the order Word enforces), so it belongs in this editor's ordering table the moment any writer can emit it.
export const PPR_ORDER: readonly string[] = ['w:pStyle', 'w:numPr', 'w:spacing', 'w:ind', 'w:jc', 'w:outlineLvl', 'w:rPr'];

// w:rPr must always be the first child of w:r (CT_R), and w:pPr must always be the first child of w:p (CT_P) -- a fixed-prefix invariant distinct from (and simpler than) the ordering *among* sibling properties that insertInSchemaOrder handles, so it gets its own dedicated helper rather than being folded into RPR_ORDER/PPR_ORDER (which order properties *within* rPr/pPr, not rPr/pPr's own position among w:r's or w:p's other children).
export function ensureFirstChild(parent: XmlElement, tag: string): XmlElement {
  const existing = directChildElement(parent, tag);
  if (existing !== undefined) {
    return existing;
  }
  const created = el(tag);
  parent.children.unshift(created);
  return created;
}

const TOGGLE_OFF_VALUES = new Set(['0', 'false', 'off']);

// A toggle property (w:b, w:i, w:strike, w:u's presence form) reflects only this run/paragraph's OWN direct formatting, not the fully style-cascaded effective value -- resolving the cascade is ooxml.js's readDocxContent's job, for the conversion pipeline; this editor is a direct-formatting view, matching how the DocxRun/DocxParagraph API is documented.
export function getToggle(propsElement: XmlElement | undefined, tag: string): boolean {
  if (propsElement === undefined) {
    return false;
  }
  const element = directChildElement(propsElement, tag);
  if (element === undefined) {
    return false;
  }
  const val = attr(element, 'w:val');
  return val === undefined || !TOGGLE_OFF_VALUES.has(val.toLowerCase());
}

// Always writes an explicit w:val="0" when turning a toggle off (rather than omitting the element), so the direct formatting unambiguously overrides anything an inherited style might set -- an editor with no cascade awareness of its own cannot otherwise guarantee "off" actually means off.
export function setToggle(propsElement: XmlElement, tag: string, value: boolean, order: readonly string[]): void {
  const existing = directChildElement(propsElement, tag);
  if (existing === undefined) {
    const created = el(tag, value ? {} : { 'w:val': '0' });
    insertInSchemaOrder(propsElement, created, order);
    return;
  }
  if (value) {
    removeAttr(existing, 'w:val');
  } else {
    setAttr(existing, 'w:val', '0');
  }
}

export function getFontFamily(rPr: XmlElement | undefined): string | undefined {
  if (rPr === undefined) {
    return undefined;
  }
  const rFonts = directChildElement(rPr, 'w:rFonts');
  return rFonts === undefined ? undefined : attr(rFonts, 'w:ascii');
}

export function setFontFamily(rPr: XmlElement, family: string): void {
  const rFonts = getOrCreateChildElement(rPr, 'w:rFonts', RPR_ORDER, () => el('w:rFonts'));
  setAttr(rFonts, 'w:ascii', family);
  setAttr(rFonts, 'w:hAnsi', family);
}

export function getSizePt(rPr: XmlElement | undefined): number | undefined {
  if (rPr === undefined) {
    return undefined;
  }
  const sz = directChildElement(rPr, 'w:sz');
  if (sz === undefined) {
    return undefined;
  }
  const val = attr(sz, 'w:val');
  return val === undefined ? undefined : halfPointsToPt(Number.parseInt(val, 10));
}

export function setSizePt(rPr: XmlElement, sizePt: number): void {
  const halfPoints = String(ptToHalfPoints(sizePt));
  const sz = getOrCreateChildElement(rPr, 'w:sz', RPR_ORDER, () => el('w:sz'));
  setAttr(sz, 'w:val', halfPoints);
  const szCs = getOrCreateChildElement(rPr, 'w:szCs', RPR_ORDER, () => el('w:szCs'));
  setAttr(szCs, 'w:val', halfPoints);
}

export function getColor(rPr: XmlElement | undefined): LayoutColor | undefined {
  if (rPr === undefined) {
    return undefined;
  }
  const color = directChildElement(rPr, 'w:color');
  if (color === undefined) {
    return undefined;
  }
  const val = attr(color, 'w:val');
  if (val === undefined || val.toLowerCase() === 'auto') {
    return undefined;
  }
  return rgbHexToColor(val);
}

export function setColor(rPr: XmlElement, color: LayoutColor): void {
  const element = getOrCreateChildElement(rPr, 'w:color', RPR_ORDER, () => el('w:color'));
  setAttr(element, 'w:val', colorToRgbHex(color));
}

export function getStyleId(propsElement: XmlElement | undefined, tag: 'w:pStyle' | 'w:rStyle'): string | undefined {
  if (propsElement === undefined) {
    return undefined;
  }
  const element = directChildElement(propsElement, tag);
  return element === undefined ? undefined : attr(element, 'w:val');
}

export function setStyleId(
  propsElement: XmlElement,
  tag: 'w:pStyle' | 'w:rStyle',
  styleId: string,
  order: readonly string[],
): void {
  const element = getOrCreateChildElement(propsElement, tag, order, () => el(tag));
  setAttr(element, 'w:val', styleId);
}

export function getAlignment(pPr: XmlElement | undefined): 'left' | 'center' | 'right' | 'justify' | undefined {
  if (pPr === undefined) {
    return undefined;
  }
  const jc = directChildElement(pPr, 'w:jc');
  if (jc === undefined) {
    return undefined;
  }
  const val = attr(jc, 'w:val');
  if (val === 'left') {
    return 'left';
  }
  if (val === 'center') {
    return 'center';
  }
  if (val === 'right') {
    return 'right';
  }
  if (val === 'both') {
    return 'justify';
  }
  return undefined;
}

export function setAlignment(pPr: XmlElement, alignment: 'left' | 'center' | 'right' | 'justify'): void {
  const jc = getOrCreateChildElement(pPr, 'w:jc', PPR_ORDER, () => el('w:jc'));
  setAttr(jc, 'w:val', alignment === 'justify' ? 'both' : alignment);
}
