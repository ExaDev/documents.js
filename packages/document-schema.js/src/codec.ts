import type { ContentDocument } from './content';
import type { LayoutDocument } from './layout';

// These two contracts describe what an individual format's own codec naturally provides -- not what DocumentPackage requires. A codec's read() never returns a DocumentPackage directly; it returns one half. DocumentPackage (content required, layout optional -- see its own doc comment in package.ts) is the *assembled* format produced by composing a ContentCodec.read() result with a *separately run* layout-engine pass. Nothing here constructs a DocumentPackage; that composition happens one level up, in whatever code owns both a ContentCodec and a layout engine for the same format.

// The two contracts are asymmetric rather than a single unified DocumentCodec operating on DocumentPackage, because the formats they model are asymmetric. Most formats (docx/pptx/odt/odp/ods/odg/markdown) only ever produce content on read -- layout for them is always a separate, later, engine-driven step, never something their own codec produces directly. PDF is the mirror image: it produces layout cheaply on read, and content only via a separate, expensive, lossy, opt-in reconstruction pass that is emphatically not part of "reading" a PDF. Forcing a single contract shaped like DocumentPackage would mean either fabricating empty content for every non-PDF format's codec (impossible, they have none to fabricate) or making every PDF read pay reconstruction cost it usually doesn't want (the wrong default). Keeping ContentCodec and LayoutCodec separate lets each format implement only the half it actually has.

// A format's own content codec: read() decodes that format's bytes into a ContentDocument; write(), where the format supports it, encodes a ContentDocument back into that format's bytes. write() is deliberately optional -- this models a real, permanent asymmetry, not a temporary gap. The odf format (a standalone ODF formula document) has a reader but genuinely no builder at all: recovering structured MathML from rendered glyphs is a categorically different, OCR-adjacent problem than generating them, so no ContentDocument-to-odf writer exists or is planned.
export interface ContentCodec<TOptions = unknown> {
  read(bytes: Uint8Array, options?: TOptions): ContentDocument;
  write?(content: ContentDocument, options?: TOptions): Uint8Array;
}

// A format's own layout codec: read() decodes that format's bytes into a LayoutDocument; write() encodes a LayoutDocument back into that format's bytes. Unlike ContentCodec.write, LayoutCodec.write is not optional -- PDF is the only format with a LayoutCodec implementation anywhere in this family, and it always supports both directions (a PDF is written from a LayoutDocument exactly as readily as it is read into one), so there is no real asymmetry here to model.
export interface LayoutCodec<TOptions = unknown> {
  read(bytes: Uint8Array, options?: TOptions): LayoutDocument;
  write(layout: LayoutDocument, options?: TOptions): Uint8Array;
}

// TOptions is generic per codec rather than a single shared options type across every ContentCodec/LayoutCodec implementation, since each real format's own read/write options are format-specific today (an AbortSignal, a font-substitution callback, a diagnostic sink) and this package has no reason to force them into one shared shape that would either be too narrow for some formats or carry fields meaningless to others.
