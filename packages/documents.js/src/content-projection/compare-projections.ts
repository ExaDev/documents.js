import {
  SHARED_FORMULA,
  type ContentProjection,
  type ProjectionCategory,
  type ProjectionFormat,
} from "./projection";

/** How many units a category held in the original, and how many the rewrite lacks or adds. */
export interface UnitDelta {
  readonly original: number;
  /** Units the original has that the rewrite does not (multiset difference). */
  readonly missing: number;
  /** Units the rewrite has that the original does not. */
  readonly extra: number;
}

/** A census family whose element count differs. */
export interface FamilyDelta {
  readonly original: number;
  readonly rewrite: number;
}

export interface MediaDelta {
  readonly original: number;
  /** Original images or embedded objects with no counterpart of their kind in the rewrite. */
  readonly missing: number;
  /** Originals whose bytes differ from the rewrite's, where the rewrite holds an unmatched one of the same kind: the writer re-encoded them, and whether pixels survived is not decided here. */
  readonly reencoded: number;
  readonly extra: number;
}

export interface CellDelta {
  readonly original: number;
  readonly missing: number;
  readonly extra: number;
  /** Cells in both whose resolved value differs. */
  readonly valueDiffer: number;
  /** Cells whose original has a formula and whose rewrite has none. */
  readonly formulaLost: number;
  /** Cells whose formula text differs and which neither side takes from a shared master. */
  readonly formulaDiffer: number;
}

/**
 * What a finding is, decided by the rules in this package's design note:
 *
 * - `loss`: the original has content the rewrite lacks, and the control shows nothing lost in the same place.
 * - `unstable`: the original has content the rewrite lacks, but rewriting the rewrite loses content in the same place, so loss cannot be told from writer noise there.
 * - `writer-asymmetry`: the rewrite has content the original lacks, and rewriting the rewrite changes the same place, so the writer is not at a fixed point there.
 * - `writer-addition`: the rewrite has content the original lacks and the writer is stable there: a deterministic addition.
 * - `reencoded-media`: the same kind of media with different bytes.
 *
 * Without a control, nothing is `unstable`, every shortfall is `loss`, and every surplus is `writer-addition`.
 */
export type FindingClass =
  | "loss"
  | "unstable"
  | "writer-asymmetry"
  | "writer-addition"
  | "reencoded-media";

export interface Finding {
  readonly area: "units" | "census" | "media" | "cells";
  /** The category, `category:family`, or the cell measure the finding is about. */
  readonly subject: string;
  readonly count: number;
  readonly class: FindingClass;
}

/**
 * `loss`: some content is gone. `unstable`: content is gone where the control shows the writer unstable, so it cannot be adjudicated. `incomplete`: nothing lost in what was read, but a part could not be read on one side. `writer-differences`: only surplus or re-encoded content. `equivalent`: no difference in any unit, element count, medium or cell.
 */
export type Verdict =
  "loss" | "unstable" | "incomplete" | "writer-differences" | "equivalent";

export interface ProjectionComparison {
  readonly format: ProjectionFormat;
  readonly units: ReadonlyMap<ProjectionCategory, UnitDelta>;
  /** Only the families whose counts differ, keyed `category:family`. */
  readonly census: ReadonlyMap<string, FamilyDelta>;
  readonly media: MediaDelta;
  /** Present for xlsx. */
  readonly cells: CellDelta | undefined;
  readonly findings: readonly Finding[];
  readonly verdict: Verdict;
  /** Whether a control projection separated writer noise from loss. */
  readonly controlApplied: boolean;
}

function multisetDelta(
  original: ReadonlyMap<string, number>,
  rewrite: ReadonlyMap<string, number>,
): UnitDelta {
  let total = 0;
  let missing = 0;
  let extra = 0;
  for (const [unit, count] of original) {
    total += count;
    missing += Math.max(0, count - (rewrite.get(unit) ?? 0));
  }
  for (const [unit, count] of rewrite) {
    extra += Math.max(0, count - (original.get(unit) ?? 0));
  }
  return { original: total, missing, extra };
}

const NO_UNITS: ReadonlyMap<string, number> = new Map();

function unitDeltas(
  original: ContentProjection,
  rewrite: ContentProjection,
): Map<ProjectionCategory, UnitDelta> {
  const deltas = new Map<ProjectionCategory, UnitDelta>();
  const categories = new Set([
    ...original.units.keys(),
    ...rewrite.units.keys(),
  ]);
  for (const category of categories) {
    deltas.set(
      category,
      multisetDelta(
        original.units.get(category) ?? NO_UNITS,
        rewrite.units.get(category) ?? NO_UNITS,
      ),
    );
  }
  return deltas;
}

function censusDeltas(
  original: ContentProjection,
  rewrite: ContentProjection,
): Map<string, FamilyDelta> {
  const deltas = new Map<string, FamilyDelta>();
  const categories = new Set([
    ...original.census.keys(),
    ...rewrite.census.keys(),
  ]);
  for (const category of categories) {
    const before = original.census.get(category) ?? NO_UNITS;
    const after = rewrite.census.get(category) ?? NO_UNITS;
    for (const family of new Set([...before.keys(), ...after.keys()])) {
      const delta = {
        original: before.get(family) ?? 0,
        rewrite: after.get(family) ?? 0,
      };
      if (delta.original !== delta.rewrite) {
        deltas.set(`${category}:${family}`, delta);
      }
    }
  }
  return deltas;
}

