import type { LayoutEllipse, LayoutImage, LayoutItem, LayoutLine, LayoutPath, LayoutRect, LayoutSubpath, LayoutText } from 'document-schema.js';
import type { Color as LayoutColor } from 'document-schema.js';
import type { LayoutFont } from 'document-schema.js';
import type { StandardFontName } from './afm-widths';
import { ByteWriter } from './bytes/writer';
import type { EmbeddedFace, EmbeddedFaceSubstitution, EmbeddedShow } from './embedded-font';
import { encodeForShowEmbedded } from './embedded-font';
import type { Matrix } from './matrix';
import { BEZIER_KAPPA, multiplyMatrices, rotationMatrix, scaleMatrix, translationMatrix } from './matrix';
import type { TextMeasurer, UnderlineMetrics } from './measure';
import type { PdfObject } from './objects';
import { pdfArray, pdfHexString, pdfNum } from './objects';
import { formatNumber, writeObject } from './serialize';
import type { WinAnsiSubstitution } from './winansi';
import { encodeForShow } from './winansi';

// Which kind of font resource write.ts allocated for a given LayoutFont, and everything this module needs to actually show text in it. A discriminated union rather than one shape with optional fields because the two branches are genuinely different at the byte level: a standard-14 face shows a WinAnsi-encoded 1-byte-per-character string against a /Type1 font dict, while an embedded face shows Identity-H 2-byte CIDs against a /Type0 one (the same shape math-content-write.ts already emits for the math font), and there is no per-character encoding, width source, or underline metric the two share.
export type ResolvedFontResource =
  | {
      readonly kind: 'standard';
      readonly resourceName: string; // e.g. 'F1', the key under the page's /Resources/Font dict
      readonly standardName: StandardFontName;
    }
  | {
      readonly kind: 'embedded';
      readonly resourceName: string; // e.g. 'E1', the key under the page's /Resources/Font dict
      readonly face: EmbeddedFace;
    };

// PDF glyph space (ISO 32000-1 9.8.1): the 1000-units-per-em space every EmbeddedFaceMetrics field and every encodeForShowEmbedded width already carries, whatever the font's own design grid is.
const GLYPH_SPACE_UNITS_PER_EM = 1000;

// The Tz (horizontal scaling) percentage an embedded face is always drawn at: it advances at its own real widths, which is exactly what the measurer measured, so there is nothing to correct. See measure.ts's own DEFAULT_WIDTH_CORRECTIONS comment for why applying a standard-14 substitute's correction here as well would silently overrun a column.
const EMBEDDED_HORIZONTAL_SCALE_PERCENT = 100;

export interface ResolvedImageResource {
  readonly resourceName: string; // e.g. 'Im1', the key under the page's /Resources/XObject dict
}

// content-write.ts never allocates font/image resource names itself -- write.ts owns that (registry-keyed, sorted-order allocation, so object numbers stay deterministic regardless of Map/object iteration order). This context is purely a lookup back into whatever write.ts already decided, keeping this module a short, dumb dispatch over item kind.
export interface ContentWriteContext {
  readonly measurer: TextMeasurer;
  resolveFont(font: LayoutFont): ResolvedFontResource;
  resolveImage(imageId: string): ResolvedImageResource;
}

export interface ContentStreamResult {
  readonly bytes: Uint8Array<ArrayBuffer>;
  // Every WinAnsi substitution made while emitting text in a STANDARD-14 face, in item order -- content-write.ts has no Diagnostic schema of its own to turn these into, so it hands back the raw substitutions and leaves that translation to whichever layer owns diagnostics.
  readonly substitutions: readonly WinAnsiSubstitution[];
  // Every character shown as .notdef because the EMBEDDED face it was drawn in has no glyph for it, in item order. Kept separate from `substitutions` rather than folded into it because nothing visible was chosen as a replacement here -- a WinAnsiSubstitution's own `to` field would have to be invented, and claiming a '?' was drawn when a notdef box was drawn is a worse report than none. Reported rather than dropped: only the caller can decide whether that means picking another face or accepting the box.
  readonly missingGlyphs: readonly EmbeddedFaceSubstitution[];
}

function writeRgbOperator(writer: ByteWriter, color: LayoutColor, operator: 'rg' | 'RG'): void {
  writer.writeAscii(`${formatNumber(color.r)} ${formatNumber(color.g)} ${formatNumber(color.b)} ${operator}\n`);
}

