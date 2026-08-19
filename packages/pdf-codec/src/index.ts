// pdf-codec's public surface: a curated barrel export, no subpath exports, matching document-schema.js/odf.js/ooxml.js's own precedent. What's exported here is every symbol a real external consumer needs -- headline read/write/codec entry points, the Layout item family this package owns outright as its native document model (src/layout.ts, exported wholesale below), the formula/math port documents.js's own MathML layout engine passes real values through, the text-layout and font-resolution helpers every layout engine built on this codec needs, and the full bytes/image surface (this package owns src/bytes/ and src/image/ outright; nothing duplicates them upstream). Internal plumbing (objects.ts, serialize.ts, lexer.ts, parse.ts, xref.ts, document.ts, interpret.ts, content-read.ts, content-write.ts, filters.ts, predictors.ts, images-read.ts, cmap.ts, font-read.ts, font-style.ts, and the cmap-table/hmtx-table/font-tables/glyf/sfnt/sfnt-subset/cff/cff-probe/cff-bounds/tounicode/ot-layout-common/gpos-table/math-font-write/math-content-write/embedded-font-write font-parsing, font-subsetting, and font-embedding internals) stays unexported -- math-table.ts is a partial exception, exporting its MathVariants types alone (see below), and glyph-bounds.ts another, exporting the GlyphInkBounds shape those outline readers report through -- nothing outside this package's own src/ consumes it today. embedded-font.ts is the one partial exception: its EmbeddedFace is the type ResolvedFace's own 'embedded' variant carries, and its EmbeddedFaceSubstitution is what WritePdfOptions.onMissingGlyph reports, so both must be nameable by an external caller even though nothing else in that module is exported.

// Headline: read/write/diagnostics/codec. readPdf/writePdf speak LayoutDocument and there is deliberately no DocumentPackage-native pair beside them. On read, PDF states positions, not structure -- readPdf yields layout cheaply, and semantic content (paragraphs, headings, tables) only through a separate, lossy reconstruction pass that infers structure from geometry, genuine semantic policy that lives in documents.js (src/layout/reconstruct.ts). On write, a DocumentPackage reaches PDF bytes only once a prior layout pass has already stamped frames onto it (a package with no pages, e.g. a bridge conversion's own odt-to-docx dump, cannot reach PDF at all): documents.js's layoutDocumentFromPackage walks those already-stamped frames back into a LayoutDocument, a mechanical inverse rather than a font-measuring, line-breaking pass of its own -- the actual layout engine runs earlier, wherever the package first passed through an X-to-PDF or PDF-to-X conversion. ExaDev/pdf-codec#65 scoped the frames-mapping half of this boundary to this package ("readPdf/writePdf ... gain mappings to and from package frames at the edge"); that half was never implemented here and instead lives in documents.js as layoutDocumentFromPackage -- a deliberate reassignment, not an oversight, but one #65 itself doesn't record. Adding a DocumentPackage-facing wrapper here would mean this package owning either a reconstruction heuristic or a frame-walking pass that depends on a layout stage documents.js runs, and would make pdf-codec depend on the package that depends on it.
export type { ReadPdfOptions } from './read';
export { readPdf } from './read';
export type { WritePdfOptions } from './write';
export { writePdf } from './write';
export type { PdfDiagnostic, PdfDiagnosticSeverity, PdfDiagnosticSink } from './diagnostics';
export { NOOP_DIAGNOSTIC_SINK, PdfEncryptedError, PdfParseError, PdfPasswordRequiredError } from './diagnostics';
export type { WinAnsiSubstitution } from './winansi';
export { PdfBytesSchema, pdfCodec } from './codec';

// The Layout item family: LayoutDocument and every item/page/image-asset schema, inferred type, and LAYOUT_FORMAT_VERSION -- pdf-codec's own native document model, ported from document-schema.js (which dropped it at its 4.0.0) per the family pattern where a codec's native model lives in the codec, like ooxml.js's Package/XmlElement. Exported wholesale because every symbol in src/layout.ts is public family surface: readPdf/writePdf's own signatures speak these types, and documents.js re-exports the family onward from its own barrel. Callers that imported the family from document-schema.js pre-4.0.0 import the same names from pdf-codec now.
export * from './layout';

// Formula/math: the structural port documents.js's own MathML layout engine (layoutFormula, staying in documents.js) produces real values against -- the family lives in document-schema.js's math layout port, one shared definition across the family rather than a local mirror (importing it from documents.js itself would be circular once documents.js depends on this package).
export type { MathAssembledGlyphs, MathBox, MathColor, MathFontMetrics, MathGlyphMetrics, MathGlyphPlacement, MathGlyphRun, MathLayoutItem, MathRule, MathStretchAxis, MathStretchGlyph, MathStretchResult, MathStroke, PositionedFormula } from 'document-schema.js';
export type { LoadedMathFont, MathFont, MathFontDescriptorMetrics } from './math-font';
export { loadMathFont } from './math-font';
// Per-glyph tight ink bounding boxes: the shape MathFont.glyphInkBounds reports in design units, and what MathGlyphMetrics.inkAscentPt/inkDescentPt are derived from. Exported so a layout engine outside this package (documents.js's own MathML engine is the caller this exists for) can size a token box from the glyphs it actually contains rather than from the font-wide nominal ascent/descent.
export type { GlyphInkBounds } from './glyph-bounds';

