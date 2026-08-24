// Composes a source package's own embedded fonts with any caller-supplied faces into a real pdf-codec FontRegistry. This is the whole point of the two extractors either side of it: createFontRegistry already resolves `sourceFonts` ahead of `fonts` ahead of its vendored Carlito/Caladea substitutes ahead of the standard 14, so putting the source document's own embedded bytes in the `sourceFonts` slot is exactly the "source-embedded beats a substitute whenever it exists" precedence this package wants, expressed as data rather than as a branch.
//
// The two Package types are structurally identical (src/interop.test.ts is the standing type-level proof), so the discriminant here is not about the container shape -- it selects which extractor to run, since where an embedded font is declared is genuinely format-specific.
import type { Package as OoxmlPackage } from "ooxml.js";
import type { Package as OdfPackage } from "odf.js";
import type { FontRegistry } from "pdf-codec";
import type { FontSubstitution, ProvidedFont } from "document-schema.js";
import { createFontRegistry } from "pdf-codec";
import { extractOdfEmbeddedFonts } from "./odf";
import { extractOoxmlEmbeddedFonts } from "./ooxml";

export type FontSourcePackage =
  | { readonly kind: "docx" | "pptx"; readonly package: OoxmlPackage }
  | { readonly kind: "odf"; readonly package: OdfPackage };

export interface DocumentFontRegistryOptions {
  // Faces the caller wants available on top of whatever the source package embedded. Consulted only where the source has no exact family+bold+italic match of its own, so supplying a face here can never override the document's own embedded bytes.
  readonly fonts?: readonly ProvidedFont[];
  // Reports a face-level fallback: a requested family+bold+italic that resolved to a different face of the same family, or to a vendored substitute. Deliberately NOT named onSubstitution: the conversion functions in src/convert/ already use that name for pdf-codec's own WinAnsiSubstitution channel (a character not representable in a standard-14 font), and the two report genuinely different events at different granularities.
  readonly onFontSubstitution?: (substitution: FontSubstitution) => void;
}

// Every font face the given source package embeds. Split out from createDocumentFontRegistry so a caller that wants the faces themselves -- to inspect them, to forward them to a second conversion, or to merge several documents' fonts -- does not have to build a registry to get at them.
export function extractSourceFonts(source: FontSourcePackage): ProvidedFont[] {
  return source.kind === "odf"
    ? extractOdfEmbeddedFonts(source.package)
    : extractOoxmlEmbeddedFonts(source.package, source.kind);
}

// A FontRegistry backed first by the source package's own embedded faces, then by the caller's, then by pdf-codec's vendored substitutes and the standard 14. Safe to call for a package that embeds nothing: `sourceFonts` is then empty and the registry behaves exactly as an un-configured one would.
export function createDocumentFontRegistry(
  source: FontSourcePackage,
  options?: DocumentFontRegistryOptions,
): FontRegistry {
  return createFontRegistry({
    sourceFonts: extractSourceFonts(source),
    fonts: options?.fonts,
    onSubstitution: options?.onFontSubstitution,
  });
}
