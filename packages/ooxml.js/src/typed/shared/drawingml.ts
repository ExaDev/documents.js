import type { XmlElement } from '../../model/node';
import type { Box, Color } from 'document-content-model';
import { rgbHexToColor } from 'document-content-model';
import type { ColorTransform } from './color';
import { applyColorTransforms } from './color';
import { emuToPt } from './units';
import { attr, childrenWithTag, elementsWithTag } from '../util';

// Shared DrawingML (the `a:` namespace) primitives -- xfrm geometry, colour/theme resolution -- used by both the pptx shape tree (src/typed/pptx/*) and docx (src/typed/docx/*, for theme font/colour resolution in the style cascade). Nothing here knows about WordprocessingML or PresentationML structure specifically. Ported from documents.js's src/ooxml/drawingml.ts.

export interface DrawingXfrm {
  readonly xPt: number;
  readonly yPt: number;
  readonly widthPt: number;
  readonly heightPt: number;
  // Clockwise, per ECMA-376's own a:xfrm/@rot convention.
  readonly rotationDeg: number;
  readonly flipH: boolean;
  readonly flipV: boolean;
}

// a:xfrm/@rot is in 60,000ths of a degree (ECMA-376 Part 1, 20.1.7.6 CT_Transform2D).
const ROTATION_UNITS_PER_DEGREE = 60_000;

// Reads an a:xfrm element's position, size, rotation, and flip flags. Returns undefined if `xfrm` is absent or missing its required a:off/a:ext children -- callers (a placeholder-inheritance cascade, chiefly) are expected to fall back to an inherited xfrm in that case, not to substitute a default geometry themselves.
export function readXfrm(xfrm: XmlElement | undefined): DrawingXfrm | undefined {
  if (xfrm === undefined) {
    return undefined;
  }
  const off = childrenWithTag(xfrm, 'a:off')[0];
  const ext = childrenWithTag(xfrm, 'a:ext')[0];
  if (off === undefined || ext === undefined) {
    return undefined;
  }
  const x = attr(off, 'x');
  const y = attr(off, 'y');
  const cx = attr(ext, 'cx');
  const cy = attr(ext, 'cy');
  if (x === undefined || y === undefined || cx === undefined || cy === undefined) {
    return undefined;
  }
  const rot = attr(xfrm, 'rot');
  return {
    xPt: emuToPt(Number(x)),
    yPt: emuToPt(Number(y)),
    widthPt: emuToPt(Number(cx)),
    heightPt: emuToPt(Number(cy)),
    rotationDeg: rot === undefined ? 0 : Number(rot) / ROTATION_UNITS_PER_DEGREE,
    flipH: attr(xfrm, 'flipH') === '1',
    flipV: attr(xfrm, 'flipV') === '1',
  };
}

// The twelve named slots of an a:clrScheme, in the exact tag names ECMA-376 defines (each is its own element, e.g. <a:dk1>, wrapping a single a:srgbClr or a:sysClr child).
const CLR_SCHEME_SLOTS = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'] as const;

function readThemeSlotColor(colorEl: XmlElement): Color | undefined {
  if (colorEl.tag === 'a:srgbClr') {
    const val = attr(colorEl, 'val');
    return val === undefined ? undefined : rgbHexToColor(val);
  }
  if (colorEl.tag === 'a:sysClr') {
    // lastClr is the cached, actual RGB value a producer resolved the system colour keyword to at save time -- almost always present, and the only reliable source, since resolving 'windowText'/'window' to a real colour otherwise requires OS theme context this reader doesn't have. Falls back to the two conventional PowerPoint values for these keywords specifically, not an arbitrary guess.
    const lastClr = attr(colorEl, 'lastClr');
    if (lastClr !== undefined) {
      return rgbHexToColor(lastClr);
    }
    return attr(colorEl, 'val') === 'window' ? { r: 1, g: 1, b: 1 } : { r: 0, g: 0, b: 0 };
  }
  return undefined;
}

function readClrScheme(clrSchemeEl: XmlElement): Map<string, Color> {
  const map = new Map<string, Color>();
  for (const slot of CLR_SCHEME_SLOTS) {
    const wrapper = childrenWithTag(clrSchemeEl, `a:${slot}`)[0];
    if (wrapper === undefined) {
      continue;
    }
    const colorEl = wrapper.children.find((c): c is XmlElement => c.type === 'element');
    if (colorEl === undefined) {
      continue;
    }
    const color = readThemeSlotColor(colorEl);
    if (color !== undefined) {
      map.set(slot, color);
    }
  }
  return map;
}

