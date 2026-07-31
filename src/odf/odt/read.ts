import type { Package } from 'odf.js';
import { readOdt } from 'odf.js';
import type { ContentDocument } from '../../model/content';
import { CONTENT_FORMAT_VERSION } from '../../model/content';

// Package -> ContentDocument (the wordprocessing variant). A thin adapter over odf.js's own readOdt, mirroring src/ooxml/docx/read.ts's readDocxContent exactly: odf.js's OdtDocument is already { metadata, sections }, the identical shape readDocx produces, so this is nothing more than the envelope wrap. This is the concrete, load-bearing proof that odt and docx genuinely share one pivot and one layout engine -- convertWordprocessingToLayout (src/layout/engine.ts) takes a WordprocessingContentDocument and has no idea, and no way to tell, which format produced it.
export function readOdtContent(pkg: Package): ContentDocument {
  const odtDoc = readOdt(pkg);
  return { kind: 'wordprocessing', formatVersion: CONTENT_FORMAT_VERSION, metadata: { ...odtDoc.metadata }, sections: odtDoc.sections };
}
