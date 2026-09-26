import {
  COLOR_BLACK,
  type Color as LayoutColor,
  type Point,
} from "document-schema.js";
import { decodeStream } from "./filters";
import type { Matrix } from "./matrix";
import {
  IDENTITY_MATRIX,
  applyMatrix,
  multiplyMatrices,
  translationMatrix,
} from "./matrix";
import type { PdfDict, PdfObject } from "./objects";
import { asArray, asName, asNumber, dictGet } from "./objects";
import { readContentStream } from "./content-read";
import {
  grayColor,
  rgbColor,
  cmykColor,
  genericColor,
} from "./interpret-colors";
import {
  MarkedContentStack,
  classifyShape,
  strokeStyleFromDashArray,
} from "./interpret-shapes";
import {
  markedContentProperties,
  markedContentScopeProps,
} from "./interpret-marked";
import type {
  ExtractedPaint,
  ExtractedItem,
  ExtractedPathSegment,
  InterpretContext,
} from "./interpret-types";

// The graphics/text state machine: walks a page's (or a recursed form XObject's) content-stream operations, tracking exactly the state v1 needs to recover — CTM, fill/stroke colour, line width, and text position/font/size — and emits one ExtractedItem per meaningful paint operation. Everything else (clipping, shadings, patterns) is deliberately not modelled; see the implementation plan's v1 scope for the reasoning. General path construction (m/l/c/v/y/h/re) and stroking ARE modelled, recovered as ExtractedPath below — or, when the recovered geometry matches one of the three characteristic simple-shape patterns classifyShape recognises, as the more specific ExtractedRect/ExtractedEllipse/ExtractedLine instead.

const MAX_FORM_XOBJECT_DEPTH = 12;
// An unremarkable mid-range glyph advance (half an em) used only when a shown font resource can't be resolved to any width table at all — purely to stop subsequent glyphs collapsing onto the same point; the position is already degraded at that point regardless, and is reported via a diagnostic.
const FALLBACK_GLYPH_WIDTH_PER_1000 = 500;
// Every "...Per1000" value above is expressed in thousandths of a text-space unit, matching PDF's own /Widths convention (see widthPer1000's own comment); dividing by this converts back to text-space units before scaling by the font size.
const GLYPH_SPACE_PER_TEXT_SPACE_UNIT = 1000;
// The ASCII space character: word spacing (Tw) applies only to a single-byte code equal to this value (ISO 32000-1 9.3.3).
const ASCII_SPACE = 0x20;
// ISO 32000-1 Table 52: the graphics state's own line width parameter defaults to 1.0 (user-space units) until a `w` operator sets it explicitly.
const DEFAULT_LINE_WIDTH_PT = 1;

// ISO 32000-1 Table 52 lists the text state parameters — the font and size a Tf selects, plus Tc/Tw/Tz/TL/Ts — among the device-independent graphics state parameters, so they belong here rather than beside the text matrix: `q` saves them and `Q` restores them exactly as it does the CTM or the fill colour, and a form XObject invoked by `Do` inherits them exactly as it inherits the CTM (8.10.2). Only the text matrix and text line matrix are excluded, and they live in TextObjectState below. Modelling the two as one record is what makes both facts structural rather than something each operator has to remember.
interface GraphicsState {
  readonly ctm: Matrix;
  readonly fillColor: LayoutColor;
  readonly strokeColor: LayoutColor;
  readonly lineWidth: number;
  readonly dashArray: readonly number[]; // the `d` operator's own dash array (ISO 32000-1 8.4.3.6), empty for the PDF default (a solid line) — the dash phase is write-only state this package never reads back, since content-write.ts always emits phase 0 and no recoverable ContentStrokeStyle distinguishes phases
  readonly fontResourceName: string | undefined;
  readonly fontSizePt: number;
  readonly charSpace: number;
  readonly wordSpace: number;
  readonly horizScale: number; // Tz / 100
  readonly leading: number;
  readonly rise: number;
}

// The text matrix and text line matrix: text OBJECT state (ISO 32000-1 9.4.1), not graphics state. They exist only between BT and ET, are reset to identity by every BT, and are the one part of the text machinery `Q` must not restore — so they sit outside GraphicsState and outside the q/Q stack entirely.
interface TextObjectState {
  tm: Matrix;
  tlm: Matrix;
}

