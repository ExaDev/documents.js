import type { Package } from 'ooxml.js';
import { readDocx } from 'ooxml.js';
import type { ContentDocument } from '../../model/content';
import { CONTENT_FORMAT_VERSION } from '../../model/content';

// Package -> ContentDocument (the wordprocessing variant). A thin adapter over ooxml.js's own readDocx: the WordprocessingML style cascade (docDefaults -> named-style basedOn chains -> paragraph-mark run properties -> character styles -> direct formatting), DrawingML theme resolution, and document-order section/block walking all now live upstream in ooxml.js (readDocx used to be a lossy, geometry-free projection unusable as a layout basis; it no longer is). readDocx's own `comments`/`footnotes`/`headers`/`footers` are not part of ContentDocument's shape and are dropped here -- ContentDocument only models the section/block content a layout engine needs. LayoutMetadata's own `producer` field (a PDF-only concept) is left unset, exactly as it was before this package read docx metadata itself.
export function readDocxContent(pkg: Package): ContentDocument {
  const docxDoc = readDocx(pkg);
  return { kind: 'wordprocessing', formatVersion: CONTENT_FORMAT_VERSION, metadata: { ...docxDoc.metadata }, sections: docxDoc.sections };
}
