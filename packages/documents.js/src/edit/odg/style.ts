import type { Package, XmlElement } from 'odf.js';
import { formatOdfColor, formatOdfLength, parseOdfColor, parseOdfLength } from 'odf.js';
import type { Color, ContentStroke } from 'document-content-model';
import { attr } from 'ooxml.js';
import { setAttr } from '../../xml/edit';
import { el } from '../../xml/fragment';
import { ensureAutomaticStyles, nextStyleName } from '../odt/automatic-styles';

// A vector primitive's fill/stroke is graphic-family formatting (style:graphic-properties' own draw:fill(-color)/draw:stroke + svg:stroke-color/svg:stroke-width -- see odf.js's own typed/draw/shapes.ts readOdfFillAndStroke, which this module mirrors on the write side) that odf.js's own StyleRegistry (src/styles/registry.ts) cannot express: 'graphic' IS a recognised STYLE_FAMILIES member, but StylePropertiesSchema/buildStylePropertyElements (src/styles/properties.ts, serialize.ts) only ever model text/paragraph formatting and never emit a style:graphic-properties element at all, regardless of family. This is therefore a small, self-contained, append-only style writer scoped to exactly what draw:rect/ellipse/line/path's own fill/stroke need -- reusing odt/automatic-styles.ts's ensureAutomaticStyles/nextStyleName wholesale (the same "find-or-create office:automatic-styles, mint the next unused NNN-suffixed name" logic odt's own table/list/page-break style writers already share) rather than a third reimplementation of that lookup.
//
// Each vector element gets its OWN freshly minted style, never shared or mutated in place -- mirroring odt/props.ts's own applyStyleChange convention (fill/stroke setters below always mint a new style and repoint draw:style-name, rather than editing an existing style:style's attributes directly), so an existing automatic style is never mutated or removed once written, matching this codebase's general append-only style-editing invariant (see test-support/odf-style-fidelity.ts's assertAutomaticStylesOnlyAppended).

const GRAPHIC_STYLE_PREFIX = 'gr';

export interface GraphicStyleInit {
  readonly fill?: Color;
  readonly stroke?: ContentStroke;
}

function graphicPropertyAttrs(init: GraphicStyleInit): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (init.fill === undefined) {
    attrs['draw:fill'] = 'none';
  } else {
    attrs['draw:fill-color'] = formatOdfColor(init.fill);
  }
  if (init.stroke === undefined) {
    attrs['draw:stroke'] = 'none';
  } else {
    attrs['svg:stroke-color'] = formatOdfColor(init.stroke.color);
    attrs['svg:stroke-width'] = formatOdfLength(init.stroke.widthPt);
  }
  return attrs;
}

// Mints a fresh style:style[style:family="graphic"] automatic style in content.xml carrying `init`'s fill/stroke, returning its style:name for a caller to set as the element's own draw:style-name.
export function buildGraphicStyle(pkg: Package, init: GraphicStyleInit): string {
  const automaticStyles = ensureAutomaticStyles(pkg);
  const name = nextStyleName(automaticStyles, 'style:style', GRAPHIC_STYLE_PREFIX);
  automaticStyles.children.push(el('style:style', { 'style:name': name, 'style:family': 'graphic' }, [el('style:graphic-properties', graphicPropertyAttrs(init))]));
  return name;
}

function findAutomaticStylesReadOnly(pkg: Package): XmlElement | undefined {
  const part = pkg.parts['content.xml'];
  const root = part?.kind === 'xml' ? part.nodes.find((n): n is XmlElement => n.type === 'element') : undefined;
  if (root === undefined) {
    return undefined;
  }
  for (const child of root.children) {
    if (child.type === 'element' && child.tag === 'office:automatic-styles') {
      return child;
    }
  }
  return undefined;
}

function findGraphicStyle(pkg: Package, element: XmlElement): XmlElement | undefined {
  const styleName = attr(element, 'draw:style-name');
  if (styleName === undefined) {
    return undefined;
  }
  const automaticStyles = findAutomaticStylesReadOnly(pkg);
  return automaticStyles?.children.find((c): c is XmlElement => c.type === 'element' && c.tag === 'style:style' && attr(c, 'style:name') === styleName);
}

function graphicProperties(pkg: Package, element: XmlElement): XmlElement | undefined {
  const style = findGraphicStyle(pkg, element);
  return style?.children.find((c): c is XmlElement => c.type === 'element' && c.tag === 'style:graphic-properties');
}

// Reads fill/stroke back from `element`'s own graphic-family automatic style -- a direct, single-level lookup (this module's own writer never sets style:parent-style-name, so there is no cascade to walk, unlike odf.js's own readOdfFillAndStroke, which DOES walk a style:parent-style-name chain since a document adopted from elsewhere may use one). Used by OdgBoxVector/OdgLineVector/OdgPathVector's own fill/stroke getters, and by the setters below to know what NOT to touch when only one of the two changes.
export function readGraphicFill(pkg: Package, element: XmlElement): Color | undefined {
  const props = graphicProperties(pkg, element);
  if (props === undefined || attr(props, 'draw:fill') === 'none') {
    return undefined;
  }
  const value = attr(props, 'draw:fill-color');
  return value === undefined ? undefined : parseOdfColor(value);
}

export function readGraphicStroke(pkg: Package, element: XmlElement): ContentStroke | undefined {
  const props = graphicProperties(pkg, element);
  if (props === undefined || attr(props, 'draw:stroke') === 'none') {
    return undefined;
  }
  const colorValue = attr(props, 'svg:stroke-color');
  const widthValue = attr(props, 'svg:stroke-width');
  const color = colorValue === undefined ? undefined : parseOdfColor(colorValue);
  const widthPt = widthValue === undefined ? undefined : parseOdfLength(widthValue);
  return color === undefined || widthPt === undefined ? undefined : { color, widthPt };
}

export function setGraphicFill(pkg: Package, element: XmlElement, fill: Color | undefined): void {
  const name = buildGraphicStyle(pkg, { fill, stroke: readGraphicStroke(pkg, element) });
  setAttr(element, 'draw:style-name', name);
}

export function setGraphicStroke(pkg: Package, element: XmlElement, stroke: ContentStroke | undefined): void {
  const name = buildGraphicStyle(pkg, { fill: readGraphicFill(pkg, element), stroke });
  setAttr(element, 'draw:style-name', name);
}
