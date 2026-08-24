import type { ContentPathPoint, ContentSubpath } from "document-schema.js";

// The write-side inverse of odf.js's own typed/shared/path.ts (parseOdfPathData/parseOdfViewBox): turns a ContentVector 'path' variant's own subpaths (already in the path's local coordinate space, sized to frame.widthPt x frame.heightPt -- see document-schema.js's content.ts, the exact same convention scaleOdfRawPoint/buildOdfSubpaths read INTO on the parse side) into a real svg:d + svg:viewBox attribute pair. Anchoring the viewBox at "0 0 {widthPt} {heightPt}" -- exactly the frame's own current size -- gives a 1:1 scale (buildOdfSubpaths' own scale factor is frame.widthPt/viewBox.width), so the numbers written into svg:d are the SAME numbers as the source ContentPathPoint values, with no rescaling arithmetic needed on write and none needed to recover them on a later reparse.

// A single numeric coordinate, formatted to satisfy BOTH grammars odf.js's own path.ts parses: svg:d's PATH_TOKEN_PATTERN (`-?(\d+\.\d+|\.\d+|\d+)([eE][-+]?\d+)?`) and svg:viewBox's stricter VIEW_BOX_PATTERN (`-?\d+(?:\.\d+)?`, no bare ".5" leading-dot form, no exponent). Always emitting at least one leading digit before any decimal point and never using exponential notation satisfies both at once, so one formatter serves both callers below. Rounds to a fixed sub-point precision first to strip IEEE-754 noise (e.g. 0.1 + 0.2) from leaking into the written string, and normalizes -0 to a plain "0" rather than "-0" (cosmetic, but "-0" reads as a stray negative sign to a human inspecting the XML).
const PATH_NUMBER_DECIMALS = 6;
const PATH_NUMBER_SCALE = 10 ** PATH_NUMBER_DECIMALS;

export function formatPathNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`cannot format a non-finite path coordinate: ${value}`);
  }
  const rounded = Math.round(value * PATH_NUMBER_SCALE) / PATH_NUMBER_SCALE;
  if (rounded === 0) {
    return "0";
  }
  const fixed = rounded.toFixed(PATH_NUMBER_DECIMALS);
  return fixed.replace(/0+$/, "").replace(/\.$/, "");
}

function formatPathPoint(point: ContentPathPoint): string {
  return `${formatPathNumber(point.xPt)} ${formatPathNumber(point.yPt)}`;
}

// Always absolute commands (M/L/C) and always space-separated -- correctness of the round trip through odf.js's own parseOdfPathData is what this buys (every number boundary is unambiguous), not byte-identical output to real LibreOffice's own minified "a sign is itself a separator" style (see path.ts's own top-of-file note on that convention) -- this module's own test suite cross-checks the output against that exact parser rather than merely asserting it "looks plausible".
export function buildSvgPathData(subpaths: readonly ContentSubpath[]): string {
  const commands: string[] = [];
  for (const subpath of subpaths) {
    commands.push(`M${formatPathPoint(subpath.start)}`);
    for (const segment of subpath.segments) {
      if (segment.kind === "line") {
        commands.push(`L${formatPathPoint(segment.to)}`);
      } else {
        commands.push(
          `C${formatPathPoint(segment.control1)} ${formatPathPoint(segment.control2)} ${formatPathPoint(segment.to)}`,
        );
      }
    }
    if (subpath.closed) {
      commands.push("Z");
    }
  }
  return commands.join(" ");
}

// svg:viewBox="minX minY width height" -- see this module's own top-of-file note on why "0 0 {widthPt} {heightPt}" is always the right choice for a viewBox this module itself writes (a 1:1 scale against the frame's own current size).
export function buildSvgViewBox(widthPt: number, heightPt: number): string {
  return `0 0 ${formatPathNumber(widthPt)} ${formatPathNumber(heightPt)}`;
}
