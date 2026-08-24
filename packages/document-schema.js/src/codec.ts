import type { ContentDocument } from "./content";

// This contract describes what an individual format's own codec naturally provides -- not what DocumentTree requires. A codec's read() never returns a DocumentTree directly; the package is the *assembled* tree produced by decomposing the flat ContentDocument a reader returns (src/package.ts's three laws). Nothing here constructs a DocumentTree; that composition happens one level up, in whatever code owns both a ContentCodec and a layout engine for the same format.

// There is deliberately no LayoutCodec alongside this any more. Releases 1.x-3.x exported one -- read() to a LayoutDocument, write() back -- modelling the single format that produces layout cheaply on read: PDF. The whole LayoutDocument family moved to pdf-codec in this major (ExaDev/pdf-codec#65), where it is that codec's own private model, so the interface that described it belongs there too, alongside it. Callers that held a LayoutCodec over a PDF codec hold pdf-codec's own read/write signatures directly once they migrate.

// A format's own content codec: read() decodes that format's bytes into a ContentDocument; write(), where the format supports it, encodes a ContentDocument back into that format's bytes. write() is deliberately optional -- this models a real, permanent asymmetry, not a temporary gap. The odf format (a standalone ODF formula document) has a reader but genuinely no builder at all: recovering structured MathML from rendered glyphs is a categorically different, OCR-adjacent problem than generating them, so no ContentDocument-to-odf writer exists or is planned.
export interface ContentCodec<TOptions = unknown> {
  read(bytes: Uint8Array, options?: TOptions): ContentDocument;
  write?(content: ContentDocument, options?: TOptions): Uint8Array;
}

// TOptions is generic per codec rather than a single shared options type across every ContentCodec implementation, since each real format's own read/write options are format-specific today (an AbortSignal, a font-substitution callback, a diagnostic sink) and this package has no reason to force them into one shared shape that would either be too narrow for some formats or carry fields meaningless to others.
