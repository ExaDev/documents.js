import type { LayoutDocumentSurface } from "./layout";

/**
 * writePdf was handed a LayoutDocument from a read that left document-level surfaces out (one carrying `skippedSurfaces`, which only `ReadPdfOptions.surfaces` sets). Such a document is a reading with parts of the file deliberately unread, not a document to re-emit: each skipped surface's field is absent whatever the source holds, and its page items lack what depended on it (internal links without destinations, structure owners without the structure tree, layer names without layers), so writing it would silently drop the source's outline, form, layers, structure or residue. Thrown rather than writing a file that looks complete. Checked after `PdfPartialDocumentError`, so a page-selected read that also skipped surfaces reports the page selection.
 */
export class PdfSkippedSurfacesError extends Error {
  /** The surfaces the read skipped, as the document's `skippedSurfaces` lists them. */
  readonly skippedSurfaces: readonly LayoutDocumentSurface[];

  constructor(skippedSurfaces: readonly LayoutDocumentSurface[]) {
    super(
      `this LayoutDocument was read with ${skippedSurfaces.join(", ")} left out (it carries skippedSurfaces, which only a read with ReadPdfOptions.surfaces sets); writing it would drop whatever the source holds there, so it cannot be written as a document of its own`,
    );
    this.name = "PdfSkippedSurfacesError";
    this.skippedSurfaces = skippedSurfaces;
  }
}
