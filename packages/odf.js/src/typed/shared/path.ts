import type { Box, ContentPathPoint, ContentSubpath } from "document-schema.js";
import { formatOdfNumber } from "./units";

// ODF's vector-primitive geometry grammar: draw:path's own svg:d (a real SVG-path-like mini-language, verified against genuine LibreOffice 26.2 output rather than assumed identical to plain SVG -- see the notes below on where it genuinely matches and where a caller must not assume more than what was verified) and draw:polygon/draw:polyline's own draw:points (a completely SEPARATE, simpler comma/space-delimited coordinate-pair list -- NOT an svg:d string at all, confirmed empirically: a straight-line-only closed/open multi-point shape round-trips through LibreOffice's own writer as draw:polygon/draw:polyline with draw:points, never as draw:path with svg:d, regardless of which UNO shape service created it -- LibreOffice reserves draw:path/svg:d specifically for geometry containing at least one genuine Bezier curve segment).
//
// VERIFICATION METHOD (mirroring transform.ts's own precedent): real .odg fixtures were built via the LibreOffice UNO API (a StarBasic macro run headlessly via `soffice --headless --invisible "vnd.sun.star.script:..."`), NOT hand-authored guesses -- a com.sun.star.drawing.ClosedBezierShape/OpenBezierShape with an explicit mix of NORMAL (straight-line) and CONTROL (Bezier) points was constructed via its own PolyPolygonBezier property, saved as real ODF, and the resulting content.xml inspected directly. Confirmed real LibreOffice svg:d output:
// - "M0 4000h3000c1000 0 1000-4000-1000-4000z" (a closed path: absolute moveto, then a RELATIVE HORIZONTAL LINETO shorthand "h" -- not a generic "L" -- for an axis-aligned segment, then a relative cubic "c", then "z" to close)
// - "M0 4658l3000-4500c1500-1000 3000 3000 500 4500z" (the same shape but with a genuinely DIAGONAL first segment: LibreOffice emits lowercase "l", confirming L/l themselves ARE used, not just H/V shorthand, whenever a segment isn't axis-aligned)
// - the same geometry with an OPEN (not closed) source shape omits the trailing "z" entirely -- confirming Z/z's presence tracks the shape's own open/closed state directly, not merely appearing unconditionally.
// - consecutive signed numbers concatenate with NO separator at all ("1000-4000-1000-4000": four numbers, "1000", "-4000", "-1000", "-4000" -- the minus sign of the next number is itself a sufficient separator), exactly matching the general SVG path number-list grammar (whitespace/comma are optional, a sign or a new "." can itself start the next number).
// This module implements the SVG path mini-language subset actually verified as real ODF output plus the immediately adjacent, spec-guaranteed forms of the SAME commands (M/m, L/l, H/h, V/v, C/c, Z/z, both cases, with SVG's own implicit-repeat-of-the-last-command-letter convention) -- S/s, Q/q, T/t, A/a (smooth-cubic, quadratic, smooth-quadratic, elliptical-arc) are recognised as command letters (so the token stream stays in sync) but produce no segment: a documented, narrow scope boundary, not a silent gap. ContentPathSegmentSchema itself only models 'line'/'cubic' segments (no quadratic, no arc), so even a hypothetical future Q/A implementation would need to elevate/approximate into those two kinds; genuine LibreOffice output for the shapes this reader targets (rectangles, ellipses, freeform curves, basic custom-shape presets) never emits them, per the verification above.
//
// draw:polygon/draw:polyline's own draw:points grammar ("0,3000 2000,0 4000,3000 2000,1500": space-separated "x,y" pairs, comma between the pair's own two numbers) was verified in the SAME macro run -- confirmed genuinely different from svg:d, with no command letters and no implicit-repeat concept at all, just a flat coordinate-pair list.
//
// Both svg:d and draw:points express their numbers in the element's OWN svg:viewBox user-space units, NOT points directly -- confirmed: a shape sized "svg:width=3.656cm svg:height=3.999cm" carried svg:viewBox="0 0 3657 4000" with svg:d coordinates in the 0..4000-ish range, not the 0..3.656-ish physical-cm range. scaleOdfRawPoint/buildOdfSubpaths below convert a raw (viewBox-local) point into the SAME "local coordinate space sized to frame.widthPt x frame.heightPt" convention ContentVectorSchema's own 'path' variant documents (see document-schema.js's content.ts): the scale factor is frame.widthPt/viewBox.width (and the equivalent for height), with viewBox.minX/minY subtracted first -- a real, if rare, possibility per the general SVG viewBox grammar, even though every viewBox this module has verified against real output began at "0 0".