// Stretchy glyphs: the OpenType MATH 'MathVariants' data (pre-built larger variants and part-assembly recipes) plus the assembly computation that turns it into placement data for one target size. The MathVariants types below are the one part of math-table.ts that does cross this package's own public boundary, since assembleStretchyGlyph takes a MathGlyphConstruction as its input -- the rest of that module stays internal.
export type { MathGlyphAssembly, MathGlyphConstruction, MathGlyphPart, MathGlyphVariant, MathVariants } from './math-table';
export type { MathStretchConstruction, MathStretchOptions, MathStretchPlacement } from './math-stretch';
export { assembleStretchyGlyph, scaleMathStretchConstruction } from './math-stretch';

// Text layout: consumed by every layout engine built on this codec (line-wrapping, run styling, underline metrics).
export type { StyledFragment, StyledRun, TextMeasurer, UnderlineMetrics, WrapOptions, WrappedLine } from 'document-schema.js';
export type { FontMeasurerOptions, StandardFontMeasurerOptions, VerticalMetricPolicy } from './measure';
export { DEFAULT_VERTICAL_METRIC_POLICY, createFontMeasurer, createStandardFontMeasurer } from './measure';

// Geometry: shape/slide placement math. Point stays public (it is the neutral geometry type); rotatePointAboutCenter is no longer exported -- documents.js owns its own copy now, and pdf-codec had no internal production caller for it (only a test). wrapRunsToWidth likewise dropped below: documents.js owns its own text-wrapping primitive now.
export type { Point } from 'document-schema.js';

// Font resolution: mapping an arbitrary requested font family/weight/style onto one of the 14 standard PDF faces, and that face's own AFM-derived metrics.
export type { FontMetrics, StandardFontName } from './afm-widths';
export { STANDARD_METRICS } from './afm-widths';
export type { ResolvedFont } from './fonts';
export { resolveStandardFont } from './fonts';

// Font registry: a swappable, source/caller/vendored/standard-14 precedence port in front of resolveStandardFont -- see src/font-registry.ts's own header comment for the full resolution order.
export type { FontRegistryOptions, FontSubstitution, ProvidedFont } from 'document-schema.js';
export type { FontRegistry, ResolvedFace } from './font-registry';
export { createFontRegistry, resolveFaceWithRegistry } from './font-registry';
export type { EmbeddedFace, EmbeddedFaceMetrics, EmbeddedFaceSubstitution } from './embedded-font';
// Standalone font-file inspection: a caller holding the raw bytes of a .ttf/.otf a user supplied (not a font already extracted from a source document) reads its own declared family/bold/italic triple.
export type { FontFace } from './font-face';
export { FontFaceParseError, readFontFace } from './font-face';

// Bytes + generic image (PNG/JPEG): re-exported from byte-codec (the neutral shared package), where these pure utilities now live. pdf-codec keeps its own internal copies under src/bytes/ and src/image/ (its own read/write/interpret paths use them), but its PUBLIC surface sources them from byte-codec so a consumer does not need to reach into a PDF backend for generic byte/image code.
export * from 'byte-codec';

// PDF-specific image codecs (CCITT fax, JBIG2, JPEG 2000) stay here -- they are genuine PDF-format concerns, not generic byte/image utilities.
export type { CcittFaxImage, CcittFaxOptions } from './image/ccitt';
export { decodeCcittFax } from './image/ccitt';
export type { Jbig2DecodeOptions, Jbig2Image } from './image/jbig2';
export { decodeJbig2Embedded } from './image/jbig2';
export { Jbig2ParseError, Jbig2UnsupportedError } from './image/jbig2-errors';
export type { Jp2ChannelDefinition, Jp2ColourSpace, Jp2Container, Jp2ImageHeader } from './image/jp2-boxes';
export { looksLikeBareCodestream, parseJp2Container } from './image/jp2-boxes';
export type { Jpeg2000ComponentMetadata, Jpeg2000DecodeOptions, Jpeg2000Image, Jpeg2000Metadata } from './image/jpeg2000';
export { decodeJpeg2000, readJpeg2000Metadata } from './image/jpeg2000';
export type { Jpeg2000ProgressionOrder, Jpeg2000QuantizationStyle, Jpeg2000Transform } from './image/jpeg2000-codestream';
export { Jpeg2000ParseError, Jpeg2000UnsupportedError } from './image/jpeg2000-errors';
export { filterScanlines, unfilterScanlines } from './image/png-filter';
