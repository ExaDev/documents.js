// A real, vendored TrueType font face, recovered through documents.js's own public createFontRegistry API rather than shipped as a binary fixture in this repository. Resolving 'Cambria' returns pdf-codec's vendored Caladea substitute -- genuinely metric-compatible with Cambria, embedded as a real subsetted TrueType font program (see documents.js's own README, "Fonts"). Ported from document-cli's own src/test-support/font-fixture.ts (vendoredCaladeaFaceBytes).
import { createFontRegistry, type ResolvedFace } from "documents.js";

// createFontRegistry() genuinely never returns anything but an embedded face for "Cambria" (its vendored substitute table resolves that family unconditionally), so this guard has no real input that exercises its own throw. Extracted to take the already-resolved ResolvedFace directly, rather than calling resolve() itself, so a test can drive the throw with a hand-built "standard" result instead of it staying permanently unreachable.
export function requireEmbeddedFace(
  resolved: ResolvedFace,
): Extract<ResolvedFace, { kind: "embedded" }> {
  if (resolved.kind !== "embedded") {
    throw new Error(
      `expected documents.js's vendored substitute table to embed a face for Cambria, got a ${resolved.kind} face`,
    );
  }
  return resolved;
}

export function vendoredFontBytes(): Uint8Array<ArrayBuffer> {
  const resolved = createFontRegistry().resolve({
    family: "Cambria",
    weight: "normal",
    style: "normal",
  });
  return requireEmbeddedFace(resolved).face.font.bytes;
}
