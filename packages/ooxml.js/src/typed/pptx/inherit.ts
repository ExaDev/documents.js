import type { Package } from '../../model/package';
import type { XmlElement } from '../../model/node';
import type { Color } from 'document-schema.js';
import { drawingMlFontSizeToPt } from '../shared/units';
import type { DrawingTheme, DrawingXfrm } from '../shared/drawingml';
import { EMPTY_THEME, readColorMap, readSolidFillColor, readTheme, readXfrm, resolveThemeFontReference } from '../shared/drawingml';
import { attr, childrenWithTag, elementsWithTag, resolveRelationships, rootElement } from '../util';

// The placeholder -> layout -> master -> theme inheritance cascade: most real shapes (a title placeholder, chiefly) carry no a:xfrm of their own at all, and skipping this means every such shape renders at (0,0) with zero size, and every themed run renders black. Resolution follows each part's own relationships, never a filename convention. Ported from documents.js's src/ooxml/pptx/inherit.ts.

const SLIDE_LAYOUT_REL_SUFFIX = '/slideLayout';
const SLIDE_MASTER_REL_SUFFIX = '/slideMaster';
const THEME_REL_SUFFIX = '/theme';

function findRelTarget(pkg: Package, partPath: string, typeSuffix: string): string | undefined {
  for (const rel of resolveRelationships(pkg, partPath).values()) {
    if (rel.type.endsWith(typeSuffix)) {
      return rel.target;
    }
  }
  return undefined;
}

// SlideInheritanceContext is an internal cascade-resolution type (matching DocxStyleContext's own treatment in ../docx/styles.ts) -- it carries a DrawingTheme and ReadonlyMap, not natural Zod targets, and is never part of PptxDocument's own published shape.
export interface SlideInheritanceContext {
  readonly layoutRoot: XmlElement | undefined;
  readonly masterRoot: XmlElement | undefined;
  readonly theme: DrawingTheme;
  readonly colorMap: ReadonlyMap<string, string>;
}

// Resolves a slide's layout -> master -> theme chain via each part's own relationships, and the master's own p:clrMap. A broken or missing link degrades to undefined/EMPTY_THEME rather than throwing -- a slide missing its layout is unusual but not a reason to fail the whole conversion.
export function resolveSlideInheritance(pkg: Package, slidePath: string): SlideInheritanceContext {
  const layoutPath = findRelTarget(pkg, slidePath, SLIDE_LAYOUT_REL_SUFFIX);
  const layoutRoot = layoutPath === undefined ? undefined : rootElement(pkg.parts[layoutPath]);

  const masterPath = layoutPath === undefined ? undefined : findRelTarget(pkg, layoutPath, SLIDE_MASTER_REL_SUFFIX);
  const masterRoot = masterPath === undefined ? undefined : rootElement(pkg.parts[masterPath]);

  const themePath = masterPath === undefined ? undefined : findRelTarget(pkg, masterPath, THEME_REL_SUFFIX);
  const themeRoot = themePath === undefined ? undefined : rootElement(pkg.parts[themePath]);
  const theme = themeRoot === undefined ? EMPTY_THEME : readTheme(themeRoot);

  const clrMapEl = masterRoot === undefined ? undefined : childrenWithTag(masterRoot, 'p:clrMap')[0];
  const colorMap = readColorMap(clrMapEl);

  return { layoutRoot, masterRoot, theme, colorMap };
}

export interface PlaceholderKey {
  readonly type: string | undefined;
  readonly idx: string | undefined;
}

// ctrTitle/subTitle are the specific placeholder types a title-layout's own shapes carry; the corresponding placeholder on any other layout/master (which a title slide's own cascade still needs to match against) is typed title/body respectively.
const TYPE_NORMALIZATION: ReadonlyMap<string, string> = new Map([
  ['ctrTitle', 'title'],
  ['subTitle', 'body'],
]);

function normalizePlaceholderType(type: string | undefined): string | undefined {
  return type === undefined ? undefined : (TYPE_NORMALIZATION.get(type) ?? type);
}

// p:ph never appears anywhere in a shape's subtree except inside its own nv*Pr/p:nvPr wrapper, so a plain descendant search is unambiguous without needing to enumerate p:nvSpPr/p:nvPicPr/p:nvGrpSpPr separately.
export function readPlaceholderKey(shape: XmlElement): PlaceholderKey | undefined {
  const ph = elementsWithTag([shape], 'p:ph')[0];
  return ph === undefined ? undefined : { type: attr(ph, 'type'), idx: attr(ph, 'idx') };
}

function shapesOf(root: XmlElement | undefined): XmlElement[] {
  return root === undefined ? [] : elementsWithTag([root], 'p:sp');
}

