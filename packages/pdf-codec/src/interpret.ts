import { COLOR_BLACK, type Color as LayoutColor } from 'document-schema.js';
import { decodeStream } from './filters';
import type { Matrix, Point } from './matrix';
import { IDENTITY_MATRIX, applyMatrix, multiplyMatrices, translationMatrix } from './matrix';
import type { PdfDict, PdfObject } from './objects';
import { asArray, asName, asNumber, dictGet } from './objects';
import { readContentStream } from './content-read';
import type { PdfDiagnosticSink } from './diagnostics';

// The graphics/text state machine: walks a page's (or a recursed form XObject's) content-stream operations, tracking exactly the state v1 needs to recover -- CTM, fill/stroke colour, line width, and text position/font/size -- and emits one ExtractedItem per meaningful paint operation. Everything else (clipping, shadings, patterns) is deliberately not modelled; see the implementation plan's v1 scope for the reasoning. General path construction (m/l/c/v/y/h/re) and stroking ARE modelled, recovered as ExtractedPath below.

export interface ExtractedTextRun {
  readonly kind: 'text';
  readonly codes: Uint8Array<ArrayBuffer>; // raw show-string bytes, undecoded -- font-read.ts/cmap.ts turn these into Unicode
  readonly fontResourceName: string;
  readonly resources: PdfDict;
  readonly startMatrix: Matrix; // the text rendering matrix (Trm) at the run's first glyph
  readonly endMatrix: Matrix; // Trm at the position the *next* glyph would start -- lets a caller derive the run's on-page width as the device-space distance between the two baseline points, with no separate unit bookkeeping
  readonly sizePt: number;
  readonly color: LayoutColor;
}

// The specific axis-aligned filled-rectangle fast path: a bare "re" immediately painted with f/F/f*, under a non-rotated CTM, and nothing else. Anything more general (a rotated CTM, a stroke, curves, multiple subpaths) falls through to ExtractedPath below instead.
export interface ExtractedRect {
  readonly kind: 'rect';
  readonly xPt: number;
  readonly yPt: number;
  readonly widthPt: number;
  readonly heightPt: number;
  readonly color: LayoutColor;
}

// One line or cubic-Bezier segment of a subpath, device-space (CTM-applied, not yet page-matrix-applied -- matching ExtractedRect's own convention), mirroring document-schema.js's LayoutPathSegment shape exactly so read.ts's conversion is a pure per-point transform.
export type ExtractedPathSegment =
  | { readonly kind: 'line'; readonly xPt: number; readonly yPt: number }
  | { readonly kind: 'cubic'; readonly c1xPt: number; readonly c1yPt: number; readonly c2xPt: number; readonly c2yPt: number; readonly xPt: number; readonly yPt: number };

export interface ExtractedSubpath {
  readonly startXPt: number;
  readonly startYPt: number;
  readonly segments: readonly ExtractedPathSegment[];
  readonly closed: boolean;
}

// General vector-path recovery: anything painted by a path-construction sequence too general for the ExtractedRect fast path above -- a rotated/skewed CTM, a stroke, a curve, multiple subpaths, or a `re` mixed with other path operators in the same sequence. `fillRule` always reflects which paint operator actually ran (nonzero for the plain family, evenodd for the starred family) even when `fill` is undefined, since it costs nothing to record accurately here; read.ts's convertPath is the layer that decides whether it's worth keeping in the minimal LayoutPath it builds.
export interface ExtractedPath {
  readonly kind: 'path';
  readonly subpaths: readonly ExtractedSubpath[];
  readonly fillRule: 'nonzero' | 'evenodd';
  readonly fill: LayoutColor | undefined;
  readonly stroke: { readonly color: LayoutColor; readonly widthPt: number } | undefined;
}

export interface ExtractedImage {
  readonly kind: 'image';
  readonly resourceName: string;
  readonly resources: PdfDict;
  readonly matrix: Matrix; // the CTM at the moment of Do -- placement is x=ctm[4], y=ctm[5], width=|ctm[0]|, height=|ctm[3]| for the axis-aligned case
}

