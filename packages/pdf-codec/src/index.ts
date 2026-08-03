// pdf-codec's public surface: a curated barrel export, no subpath exports, matching document-schema.js/odf.js/ooxml.js's own precedent. What's exported here is every symbol a real external consumer needs -- headline read/write/codec entry points, the formula/math port documents.js's own MathML layout engine passes real values through, the text-layout and font-resolution helpers every layout engine built on this codec needs, and the full bytes/image surface (this package owns src/bytes/ and src/image/ outright; nothing duplicates them upstream). Internal plumbing (objects.ts, serialize.ts, lexer.ts, parse.ts, xref.ts, document.ts, interpret.ts, content-read.ts, content-write.ts, filters.ts, predictors.ts, images-read.ts, cmap.ts, font-read.ts, font-style.ts, and the cmap-table/hmtx-table/font-tables/glyf/sfnt/sfnt-subset/cff/cff-probe/cff-bounds/tounicode/math-font-write/math-content-write/embedded-font-write font-parsing, font-subsetting, and font-embedding internals) stays unexported -- math-table.ts is a partial exception, exporting its MathVariants types alone (see below), and glyph-bounds.ts another, exporting the GlyphInkBounds shape those outline readers report through -- nothing outside this package's own src/ consumes it today. embedded-font.ts is the one partial exception: its EmbeddedFace is the type ResolvedFace's own 'embedded' variant carries, and its EmbeddedFaceSubstitution is what WritePdfOptions.onMissingGlyph reports, so both must be nameable by an external caller even though nothing else in that module is exported.

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
export type { MathAssembledGlyphs, MathBox, MathColor, MathFontMetrics, MathGlyphMetrics, MathGlyphPlacement, MathGlyphRun, MathLayoutItem, MathRule, MathStretchGlyph, MathStretchResult, MathStroke } from './math-types';
export type { LoadedMathFont, MathFont, MathFontDescriptorMetrics } from './math-font';
export { loadMathFont } from './math-font';
// Per-glyph tight ink bounding boxes: the shape MathFont.glyphInkBounds reports in design units, and what MathGlyphMetrics.inkAscentPt/inkDescentPt are derived from. Exported so a layout engine outside this package (documents.js's own MathML engine is the caller this exists for) can size a token box from the glyphs it actually contains rather than from the font-wide nominal ascent/descent.
export type { GlyphInkBounds } from './glyph-bounds';

// Stretchy glyphs: the OpenType MATH 'MathVariants' data (pre-built larger variants and part-assembly recipes) plus the assembly computation that turns it into placement data for one target size. The MathVariants types below are the one part of math-table.ts that does cross this package's own public boundary, since assembleStretchyGlyph takes a MathGlyphConstruction as its input -- the rest of that module stays internal.
export type { MathGlyphAssembly, MathGlyphConstruction, MathGlyphPart, MathGlyphVariant, MathVariants } from './math-table';
export type { MathStretchAxis, MathStretchConstruction, MathStretchOptions, MathStretchPlacement } from './math-stretch';
export { assembleStretchyGlyph, scaleMathStretchConstruction } from './math-stretch';

// Text layout: consumed by every layout engine built on this codec (line-wrapping, run styling, underline metrics).
export type { UnderlineMetrics } from './measure';
export type { FontMeasurerOptions, StandardFontMeasurerOptions, TextMeasurer, VerticalMetricPolicy } from './measure';
export { DEFAULT_VERTICAL_METRIC_POLICY, createFontMeasurer, createStandardFontMeasurer } from './measure';
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

// Font registry: a swappable, source/caller/vendored/standard-14 precedence port in front of resolveStandardFont -- see src/font-registry.ts's own header comment for the full resolution order.
export type { FontRegistry, FontRegistryOptions, FontSubstitution, ProvidedFont, ResolvedFace } from './font-registry';
export { createFontRegistry, resolveFaceWithRegistry } from './font-registry';
export type { EmbeddedFace, EmbeddedFaceMetrics, EmbeddedFaceSubstitution } from './embedded-font';

// Bytes: generic byte-level primitives with zero PDF knowledge (CRC32, DEFLATE/zlib, a backtracking reader, a chunked writer).
export { crc32 } from './bytes/crc32';
export type { DeflateLevel, InflateResult } from './bytes/flate';
export { MAX_INFLATE_OUTPUT_BYTES, deflate, inflate, inflateTolerant } from './bytes/flate';
export { ByteReader, isAsciiWhitespace } from './bytes/reader';
export { ByteWriter, concatBytes } from './bytes/writer';

// Image: JPEG marker scanning (dimensions only, compressed bytes untouched), a hand-written PNG codec (palette/gray/RGB/alpha, multi-IDAT, all five scanline filters), a hand-written CCITT Group 3/Group 4 fax decoder, a hand-written JBIG2 decoder, and a hand-written JPEG 2000 decoder.
export type { CcittFaxImage, CcittFaxOptions } from './image/ccitt';
export { decodeCcittFax } from './image/ccitt';
// The JBIG2 decoder's own entry point, alongside the two errors it distinguishes: a malformed stream (Jbig2ParseError) and one using a JBIG2 feature this decoder does not implement (Jbig2UnsupportedError). Exported for the same reason decodeCcittFax is -- a caller holding a bare JBIG2 stream from somewhere other than a PDF should not have to reimplement it.
export type { Jbig2DecodeOptions, Jbig2Image } from './image/jbig2';
export { decodeJbig2Embedded } from './image/jbig2';
export { Jbig2ParseError, Jbig2UnsupportedError } from './image/jbig2-errors';
// The JPEG 2000 decoder's own two entry points -- full pixel decoding, and a metadata read that works on any conforming codestream including one whose pixels this decoder refuses -- alongside the JP2 box parser and the two errors they distinguish, exactly mirroring the JBIG2 surface above.
export type { Jp2ChannelDefinition, Jp2ColourSpace, Jp2Container, Jp2ImageHeader } from './image/jp2-boxes';
export { looksLikeBareCodestream, parseJp2Container } from './image/jp2-boxes';
export type { Jpeg2000ComponentMetadata, Jpeg2000DecodeOptions, Jpeg2000Image, Jpeg2000Metadata } from './image/jpeg2000';
export { decodeJpeg2000, readJpeg2000Metadata } from './image/jpeg2000';
export type { Jpeg2000ProgressionOrder, Jpeg2000QuantizationStyle, Jpeg2000Transform } from './image/jpeg2000-codestream';
export { Jpeg2000ParseError, Jpeg2000UnsupportedError } from './image/jpeg2000-errors';
export type { JpegInfo } from './image/jpeg-info';
export { readJpegInfo } from './image/jpeg-info';
export type { PngDecodeOptions, RawImage } from './image/png-decode';
export { decodePng } from './image/png-decode';
export type { PngEncodeOptions } from './image/png-encode';
export { encodePng } from './image/png-encode';
export type { PngFilterType } from './image/png-filter';
export { filterScanlines, unfilterScanlines } from './image/png-filter';
