import type { Package } from 'odf.js';
import { readOdp } from 'odf.js';
import type { ContentDocument } from '../../model/content';
import { CONTENT_FORMAT_VERSION } from '../../model/content';

// Package -> ContentDocument (the presentation variant). A thin adapter over odf.js's own readOdp, mirroring src/ooxml/pptx/read.ts's readPptxContent exactly: odf.js's OdpDocument is already { metadata, slides }, the identical shape readPptx produces, so this is nothing more than the envelope wrap. This is the concrete, load-bearing proof that odp and pptx genuinely share one pivot and one layout engine -- convertPresentationToLayout (src/layout/slides.ts) takes a PresentationContentDocument and has no idea, and no way to tell, which format produced it.
export function readOdpContent(pkg: Package): ContentDocument {
  const odpDoc = readOdp(pkg);
  return { kind: 'presentation', formatVersion: CONTENT_FORMAT_VERSION, metadata: { ...odpDoc.metadata }, slides: odpDoc.slides };
}
