// The text-outline family, split from raster.ts: opening an embedded font program, resolving the outline face for a run, building the scalable face, and drawing glyph outlines and text runs through it.

// Everything the glyph walk needs from one font resource: the parsed 'glyf', the design-grid size its coordinates live in, and the shown-code -> glyph-ID mapping the PDF's own font dictionary states (Identity-H's CID arithmetic, or a simple font's program cmap).
export interface TextOutlineFace {
  readonly glyf: GlyfTable;
  readonly unitsPerEm: number;
  glyphIdOf: (
    codes: Uint8Array<ArrayBuffer>,
    byteOffset: number,
  ) => number | undefined;
}
import type { Color as LayoutColor } from "document-schema.js";
import { buildCmapLookup } from "./cmap-table";
import { decodeGlyphOutline } from "./glyf-contours";
import type { GlyphOutline } from "./glyf-contours";
import type { PdfDiagnosticSink } from "./diagnostics";
import { NOOP_DIAGNOSTIC_SINK } from "./diagnostics";
import { parseHead, parseMaxp } from "./font-tables";
import type { FontResolverService } from "./font-read";
import { parseGlyf } from "./glyf";
import type { GlyfTable } from "./glyf";
import type { ExtractedTextRun } from "./interpret-types";
import type { PdfObjectResolver } from "./interpret-types";
import type { PdfDict } from "./objects";
import { asArray, asName, dictGet } from "./objects";
import { parseSfnt } from "./sfnt";
import type { Matrix } from "./matrix";
import {
  applyMatrix,
  multiplyMatrices,
  scaleMatrix,
  translationMatrix,
} from "./matrix";
import { decodeStream } from "./filters";
import {
  EXTENT_ZERO_EPSILON,
  type EmbeddedProgram,
  type PageRasteriser,
  type RasterPathSegment,
  type RasterSubpath,
} from "./raster";
// A bare CFF program's own header size field (ISO 32000-1's /Type1C spelling: major 1, minor 0, hdrSize 4).
const CFF_HEADER_SIZE = 0x04;

// Pulls the /FontDescriptor's embedded program from whichever key it lives under (FontFile2, or FontFile3 — an /OpenType-wrapped sfnt is a legal container for either outline flavour, and the bytes themselves, not the key, say which flavour: the same sniffing rule font-read.ts's readFontProgram applies) and classifies it. A bare CFF program (0x01 0x00 0x04 header) or an 'OTTO' sfnt carrying a 'CFF ' table is CFF; anything parseable as an sfnt with a readable glyf/head/maxp trio is fillable; anything else (no descriptor, no stream, an unparseable or table-less program) is absent.
function openEmbeddedProgram(
  descriptorOwner: PdfDict,
  resolver: Readonly<PdfObjectResolver>,
): EmbeddedProgram {
  const descriptor = resolver.resolveDict(
    dictGet(descriptorOwner, "FontDescriptor"),
  );
  if (descriptor === undefined) {
    return { kind: "absent" };
  }
  for (const key of ["FontFile2", "FontFile3"]) {
    const stream = resolver.resolve(dictGet(descriptor, key));
    if (stream?.kind !== "stream") {
      continue;
    }
    const bytes = decodeStream(
      stream.raw,
      stream.dict,
      NOOP_DIAGNOSTIC_SINK,
    ).bytes;
    // No separate bytes.length >= 3 guard: with noUncheckedIndexedAccess, an out-of-bounds index already reads as undefined, which can never strictly equal any of these three literals — a short stream already fails the chain on its own without a length check duplicating that fact.
    if (
      bytes[0] === 0x01 &&
      bytes[1] === 0x00 &&
      bytes[2] === CFF_HEADER_SIZE
    ) {
      return { kind: "cff" }; // a bare CFF program: header major 1, minor 0, hdrSize 4 (ISO 32000-1's /Type1C spelling)
    }
    const sfnt = parseSfnt(bytes);
    if (sfnt === undefined) {
      continue;
    }
    if (sfnt.tables.has("CFF ")) {
      return { kind: "cff" };
    }
    const head = parseHead(sfnt);
    const maxp = parseMaxp(sfnt);
    if (head === undefined || maxp === undefined) {
      continue;
    }
    const glyf = parseGlyf(sfnt, {
      numGlyphs: maxp.numGlyphs,
      indexToLocFormat: head.indexToLocFormat,
    });
    if (glyf === undefined) {
      continue;
    }
    return {
      kind: "glyf",
      sfnt,
      face: { glyf, unitsPerEm: head.unitsPerEm },
    };
  }
  return { kind: "absent" };
}

