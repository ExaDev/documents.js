// The write-side diagnostic sink, matching the shape markdown-codec's, pdf-codec's, epub-codec's and rtf-codec's own diagnostic channels already use in this family: a writer that silently drops a block a caller cared about is indistinguishable from one that never saw it, so every drop this writer makes deliberately names itself through a code below. The read side keeps its own established tiers instead -- PptFormatError for malformed bytes, PptEncryptedError for a file that is deliberately unreadable without a key, and per-construct degradation that keeps the shape's geometry (an unresolvable blip reference reads as a picture with no image) -- none of which needs a sink to be visible.
//
// No Zod schema wraps PptDiagnostic, matching MarkdownDiagnostic's, PdfDiagnostic's, EpubDiagnostic's and RtfDiagnostic's own precedent: a diagnostic is produced exclusively by this package's own pipeline, is consumed by a caller-supplied sink rather than round-tripped through JSON, and validating our own output would validate nothing a caller couldn't already see from the TypeScript type itself.

export type PptDiagnosticSeverity = "info" | "warning";

export interface PptDiagnostic {
  // A stable, namespaced code (e.g. 'ppt/block-dropped') -- callers branch on this, not on `message`, which is free text for humans. See PptDiagnosticCodes below for the codes this package names.
  readonly code: string;
  readonly severity: PptDiagnosticSeverity;
  readonly message: string;
}

export type PptDiagnosticSink = (diagnostic: PptDiagnostic) => void;

// Deliberately prefixed (the same discipline rtf-codec's NOOP_RTF_DIAGNOSTIC_SINK states for itself): documents.js composes several of these packages' no-op sinks into the same modules, and an unprefixed name here would collide on import.
export const NOOP_PPT_DIAGNOSTIC_SINK: PptDiagnosticSink = () => {
  /* discards every diagnostic -- the deliberate default for a caller that doesn't want them */
};

export const PptDiagnosticCodes = {
  // Write side: an image block this writer cannot carry as a blip -- a format MSOBLIPTYPE has no decodable token for here (svg, gif), or a second image on a shape whose one pib reference the first already consumed.
  IMAGE_DROPPED: "ppt/image-dropped",
  // Write side: a block kind with no [MS-PPT] spelling this writer produces (a page break, a construct marker, and every further kind the README's write-scope section names). The message names the kind and where it sat.
  BLOCK_DROPPED: "ppt/block-dropped",
  // Write side: a table cell's colSpan or rowSpan, which the binary format's tables cannot state at all -- a PowerPoint 97-2003 table is a strict grid of shapes with no merge records (PowerPoint itself gained merged cells only in the 2010 XML format), so the cell's text is kept, sized to its single grid position, and the span is reported rather than silently narrowed.
  TABLE_SPAN_DROPPED: "ppt/table-span-dropped",
} as const;