function initialTextParameters(): Omit<
  GraphicsState,
  "ctm" | "fillColor" | "strokeColor" | "lineWidth" | "dashArray"
> {
  return {
    fontResourceName: undefined,
    fontSizePt: 0,
    charSpace: 0,
    wordSpace: 0,
    horizScale: 1,
    leading: 0,
    rise: 0,
  };
}

function defaultTextObjectState(): TextObjectState {
  return { tm: IDENTITY_MATRIX, tlm: IDENTITY_MATRIX };
}

function computeTrm(gs: GraphicsState, text: TextObjectState): Matrix {
  const fontMatrix: Matrix = [
    gs.fontSizePt * gs.horizScale,
    0,
    0,
    gs.fontSizePt,
    0,
    gs.rise,
  ];
  return multiplyMatrices(multiplyMatrices(fontMatrix, text.tm), gs.ctm);
}

export function numAt(operands: readonly PdfObject[], index: number): number {
  return asNumber(operands[index]) ?? 0;
}

const MATRIX_D_INDEX = 3;
const MATRIX_E_INDEX = 4;
const MATRIX_F_INDEX = 5;

function matrixFromOperands(operands: readonly PdfObject[]): Matrix {
  return [
    numAt(operands, 0),
    numAt(operands, 1),
    numAt(operands, 2),
    numAt(operands, MATRIX_D_INDEX),
    numAt(operands, MATRIX_E_INDEX),
    numAt(operands, MATRIX_F_INDEX),
  ];
}

// --- Characteristic-shape detection over a recovered general path ---
//
// PDF's content-stream vocabulary has exactly one shape primitive, `re`, and no ellipse or line operator at all: an ellipse is written as four cubic Bezier arcs, a line as a two-point stroked path, and even a rectangle stops being a `re` the moment its producer chooses to draw it corner by corner. Recovering all four as an undifferentiated LayoutPath is truthful but lossy in a way that matters downstream — a caller reconstructing an ODF drawing wants draw:rect/draw:ellipse/draw:line back, not a path approximating each. These detectors recover the specific kind whenever the geometry unambiguously matches the characteristic pattern that kind is always written as.
//
// This is a deliberate, bounded heuristic, not a certainty, and the false-positive risk is real in both directions of the ellipse case in particular: a hand-authored freeform path that happens to consist of four cubic segments meeting at the four cardinal points of its own bounding box, with control points at the kappa ratio, is indistinguishable from a "real" ellipse in the PDF bytes — because at that point it geometrically IS one, whatever the author called it. The rect and line detections carry the same character (a four-corner axis-aligned polygon is a rectangle; a single stroked segment is a line) but far less risk, since neither has a tolerance-sensitive constant to match. What the heuristic cannot do is misreport geometry: every detected shape reproduces its source path's own points exactly, so a false positive changes an item's KIND, never where or how big it is.

// The `re` operator's own four operands, x y w h (ISO 32000-1 8.5.2.1): h is the fourth, 0-indexed, falling outside this rule's own ignored range (0-2).
const RE_HEIGHT_INDEX = 3;
// Path-construction operator operand indices (ISO 32000-1 8.5.2.2 Table 59): each pair of operands is one point's x, y. 0-2 fall inside this rule's own ignored range; the 4th operand (index 3) is a control point's y in the full 6-operand cubic (c) or an endpoint's y in the 4-operand shorthand cubics (v, y), and the 5th/6th (indices 4, 5) are the endpoint's x, y in the full cubic.
const OPERAND_INDEX_3 = 3;
const OPERAND_INDEX_4 = 4;
const OPERAND_INDEX_5 = 5;
// Tz sets horizontal scaling as a percentage (ISO 32000-1 9.3.4); dividing by this converts it to the scale factor gs.horizScale stores.
const TZ_PERCENT_DIVISOR = 100;

export function interpretContentStream(
  bytes: Uint8Array<ArrayBuffer>,
  resources: PdfDict,
  context: InterpretContext,
): ExtractedItem[] {
  const initialState: GraphicsState = {
    ctm: IDENTITY_MATRIX,
    fillColor: COLOR_BLACK,
    strokeColor: COLOR_BLACK,
    lineWidth: DEFAULT_LINE_WIDTH_PT,
    dashArray: [],
    ...initialTextParameters(),
  };
  return runContentStream(
    bytes,
    resources,
    initialState,
    context,
    0,
    new MarkedContentStack(),
  );
}