// Resolves one font resource's outline face, cached by the font dictionary's own object identity (font-read.ts's own caching convention: the resolver hands back the same dict object for repeated lookups, so a font referenced by many runs parses exactly once). Undefined means this run's text cannot be drawn as outlines — a diagnostic naming why has already gone to the sink, once per font rather than once per run.
function resolveTextOutlineFace(
  fontResourceName: string,
  resources: PdfDict,
  resolver: Readonly<PdfObjectResolver>,
  fontResolver: FontResolverService,
  outlineFaces: Map<PdfDict, TextOutlineFace | undefined>,
  sink: PdfDiagnosticSink,
): TextOutlineFace | undefined {
  const fontsDict = resolver.resolveDict(dictGet(resources, "Font"));
  const fontDict =
    fontsDict !== undefined
      ? resolver.resolveDict(dictGet(fontsDict, fontResourceName))
      : undefined;
  if (fontDict === undefined) {
    return undefined; // an unresolvable font resource is already diagnosed inside interpretation
  }
  if (outlineFaces.has(fontDict)) {
    return outlineFaces.get(fontDict);
  }
  const face = buildTextOutlineFace(
    fontDict,
    resolver,
    fontResolver,
    fontResourceName,
    resources,
    sink,
  );
  outlineFaces.set(fontDict, face);
  return face;
}

// Bit width of one byte, the shift needed to combine a big-endian two-byte value's high byte with its low byte.
const BITS_PER_BYTE = 8;