function readSchemeFont(fontSchemeEl: XmlElement | undefined, tag: 'a:majorFont' | 'a:minorFont'): string | undefined {
  if (fontSchemeEl === undefined) {
    return undefined;
  }
  const fontEl = childrenWithTag(fontSchemeEl, tag)[0];
  const latin = fontEl === undefined ? undefined : childrenWithTag(fontEl, 'a:latin')[0];
  return latin === undefined ? undefined : attr(latin, 'typeface');
}

// Word/PowerPoint's own long-standing built-in default theme font, used only when a theme part is missing or its font scheme is malformed -- not a stylistic choice, a documented fallback of last resort.
const DEFAULT_THEME_FONT = 'Calibri';

export interface DrawingTheme {
  readonly colorScheme: ReadonlyMap<string, Color>;
  readonly majorFont: string;
  readonly minorFont: string;
}

export const EMPTY_THEME: DrawingTheme = { colorScheme: new Map(), majorFont: DEFAULT_THEME_FONT, minorFont: DEFAULT_THEME_FONT };

// Reads a:clrScheme and a:fontScheme from a theme part's root element (a:theme), wherever they sit under a:themeElements -- searched by descendant tag rather than a fixed child path, since that's the only detail of a:themeElements' own structure this reader actually needs.
export function readTheme(themeRoot: XmlElement): DrawingTheme {
  const clrSchemeEl = elementsWithTag([themeRoot], 'a:clrScheme')[0];
  const colorScheme = clrSchemeEl === undefined ? new Map<string, Color>() : readClrScheme(clrSchemeEl);
  const fontSchemeEl = elementsWithTag([themeRoot], 'a:fontScheme')[0];
  return {
    colorScheme,
    majorFont: readSchemeFont(fontSchemeEl, 'a:majorFont') ?? DEFAULT_THEME_FONT,
    minorFont: readSchemeFont(fontSchemeEl, 'a:minorFont') ?? DEFAULT_THEME_FONT,
  };
}

// Resolves a theme font reference ('+mj-lt'/'+mn-lt', as commonly found in a:latin/@typeface) to the theme's actual major/minor Latin typeface name; any other string (a literal font name) passes through unchanged.
export function resolveThemeFontReference(typeface: string, theme: DrawingTheme): string {
  if (typeface === '+mj-lt') {
    return theme.majorFont;
  }
  if (typeface === '+mn-lt') {
    return theme.minorFont;
  }
  return typeface;
}

// p:clrMap's own attributes ARE the mapping (e.g. bg1="lt1" tx1="dk1"): read generically rather than naming each of the twelve expected attributes, since the element's shape is exactly "read every attribute" with no other content.
export function readColorMap(clrMapEl: XmlElement | undefined): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  if (clrMapEl === undefined) {
    return map;
  }
  for (const a of clrMapEl.attributes) {
    map.set(a.name, a.value);
  }
  return map;
}

// a:schemeClr/@val is either one of the twelve raw theme slot names (dk1/lt1/dk2/lt2/accent1-6/hlink/folHlink, used directly) or one of the four "logical" names (bg1/tx1/bg2/tx2) that only resolve to a slot via the master's own p:clrMap -- clrMap's keys are exactly those four (plus the eight who map to themselves), so a plain lookup with the original value as fallback handles both cases in one line.
export function resolveSchemeColorSlot(schemeVal: string, colorMap: ReadonlyMap<string, string>): string {
  return colorMap.get(schemeVal) ?? schemeVal;
}

const COLOR_TRANSFORM_TAGS: ReadonlyMap<string, ColorTransform['kind']> = new Map([
  ['a:shade', 'shade'],
  ['a:tint', 'tint'],
  ['a:lumMod', 'lumMod'],
  ['a:lumOff', 'lumOff'],
]);

function readColorTransforms(container: XmlElement): ColorTransform[] {
  const transforms: ColorTransform[] = [];
  for (const child of container.children) {
    if (child.type !== 'element') {
      continue;
    }
    const kind = COLOR_TRANSFORM_TAGS.get(child.tag);
    if (kind === undefined) {
      continue;
    }
    const val = attr(child, 'val');
    if (val === undefined) {
      continue;
    }
    transforms.push({ kind, value: Number(val) });
  }
  return transforms;
}

