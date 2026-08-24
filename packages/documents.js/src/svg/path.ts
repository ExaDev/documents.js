// The SVG path-data grammar (SVG 2, "B (Shape) Grammar"), parsed into the subpath vocabulary the ContentVector path variant already carries: subpaths of pure line and cubic Bezier segments in the same user space the d attribute itself lives in (the reader transforms them through the active CTM afterwards -- an affine maps lines to lines and cubics to cubics exactly, so that step loses nothing). This is deliberately a sibling of odf.js's own parseOdfPathData rather than an import of it: ODF's svg:d is the SVG subset LibreOffice emits (M/L/H/V/C/Z only), while a real-world .svg additionally uses S/Q/T/A and the relative lowercase forms, so this parser implements the full SVG command set on top of the identical scanner discipline.
//
// The three commands beyond the M/L/H/V/C/Z subset, and their exactness contracts:
// - S (smooth cubic): the first control point is the reflection of the previous cubic's second control through the current point -- EXACT, it reproduces the author's intended curve with no approximation.
// - Q (quadratic): elevated to a cubic EXACTLY -- a quadratic Bezier is the degree-2 special case of a cubic, with controls at the 2/3 marks toward the shared control point, so the elevated cubic is the same curve at every parameter.
// - T (smooth quadratic): reflects the previous quadratic's control the way S does; when the previous command was not Q/T the SVG spec itself defines the reflected control as the current point, degenerating to a straight line -- exact either way.
// - A (elliptical arc): the one genuinely approximate conversion. The standard endpoint-to-centre parameterisation (SVG 2, F.6.5) recovers the arc's centre and angles exactly; the arc is then split into segments of at most 90 degrees, each emitted as one cubic whose controls sit kappa = 4/3*tan(delta/4) along the segment's own boundary tangents -- the same bounded construction every Bezier-based renderer uses for circular arcs (the 90-degree worst case is the classical kappa approximation, accurate to a fraction of a point at document scale, and the error shrinks as segments shorten).

export interface ParsedPathPoint {
  readonly x: number;
  readonly y: number;
}

// A discriminated union rather than optional control fields, so a consumer narrowing on kind: 'cubic' gets non-optional controls with no assertion -- the same discipline the ContentSubpath vocabulary itself uses.
export type ParsedPathSegment =
  | { readonly kind: "line"; readonly to: ParsedPathPoint }
  | {
      readonly kind: "cubic";
      readonly control1: ParsedPathPoint;
      readonly control2: ParsedPathPoint;
      readonly to: ParsedPathPoint;
    };

export interface ParsedPathSubpath {
  readonly start: ParsedPathPoint;
  readonly closed: boolean;
  readonly segments: readonly ParsedPathSegment[];
}

const PATH_NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;

class PathScanner {
  pos = 0;

  constructor(readonly source: string) {}

  private skipSeparators(): void {
    while (
      this.pos < this.source.length &&
      /[\s,]/.test(this.source[this.pos]!)
    ) {
      this.pos++;
    }
  }

  atEnd(): boolean {
    this.skipSeparators();
    return this.pos >= this.source.length;
  }

  // A leading sign is itself a separator for the next number ("1-2" is two numbers -- the grammar's own rule), which the sticky pattern handles by matching the signed form first wherever the cursor sits.
  nextNumber(): number | undefined {
    this.skipSeparators();
    PATH_NUMBER.lastIndex = this.pos;
    const match = PATH_NUMBER.exec(this.source);
    if (match === null) {
      return undefined;
    }
    this.pos = PATH_NUMBER.lastIndex;
    const value = Number(match[0]);
    return Number.isFinite(value) ? value : undefined;
  }

  // Arc flags are the grammar's one single-character token: two [01] chars that may be packed against the surrounding numbers ("a1 1 0..." and "a110..." are both legal and distinct). Reading them as bare chars rather than numbers is the classic path-parser bug this method exists to avoid.
  nextArcFlag(): 0 | 1 | undefined {
    this.skipSeparators();
    const char = this.source[this.pos];
    if (char === "0" || char === "1") {
      this.pos++;
      return char === "0" ? 0 : 1;
    }
    return undefined;
  }

