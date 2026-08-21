import type { Package } from '../../model/package';
import type { XmlElement } from '../../model/node';
import type { Box, Color } from 'document-schema.js';
import { rgbHexToColor } from 'document-schema.js';
import { sniffImageFormat, type ImageFormat } from '../../image/sniff';
import { base64ToBytes } from '../../util/base64';
import type { ColorTransform } from './color';
import { applyColorTransforms } from './color';
import { emuToPt } from './units';
import type { Relationship } from '../util';
import { attr, childrenWithTag, elementsWithTag } from '../util';

// Shared DrawingML (the `a:` namespace) primitives -- xfrm geometry, colour/theme resolution, blip media resolution -- used by the pptx shape tree (src/typed/pptx/*), the xlsx drawing layer (src/typed/xlsx/drawings.ts), and docx (src/typed/docx/*, for theme font/colour resolution in the style cascade). Nothing here knows about WordprocessingML, PresentationML, or SpreadsheetML structure specifically. Ported from documents.js's src/ooxml/drawingml.ts.

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

// The media bytes a blip names: the sniffed container format plus the part's own base64, ready to become a ContentImageBlock/ContentSheetImage's format/base64 pair.
export interface BlipMedia {
  readonly format: ImageFormat;
  readonly base64: string;
}

// Resolves the first a:blip/@r:embed anywhere under parent (a p:pic's own p:blipFill, an xdr:pic's xdr:blipFill, an OLE object's fallback p:pic nested inside mc:AlternateContent) through the OWNING part's relationships to the sniffed media part -- undefined when the id, relationship, part, or magic bytes don't line up, leaving the caller with no image content. The format always comes from the bytes themselves, never from the media part's file extension.
export function resolveBlipMedia(parent: XmlElement, rels: ReadonlyMap<string, Relationship>, pkg: Package): BlipMedia | undefined {
  const blip = elementsWithTag([parent], 'a:blip')[0];
  const rId = blip === undefined ? undefined : attr(blip, 'r:embed');
  const rel = rId === undefined ? undefined : rels.get(rId);
  const mediaPart = rel === undefined ? undefined : pkg.parts[rel.target];
  if (mediaPart?.kind !== 'binary') {
    return undefined;
  }
  const format = sniffImageFormat(base64ToBytes(mediaPart.base64));
  return format === undefined ? undefined : { format, base64: mediaPart.base64 };
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

// A group shape's own a:xfrm carries two rectangles: off/ext (the group's position/size in its PARENT's coordinate space) and chOff/chExt (the coordinate space its own children's off/ext values are expressed in, often a completely different scale/origin), plus the group's own rotation and flip flags -- all four of which a nested child must be composed through correctly. The off/ext/chOff/chExt half of this is verified against Apache POI's DrawGroupShape (translate to interior-relative coordinates, scale by exterior/interior size ratio, translate to the exterior position); the rot/flipH/flipV half follows the same "flip about centre, then rotate about that same centre, then translate to off" model an ordinary (non-group) shape's own a:xfrm/@rot/@flipH/@flipV already uses -- see composeGroupTransform and applyGroupTransform below for the derivation and the reflection/rotation identities it rests on.
export interface GroupOwnXfrm {
  readonly offXPt: number;
  readonly offYPt: number;
  readonly extWidthPt: number;
  readonly extHeightPt: number;
  readonly childOffXPt: number;
  readonly childOffYPt: number;
  readonly childExtWidthPt: number;
  readonly childExtHeightPt: number;
  // This group's own a:xfrm/@rot/@flipH/@flipV, unmodified by any ancestor group.
  readonly rotationDeg: number;
  readonly flipH: boolean;
  readonly flipV: boolean;
}

// Reads a group shape's a:xfrm: its own off/ext/rot/flipH/flipV plus its chOff/chExt, all converted to points/degrees. Undefined if `xfrm` lacks a chOff/chExt pair -- a regular (non-group) shape's a:xfrm never has one, so this doubles as "is this actually a group transform".
export function readGroupXfrm(xfrm: XmlElement | undefined): GroupOwnXfrm | undefined {
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
    rotationDeg: base.rotationDeg,
    flipH: base.flipH,
    flipV: base.flipV,
  };
}

