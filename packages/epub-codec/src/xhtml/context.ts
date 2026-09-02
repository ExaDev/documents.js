import type { EpubDiagnosticSink } from "../diagnostics";
import type { XmlElement } from "../xml/node";

// Shared read-side context threaded through src/xhtml/read.ts and src/xhtml/inline.ts.
export interface XhtmlReadContext {
  // Resolves a manifest-relative image href (already resolved against the XHTML document's own directory by the caller, src/read.ts) to raw bytes, or undefined if the manifest names no such part. A port rather than a direct zip lookup, so this module stays free of any OCF/zip knowledge of its own.
  readonly resolveImage: (href: string) => Uint8Array<ArrayBuffer> | undefined;
  readonly sink: EpubDiagnosticSink;
  // The manifest href of the XHTML document being read, carried on every diagnostic this stage reports so a caller can tell which spine item a gap came from.
  readonly sourceHref: string;
  // Every element in this document carrying an `id` attribute, keyed by that id -- built once per document (src/xhtml/read.ts's own whole-body pre-pass) so footnote-target and same-document link resolution never re-walks the tree per reference.
  readonly idElements: ReadonlyMap<string, XmlElement>;
  // Every id recognised as a footnote/endnote BODY target -- built once per document by walking every <a> and asking isFootnoteReferenceAnchor which id (if any) it names, so src/xhtml/read.ts's own block-level walk can tell "this <p id=...> is a footnote body to bracket" from "this is an ordinary paragraph that merely happens to carry an id" without re-deriving the same anchor-recognition logic from the other direction.
  readonly footnoteTargetIds: ReadonlySet<string>;
  // The current blockquote nesting depth (0 outside any blockquote), threaded so a nested quote's indent and division-construct pairing both scale with real depth.
  readonly quoteDepth: number;
}

export interface InlineStyle {
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly strike?: boolean;
  readonly fontFamily?: string;
}
