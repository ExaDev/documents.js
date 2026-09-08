import type { AnchorType } from "document-schema.js";
import { EpubDiagnosticCodes, type EpubDiagnosticSink } from "../diagnostics";
import type { XmlElement } from "../xml/node";

// One resolved anchor target: which construct kind it is (only "footnote" or "bookmark" -- this package's own reader never produces an "endnote" or "comment" anchor from real EPUB content) and the canonical name both its own constructStart marker and every reference to it must carry. The name is the bare fragment for a target with no cross-document referrer, or "targetHref#fragment" (src/read.ts's own whole-spine registry, ExaDev/documents.js#963) once at least one cross-document href references it, so a bare id colliding between two different target documents can never be confused for one shared target.
export interface ResolvedAnchorTarget {
  readonly anchorType: AnchorType;
  readonly name: string;
}

// Shared read-side context threaded through src/xhtml/read.ts and src/xhtml/inline.ts.
export interface XhtmlReadContext {
  // Resolves a manifest-relative image href (already resolved against the XHTML document's own directory by the caller, src/read.ts) to raw bytes, or undefined if the manifest names no such part. A port rather than a direct zip lookup, so this module stays free of any OCF/zip knowledge of its own.
  readonly resolveImage: (href: string) => Uint8Array<ArrayBuffer> | undefined;
  readonly sink: EpubDiagnosticSink;
  // The manifest href of the XHTML document being read, carried on every diagnostic this stage reports so a caller can tell which spine item a gap came from.
  readonly sourceHref: string;
  // Every element in this document carrying an `id` attribute, keyed by that id -- built once per document (src/xhtml/read.ts's own whole-body pre-pass) so anchor-target and same-document link resolution never re-walks the tree per reference.
  readonly idElements: ReadonlyMap<string, XmlElement>;
  // Every id in THIS document recognised as an anchor target (a footnote/endnote BODY, or an ordinary internal-link target) that some href -- same-document, or another spine document's own -- resolves to, and how src/xhtml/read.ts's own block-level walk should wrap it: a footnote-shaped reference (EPUB 3 epub:type="noteref"/"footnote", or the EPUB 2 class convention -- src/xhtml/footnote.ts's isFootnoteReference) always wins the same id over an ordinary bookmark reading of it.
  readonly anchorTargets: ReadonlyMap<string, ResolvedAnchorTarget>;
  // Resolves an <a href> (same-document or cross-document) to the ResolvedAnchorTarget a run-level construct extent should carry, or undefined when the href does not resolve to a real, addressable in-package element -- the single place src/xhtml/inline.ts's appendAnchor (and src/xhtml/read.ts's own <pre> footnote-reference walk) decides between a footnote/link construct and the plain ContentRun.hyperlink degrade. Threaded as a closure rather than a plain map because a cross-document resolution needs the whole spine's own id tables, which this document's own context has no reason to hold directly -- src/read.ts's own whole-spine pass builds the real one; a standalone readXhtmlBody call (every unit test in this package) falls back to a same-document-only resolver.
  readonly resolveAnchorHref: (
    href: string,
  ) => ResolvedAnchorTarget | undefined;
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

// Elements whose own subtree is never legitimate document prose, wherever it is reached during a body read -- the single shared definition for a check src/xhtml/read.ts used to duplicate three separate ways (an id/heading/anchor prescan's own descendant walk via isInertContainer, a stray-content collector's own isScriptSupportingElement, and a <pre> text extractor's own inline tag-literal check) and src/xhtml/inline.ts duplicated a fourth way (a dedicated switch case in buildInlineRuns's own per-node dispatch), so a future addition to this set can never silently miss one of the several places that needs to agree on it. <script>'s raw JS source and <template>'s inert DOM subtree are never real content per the HTML Standard's own "script-supporting elements" category. <style> in body content is CSS, exactly like the <head>-level style residue this package already quarantines rather than interprets (src/xhtml/read.ts's readStyleResidue) -- there is no per-element residue channel for a body-level <style>, so it is simply skipped rather than captured. <noscript> is included for the identical residue-not-content reasoning, deliberately conservative about the ambiguity it carries: its own children ARE ordinary markup a scripting-disabled reading system would genuinely render, but a producer commonly uses it for a "please enable JavaScript" placeholder that would be actively wrong to surface as document prose, and this package has no way to tell the two apart from the markup alone.
export function isInertElement(tag: string): boolean {
  return (
    tag === "script" ||
    tag === "template" ||
    tag === "style" ||
    tag === "noscript"
  );
}

// Every real content-discarding site that calls isInertElement above (as opposed to a pure prescan like buildIdElementMap/elementsWithTagSkippingInert/containsHeading/containsFootnoteReference in src/xhtml/read.ts, none of which drop content themselves -- the subtree they skip over is still read normally elsewhere) calls this immediately alongside it. <script>'s raw JS, <template>'s inert DOM, and body-level <style>'s CSS are never real content regardless of where they are found, so dropping them stays silent; <noscript> is the one member of the set whose own children genuinely can be ordinary, renderable document markup (isInertElement's own comment above), so discarding its subtree without a trace would contradict this package's documented degrade-with-diagnostic policy -- a real loss that happens to be indistinguishable, from the markup alone, from a producer's inert "please enable JavaScript" placeholder is still a loss worth naming.
export function reportInertElementSkip(
  tag: string,
  context: XhtmlReadContext,
): void {
  if (tag !== "noscript") {
    return;
  }
  context.sink({
    code: EpubDiagnosticCodes.NOSCRIPT_CONTENT_SKIPPED,
    severity: "info",
    message:
      "<noscript>'s own subtree is skipped rather than read as document content -- its markup can be a scripting-disabled reading system's genuine rendered content, or a producer's own 'please enable JavaScript' placeholder, and this package cannot tell the two apart from the markup alone",
    href: context.sourceHref,
  });
}
