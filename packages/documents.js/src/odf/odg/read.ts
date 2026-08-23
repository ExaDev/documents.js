import type { ContentDocument } from 'document-schema.js';

import type { Package } from 'odf.js';
import { readOdgContent as readOdgFlat } from 'odf.js';

// Package -> ContentDocument (the drawing variant). A thin adapter over odf.js's own readOdgContent, mirroring src/odf/odp/read.ts's readOdpContent and src/odf/ods/read.ts's readOdsContent exactly: odf.js's OdgDocument is already { metadata, pages }, the identical shape document-schema.js's own ContentDrawPage vocabulary already targets, so this is nothing more than the envelope wrap. odf.js 5.0.0 renamed this flat reader to readOdgContent and gave the bare readOdg name to its tree-form DocumentTree counterpart -- the import is aliased here only because this module's own export is itself named readOdgContent.
export function readOdgContent(pkg: Package): ContentDocument {
  const odgDoc = readOdgFlat(pkg);
  return { kind: 'drawing', metadata: { ...odgDoc.metadata }, pages: odgDoc.pages };
}
