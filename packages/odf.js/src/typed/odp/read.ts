import type { ContentShape, ContentSlide, DocumentPackage, LayoutMetadata, PageSize } from 'document-schema.js';
import { assemblePackage, SLIDE_SIZE_WIDESCREEN } from 'document-schema.js';
import type { XmlElement } from '../../model/node';
import type { Package } from '../../model/package';
import { childrenWithTag, elementsWithTag, findChildElement, rootElement } from '../../xml/query';
import { decodeOdfText } from '../shared/text';
import { readOdfMetadata } from '../shared/metadata';
import { resolveDrawPageSize } from '../shared/masterpage';
import type { OdfListIdState } from '../shared/list';
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

// `listIdState` mints the numId identity for every text:list found inside a slide text frame (draw:frame > draw:text-box), threaded by walkDrawShapes through the whole shape walk and owned by readOdpContent below at DOCUMENT scope -- one counter across every slide, so two lists on different slides get different identities exactly as two lists in different parts of one odt body do (see typed/shared/list.ts's own top-of-file note for the numId convention and typed/draw/shapes.ts's readDrawFrameContent for why odp mints rather than emitting the numId-less { level } shape).
function readSlide(page: XmlElement, pkg: Package, listIdState: OdfListIdState): ContentSlide {
  const shapes: ContentShape[] = [];
  walkDrawShapes(page.children, [], pkg, shapes, { next: 0 }, listIdState);
  return { size: readSlideSize(page, pkg), shapes, notes: readSlideNotes(page) };
}

export interface OdpDocument {
  metadata: LayoutMetadata;
  slides: ContentSlide[];
}

export function readOdpContent(pkg: Package): OdpDocument {
  const contentPart = pkg.parts[CONTENT_PART];
  const root = contentPart?.kind === 'xml' ? rootElement(contentPart.nodes) : undefined;
  const body = root === undefined ? undefined : findChildElement(root.children, 'office:body');
  const presentation = body === undefined ? undefined : findChildElement(body.children, 'office:presentation');
  const pages = presentation === undefined ? [] : childrenWithTag(presentation, 'draw:page');

  const listIdState: OdfListIdState = { next: 1 };
  return {
    metadata: readOdfMetadata(pkg),
    slides: pages.map((page) => readSlide(page, pkg, listIdState)),
  };
}

// Package -> DocumentPackage: this module's PRIMARY entry point, the presentation mirror of readOdtContent/readOdt (see src/typed/odt/read.ts's own note on why assemblePackage rather than bare decompose, and why no `pages` argument). readOdpContent above is unchanged and remains the flat, ContentDocument-level reader.
export function readOdp(pkg: Package): DocumentPackage {
  const { metadata, slides } = readOdpContent(pkg);
  return assemblePackage({ kind: 'presentation', metadata, slides });
}
