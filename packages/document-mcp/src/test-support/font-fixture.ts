// A real, vendored TrueType font face, recovered through documents.js's own public createFontRegistry API rather than shipped as a binary fixture in this repository. Resolving 'Cambria' returns pdf-codec's vendored Caladea substitute -- genuinely metric-compatible with Cambria, embedded as a real subsetted TrueType font program (see documents.js's own README, "Fonts"). Ported from document-cli's own src/test-support/font-fixture.ts (vendoredCaladeaFaceBytes).
import { createFontRegistry } from 'documents.js';

export function vendoredFontBytes(): Uint8Array<ArrayBuffer> {
  const resolved = createFontRegistry().resolve({ family: 'Cambria', weight: 'normal', style: 'normal' });
  if (resolved.kind !== 'embedded') {
    throw new Error(`expected documents.js's vendored substitute table to embed a face for Cambria, got a ${resolved.kind} face`);
  }
  return resolved.face.font.bytes;
}
