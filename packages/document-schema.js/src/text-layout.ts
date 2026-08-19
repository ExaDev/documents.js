import type { Color } from './color';
import type { LayoutFont } from './style';

// The text-layout port contracts a layout engine consumes, independent of any concrete font backend. pdf-codec implements TextMeasurer (over the standard-14 AFM widths and any caller/embedded faces); a layout engine (documents.js's src/layout/) takes a TextMeasurer as an injected parameter and depends only on this interface, never on the implementation. Kept here -- the neutral shared-schema package, already home to LayoutFont/Color these reference -- so a layout engine never reaches into a specific rendering backend for its contracts. Mirrors src/codec.ts's own precedent of hosting behavioural ports alongside the Zod schemas.

// The metrics an underline drawn under a run at one size needs: where (relative to the baseline; negative is below it) and how thick.
export interface UnderlineMetrics {
  readonly offsetPt: number;
  readonly thicknessPt: number;
}

// Every measurement needed to lay out and paginate text, backed by a concrete font implementation. An interface (not a concrete class) so wrap-point logic can be tested against a fake, exactly-predictable measurer, and so a future embedded-font or non-PDF measurer can be substituted without touching layout code. Every length is in points at the requested size.
export interface TextMeasurer {
  widthOfTextAtSize(text: string, font: LayoutFont, sizePt: number): number;
  lineHeightAtSize(font: LayoutFont, sizePt: number): number;
  ascenderAtSize(font: LayoutFont, sizePt: number): number;
  descenderAtSize(font: LayoutFont, sizePt: number): number;
  underlineAtSize(font: LayoutFont, sizePt: number): UnderlineMetrics;
  // The horizontal scaling value (1.0 = no scaling) this font's actual glyphs must be drawn at so the rendered text lines up with what widthOfTextAtSize measured. Must come from the same measurer instance driving layout -- measuring at one font's metrics and drawing at another's would wrap text at positions that do not match what is painted.
  horizontalScaleFor(font: LayoutFont): number;
}

// One run of text already styled for layout (font/size/colour resolved), the input to line-wrapping. `hyperlink` and `sourcePath` pass through wrapping unchanged so a caller can stamp a LayoutLink over each wrapped fragment and trace every fragment back to its originating ContentRun.
export interface StyledRun {
  readonly text: string;
  readonly font: LayoutFont;
  readonly sizePt: number;
  readonly color: Color;
  readonly underline?: boolean;
  readonly hyperlink?: string;
  readonly sourcePath?: string;
}

// A wrapped fragment of a StyledRun -- the same fields, produced by the line-breaker. Distinct from StyledRun (rather than `StyledRun & { xOffsetPt }`) so the input and output of wrapping read as different things at the type level.
export interface StyledFragment {
  readonly text: string;
  readonly font: LayoutFont;
  readonly sizePt: number;
  readonly color: Color;
  readonly underline?: boolean;
  readonly hyperlink?: string;
  readonly sourcePath?: string;
}

// One laid-out line: its fragments (each with its x offset within the line) and the line's own metrics. `descentPt` is negative, per AFM convention.
export interface WrappedLine {
  readonly fragments: readonly (StyledFragment & { readonly xOffsetPt: number })[];
  readonly widthPt: number;
  readonly maxSizePt: number;
  readonly ascentPt: number;
  readonly descentPt: number;
}

export interface WrapOptions {
  readonly breakLongWords?: boolean;
}