  nextCommandLetter(): string | undefined {
    this.skipSeparators();
    const char = this.source[this.pos];
    if (char !== undefined && /[a-zA-Z]/.test(char)) {
      this.pos++;
      return char;
    }
    return undefined;
  }
}

// The running cursor the commands mutate: the current point, the start of the open subpath (Z returns to it), and the previous cubic's second control / previous quadratic's control for S/T reflection. Both reflection anchors are cleared by every command outside their own family and by Z/M (a broken curve chain has nothing to reflect) -- exactly the spec's "the previous control point" scoping.
interface PathCursor {
  x: number;
  y: number;
  subpathStartX: number;
  subpathStartY: number;
  lastCubicControl?: ParsedPathPoint;
  lastQuadControl?: ParsedPathPoint;
}

interface PathAccumulator {
  subpaths: ParsedPathSubpath[];
  current?: { start: ParsedPathPoint; segments: ParsedPathSegment[] };
}

function addLine(
  cursor: PathCursor,
  acc: PathAccumulator,
  to: ParsedPathPoint,
): void {
  acc.current!.segments.push({ kind: "line", to });
  cursor.x = to.x;
  cursor.y = to.y;
  cursor.lastCubicControl = undefined;
  cursor.lastQuadControl = undefined;
}

function addCubic(
  cursor: PathCursor,
  acc: PathAccumulator,
  control1: ParsedPathPoint,
  control2: ParsedPathPoint,
  to: ParsedPathPoint,
): void {
  acc.current!.segments.push({ kind: "cubic", control1, control2, to });
  cursor.x = to.x;
  cursor.y = to.y;
  cursor.lastCubicControl = control2;
  cursor.lastQuadControl = undefined;
}

// The exact quadratic -> cubic elevation described in the module note: the degree-3 curve with both controls at the 2/3 marks toward the quadratic's own control IS the quadratic, so nothing is approximated.
function addQuad(
  cursor: PathCursor,
  acc: PathAccumulator,
  control: ParsedPathPoint,
  to: ParsedPathPoint,
): void {
  const from = { x: cursor.x, y: cursor.y };
  addCubic(
    cursor,
    acc,
    {
      x: from.x + (2 / 3) * (control.x - from.x),
      y: from.y + (2 / 3) * (control.y - from.y),
    },
    {
      x: to.x + (2 / 3) * (control.x - to.x),
      y: to.y + (2 / 3) * (control.y - to.y),
    },
    to,
  );
  // T reflects the previous quadratic's OWN control (the point named in the Q command, not the elevated cubic's control), and the addCubic delegation above just cleared the quad family's state -- restore it so a following T reflects the right point.
  cursor.lastQuadControl = control;
}

