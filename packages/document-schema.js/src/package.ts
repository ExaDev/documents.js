import { z } from 'zod';
import { ContentDocumentSchema } from './content';
import { PageSizeSchema } from './geometry';

// DocumentPackage is a fused, single-tree envelope around ContentDocument: content is required, and once something has laid the document out, that same layout is not carried as a second, independent tree -- it is fused directly onto the content tree, node by node, via each node's own optional `frames` field (src/content.ts's FusedNode pattern; see LayoutFrameSchema in src/geometry.ts). A paragraph, run, image, table, shape, vector, or spreadsheet cell that has been through a layout pass carries its own rendered page position(s) right there on the node -- no correlation step, no separate array of positioned items to walk back to their origin by matching a sourcePath string.
//
// What is left at the package level, once position moves onto the nodes themselves, is `pages`: the geometry of each rendered page a `frames` entry's own `pageIndex` refers into. `pages` is optional for the same reason DocumentPackage's old `layout` field was optional -- layout (now: page geometry plus populated `frames` fields throughout content) is a *derived* artifact, the output of running a layout algorithm against content, so a content-only package (an edit-only workflow that never touches rendering) must be constructible without eagerly running layout. A DocumentPackage whose `pages` is present but whose content nodes carry no `frames` at all (or vice versa) is not detected or rejected by this schema; keeping the two in step is entirely the producer's responsibility, exactly as keeping content and layout in step was under the old two-tree design.
//
// This is a genuinely breaking shape change from the previous `{ content, layout: LayoutDocument }` envelope (LayoutDocument -- pages of positioned, sourcePath-correlated LayoutItems -- no longer appears here at all), which is why DOCUMENT_PACKAGE_FORMAT_VERSION is bumped below. LayoutDocumentSchema itself is untouched and still exported from this package: it remains the right shape for a format with no content tree of its own to fuse onto, most notably pdf-codec's own readPdf/writePdf, which read and write a PDF's pages of positioned items directly with no ContentDocument in the loop at all.

// Bumped whenever DocumentPackageSchema's own shape changes incompatibly -- independent of CONTENT_FORMAT_VERSION and LAYOUT_FORMAT_VERSION, since the envelope can change shape without either pivot changing, and vice versa. 2 replaced the separate optional `layout: LayoutDocument` field with the fused-tree design above: `pages` (page geometry only) plus each content node's own optional `frames` field (src/content.ts, CONTENT_FORMAT_VERSION bumped in step).
export const DOCUMENT_PACKAGE_FORMAT_VERSION = 2;

export const DocumentPackageSchema = z.object({
  formatVersion: z.literal(DOCUMENT_PACKAGE_FORMAT_VERSION),
  content: ContentDocumentSchema,
  // Each rendered page's own size, indexed to match every content node's own `frames[].pageIndex` (src/content.ts, src/geometry.ts's LayoutFrameSchema). Absent until something has laid `content` out, mirroring the old `layout` field's own absence for a content-only package.
  pages: z.array(PageSizeSchema).optional(),
});
export type DocumentPackage = z.infer<typeof DocumentPackageSchema>;