// What a BDC span puts in scope for the items it brackets (ISO 32000-1 14.10): optional-content membership, the replacement reading, and the alternate description. Nested spans stack; the innermost /OC in scope wins for membership, and an absent property in an inner span falls through to the enclosing one.
export interface MarkedContentProps {
  readonly layerName?: string;
  readonly actualText?: string;
  readonly alt?: string;
  readonly mcid?: number;
}

// A subpath still being accumulated within one runContentStream call — `segments` is mutable (pushed to as l/c/v/y arrive) and `closed` flips true on `h` (or the implicit closepath s/b/b* perform); once finalized it is pushed as-is into pathSubpaths, which is exactly ExtractedSubpath's own shape (a mutable segments array satisfies the readonly array field type).
interface MutableSubpath {
  readonly startXPt: number;
  readonly startYPt: number;
  readonly segments: ExtractedPathSegment[];
  closed: boolean;
}

// The device-space point a `v` operator's implicit first control point equals: the subpath's last segment endpoint, or its own start point if no segment has been added yet.
function lastPointOf(subpath: MutableSubpath): Point {
  const last = subpath.segments[subpath.segments.length - 1];
  return last === undefined
    ? { x: subpath.startXPt, y: subpath.startYPt }
    : { x: last.xPt, y: last.yPt };
}