// One elliptical-arc command -> cubic segments appended to the open subpath. Implements SVG 2 F.6.5's endpoint-to-centre conversion (including the out-of-range radii correction, which scales the radii up by exactly the factor that makes the endpoints reachable), then walks the arc in segments of at most 90 degrees, each emitted as a cubic whose controls sit kappa along the segment's own boundary tangents.
function addArc(
  cursor: PathCursor,
  acc: PathAccumulator,
  rx: number,
  ry: number,
  xRotDeg: number,
  largeArc: 0 | 1,
  sweep: 0 | 1,
  to: ParsedPathPoint,
): void {
  const from = { x: cursor.x, y: cursor.y };
  if (rx === 0 || ry === 0 || (from.x === to.x && from.y === to.y)) {
    // A zero radius renders as a straight line to the endpoint (the spec's own rule); a coincident endpoint has no arc to draw at all.
    if (from.x !== to.x || from.y !== to.y) {
      addLine(cursor, acc, to);
    }
    return;
  }
  const xRot = (xRotDeg * Math.PI) / 180;
  const cosRot = Math.cos(xRot);
  const sinRot = Math.sin(xRot);
  const dx = (from.x - to.x) / 2;
  const dy = (from.y - to.y) / 2;
  // The endpoint midpoint translated into the arc's own rotated frame -- F.6.5's (x1', y1').
  const x1p = cosRot * dx + sinRot * dy;
  const y1p = -sinRot * dx + cosRot * dy;

  // F.6.6: if the stated radii cannot span the endpoints at all, scale both up by the one factor that makes the centre equation solvable.
  const radiiSpan = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (radiiSpan > 1) {
    const factor = Math.sqrt(radiiSpan);
    rx *= factor;
    ry *= factor;
  }

  // The centre, with the sign chosen so the large-arc/sweep flag pair picks one of the two candidates.
  const sign = largeArc !== sweep ? 1 : -1;
  const numerator =
    rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coefficient =
    denominator === 0
      ? 0
      : sign * Math.sqrt(Math.max(numerator, 0) / denominator);
  const cxp = (coefficient * rx * y1p) / ry;
  const cyp = -(coefficient * ry * x1p) / rx;
  const cx = cosRot * cxp - sinRot * cyp + (from.x + to.x) / 2;
  const cy = sinRot * cxp + cosRot * cyp + (from.y + to.y) / 2;

  // The signed angle between two unit vectors, F.6.5's own helper.
  const angleBetween = (
    ux: number,
    uy: number,
    vx: number,
    vy: number,
  ): number => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    if (len === 0) {
      return 0;
    }
    const inner = Math.min(1, Math.max(-1, dot / len));
    const result = Math.acos(inner);
    return ux * vy - uy * vx < 0 ? -result : result;
  };

  const theta1 = angleBetween(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let deltaTheta = angleBetween(
    (x1p - cxp) / rx,
    (y1p - cyp) / ry,
    (-x1p - cxp) / rx,
    (-y1p - cyp) / ry,
  );
  if (sweep === 0 && deltaTheta > 0) {
    deltaTheta -= 2 * Math.PI;
  } else if (sweep === 1 && deltaTheta < 0) {
    deltaTheta += 2 * Math.PI;
  }

  // At most 90 degrees per cubic segment -- ceil(|delta| / (pi/2)), never fewer than one segment even for a tiny arc.
  const segmentCount = Math.max(
    1,
    Math.ceil(Math.abs(deltaTheta) / (Math.PI / 2)),
  );
  const deltaPerSegment = deltaTheta / segmentCount;
  const kappa = (4 / 3) * Math.tan(deltaPerSegment / 4);

  // The arc's own parametrisation and tangent in user space: point(t) = centre + R(rot) * (rx cos t, ry sin t), tangent(t) = R(rot) * (-rx sin t, ry cos t). A cubic segment from t0 to t1 takes its controls kappa times the tangent length away from each endpoint (P1 = P0 + kappa*T(t0), P2 = P3 - kappa*T(t1)) -- the standard bounded arc-to-cubic construction.
  const pointAt = (t: number): ParsedPathPoint => ({
    x: cx + rx * cosRot * Math.cos(t) - ry * sinRot * Math.sin(t),
    y: cy + rx * sinRot * Math.cos(t) + ry * cosRot * Math.sin(t),
  });
  const tangentAt = (t: number): ParsedPathPoint => ({
    x: -rx * cosRot * Math.sin(t) - ry * sinRot * Math.cos(t),
    y: -rx * sinRot * Math.sin(t) + ry * cosRot * Math.cos(t),
  });

  for (let i = 0; i < segmentCount; i++) {
    const start = pointAt(theta1 + deltaPerSegment * i);
    const end = pointAt(theta1 + deltaPerSegment * (i + 1));
    const t0 = tangentAt(theta1 + deltaPerSegment * i);
    const t1 = tangentAt(theta1 + deltaPerSegment * (i + 1));
    addCubic(
      cursor,
      acc,
      { x: start.x + kappa * t0.x, y: start.y + kappa * t0.y },
      { x: end.x - kappa * t1.x, y: end.y - kappa * t1.y },
      end,
    );
  }
}