function buildTextOutlineFace(
  fontDict: PdfDict,
  resolver: Readonly<PdfObjectResolver>,
  fontResolver: FontResolverService,
  fontResourceName: string,
  resources: PdfDict,
  sink: PdfDiagnosticSink,
): TextOutlineFace | undefined {
  const baseFontName = asName(dictGet(fontDict, "BaseFont"));
  const faceName =
    baseFontName ?? asName(dictGet(fontDict, "Subtype")) ?? "font";
  const unavailable = (reason: string): TextOutlineFace | undefined => {
    sink({
      code: "raster/text-outlines-unavailable",
      severity: "warning",
      message: `font resource /${fontResourceName} (${faceName}) has no drawable outline (${reason}); its text is not rendered`,
    });
    return undefined;
  };
  const cff = (): TextOutlineFace | undefined => {
    sink({
      code: "raster/text-cff-outlines",
      severity: "warning",
      message: `font resource /${fontResourceName} (${faceName}) carries CFF outlines; this raster surface fills sfnt (TrueType/glyf) outlines only, so its text is not rendered rather than approximated`,
    });
    return undefined;
  };
  const subtype = asName(dictGet(fontDict, "Subtype"));

  if (subtype === "Type0") {
    // The dominant embedded-font shape mainstream producers emit (and this package's own writer's): /Type0 + /Identity-H + /CIDFontType2 + /FontFile2, where CID == the 2-byte code and /CIDToGIDMap (usually /Identity) maps CID -> GID. Identity-V is the same identity mapping set vertically, so it decodes identically here and differs only in the axis drawTextRun advances the glyphs along.
    const encoding = resolver.resolve(dictGet(fontDict, "Encoding"));
    if (
      encoding?.kind !== "name" ||
      (encoding.name !== "Identity-H" && encoding.name !== "Identity-V")
    ) {
      return unavailable(
        "a Type0 font whose /Encoding is neither Identity-H nor Identity-V (a predefined or embedded CMap this raster walk does not decode)",
      );
    }
    const descendants = asArray(dictGet(fontDict, "DescendantFonts"));
    const descendant =
      descendants !== undefined
        ? resolver.resolveDict(descendants[0])
        : undefined;
    if (descendant === undefined) {
      return unavailable(
        "a Type0 font with no readable /DescendantFonts entry",
      );
    }
    const descendantSubtype = asName(dictGet(descendant, "Subtype"));
    if (descendantSubtype === "CIDFontType0") {
      return cff();
    }
    if (descendantSubtype !== "CIDFontType2") {
      return unavailable(
        `a descendant font of subtype ${descendantSubtype ?? "(none)"}`,
      );
    }
    const cidToGidMap = resolver.resolve(dictGet(descendant, "CIDToGIDMap"));
    const program = openEmbeddedProgram(descendant, resolver);
    if (program.kind === "cff") {
      return cff();
    }
    if (program.kind === "absent") {
      return unavailable(
        "no readable /FontFile2 (or glyf-bearing /FontFile3) stream",
      );
    }
    if (
      cidToGidMap !== undefined &&
      cidToGidMap.kind !== "name" &&
      cidToGidMap.kind !== "stream"
    ) {
      return unavailable(
        "a /CIDToGIDMap that is neither /Identity nor a readable stream",
      );
    }
    if (cidToGidMap?.kind === "stream") {
      // An explicit mapping stream: 2-byte big-endian GID per CID (ISO 32000-1 9.7.4.2). CIDs past the stream's end have no entry, and a missing GID is skipped — never drawn as glyph 0, which would paint .notdef ink the file never stated.
      const decodedBytes = decodeStream(
        cidToGidMap.raw,
        cidToGidMap.dict,
        NOOP_DIAGNOSTIC_SINK,
      ).bytes;
      const entries: number[] = [];
      for (let i = 0; i + 1 < decodedBytes.length; i += 2) {
        entries.push(
          (decodedBytes[i]! << BITS_PER_BYTE) | decodedBytes[i + 1]!,
        );
      }
      return {
        glyf: program.face.glyf,
        unitsPerEm: program.face.unitsPerEm,
        glyphIdOf: (codes, offset) => {
          // No separate cid < entries.length guard: cid is always a non-negative index (built from two unsigned byte shifts), and a plain array already reads out of bounds as undefined — entries[cid] alone is exactly the ": undefined" branch for every cid past the map's own last entry.
          const cid = (codes[offset]! << BITS_PER_BYTE) | codes[offset + 1]!;
          return entries[cid];
        },
      };
    }
    // /Identity (or unstated, which defaults to Identity per 9.7.4.2): GID == CID.
    return {
      glyf: program.face.glyf,
      unitsPerEm: program.face.unitsPerEm,
      glyphIdOf: (codes, offset) =>
        (codes[offset]! << BITS_PER_BYTE) | codes[offset + 1]!,
    };
  }

  if (subtype === "TrueType") {
    // A simple font's own program: code -> Unicode through the PDF's own full encoding precedence (the same decodeToUnicode font-read.ts implements), then Unicode -> GID through the program's own Unicode cmap subtable. Exact for the ordinary embedded TrueType programs simple fonts carry; a (3,0)-only subset whose cmap is keyed by its own codes rather than code points fails the lookup glyph-by-glyph and paints nothing, never a guessed glyph.
    const program = openEmbeddedProgram(fontDict, resolver);
    if (program.kind === "cff") {
      return cff();
    }
    if (program.kind === "absent") {
      return unavailable(
        "no /FontDescriptor or no readable embedded program (a standard-14 or otherwise unembedded face states no outlines at all)",
      );
    }
    const cmapLookup = buildCmapLookup(program.sfnt);
    if (cmapLookup === undefined) {
      return unavailable(
        "an embedded program with no usable Unicode cmap subtable",
      );
    }
    return {
      glyf: program.face.glyf,
      unitsPerEm: program.face.unitsPerEm,
      glyphIdOf: (codes, offset) => {
        const text = fontResolver
          .resolve(fontResourceName, resources)
          ?.decodeToUnicode(codes.subarray(offset, offset + 1));
        const codePoint = text?.codePointAt(0);
        return codePoint === undefined ? undefined : cmapLookup(codePoint);
      },
    };
  }

  if (subtype === "Type1" || subtype === "MMType1") {
    // A Type 1 program's outlines are PostScript charstrings, never sfnt glyf data (its /FontFile3 spelling, /Type1C, is CFF): openEmbeddedProgram classifies whichever program is embedded, so the diagnostic names the real reason rather than assuming.
    const program = openEmbeddedProgram(fontDict, resolver);
    if (program.kind === "cff") {
      return cff();
    }
    return unavailable(
      "a Type 1 PostScript program, whose outlines are charstrings rather than sfnt glyf data",
    );
  }

  return unavailable(
    `a font of subtype ${subtype ?? "(none)"} (a Type3 glyph-procedure font has no static outline at all)`,
  );
}

// The glyphAdvance port's own convention (matching the "Per1000" field names): widths, displacements and vertical positions are expressed per 1000 units of text space.
const METRICS_PER_1000_SCALE = 1000;

