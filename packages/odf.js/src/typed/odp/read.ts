import type { ContentShape, ContentSlide, DocumentPackage, LayoutMetadata, PageSize, SourceResidue } from 'document-schema.js';
import { assemblePackage, SLIDE_SIZE_WIDESCREEN } from 'document-schema.js';
import type { XmlElement } from '../../model/node';
import type { Package } from '../../model/package';
import { attrValue, childrenWithTag, elementsWithTag, findChildElement, rootElement } from '../../xml/query';
import { decodeOdfText } from '../shared/text';
import { readOdfMetadata } from '../shared/metadata';
import { resolveDrawPageSize } from '../shared/masterpage';
import type { OdfListIdState } from '../shared/list';
import { collectOdfNonContentPartResidue, collectOdfUnmappedShapeResidue, odfAttributeElement, odfResidue } from '../shared/constructs';
import { walkDrawShapes } from '../draw/shapes';

// Resolves a Package into { metadata, slides }: document order is native here -- a draw:page's own position among its office:presentation siblings IS slide order, with no pptx-style p:sldIdLst indirection to resolve at all (verified against real LibreOffice output: multiple draw:page elements sit directly, in order, under office:body/office:presentation).

const CONTENT_PART = 'content.xml';

// Slide size resolves per-slide via resolveDrawPageSize (typed/shared/masterpage.ts, shared with odg's own IDENTICAL draw:page resolution chain -- see that module's own top-of-file note), not once for the whole document: unlike OOXML's own single document-level p:sldSz, ODF's model genuinely allows different draw:page elements to reference different master pages (and therefore different page-layouts), even though real-world presentations almost always share one master throughout. Falls back to document-schema.js's own SLIDE_SIZE_WIDESCREEN (matching ooxml.js's own pptx reader's fallback) when the chain doesn't resolve.
function readSlideSize(page: XmlElement, pkg: Package): PageSize {
  return resolveDrawPageSize(page, pkg) ?? SLIDE_SIZE_WIDESCREEN;
}

// presentation:notes is a direct child of draw:page, itself containing its own nested content -- typically a single draw:frame > draw:text-box with one text:p per line of speaker notes (verified against real LibreOffice output). elementsWithTag (a deep search) rather than assuming that exact one-frame shape, since the task's own framing is "typically", not "always" -- every text:p anywhere under presentation:notes contributes a line, decoded via text.ts's own decodeOdfText (which correctly expands text:s/text:tab/text:line-break, unlike a naive text-node-only concatenation). A draw:page with no presentation:notes at all (a slide with no speaker notes) reads as '' -- ordinary, valid ODF, not a diagnostic.
function readSlideNotes(page: XmlElement): string {
  const notes = childrenWithTag(page, 'presentation:notes')[0];
  if (notes === undefined) {
    return '';
  }
  return elementsWithTag(notes.children, 'text:p').map(decodeOdfText).join('\n');
}

// The slide-transition attribute set: the ODF 1.0/1.1 legacy presentation:* spelling and the ODF 1.2 SMIL spelling (smil:type/subtype/direction/fadeColor). Per both the 1.1 and the 1.2 RelaxNG schemas these sit on style:drawing-page-properties (the drawing page style's property element), NEVER as attributes of draw:page itself, and real LibreOffice Impress output writes each slide's transition into the slide's own automatic drawing-page style exactly there (verified against genuine Impress output -- see the transitions.odp fixture). The residue spelling is a children-stripped, attribute-filtered copy of that properties element -- see constructs.ts's odfAttributeElement.
const ODP_TRANSITION_ATTRIBUTES: readonly string[] = ['presentation:transition-type', 'presentation:transition-style', 'presentation:transition-speed', 'presentation:duration', 'smil:type', 'smil:subtype', 'smil:direction', 'smil:fadeColor'];

// A draw:page's own drawing-page style's properties element: draw:style-name -> style:style[family="drawing-page"] -> style:drawing-page-properties, across both style containers in both parts (the established both-parts-both-containers pattern -- see cascade.ts's collectStyles; a real presentation's own automatic drawing-page styles sit in content.xml). 'drawing-page' is not a member of the style-interning layer's STYLE_FAMILIES (this package never writes one), so this is a direct container walk rather than cascade.ts's findStyleElement, single-level with no parent-chain walk, matching constructs.ts's findSectionStyleElement convention for families whose real-world styles are standalone.
function findDrawingPageProperties(pkg: Package, styleName: string | undefined): XmlElement | undefined {
  if (styleName === undefined) {
    return undefined;
  }
  for (const partPath of ['content.xml', 'styles.xml'] as const) {
    const part = pkg.parts[partPath];
    if (part?.kind !== 'xml') {
      continue;
    }
    const root = rootElement(part.nodes);
    if (root === undefined) {
      continue;
    }
    for (const containerTag of ['office:automatic-styles', 'office:styles'] as const) {
      const container = findChildElement(root.children, containerTag);
      if (container === undefined) {
        continue;
      }
      for (const style of childrenWithTag(container, 'style:style')) {
        if (attrValue(style, 'style:family') === 'drawing-page' && attrValue(style, 'style:name') === styleName) {
          return childrenWithTag(style, 'style:drawing-page-properties')[0];
        }
      }
    }
  }
  return undefined;
}

