import type { ContentDocument } from 'document-schema.js';

import type { Package } from 'odf.js';
import { readOdsContent as readOdsFlat } from 'odf.js';

// Package -> ContentDocument (the spreadsheet variant). A thin adapter over odf.js's own readOdsContent, mirroring src/odf/odt/read.ts's readOdtContent and src/odf/odp/read.ts's readOdpContent exactly: odf.js's OdsDocument is already { metadata, sheets }, the identical shape document-schema.js's own ContentSheet vocabulary already targets (see that package's own module doc: "it exists so odf.js can target a stable, correctly-typed shape for its own .ods reader"), so this is nothing more than the envelope wrap. odf.js 5.0.0 renamed this flat reader to readOdsContent and gave the bare readOds name to its tree-form DocumentPackage counterpart -- the import is aliased here only because this module's own export is itself named readOdsContent.
export function readOdsContent(pkg: Package): ContentDocument {
  const odsDoc = readOdsFlat(pkg);
  return { kind: 'spreadsheet', metadata: { ...odsDoc.metadata }, sheets: odsDoc.sheets };
}
