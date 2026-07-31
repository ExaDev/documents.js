import type { XmlElement } from '../../model/node';
import type { Alignment, Color } from 'document-content-model';
import { rgbHexToColor } from 'document-content-model';
import { halfPointsToPt, lineUnitsToMultiplier, twipsToPt } from '../shared/units';
import type { DrawingTheme } from '../shared/drawingml';
import { attr, childrenWithTag, elementsWithTag } from '../util';

// The WordprocessingML style cascade: docDefaults -> the default paragraph/character style -> a paragraph or run's own named style resolved through its w:basedOn chain (root-first, cycle-guarded) -> the paragraph's own direct w:pPr/w:rPr. Skipping the paragraph-mark run properties (w:pPr/w:rPr, a run-level baseline every run in the paragraph inherits before its own character style/direct formatting) is exactly why naive converters render headings at body size -- ECMA-376 defines it as part of CT_PPr precisely so a paragraph style like "Heading1" can set a heading-sized default for runs that don't override it themselves. Ported from documents.js's src/ooxml/docx/styles.ts.
//
// DocxStyleContext/ResolvedParagraphProperties/ResolvedRunProperties are internal cascade-resolution types, not part of DocxDocument's own published shape -- they carry a DrawingTheme (itself holding a Map, not a natural Zod target) and exist only to thread state through the resolve* functions below, so (matching documents.js's own choice) they stay plain TypeScript interfaces rather than Zod-schema'd model types.

export interface DocxStyleContext {
  readonly stylesRoot: XmlElement | undefined;
  readonly theme: DrawingTheme;
}

export interface ResolvedParagraphProperties {
  readonly alignment?: Alignment;
  readonly spacingBeforePt?: number;
  readonly spacingAfterPt?: number;
  readonly lineSpacing?: number;
  readonly indentLeftPt?: number;
  readonly indentFirstLinePt?: number;
}

export interface ResolvedRunProperties {
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly strike?: boolean;
  readonly fontFamily?: string;
  readonly sizePt?: number;
  readonly color?: Color;
}

function mergeParagraphLayer(base: ResolvedParagraphProperties, layer: ResolvedParagraphProperties): ResolvedParagraphProperties {
  return {
    alignment: layer.alignment ?? base.alignment,
    spacingBeforePt: layer.spacingBeforePt ?? base.spacingBeforePt,
    spacingAfterPt: layer.spacingAfterPt ?? base.spacingAfterPt,
    lineSpacing: layer.lineSpacing ?? base.lineSpacing,
    indentLeftPt: layer.indentLeftPt ?? base.indentLeftPt,
    indentFirstLinePt: layer.indentFirstLinePt ?? base.indentFirstLinePt,
  };
}

function mergeRunLayer(base: ResolvedRunProperties, layer: ResolvedRunProperties): ResolvedRunProperties {
  return {
    bold: layer.bold ?? base.bold,
    italic: layer.italic ?? base.italic,
    underline: layer.underline ?? base.underline,
    strike: layer.strike ?? base.strike,
    fontFamily: layer.fontFamily ?? base.fontFamily,
    sizePt: layer.sizePt ?? base.sizePt,
    color: layer.color ?? base.color,
  };
}

// A WordprocessingML toggle property (w:b, w:i, w:strike, ...) is ON by simply being present, with an optional w:val attribute that turns it back OFF ("0"/"false"/"off"). Absence of the element itself means "not specified at this layer", not "off" -- that distinction is exactly what lets a lower cascade layer's off-by-inheritance be overridden by a higher layer's on, or vice versa.
function readToggle(el: XmlElement | undefined): boolean | undefined {
  if (el === undefined) {
    return undefined;
  }
  const val = attr(el, 'w:val');
  return val === undefined || (val !== '0' && val !== 'false' && val !== 'off');
}