function writeMatrixOperator(writer: ByteWriter, m: Matrix, operator: 'Tm' | 'cm'): void {
  writer.writeAscii(`${m.map(formatNumber).join(' ')} ${operator}\n`);
}

// The matrix that both places and rotates something anchored at (xPt, yPt): a plain rotation matrix with its translation components overridden to the anchor point, rather than a rotate-then-translate composition -- PDF's Tm/cm operands already encode rotation and translation in one 6-tuple, so this is the direct construction rather than a multiplyMatrices detour. Shared between text (Tm) and its underline rectangle (cm), which is what keeps the underline glued to the text's own baseline under rotation.
function anchorMatrix(xPt: number, yPt: number, rotationDeg: number | undefined): Matrix {
  const r = rotationMatrix(rotationDeg ?? 0);
  return [r[0], r[1], r[2], r[3], xPt, yPt];
}

function writeUnderline(writer: ByteWriter, item: LayoutText, widthPt: number, underline: UnderlineMetrics): void {
  writer.writeAscii('q\n');
  writeMatrixOperator(writer, anchorMatrix(item.xPt, item.yPt, item.rotationDeg), 'cm');
  writeRgbOperator(writer, item.color, 'rg');
  writer.writeAscii(`0 ${formatNumber(underline.offsetPt)} ${formatNumber(widthPt)} ${formatNumber(underline.thicknessPt)} re\n`);
  writer.writeAscii('f\n');
  writer.writeAscii('Q\n');
}

// What a text-showing block actually shows: one string via Tj, or a string-and-number array via TJ (ISO 32000-1 9.4.3, Table 109). Kept as a pair rather than inferred from the operand's own kind so the operator is stated at the point the decision is made rather than re-derived where it is written.
interface ShowOperand {
  readonly operand: PdfObject;
  readonly operator: 'Tj' | 'TJ';
}

// The BT..ET block both text branches share, differing only in the resource name, the Tz percentage, and the already-encoded show operand -- the operator sequence, its order, and the absolute Tm are identical whether the operand is a WinAnsi byte string shown with Tj or an Identity-H CID array shown with TJ.
function writeShowTextBlock(writer: ByteWriter, item: LayoutText, resourceName: string, scalePercent: number, show: ShowOperand): void {
  writer.writeAscii('BT\n');
  writer.writeAscii(`/${resourceName} ${formatNumber(item.sizePt)} Tf\n`);
  writer.writeAscii(`${formatNumber(scalePercent)} Tz\n`);
  writeRgbOperator(writer, item.color, 'rg');
  writeMatrixOperator(writer, anchorMatrix(item.xPt, item.yPt, item.rotationDeg), 'Tm');
  writeObject(writer, show.operand);
  writer.writeAscii(` ${show.operator}\n`);
  writer.writeAscii('ET\n');
}

function writeStandardText(writer: ByteWriter, item: LayoutText, standardName: StandardFontName, resourceName: string, measurer: TextMeasurer, substitutions: WinAnsiSubstitution[]): void {
  const encoded = encodeForShow(item.text, standardName);
  substitutions.push(...encoded.substitutions);

  // The Tz (horizontal scaling) percentage is a text-state parameter that persists across content-stream items until explicitly changed -- it must be written for every text item, even when the correction is 1.0 (100%), or a preceding item's correction would silently leak into this one.
  const scale = measurer.horizontalScaleFor(item.font);
  // Always a plain Tj: a standard-14 face is measured through afm-widths.ts's own per-glyph width table, which carries no pair data of any kind, so there is no kerning on this path to position glyphs for and nothing that could make an array operand differ from a single string.
  writeShowTextBlock(writer, item, resourceName, scale * 100, { operand: pdfHexString(encoded.codes), operator: 'Tj' });

  if (item.underline === true) {
    const widthPt = item.widthPt ?? (encoded.width1000 / GLYPH_SPACE_UNITS_PER_EM) * item.sizePt * scale;
    writeUnderline(writer, item, widthPt, measurer.underlineAtSize(item.font, item.sizePt));
  }
}