function runContentStream(
  bytes: Uint8Array<ArrayBuffer>,
  resources: PdfDict,
  initialState: GraphicsState,
  context: InterpretContext,
  depth: number,
  markedContent: MarkedContentStack,
): ExtractedItem[] {
  const items: ExtractedItem[] = [];
  const operations = readContentStream(bytes, context.sink);
  const gsStack: GraphicsState[] = [];
  let gs = initialState;
  let text = defaultTextObjectState();
  let pathSubpaths: MutableSubpath[] = [];
  let currentSubpath: MutableSubpath | undefined;

  const inScope = <K extends keyof MarkedContentProps>(
    key: K,
  ): MarkedContentProps[K] | undefined => markedContent.inScope(key);

  // Every extracted item funnels through here so span membership lands on all of them uniformly: the span's layer fills an unstamped item (an XObject's own /OC already set), and the text-only properties land only on text runs.
  const pushItem = (item: ExtractedItem): void => {
    if (item.kind === "text") {
      const layer = item.layerName ?? inScope("layerName");
      const actualText = inScope("actualText");
      const alt = inScope("alt");
      const mcid = inScope("mcid");
      items.push({
        ...item,
        ...(layer !== undefined ? { layerName: layer } : {}),
        ...(actualText !== undefined ? { actualText } : {}),
        ...(alt !== undefined ? { alt } : {}),
        ...(mcid !== undefined ? { mcid } : {}),
      });
      return;
    }
    const layer = item.layerName ?? inScope("layerName");
    const layerStamped =
      layer === undefined ? item : { ...item, layerName: layer };
    const mcid = inScope("mcid");
    items.push(mcid === undefined ? layerStamped : { ...layerStamped, mcid });
  };

  // `m` starts a new subpath, finalizing whatever was previously open into pathSubpaths — `re`'s own implicit leading `m` (see appendRectSubpath) reuses this too. Both a real paint operator and the very next `m` are the only two things that ever finalize a subpath.
  const finalizeCurrentSubpath = (): void => {
    if (currentSubpath !== undefined) {
      pathSubpaths.push(currentSubpath);
      currentSubpath = undefined;
    }
  };

  // Clears every scrap of path state after a paint operator.
  const resetPath = (): void => {
    pathSubpaths = [];
    currentSubpath = undefined;
  };

  // ISO 32000-1 8.5.2.1: `re` is defined as exactly the sequence "x y m (x+w) y l (x+w)(y+h) l x (y+h) l h", so that is precisely what it appends — one 4-point closed subpath, its corners through the current CTM. There is no separate rectangle bookkeeping alongside it: classifyShape recovers the rectangle back out of exactly these four corners, which is what lets a hand-constructed m/l/l/l/h rectangle and a `re` be recognised by one code path rather than two.
  const appendRectSubpath = (
    operands: readonly PdfObject[],
    ctm: Matrix,
  ): void => {
    finalizeCurrentSubpath();
    const x = numAt(operands, 0);
    const y = numAt(operands, 1);
    const w = numAt(operands, 2);
    const h = numAt(operands, RE_HEIGHT_INDEX);
    const p1 = applyMatrix(ctm, { x, y });
    const p2 = applyMatrix(ctm, { x: x + w, y });
    const p3 = applyMatrix(ctm, { x: x + w, y: y + h });
    const p4 = applyMatrix(ctm, { x, y: y + h });
    pathSubpaths.push({
      startXPt: p1.x,
      startYPt: p1.y,
      segments: [
        { kind: "line", xPt: p2.x, yPt: p2.y },
        { kind: "line", xPt: p3.x, yPt: p3.y },
        { kind: "line", xPt: p4.x, yPt: p4.y },
      ],
      closed: true,
    });
  };

  // f/F/S/B/b use the nonzero winding rule; the starred variants (f*/B*/b*) use even-odd — ISO 32000-1 Table 60. `s`/`n` have no fill at all, so their nonzero default is never actually consulted (convertPath in read.ts only keeps fillRule when fill is set).
  const paintFillRuleFor = (operator: string): "nonzero" | "evenodd" =>
    operator.endsWith("*") ? "evenodd" : "nonzero";

  // Every path-painting operator (f/F/f*/S/s/B/B*/b/b*/n) funnels through here. `n` never emits (a clip-only path has no ink); everything else that actually constructed a path is offered to classifyShape first, and emits the specific rect/ellipse/line it matched or one general ExtractedPath if it matched none. The even-odd fill rule is deliberately not a barrier to shape classification: for the single closed subpath every detector requires, even-odd and nonzero winding select exactly the same interior, so a rectangle painted with `f*` is the same rectangle `f` would have painted — and LayoutRect/LayoutEllipse carry no fill rule to lose in the first place.
  const emitPaint = (operator: string): void => {
    if (operator === "n") {
      resetPath();
      return;
    }
    if (
      (operator === "s" || operator === "b" || operator === "b*") &&
      currentSubpath !== undefined
    ) {
      currentSubpath.closed = true; // s/b/b* are each defined as "h" followed by their non-close counterpart.
    }
    finalizeCurrentSubpath();
    if (pathSubpaths.length > 0) {
      const isFillOp =
        operator === "f" ||
        operator === "F" ||
        operator === "f*" ||
        operator === "B" ||
        operator === "B*" ||
        operator === "b" ||
        operator === "b*";
      const isStrokeOp =
        operator === "S" ||
        operator === "s" ||
        operator === "B" ||
        operator === "B*" ||
        operator === "b" ||
        operator === "b*";
      const paint: ExtractedPaint = {
        fill: isFillOp ? gs.fillColor : undefined,
        stroke: isStrokeOp
          ? { color: gs.strokeColor, widthPt: gs.lineWidth }
          : undefined,
      };
      const strokeStyle = isStrokeOp
        ? strokeStyleFromDashArray(gs.dashArray)
        : undefined;
      pushItem(
        classifyShape(pathSubpaths, paint, strokeStyle) ?? {
          kind: "path",
          subpaths: pathSubpaths,
          fillRule: paintFillRuleFor(operator),
          ...paint,
          ...(strokeStyle !== undefined ? { style: strokeStyle } : {}),
        },
      );
    }
    resetPath();
  };

  const advanceThroughString = (codes: Uint8Array<ArrayBuffer>): void => {
    const fontResourceName = gs.fontResourceName;
    if (fontResourceName === undefined) {
      return;
    }
    let offset = 0;
    while (offset < codes.length) {
      const glyph = context.fontMetrics.glyphAdvance(
        fontResourceName,
        resources,
        codes,
        offset,
      );
      if (glyph === undefined) {
        context.sink({
          code: "pdf/font-not-resolved",
          severity: "warning",
          message: `could not resolve font resource /${fontResourceName} to compute a glyph advance; assuming a fallback width`,
        });
      }
      const widthPer1000 = glyph?.widthPer1000 ?? FALLBACK_GLYPH_WIDTH_PER_1000;
      const byteLength = glyph?.byteLengthConsumed ?? 1;
      const isSingleByteSpace =
        byteLength === 1 && codes[offset] === ASCII_SPACE;
      const spacing = gs.charSpace + (isSingleByteSpace ? gs.wordSpace : 0);
      // ISO 32000-1 9.4.4's own two displacement formulas. Horizontal advances by the glyph's width along x, scaled by Tz; vertical advances by the glyph's own w1y along y, which Tz does not touch since it scales horizontally only.
      const vertical = glyph?.vertical;
      text.tm =
        vertical === undefined
          ? multiplyMatrices(
              translationMatrix(
                ((widthPer1000 / GLYPH_SPACE_PER_TEXT_SPACE_UNIT) *
                  gs.fontSizePt +
                  spacing) *
                  gs.horizScale,
                0,
              ),
              text.tm,
            )
          : multiplyMatrices(
              translationMatrix(
                0,
                (vertical.displacementPer1000 /
                  GLYPH_SPACE_PER_TEXT_SPACE_UNIT) *
                  gs.fontSizePt +
                  spacing,
              ),
              text.tm,
            );
      offset += byteLength;
    }
  };

  // The first glyph of `codes` as a translation in GLYPH space, the space a matrix pre-composed onto a text rendering matrix acts in: the font matrix inside that Trm is what turns these fractions of an em into points, supplying the font size and the horizontal scaling exactly as it does for a glyph's own outline coordinates.
  const positionVectorOf = (
    codes: Uint8Array<ArrayBuffer>,
  ): { x: number; y: number } | undefined => {
    const fontResourceName = gs.fontResourceName;
    if (fontResourceName === undefined) {
      return undefined;
    }
    const vertical = context.fontMetrics.glyphAdvance(
      fontResourceName,
      resources,
      codes,
      0,
    )?.vertical;
    if (vertical === undefined) {
      return undefined;
    }
    return {
      x: vertical.positionXPer1000 / GLYPH_SPACE_PER_TEXT_SPACE_UNIT,
      y: vertical.positionYPer1000 / GLYPH_SPACE_PER_TEXT_SPACE_UNIT,
    };
  };

  const showTextArray = (elements: readonly PdfObject[]): void => {
    const fontResourceName = gs.fontResourceName;
    if (fontResourceName === undefined) {
      return;
    }
    const vertical = context.fontMetrics.isVertical(
      fontResourceName,
      resources,
    );
    const startMatrix = computeTrm(gs, text);
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let totalLength = 0;
    let firstGlyphPosition: { x: number; y: number } | undefined;
    for (const el of elements) {
      if (el.kind === "string") {
        firstGlyphPosition ??= vertical
          ? positionVectorOf(el.bytes)
          : undefined;
        chunks.push(el.bytes);
        totalLength += el.bytes.length;
        advanceThroughString(el.bytes);
      } else if (el.kind === "number") {
        // ISO 32000-1 9.4.3: the adjustment is subtracted from whichever coordinate the writing mode advances along, and Tz scales the horizontal one only.
        const adjustment =
          -(el.value / GLYPH_SPACE_PER_TEXT_SPACE_UNIT) * gs.fontSizePt;
        text.tm = multiplyMatrices(
          vertical
            ? translationMatrix(0, adjustment)
            : translationMatrix(adjustment * gs.horizScale, 0),
          text.tm,
        );
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
    const endMatrix = computeTrm(gs, text);
    // A vertically set run paints its glyphs offset from the text position by the position vector, so the run is reported where its ink actually is rather than where its column's spine runs. Both matrices take the FIRST glyph's vector, which keeps their difference (and so the run's reported advance) exactly the total displacement: the vector's y is one figure for the whole font in every real file, and its x only shifts the run sideways, across the axis the advance is measured along.
    const shift =
      firstGlyphPosition === undefined
        ? undefined
        : translationMatrix(-firstGlyphPosition.x, -firstGlyphPosition.y);
    pushItem({
      kind: "text",
      codes: combined,
      fontResourceName,
      resources,
      startMatrix:
        shift === undefined
          ? startMatrix
          : multiplyMatrices(shift, startMatrix),
      endMatrix:
        shift === undefined ? endMatrix : multiplyMatrices(shift, endMatrix),
      sizePt: gs.fontSizePt,
      color: gs.fillColor,
      ...(vertical ? { vertical: true } : {}),
    });
  };

  const showText = (textBytes: Uint8Array<ArrayBuffer>): void => {
    showTextArray([{ kind: "string", bytes: textBytes, hex: false }]);
  };

  const nextLine = (): void => {
    text.tlm = multiplyMatrices(translationMatrix(0, -gs.leading), text.tlm);
    text.tm = text.tlm;
  };

  const handleDo = (name: string | undefined): void => {
    if (name === undefined) {
      return;
    }
    const xobjects = context.resolver.resolveDict(
      dictGet(resources, "XObject"),
    );
    const xobj =
      xobjects !== undefined
        ? context.resolver.resolve(dictGet(xobjects, name))
        : undefined;
    if (xobj?.kind !== "stream") {
      context.sink({
        code: "pdf/xobject-not-resolved",
        severity: "warning",
        message: `XObject resource /${name} did not resolve to a stream`,
      });
      return;
    }
    const subtype = asName(dictGet(xobj.dict, "Subtype"));
    // An XObject dict's own /OC governs its whole extent, overriding the enclosing span's membership for the items it emits; with no /OC of its own, a form drawn inside a span belongs to that span.
    const ownLayer = context.layerNameOf?.(dictGet(xobj.dict, "OC"));
    if (subtype === "Image") {
      pushItem({
        kind: "image",
        resourceName: name,
        resources,
        matrix: gs.ctm,
        ...(ownLayer !== undefined ? { layerName: ownLayer } : {}),
      });
      return;
    }
    if (subtype === "Form") {
      if (depth >= MAX_FORM_XOBJECT_DEPTH) {
        context.sink({
          code: "pdf/form-recursion-limit",
          severity: "warning",
          message:
            "form XObject recursion exceeded the depth limit; skipping further nesting",
        });
        return;
      }
      const formMatrixArr = asArray(dictGet(xobj.dict, "Matrix"));
      const formMatrix =
        formMatrixArr !== undefined
          ? matrixFromOperands(formMatrixArr)
          : IDENTITY_MATRIX;
      const formResources =
        context.resolver.resolveDict(dictGet(xobj.dict, "Resources")) ??
        resources;
      const decoded = decodeStream(xobj.raw, xobj.dict, context.sink);
      // ISO 32000-1 8.10.2: the form executes in the graphics state in effect at this Do, as if nested inline inside an implicit q/Q — so the whole state travels inward, the text parameters (a font a preceding Tf already selected, spacing, scaling) among them, and a form whose own content omits a redundant Tf still draws in the caller's font. The recursed call binds its own `gs` local, so nothing the form changes travels back out; the text matrix is not carried because it is text object state the form's own BT resets regardless.
      const formState: GraphicsState = {
        ...gs,
        ctm: multiplyMatrices(formMatrix, gs.ctm),
      };
      const formLayer = ownLayer ?? inScope("layerName");
      // The enclosing span's marked-content identity carries into an invoked form the same way its layer membership does: a form painted inside a span paints that span's content, so the page MCID in scope seeds the form's own span stack. One boundary stops it — a form whose dict declares /StructParents numbers its own MCIDs in its own parent-tree key (14.7.4.4), so the page's MCID is not the form's and must not be stamped onto what it paints.
      const formMcid =
        dictGet(xobj.dict, "StructParents") !== undefined
          ? undefined
          : inScope("mcid");
      for (const formItem of runContentStream(
        decoded.bytes,
        formResources,
        formState,
        context,
        depth + 1,
        new MarkedContentStack([
          {
            ...(formLayer !== undefined ? { layerName: formLayer } : {}),
            ...(formMcid !== undefined ? { mcid: formMcid } : {}),
          },
        ]),
      )) {
        items.push(formItem);
      }
    }
  };

  for (const token of operations) {
    if (token.kind === "inlineImage") {
      pushItem({
        kind: "inlineImage",
        dict: token.image.dict,
        data: token.image.data,
        matrix: gs.ctm,
      });
      continue;
    }
    const { operands, operator } = token.operation;
    switch (operator) {
      case "q":
        // One push covers every saved parameter, the text state included, because GraphicsState holds them all — see its own comment for why that is the spec's own division rather than a convenience. An unbalanced Q with nothing to pop leaves the state as it stands, the most content a malformed stream can still be read with.
        gsStack.push(gs);
        break;
      case "Q":
        gs = gsStack.pop() ?? gs;
        break;
      case "cm":
        gs = {
          ...gs,
          ctm: multiplyMatrices(matrixFromOperands(operands), gs.ctm),
        };
        break;
      case "g":
        gs = { ...gs, fillColor: grayColor(numAt(operands, 0)) };
        break;
      case "G":
        gs = { ...gs, strokeColor: grayColor(numAt(operands, 0)) };
        break;
      case "rg":
        gs = { ...gs, fillColor: rgbColor(operands) };
        break;
      case "RG":
        gs = { ...gs, strokeColor: rgbColor(operands) };
        break;
      case "k":
        gs = { ...gs, fillColor: cmykColor(operands) };
        break;
      case "K":
        gs = { ...gs, strokeColor: cmykColor(operands) };
        break;
      case "sc":
      case "scn": {
        const color = genericColor(operands);
        if (color !== undefined) {
          gs = { ...gs, fillColor: color };
        }
        break;
      }
      case "SC":
      case "SCN": {
        const color = genericColor(operands);
        if (color !== undefined) {
          gs = { ...gs, strokeColor: color };
        }
        break;
      }
      case "re":
        appendRectSubpath(operands, gs.ctm);
        break;
      case "m": {
        finalizeCurrentSubpath();
        const p = applyMatrix(gs.ctm, {
          x: numAt(operands, 0),
          y: numAt(operands, 1),
        });
        currentSubpath = {
          startXPt: p.x,
          startYPt: p.y,
          segments: [],
          closed: false,
        };
        break;
      }
      case "l": {
        const p = applyMatrix(gs.ctm, {
          x: numAt(operands, 0),
          y: numAt(operands, 1),
        });
        currentSubpath?.segments.push({ kind: "line", xPt: p.x, yPt: p.y });
        break;
      }
      case "c": {
        const c1 = applyMatrix(gs.ctm, {
          x: numAt(operands, 0),
          y: numAt(operands, 1),
        });
        const c2 = applyMatrix(gs.ctm, {
          x: numAt(operands, 2),
          y: numAt(operands, OPERAND_INDEX_3),
        });
        const p = applyMatrix(gs.ctm, {
          x: numAt(operands, OPERAND_INDEX_4),
          y: numAt(operands, OPERAND_INDEX_5),
        });
        currentSubpath?.segments.push({
          kind: "cubic",
          c1xPt: c1.x,
          c1yPt: c1.y,
          c2xPt: c2.x,
          c2yPt: c2.y,
          xPt: p.x,
          yPt: p.y,
        });
        break;
      }
      case "v": {
        // Shorthand cubic: the first control point is the current point, only the second control point and the endpoint are given as operands.
        if (currentSubpath !== undefined) {
          const cur = lastPointOf(currentSubpath);
          const c2 = applyMatrix(gs.ctm, {
            x: numAt(operands, 0),
            y: numAt(operands, 1),
          });
          const p = applyMatrix(gs.ctm, {
            x: numAt(operands, 2),
            y: numAt(operands, OPERAND_INDEX_3),
          });
          currentSubpath.segments.push({
            kind: "cubic",
            c1xPt: cur.x,
            c1yPt: cur.y,
            c2xPt: c2.x,
            c2yPt: c2.y,
            xPt: p.x,
            yPt: p.y,
          });
        }
        break;
      }
      case "y": {
        // Shorthand cubic: the second control point equals the endpoint, only the first control point and the endpoint are given as operands.
        const c1 = applyMatrix(gs.ctm, {
          x: numAt(operands, 0),
          y: numAt(operands, 1),
        });
        const p = applyMatrix(gs.ctm, {
          x: numAt(operands, 2),
          y: numAt(operands, OPERAND_INDEX_3),
        });
        currentSubpath?.segments.push({
          kind: "cubic",
          c1xPt: c1.x,
          c1yPt: c1.y,
          c2xPt: p.x,
          c2yPt: p.y,
          xPt: p.x,
          yPt: p.y,
        });
        break;
      }
      case "h":
        if (currentSubpath !== undefined) {
          currentSubpath.closed = true;
        }
        break;
      case "w":
        gs = { ...gs, lineWidth: numAt(operands, 0) };
        break;
      case "d":
        gs = {
          ...gs,
          dashArray: (asArray(operands[0]) ?? []).map(
            (entry) => asNumber(entry) ?? 0,
          ),
        };
        break;
      case "f":
      case "F":
      case "f*":
      case "S":
      case "s":
      case "B":
      case "B*":
      case "b":
      case "b*":
      case "n":
        emitPaint(operator);
        break;
      case "BT":
        // ISO 32000-1 9.4.1: BT resets the text matrix and text line matrix to identity, and nothing else. Every other text-state parameter (font, size, char/word spacing, horizontal scaling, leading, rise) is a graphics state parameter that persists across text objects, so resetting the text object state here is now exactly the whole reset the spec asks for.
        text = defaultTextObjectState();
        break;
      case "Tf":
        gs = {
          ...gs,
          fontResourceName: asName(operands[0]),
          fontSizePt: numAt(operands, 1),
        };
        break;
      case "Tc":
        gs = { ...gs, charSpace: numAt(operands, 0) };
        break;
      case "Tw":
        gs = { ...gs, wordSpace: numAt(operands, 0) };
        break;
      case "Tz":
        gs = { ...gs, horizScale: numAt(operands, 0) / TZ_PERCENT_DIVISOR };
        break;
      case "TL":
        gs = { ...gs, leading: numAt(operands, 0) };
        break;
      case "Ts":
        gs = { ...gs, rise: numAt(operands, 0) };
        break;
      case "Td":
        text.tlm = multiplyMatrices(
          translationMatrix(numAt(operands, 0), numAt(operands, 1)),
          text.tlm,
        );
        text.tm = text.tlm;
        break;
      case "TD":
        gs = { ...gs, leading: -numAt(operands, 1) };
        text.tlm = multiplyMatrices(
          translationMatrix(numAt(operands, 0), numAt(operands, 1)),
          text.tlm,
        );
        text.tm = text.tlm;
        break;
      case "Tm":
        text.tlm = matrixFromOperands(operands);
        text.tm = text.tlm;
        break;
      case "T*":
        nextLine();
        break;
      case "Tj": {
        const str = operands[0];
        if (str?.kind === "string") {
          showText(str.bytes);
        }
        break;
      }
      case "'": {
        nextLine();
        const str = operands[0];
        if (str?.kind === "string") {
          showText(str.bytes);
        }
        break;
      }
      case '"': {
        gs = {
          ...gs,
          wordSpace: numAt(operands, 0),
          charSpace: numAt(operands, 1),
        };
        nextLine();
        const str = operands[2];
        if (str?.kind === "string") {
          showText(str.bytes);
        }
        break;
      }
      case "TJ": {
        const array = asArray(operands[0]);
        if (array !== undefined) {
          showTextArray(array);
        }
        break;
      }
      case "Do":
        handleDo(asName(operands[0]));
        break;
      case "BDC": {
        const props = markedContentProperties(
          operands[1],
          resources,
          context.resolver,
        );
        const layerName = context.layerNameOf?.(
          props === undefined ? undefined : dictGet(props, "OC"),
        );
        const scopeProps = {
          ...(layerName !== undefined ? { layerName } : {}),
          ...markedContentScopeProps(props),
        };
        // An MCID is a PAGE-scoped handle: the parent tree maps (page, MCID), so an MCID opened INSIDE a recursed form XObject's own stream (depth > 0) must not be looked up as though it were the enclosing page's — the file addresses such content through the form's own /StructParents key in the parent tree. Voiding it as an explicit `mcid: undefined` also closes the fall-through to the page MCID the form inherited at its invocation (seeded in handleDo), so content the form marks as its own resolves to no owner rather than to the invoking span's element.
        markedContent.open(
          depth === 0 ? scopeProps : { ...scopeProps, mcid: undefined },
        );
        break;
      }
      case "BMC":
        markedContent.open({});
        break;
      case "EMC":
        markedContent.close();
        break;
      default:
        break; // every other operator (marked content, shading, clipping, ExtGState, dash pattern, line cap/join) is outside v1's extraction scope
    }
  }
  return items;
}
