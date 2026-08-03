import type { MathGlyphAssembly, MathGlyphConstruction, MathGlyphPart, MathGlyphVariant } from './math-table';

// Turns a font's own MathVariants data (math-table.ts) into concrete placement data for one stretchy glyph at one target size: which glyph(s) to draw, and where each one sits along the stretch axis. This is the OpenType MATH spec's own two-stage stretching model (spec, "MathVariants Table"), implemented in full -- first try the font's pre-built larger variants, and fall back to assembling from repeatable parts only when no variant is large enough.
//
// Every number in and out of this module is unit-agnostic: feed it design units and every result field is in design units; feed it points and every result field is in points. `scaleMathStretchConstruction` converts between the two, and math-font.ts's own LoadedMathFont.stretchGlyph is the points-in/points-out entry point most callers want.

// Which extent a stretchy glyph is being stretched along: its height (a tall parenthesis, brace, bracket, or radical sign) or its width (an over/under-brace, a long arrow). A font declares a separate construction per axis, and a given glyph is usually covered by exactly one of them.
export type MathStretchAxis = 'vertical' | 'horizontal';

// One glyph placed inside an assembled construction. `offset` is measured along the stretch axis from the construction's own start -- the BOTTOM for a vertical construction and the LEFT for a horizontal one, matching the order OpenType lists assembly parts in (math-table.ts's MathGlyphAssembly) -- to this glyph's own corresponding edge. `advance` is that part's own full extent along the same axis, so a part occupies [offset, offset + advance) and consecutive parts deliberately overlap.
export interface MathStretchPlacement {
  readonly glyphId: number;
  readonly offset: number;
  readonly advance: number;
}

// The result of stretching one glyph to one target size. `kind` records which of the spec's three outcomes produced it: 'base' when the glyph's own unstretched form was already big enough (or is all the font offers), 'variant' when a pre-built larger glyph was selected, 'assembly' when the construction was genuinely built from repeated parts. `size` is the extent actually achieved along the stretch axis, which is >= the requested target whenever the font can reach it and the largest reachable size otherwise -- callers that care should compare it against their own target rather than assuming it was met.
export interface MathStretchConstruction {
  readonly kind: 'base' | 'variant' | 'assembly';
  readonly axis: MathStretchAxis;
  readonly size: number;
  readonly italicsCorrection: number;
  readonly placements: readonly MathStretchPlacement[];
}

export interface MathStretchOptions {
  readonly axis: MathStretchAxis;
  readonly targetSize: number;
  // The font's own MathVariants.minConnectorOverlap: the least two adjacent parts may overlap without leaving a visible seam. A lower bound on the chosen overlap, never a target -- an assembly overlaps by MORE than this whenever doing so brings its total size closer to the requested target.
  readonly minConnectorOverlap: number;
}

function sumBy<T>(items: readonly T[], value: (item: T) => number): number {
  return items.reduce((total, item) => total + value(item), 0);
}

// How many times each extender part must repeat for the assembly to reach `targetSize`, at the tightest packing the font permits (i.e. overlapping by exactly minConnectorOverlap, which is what makes the assembly as LARGE as it can be for a given repeat count). Solved directly rather than by growing a loop: with A/E the summed full advances of the fixed and extender parts, n/x their counts and m the minimum overlap, the assembly's own size at repeat count r is A + rE - (n + rx - 1)m, so the smallest r meeting the target is ceil((target - A + (n - 1)m) / (E - xm)). A non-positive denominator means every extra repetition costs at least as much overlap as it adds advance, so no repeat count reaches the target at all and the minimum is used.
function requiredRepeatCount(fixed: readonly MathGlyphPart[], extenders: readonly MathGlyphPart[], targetSize: number, minConnectorOverlap: number): number {
  // A recipe made entirely of extenders has no fixed part to stand alone, so it needs at least one repetition to place anything at all; one that has fixed parts can legitimately use zero repetitions as its smallest form.
  const minimumRepeat = fixed.length === 0 ? 1 : 0;
  if (extenders.length === 0) {
    return minimumRepeat;
  }
  const growthPerRepeat = sumBy(extenders, (part) => part.fullAdvance) - extenders.length * minConnectorOverlap;
  if (growthPerRepeat <= 0) {
    return minimumRepeat;
  }
  const shortfall = targetSize - sumBy(fixed, (part) => part.fullAdvance) + (fixed.length - 1) * minConnectorOverlap;
  return Math.max(minimumRepeat, Math.ceil(shortfall / growthPerRepeat));
}

// The parts actually laid down, in axis order: every fixed part once and every extender part `repeatCount` times, each extender's repetitions consecutive and in the recipe's own position.
function expandParts(parts: readonly MathGlyphPart[], repeatCount: number): readonly MathGlyphPart[] {
  const expanded: MathGlyphPart[] = [];
  for (const part of parts) {
    for (let i = 0; i < (part.isExtender ? repeatCount : 1); i++) {
      expanded.push(part);
    }
  }
  return expanded;
}