export interface ExtractedInlineImage {
  readonly kind: 'inlineImage';
  readonly dict: PdfDict; // BI dict, keys possibly abbreviated (/W /H /CS /BPC /F /DP /IM) -- images-read.ts normalises
  readonly data: Uint8Array<ArrayBuffer>;
  readonly matrix: Matrix;
}

export type ExtractedItem = ExtractedTextRun | ExtractedRect | ExtractedPath | ExtractedImage | ExtractedInlineImage;

export interface GlyphAdvance {
  readonly widthPer1000: number; // 1000ths of text space, matching PDF's own /Widths convention
  readonly byteLengthConsumed: number; // 1 for a simple font's single-byte codes, 2 for an Identity-H composite font
}

// interpret.ts knows nothing about font dictionaries, /ToUnicode CMaps, or embedded-font tables -- it only needs "how wide is the next glyph and how many bytes did it consume" to advance the text matrix correctly. font-read.ts implements this against a real PdfDocument; tests here use a fake.
export interface FontMetricsPort {
  glyphAdvance(fontResourceName: string, resources: PdfDict, codes: Uint8Array<ArrayBuffer>, byteOffset: number): GlyphAdvance | undefined;
}

// The minimal reference-resolution surface interpret.ts needs (looking up /XObject and /Font resources, and recursing into a resolved Form XObject) -- a structural subset of PdfDocument, not a dependency on document.ts itself.
export interface PdfObjectResolver {
  resolve(obj: PdfObject | undefined): PdfObject | undefined;
  resolveDict(obj: PdfObject | undefined): PdfDict | undefined;
}

export interface InterpretContext {
  readonly fontMetrics: FontMetricsPort;
  readonly resolver: PdfObjectResolver;
  readonly sink: PdfDiagnosticSink;
}

// Guards a self-referential or runaway chain of nested form XObjects -- a corrupt or adversarial file, not something a real producer emits.
const MAX_FORM_XOBJECT_DEPTH = 12;
// An unremarkable mid-range glyph advance (half an em) used only when a shown font resource can't be resolved to any width table at all -- purely to stop subsequent glyphs collapsing onto the same point; the position is already degraded at that point regardless, and is reported via a diagnostic.
const FALLBACK_GLYPH_WIDTH_PER_1000 = 500;
// ISO 32000-1 Table 52: the graphics state's own line width parameter defaults to 1.0 (user-space units) until a `w` operator sets it explicitly.
const DEFAULT_LINE_WIDTH_PT = 1;

interface GraphicsState {
  readonly ctm: Matrix;
  readonly fillColor: LayoutColor;
  readonly strokeColor: LayoutColor;
  readonly lineWidth: number;
}

interface TextState {
  tm: Matrix;
  tlm: Matrix;
  fontResourceName: string | undefined;
  fontSizePt: number;
  charSpace: number;
  wordSpace: number;
  horizScale: number; // Tz / 100
  leading: number;
  rise: number;
}

function defaultTextState(): TextState {
  return { tm: IDENTITY_MATRIX, tlm: IDENTITY_MATRIX, fontResourceName: undefined, fontSizePt: 0, charSpace: 0, wordSpace: 0, horizScale: 1, leading: 0, rise: 0 };
}

function computeTrm(ctm: Matrix, ts: TextState): Matrix {
  const fontMatrix: Matrix = [ts.fontSizePt * ts.horizScale, 0, 0, ts.fontSizePt, 0, ts.rise];
  return multiplyMatrices(multiplyMatrices(fontMatrix, ts.tm), ctm);
}

function numAt(operands: readonly PdfObject[], index: number): number {
  return asNumber(operands[index]) ?? 0;
}

function grayColor(value: number): LayoutColor {
  return { r: value, g: value, b: value };
}

function rgbColor(operands: readonly PdfObject[]): LayoutColor {
  return { r: numAt(operands, 0), g: numAt(operands, 1), b: numAt(operands, 2) };
}