// How an embedded run's glyphs are shown: 2-byte big-endian CIDs (== glyph IDs, since every embedded font program this package writes preserves glyph IDs and declares /CIDToGIDMap /Identity) against a /Type0 Identity-H resource -- the same operand shape math-content-write.ts already uses for the math font -- with the run split at each of the face's own pair-kerning adjustments.
//
// A run whose adjacent glyph pairs the face kerns nothing about (which includes every run in a face with no reachable 'GPOS' kerning at all) is shown as one unsplit hex string with Tj, byte for byte what this module emitted before kerning existed. Only a genuinely kerned run pays for a TJ array.
//
// The sign: a TJ number is SUBTRACTED from the current horizontal coordinate, in thousandths of a unit of text space (ISO 32000-1 9.4.3), so a positive number moves the next glyph closer and a pair the font tightens by 43.457 glyph-space units is written as +43.457. EmbeddedKern.adjustment1000 is the advance DELTA instead (negative to tighten, so that it sums straight into the run's own measured width), which is why it is negated exactly here, at the one point PDF's own convention starts applying. interpret.ts's TJ handling is the reader half of the same convention, so a document written here and read back through this package's own parser recovers the positions it was written with.
function embeddedShowOperand(encoded: EmbeddedShow): ShowOperand {
  if (encoded.kerns.length === 0) {
    return { operand: pdfHexString(encoded.codes), operator: 'Tj' };
  }
  const items: PdfObject[] = [];
  let runStart = 0;
  for (const kern of encoded.kerns) {
    items.push(pdfHexString(encoded.codes.subarray(runStart, kern.codeOffset)));
    items.push(pdfNum(-kern.adjustment1000));
    runStart = kern.codeOffset;
  }
  items.push(pdfHexString(encoded.codes.subarray(runStart)));
  return { operand: pdfArray(items), operator: 'TJ' };
}

// Two things are deliberately NOT taken from the measurer here, even though the measurer would give the same answer whenever it was built with the same registry: the Tz percentage is fixed at 100 (an embedded face is drawn at its own real advances, so no correction can ever apply), and the underline geometry comes from this face's own 'post' table rather than from whichever standard-14 face the family would otherwise have substituted to. Reading both off the resolved face rather than off a separately-constructed measurer removes the one way the two could ever disagree.
function writeEmbeddedText(writer: ByteWriter, item: LayoutText, face: EmbeddedFace, resourceName: string, missingGlyphs: EmbeddedFaceSubstitution[]): void {
  const encoded = encodeForShowEmbedded(item.text, face);
  missingGlyphs.push(...encoded.substitutions);

  writeShowTextBlock(writer, item, resourceName, EMBEDDED_HORIZONTAL_SCALE_PERCENT, embeddedShowOperand(encoded));

  if (item.underline === true) {
    const widthPt = item.widthPt ?? (encoded.width1000 / GLYPH_SPACE_UNITS_PER_EM) * item.sizePt;
    writeUnderline(writer, item, widthPt, {
      offsetPt: (face.metrics.underlinePositionGlyphSpace / GLYPH_SPACE_UNITS_PER_EM) * item.sizePt,
      thicknessPt: (face.metrics.underlineThicknessGlyphSpace / GLYPH_SPACE_UNITS_PER_EM) * item.sizePt,
    });
  }
}

function writeText(writer: ByteWriter, item: LayoutText, context: ContentWriteContext, substitutions: WinAnsiSubstitution[], missingGlyphs: EmbeddedFaceSubstitution[]): void {
  const font = context.resolveFont(item.font);
  if (font.kind === 'embedded') {
    writeEmbeddedText(writer, item, font.face, font.resourceName, missingGlyphs);
    return;
  }
  writeStandardText(writer, item, font.standardName, font.resourceName, context.measurer, substitutions);
}

// 'f'/'f*' (fill only, nonzero/evenodd), 'S' (stroke only), 'B'/'B*' (both, nonzero/evenodd), or undefined when neither is set -- a rect/ellipse/path with neither fill nor stroke is a valid LayoutItem (the schema permits it) that simply paints nothing, so callers skip emitting path bytes for it entirely rather than drawing an invisible path. fillRule only ever matters when fill is set (rect/ellipse never pass one, always taking the nonzero 'f'/'B' branch); a path with fillRule: 'evenodd' takes the starred variant instead.
function paintOperatorFor(fill: LayoutColor | undefined, stroke: { readonly color: LayoutColor; readonly widthPt: number } | undefined, fillRule?: 'nonzero' | 'evenodd'): 'f' | 'f*' | 'S' | 'B' | 'B*' | undefined {
  const evenOdd = fillRule === 'evenodd';
  if (fill !== undefined && stroke !== undefined) {
    return evenOdd ? 'B*' : 'B';
  }
  if (fill !== undefined) {
    return evenOdd ? 'f*' : 'f';
  }
  if (stroke !== undefined) {
    return 'S';
  }
  return undefined;
}

