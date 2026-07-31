import type { Package } from 'odf.js';
import { readOds } from 'odf.js';
import type { ContentDocument } from '../../model/content';
import { CONTENT_FORMAT_VERSION } from '../../model/content';

// Package -> ContentDocument (the spreadsheet variant). A thin adapter over odf.js's own readOds, mirroring src/odf/odt/read.ts's readOdtContent and src/odf/odp/read.ts's readOdpContent exactly: odf.js's OdsDocument is already { metadata, sheets }, the identical shape document-content-model's own ContentSheet vocabulary already targets (see that package's own module doc: "it exists so odf.js can target a stable, correctly-typed shape for its own .ods reader"), so this is nothing more than the envelope wrap.
export function readOdsContent(pkg: Package): ContentDocument {
  const odsDoc = readOds(pkg);
  return { kind: 'spreadsheet', formatVersion: CONTENT_FORMAT_VERSION, metadata: { ...odsDoc.metadata }, sheets: odsDoc.sheets };
}
