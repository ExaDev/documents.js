import type { ContentShape, ContentSlide, LayoutMetadata, PageSize } from 'document-content-model';
import { SLIDE_SIZE_WIDESCREEN } from 'document-content-model';
import type { XmlElement } from '../../model/node';
import type { Package } from '../../model/package';
import { attrValue, childrenWithTag, elementsWithTag, findChildElement, rootElement } from '../../xml/query';
import { decodeOdfText } from '../shared/text';
import { readOdfMetadata } from '../shared/metadata';
import { parsePageSize } from '../shared/geometry';
import { walkDrawShapes } from '../draw/shapes';

// Resolves a Package into { metadata, slides }: document order is native here -- a draw:page's own position among its office:presentation siblings IS slide order, with no pptx-style p:sldIdLst indirection to resolve at all (verified against real LibreOffice output: multiple draw:page elements sit directly, in order, under office:body/office:presentation).

const CONTENT_PART = 'content.xml';
const STYLES_PART = 'styles.xml';
const AUTOMATIC_STYLE_PARTS = [CONTENT_PART, STYLES_PART] as const;

function findMasterPageElement(pkg: Package, masterPageName: string | undefined): XmlElement | undefined {
  if (masterPageName === undefined) {
    return undefined;
  }
  const stylesPart = pkg.parts[STYLES_PART];
  if (stylesPart?.kind !== 'xml') {
    return undefined;
  }
  const root = rootElement(stylesPart.nodes);
  const masterStyles = root === undefined ? undefined : findChildElement(root.children, 'office:master-styles');
  if (masterStyles === undefined) {
    return undefined;
  }
  return childrenWithTag(masterStyles, 'style:master-page').find((element) => attrValue(element, 'style:name') === masterPageName);
}

// A style:page-layout can live in either part's own office:automatic-styles (verified against real LibreOffice output: a presentation's own page-layouts sit in styles.xml, but the ODF schema does not pin this to one specific part) -- mirroring cascade.ts's own collectStyles, which searches both content.xml and styles.xml for exactly this reason.
function findPageLayoutElement(pkg: Package, pageLayoutName: string | undefined): XmlElement | undefined {
  if (pageLayoutName === undefined) {
    return undefined;
  }
  for (const partPath of AUTOMATIC_STYLE_PARTS) {
    const part = pkg.parts[partPath];
    if (part?.kind !== 'xml') {
      continue;
    }
    const root = rootElement(part.nodes);
    const automaticStyles = root === undefined ? undefined : findChildElement(root.children, 'office:automatic-styles');
    if (automaticStyles === undefined) {
      continue;
    }
    const found = childrenWithTag(automaticStyles, 'style:page-layout').find((element) => attrValue(element, 'style:name') === pageLayoutName);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

// Slide size resolves per-slide (draw:page's own draw:master-page-name -> style:master-page's own style:page-layout-name -> style:page-layout's own style:page-layout-properties, reusing geometry.ts's parsePageSize), not once for the whole document: unlike OOXML's own single document-level p:sldSz, ODF's model genuinely allows different draw:page elements to reference different master pages (and therefore different page-layouts), even though real-world presentations almost always share one master throughout. Falls back to document-content-model's own SLIDE_SIZE_WIDESCREEN (matching ooxml.js's own pptx reader's fallback) when the chain doesn't resolve.
function readSlideSize(page: XmlElement, pkg: Package): PageSize {
  const masterPageName = attrValue(page, 'draw:master-page-name');
  const masterPage = findMasterPageElement(pkg, masterPageName);
  const pageLayoutName = masterPage === undefined ? undefined : attrValue(masterPage, 'style:page-layout-name');
  const pageLayout = findPageLayoutElement(pkg, pageLayoutName);
  const properties = pageLayout === undefined ? undefined : childrenWithTag(pageLayout, 'style:page-layout-properties')[0];
  const size = properties === undefined ? undefined : parsePageSize(properties);
  return size ?? SLIDE_SIZE_WIDESCREEN;
}

// presentation:notes is a direct child of draw:page, itself containing its own nested content -- typically a single draw:frame > draw:text-box with one text:p per line of speaker notes (verified against real LibreOffice output). elementsWithTag (a deep search) rather than assuming that exact one-frame shape, since the task's own framing is "typically", not "always" -- every text:p anywhere under presentation:notes contributes a line, decoded via text.ts's own decodeOdfText (which correctly expands text:s/text:tab/text:line-break, unlike a naive text-node-only concatenation). A draw:page with no presentation:notes at all (a slide with no speaker notes) reads as '' -- ordinary, valid ODF, not a diagnostic.
function readSlideNotes(page: XmlElement): string {
  const notes = childrenWithTag(page, 'presentation:notes')[0];
  if (notes === undefined) {
    return '';
  }
  return elementsWithTag(notes.children, 'text:p').map(decodeOdfText).join('\n');
}

function readSlide(page: XmlElement, pkg: Package): ContentSlide {
  const shapes: ContentShape[] = [];
  walkDrawShapes(page.children, [], pkg, shapes);
  return { size: readSlideSize(page, pkg), shapes, notes: readSlideNotes(page) };
}

export interface OdpDocument {
  metadata: LayoutMetadata;
  slides: ContentSlide[];
}

export function readOdp(pkg: Package): OdpDocument {
  const contentPart = pkg.parts[CONTENT_PART];
  const root = contentPart?.kind === 'xml' ? rootElement(contentPart.nodes) : undefined;
  const body = root === undefined ? undefined : findChildElement(root.children, 'office:body');
  const presentation = body === undefined ? undefined : findChildElement(body.children, 'office:presentation');
  const pages = presentation === undefined ? [] : childrenWithTag(presentation, 'draw:page');

  return {
    metadata: readOdfMetadata(pkg),
    slides: pages.map((page) => readSlide(page, pkg)),
  };
}