// Formats an x/y pair as PDF operands, e.g. for m/l/c/re coordinates -- shared by writeEllipse and writeSubpath, the two emitters that build points programmatically rather than lifting them straight off a LayoutItem's own named fields.
function formatPoint(x: number, y: number): string {
  return `${formatNumber(x)} ${formatNumber(y)}`;
}

// A LayoutLine's/LayoutPath's own stroke style (document-schema.js 2.1's `style` field). 'solid' and an absent field are the same thing: the PDF graphics state's own defaults, with nothing emitted for either.
type StrokeStyle = NonNullable<LayoutLine['style']>;

// Dash-pattern lengths (ISO 32000-1 8.4.3.6, the 'd' operator) are expressed as multiples of the stroke's OWN width rather than as fixed point lengths, so a hairline rule and a thick one both read as recognisably dashed: a fixed [3 3] pattern under a 6pt stroke paints overlapping blocks that read as solid, and under a 0.25pt one paints dashes twelve times longer than they are thick.
const DASHED_ON_WIDTH_MULTIPLE = 3;
const DASHED_GAP_WIDTH_MULTIPLE = 3;

// A dotted stroke is a dash array with a ZERO on-length, painted under a round cap: a zero-length dash paints its two round caps at the same point, i.e. exactly one filled circle of diameter = the stroke width, which is what a dot is. Any non-zero on-length would paint a capsule (the segment plus a semicircle at each end) instead, reading as a short dash rather than a dot. Under the DEFAULT butt cap (0 J) the identical array paints nothing at all -- a butt cap adds no length to a zero-length segment -- which is why the 'J' operator below is not optional decoration here but the thing that makes the dots exist.
const DOTTED_ON_LENGTH_PT = 0;
const DOTTED_GAP_WIDTH_MULTIPLE = 2;

// Every dash pattern this module emits starts at the beginning of its own on-length (ISO 32000-1 8.4.3.6's dash phase), so a rule always begins with ink rather than an arbitrary partial gap.
const DASH_PHASE_PT = 0;

// ISO 32000-1 Table 53: 0 = butt cap (the PDF default), 1 = round cap.
const LINE_CAP_BUTT = 0;
const LINE_CAP_ROUND = 1;

// A 'double' stroke has no PDF operator of its own -- it is two parallel strokes. Splitting the declared width w into three equal bands (ink, gap, ink) gives each rule a width of w/3 and puts their centrelines w/3 either side of the original one, so the pair's total ink extent is exactly w: the same visual weight the single solid stroke would have carried, now read as two rules with a gap of their own width between them.
const DOUBLE_RULE_BANDS = 3;

// Which side of the original centreline each of the two rules is drawn on, in emission order.
const DOUBLE_RULE_SIGNS = [1, -1] as const;

// Emits the graphics-state operators one stroke style needs before the path it applies to, and reports whether it emitted any -- the caller uses that to decide whether resetStrokeStyleState is needed afterwards. 'double' is not handled here at all: it is a geometry change (two offset paths), not a graphics-state one, and its callers route around this entirely.
function writeStrokeStyleState(writer: ByteWriter, style: StrokeStyle | undefined, strokeWidthPt: number): boolean {
  if (style === 'dashed') {
    writer.writeAscii(`[${formatNumber(strokeWidthPt * DASHED_ON_WIDTH_MULTIPLE)} ${formatNumber(strokeWidthPt * DASHED_GAP_WIDTH_MULTIPLE)}] ${formatNumber(DASH_PHASE_PT)} d\n`);
    return true;
  }
  if (style === 'dotted') {
    writer.writeAscii(`[${formatNumber(DOTTED_ON_LENGTH_PT)} ${formatNumber(strokeWidthPt * DOTTED_GAP_WIDTH_MULTIPLE)}] ${formatNumber(DASH_PHASE_PT)} d\n`);
    writer.writeAscii(`${formatNumber(LINE_CAP_ROUND)} J\n`);
    return true;
  }
  return false;
}