function mediaKind(entry: string): string {
  return entry.slice(0, entry.indexOf(":"));
}

function mediaDelta(
  original: ContentProjection,
  rewrite: ContentProjection,
): MediaDelta {
  const unmatchedOriginal = new Map<string, number>();
  const unmatchedRewrite = new Map<string, number>();
  let total = 0;
  for (const [entry, count] of original.media) {
    total += count;
    const left = count - Math.min(count, rewrite.media.get(entry) ?? 0);
    unmatchedOriginal.set(
      mediaKind(entry),
      (unmatchedOriginal.get(mediaKind(entry)) ?? 0) + left,
    );
  }
  for (const [entry, count] of rewrite.media) {
    const left = count - Math.min(count, original.media.get(entry) ?? 0);
    unmatchedRewrite.set(
      mediaKind(entry),
      (unmatchedRewrite.get(mediaKind(entry)) ?? 0) + left,
    );
  }
  let missing = 0;
  let reencoded = 0;
  let extra = 0;
  for (const kind of new Set([
    ...unmatchedOriginal.keys(),
    ...unmatchedRewrite.keys(),
  ])) {
    const before = unmatchedOriginal.get(kind) ?? 0;
    const after = unmatchedRewrite.get(kind) ?? 0;
    const paired = Math.min(before, after);
    reencoded += paired;
    missing += before - paired;
    extra += after - paired;
  }
  return { original: total, missing, reencoded, extra };
}

function cellDelta(
  original: ContentProjection,
  rewrite: ContentProjection,
): CellDelta | undefined {
  if (original.format !== "xlsx") {
    return undefined;
  }
  let missing = 0;
  let valueDiffer = 0;
  let formulaLost = 0;
  let formulaDiffer = 0;
  for (const [key, before] of original.cells) {
    const after = rewrite.cells.get(key);
    if (after === undefined) {
      missing += 1;
      continue;
    }
    if (before.value !== after.value) {
      valueDiffer += 1;
    }
    if (before.formula !== undefined) {
      if (after.formula === undefined) {
        formulaLost += 1;
      } else if (
        before.formula !== after.formula &&
        before.formula !== SHARED_FORMULA &&
        after.formula !== SHARED_FORMULA
      ) {
        formulaDiffer += 1;
      }
    }
  }
  return {
    original: original.cells.size,
    missing,
    extra: rewrite.cells.size - (original.cells.size - missing),
    valueDiffer,
    formulaLost,
    formulaDiffer,
  };
}

interface RawDeltas {
  readonly units: Map<ProjectionCategory, UnitDelta>;
  readonly census: Map<string, FamilyDelta>;
  readonly media: MediaDelta;
  readonly cells: CellDelta | undefined;
}

function rawDeltas(
  original: ContentProjection,
  rewrite: ContentProjection,
): RawDeltas {
  return {
    units: unitDeltas(original, rewrite),
    census: censusDeltas(original, rewrite),
    media: mediaDelta(original, rewrite),
    cells: cellDelta(original, rewrite),
  };
}

/** Whether the control shows the writer losing (`shortfall`) or adding (`surplus`) content at one place. */
interface Churn {
  readonly shortfall: boolean;
  readonly surplus: boolean;
}

const STABLE: Churn = { shortfall: false, surplus: false };

/** The category a census key (`category:family`) belongs to. */
function categoryOfKey(key: string): string {
  return key.slice(0, key.indexOf(":"));
}

/**
 * Reads the control's own deltas (rewrite against its rewrite) as churn. "The same place" is the category: a category whose control shows any shortfall is unstable for every shortfall in it, units and element counts alike, because a writer that loses words from the body on a second pass is not a stable instrument for the body's paragraph count either.
 */
function churnOf(deltas: RawDeltas | undefined) {
  const forCategory = (category: string): Churn => {
    if (deltas === undefined) {
      return STABLE;
    }
    let shortfall = false;
    let surplus = false;
    for (const [name, unit] of deltas.units) {
      if (name === category) {
        shortfall ||= unit.missing > 0;
        surplus ||= unit.extra > 0;
      }
    }
    for (const [key, delta] of deltas.census) {
      if (categoryOfKey(key) === category) {
        shortfall ||= delta.rewrite < delta.original;
        surplus ||= delta.rewrite > delta.original;
      }
    }
    return { shortfall, surplus };
  };
  return {
    unit: (category: ProjectionCategory): Churn => forCategory(category),
    family: (key: string): Churn => forCategory(categoryOfKey(key)),
    media: (): Churn =>
      deltas === undefined
        ? STABLE
        : {
            shortfall: deltas.media.missing > 0,
            surplus: deltas.media.extra > 0,
          },
    cells: (): Churn =>
      deltas?.cells === undefined
        ? STABLE
        : {
            shortfall:
              deltas.cells.missing +
                deltas.cells.valueDiffer +
                deltas.cells.formulaLost +
                deltas.cells.formulaDiffer >
              0,
            surplus: deltas.cells.extra > 0,
          },
  };
}

