// decodeSvgText/encodeSvgText: the byte <-> text boundary for svg, exactly mirroring src/csv/text.ts's own pair (csv being the other plain-text format with no upstream codec package). A fresh TextDecoder/TextEncoder is constructed per call, never module-level cached -- this package's own sideEffects:false convention (package.json) means nothing here creates shared mutable state at import time.
//
// decodeSvgText uses a fatal-mode TextDecoder specifically so a non-UTF-8 input throws here, at the boundary, rather than silently producing U+FFFD replacement characters that would then corrupt every downstream title string and path the read path produces -- the identical reasoning src/model/bytes.ts's own SvgBytesSchema documents for the schema-validation path. This function is the enforcement point for the ergonomic conversions (svgToPdf/svgToOdg and every composed route sourcing svg) that bypass the schema and call readSvgContent directly on already-checked bytes.
export class SvgInvalidUtf8Error extends Error {
  constructor() {
    super('svg text must be well-formed UTF-8');
    this.name = 'SvgInvalidUtf8Error';
  }
}

export function decodeSvgText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new SvgInvalidUtf8Error();
  }
}

export function encodeSvgText(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}