// Restores the dash pattern (and, after a dotted stroke, the line cap) to the PDF defaults. The graphics state persists for the whole remainder of the content stream, so a dashed table rule left un-reset would silently dash every later line, rect, ellipse, path, and text underline on the same page.
function resetStrokeStyleState(writer: ByteWriter, style: StrokeStyle | undefined): void {
  writer.writeAscii(`[] ${formatNumber(DASH_PHASE_PT)} d\n`);
  if (style === 'dotted') {
    writer.writeAscii(`${formatNumber(LINE_CAP_BUTT)} J\n`);
  }
}

interface UnitNormal {
  readonly x: number;
  readonly y: number;
}

// The left-hand unit normal of the chord from (fromX, fromY) to (toX, toY), or undefined for a zero-length chord -- a point has no direction to be perpendicular to, and normalising it would divide by zero.
function chordNormal(fromX: number, fromY: number, toX: number, toY: number): UnitNormal | undefined {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    return undefined;
  }
  return { x: -dy / length, y: dx / length };
}

// The offset direction at a vertex joining two chords: the normalised sum of their own unit normals, which bisects the corner rather than picking one side's perpendicular arbitrarily. Undefined when neither neighbour has a direction, and also when the two exactly cancel (a 180-degree reversal, where the sum is the zero vector and there is no meaningful bisector) -- both cases leave that point un-offset rather than moving it in an invented direction.
function averageNormal(a: UnitNormal | undefined, b: UnitNormal | undefined): UnitNormal | undefined {
  if (a === undefined) {
    return b;
  }
  if (b === undefined) {
    return a;
  }
  const x = a.x + b.x;
  const y = a.y + b.y;
  const length = Math.hypot(x, y);
  if (length === 0) {
    return undefined;
  }
  return { x: x / length, y: y / length };
}

function offsetX(x: number, normal: UnitNormal | undefined, offsetPt: number): number {
  return normal === undefined ? x : x + normal.x * offsetPt;
}

function offsetY(y: number, normal: UnitNormal | undefined, offsetPt: number): number {
  return normal === undefined ? y : y + normal.y * offsetPt;
}

// Displaces a whole subpath sideways by offsetPt, for the two parallel rules a 'double' stroke is drawn as. Each ON-PATH point moves along the bisector of its own two adjacent chord normals (so a corner's two rules stay parallel through the corner rather than crossing it), and a cubic's control points move along their own segment's chord normal. This is a chord-based approximation of a true parallel curve, not an exact offset -- an exact offset of a cubic Bezier is not itself a cubic and cannot be written as one -- but the offsets here are a third of a stroke width, at which scale the difference is far below the width of the ink being drawn.
function offsetSubpath(subpath: LayoutSubpath, offsetPt: number): LayoutSubpath {
  const points = [{ x: subpath.startXPt, y: subpath.startYPt }, ...subpath.segments.map((segment) => ({ x: segment.xPt, y: segment.yPt }))];

  // One entry per segment, in segment order, plus -- when the subpath is closed -- the implicit closing chord from the last point back to the first. That closing edge is real ink (drawn by 'h'), so its normal has to reach the two vertices it joins just as an explicit segment's does. Indexing works out so that chords[i] is always the chord LEAVING points[i].
  const chords: (UnitNormal | undefined)[] = [];
  for (let i = 0; i + 1 < points.length; i += 1) {
    const from = points[i]!;
    const to = points[i + 1]!;
    chords.push(chordNormal(from.x, from.y, to.x, to.y));
  }
  if (subpath.closed && points.length > 1) {
    const from = points[points.length - 1]!;
    const to = points[0]!;
    chords.push(chordNormal(from.x, from.y, to.x, to.y));
  }

  const vertexNormals = points.map((_point, i) => {
    const incoming = i === 0 ? (subpath.closed ? chords[chords.length - 1] : undefined) : chords[i - 1];
    return averageNormal(incoming, chords[i]);
  });

  return {
    startXPt: offsetX(subpath.startXPt, vertexNormals[0], offsetPt),
    startYPt: offsetY(subpath.startYPt, vertexNormals[0], offsetPt),
    closed: subpath.closed,
    segments: subpath.segments.map((segment, i) => {
      const endNormal = vertexNormals[i + 1];
      if (segment.kind === 'line') {
        return { kind: 'line', xPt: offsetX(segment.xPt, endNormal, offsetPt), yPt: offsetY(segment.yPt, endNormal, offsetPt) };
      }
      // A control point has no vertex of its own to bisect at, so it rides its segment's own chord normal; a degenerate segment (start and end coincident, a legitimate way to write a closed loop) has no chord, and falls back to the normal already computed for the vertex it starts from.
      const controlNormal = chords[i] ?? vertexNormals[i];
      return {
        kind: 'cubic',
        c1xPt: offsetX(segment.c1xPt, controlNormal, offsetPt),
        c1yPt: offsetY(segment.c1yPt, controlNormal, offsetPt),
        c2xPt: offsetX(segment.c2xPt, controlNormal, offsetPt),
        c2yPt: offsetY(segment.c2yPt, controlNormal, offsetPt),
        xPt: offsetX(segment.xPt, endNormal, offsetPt),
        yPt: offsetY(segment.yPt, endNormal, offsetPt),
      };
    }),
  };
}