function shortfallClass(churn: Churn, controlApplied: boolean): FindingClass {
  return controlApplied && churn.shortfall ? "unstable" : "loss";
}

function surplusClass(churn: Churn, controlApplied: boolean): FindingClass {
  return controlApplied && (churn.shortfall || churn.surplus)
    ? "writer-asymmetry"
    : "writer-addition";
}

function findingsOf(
  deltas: RawDeltas,
  control: RawDeltas | undefined,
): Finding[] {
  const applied = control !== undefined;
  const churn = churnOf(control);
  const findings: Finding[] = [];
  for (const [category, delta] of deltas.units) {
    if (delta.missing > 0) {
      findings.push({
        area: "units",
        subject: category,
        count: delta.missing,
        class: shortfallClass(churn.unit(category), applied),
      });
    }
    if (delta.extra > 0) {
      findings.push({
        area: "units",
        subject: category,
        count: delta.extra,
        class: surplusClass(churn.unit(category), applied),
      });
    }
  }
  for (const [key, delta] of deltas.census) {
    const difference = Math.abs(delta.rewrite - delta.original);
    findings.push({
      area: "census",
      subject: key,
      count: difference,
      class:
        delta.rewrite < delta.original
          ? shortfallClass(churn.family(key), applied)
          : surplusClass(churn.family(key), applied),
    });
  }
  const { media, cells } = deltas;
  if (media.missing > 0) {
    findings.push({
      area: "media",
      subject: "missing",
      count: media.missing,
      class: shortfallClass(churn.media(), applied),
    });
  }
  if (media.reencoded > 0) {
    findings.push({
      area: "media",
      subject: "reencoded",
      count: media.reencoded,
      class: "reencoded-media",
    });
  }
  if (media.extra > 0) {
    findings.push({
      area: "media",
      subject: "extra",
      count: media.extra,
      class: surplusClass(churn.media(), applied),
    });
  }
  if (cells !== undefined) {
    const measures: readonly [string, number][] = [
      ["missing", cells.missing],
      ["valueDiffer", cells.valueDiffer],
      ["formulaLost", cells.formulaLost],
      ["formulaDiffer", cells.formulaDiffer],
    ];
    for (const [subject, count] of measures) {
      if (count > 0) {
        findings.push({
          area: "cells",
          subject,
          count,
          class: shortfallClass(churn.cells(), applied),
        });
      }
    }
    if (cells.extra > 0) {
      findings.push({
        area: "cells",
        subject: "extra",
        count: cells.extra,
        class: surplusClass(churn.cells(), applied),
      });
    }
  }
  return findings;
}

function verdictOf(
  findings: readonly Finding[],
  original: ContentProjection,
  rewrite: ContentProjection,
): Verdict {
  if (findings.some((finding) => finding.class === "loss")) {
    return "loss";
  }
  if (findings.some((finding) => finding.class === "unstable")) {
    return "unstable";
  }
  if (original.skippedParts.length > 0 || rewrite.skippedParts.length > 0) {
    return "incomplete";
  }
  return findings.length > 0 ? "writer-differences" : "equivalent";
}

/**
 * Holds a rewrite to its original, projection against projection, and classifies every difference.
 *
 * `control` is the projection of the rewrite's own rewrite (read the rewrite, write it again, project that). Writing is not idempotent for every writer, so a difference between original and rewrite is only evidence of loss where the writer is stable: where rewriting the rewrite still loses content, a shortfall cannot be told from noise and is `unstable`, and where it adds or changes content, a surplus is `writer-asymmetry`. A control that agrees with the rewrite everywhere makes every shortfall a `loss`.
 *
 * The verdict is the worst finding: `loss`, then `unstable`, then `incomplete` (a part on either side could not be read, so nothing is claimed), then `writer-differences`, else `equivalent`. Differences in identifiers, properties and other metadata are not content and are reported by `comparePartDigests`, never here.
 *
 * Throws when the projections are of different formats.
 */
export function compareProjections(
  original: ContentProjection,
  rewrite: ContentProjection,
  control?: ContentProjection,
): ProjectionComparison {
  if (original.format !== rewrite.format) {
    throw new Error(
      `cannot compare a ${original.format} projection with a ${rewrite.format} one`,
    );
  }
  if (control !== undefined && control.format !== rewrite.format) {
    throw new Error(
      `the control is a ${control.format} projection, the rewrite a ${rewrite.format} one`,
    );
  }
  const deltas = rawDeltas(original, rewrite);
  const findings = findingsOf(
    deltas,
    control === undefined ? undefined : rawDeltas(rewrite, control),
  );
  return {
    format: original.format,
    units: deltas.units,
    census: deltas.census,
    media: deltas.media,
    cells: deltas.cells,
    findings,
    verdict: verdictOf(findings, original, rewrite),
    controlApplied: control !== undefined,
  };
}
