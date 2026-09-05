// The read-side diagnostic sink, matching markdown-codec's own three-tier MarkdownDiagnosticSink policy exactly (which itself matches pdf-codec's PdfDiagnosticSink): throw for input this package cannot meaningfully process at all; recover-with-diagnostic for a package that is spec-legal but almost certainly a producer mistake, where continuing with a reasonable fallback is more useful than failing the whole read; degrade-with-diagnostic for an individual construct this package's own ContentDocument mapping cannot represent, while the rest of the document still reads. A hand-written EPUB reader this size cannot match a mature reading system's robustness against adversarial or malformed real-world files, so every situation is assigned to one of these three tiers explicitly rather than picked ad hoc at the call site that first encounters it.
//
// No Zod schema wraps EpubDiagnostic, matching PdfDiagnostic's/MarkdownDiagnostic's own precedent: a diagnostic is produced exclusively by this package's own read pipeline, is consumed by a caller-supplied sink rather than round-tripped through JSON, and validating our own output would validate nothing a caller couldn't already see from the TypeScript type itself.

export type EpubDiagnosticSeverity = "info" | "warning";

export interface EpubDiagnostic {
  // A stable, namespaced code (e.g. 'epub/nav-spine-order-mismatch', 'epub/image-format-unsupported') -- callers are expected to branch on this, not on `message`, which is free text for humans. See EpubDiagnosticCodes below for the codes this layer already names.
  readonly code: string;
  readonly severity: EpubDiagnosticSeverity;
  readonly message: string;
  // The manifest href / spine idref the diagnostic applies to, when the read pipeline stage producing it has one to hand -- most do, since almost every degrade-tier gap is tied to one spine item's own XHTML content, not document-wide.
  readonly href?: string;
}

// Recover/degrade-tier issues are reported through a sink rather than thrown, so a single malformed nav entry or unsupported image format degrades that one part rather than aborting the whole document. A no-op sink is a legitimate choice for a caller that doesn't want diagnostics.
export type EpubDiagnosticSink = (diagnostic: EpubDiagnostic) => void;

export const NOOP_EPUB_DIAGNOSTIC_SINK: EpubDiagnosticSink = () => {
  /* discards every diagnostic -- the deliberate default for a caller that doesn't want them */
};

// Recover tier: an EPUB that parses under this package's own OCF/OPF/nav grammar without a thrown error, but that a real producer almost certainly did not intend, or that this package resolves via a documented fallback rather than the strict spec reading.
//
// Degrade tier: an individual construct src/xhtml's ContentDocument mapping (or src/write's inverse) cannot represent faithfully. Every one of these is reachable from real EPUB input; src/xhtml/read.test.ts and src/xhtml/write.test.ts each exercise the codes their own stage produces, and src/diagnostics.test.ts asserts the whole EpubDiagnosticCodes table has no dead entry.
export const EpubDiagnosticCodes = {
  // src/nav (read side: nav.xhtml/NCX -> outline, reconciled against the spine)
  NAV_SPINE_ORDER_MISMATCH: "epub/nav-spine-order-mismatch",
  NCX_MISSING: "epub/ncx-missing",
  NAV_DOCUMENT_MISSING: "epub/nav-document-missing",
  // src/opf (read side: manifest/spine/metadata)
  MANIFEST_ITEM_MISSING: "epub/manifest-item-missing",
  SPINE_ITEMREF_UNRESOLVED: "epub/spine-itemref-unresolved",
  METADATA_FIELD_UNMAPPED: "epub/metadata-field-unmapped",
  // src/xhtml (read side: XHTML -> ContentDocument)
  IMAGE_FORMAT_UNSUPPORTED: "epub/image-format-unsupported",
  IMAGE_UNRESOLVED: "epub/image-unresolved",
  IMAGE_INLINE_UNSUPPORTED: "epub/image-inline-unsupported",
  IMAGE_PRE_UNSUPPORTED: "epub/image-pre-unsupported",
  ELEMENT_UNMAPPED: "epub/element-unmapped",
  STYLE_RESIDUE: "epub/style-residue",
  FOOTNOTE_TARGET_UNRESOLVED: "epub/footnote-target-unresolved",
  LINK_TARGET_EXTERNAL_ONLY: "epub/link-target-external-only",
  TABLE_CAPTION_UNSUPPORTED: "epub/table-caption-unsupported",
  LIST_CONTENT_OUTSIDE_ITEM: "epub/list-content-outside-item",
  // src/xhtml (write side: ContentDocument -> XHTML)
  CONSTRUCT_UNREPRESENTED: "epub/construct-unrepresented",
  // src/read.ts (package-level: invented page geometry, matching markdown-codec's own precedent)
  INVENTED_PAGE_GEOMETRY: "epub/invented-page-geometry",
} as const;

