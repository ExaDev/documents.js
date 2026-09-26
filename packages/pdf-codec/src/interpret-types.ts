// The result types interpretContentStream produces, split from interpret.ts: the Extracted* paint/text/image item shapes, the glyph-advance port, and the InterpretContext the caller supplies.
import type { PdfDiagnosticSink } from "./diagnostics";
import type { PdfDict, PdfObject } from "./objects";
import type { Matrix } from "./matrix";
import type {
  Color as LayoutColor,
  ContentStrokeStyle,
} from "document-schema.js";

export interface ExtractedTextRun {
  readonly kind: "text";
  readonly codes: Uint8Array<ArrayBuffer>; // raw show-string bytes, undecoded — font-read.ts/cmap.ts turn these into Unicode
  readonly fontResourceName: string;
  readonly resources: PdfDict;
  readonly startMatrix: Matrix; // the text rendering matrix (Trm) at the run's first glyph
  readonly endMatrix: Matrix; // Trm at the position the *next* glyph would start — lets a caller derive the run's on-page width as the device-space distance between the two baseline points, with no separate unit bookkeeping
  readonly sizePt: number;
  readonly color: LayoutColor;
  readonly layerName?: string; // the optional-content group in scope (innermost /OC BDC span, or the recursed form XObject's own)
  readonly actualText?: string; // a /ActualText marked-content property in scope: the producer's replacement reading for extraction
  readonly alt?: string; // a /Alt marked-content property in scope: the producer's alternate description
  readonly mcid?: number; // the /MCID of the innermost marked-content span in scope — tagged PDF's handle for the (page, MCID) structure association read.ts resolves through /ParentTree
  readonly vertical?: boolean; // the font's CMap selects writing mode 1, so this run advances DOWN the page: startMatrix and endMatrix differ in y rather than x, and both already carry the first glyph's position vector
}

// The paint a recovered shape carries, shared by every extracted item that can be filled and/or stroked. At least one of the two is always set: `n` (the clip-only, paints-nothing operator) never emits an item at all, and every other path-painting operator fills, strokes, or does both.
export interface ExtractedPaint {
  readonly fill: LayoutColor | undefined;
  readonly stroke:
    { readonly color: LayoutColor; readonly widthPt: number } | undefined;
  readonly layerName?: string; // the optional-content group in scope — membership is a fact of every painted item, not only text
  readonly mcid?: number; // the /MCID in scope — ownership is as much a fact of a painted item as layer membership
}

// An axis-aligned rectangle, recovered from a single closed four-corner all-straight-line subpath under any CTM that leaves those corners axis-aligned — so a bare `re` under a non-rotated CTM (by far the common case), a `re` under a 90-degree-multiple rotation (a rotated rectangle is still a rectangle), and a hand-constructed m/l/l/l/h rectangle all reach it, with any combination of fill and stroke. Anything else (a non-90-degree rotation, curves, multiple subpaths) falls through to ExtractedPath below instead.
export interface ExtractedRect extends ExtractedPaint {
  readonly kind: "rect";
  readonly xPt: number;
  readonly yPt: number;
  readonly widthPt: number;
  readonly heightPt: number;
}

// An axis-aligned ellipse, recovered from the four-cubic-Bezier-quadrant construction every ellipse-as-Beziers writer emits (this package's own content-write.ts writeEllipse included) — see detectEllipse for the exact pattern matched and the honest false-positive caveat. Geometry is the ellipse's bounding box, matching ExtractedRect's own convention and document-schema.js's LayoutEllipse.
export interface ExtractedEllipse extends ExtractedPaint {
  readonly kind: "ellipse";
  readonly xPt: number;
  readonly yPt: number;
  readonly widthPt: number;
  readonly heightPt: number;
}

// A single straight stroked segment, recovered from an open one-line-segment stroke-only subpath. No fill variant exists because a filled two-point path encloses no area and paints nothing — a fill on this shape would be a producer error, not a line.
export interface ExtractedLine {
  readonly kind: "line";
  readonly x1Pt: number;
  readonly y1Pt: number;
  readonly x2Pt: number;
  readonly y2Pt: number;
  readonly color: LayoutColor;
  readonly widthPt: number;
  readonly style?: ContentStrokeStyle; // recovered from the dash array in effect when this line was stroked — see strokeStyleFromDashArray
  readonly layerName?: string; // the optional-content group in scope — membership is a fact of every painted item, not only text
  readonly mcid?: number; // the /MCID in scope — ownership is as much a fact of a painted item as layer membership
}

// One line or cubic-Bezier segment of a subpath, device-space (CTM-applied, not yet page-matrix-applied — matching ExtractedRect's own convention), mirroring document-schema.js's LayoutPathSegment shape exactly so read.ts's conversion is a pure per-point transform.
export type ExtractedPathSegment =
  | { readonly kind: "line"; readonly xPt: number; readonly yPt: number }
  | {
      readonly kind: "cubic";
      readonly c1xPt: number;
      readonly c1yPt: number;
      readonly c2xPt: number;
      readonly c2yPt: number;
      readonly xPt: number;
      readonly yPt: number;
    };