// The per-run glyph walk: re-walks the run's codes through the same glyphAdvance port the interpreter advanced the text matrix with, placing each glyph at its accumulated advance through the run's own start matrix, then draws each glyph's decoded outline as one filled path.
export function drawTextRun(
  item: ExtractedTextRun,
  fontResolver: FontResolverService,
  resolver: Readonly<PdfObjectResolver>,
  outlineFaces: Map<PdfDict, TextOutlineFace | undefined>,
  interpretToDeviceMatrix: Matrix,
  rasteriser: Readonly<PageRasteriser>,
  sink: PdfDiagnosticSink,
): void {
  const face = resolveTextOutlineFace(
    item.fontResourceName,
    item.resources,
    resolver,
    fontResolver,
    outlineFaces,
    sink,
  );
  if (face === undefined) {
    return; // the diagnostic naming why has already gone to the sink
  }
  // Per-glyph advances exactly as the interpreter accumulated them (same port), without the Tc/Tw/Tz text-state adjustments that live inside the interpreter — those are absorbed by the end-matrix correction below.
  const placements: {
    readonly glyphId: number | undefined;
    readonly advance: number;
    // This glyph's own position vector in glyph space, for a vertically set run. item.startMatrix already carries the FIRST glyph's, so what each later glyph needs is only the difference between the two: zero whenever the font gives every glyph one vector, and a real sideways shift on a column mixing full-width and half-width glyphs, whose default vectors are half their differing widths.
    readonly positionX: number;
    readonly positionY: number;
  }[] = [];
  let offset = 0;
  let cumulative = 0;
  while (offset < item.codes.length) {
    // Never undefined: resolveTextOutlineFace above already resolved item.fontResourceName against item.resources to a real font dict (returning early otherwise), and fontResolver.metrics.glyphAdvance's own resolution does the identical dictGet(resources, "Font") -> dictGet(fontsDict, fontResourceName) lookup against the same two values, then always returns a populated result once that dict exists — there is no way for this call to find no font once the one above already did.
    const advance = fontResolver.metrics.glyphAdvance(
      item.fontResourceName,
      item.resources,
      item.codes,
      offset,
    )!;
    const byteLength = advance.byteLengthConsumed;
    placements.push({
      glyphId: face.glyphIdOf(item.codes, offset),
      advance: cumulative,
      positionX:
        (advance.vertical?.positionXPer1000 ?? 0) / METRICS_PER_1000_SCALE,
      positionY:
        (advance.vertical?.positionYPer1000 ?? 0) / METRICS_PER_1000_SCALE,
    });
    // The same user-space displacement the interpreter accumulates (interpret.ts's own two displacement formulas without the Tc/Tw/Tz terms this walk cannot see, which the end-matrix correction below absorbs). Pre-composing a translation onto startMatrix is associatively identical to pre-composing onto the text matrix it was built from, so glyph k's matrix here is glyph k's Trm there. A vertically set run advances by the glyph's own w1y instead of its width, and downward, so the accumulated figure is negative and is measured along y below rather than x.
    cumulative +=
      ((advance.vertical?.displacementPer1000 ?? advance.widthPer1000) /
        METRICS_PER_1000_SCALE) *
      item.sizePt;
    offset += byteLength;
  }

  // End-matrix correction: the interpreter's own walk included char/word spacing, horizontal scaling, and TJ adjustments this walk cannot see per glyph, so raw cumulative advances can drift from where the page actually placed the run's end. The run's start and end matrices ARE exact (interpret.ts stamps both), so the drift is corrected by scaling every glyph's advance by one uniform factor — the ratio of the run's actual device-space extent to the raw accumulated extent. A run's total placement is therefore always exact; only the (bounded) distribution between its glyphs is approximate when spacing state was in play.
  const startDeviceMatrix = multiplyMatrices(
    item.startMatrix,
    interpretToDeviceMatrix,
  );
  const endDeviceMatrix = multiplyMatrices(
    item.endMatrix,
    interpretToDeviceMatrix,
  );
  const vertical = item.vertical === true;
  const startPoint = applyMatrix(startDeviceMatrix, { x: 0, y: 0 });
  const endPoint = applyMatrix(endDeviceMatrix, { x: 0, y: 0 });
  const rawEndPoint = applyMatrix(
    startDeviceMatrix,
    vertical ? { x: 0, y: cumulative } : { x: cumulative, y: 0 },
  );
  const rawExtent = Math.hypot(
    rawEndPoint.x - startPoint.x,
    rawEndPoint.y - startPoint.y,
  );
  const actualExtent = Math.hypot(
    endPoint.x - startPoint.x,
    endPoint.y - startPoint.y,
  );
  // No separate zero-advance guard beside the extent one: rawEndPoint is startMatrix applied to the accumulated advance, so an advance of zero puts it exactly on startPoint and rawExtent is zero already. Testing the advance's own sign as well would only wrongly disable the correction for a vertically set run, whose accumulated advance is negative by construction.
  const correction =
    rawExtent > EXTENT_ZERO_EPSILON ? actualExtent / rawExtent : 1;

  const firstPlacement = placements[0];
  const glyphScale = scaleMatrix(1 / face.unitsPerEm, 1 / face.unitsPerEm);
  for (const placement of placements) {
    if (placement.glyphId === undefined) {
      continue; // a code with no glyph in this face: no ink (the reader's own extraction diagnostics cover the mapping gap)
    }
    const outline = decodeGlyphOutline(face.glyf, placement.glyphId);
    if (outline === undefined) {
      continue; // an undecodable glyph: nothing to draw
    }
    // No separate outline.contours.length === 0 guard here: an empty glyph (a space) decodes to zero contours, and glyphOutlineSubpaths already turns zero contours into zero subpaths on its own (the same emptiness drawGlyphOutline's own subpaths.length === 0 check below catches), so a dedicated check for it here would only ever duplicate a skip that already happens one call downstream.
    //
    // Two translations rather than one because their units genuinely differ: the accumulated advance is in the interpreter's own nominal figure that `correction` rescales, while a position vector is already a fraction of an em, which the font matrix inside startMatrix scales on its own. Translations commute, so composing them separately costs nothing and keeps each one's units its own.
    const trm = multiplyMatrices(
      translationMatrix(
        (firstPlacement?.positionX ?? 0) - placement.positionX,
        (firstPlacement?.positionY ?? 0) - placement.positionY,
      ),
      multiplyMatrices(
        vertical
          ? translationMatrix(0, placement.advance * correction)
          : translationMatrix(placement.advance * correction, 0),
        item.startMatrix,
      ),
    );
    const glyphMatrix = multiplyMatrices(
      glyphScale,
      multiplyMatrices(trm, interpretToDeviceMatrix),
    );
    drawGlyphOutline(outline, glyphMatrix, item.color, rasteriser);
  }
}