// w:u/@w:val is one of many underline styles (single/double/thick/dotted/...); "none" is the only value that means off. Unlike the toggle properties above, w:u always carries @w:val -- there's no bare-presence-means-on form.
function readUnderline(u: XmlElement | undefined): boolean | undefined {
  if (u === undefined) {
    return undefined;
  }
  const val = attr(u, 'w:val');
  return val !== undefined && val !== 'none';
}

// w:color/@w:val is a 6-hex-digit RGB string or the literal "auto" (the automatic/theme-inherited colour, almost always rendering as black-on-white in practice). "auto" defers to a lower-priority layer rather than asserting black outright, since a lower layer (or the final default) may already resolve to the right colour. w:themeColor (docx's own, DrawingML-independent theme-colour-reference enum) is not resolved -- real-world runs overwhelmingly use direct w:val hex rather than theme references.
function readRunColor(colorEl: XmlElement | undefined): Color | undefined {
  if (colorEl === undefined) {
    return undefined;
  }
  const val = attr(colorEl, 'w:val');
  return val === undefined || val === 'auto' ? undefined : rgbHexToColor(val);
}

// w:ascii (a literal font name) takes precedence over w:asciiTheme (a theme font reference) when both are present, per ECMA-376's own precedence rule. Only the Latin (ascii/asciiTheme) slot is read -- East Asian/complex-script fonts are out of scope.
function readRunFontFamily(rFonts: XmlElement | undefined, theme: DrawingTheme): string | undefined {
  if (rFonts === undefined) {
    return undefined;
  }
  const ascii = attr(rFonts, 'w:ascii');
  if (ascii !== undefined) {
    return ascii;
  }
  const asciiTheme = attr(rFonts, 'w:asciiTheme');
  if (asciiTheme === 'majorHAnsi' || asciiTheme === 'majorAscii') {
    return theme.majorFont;
  }
  if (asciiTheme === 'minorHAnsi' || asciiTheme === 'minorAscii') {
    return theme.minorFont;
  }
  return undefined;
}

function readRunPropertiesLayer(rPr: XmlElement | undefined, theme: DrawingTheme): ResolvedRunProperties {
  if (rPr === undefined) {
    return {};
  }
  const sz = childrenWithTag(rPr, 'w:sz')[0];
  const szVal = sz === undefined ? undefined : attr(sz, 'w:val');
  return {
    bold: readToggle(childrenWithTag(rPr, 'w:b')[0]),
    italic: readToggle(childrenWithTag(rPr, 'w:i')[0]),
    underline: readUnderline(childrenWithTag(rPr, 'w:u')[0]),
    strike: readToggle(childrenWithTag(rPr, 'w:strike')[0]),
    fontFamily: readRunFontFamily(childrenWithTag(rPr, 'w:rFonts')[0], theme),
    sizePt: szVal === undefined ? undefined : halfPointsToPt(Number(szVal)),
    color: readRunColor(childrenWithTag(rPr, 'w:color')[0]),
  };
}

function readAlignment(jc: XmlElement | undefined): Alignment | undefined {
  const val = jc === undefined ? undefined : attr(jc, 'w:val');
  if (val === 'left' || val === 'start') {
    return 'left';
  }
  if (val === 'center') {
    return 'center';
  }
  if (val === 'right' || val === 'end') {
    return 'right';
  }
  if (val === 'both' || val === 'distribute') {
    return 'justify';
  }
  return undefined;
}