// Resolves an a:schemeClr element (val + any shade/tint/lumMod/lumOff children) against the given colour map and theme. Undefined if the val is missing or the resolved slot has no entry in the theme's colour scheme.
export function readSchemeColor(schemeClrEl: XmlElement, colorMap: ReadonlyMap<string, string>, theme: DrawingTheme): Color | undefined {
  const val = attr(schemeClrEl, 'val');
  if (val === undefined) {
    return undefined;
  }
  const base = theme.colorScheme.get(resolveSchemeColorSlot(val, colorMap));
  return base === undefined ? undefined : applyColorTransforms(base, readColorTransforms(schemeClrEl));
}

// Resolves an a:srgbClr element (val + any shade/tint/lumMod/lumOff children).
export function readSrgbColor(srgbClrEl: XmlElement): Color | undefined {
  const val = attr(srgbClrEl, 'val');
  return val === undefined ? undefined : applyColorTransforms(rgbHexToColor(val), readColorTransforms(srgbClrEl));
}

// Resolves an a:solidFill wrapper (containing either a:schemeClr or a:srgbClr) to a concrete colour. Other fill child kinds (a:prstClr, a:hslClr, a:scrgbClr, a:sysClr as a direct fill rather than inside a theme slot) are rare in real text-run fills and are not resolved here.
export function readSolidFillColor(solidFillEl: XmlElement | undefined, colorMap: ReadonlyMap<string, string>, theme: DrawingTheme): Color | undefined {
  if (solidFillEl === undefined) {
    return undefined;
  }
  const schemeClr = childrenWithTag(solidFillEl, 'a:schemeClr')[0];
  if (schemeClr !== undefined) {
    return readSchemeColor(schemeClr, colorMap, theme);
  }
  const srgbClr = childrenWithTag(solidFillEl, 'a:srgbClr')[0];
  return srgbClr === undefined ? undefined : readSrgbColor(srgbClr);
}

// A group shape's own a:xfrm carries two rectangles: off/ext (the group's position/size in its PARENT's coordinate space) and chOff/chExt (the coordinate space its own children's off/ext values are expressed in, often a completely different scale/origin). Mapping a child's local frame into the parent space is ECMA-376's own group-transform algorithm -- verified against Apache POI's DrawGroupShape (translate to interior-relative coordinates, scale by exterior/interior size ratio, translate to the exterior position), a mature, independent OOXML rendering implementation.
export interface GroupChildTransform {
  readonly offXPt: number;
  readonly offYPt: number;
  readonly extWidthPt: number;
  readonly extHeightPt: number;
  readonly childOffXPt: number;
  readonly childOffYPt: number;
  readonly childExtWidthPt: number;
  readonly childExtHeightPt: number;
}

// Reads a group shape's a:xfrm (its own off/ext plus its chOff/chExt), all converted to points. Undefined if `xfrm` lacks a chOff/chExt pair -- a regular (non-group) shape's a:xfrm never has one, so this doubles as "is this actually a group transform".
export function readGroupXfrm(xfrm: XmlElement | undefined): GroupChildTransform | undefined {
  const base = readXfrm(xfrm);
  if (base === undefined || xfrm === undefined) {
    return undefined;
  }
  const chOff = childrenWithTag(xfrm, 'a:chOff')[0];
  const chExt = childrenWithTag(xfrm, 'a:chExt')[0];
  if (chOff === undefined || chExt === undefined) {
    return undefined;
  }
  const cx = attr(chOff, 'x');
  const cy = attr(chOff, 'y');
  const ccx = attr(chExt, 'cx');
  const ccy = attr(chExt, 'cy');
  if (cx === undefined || cy === undefined || ccx === undefined || ccy === undefined) {
    return undefined;
  }
  return {
    offXPt: base.xPt,
    offYPt: base.yPt,
    extWidthPt: base.widthPt,
    extHeightPt: base.heightPt,
    childOffXPt: emuToPt(Number(cx)),
    childOffYPt: emuToPt(Number(cy)),
    childExtWidthPt: emuToPt(Number(ccx)),
    childExtHeightPt: emuToPt(Number(ccy)),
  };
}

// Maps a child shape's own local (chOff/chExt-relative) frame into the group's parent coordinate space.
export function applyGroupTransform(group: GroupChildTransform, childFrame: Box): Box {
  const scaleX = group.childExtWidthPt === 0 ? 1 : group.extWidthPt / group.childExtWidthPt;
  const scaleY = group.childExtHeightPt === 0 ? 1 : group.extHeightPt / group.childExtHeightPt;
  return {
    xPt: group.offXPt + (childFrame.xPt - group.childOffXPt) * scaleX,
    yPt: group.offYPt + (childFrame.yPt - group.childOffYPt) * scaleY,
    widthPt: childFrame.widthPt * scaleX,
    heightPt: childFrame.heightPt * scaleY,
  };
}
