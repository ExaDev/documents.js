// decodeSvgText/encodeSvgText: the byte <-> text boundary for svg, exactly mirroring src/csv/text.ts's own pair (csv being the other plain-text format with no upstream codec package). A fresh TextEncoder is constructed per call, never module-level cached: this package's own sideEffects:false convention (package.json) means nothing here creates shared mutable state at import time.
//
// decodeSvgText no longer assumes UTF-8 the way csv and markdown once did, but it does not detect the encoding from the bytes the way those two now do either (ExaDev/documents.js#1315, #1360), because SVG is XML, and XML carries its own authoritative encoding declaration in its prolog. A general-purpose detector that guessed and ignored that declaration would decode a file differently from every other XML tool reading it: a worse answer than refusing, not a better one. decodeSvgText instead reads the declaration first (src/svg/xml-encoding.ts, following XML 1.0's own external-encoding-detection algorithm: a byte order mark, then the <?xml ... encoding="..."?> declaration itself), hands whatever it finds to byte-codec's decodeText as an explicit encoding, and falls back to XML's own default of UTF-8, decoded strictly, only when neither is present, never to decodeText's own windows-1252 guess, which is a legitimate answer for prose with no declaration but not for a format whose own spec already says what "no declaration" means.
//
// This function is the enforcement point for the ergonomic conversions (svgToPdf/svgToOdg and every composed route sourcing svg) that bypass the schema and call readSvgContent directly on already-checked bytes; src/model/bytes.ts's own SvgBytesSchema calls decodeSvgText directly too, for the identical reason: both are enforcement points for the identical contract, not two independent checks that could drift apart.
import type { TextEncodingLabel } from "byte-codec";
import { decodeText, UndecodableTextError } from "byte-codec";
import { detectSvgEncoding } from "./xml-encoding";

/** Thrown when an SVG document's own `<?xml ... encoding="..."?>` declaration names an encoding outside byte-codec's own bounded decodeText set: a legacy CJK or Cyrillic code page, or a name this package does not recognise as an alias of one of the six it does support (ExaDev/documents.js#1361). */
export class SvgUnsupportedEncodingError extends Error {
  /** The declaration's own raw label, exactly as written in the document. */
  readonly label: string;

  constructor(label: string) {
    super(
      `svg declares an encoding this package cannot decode: "${label}" (ExaDev/documents.js#1361)`,
    );
    this.name = "SvgUnsupportedEncodingError";
    this.label = label;
  }
}

/** Thrown when svg bytes cannot be decoded as text under the encoding that settled it: a byte order mark or an `<?xml ...?>` declaration named one the bytes then contradict, or, with neither present, the bytes are not well-formed UTF-8, XML's own default. */
export class SvgUndecodableTextError extends Error {
  /** The encoding the bytes were decoded against and failed. */
  readonly encoding: TextEncodingLabel;

  constructor(encoding: TextEncodingLabel, cause: UndecodableTextError) {
    super(`svg bytes are not well-formed ${encoding}: ${cause.message}`, {
      cause,
    });
    this.name = "SvgUndecodableTextError";
    this.encoding = encoding;
  }
}

/**
 * Decodes svg bytes to text, honouring the encoding a byte order mark or an `<?xml ...?>` declaration names and defaulting to strict UTF-8, XML's own default, when neither is present.
 * @param bytes - The svg bytes.
 * @throws SvgUnsupportedEncodingError When the declaration names an encoding outside byte-codec's own bounded set.
 * @throws SvgUndecodableTextError When the bytes contradict the encoding that settled them.
 * @returns The svg text.
 */
export function decodeSvgText(bytes: Uint8Array): string {
  const detected = detectSvgEncoding(bytes);
  if (detected?.kind === "unsupported") {
    throw new SvgUnsupportedEncodingError(detected.label);
  }
  const encoding: TextEncodingLabel = detected?.encoding ?? "utf-8";
  try {
    return decodeText(bytes, { encoding }).text;
  } catch (error) {
    if (error instanceof UndecodableTextError) {
      throw new SvgUndecodableTextError(encoding, error);
    }
    throw error;
  }
}

/**
 * Encodes svg text as UTF-8 bytes, with no `<?xml ...?>` declaration of its own.
 * @param text - The svg text.
 * @returns The UTF-8 bytes. A byte stream with no declaration and no byte order mark is UTF-8 under XML's own default, so {@link decodeSvgText} reads it back correctly without one.
 */
export function encodeSvgText(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}