function cmykColor(operands: readonly PdfObject[]): LayoutColor {
  const c = numAt(operands, 0);
  const m = numAt(operands, 1);
  const y = numAt(operands, 2);
  const k = numAt(operands, 3);
  return { r: (1 - c) * (1 - k), g: (1 - m) * (1 - k), b: (1 - y) * (1 - k) };
}

// The generic sc/SC/scn/SCN operators set a colour in whatever space a prior `cs`/`CS` selected, which can be an arbitrary ICC/Indexed/Separation/Pattern resource -- fully resolving that is out of v1 scope. This heuristic (dispatch purely on operand count) covers the overwhelming common case where the selected space is in fact DeviceGray/RGB/CMYK; a trailing pattern-name operand (SCN's own Pattern form) is left as `undefined`, meaning "leave the current colour unchanged," which is honest given a pattern fill has no single flat colour to report anyway.
function genericColor(operands: readonly PdfObject[]): LayoutColor | undefined {
  const numericOperands = operands.filter((o) => o.kind === 'number');
  if (numericOperands.length === 1) {
    return grayColor(numAt(numericOperands, 0));
  }
  if (numericOperands.length === 3) {
    return rgbColor(numericOperands);
  }
  if (numericOperands.length === 4) {
    return cmykColor(numericOperands);
  }
  return undefined;
}

function matrixFromOperands(operands: readonly PdfObject[]): Matrix {
  return [numAt(operands, 0), numAt(operands, 1), numAt(operands, 2), numAt(operands, 3), numAt(operands, 4), numAt(operands, 5)];
}

function isAxisAligned(m: Matrix): boolean {
  // A CTM rotates/skews unless its off-diagonal terms vanish -- the only shape the plan's axis-aligned-rect recovery covers.
  return m[1] === 0 && m[2] === 0;
}

interface PendingRect {
  readonly xPt: number;
  readonly yPt: number;
  readonly widthPt: number;
  readonly heightPt: number;
}

function rectFromOperands(operands: readonly PdfObject[], ctm: Matrix): PendingRect | undefined {
  const x = numAt(operands, 0);
  const y = numAt(operands, 1);
  const w = numAt(operands, 2);
  const h = numAt(operands, 3);
  if (!isAxisAligned(ctm)) {
    return undefined;
  }
  // Device-space placement under an axis-aligned CTM: scale by the diagonal terms, translate by the CTM's own offset. A negative scale (w0 sign matching a mirrored/flipped CTM) is normalised to a positive width/height with the origin adjusted, since LayoutRect has no notion of a mirrored rectangle.
  const scaledX = x * ctm[0] + ctm[4];
  const scaledY = y * ctm[3] + ctm[5];
  const scaledW = w * ctm[0];
  const scaledH = h * ctm[3];
  return {
    xPt: scaledW >= 0 ? scaledX : scaledX + scaledW,
    yPt: scaledH >= 0 ? scaledY : scaledY + scaledH,
    widthPt: Math.abs(scaledW),
    heightPt: Math.abs(scaledH),
  };
}

export function interpretContentStream(bytes: Uint8Array<ArrayBuffer>, resources: PdfDict, context: InterpretContext): ExtractedItem[] {
  const items: ExtractedItem[] = [];
  const initialState: GraphicsState = { ctm: IDENTITY_MATRIX, fillColor: COLOR_BLACK, strokeColor: COLOR_BLACK, lineWidth: DEFAULT_LINE_WIDTH_PT };
  runContentStream(bytes, resources, initialState, context, items, 0);
  return items;
}

// A subpath still being accumulated within one runContentStream call -- `segments` is mutable (pushed to as l/c/v/y arrive) and `closed` flips true on `h` (or the implicit closepath s/b/b* perform); once finalized it is pushed as-is into pathSubpaths, which is exactly ExtractedSubpath's own shape (a mutable segments array satisfies the readonly array field type).
interface MutableSubpath {
  readonly startXPt: number;
  readonly startYPt: number;
  readonly segments: ExtractedPathSegment[];
  closed: boolean;
}