// The fully composed transform needed to place a shape or nested group sitting directly in THIS group's own child (chOff/chExt) coordinate space into whatever coordinate space `offXPt`/`offYPt`/`extWidthPt`/`extHeightPt` are themselves already expressed in (the slide's space, once composed all the way up). `compositeRotationDeg`/`compositeMirrored` fold this group's own a:xfrm/@rot/@flipH/@flipV together with everything contributed by this group's own ancestor groups -- see composeGroupTransform's doc comment.
export interface GroupChildTransform {
  readonly offXPt: number;
  readonly offYPt: number;
  readonly extWidthPt: number;
  readonly extHeightPt: number;
  readonly childOffXPt: number;
  readonly childOffYPt: number;
  readonly childExtWidthPt: number;
  readonly childExtHeightPt: number;
  readonly compositeRotationDeg: number;
  readonly compositeMirrored: boolean;
}

function normalizeDeg(deg: number): number {
  const mod = deg % 360;
  return mod < 0 ? mod + 360 : mod;
}

// Canonicalises a group's own (rotationDeg, flipH, flipV) into a single (angleDeg, mirrored) pair representing the linear map M = R(angleDeg) . (Fh if mirrored else I), where R(theta) is ECMA-376's own clockwise rotation and Fh = diag(-1, 1) (a mirror across the vertical axis). Two flips cancel to a pure rotation rather than compounding into a further mirror, since Fh . Fv = diag(-1,-1) = R(180 deg); a lone flipV is restated in terms of the canonical Fh axis via the identity Fv = R(180 deg) . Fh (both verified by direct 2x2 matrix multiplication): flipH && flipV -> R(rot).Fh.Fv = R(rot).R(180) = R(rot+180), no residual mirror; flipV only -> R(rot).Fv = R(rot).R(180).Fh = R(rot+180).Fh, mirrored; flipH only -> R(rot).Fh, mirrored; neither -> R(rot), not mirrored.
function canonicalizeGroupRotation(rotationDeg: number, flipH: boolean, flipV: boolean): { readonly angleDeg: number; readonly mirrored: boolean } {
  if (flipH && flipV) {
    return { angleDeg: rotationDeg + 180, mirrored: false };
  }
  if (flipV) {
    return { angleDeg: rotationDeg + 180, mirrored: true };
  }
  if (flipH) {
    return { angleDeg: rotationDeg, mirrored: true };
  }
  return { angleDeg: rotationDeg, mirrored: false };
}

// Composes an OUTER linear map A = R(outer.angleDeg) . (Fh if outer.mirrored) with an INNER linear map B = R(inner.angleDeg) . (Fh if inner.mirrored) that is applied FIRST, giving C = A . B, decomposed back into the same (angleDeg, mirrored) representation. Derived from the reflection/rotation commutation identity Fh . R(theta) = R(-theta) . Fh (verified by direct 2x2 matrix multiplication: both sides equal [[-cos(theta), sin(theta)], [sin(theta), cos(theta)]]): outer not mirrored -> C = R(outerAngle).R(innerAngle).F_inner = R(outerAngle+innerAngle).F_inner; outer mirrored -> C = R(outerAngle).Fh.R(innerAngle).F_inner = R(outerAngle).R(-innerAngle).Fh.F_inner [since Fh.R(innerAngle) = R(-innerAngle).Fh] = R(outerAngle-innerAngle).(Fh.F_inner), so a mirrored outer flips whether the result is mirrored (Fh.Fh=I cancels; Fh.I stays mirrored) AND subtracts the inner angle instead of adding it -- this is the concrete "an ancestor group's flip negates the sense of a descendant's own rotation" rule.
function composeRotation(
  outer: { readonly angleDeg: number; readonly mirrored: boolean },
  inner: { readonly angleDeg: number; readonly mirrored: boolean },
): { readonly angleDeg: number; readonly mirrored: boolean } {
  if (!outer.mirrored) {
    return { angleDeg: normalizeDeg(outer.angleDeg + inner.angleDeg), mirrored: inner.mirrored };
  }
  return { angleDeg: normalizeDeg(outer.angleDeg - inner.angleDeg), mirrored: !inner.mirrored };
}