// The per-slide presentation extras no content model carries: a slide's sound and its animation trees (the ODF 1.2 SMIL anim: spelling and the ODF 1.0 presentation:animations container). Direct children of draw:page, quarantined in document order beside the transition facts and whatever unmapped shapes the page held.
const ODP_PRESENTATION_EXTRA_TAGS: ReadonlySet<string> = new Set(['presentation:sound', 'presentation:animations', 'anim:par', 'anim:seq']);

// One slide's own residue: the transition attributes off the slide's own drawing-page style, the sound/animation children, and the unmapped shape kinds plus vendor-extension elements (typed/shared/constructs.ts's collectOdfUnmappedShapeResidue -- the same walker recursion boundary walkDrawShapes itself uses). undefined when the slide carries none of it, so an ordinary slide stays field-free.
function readSlideResidue(page: XmlElement, pkg: Package): SourceResidue | undefined {
  const elements: XmlElement[] = [];
  const drawingPageProperties = findDrawingPageProperties(pkg, attrValue(page, 'draw:style-name'));
  if (drawingPageProperties !== undefined && ODP_TRANSITION_ATTRIBUTES.some((name) => attrValue(drawingPageProperties, name) !== undefined)) {
    elements.push(odfAttributeElement(drawingPageProperties, ...ODP_TRANSITION_ATTRIBUTES));
  }
  for (const child of page.children) {
    if (child.type === 'element' && ODP_PRESENTATION_EXTRA_TAGS.has(child.tag)) {
      elements.push(child);
    }
  }
  collectOdfUnmappedShapeResidue(page.children, elements);
  return elements.length > 0 ? odfResidue('odp', ...elements) : undefined;
}

// `listIdState` mints the numId identity for every text:list found inside a slide text frame (draw:frame > draw:text-box), threaded by walkDrawShapes through the whole shape walk and owned by readOdpContent below at DOCUMENT scope -- one counter across every slide, so two lists on different slides get different identities exactly as two lists in different parts of one odt body do (see typed/shared/list.ts's own top-of-file note for the numId convention and typed/draw/shapes.ts's readDrawFrameContent for why odp mints rather than emitting the numId-less { level } shape).
function readSlide(page: XmlElement, pkg: Package, listIdState: OdfListIdState): ContentSlide {
  const shapes: ContentShape[] = [];
  walkDrawShapes(page.children, [], pkg, shapes, { next: 0 }, listIdState);
  const source = readSlideResidue(page, pkg);
  return { size: readSlideSize(page, pkg), shapes, notes: readSlideNotes(page), ...(source !== undefined ? { source } : {}) };
}

export interface OdpDocument {
  metadata: LayoutMetadata;
  slides: ContentSlide[];
  // The package-tier residue table: non-content XML parts keyed by their part path. Present only when at least one quarantined -- the flat ContentDocument has no root source table, so this field is how the table reaches readOdp's assembled package root.
  source?: Record<string, SourceResidue>;
}

export function readOdpContent(pkg: Package): OdpDocument {
  const contentPart = pkg.parts[CONTENT_PART];
  const root = contentPart?.kind === 'xml' ? rootElement(contentPart.nodes) : undefined;
  const body = root === undefined ? undefined : findChildElement(root.children, 'office:body');
  const presentation = body === undefined ? undefined : findChildElement(body.children, 'office:presentation');
  const pages = presentation === undefined ? [] : childrenWithTag(presentation, 'draw:page');

  const listIdState: OdfListIdState = { next: 1 };
  const slides = pages.map((page) => readSlide(page, pkg, listIdState));
  const source: Record<string, SourceResidue> = {};
  collectOdfNonContentPartResidue(pkg, 'odp', source);
  return {
    metadata: readOdfMetadata(pkg),
    slides,
    ...(Object.keys(source).length > 0 ? { source } : {}),
  };
}

// Package -> DocumentPackage: this module's PRIMARY entry point, the presentation mirror of readOdtContent/readOdt (see src/typed/odt/read.ts's own note on why assemblePackage rather than bare decompose, and why no `pages` argument). readOdpContent above is unchanged and remains the flat, ContentDocument-level reader.
export function readOdp(pkg: Package): DocumentPackage {
  const { metadata, slides, source } = readOdpContent(pkg);
  const assembled = assemblePackage({ kind: 'presentation', metadata, slides });
  if (source !== undefined) {
    assembled.source = source;
  }
  return assembled;
}
