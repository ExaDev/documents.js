// pdf-codec's public surface: a curated barrel export, no subpath exports, matching document-schema.js/odf.js/ooxml.js's own precedent. What's exported here is every symbol a real external consumer needs -- headline read/write/codec entry points, the formula/math port documents.js's own MathML layout engine passes real values through, the text-layout and font-resolution helpers every layout engine built on this codec needs, and the full bytes/image surface (this package owns src/bytes/ and src/image/ outright; nothing duplicates them upstream). Internal plumbing (objects.ts, serialize.ts, lexer.ts, parse.ts, xref.ts, document.ts, interpret.ts, content-read.ts, content-write.ts, filters.ts, predictors.ts, images-read.ts, cmap.ts, font-read.ts, font-style.ts, and the cmap-table/hmtx-table/font-tables/glyf/math-table/sfnt/math-font-write/math-content-write font-parsing and font-embedding internals) stays unexported -- nothing outside this package's own src/ consumes it today.

// Headline: read/write/diagnostics/codec.
export type { ReadPdfOptions } from './read';
export { readPdf } from './read';
export type { WritePdfOptions } from './write';
export { writePdf } from './write';
export type { PdfDiagnostic, PdfDiagnosticSeverity, PdfDiagnosticSink } from './diagnostics';
export { NOOP_DIAGNOSTIC_SINK, PdfEncryptedError, PdfParseError, PdfPasswordRequiredError } from './diagnostics';
export type { WinAnsiSubstitution } from './winansi';
export { PdfBytesSchema, pdfCodec } from './codec';

// Formula/math: the structural port documents.js's own MathML layout engine (layoutFormula, staying in documents.js) produces real values against -- see src/math-types.ts and src/formula.ts for the full rationale.
export type { PositionedFormula } from './formula';
export type { MathBox, MathColor, MathFontMetrics, MathGlyphMetrics, MathGlyphRun, MathLayoutItem, MathRule, MathStroke } from './math-types';
export type { LoadedMathFont, MathFont, MathFontDescriptorMetrics } from './math-font';
export { loadMathFont } from './math-font';

// Text layout: consumed by every layout engine built on this codec (line-wrapping, run styling, underline metrics).
export type { UnderlineMetrics } from './measure';
export type { StandardFontMeasurerOptions, TextMeasurer } from './measure';
export { createStandardFontMeasurer } from './measure';
export type { StyledFragment, StyledRun, WrapOptions, WrappedLine } from './text-layout';
export { wrapRunsToWidth } from './text-layout';

// Geometry: shape/slide placement math (rotation about a pivot point).
export type { Point } from './matrix';
export { rotatePointAboutCenter } from './matrix';

// Font resolution: mapping an arbitrary requested font family/weight/style onto one of the 14 standard PDF faces, and that face's own AFM-derived metrics.
export type { FontMetrics, StandardFontName } from './afm-widths';
export { STANDARD_METRICS } from './afm-widths';
export type { ResolvedFont } from './fonts';
export { resolveStandardFont } from './fonts';

// Bytes: generic byte-level primitives with zero PDF knowledge (CRC32, DEFLATE/zlib, a backtracking reader, a chunked writer).
export { crc32 } from './bytes/crc32';
export type { DeflateLevel, InflateResult } from './bytes/flate';
export { MAX_INFLATE_OUTPUT_BYTES, deflate, inflate, inflateTolerant } from './bytes/flate';
export { ByteReader, isAsciiWhitespace } from './bytes/reader';
export { ByteWriter, concatBytes } from './bytes/writer';

// Image: JPEG marker scanning (dimensions only, compressed bytes untouched), a hand-written PNG codec (palette/gray/RGB/alpha, multi-IDAT, all five scanline filters), and a hand-written CCITT Group 3/Group 4 fax decoder.
export type { CcittFaxImage, CcittFaxOptions } from './image/ccitt';
export { decodeCcittFax } from './image/ccitt';
export type { JpegInfo } from './image/jpeg-info';
export { readJpegInfo } from './image/jpeg-info';
export type { PngDecodeOptions, RawImage } from './image/png-decode';
export { decodePng } from './image/png-decode';
export type { PngEncodeOptions } from './image/png-encode';
export { encodePng } from './image/png-encode';
export type { PngFilterType } from './image/png-filter';
export { filterScanlines, unfilterScanlines } from './image/png-filter';