// The largest overlap every join in `expanded` can share. Two bounds apply at once, both structural rather than stylistic: a join may not consume more than either side's own declared connector length (past that the two outlines stop being flat connecting material and the join distorts the drawn shape), and no part may be overlapped away entirely, so an interior part -- overlapped at both ends -- caps the overlap at half its own full advance, an end part at all of it.
function maximumOverlap(expanded: readonly MathGlyphPart[]): number {
  let overlap = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < expanded.length; i++) {
    overlap = Math.min(overlap, expanded[i]!.endConnectorLength, expanded[i + 1]!.startConnectorLength);
  }
  for (let i = 0; i < expanded.length; i++) {
    const joins = (i === 0 ? 0 : 1) + (i === expanded.length - 1 ? 0 : 1);
    if (joins > 0) {
      overlap = Math.min(overlap, expanded[i]!.fullAdvance / joins);
    }
  }
  return overlap;
}

function assembleFromParts(assembly: MathGlyphAssembly, options: MathStretchOptions): MathStretchConstruction | undefined {
  const fixed = assembly.parts.filter((part) => !part.isExtender);
  const extenders = assembly.parts.filter((part) => part.isExtender);
  const expanded = expandParts(assembly.parts, requiredRepeatCount(fixed, extenders, options.targetSize, options.minConnectorOverlap));
  if (expanded.length === 0) {
    return undefined;
  }

  const joins = expanded.length - 1;
  const maxOverlap = maximumOverlap(expanded);
  // The font's own minimum is the floor -- except where a part is too short to survive it, in which case the geometric bound wins, since overlapping a part out of existence is a worse failure than a hairline seam.
  const minOverlap = Math.min(options.minConnectorOverlap, maxOverlap);
  const totalAdvance = sumBy(expanded, (part) => part.fullAdvance);
  // With the repeat count fixed, the overlap is the only remaining freedom: widening it shrinks the construction. Solve for the overlap that lands exactly on the target, then clamp it into the range the parts allow -- so the assembly overshoots the target only by as much as the connectors force it to.
  const exactOverlap = joins === 0 ? minOverlap : (totalAdvance - options.targetSize) / joins;
  const overlap = Math.min(Math.max(exactOverlap, minOverlap), maxOverlap);

  const placements: MathStretchPlacement[] = [];
  let offset = 0;
  for (const part of expanded) {
    placements.push({ glyphId: part.glyphId, offset, advance: part.fullAdvance });
    offset += part.fullAdvance - overlap;
  }
  return { kind: 'assembly', axis: options.axis, size: totalAdvance - joins * overlap, italicsCorrection: assembly.italicsCorrection, placements };
}

function fromVariant(variant: MathGlyphVariant, isBaseGlyph: boolean, axis: MathStretchAxis): MathStretchConstruction {
  return {
    kind: isBaseGlyph ? 'base' : 'variant',
    axis,
    size: variant.advanceMeasurement,
    italicsCorrection: 0,
    placements: [{ glyphId: variant.glyphId, offset: 0, advance: variant.advanceMeasurement }],
  };
}

// Stretches one glyph to `options.targetSize` along `options.axis`, following the OpenType MATH spec's own preference order: the smallest pre-built variant that reaches the target if there is one (a real, hand-drawn glyph is always better than a construction glued together from parts), otherwise the part assembly if the font declares one, otherwise the largest variant the font does offer. Returns `undefined` only for a construction with neither variants nor a usable assembly -- a caller that gets `undefined` should draw the base glyph unstretched.
export function assembleStretchyGlyph(construction: MathGlyphConstruction, options: MathStretchOptions): MathStretchConstruction | undefined {
  const variants = construction.variants;
  const reaching = variants.findIndex((variant) => variant.advanceMeasurement >= options.targetSize);
  if (reaching !== -1) {
    return fromVariant(variants[reaching]!, reaching === 0, options.axis);
  }
  if (construction.assembly !== undefined) {
    const assembled = assembleFromParts(construction.assembly, options);
    if (assembled !== undefined) {
      return assembled;
    }
  }
  const largest = variants[variants.length - 1];
  return largest === undefined ? undefined : fromVariant(largest, variants.length === 1, options.axis);
}

// The same construction with every length multiplied by `factor` -- the design-units-to-points conversion math-font.ts applies on the way out, kept here so a caller working from raw MathVariants data through assembleStretchyGlyph can make the same conversion without repeating the field walk.
export function scaleMathStretchConstruction(construction: MathStretchConstruction, factor: number): MathStretchConstruction {
  return {
    kind: construction.kind,
    axis: construction.axis,
    size: construction.size * factor,
    italicsCorrection: construction.italicsCorrection * factor,
    placements: construction.placements.map((placement) => ({ glyphId: placement.glyphId, offset: placement.offset * factor, advance: placement.advance * factor })),
  };
}