// The number of coordinate values each command consumes per repetition; Z consumes none.
const COMMAND_ARITY: Record<string, number> = {
  M: 2,
  m: 2,
  L: 2,
  l: 2,
  H: 1,
  h: 1,
  V: 1,
  v: 1,
  C: 6,
  c: 6,
  S: 4,
  s: 4,
  Q: 4,
  q: 4,
  T: 2,
  t: 2,
  A: 7,
  a: 7,
};

export function parseSvgPathData(
  d: string,
): readonly ParsedPathSubpath[] | undefined {
  const scanner = new PathScanner(d.trim());
  const cursor: PathCursor = { x: 0, y: 0, subpathStartX: 0, subpathStartY: 0 };
  const acc: PathAccumulator = { subpaths: [] };
  let command: string | undefined;

  const closeSubpath = (): void => {
    if (acc.current !== undefined) {
      acc.subpaths.push({
        start: acc.current.start,
        closed: true,
        segments: acc.current.segments,
      });
      acc.current = undefined;
    }
    cursor.x = cursor.subpathStartX;
    cursor.y = cursor.subpathStartY;
    cursor.lastCubicControl = undefined;
    cursor.lastQuadControl = undefined;
  };

  const startSubpath = (at: ParsedPathPoint): void => {
    // A moveto flushes any open subpath as unclosed before opening the next.
    if (acc.current !== undefined) {
      acc.subpaths.push({
        start: acc.current.start,
        closed: false,
        segments: acc.current.segments,
      });
      acc.current = undefined;
    }
    acc.current = { start: at, segments: [] };
    cursor.x = at.x;
    cursor.y = at.y;
    cursor.subpathStartX = at.x;
    cursor.subpathStartY = at.y;
    cursor.lastCubicControl = undefined;
    cursor.lastQuadControl = undefined;
  };

  while (!scanner.atEnd()) {
    const letter = scanner.nextCommandLetter();
    if (letter !== undefined) {
      command = letter;
    } else if (command === undefined) {
      return undefined;
    }
    const active = command;

    if (active === "Z" || active === "z") {
      closeSubpath();
      // Z takes no arguments, so an implicit repetition right after it is malformed rather than another close.
      command = undefined;
      continue;
    }
    const arity = COMMAND_ARITY[active];
    if (arity === undefined) {
      return undefined;
    }

    // One command letter's argument stream is a series of full coordinate groups (implicit repetition); the first group of M/m is the moveto itself and every later group degenerates to a lineto per the grammar.
    let groupIndex = 0;
    for (;;) {
      if (active === "A" || active === "a") {
        // Arc arguments are not plain numbers: the two flags are single chars that may legally fuse with adjacent numbers, so they are read positionally rather than through nextNumber.
        const rx = scanner.nextNumber();
        const ry = scanner.nextNumber();
        const rotation = scanner.nextNumber();
        const largeArc = scanner.nextArcFlag();
        const sweep = scanner.nextArcFlag();
        const x = scanner.nextNumber();
        const y = scanner.nextNumber();
        if (
          rx === undefined ||
          ry === undefined ||
          rotation === undefined ||
          largeArc === undefined ||
          sweep === undefined ||
          x === undefined ||
          y === undefined
        ) {
          return undefined;
        }
        if (acc.current === undefined) {
          return undefined;
        }
        const to =
          active === "A" ? { x, y } : { x: cursor.x + x, y: cursor.y + y };
        addArc(
          cursor,
          acc,
          Math.abs(rx),
          Math.abs(ry),
          rotation,
          largeArc,
          sweep,
          to,
        );
      } else {
        const args: number[] = [];
        for (let i = 0; i < arity; i++) {
          const value = scanner.nextNumber();
          if (value === undefined) {
            return undefined;
          }
          args.push(value);
        }
        const relative =
          active === active.toLowerCase() && active !== active.toUpperCase();
        const point = (x: number, y: number): ParsedPathPoint =>
          relative ? { x: cursor.x + x, y: cursor.y + y } : { x, y };
        const upper = active.toUpperCase();

        if (upper === "M") {
          if (groupIndex === 0) {
            startSubpath(point(args[0]!, args[1]!));
          } else {
            if (acc.current === undefined) {
              return undefined;
            }
            addLine(cursor, acc, point(args[0]!, args[1]!));
          }
        } else {
          if (acc.current === undefined) {
            // Any drawing command before the first moveto is malformed -- there is no open subpath to draw into.
            return undefined;
          }
          switch (upper) {
            case "L":
              addLine(cursor, acc, point(args[0]!, args[1]!));
              break;
            case "H":
              addLine(
                cursor,
                acc,
                relative
                  ? { x: cursor.x + args[0]!, y: cursor.y }
                  : { x: args[0]!, y: cursor.y },
              );
              break;
            case "V":
              addLine(
                cursor,
                acc,
                relative
                  ? { x: cursor.x, y: cursor.y + args[0]! }
                  : { x: cursor.x, y: args[0]! },
              );
              break;
            case "C":
              addCubic(
                cursor,
                acc,
                point(args[0]!, args[1]!),
                point(args[2]!, args[3]!),
                point(args[4]!, args[5]!),
              );
              break;
            case "S": {
              const from = { x: cursor.x, y: cursor.y };
              const reflected =
                cursor.lastCubicControl === undefined
                  ? from
                  : {
                      x: 2 * from.x - cursor.lastCubicControl.x,
                      y: 2 * from.y - cursor.lastCubicControl.y,
                    };
              addCubic(
                cursor,
                acc,
                reflected,
                point(args[0]!, args[1]!),
                point(args[2]!, args[3]!),
              );
              break;
            }
            case "Q":
              addQuad(
                cursor,
                acc,
                point(args[0]!, args[1]!),
                point(args[2]!, args[3]!),
              );
              break;
            case "T": {
              const from = { x: cursor.x, y: cursor.y };
              const to = point(args[0]!, args[1]!);
              const control =
                cursor.lastQuadControl === undefined
                  ? from
                  : {
                      x: 2 * from.x - cursor.lastQuadControl.x,
                      y: 2 * from.y - cursor.lastQuadControl.y,
                    };
              addQuad(cursor, acc, control, to);
              break;
            }
          }
        }
      }
      groupIndex++;
      // A further group follows only if the scanner sits on a number or sign (a command letter ends the stream); atEnd() consumes trailing separators, and nextNumber() would over-read a following letter's arguments as this command's, so the boundary is probed exactly here.
      if (!hasNextNumberToken(scanner)) {
        break;
      }
    }
  }

  if (acc.current !== undefined) {
    acc.subpaths.push({
      start: acc.current.start,
      closed: false,
      segments: acc.current.segments,
    });
  }
  // A subpath with no segments (a bare moveto, or an M immediately followed by Z) paints nothing; dropping it here keeps every emitted subpath drawable.
  return acc.subpaths.filter((subpath) => subpath.segments.length > 0);
}

// Probes whether the next non-separator character continues a number (digit, dot, or sign) without consuming anything -- the implicit-repetition boundary test. A sticky zero-width lookahead on the shared pattern would advance lastIndex, so this peeks the raw character class instead.
function hasNextNumberToken(scanner: PathScanner): boolean {
  let probe = scanner.pos;
  while (
    probe < scanner.source.length &&
    /[\s,]/.test(scanner.source[probe]!)
  ) {
    probe++;
  }
  const char = scanner.source[probe];
  return char !== undefined && /[0-9.\-+]/.test(char);
}