export interface OdfRawPoint {
  readonly x: number;
  readonly y: number;
}

export type OdfRawSegment =
  | { readonly kind: "line"; readonly to: OdfRawPoint }
  | {
      readonly kind: "cubic";
      readonly control1: OdfRawPoint;
      readonly control2: OdfRawPoint;
      readonly to: OdfRawPoint;
    };

export interface OdfRawSubpath {
  readonly start: OdfRawPoint;
  readonly segments: readonly OdfRawSegment[];
  readonly closed: boolean;
}

export interface OdfViewBox {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
}

// svg:viewBox="minX minY width height" -- four whitespace-separated numbers, reusing SVG's own viewBox grammar directly (ODF's svg: namespace is explicitly "xmlns:svg-compatible", not a coincidental naming). width/height of zero or negative would make scaleOdfRawPoint's own division meaningless, so those are rejected here (undefined) rather than propagating a divide-by-zero/negative-scale result further down.
const VIEW_BOX_PATTERN =
  /^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/;

export function parseOdfViewBox(value: string): OdfViewBox | undefined {
  const match = VIEW_BOX_PATTERN.exec(value.trim());
  if (match === null) {
    return undefined;
  }
  const minX = Number(match[1]);
  const minY = Number(match[2]);
  const width = Number(match[3]);
  const height = Number(match[4]);
  if (width <= 0 || height <= 0) {
    return undefined;
  }
  return { minX, minY, width, height };
}

// draw:points="x,y x,y ..." -- a flat, comma/whitespace-delimited coordinate-pair list, confirmed structurally distinct from svg:d (see this file's own top-of-file note). A pair that doesn't parse to two finite numbers is skipped individually, matching this package's general "degrade a single malformed item, don't abort the whole parse" policy.
export function parseOdfPointsList(value: string): OdfRawPoint[] {
  const points: OdfRawPoint[] = [];
  for (const pair of value.trim().split(/\s+/)) {
    if (pair.length === 0) {
      continue;
    }
    const [xRaw, yRaw] = pair.split(",");
    if (xRaw === undefined || yRaw === undefined) {
      continue;
    }
    const x = Number(xRaw);
    const y = Number(yRaw);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }
    points.push({ x, y });
  }
  return points;
}

// Builds a single raw subpath directly from an already-parsed draw:points coordinate list (draw:polygon -> closed, draw:polyline -> open), reusing the exact same OdfRawSubpath shape svg:d parsing produces below -- so buildOdfSubpaths (the shared viewBox-scaling step) serves both grammars identically. undefined for an empty points list: no first point means no resolvable geometry at all, mirroring this module's other "nothing to build from" contracts.
export function rawSubpathFromPoints(
  points: readonly OdfRawPoint[],
  closed: boolean,
): OdfRawSubpath | undefined {
  const start = points[0];
  if (start === undefined) {
    return undefined;
  }
  return {
    start,
    segments: points.slice(1).map((to) => ({ kind: "line", to })),
    closed,
  };
}

const COMMAND_LETTERS = new Set([
  "M",
  "m",
  "L",
  "l",
  "H",
  "h",
  "V",
  "v",
  "C",
  "c",
  "S",
  "s",
  "Q",
  "q",
  "T",
  "t",
  "A",
  "a",
  "Z",
  "z",
]);

function isCommandLetter(token: string): boolean {
  return COMMAND_LETTERS.has(token);
}

// A single SVG-grammar number: optional sign, then digits with an optional fractional part (or a bare ".5"-style fraction), then an optional exponent -- the same shape real ODF svg:d output actually used (see this file's own top-of-file note), matched with NO required separator from a preceding number, which is what lets "1000-4000" tokenize as two numbers ("1000", "-4000") the way real LibreOffice output does.
const PATH_TOKEN_PATTERN =
  /[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.\d+|\.\d+|\d+)(?:[eE][-+]?\d+)?/g;

function tokenizePathData(d: string): string[] {
  return d.match(PATH_TOKEN_PATTERN) ?? [];
}