// The throw tier: input this package cannot meaningfully process at all, regardless of what a diagnostic sink could report about it. Carries the same `code` vocabulary as EpubDiagnostic so a caller can distinguish failure reasons programmatically, not just by message text.
export class EpubParseError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "EpubParseError";
    this.code = code;
  }
}

// The zip's first entry is not a stored "mimetype" entry containing exactly "application/epub+zip" -- thrown before any OCF/OPF parsing begins, since without it this is not identifiable as an EPUB at all (EPUB 3.3 section 6.3).
export class EpubInvalidMimetypeError extends EpubParseError {
  constructor(
    message = 'the zip\'s first entry is not a stored "mimetype" entry containing exactly "application/epub+zip"',
  ) {
    super("epub/invalid-mimetype", message);
    this.name = "EpubInvalidMimetypeError";
  }
}

// META-INF/container.xml is missing, unparsable, or names no OPF rootfile -- thrown because there is no package document to read metadata/manifest/spine from at all (EPUB 3.3 section 6.7.2).
export class EpubInvalidContainerError extends EpubParseError {
  constructor(
    message = "META-INF/container.xml is missing or names no OPF rootfile",
  ) {
    super("epub/invalid-container", message);
    this.name = "EpubInvalidContainerError";
  }
}

// The OPF rootfile is missing from the zip, or does not parse as a well-formed <package> document -- thrown because there is no manifest or spine to resolve content from.
export class EpubInvalidOpfError extends EpubParseError {
  constructor(message: string) {
    super("epub/invalid-opf", message);
    this.name = "EpubInvalidOpfError";
  }
}

// The spine names no readable content at all (an empty spine, or every itemref unresolved) -- thrown because a wordprocessing ContentDocument with zero sections is not a meaningful read of an EPUB, however malformed.
export class EpubEmptySpineError extends EpubParseError {
  constructor(message = "the spine names no resolvable, readable content") {
    super("epub/empty-spine", message);
    this.name = "EpubEmptySpineError";
  }
}

// The write-side counterpart to EpubParseError -- input this package's writeEpubContent/writeEpub cannot meaningfully render at all, regardless of what a diagnostic sink could report about it. Carries the same `code` vocabulary convention.
export class EpubWriteError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "EpubWriteError";
    this.code = code;
  }
}

// Thrown by writeEpubContent when handed a ContentDocument whose kind is not 'wordprocessing' -- EPUB has no presentation/spreadsheet/drawing equivalent to render, matching markdown-codec's own MarkdownUnsupportedDocumentKindError precedent exactly.
export class EpubUnsupportedDocumentKindError extends EpubWriteError {
  readonly kind: string;

  constructor(kind: string) {
    super(
      "epub/write-side-not-wordprocessing",
      `writeEpubContent only supports a 'wordprocessing' ContentDocument, got '${kind}'`,
    );
    this.name = "EpubUnsupportedDocumentKindError";
    this.kind = kind;
  }
}

// Thrown by writeEpubContent when handed a ContentDocument whose block list's construct boundary markers (document-schema.js's ContentConstructStart/ContentConstructEnd) do not pair up as balanced brackets -- the identical rationale as markdown-codec's own MarkdownUnbalancedConstructMarkersError: an unbalanced list is malformed input rather than a shape to repair, since the schema's own bracket-matching contract states the blocks between a matched pair ARE the construct's extent. Detected via document-schema.js's own findConstructMarkerImbalance.
export class EpubUnbalancedConstructMarkersError extends EpubWriteError {
  readonly imbalanceKind: "unmatchedEnd" | "unclosedStart";
  readonly blockIndex: number;

  constructor(
    imbalanceKind: "unmatchedEnd" | "unclosedStart",
    blockIndex: number,
  ) {
    const description =
      imbalanceKind === "unmatchedEnd"
        ? "a constructEnd marker closes no open construct"
        : "a constructStart marker is never closed";
    super(
      "epub/unbalanced-construct-markers",
      `${description} at block index ${String(blockIndex)}; a block list's construct boundary markers must pair as balanced brackets`,
    );
    this.name = "EpubUnbalancedConstructMarkersError";
    this.imbalanceKind = imbalanceKind;
    this.blockIndex = blockIndex;
  }
}

// Thrown by writeEpub when document-schema.js's own flattenTree rejects the package it was handed -- a group carrying a style ref with no top-level styles table to resolve it against is the one case reachable for a 'wordprocessing' package. flattenTree itself throws a bare Error for this, wrapped here so a caller catching EpubWriteError catches it too, matching markdown-codec's own MarkdownPackageFlattenError precedent.
export class EpubPackageFlattenError extends EpubWriteError {
  constructor(cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(
      "epub/package-flatten-failed",
      `flattening the package for write failed: ${detail}`,
    );
    this.name = "EpubPackageFlattenError";
  }
}
