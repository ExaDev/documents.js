// Image resolution: a MarkdownImageNode's `destination` -> document-schema.js's ContentImageBlock, via a caller-supplied, SYNCHRONOUS MarkdownImageResolver port. This package never performs network I/O or filesystem access itself, matching its own "hand-write the format, no ambient I/O" convention -- a `data:image/png;base64,...`/`data:image/jpeg;base64,...` URI resolves NATIVELY (its bytes are already in the markdown source text, nothing to fetch), decoded via src/image/image.ts's own base64ToBytes and measured via readImageDimensions/detectImageFormat; anything else (a bare http(s):// URL, a relative path) is handed to the resolver port. An unresolved image -- no resolver supplied, the resolver returns undefined, or the resolved bytes are neither a readable PNG nor a readable JPEG (ContentImageBlockSchema's own `format` enum has no third member to fall back to) -- returns undefined here and NEVER becomes an invalid ContentImageBlock; the caller (src/lower/lower.ts) degrades it to a text run of alt text plus hyperlink instead, per MarkdownDiagnosticCodes.IMAGE_UNRESOLVED.

import { base64ToBytes, bytesToBase64, detectImageFormat, readImageDimensions } from '../image/image';
import type { ImageFormat } from '../image/image';

export interface MarkdownImageResolveContext {
  readonly alt: string;
  readonly title?: string;
}

export interface MarkdownResolvedImageBytes {
  readonly bytes: Uint8Array;
}

export type MarkdownImageResolver = (destination: string, context: MarkdownImageResolveContext) => MarkdownResolvedImageBytes | undefined;

export interface ResolvedMarkdownImage {
  readonly format: ImageFormat;
  readonly base64: string;
  readonly widthPt: number;
  readonly heightPt: number;
}

// The CSS reference-pixel definition (1px = 1/96in), the same px<->pt conversion browsers themselves use -- document-schema.js's own ContentImageBlock is point-based throughout (matching the rest of this family's PDF/docx/ODF unit convention), while a decoded PNG/JPEG header only ever reports pixel dimensions.
const CSS_PIXELS_PER_INCH = 96;
const POINTS_PER_INCH = 72;
const POINTS_PER_PIXEL = POINTS_PER_INCH / CSS_PIXELS_PER_INCH;

const DATA_URI_PATTERN = /^data:image\/(?:png|jpe?g);base64,(.+)$/is;

function decodeDataUriImage(destination: string): Uint8Array | undefined {
  const match = DATA_URI_PATTERN.exec(destination);
  const base64 = match?.[1];
  if (base64 === undefined) {
    return undefined;
  }
  try {
    return base64ToBytes(base64);
  } catch {
    return undefined;
  }
}

export function resolveMarkdownImage(destination: string, context: MarkdownImageResolveContext, resolver: MarkdownImageResolver | undefined): ResolvedMarkdownImage | undefined {
  const bytes = decodeDataUriImage(destination) ?? resolver?.(destination, context)?.bytes;
  if (bytes === undefined) {
    return undefined;
  }
  const format = detectImageFormat(bytes);
  const dimensions = readImageDimensions(bytes);
  if (format === undefined || dimensions === undefined) {
    return undefined;
  }
  return {
    format,
    base64: bytesToBase64(bytes),
    widthPt: dimensions.widthPx * POINTS_PER_PIXEL,
    heightPt: dimensions.heightPx * POINTS_PER_PIXEL,
  };
}