// Parses an svg:d attribute value into its raw (viewBox-local, unscaled) subpaths -- see this file's own top-of-file note for the exact command set verified against real LibreOffice output and the deliberate S/Q/T/A scope boundary. Implements SVG's own implicit-repeat convention (a bare run of numbers after a command letter re-applies that same command as many times as the numbers divide evenly by its arity -- e.g. "L 10 10 20 20" is two linetos), including the specific M/m oddity the SVG spec itself defines: a SECOND (and any further) coordinate pair immediately following an M/m command is treated as an implicit LINETO, not a second moveto, without a new subpath being started -- verified this module follows the spec text here since no real ODF fixture exercised this specific corner case; the M-starts-a-subpath / H / V / C / Z behaviour immediately above IS independently real-output-verified.
export function parseOdfPathData(d: string): OdfRawSubpath[] {
  const tokens = tokenizePathData(d);
  const subpaths: OdfRawSubpath[] = [];
  let current: OdfRawPoint = { x: 0, y: 0 };
  let subpathStart: OdfRawPoint = { x: 0, y: 0 };
  let activeSubpath:
    | { start: OdfRawPoint; segments: OdfRawSegment[]; closed: boolean }
    | undefined;
  let command: string | undefined;
  let firstMInCommand = true;

  function startSubpath(point: OdfRawPoint): void {
    activeSubpath = { start: point, segments: [], closed: false };
    subpaths.push(activeSubpath);
    subpathStart = point;
    current = point;
  }

  function pushSegment(segment: OdfRawSegment, to: OdfRawPoint): void {
    if (activeSubpath !== undefined) {
      activeSubpath.segments.push(segment);
    }
    current = to;
  }

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token === undefined) {
      break;
    }
    if (isCommandLetter(token)) {
      if (token === "Z" || token === "z") {
        if (activeSubpath !== undefined) {
          activeSubpath.closed = true;
          current = subpathStart;
        }
        command = undefined;
        i += 1;
        continue;
      }
      command = token;
      firstMInCommand = true;
      i += 1;
      continue;
    }
    if (command === undefined) {
      // A bare number before any command letter has been seen -- malformed input; skip it defensively rather than aborting the whole parse.
      i += 1;
      continue;
    }
    const upper = command.toUpperCase();
    const relative = command !== upper;
    if (upper === "M" || upper === "L") {
      const xTok = tokens[i];
      const yTok = tokens[i + 1];
      i += 2;
      if (xTok === undefined || yTok === undefined) {
        break;
      }
      const x = Number(xTok);
      const y = Number(yTok);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        continue;
      }
      const point = relative
        ? { x: current.x + x, y: current.y + y }
        : { x, y };
      if (upper === "M" && firstMInCommand) {
        startSubpath(point);
        firstMInCommand = false;
      } else {
        pushSegment({ kind: "line", to: point }, point);
      }
    } else if (upper === "H") {
      const xTok = tokens[i];
      i += 1;
      if (xTok === undefined) {
        break;
      }
      const x = Number(xTok);
      if (!Number.isFinite(x)) {
        continue;
      }
      const point = relative
        ? { x: current.x + x, y: current.y }
        : { x, y: current.y };
      pushSegment({ kind: "line", to: point }, point);
    } else if (upper === "V") {
      const yTok = tokens[i];
      i += 1;
      if (yTok === undefined) {
        break;
      }
      const y = Number(yTok);
      if (!Number.isFinite(y)) {
        continue;
      }
      const point = relative
        ? { x: current.x, y: current.y + y }
        : { x: current.x, y };
      pushSegment({ kind: "line", to: point }, point);
    } else if (upper === "C") {
      const rawArgs = tokens.slice(i, i + 6);
      i += 6;
      if (rawArgs.length < 6) {
        break;
      }
      const x1 = Number(rawArgs[0]);
      const y1 = Number(rawArgs[1]);
      const x2 = Number(rawArgs[2]);
      const y2 = Number(rawArgs[3]);
      const x = Number(rawArgs[4]);
      const y = Number(rawArgs[5]);
      if (![x1, y1, x2, y2, x, y].every(Number.isFinite)) {
        continue;
      }
      const control1 = relative
        ? { x: current.x + x1, y: current.y + y1 }
        : { x: x1, y: y1 };
      const control2 = relative
        ? { x: current.x + x2, y: current.y + y2 }
        : { x: x2, y: y2 };
      const to = relative ? { x: current.x + x, y: current.y + y } : { x, y };
      pushSegment({ kind: "cubic", control1, control2, to }, to);
    } else {
      // S/s, Q/q, T/t, A/a -- recognised so the token stream stays in sync, but not converted into a segment. See this file's own top-of-file note on why (out of ContentPathSegmentSchema's own 'line'/'cubic' vocabulary, and not exercised by any real ODF output this module verified against).
      i += 1;
    }
  }

  return subpaths;
}

