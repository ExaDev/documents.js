// SVG transform parsing and affine composition. SVG models every transform attribute (and the viewBox -> viewport map, and the group nesting rule) as one 2x3 affine matrix applied to user-space column vectors: x' = a*x + c*y + e, y' = b*x + d*y + f -- the identical parameterisation CSS transforms and PDF's cm operator use, and the reason a composition of any number of SVG transforms stays exactly one matrix rather than a tree of closures.
export interface AffineMatrix {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export const IDENTITY_MATRIX: AffineMatrix = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
};

export function applyMatrix(
  m: AffineMatrix,
  x: number,
  y: number,
): { readonly x: number; readonly y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

// Applies `inner` first and `outer` second -- the SVG nesting semantics: a group's transform maps its children's coordinates, so the total matrix walking into a child is outerCTM * childOwnTransform, matrix-multiplied in that left-to-right order (outer ∘ inner as function composition).
export function composeMatrices(
  outer: AffineMatrix,
  inner: AffineMatrix,
): AffineMatrix {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

export function applyScale(m: AffineMatrix, factor: number): AffineMatrix {
  return {
    a: m.a * factor,
    b: m.b * factor,
    c: m.c * factor,
    d: m.d * factor,
    e: m.e * factor,
    f: m.f * factor,
  };
}

// The mean of the two column scales -- the factor a stroke width grows by under m. Not the determinant's square root: for a shear-heavy matrix the columns disagree, and the mean keeps a stroked line's weight tracking the average of how the matrix stretches each basis direction, which is the best one-number answer a schema carrying a scalar stroke width has.
export function meanScaleFactor(m: AffineMatrix): number {
  return (Math.hypot(m.a, m.b) + Math.hypot(m.c, m.d)) / 2;
}

// axis-aligned: no rotation or shear terms at all, so a rect stays an axis-aligned rect and an ellipse stays an axis-aligned ellipse (possibly mirrored, which a bounding box absorbs exactly). A similarity additionally allows a uniform rotation/reflection but still maps squares to squares and circles to circles, so rect/ellipse again keep their kind -- via a bounding frame plus a rotationDeg the schema's rect/ellipse variants do carry -- provided the matrix does not reflect (a mirrored ellipse is not a rotated one; det < 0 is excluded). Anything more (non-uniform scale composed with rotation, shear) maps a circle to a genuinely skewed conic, which only the path variant can express.
export function isAxisAligned(m: AffineMatrix): boolean {
  return m.b === 0 && m.c === 0;
}

export function isNonReflectingSimilarity(m: AffineMatrix): boolean {
  if (isAxisAligned(m)) {
    return true;
  }
  if (m.a * m.d - m.b * m.c < 0) {
    return false;
  }
  return Math.abs(m.a * m.a + m.b * m.b - (m.c * m.c + m.d * m.d)) < 1e-9;
}

// The rotation angle of a non-reflecting similarity, in degrees clockwise on screen (SVG's own convention, y-down), which is exactly the sign convention ContentVector.rotationDeg already carries for the drawing variant. atan2(b, a) reads the angle straight off the matrix's first column; the caller is responsible for having classified m as a non-reflecting similarity first, since for a general matrix this quantity is not the rotation of anything.
export function similarityRotationDeg(m: AffineMatrix): number {
  return (Math.atan2(m.b, m.a) * 180) / Math.PI;
}

// The transform attribute grammar: a whitespace/comma-separated list of function calls translate(tx [ty]), scale(sx [sy]), rotate(angle [cx cy]), skewX(a), skewY(a), matrix(a b c d e f), applied LEFT TO RIGHT in list order -- which is the composition order composeMatrices(outer, inner) with each list entry as the new outer. Numbers reuse the shared SVG number grammar; function names are case-sensitive per the spec. Returns undefined for any malformed list (an unknown function, a bad argument count, a non-finite number) rather than a partial parse -- a half-applied transform would silently misplace every descendant.
const TRANSFORM_NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
const TRANSFORM_FUNCTIONS = [
  "translate",
  "scale",
  "rotate",
  "skewX",
  "skewY",
  "matrix",
] as const;
type TransformFunctionName = (typeof TRANSFORM_FUNCTIONS)[number];

interface TransformScanner {
  pos: number;
}

// Returns whether a comma was consumed, so the argument loop can reject a comma left dangling before the closing paren -- "rotate(90,)" is malformed, not an omitted argument silently accepted as rotate(90).
function skipTransformSeparators(
  source: string,
  scanner: TransformScanner,
): boolean {
  let comma = false;
  while (scanner.pos < source.length && /[\s,]/.test(source[scanner.pos]!)) {
    if (source[scanner.pos] === ",") {
      comma = true;
    }
    scanner.pos++;
  }
  return comma;
}

function scanTransformNumber(
  source: string,
  scanner: TransformScanner,
): number | undefined {
  TRANSFORM_NUMBER.lastIndex = scanner.pos;
  const match = TRANSFORM_NUMBER.exec(source);
  if (match === null) {
    return undefined;
  }
  scanner.pos = TRANSFORM_NUMBER.lastIndex;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : undefined;
}

function matrixFromFunction(
  name: TransformFunctionName,
  args: readonly number[],
): AffineMatrix | undefined {
  switch (name) {
    case "translate":
      if (args.length !== 1 && args.length !== 2) {
        return undefined;
      }
      return { a: 1, b: 0, c: 0, d: 1, e: args[0]!, f: args[1] ?? 0 };
    case "scale": {
      if (args.length !== 1 && args.length !== 2) {
        return undefined;
      }
      const sx = args[0]!;
      const sy = args[1] ?? sx;
      return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
    }
    case "rotate": {
      if (args.length !== 1 && args.length !== 3) {
        return undefined;
      }
      const radians = (args[0]! * Math.PI) / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      const rotation: AffineMatrix = {
        a: cos,
        b: sin,
        c: -sin,
        d: cos,
        e: 0,
        f: 0,
      };
      if (args.length === 1) {
        return rotation;
      }
      // rotate(a, cx, cy) is exactly translate(cx, cy) rotate(a) translate(-cx, -cy), spelled out here rather than delegated so the centre arithmetic stays in one place.
      const cx = args[1]!;
      const cy = args[2]!;
      return composeMatrices(
        composeMatrices({ a: 1, b: 0, c: 0, d: 1, e: cx, f: cy }, rotation),
        { a: 1, b: 0, c: 0, d: 1, e: -cx, f: -cy },
      );
    }
    case "skewX":
      if (args.length !== 1) {
        return undefined;
      }
      return {
        a: 1,
        b: 0,
        c: Math.tan((args[0]! * Math.PI) / 180),
        d: 1,
        e: 0,
        f: 0,
      };
    case "skewY":
      if (args.length !== 1) {
        return undefined;
      }
      return {
        a: 1,
        b: Math.tan((args[0]! * Math.PI) / 180),
        c: 0,
        d: 1,
        e: 0,
        f: 0,
      };
    case "matrix":
      if (args.length !== 6) {
        return undefined;
      }
      return {
        a: args[0]!,
        b: args[1]!,
        c: args[2]!,
        d: args[3]!,
        e: args[4]!,
        f: args[5]!,
      };
  }
}

export function parseSvgTransform(
  raw: string | undefined,
): AffineMatrix | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const source = raw.trim();
  if (source === "") {
    return undefined;
  }
  const scanner: TransformScanner = { pos: 0 };
  let total: AffineMatrix | undefined;
  for (;;) {
    skipTransformSeparators(source, scanner);
    if (scanner.pos >= source.length) {
      break;
    }
    const name = TRANSFORM_FUNCTIONS.find((candidate) =>
      source.startsWith(candidate, scanner.pos),
    );
    if (name === undefined) {
      return undefined;
    }
    scanner.pos += name.length;
    skipTransformSeparators(source, scanner);
    if (source[scanner.pos] !== "(") {
      return undefined;
    }
    scanner.pos++;
    const args: number[] = [];
    for (;;) {
      const hadComma = skipTransformSeparators(source, scanner);
      if (source[scanner.pos] === ")") {
        if (hadComma) {
          return undefined;
        }
        scanner.pos++;
        break;
      }
      const value = scanTransformNumber(source, scanner);
      if (value === undefined) {
        return undefined;
      }
      args.push(value);
    }
    const step = matrixFromFunction(name, args);
    if (step === undefined) {
      return undefined;
    }
    total = total === undefined ? step : composeMatrices(total, step);
  }
  return total;
}