export interface ExtractedSubpath {
  readonly startXPt: number;
  readonly startYPt: number;
  readonly segments: readonly ExtractedPathSegment[];
  readonly closed: boolean;
}

// General vector-path recovery: anything painted by a path-construction sequence too general for the three characteristic-shape detections above — a skewed or non-90-degree-rotated CTM, an arbitrary curve, a polygon that isn't a rectangle, multiple subpaths, or a `re` mixed with other path operators in the same sequence. `fillRule` always reflects which paint operator actually ran (nonzero for the plain family, evenodd for the starred family) even when `fill` is undefined, since it costs nothing to record accurately here; read.ts's convertPath is the layer that decides whether it's worth keeping in the minimal LayoutPath it builds.
export interface ExtractedPath extends ExtractedPaint {
  readonly kind: "path";
  readonly subpaths: readonly ExtractedSubpath[];
  readonly fillRule: "nonzero" | "evenodd";
  readonly style?: ContentStrokeStyle; // recovered from the dash array in effect when this path was stroked — see strokeStyleFromDashArray
}

export interface ExtractedImage {
  readonly kind: "image";
  readonly resourceName: string;
  readonly resources: PdfDict;
  readonly matrix: Matrix; // the CTM at the moment of Do — placement is x=ctm[4], y=ctm[5], width=|ctm[0]|, height=|ctm[3]| for the axis-aligned case
  readonly layerName?: string; // the optional-content group in scope, or the image XObject dict's own /OC
  readonly mcid?: number; // the /MCID in scope — ownership is as much a fact of an image as layer membership (unlike /OC, an XObject dict cannot carry /MCID itself)
}

export interface ExtractedInlineImage {
  readonly kind: "inlineImage";
  readonly dict: PdfDict; // BI dict, keys possibly abbreviated (/W /H /CS /BPC /F /DP /IM) — images-read.ts normalises
  readonly data: Uint8Array<ArrayBuffer>;
  readonly matrix: Matrix;
  readonly layerName?: string;
  readonly mcid?: number; // the /MCID in scope — ownership is as much a fact of an inline image as layer membership
}

export type ExtractedItem =
  | ExtractedTextRun
  | ExtractedRect
  | ExtractedEllipse
  | ExtractedLine
  | ExtractedPath
  | ExtractedImage
  | ExtractedInlineImage;

// A glyph's own vertical-writing metrics (ISO 32000-1 9.7.4.3), present only when the shown font's CMap selects writing mode 1. displacementPer1000 is w1y, normally negative because a vertical line runs down the page; positionXPer1000/positionYPer1000 are the position vector v, which says how far the glyph paints from the text position.
export interface VerticalGlyphAdvance {
  readonly displacementPer1000: number;
  readonly positionXPer1000: number;
  readonly positionYPer1000: number;
}

export interface GlyphAdvance {
  readonly widthPer1000: number; // 1000ths of text space, matching PDF's own /Widths convention
  readonly byteLengthConsumed: number; // 1 for a simple font's single-byte codes, 2 for an Identity-H composite font
  readonly vertical?: VerticalGlyphAdvance; // absent for a horizontally set font, which is every simple font and every composite font whose CMap is horizontal
}

// interpret.ts knows nothing about font dictionaries, /ToUnicode CMaps, or embedded-font tables — it only needs "how wide is the next glyph and how many bytes did it consume" to advance the text matrix correctly. font-read.ts implements this against a real PdfDocument; tests here use a fake.
export interface FontMetricsPort {
  glyphAdvance: (
    fontResourceName: string,
    resources: PdfDict,
    codes: Uint8Array<ArrayBuffer>,
    byteOffset: number,
  ) => GlyphAdvance | undefined;
  // Whether this font is set vertically, asked independently of any one glyph because a TJ array's own positioning numbers move the text position along whichever axis the writing mode chooses and an array may begin with one before a single glyph has been shown.
  isVertical: (fontResourceName: string, resources: PdfDict) => boolean;
}

// The minimal reference-resolution surface interpret.ts needs (looking up /XObject and /Font resources, and recursing into a resolved Form XObject) — a structural subset of PdfDocument, not a dependency on document.ts itself.
export interface PdfObjectResolver {
  resolve: (obj: PdfObject | undefined) => PdfObject | undefined;
  resolveDict: (obj: PdfObject | undefined) => PdfDict | undefined;
}

export interface InterpretContext {
  readonly fontMetrics: FontMetricsPort;
  readonly resolver: PdfObjectResolver;
  readonly sink: PdfDiagnosticSink;
  // Resolves an /OC value (from a BDC property dict or an XObject dict) to the layer name readPdf's optional-content pass assigned it. Absent in interpret.ts's own unit tests, where no optional content exists.
  readonly layerNameOf?: (obj: PdfObject | undefined) => string | undefined;
}

// Guards a self-referential or runaway chain of nested form XObjects — a corrupt or adversarial file, not something a real producer emits.
