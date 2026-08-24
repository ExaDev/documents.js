// The font-resolution port contracts a conversion's font layer consumes, independent of any concrete font backend. pdf-codec implements the registry (FontRegistry + the vendored/embedded face machinery); documents.js's src/fonts/ produces ProvidedFont[] from source documents and src/convert/ composes them into a registry. Only the pure data contracts a caller supplies or observes live here; the registry interface itself and its PDF-specific return type (ResolvedFace, carrying the embedded-face and standard-14-name arms) stay in pdf-codec, where the implementation is. Mirrors src/codec.ts's own precedent of hosting contracts alongside the Zod schemas.

// A single face a caller (or the document source) hands in: raw sfnt bytes (a real .ttf/.otf payload) plus the family/bold/italic triple it should be matched against. `bytes` is exactly `Uint8Array<ArrayBuffer>` (not the wider `Uint8Array<ArrayBufferLike>`) because a concrete font backend parses it in place and requires the ArrayBuffer-backed variant.
export interface ProvidedFont {
  readonly family: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

// The structured result of inspecting a standalone sfnt font file (.ttf/.otf): the family/bold/italic triple the file itself declares, without the raw bytes ProvidedFont carries. documents.js's `describeFontFace` produces this (wrapping pdf-codec's own font-file parser), so a caller wanting to turn an arbitrary font file into a ProvidedFont can discover its face triple first and then supply the bytes alongside it.
export interface FontFace {
  readonly family: string;
  readonly bold: boolean;
  readonly italic: boolean;
}

// Reported whenever font resolution did not land on an exact-face match: either a family match narrowed down to that family's own regular face ('missing-face'), or a fall-through to a vendored metric-compatible substitute ('vendored-substitute'). Never raised for the standard-14 fallback itself -- that is the unconditional baseline, not a new event worth surfacing.
export interface FontSubstitution {
  readonly requestedFamily: string;
  readonly requestedBold: boolean;
  readonly requestedItalic: boolean;
  readonly reason: "missing-face" | "vendored-substitute";
  // The family whose face was actually used: the same requested family for 'missing-face' (only the weight/style narrowed), or the vendored family name for 'vendored-substitute'.
  readonly resolvedFamily: string;
}

export interface FontRegistryOptions {
  readonly sourceFonts?: readonly ProvidedFont[];
  readonly fonts?: readonly ProvidedFont[];
  // 'none' disables the vendored substitute table entirely, for a caller that wants only its own supplied faces. Defaults to 'vendored'.
  readonly substitutes?: "vendored" | "none";
  readonly onSubstitution?: (substitution: FontSubstitution) => void;
}