// Matches a placeholder by idx first (the most specific signal), falling back to normalized type -- ECMA-376's own two matching strategies (20.1.2.2.4 CT_Placeholder, section 19.3.1.36).
export function findMatchingPlaceholder(root: XmlElement | undefined, key: PlaceholderKey): XmlElement | undefined {
  const shapes = shapesOf(root);
  if (key.idx !== undefined) {
    const byIdx = shapes.find((shape) => readPlaceholderKey(shape)?.idx === key.idx);
    if (byIdx !== undefined) {
      return byIdx;
    }
  }
  const normalizedTarget = normalizePlaceholderType(key.type);
  if (normalizedTarget === undefined) {
    return undefined;
  }
  return shapes.find((shape) => normalizePlaceholderType(readPlaceholderKey(shape)?.type) === normalizedTarget);
}

function shapeXfrm(shape: XmlElement | undefined): DrawingXfrm | undefined {
  if (shape === undefined) {
    return undefined;
  }
  const spPr = childrenWithTag(shape, 'p:spPr')[0];
  return spPr === undefined ? undefined : readXfrm(childrenWithTag(spPr, 'a:xfrm')[0]);
}

// Layout wins over master when both define geometry for the same placeholder -- the layout is the more specific level of the cascade.
export function resolvePlaceholderXfrm(key: PlaceholderKey, context: SlideInheritanceContext): DrawingXfrm | undefined {
  const layoutXfrm = shapeXfrm(findMatchingPlaceholder(context.layoutRoot, key));
  return layoutXfrm ?? shapeXfrm(findMatchingPlaceholder(context.masterRoot, key));
}

export interface DefaultRunProperties {
  readonly fontFamily?: string;
  readonly sizePt?: number;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly color?: Color;
}

// Reads the same property shape from either a real run's a:rPr or a txStyles level's a:defRPr -- both are CT_TextCharacterProperties, identically shaped.
export function readRunPropertiesFromElement(rPr: XmlElement, context: SlideInheritanceContext): DefaultRunProperties {
  const sz = attr(rPr, 'sz');
  const latin = childrenWithTag(rPr, 'a:latin')[0];
  const typeface = latin === undefined ? undefined : attr(latin, 'typeface');
  const solidFill = childrenWithTag(rPr, 'a:solidFill')[0];
  const bold = attr(rPr, 'b');
  const italic = attr(rPr, 'i');
  return {
    fontFamily: typeface === undefined ? undefined : resolveThemeFontReference(typeface, context.theme),
    sizePt: sz === undefined ? undefined : drawingMlFontSizeToPt(Number(sz)),
    bold: bold === undefined ? undefined : bold === '1',
    italic: italic === undefined ? undefined : italic === '1',
    color: readSolidFillColor(solidFill, context.colorMap, context.theme),
  };
}

function txStyleTagFor(placeholderType: string | undefined): 'p:titleStyle' | 'p:bodyStyle' | 'p:otherStyle' {
  const normalized = normalizePlaceholderType(placeholderType);
  if (normalized === 'title') {
    return 'p:titleStyle';
  }
  if (normalized === 'body') {
    return 'p:bodyStyle';
  }
  return 'p:otherStyle';
}

// a:lvl1pPr..a:lvl9pPr are 1-indexed in the XML; `level` here is 0-indexed, matching ContentParagraph.list.level (mirroring WordprocessingML's own 0-indexed w:ilvl).
function levelTag(level: number): string {
  const clamped = Math.min(Math.max(level, 0), 8);
  return `a:lvl${clamped + 1}pPr`;
}

// The master's p:txStyles (titleStyle/bodyStyle/otherStyle) carry per-outline-level default run properties -- a placeholder's text that specifies no font/size/colour of its own inherits from here. Returns {} (every field undefined) when no matching style/level/defRPr exists, so callers can spread this over a run's own explicit properties without special-casing absence.
export function resolveDefaultRunProperties(placeholderType: string | undefined, level: number, context: SlideInheritanceContext): DefaultRunProperties {
  if (context.masterRoot === undefined) {
    return {};
  }
  const txStyles = childrenWithTag(context.masterRoot, 'p:txStyles')[0];
  const styleEl = txStyles === undefined ? undefined : childrenWithTag(txStyles, txStyleTagFor(placeholderType))[0];
  const lvlPPr = styleEl === undefined ? undefined : childrenWithTag(styleEl, levelTag(level))[0];
  const defRPr = lvlPPr === undefined ? undefined : childrenWithTag(lvlPPr, 'a:defRPr')[0];
  return defRPr === undefined ? {} : readRunPropertiesFromElement(defRPr, context);
}