// The device-space point a `v` operator's implicit first control point equals: the subpath's last segment endpoint, or its own start point if no segment has been added yet.
function lastPointOf(subpath: MutableSubpath): Point {
  const last = subpath.segments[subpath.segments.length - 1];
  return last === undefined ? { x: subpath.startXPt, y: subpath.startYPt } : { x: last.xPt, y: last.yPt };
}

function runContentStream(bytes: Uint8Array<ArrayBuffer>, resources: PdfDict, initialState: GraphicsState, context: InterpretContext, items: ExtractedItem[], depth: number): void {
  const operations = readContentStream(bytes, context.sink);
  const gsStack: GraphicsState[] = [];
  let gs = initialState;
  let ts = defaultTextState();
  let pendingRect: PendingRect | undefined;
  let pathSubpaths: MutableSubpath[] = [];
  let currentSubpath: MutableSubpath | undefined;

  // `m` starts a new subpath, finalizing whatever was previously open into pathSubpaths -- `re`'s own implicit leading `m` (see appendRectSubpath) reuses this too. Both a real paint operator and the very next `m` are the only two things that ever finalize a subpath.
  const finalizeCurrentSubpath = (): void => {
    if (currentSubpath !== undefined) {
      pathSubpaths.push(currentSubpath);
      currentSubpath = undefined;
    }
  };

  // Clears every scrap of path state after a paint operator (or a discarded rect), exactly mirroring how pendingRect alone was reset before general path tracking existed.
  const resetPath = (): void => {
    pendingRect = undefined;
    pathSubpaths = [];
    currentSubpath = undefined;
  };

  // ISO 32000-1 8.5.2.1: `re` is defined as exactly the sequence "x y m (x+w) y l (x+w)(y+h) l x (y+h) l h" -- so alongside populating pendingRect for the axis-aligned fast path, it always appends that same 4-point closed subpath to pathSubpaths too, regardless of CTM alignment, so a `re` mixed with other path operators (or under a rotated CTM) still contributes correctly to a general path.
  const appendRectSubpath = (operands: readonly PdfObject[], ctm: Matrix): void => {
    finalizeCurrentSubpath();
    const x = numAt(operands, 0);
    const y = numAt(operands, 1);
    const w = numAt(operands, 2);
    const h = numAt(operands, 3);
    const p1 = applyMatrix(ctm, { x, y });
    const p2 = applyMatrix(ctm, { x: x + w, y });
    const p3 = applyMatrix(ctm, { x: x + w, y: y + h });
    const p4 = applyMatrix(ctm, { x, y: y + h });
    pathSubpaths.push({
      startXPt: p1.x,
      startYPt: p1.y,
      segments: [
        { kind: 'line', xPt: p2.x, yPt: p2.y },
        { kind: 'line', xPt: p3.x, yPt: p3.y },
        { kind: 'line', xPt: p4.x, yPt: p4.y },
      ],
      closed: true,
    });
  };

  // f/F/S/B/b use the nonzero winding rule; the starred variants (f*/B*/b*) use even-odd -- ISO 32000-1 Table 60. `s`/`n` have no fill at all, so their nonzero default is never actually consulted (convertPath in read.ts only keeps fillRule when fill is set).
  const paintFillRuleFor = (operator: string): 'nonzero' | 'evenodd' => (operator.endsWith('*') ? 'evenodd' : 'nonzero');

  // Every path-painting operator (f/F/f*/S/s/B/B*/b/b*/n) funnels through here. `n` never emits (a clip-only path has no ink); the axis-aligned single-`re` fast path is preserved byte-for-byte for f/F/f* (the only operators that ever produced ExtractedRect); everything else that actually constructed a path emits one ExtractedPath.
  const emitPaint = (operator: string): void => {
    if (operator === 'n') {
      resetPath();
      return;
    }
    if ((operator === 's' || operator === 'b' || operator === 'b*') && currentSubpath !== undefined) {
      currentSubpath.closed = true; // s/b/b* are each defined as "h" followed by their non-close counterpart.
    }
    if ((operator === 'f' || operator === 'F' || operator === 'f*') && currentSubpath === undefined && pathSubpaths.length === 1 && pendingRect !== undefined) {
      items.push({ kind: 'rect', ...pendingRect, color: gs.fillColor });
      resetPath();
      return;
    }
    finalizeCurrentSubpath();
    if (pathSubpaths.length > 0) {
      const isFillOp = operator === 'f' || operator === 'F' || operator === 'f*' || operator === 'B' || operator === 'B*' || operator === 'b' || operator === 'b*';
      const isStrokeOp = operator === 'S' || operator === 's' || operator === 'B' || operator === 'B*' || operator === 'b' || operator === 'b*';
      items.push({
        kind: 'path',
        subpaths: pathSubpaths,
        fillRule: paintFillRuleFor(operator),
        fill: isFillOp ? gs.fillColor : undefined,
        stroke: isStrokeOp ? { color: gs.strokeColor, widthPt: gs.lineWidth } : undefined,
      });
    }
    resetPath();
  };

  const advanceThroughString = (codes: Uint8Array<ArrayBuffer>): void => {
    if (ts.fontResourceName === undefined) {
      return;
    }
    let offset = 0;
    while (offset < codes.length) {
      const glyph = context.fontMetrics.glyphAdvance(ts.fontResourceName, resources, codes, offset);
      if (glyph === undefined) {
        context.sink({ code: 'pdf/font-not-resolved', severity: 'warning', message: `could not resolve font resource /${ts.fontResourceName} to compute a glyph advance; assuming a fallback width` });
      }
      const widthPer1000 = glyph?.widthPer1000 ?? FALLBACK_GLYPH_WIDTH_PER_1000;
      const byteLength = glyph?.byteLengthConsumed ?? 1;
      const isSingleByteSpace = byteLength === 1 && codes[offset] === 0x20;
      const tx = ((widthPer1000 / 1000) * ts.fontSizePt + ts.charSpace + (isSingleByteSpace ? ts.wordSpace : 0)) * ts.horizScale;
      ts.tm = multiplyMatrices(translationMatrix(tx, 0), ts.tm);
      offset += byteLength;
    }
  };

  const showTextArray = (elements: readonly PdfObject[]): void => {
    if (ts.fontResourceName === undefined) {
      return;
    }
    const startMatrix = computeTrm(gs.ctm, ts);
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let totalLength = 0;
    for (const el of elements) {
      if (el.kind === 'string') {
        chunks.push(el.bytes);
        totalLength += el.bytes.length;
        advanceThroughString(el.bytes);
      } else if (el.kind === 'number') {
        const adjustment = -(el.value / 1000) * ts.fontSizePt * ts.horizScale;
        ts.tm = multiplyMatrices(translationMatrix(adjustment, 0), ts.tm);
      }
    }
    if (totalLength === 0) {
      return;
    }
    const combined = new Uint8Array(totalLength);
    let at = 0;
    for (const chunk of chunks) {
      combined.set(chunk, at);
      at += chunk.length;
    }
    const endMatrix = computeTrm(gs.ctm, ts);
    items.push({ kind: 'text', codes: combined, fontResourceName: ts.fontResourceName, resources, startMatrix, endMatrix, sizePt: ts.fontSizePt, color: gs.fillColor });
  };

  const showText = (bytes: Uint8Array<ArrayBuffer>): void => {
    showTextArray([{ kind: 'string', bytes, hex: false }]);
  };

  const nextLine = (): void => {
    ts.tlm = multiplyMatrices(translationMatrix(0, -ts.leading), ts.tlm);
    ts.tm = ts.tlm;
  };

  const handleDo = (name: string | undefined): void => {
    if (name === undefined) {
      return;
    }
    const xobjects = context.resolver.resolveDict(dictGet(resources, 'XObject'));
    const xobj = xobjects !== undefined ? context.resolver.resolve(dictGet(xobjects, name)) : undefined;
    if (xobj?.kind !== 'stream') {
      context.sink({ code: 'pdf/xobject-not-resolved', severity: 'warning', message: `XObject resource /${name} did not resolve to a stream` });
      return;
    }
    const subtype = asName(dictGet(xobj.dict, 'Subtype'));
    if (subtype === 'Image') {
      items.push({ kind: 'image', resourceName: name, resources, matrix: gs.ctm });
      return;
    }
    if (subtype === 'Form') {
      if (depth >= MAX_FORM_XOBJECT_DEPTH) {
        context.sink({ code: 'pdf/form-recursion-limit', severity: 'warning', message: 'form XObject recursion exceeded the depth limit; skipping further nesting' });
        return;
      }
      const formMatrixArr = asArray(dictGet(xobj.dict, 'Matrix'));
      const formMatrix = formMatrixArr !== undefined ? matrixFromOperands(formMatrixArr) : IDENTITY_MATRIX;
      const formResources = context.resolver.resolveDict(dictGet(xobj.dict, 'Resources')) ?? resources;
      const decoded = decodeStream(xobj.raw, xobj.dict, context.sink);
      const formState: GraphicsState = { ...gs, ctm: multiplyMatrices(formMatrix, gs.ctm) };
      runContentStream(decoded.bytes, formResources, formState, context, items, depth + 1);
    }
  };

  for (const token of operations) {
    if (token.kind === 'inlineImage') {
      items.push({ kind: 'inlineImage', dict: token.image.dict, data: token.image.data, matrix: gs.ctm });
      continue;
    }
    const { operands, operator } = token.operation;
    switch (operator) {
      case 'q':
        gsStack.push(gs);
        break;
      case 'Q':
        gs = gsStack.pop() ?? gs;
        break;
      case 'cm':
        gs = { ...gs, ctm: multiplyMatrices(matrixFromOperands(operands), gs.ctm) };
        break;
      case 'g':
        gs = { ...gs, fillColor: grayColor(numAt(operands, 0)) };
        break;
      case 'G':
        gs = { ...gs, strokeColor: grayColor(numAt(operands, 0)) };
        break;
      case 'rg':
        gs = { ...gs, fillColor: rgbColor(operands) };
        break;
      case 'RG':
        gs = { ...gs, strokeColor: rgbColor(operands) };
        break;
      case 'k':
        gs = { ...gs, fillColor: cmykColor(operands) };
        break;
      case 'K':
        gs = { ...gs, strokeColor: cmykColor(operands) };
        break;
      case 'sc':
      case 'scn': {
        const color = genericColor(operands);
        if (color !== undefined) {
          gs = { ...gs, fillColor: color };
        }
        break;
      }
      case 'SC':
      case 'SCN': {
        const color = genericColor(operands);
        if (color !== undefined) {
          gs = { ...gs, strokeColor: color };
        }
        break;
      }
      case 're':
        pendingRect = rectFromOperands(operands, gs.ctm);
        appendRectSubpath(operands, gs.ctm);
        break;
      case 'm': {
        finalizeCurrentSubpath();
        const p = applyMatrix(gs.ctm, { x: numAt(operands, 0), y: numAt(operands, 1) });
        currentSubpath = { startXPt: p.x, startYPt: p.y, segments: [], closed: false };
        pendingRect = undefined;
        break;
      }
      case 'l': {
        const p = applyMatrix(gs.ctm, { x: numAt(operands, 0), y: numAt(operands, 1) });
        currentSubpath?.segments.push({ kind: 'line', xPt: p.x, yPt: p.y });
        pendingRect = undefined;
        break;
      }
      case 'c': {
        const c1 = applyMatrix(gs.ctm, { x: numAt(operands, 0), y: numAt(operands, 1) });
        const c2 = applyMatrix(gs.ctm, { x: numAt(operands, 2), y: numAt(operands, 3) });
        const p = applyMatrix(gs.ctm, { x: numAt(operands, 4), y: numAt(operands, 5) });
        currentSubpath?.segments.push({ kind: 'cubic', c1xPt: c1.x, c1yPt: c1.y, c2xPt: c2.x, c2yPt: c2.y, xPt: p.x, yPt: p.y });
        pendingRect = undefined;
        break;
      }
      case 'v': {
        // Shorthand cubic: the first control point is the current point, only the second control point and the endpoint are given as operands.
        if (currentSubpath !== undefined) {
          const cur = lastPointOf(currentSubpath);
          const c2 = applyMatrix(gs.ctm, { x: numAt(operands, 0), y: numAt(operands, 1) });
          const p = applyMatrix(gs.ctm, { x: numAt(operands, 2), y: numAt(operands, 3) });
          currentSubpath.segments.push({ kind: 'cubic', c1xPt: cur.x, c1yPt: cur.y, c2xPt: c2.x, c2yPt: c2.y, xPt: p.x, yPt: p.y });
        }
        pendingRect = undefined;
        break;
      }
      case 'y': {
        // Shorthand cubic: the second control point equals the endpoint, only the first control point and the endpoint are given as operands.
        const c1 = applyMatrix(gs.ctm, { x: numAt(operands, 0), y: numAt(operands, 1) });
        const p = applyMatrix(gs.ctm, { x: numAt(operands, 2), y: numAt(operands, 3) });
        currentSubpath?.segments.push({ kind: 'cubic', c1xPt: c1.x, c1yPt: c1.y, c2xPt: p.x, c2yPt: p.y, xPt: p.x, yPt: p.y });
        pendingRect = undefined;
        break;
      }
      case 'h':
        if (currentSubpath !== undefined) {
          currentSubpath.closed = true;
        }
        pendingRect = undefined;
        break;
      case 'w':
        gs = { ...gs, lineWidth: numAt(operands, 0) };
        break;
      case 'f':
      case 'F':
      case 'f*':
      case 'S':
      case 's':
      case 'B':
      case 'B*':
      case 'b':
      case 'b*':
      case 'n':
        emitPaint(operator);
        break;
      case 'BT':
        ts = defaultTextState();
        break;
      case 'Tf':
        ts.fontResourceName = asName(operands[0]);
        ts.fontSizePt = numAt(operands, 1);
        break;
      case 'Tc':
        ts.charSpace = numAt(operands, 0);
        break;
      case 'Tw':
        ts.wordSpace = numAt(operands, 0);
        break;
      case 'Tz':
        ts.horizScale = numAt(operands, 0) / 100;
        break;
      case 'TL':
        ts.leading = numAt(operands, 0);
        break;
      case 'Ts':
        ts.rise = numAt(operands, 0);
        break;
      case 'Td':
        ts.tlm = multiplyMatrices(translationMatrix(numAt(operands, 0), numAt(operands, 1)), ts.tlm);
        ts.tm = ts.tlm;
        break;
      case 'TD':
        ts.leading = -numAt(operands, 1);
        ts.tlm = multiplyMatrices(translationMatrix(numAt(operands, 0), numAt(operands, 1)), ts.tlm);
        ts.tm = ts.tlm;
        break;
      case 'Tm':
        ts.tlm = matrixFromOperands(operands);
        ts.tm = ts.tlm;
        break;
      case 'T*':
        nextLine();
        break;
      case 'Tj': {
        const str = operands[0];
        if (str?.kind === 'string') {
          showText(str.bytes);
        }
        break;
      }
      case "'": {
        nextLine();
        const str = operands[0];
        if (str?.kind === 'string') {
          showText(str.bytes);
        }
        break;
      }
      case '"': {
        ts.wordSpace = numAt(operands, 0);
        ts.charSpace = numAt(operands, 1);
        nextLine();
        const str = operands[2];
        if (str?.kind === 'string') {
          showText(str.bytes);
        }
        break;
      }
      case 'TJ': {
        const array = asArray(operands[0]);
        if (array !== undefined) {
          showTextArray(array);
        }
        break;
      }
      case 'Do':
        handleDo(asName(operands[0]));
        break;
      default:
        break; // every other operator (marked content, shading, clipping, ExtGState, dash pattern, line cap/join) is outside v1's extraction scope
    }
  }
}