// One glyph's outline drawn as a single filled path, factored out of the per-glyph loop above solely so raster.test.ts can drive it directly with a hand-built outline: every one of a real vendored face's own glyphs with at least one contour flattens to at least one subpath (glyphOutlineSubpaths' own suite already establishes that a contour under three points contributes none), so the "a non-empty outline still produced no subpaths" branch below has no route to coverage through any real embedded font.
export function drawGlyphOutline(
  outline: GlyphOutline,
  glyphMatrix: Matrix,
  color: Readonly<LayoutColor>,
  rasteriser: Readonly<PageRasteriser>,
): void {
  const subpaths = glyphOutlineSubpaths(outline, glyphMatrix);
  if (subpaths.length === 0) {
    return;
  }
  rasteriser.draw({
    kind: "path",
    subpaths,
    fill: { color, fillRule: "nonzero" },
  });
}

// TrueType contours to port subpaths: each contour's on/off-curve points walked into line and quadratic segments, each quadratic elevated to the exactly equivalent cubic (control points at 2/3 of the way from the on-curve ends toward the off-curve control — the standard exact quadratic-to-cubic elevation, no approximation), then every point transformed as a point. A run of consecutive off-curve points implies an on-curve point at each neighbouring pair's midpoint, per the TrueType glyph specification's own contour convention. Exported solely so this suite can drive it directly with hand-built contours: a real embedded font's own glyphs (this module's only other route in) never reliably exercise every branch on demand — no vendored face happens to start a contour off-curve, or carries a contour with no on-curve point at all, the way a hand-built GlyphOutline can.
// The fewest points a contour can bound any area with; fewer is a stray point or pair that paints nothing.
const MIN_CONTOUR_POINTS = 3;

// The exact quadratic-to-cubic elevation: each cubic control point sits this fraction of the way from its on-curve end toward the quadratic's own off-curve control point.
const QUADRATIC_TO_CUBIC_FRACTION_NUMERATOR = 2;
const QUADRATIC_TO_CUBIC_FRACTION_DENOMINATOR = 3;
const QUADRATIC_TO_CUBIC_CONTROL_FRACTION =
  QUADRATIC_TO_CUBIC_FRACTION_NUMERATOR /
  QUADRATIC_TO_CUBIC_FRACTION_DENOMINATOR;