function writeFillAndStroke(writer: ByteWriter, fill: LayoutColor | undefined, stroke: { readonly color: LayoutColor; readonly widthPt: number } | undefined): void {
  if (fill !== undefined) {
    writeRgbOperator(writer, fill, 'rg');
  }
  if (stroke !== undefined) {
    writeRgbOperator(writer, stroke.color, 'RG');
    writer.writeAscii(`${formatNumber(stroke.widthPt)} w\n`);
  }
}

function writeRect(writer: ByteWriter, item: LayoutRect): void {
  const paint = paintOperatorFor(item.fill, item.stroke);
  if (paint === undefined) {
    return;
  }
  writeFillAndStroke(writer, item.fill, item.stroke);
  writer.writeAscii(`${formatNumber(item.xPt)} ${formatNumber(item.yPt)} ${formatNumber(item.widthPt)} ${formatNumber(item.heightPt)} re\n`);
  writer.writeAscii(`${paint}\n`);
}

// A 'double' line, drawn as its two parallel rules: the line's own direction gives the perpendicular to offset along directly, so there is no per-vertex bisecting to do the way offsetSubpath needs for a path. A zero-length line has no direction at all and is drawn once at its declared width instead -- the only alternative would be offsetting along an invented direction.
function writeDoubleLine(writer: ByteWriter, item: LayoutLine): void {
  writeRgbOperator(writer, item.color, 'RG');
  const normal = chordNormal(item.x1Pt, item.y1Pt, item.x2Pt, item.y2Pt);
  if (normal === undefined) {
    writer.writeAscii(`${formatNumber(item.widthPt)} w\n`);
    writer.writeAscii(`${formatNumber(item.x1Pt)} ${formatNumber(item.y1Pt)} m ${formatNumber(item.x2Pt)} ${formatNumber(item.y2Pt)} l\n`);
    writer.writeAscii('S\n');
    return;
  }
  const ruleWidthPt = item.widthPt / DOUBLE_RULE_BANDS;
  const ruleOffsetPt = item.widthPt / DOUBLE_RULE_BANDS;
  writer.writeAscii(`${formatNumber(ruleWidthPt)} w\n`);
  for (const sign of DOUBLE_RULE_SIGNS) {
    const dx = normal.x * ruleOffsetPt * sign;
    const dy = normal.y * ruleOffsetPt * sign;
    writer.writeAscii(`${formatPoint(item.x1Pt + dx, item.y1Pt + dy)} m ${formatPoint(item.x2Pt + dx, item.y2Pt + dy)} l\n`);
    writer.writeAscii('S\n');
  }
}

function writeLine(writer: ByteWriter, item: LayoutLine): void {
  if (item.style === 'double') {
    writeDoubleLine(writer, item);
    return;
  }
  writeRgbOperator(writer, item.color, 'RG');
  writer.writeAscii(`${formatNumber(item.widthPt)} w\n`);
  const styled = writeStrokeStyleState(writer, item.style, item.widthPt);
  writer.writeAscii(`${formatNumber(item.x1Pt)} ${formatNumber(item.y1Pt)} m ${formatNumber(item.x2Pt)} ${formatNumber(item.y2Pt)} l\n`);
  writer.writeAscii('S\n');
  if (styled) {
    resetStrokeStyleState(writer, item.style);
  }
}

