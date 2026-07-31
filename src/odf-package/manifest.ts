// odf.js already owns META-INF/manifest.xml end to end -- reading, deriving, writing, syncing, and validating it -- unlike ooxml.js, which only ever reads OPC relationships and leaves writing new ones to this package's own src/opc/rels.ts. See odf.js's own src/manifest.ts for why: ODF's manifest is the one part every package unconditionally requires, and getting it right (every part listed, every media type correct, the root entry's type tied to the "mimetype" part) is exhaustive enough that odf.js provides first-class read AND write support directly.
//
// This file is therefore a pure re-export: documents.js's own src/odf-package/ conventional entry point for manifest mechanics, mirroring src/opc/content-types.ts's role on the OOXML side, with no logic of its own to add. This is the same outcome src/model/style.ts already reached for Alignment/LayoutFont once their own logic moved upstream -- a thin wrapper that stays a thin wrapper is the correct, complete result, not a placeholder for logic that belongs here later.
export {
  readManifest,
  buildManifest,
  writeManifest,
  syncManifest,
  validateManifest,
  setDocumentMediaType,
  MANIFEST_PART,
  ManifestEntrySchema,
  ManifestSchema,
  ManifestProblemSchema,
} from 'odf.js';
export type { ManifestEntry, Manifest, ManifestProblem, BuildManifestOptions } from 'odf.js';
