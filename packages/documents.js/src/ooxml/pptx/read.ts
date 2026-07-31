import type { Package } from 'ooxml.js';
import { readPptx } from 'ooxml.js';
import type { ContentDocument } from '../../model/content';
import { CONTENT_FORMAT_VERSION } from '../../model/content';

// Package -> ContentDocument (the presentation variant). A thin adapter over ooxml.js's own readPptx: placeholder -> layout -> master -> theme inheritance, the run-property cascade, group-transform flattening, and slide ordering via p:sldIdLst all now live upstream in ooxml.js (readPptx used to be a lossy, geometry-free projection unusable as a layout basis; it no longer is).
export function readPptxContent(pkg: Package): ContentDocument {
  const pptxDoc = readPptx(pkg);
  return { kind: 'presentation', formatVersion: CONTENT_FORMAT_VERSION, metadata: { ...pptxDoc.metadata }, slides: pptxDoc.slides };
}