// Approximates the ellipse as four cubic Bezier arcs, one per quadrant, using the standard kappa constant for the control-point offset -- PDF has no native ellipse or circle operator. The final arc returns exactly to the starting point, so an explicit `h` (closepath) is emitted even though it draws no additional ink: ISO 32000-1 8.5.3.1 already implicitly closes every subpath for FILL purposes regardless, but never for STROKE, so an ellipse written without `h` paints its own stroke as a technically-open path -- invisible for a smooth curve with no sharp corner at the seam, but it also means readPdf's own general path tracking (interpret.ts) records the recovered subpath as closed: false (it only sets closed: true when it actually sees an `h` operator), which then blocks a filled-and-stroked ellipse from being recognised as fillable by any downstream ODF/SVG consumer that correctly requires an explicitly closed path before filling it (confirmed against real LibreOffice 26.2: a reconstructed ellipse-turned-path with fill set but closed: false rendered with no fill at all). Emitting `h` makes both the PDF bytes and the recovered geometry match the ellipse's own true, always-closed shape.
function writeEllipse(writer: ByteWriter, item: LayoutEllipse): void {
  const paint = paintOperatorFor(item.fill, item.stroke);
  if (paint === undefined) {
    return;
  }
  writeFillAndStroke(writer, item.fill, item.stroke);

  const cx = item.xPt + item.widthPt / 2;
  const cy = item.yPt + item.heightPt / 2;
  const rx = item.widthPt / 2;
  const ry = item.heightPt / 2;
  const kx = rx * BEZIER_KAPPA;
  const ky = ry * BEZIER_KAPPA;

  writer.writeAscii(`${formatPoint(cx + rx, cy)} m\n`);
  writer.writeAscii(`${formatPoint(cx + rx, cy + ky)} ${formatPoint(cx + kx, cy + ry)} ${formatPoint(cx, cy + ry)} c\n`);
  writer.writeAscii(`${formatPoint(cx - kx, cy + ry)} ${formatPoint(cx - rx, cy + ky)} ${formatPoint(cx - rx, cy)} c\n`);
  writer.writeAscii(`${formatPoint(cx - rx, cy - ky)} ${formatPoint(cx - kx, cy - ry)} ${formatPoint(cx, cy - ry)} c\n`);
  writer.writeAscii(`${formatPoint(cx + kx, cy - ry)} ${formatPoint(cx + rx, cy - ky)} ${formatPoint(cx + rx, cy)} c\n`);
  writer.writeAscii('h\n');
  writer.writeAscii(`${paint}\n`);
}

// One subpath: m (moveto the subpath's own starting point), then l/c per segment, then h if the subpath is closed. No quadratic-to-cubic elevation and no SVG elliptical-arc endpoint-to-center parameterization exist anywhere in this module, deliberately: LayoutPathSegment's own discriminated union (document-schema.js's layout.ts) only ever has 'line'/'cubic' variants, because the sole real-world producer of a LayoutPath -- odf.js's own svg:d/draw:points parser (typed/shared/path.ts), verified against genuine LibreOffice output -- never emits a quadratic or an arc segment in the first place: ODF's own svg:d grammar recognises S/s, Q/q, T/t, A/a as command letters (so the token stream stays in sync) but that parser explicitly produces no segment for any of them, real LibreOffice output for rectangles/ellipses/freeform curves/basic custom-shape presets never exercises them, and ContentPathSegmentSchema itself only models 'line'/'cubic' regardless. There is nothing here to elevate or parameterize, and building that conversion code with no caller would be unused code kept "just in case".
function writeSubpath(writer: ByteWriter, subpath: LayoutSubpath): void {
  writer.writeAscii(`${formatPoint(subpath.startXPt, subpath.startYPt)} m\n`);
  for (const segment of subpath.segments) {
    if (segment.kind === 'line') {
      writer.writeAscii(`${formatPoint(segment.xPt, segment.yPt)} l\n`);
    } else {
      writer.writeAscii(`${formatPoint(segment.c1xPt, segment.c1yPt)} ${formatPoint(segment.c2xPt, segment.c2yPt)} ${formatPoint(segment.xPt, segment.yPt)} c\n`);
    }
  }
  if (subpath.closed) {
    writer.writeAscii('h\n');
  }
}