export function glyphOutlineSubpaths(
  outline: GlyphOutline,
  matrix: Matrix,
): readonly RasterSubpath[] {
  const subpaths: RasterSubpath[] = [];
  for (const contour of outline.contours) {
    if (contour.length < MIN_CONTOUR_POINTS) {
      continue; // a degenerate contour (a stray point or pair) bounds no area and paints nothing
    }
    // Rotate so the walk starts on a real on-curve point where one exists; a contour with none at all (a pure-quad circle, say) starts at the implied midpoint of its last and first points. Both branches below share one hoisted condition rather than repeating `firstOn >= 0`: at firstOn === 0 the two `ordered` branches already coincide (rotating by zero is a no-op), so a lone, un-shared copy of the condition guarding `ordered` alone has no boundary input left where mutating it changes anything observable — sharing it with `current`'s own branch (which genuinely does differ at that boundary) is what keeps the condition itself meaningful to test.
    const firstOn = contour.findIndex((point) => point.onCurve);
    const contourPoints = contour.map((point) => ({
      x: point.x,
      y: point.y,
      onCurve: point.onCurve,
    }));
    const hasLeadingOnCurvePoint = firstOn >= 0;
    const ordered: readonly { x: number; y: number; onCurve: boolean }[] =
      hasLeadingOnCurvePoint
        ? [...contourPoints.slice(firstOn), ...contourPoints.slice(0, firstOn)]
        : contourPoints;
    let current: { x: number; y: number } = hasLeadingOnCurvePoint
      ? { x: contourPoints[firstOn]!.x, y: contourPoints[firstOn]!.y }
      : {
          x:
            (contourPoints[contourPoints.length - 1]!.x + contourPoints[0]!.x) /
            2,
          y:
            (contourPoints[contourPoints.length - 1]!.y + contourPoints[0]!.y) /
            2,
        };
    const start = current;
    const segments: RasterPathSegment[] = [];
    let pendingOffCurve: { x: number; y: number } | undefined;
    const emitQuad = (
      from: Readonly<{ x: number; y: number }>,
      control: Readonly<{ x: number; y: number }>,
      to: Readonly<{ x: number; y: number }>,
    ): void => {
      const p0 = applyMatrix(matrix, from);
      const q = applyMatrix(matrix, control);
      const p1 = applyMatrix(matrix, to);
      segments.push({
        kind: "cubic",
        c1xPx: p0.x + QUADRATIC_TO_CUBIC_CONTROL_FRACTION * (q.x - p0.x),
        c1yPx: p0.y + QUADRATIC_TO_CUBIC_CONTROL_FRACTION * (q.y - p0.y),
        c2xPx: p1.x + QUADRATIC_TO_CUBIC_CONTROL_FRACTION * (q.x - p1.x),
        c2yPx: p1.y + QUADRATIC_TO_CUBIC_CONTROL_FRACTION * (q.y - p1.y),
        xPx: p1.x,
        yPx: p1.y,
      });
    };
    const emitLine = (to: Readonly<{ x: number; y: number }>): void => {
      const p1 = applyMatrix(matrix, to);
      segments.push({ kind: "line", xPx: p1.x, yPx: p1.y });
    };
    for (const point of ordered) {
      if (point.onCurve) {
        if (pendingOffCurve === undefined) {
          emitLine(point);
        } else {
          emitQuad(current, pendingOffCurve, point);
        }
        current = point;
        pendingOffCurve = undefined;
      } else {
        if (pendingOffCurve !== undefined) {
          const implied = {
            x: (pendingOffCurve.x + point.x) / 2,
            y: (pendingOffCurve.y + point.y) / 2,
          };
          emitQuad(current, pendingOffCurve, implied);
          current = implied;
        }
        pendingOffCurve = point;
      }
    }
    if (pendingOffCurve !== undefined) {
      emitQuad(current, pendingOffCurve, start);
    }
    // No separate segments.length guard: the contour.length < 3 continue above already guarantees at least two segments here. Walking a contour of n >= 3 points emits exactly one segment per point that isn't the first half of a still-open off-curve pair (an on-curve point always emits, and only the very first off-curve point encountered after a clear state emits none) — for n >= 3 points that can defer at most one single emission this way, and the loop's own trailing flush emits one more for a pair left open at the end, so the count can never drop below n - 1, i.e. never below 2.
    const startPx = applyMatrix(matrix, start);
    subpaths.push({
      startXPx: startPx.x,
      startYPx: startPx.y,
      segments,
      closed: true,
    });
  }
  return subpaths;
}