// w:ind's firstLine (positive: indented further than the body) and hanging (positive value meaning "pull back by this much", i.e. a negative first-line indent) are mutually exclusive per ECMA-376; hanging is stored as the signed inverse to match ContentParagraph.indentFirstLinePt's own convention (negative for a hanging/bullet indent).
function readParagraphPropertiesLayer(pPr: XmlElement | undefined): ResolvedParagraphProperties {
  if (pPr === undefined) {
    return {};
  }
  const spacing = childrenWithTag(pPr, 'w:spacing')[0];
  const before = spacing === undefined ? undefined : attr(spacing, 'w:before');
  const after = spacing === undefined ? undefined : attr(spacing, 'w:after');
  const line = spacing === undefined ? undefined : attr(spacing, 'w:line');
  const lineRule = spacing === undefined ? undefined : attr(spacing, 'w:lineRule');
  const ind = childrenWithTag(pPr, 'w:ind')[0];
  const left = ind === undefined ? undefined : (attr(ind, 'w:left') ?? attr(ind, 'w:start'));
  const firstLine = ind === undefined ? undefined : attr(ind, 'w:firstLine');
  const hanging = ind === undefined ? undefined : attr(ind, 'w:hanging');
  return {
    alignment: readAlignment(childrenWithTag(pPr, 'w:jc')[0]),
    spacingBeforePt: before === undefined ? undefined : twipsToPt(Number(before)),
    spacingAfterPt: after === undefined ? undefined : twipsToPt(Number(after)),
    // Only lineRule="auto" (the default when lineRule is absent) expresses w:line as a multiplier of single spacing; "exact"/"atLeast" express it as an absolute twips height, a different unit this field doesn't model.
    lineSpacing: line === undefined || lineRule === 'exact' || lineRule === 'atLeast' ? undefined : lineUnitsToMultiplier(Number(line)),
    indentLeftPt: left === undefined ? undefined : twipsToPt(Number(left)),
    indentFirstLinePt: firstLine !== undefined ? twipsToPt(Number(firstLine)) : hanging !== undefined ? -twipsToPt(Number(hanging)) : undefined,
  };
}

type StyleType = 'paragraph' | 'character';

function findStyle(stylesRoot: XmlElement, styleId: string, type: StyleType): XmlElement | undefined {
  return elementsWithTag([stylesRoot], 'w:style').find((s) => attr(s, 'w:type') === type && attr(s, 'w:styleId') === styleId);
}

function findDefaultStyle(stylesRoot: XmlElement, type: StyleType): XmlElement | undefined {
  return elementsWithTag([stylesRoot], 'w:style').find((s) => attr(s, 'w:type') === type && attr(s, 'w:default') === '1');
}

// Root-first order (the ultimate ancestor first, styleId's own style last), so later merge layers correctly override earlier ones. Cycle-guarded against a malformed w:basedOn loop.
function resolveBasedOnChain(stylesRoot: XmlElement, styleId: string, type: StyleType): XmlElement[] {
  const chain: XmlElement[] = [];
  const visited = new Set<string>();
  let currentId: string | undefined = styleId;
  while (currentId !== undefined && !visited.has(currentId)) {
    visited.add(currentId);
    const style = findStyle(stylesRoot, currentId, type);
    if (style === undefined) {
      break;
    }
    chain.unshift(style);
    const basedOn = childrenWithTag(style, 'w:basedOn')[0];
    currentId = basedOn === undefined ? undefined : attr(basedOn, 'w:val');
  }
  return chain;
}

function docDefaultsElement(stylesRoot: XmlElement | undefined, wrapperTag: 'w:pPrDefault' | 'w:rPrDefault', innerTag: 'w:pPr' | 'w:rPr'): XmlElement | undefined {
  const docDefaults = stylesRoot === undefined ? undefined : childrenWithTag(stylesRoot, 'w:docDefaults')[0];
  const wrapper = docDefaults === undefined ? undefined : childrenWithTag(docDefaults, wrapperTag)[0];
  return wrapper === undefined ? undefined : childrenWithTag(wrapper, innerTag)[0];
}

