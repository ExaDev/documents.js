import type { LayoutEllipse, LayoutImage, LayoutItem, LayoutLine, LayoutPath, LayoutRect, LayoutSubpath, LayoutText } from 'document-schema.js';
import type { Color as LayoutColor } from 'document-schema.js';
import type { LayoutFont } from 'document-schema.js';
import type { StandardFontName } from './afm-widths';
import { ByteWriter } from './bytes/writer';
import type { Matrix } from './matrix';
import { multiplyMatrices, rotationMatrix, scaleMatrix, translationMatrix } from './matrix';
import type { TextMeasurer } from './measure';
import { pdfHexString } from './objects';
import { formatNumber, writeObject } from './serialize';
import type { WinAnsiSubstitution } from './winansi';
import { encodeForShow } from './winansi';

export interface ResolvedFontResource {
  readonly resourceName: string; // e.g. 'F1', the key under the page's /Resources/Font dict
  readonly standardName: StandardFontName;
}

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
  // Every WinAnsi substitution made while emitting text, in item order -- content-write.ts has no Diagnostic schema of its own to turn these into, so it hands back the raw substitutions and leaves that translation to whichever layer owns diagnostics.
  readonly substitutions: readonly WinAnsiSubstitution[];
}

// 4/3 * (sqrt(2) - 1): the standard cubic-Bezier approximation of a quarter circle, used since PDF has no native ellipse (or even circle) path operator.
const BEZIER_KAPPA = 0.5522847498;

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

function writeUnderline(writer: ByteWriter, item: LayoutText, widthPt: number, measurer: TextMeasurer): void {
  const underline = measurer.underlineAtSize(item.font, item.sizePt);
  writer.writeAscii('q\n');
  writeMatrixOperator(writer, anchorMatrix(item.xPt, item.yPt, item.rotationDeg), 'cm');
  writeRgbOperator(writer, item.color, 'rg');
  writer.writeAscii(`0 ${formatNumber(underline.offsetPt)} ${formatNumber(widthPt)} ${formatNumber(underline.thicknessPt)} re\n`);
  writer.writeAscii('f\n');
  writer.writeAscii('Q\n');
}

function writeText(writer: ByteWriter, item: LayoutText, context: ContentWriteContext, substitutions: WinAnsiSubstitution[]): void {
  const font = context.resolveFont(item.font);
  const encoded = encodeForShow(item.text, font.standardName);
  substitutions.push(...encoded.substitutions);

  // The Tz (horizontal scaling) percentage is a text-state parameter that persists across content-stream items until explicitly changed -- it must be written for every text item, even when the correction is 1.0 (100%), or a preceding item's correction would silently leak into this one.
  const scalePercent = context.measurer.horizontalScaleFor(item.font) * 100;

  writer.writeAscii('BT\n');
  writer.writeAscii(`/${font.resourceName} ${formatNumber(item.sizePt)} Tf\n`);
  writer.writeAscii(`${formatNumber(scalePercent)} Tz\n`);
  writeRgbOperator(writer, item.color, 'rg');
  writeMatrixOperator(writer, anchorMatrix(item.xPt, item.yPt, item.rotationDeg), 'Tm');
  writeObject(writer, pdfHexString(encoded.codes));
  writer.writeAscii(' Tj\n');
  writer.writeAscii('ET\n');

  if (item.underline === true) {
    const scale = context.measurer.horizontalScaleFor(item.font);
    const widthPt = item.widthPt ?? (encoded.width1000 / 1000) * item.sizePt * scale;
    writeUnderline(writer, item, widthPt, context.measurer);
  }
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

function writeLine(writer: ByteWriter, item: LayoutLine): void {
  writeRgbOperator(writer, item.color, 'RG');
  writer.writeAscii(`${formatNumber(item.widthPt)} w\n`);
  writer.writeAscii(`${formatNumber(item.x1Pt)} ${formatNumber(item.y1Pt)} m ${formatNumber(item.x2Pt)} ${formatNumber(item.y2Pt)} l\n`);
  writer.writeAscii('S\n');
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

// One subpath: m (moveto the subpath's own starting point), then l/c per segment, then h if the subpath is closed. No quadratic-to-cubic elevation and no SVG elliptical-arc endpoint-to-center parameterization exist anywhere in this module, deliberately: LayoutPathSegment's own discriminated union (document-content-model's layout.ts) only ever has 'line'/'cubic' variants, because the sole real-world producer of a LayoutPath -- odf.js's own svg:d/draw:points parser (typed/shared/path.ts), verified against genuine LibreOffice output -- never emits a quadratic or an arc segment in the first place: ODF's own svg:d grammar recognises S/s, Q/q, T/t, A/a as command letters (so the token stream stays in sync) but that parser explicitly produces no segment for any of them, real LibreOffice output for rectangles/ellipses/freeform curves/basic custom-shape presets never exercises them, and ContentPathSegmentSchema itself only models 'line'/'cubic' regardless. There is nothing here to elevate or parameterize, and building that conversion code with no caller would be unused code kept "just in case".
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

function writePath(writer: ByteWriter, item: LayoutPath): void {
  const paint = paintOperatorFor(item.fill, item.stroke, item.fillRule);
  if (paint === undefined) {
    return;
  }
  writeFillAndStroke(writer, item.fill, item.stroke);
  for (const subpath of item.subpaths) {
    writeSubpath(writer, subpath);
  }
  writer.writeAscii(`${paint}\n`);
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

  for (const item of items) {
    if (item.kind === 'text') {
      writeText(writer, item, context, substitutions);
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

  return { bytes: writer.toBytes(), substitutions };
}