// A 'double'-stroked path, drawn as its two parallel rules. Any fill paints once, from the ORIGINAL un-offset geometry and before either rule: doubling describes the rule drawn along the path, not the region it encloses, so filling both offset copies would paint the interior twice and bulge it outwards by the offset on whichever side ran wider.
function writeDoublePath(writer: ByteWriter, item: LayoutPath, stroke: { readonly color: LayoutColor; readonly widthPt: number }): void {
  if (item.fill !== undefined) {
    writeRgbOperator(writer, item.fill, 'rg');
    for (const subpath of item.subpaths) {
      writeSubpath(writer, subpath);
    }
    writer.writeAscii(`${item.fillRule === 'evenodd' ? 'f*' : 'f'}\n`);
  }

  const ruleWidthPt = stroke.widthPt / DOUBLE_RULE_BANDS;
  const ruleOffsetPt = stroke.widthPt / DOUBLE_RULE_BANDS;
  writeRgbOperator(writer, stroke.color, 'RG');
  writer.writeAscii(`${formatNumber(ruleWidthPt)} w\n`);
  for (const sign of DOUBLE_RULE_SIGNS) {
    for (const subpath of item.subpaths) {
      writeSubpath(writer, offsetSubpath(subpath, ruleOffsetPt * sign));
    }
    writer.writeAscii('S\n');
  }
}

function writePath(writer: ByteWriter, item: LayoutPath): void {
  const paint = paintOperatorFor(item.fill, item.stroke, item.fillRule);
  if (paint === undefined) {
    return;
  }
  // A stroke style only means anything when there is a stroke to apply it to -- a fill-only path carrying style: 'dashed' has no ink whose on/off lengths could differ, and paints exactly as it would without the field.
  if (item.stroke === undefined) {
    writeFillAndStroke(writer, item.fill, undefined);
    for (const subpath of item.subpaths) {
      writeSubpath(writer, subpath);
    }
    writer.writeAscii(`${paint}\n`);
    return;
  }
  if (item.style === 'double') {
    writeDoublePath(writer, item, item.stroke);
    return;
  }
  writeFillAndStroke(writer, item.fill, item.stroke);
  const styled = writeStrokeStyleState(writer, item.style, item.stroke.widthPt);
  for (const subpath of item.subpaths) {
    writeSubpath(writer, subpath);
  }
  writer.writeAscii(`${paint}\n`);
  if (styled) {
    resetStrokeStyleState(writer, item.style);
  }
}

// Images are drawn into the PDF unit square [0,1]x[0,1] via the Do operator, so the CTM must encode the actual placement (position, size, rotation) in one step: scale the unit square to the image's point dimensions, rotate about its own origin corner, then translate that corner to (xPt, yPt).
function writeImage(writer: ByteWriter, item: LayoutImage, context: ContentWriteContext): void {
  const image = context.resolveImage(item.imageId);
  const scaled = scaleMatrix(item.widthPt, item.heightPt);
  const rotated = multiplyMatrices(scaled, rotationMatrix(item.rotationDeg ?? 0));
  const placed = multiplyMatrices(rotated, translationMatrix(item.xPt, item.yPt));

  writer.writeAscii('q\n');
  writeMatrixOperator(writer, placed, 'cm');
  writer.writeAscii(`/${image.resourceName} Do\n`);
  writer.writeAscii('Q\n');
}

// Renders one page's LayoutItem[] into PDF content-stream operator bytes. 'link' items are annotations, not painted content -- write.ts builds the page's /Annots array from them directly, so they contribute no bytes here.
export function writeContentStream(items: readonly LayoutItem[], context: ContentWriteContext): ContentStreamResult {
  const writer = new ByteWriter();
  const substitutions: WinAnsiSubstitution[] = [];
  const missingGlyphs: EmbeddedFaceSubstitution[] = [];

  for (const item of items) {
    if (item.kind === 'text') {
      writeText(writer, item, context, substitutions, missingGlyphs);
    } else if (item.kind === 'image') {
      writeImage(writer, item, context);
    } else if (item.kind === 'rect') {
      writeRect(writer, item);
    } else if (item.kind === 'line') {
      writeLine(writer, item);
    } else if (item.kind === 'ellipse') {
      writeEllipse(writer, item);
    } else if (item.kind === 'path') {
      writePath(writer, item);
    }
  }

  return { bytes: writer.toBytes(), substitutions, missingGlyphs };
}