// Folds a nested group's own raw xfrm (`own`) into whatever composite transform its enclosing group already carries (`parent`, undefined at the top of the shape tree, in which case `own`'s off/ext are already expressed in slide space and its own rotation/flip is the entire composite). `own`'s off/ext live in `parent`'s own child coordinate space, so they are mapped through `applyGroupTransform` exactly like an ordinary child would be -- position AND rotation/mirror both compose, since `own` is the INNER map (applied first, being the group closer to the eventual shape) and `parent`'s already-composed compositeRotationDeg/compositeMirrored is the OUTER map (composeRotation's own `outer` parameter).
export function composeGroupTransform(own: GroupOwnXfrm | undefined, parent: GroupChildTransform | undefined): GroupChildTransform | undefined {
  if (own === undefined) {
    return undefined;
  }
  const ownRotation = canonicalizeGroupRotation(own.rotationDeg, own.flipH, own.flipV);
  if (parent === undefined) {
    return {
      offXPt: own.offXPt,
      offYPt: own.offYPt,
      extWidthPt: own.extWidthPt,
      extHeightPt: own.extHeightPt,
      childOffXPt: own.childOffXPt,
      childOffYPt: own.childOffYPt,
      childExtWidthPt: own.childExtWidthPt,
      childExtHeightPt: own.childExtHeightPt,
      compositeRotationDeg: normalizeDeg(ownRotation.angleDeg),
      compositeMirrored: ownRotation.mirrored,
    };
  }
  const mapped = applyGroupTransform(parent, { xPt: own.offXPt, yPt: own.offYPt, widthPt: own.extWidthPt, heightPt: own.extHeightPt });
  const composite = composeRotation({ angleDeg: parent.compositeRotationDeg, mirrored: parent.compositeMirrored }, ownRotation);
  return {
    offXPt: mapped.xPt,
    offYPt: mapped.yPt,
    extWidthPt: mapped.widthPt,
    extHeightPt: mapped.heightPt,
    childOffXPt: own.childOffXPt,
    childOffYPt: own.childOffYPt,
    childExtWidthPt: own.childExtWidthPt,
    childExtHeightPt: own.childExtHeightPt,
    compositeRotationDeg: composite.angleDeg,
    compositeMirrored: composite.mirrored,
  };
}

// Maps a child's local (chOff/chExt-relative) frame into the group's parent coordinate space -- position AND, when the group carries a non-zero composite rotation or mirror (this group's own a:xfrm/@rot/@flipH/@flipV composed with its own ancestors, see composeGroupTransform), rotates/mirrors the mapped box's CENTRE about the group's own centre. Width/height are only ever scaled, never rotated: exactly like ContentShape.frame/rotationDeg elsewhere in this codebase, the returned Box is the shape's own UNROTATED extents, with orientation carried separately by whichever caller combines this group's own composite with the shape's local rotation (composeShapeRotationDeg, in src/typed/pptx/read.ts).
export function applyGroupTransform(group: GroupChildTransform, childFrame: Box): Box {
  const scaleX = group.childExtWidthPt === 0 ? 1 : group.extWidthPt / group.childExtWidthPt;
  const scaleY = group.childExtHeightPt === 0 ? 1 : group.extHeightPt / group.childExtHeightPt;
  const widthPt = childFrame.widthPt * scaleX;
  const heightPt = childFrame.heightPt * scaleY;
  const canonicalX = group.offXPt + (childFrame.xPt - group.childOffXPt) * scaleX;
  const canonicalY = group.offYPt + (childFrame.yPt - group.childOffYPt) * scaleY;
  if (group.compositeRotationDeg === 0 && !group.compositeMirrored) {
    return { xPt: canonicalX, yPt: canonicalY, widthPt, heightPt };
  }
  const groupCenterX = group.offXPt + group.extWidthPt / 2;
  const groupCenterY = group.offYPt + group.extHeightPt / 2;
  const boxCenterX = canonicalX + widthPt / 2;
  const boxCenterY = canonicalY + heightPt / 2;
  let dx = boxCenterX - groupCenterX;
  const dy = boxCenterY - groupCenterY;
  if (group.compositeMirrored) {
    dx = -dx; // mirror across the canonical Fh axis, matching canonicalizeGroupRotation's own convention
  }
  const rad = (group.compositeRotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rotatedX = dx * cos - dy * sin;
  const rotatedY = dx * sin + dy * cos;
  return { xPt: groupCenterX + rotatedX - widthPt / 2, yPt: groupCenterY + rotatedY - heightPt / 2, widthPt, heightPt };
}

// Resolves a shape or graphic frame's own final rotation (clockwise degrees) given its own local a:xfrm/@rot and the (possibly undefined) composite transform of whichever group encloses it. The shape's own rotation is the INNER map (applied first, with no mirror of its own to compose -- a shape's own flipH/flipV isn't folded into ContentShape's rotationDeg output either, a separate, pre-existing simplification this function doesn't change); the enclosing group's composite is the OUTER map.
export function composeShapeRotationDeg(parentTransform: GroupChildTransform | undefined, ownRotationDeg: number): number {
  if (parentTransform === undefined) {
    return normalizeDeg(ownRotationDeg);
  }
  return composeRotation({ angleDeg: parentTransform.compositeRotationDeg, mirrored: parentTransform.compositeMirrored }, { angleDeg: ownRotationDeg, mirrored: false }).angleDeg;
}
