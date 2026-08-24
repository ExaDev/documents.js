// SVG length parsing: the one unit surface the read side needs. SVG lengths (width/height/viewBox companions and per-shape geometry) are expressed in CSS user units against the user coordinate system in force, so every absolute unit has an exact conversion factor into CSS px and then into the points this package's whole geometry pipeline runs on (CSS defines 1in = 96px and 1in = 72pt, so 1px = 72/96 = 0.75pt exactly -- a ratio, not a measured value).
const PT_PER_PX = 0.75;
const PT_PER_MM = 72 / 25.4;
const PT_PER_CM = 720 / 25.4;
const PT_PER_IN = 72;

// A single SVG number, the shared grammar of every length and coordinate this file touches: optional sign, digits with optional fraction in either "1.5" or ".5" form, optional exponent. Kept as one pattern (rather than Number() alone) so a trailing unit is split off cleanly and a malformed value yields undefined instead of NaN poisoning downstream geometry.
const SVG_NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

// Resolves one SVG length against the user-unit convention in force and returns it in points. A bare number is a user unit; under the root coordinate systems this reader builds (viewBox mapped 1:1 onto the viewport, or the 0.75pt fallback when the svg declares neither -- see readSvgContent's own root notes), one user unit is one CSS px, hence the PT_PER_PX factor. The absolute units convert by their exact factors, pc and q included (1pc = 12pt, 1q = 1/40cm exactly). Returns undefined for em/ex/% -- each needs a font context or a referent this reader keeps no model of -- and for malformed values; an unresolvable length is the caller's diagnostic to report, never a silent zero.
const SVG_LENGTH_PATTERN =
  /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)(px|pt|mm|cm|in|pc|q|em|ex|%)?$/;

export function parseSvgLengthPt(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const match = SVG_LENGTH_PATTERN.exec(raw.trim());
  if (match === null) {
    return undefined;
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value)) {
    return undefined;
  }
  switch (match[2]) {
    case undefined:
    case "px":
      return value * PT_PER_PX;
    case "pt":
      return value;
    case "mm":
      return value * PT_PER_MM;
    case "cm":
      return value * PT_PER_CM;
    case "in":
      return value * PT_PER_IN;
    case "pc":
      return value * 12;
    case "q":
      return (value * PT_PER_CM) / 40;
    default:
      return undefined;
  }
}

// Resolves one SVG length into USER UNITS (CSS px) rather than points -- the form geometry attributes (x/y/width/rx/cx and stroke-width) need, because those coordinates live in the user coordinate system the root viewBox map afterwards scales, whereas a points value here would have pre-scaled them once and let the viewBox scale them again. Only absolute units are accepted: each converts through its exact pt factor and back through PT_PER_PX, so a bare number is itself (the identity), and em/ex/% return undefined for the same reason parseSvgLengthPt does.
export function parseSvgUserUnits(raw: string | undefined): number | undefined {
  const pt = parseSvgLengthPt(raw);
  return pt === undefined ? undefined : pt / PT_PER_PX;
}

// A viewBox's four numbers (minX minY width height), whitespace/comma-separated. Width/height must be non-negative per the attribute's own grammar (SVG 2, "The 'svg' element"); a zero dimension is legal and degenerate, which the caller classifies, but a negative one is malformed and returns undefined rather than being silently negated.
export interface SvgViewBox {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
}

export function parseSvgViewBox(
  raw: string | undefined,
): SvgViewBox | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const parts = raw.trim().replace(/,/g, " ").split(/\s+/);
  if (parts.length !== 4) {
    return undefined;
  }
  const numbers = parts.map((part) =>
    SVG_NUMBER_PATTERN.test(part) ? Number(part) : Number.NaN,
  );
  // The parts.length === 4 check above guarantees every index exists, so the non-null assertions restate that check rather than assume past it -- the identical indexed access pattern read.ts's own polyline points use.
  if (
    !numbers.every((value) => Number.isFinite(value)) ||
    numbers[2]! < 0 ||
    numbers[3]! < 0
  ) {
    return undefined;
  }
  return {
    minX: numbers[0]!,
    minY: numbers[1]!,
    width: numbers[2]!,
    height: numbers[3]!,
  };
}
