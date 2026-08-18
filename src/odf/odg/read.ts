import type { ContentDocument } from 'document-schema.js';

import type { Package } from 'odf.js';
import { readOdg } from 'odf.js';

// Package -> ContentDocument (the drawing variant). A thin adapter over odf.js's own readOdg, mirroring src/odf/odp/read.ts's readOdpContent and src/odf/ods/read.ts's readOdsContent exactly: odf.js's OdgDocument is already { metadata, pages }, the identical shape document-schema.js's own ContentDrawPage vocabulary already targets, so this is nothing more than the envelope wrap.
export function readOdgContent(pkg: Package): ContentDocument {
  const odgDoc = readOdg(pkg);
  return { kind: 'drawing', metadata: { ...odgDoc.metadata }, pages: odgDoc.pages };
}
