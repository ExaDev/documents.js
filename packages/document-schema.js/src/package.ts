import { z } from 'zod';
import { ContentDocumentSchema } from './content';
import { LayoutDocumentSchema } from './layout';

// DocumentPackage is a superset envelope pairing the two existing pivots, not a pivot in its own right -- it exists so a caller that wants to carry both a document's semantic content and its rendered layout through one value (e.g. a single serialized artifact) doesn't have to invent its own wrapper shape. content is required; layout is optional, because layout is a *derived* artifact -- the output of running a layout algorithm against content -- so a content-only package (an edit-only workflow that never touches rendering) must be constructible without eagerly running layout.
//
// When layout IS present, it correlates with content via each item's own sourcePath field (already present on both ContentDocument's blocks/runs/shapes/cells/vectors and LayoutDocument's items). That correlation is only valid as of the exact read+layout pass that produced this particular package -- there is no automatic invalidation if a caller mutates content after the fact and keeps the stale layout around. A DocumentPackage carrying a layout that no longer matches its own content is not detected or rejected by this schema; keeping the two in sync is entirely the caller's responsibility.

// Bumped whenever DocumentPackageSchema's own shape changes incompatibly -- independent of CONTENT_FORMAT_VERSION and LAYOUT_FORMAT_VERSION, since the envelope can change shape without either pivot changing, and vice versa.
export const DOCUMENT_PACKAGE_FORMAT_VERSION = 1;

export const DocumentPackageSchema = z.object({
  formatVersion: z.literal(DOCUMENT_PACKAGE_FORMAT_VERSION),
  content: ContentDocumentSchema,
  layout: LayoutDocumentSchema.optional(),
});
export type DocumentPackage = z.infer<typeof DocumentPackageSchema>;