// Cascade: docDefaults -> default paragraph style -> the paragraph's own named style chain (root-first) -> the paragraph's own direct w:pPr. Numbering-level properties are deliberately not merged in here -- list indentation/marker layout is a layout-engine concern once a paragraph's list membership (numId/level) is known, not a style-resolution one.
export function resolveParagraphProperties(paragraph: XmlElement, context: DocxStyleContext): ResolvedParagraphProperties {
  const pPr = childrenWithTag(paragraph, 'w:pPr')[0];
  const pStyleEl = pPr === undefined ? undefined : childrenWithTag(pPr, 'w:pStyle')[0];
  const styleId = pStyleEl === undefined ? undefined : attr(pStyleEl, 'w:val');

  let resolved = readParagraphPropertiesLayer(docDefaultsElement(context.stylesRoot, 'w:pPrDefault', 'w:pPr'));

  if (context.stylesRoot !== undefined) {
    const defaultStyle = findDefaultStyle(context.stylesRoot, 'paragraph');
    if (defaultStyle !== undefined) {
      resolved = mergeParagraphLayer(resolved, readParagraphPropertiesLayer(childrenWithTag(defaultStyle, 'w:pPr')[0]));
    }
    if (styleId !== undefined) {
      for (const style of resolveBasedOnChain(context.stylesRoot, styleId, 'paragraph')) {
        resolved = mergeParagraphLayer(resolved, readParagraphPropertiesLayer(childrenWithTag(style, 'w:pPr')[0]));
      }
    }
  }

  return mergeParagraphLayer(resolved, readParagraphPropertiesLayer(pPr));
}

// Cascade: docDefaults -> default paragraph style's own rPr -> the paragraph's named style chain's rPr -> the paragraph-mark run properties (w:pPr/w:rPr, the run-level baseline every run in the paragraph inherits before anything run-specific) -> the run's own character style chain (w:rStyle, resolved through its own w:basedOn chain) -> the run's own direct w:rPr.
export function resolveRunProperties(run: XmlElement, paragraph: XmlElement, context: DocxStyleContext): ResolvedRunProperties {
  const pPr = childrenWithTag(paragraph, 'w:pPr')[0];
  const pStyleEl = pPr === undefined ? undefined : childrenWithTag(pPr, 'w:pStyle')[0];
  const pStyleId = pStyleEl === undefined ? undefined : attr(pStyleEl, 'w:val');

  let resolved = readRunPropertiesLayer(docDefaultsElement(context.stylesRoot, 'w:rPrDefault', 'w:rPr'), context.theme);

  if (context.stylesRoot !== undefined) {
    const defaultStyle = findDefaultStyle(context.stylesRoot, 'paragraph');
    if (defaultStyle !== undefined) {
      resolved = mergeRunLayer(resolved, readRunPropertiesLayer(childrenWithTag(defaultStyle, 'w:rPr')[0], context.theme));
    }
    if (pStyleId !== undefined) {
      for (const style of resolveBasedOnChain(context.stylesRoot, pStyleId, 'paragraph')) {
        resolved = mergeRunLayer(resolved, readRunPropertiesLayer(childrenWithTag(style, 'w:rPr')[0], context.theme));
      }
    }
  }

  const paragraphMarkRPr = pPr === undefined ? undefined : childrenWithTag(pPr, 'w:rPr')[0];
  resolved = mergeRunLayer(resolved, readRunPropertiesLayer(paragraphMarkRPr, context.theme));

  const rPr = childrenWithTag(run, 'w:rPr')[0];
  const rStyleEl = rPr === undefined ? undefined : childrenWithTag(rPr, 'w:rStyle')[0];
  const rStyleId = rStyleEl === undefined ? undefined : attr(rStyleEl, 'w:val');
  if (context.stylesRoot !== undefined && rStyleId !== undefined) {
    for (const style of resolveBasedOnChain(context.stylesRoot, rStyleId, 'character')) {
      resolved = mergeRunLayer(resolved, readRunPropertiesLayer(childrenWithTag(style, 'w:rPr')[0], context.theme));
    }
  }

  return mergeRunLayer(resolved, readRunPropertiesLayer(rPr, context.theme));
}
