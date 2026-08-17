// The svg read path's degrade-with-diagnostic channel, following the same three-tier failure policy pdf-codec established: unprocessable input throws (non-UTF-8 bytes, malformed path data makes the whole element skippable rather than half-drawn), malformed-but-salvageable input degrades with a diagnostic, and out-of-scope features degrade with a diagnostic rather than being silently dropped. Every code below names one deliberate scope limit or one bounded approximation -- nothing fires for a plain SVG of vector shapes, which reads silently.

export const SVG_DIAGNOSTIC_CODES = [
  // A <text>/<tspan>/<textPath> element: SVG text has no ContentVector representation (the drawing variant's shapes vocabulary is ODF frame content), so the element is skipped and named.
  'svg/text-unsupported',
  // An <image> element: raster image placement is out of scope for this reader.
  'svg/image-unsupported',
  // A <use> element: reference resolution (the instance tree) is out of scope.
  'svg/use-unsupported',
  // A fill or stroke resolved to url(#id): gradient/pattern paint servers are approximated as "no paint" and named, rather than rendered as a wrong solid colour.
  'svg/gradient-unsupported',
  // An element this reader does not know at all: skipped, children not walked.
  'svg/element-unsupported',
  // A recognised shape whose geometry is degenerate or invisible (zero size, a line with no stroke): skipped without error -- it paints nothing in a conforming renderer either.
  'svg/element-skipped',
  // A style attribute (or a paint value only expressible through CSS syntax) was present and ignored: CSS cascade parsing is out of scope.
  'svg/css-style-ignored',
  // A paint value this reader could not resolve (an unsupported colour function, a system colour keyword): the SVG default for that property applies and the value is named.
  'svg/paint-unsupported',
  // An opacity/fill-opacity/stroke-opacity below 1, or a colour alpha, was ignored: this reader models no transparency.
  'svg/opacity-ignored',
  // The root svg's viewBox and viewport aspect ratios differ under a preserveAspectRatio other than 'none', and this reader stretches the viewBox to the viewport rather than letterboxing.
  'svg/preserve-aspect-ratio-stretched',
  // Neither width/height nor a usable viewBox was present, so the CSS default replaced element size (300x150 px) was assumed.
  'svg/default-size-assumed',
  // The write side met a ContentShape (draw:frame text/image/table content) it cannot express as SVG vector markup: skipped and named.
  'svg/shape-unsupported',
  // The write side met a ContentStroke style SVG has no construct for ('double' -- SVG strokes are single): written as solid and named.
  'svg/stroke-style-unsupported',
] as const;

export type SvgDiagnosticCode = (typeof SVG_DIAGNOSTIC_CODES)[number];

export interface SvgDiagnostic {
  readonly code: SvgDiagnosticCode;
  // What was skipped or degraded, in source terms (the element name plus its id if present, the unparseable value) -- enough to locate it in the source file without this reader keeping a node identity.
  readonly detail?: string;
}

export type SvgDiagnosticSink = (diagnostic: SvgDiagnostic) => void;