// Scales a raw (viewBox-local) point into the path's own local point space -- sized to frame.widthPt x frame.heightPt, per ContentVectorSchema's own 'path' variant contract (document-schema.js's content.ts: "the size of the path's own local coordinate space, distinct from the subpaths' local-space points"). Deliberately does NOT add frame.xPt/yPt: that offset is the frame's own PAGE-space placement, kept separate from the subpaths' LOCAL space, exactly as that schema comment specifies.
export function scaleOdfRawPoint(
  point: OdfRawPoint,
  viewBox: OdfViewBox,
  frame: Box,
): ContentPathPoint {
  return {
    xPt: (point.x - viewBox.minX) * (frame.widthPt / viewBox.width),
    yPt: (point.y - viewBox.minY) * (frame.heightPt / viewBox.height),
  };
}

export function buildOdfSubpaths(
  rawSubpaths: readonly OdfRawSubpath[],
  viewBox: OdfViewBox,
  frame: Box,
): ContentSubpath[] {
  return rawSubpaths.map((raw) => ({
    start: scaleOdfRawPoint(raw.start, viewBox, frame),
    closed: raw.closed,
    segments: raw.segments.map((segment) =>
      segment.kind === "line"
        ? {
            kind: "line" as const,
            to: scaleOdfRawPoint(segment.to, viewBox, frame),
          }
        : {
            kind: "cubic" as const,
            control1: scaleOdfRawPoint(segment.control1, viewBox, frame),
            control2: scaleOdfRawPoint(segment.control2, viewBox, frame),
            to: scaleOdfRawPoint(segment.to, viewBox, frame),
          },
    ),
  }));
}

// --- the write side: a ContentVector 'path' variant's own subpaths -> the svg:viewBox/svg:d pair parseOdfPathData and buildOdfSubpaths above read back -------------------------------------------------------------------------------
//
// THE ONE CHOICE THAT MAKES THE INVERSE EXACT RATHER THAN APPROXIMATE, and the reason these two functions are a pair rather than one: a writer is free to pick the viewBox its own coordinates are expressed in, and picking "0 0 <frame width> <frame height>" makes scaleOdfRawPoint's own scale factor (frame.widthPt / viewBox.width) exactly 1 and its minX/minY subtraction exactly zero -- so a ContentSubpath's own local-space points ARE the numbers written into svg:d, with no scaling step to round-trip through at all. A real producer's viewBox is typically a large integer range unrelated to the frame's physical size (LibreOffice writes svg:viewBox="0 0 3657 4000" for a 3.656cm-wide shape, per this file's own top-of-file note); reading such a file and writing it back re-expresses the same geometry in this writer's own convention, which is a different spelling of the identical curve rather than a loss.
export function formatOdfViewBox(frame: Box): string {
  return `0 0 ${formatOdfNumber(frame.widthPt)} ${formatOdfNumber(frame.heightPt)}`;
}

function formatPoint(point: ContentPathPoint): string {
  return `${formatOdfNumber(point.xPt)},${formatOdfNumber(point.yPt)}`;
}

// Serialises subpaths into an svg:d string parseOdfPathData reads back segment for segment: one absolute "M" per subpath, an explicit absolute "L"/"C" per segment (never SVG's implicit-repeat convention, and never the H/V or relative shorthands real LibreOffice output favours -- all of them are read correctly by the parser, but writing the longest, most explicit form keeps the emitted string unambiguous for any other consumer's own parser too), and a trailing "Z" for a closed subpath only. Commas separate a point's own two numbers and spaces separate everything else -- the SVG number-list grammar treats both as optional whitespace, and parseOdfPathData's own tokenizer matches numbers and command letters directly rather than splitting on separators, so this is a readability choice, not a correctness one.
//
// A subpath with no segments writes as a bare "M x,y", which reads back as exactly that: a subpath with a start point and an empty segment list. An EMPTY subpath list writes as an empty string, which parseOdfPathData reads back as no subpaths at all -- the reader then treats the whole element as having no resolvable geometry and drops it, so a caller must refuse that case rather than write it (typed/draw/write-vectors.ts does).
export function formatOdfPathData(subpaths: readonly ContentSubpath[]): string {
  const parts: string[] = [];
  for (const subpath of subpaths) {
    parts.push(`M ${formatPoint(subpath.start)}`);
    for (const segment of subpath.segments) {
      if (segment.kind === "line") {
        parts.push(`L ${formatPoint(segment.to)}`);
      } else {
        parts.push(
          `C ${formatPoint(segment.control1)} ${formatPoint(segment.control2)} ${formatPoint(segment.to)}`,
        );
      }
    }
    if (subpath.closed) {
      parts.push("Z");
    }
  }
  return parts.join(" ");
}
