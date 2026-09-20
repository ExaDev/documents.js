// PDF text-run grouping (ExaDev/documents.js#1317): the read-side counterpart to text-layout.ts's write-side line breaking. readPdf reports what a PDF's content stream actually states, one positioned run per text-showing operator, with no notion of lines or words at all, because a PDF has none: a line of prose can arrive as one run, as one run per word, or as one run per glyph, entirely at the producer's discretion. Turning those runs back into lines and words is therefore geometry, and every consumer that wants readable text has to do it. Before this module each of them wrote its own, and two defects recur in every hand-rolled version:
//
// A "same baseline" tolerance scaled from one of the two runs alone rather than from the smaller of them. A 30pt heading and the 9pt line beneath it sit roughly 30pt apart; a tolerance of half the heading's own size is 15pt, so whichever of the two supplies it decides the outcome, and when it is the larger one the heading absorbs the line below. The runs then sort by x into one sequence whose gaps are negative, the negative gap reads as "no space needed", and the two lines concatenate into run-together text: precisely the failure the grouping exists to prevent. Taking the tolerance from the SMALLER of the two runs is the fix, and it is the right rule on its own terms too, for the same reason document-outline.js's own page-level gap threshold already takes the smaller of the two bands it separates: the finer-grained side of a boundary is the one whose scale says whether the boundary is real.
//
// An absent advance width read as zero. LayoutText.widthPt is optional (readPdf always measures one, but an item assembled by a caller or by a layout pass need not carry one), so a missing width defaulted to zero puts the previous run's end at its own start, which makes its entire advance read as a gap and inserts spaces inside words: "Com plete ly". An unknown width means the gap to the next run is unknown, and an unknown gap is no evidence of a space, so no space is what it must produce.
//
// Both rules are exported on their own (runsShareBaseline, runGapPt) as well as through the whole-pipeline groupPdfTextRuns, because a consumer with its own pipeline around them (documents.js's reconstruction interleaves duplicate-paint collapsing with its clustering) needs the rules without the pipeline.

// The structural minimum this module needs from a positioned text run. LayoutText satisfies it, and so does any other shape carrying the same five facts, so a caller grouping its own runs does not have to build LayoutText values to do it.
export interface PdfTextRunGeometry {
  readonly text: string;
  readonly xPt: number; // page-space origin of the run's first glyph
  readonly yPt: number; // page-space baseline of that glyph
  readonly sizePt: number;
  readonly widthPt?: number; // advance along the baseline; absent means the producer did not state one, never zero
  readonly rotationDeg?: number; // baseline direction, anticlockwise from the page's x-axis; absent means zero
}

// A text box whose origin is page space and whose extents are measured in the line's own baseline frame: widthPt along the baseline, heightPt perpendicular to it, from the baseline upward. For an unrotated line (rotationDeg 0, the overwhelmingly common case) that is an ordinary axis-aligned page-space box. For a rotated one, a consumer that wants a page-space polygon rotates the box's own corners about (xPt, yPt) by the line's rotationDeg.
export interface PdfTextBox {
  readonly xPt: number;
  readonly yPt: number;
  readonly widthPt: number;
  readonly heightPt: number;
}

// What the geometry between a word and the one before it says the reader should see: nothing at all (the same word continuing across a style change or a kerning adjustment), an ordinary word space, or a separation wide enough that the two sides belong to different columns of a table or a tab-aligned layout rather than to one sentence.
export type PdfWordSeparator = "none" | "space" | "column";

export interface PdfTextWord<TRun extends PdfTextRunGeometry> {
  readonly text: string;
  readonly separatorBefore: PdfWordSeparator; // always "none" for a line's first word
  readonly runs: readonly TRun[]; // the runs this word's text came from, in reading order; more than one when a word is split across runs by a style change
  // Present only when this word is exactly the whole text of runs that each stated an advance width. A word carved out of one run's own text (a producer that showed a whole line in a single operator) has no geometry of its own: the run states where it starts and how far it advances in total, not where each of its words sits inside that advance.
  readonly bounds?: PdfTextBox;
}

export interface PdfTextLine<TRun extends PdfTextRunGeometry> {
  // The line's words joined by what each separator means literally: "" for none, a space for space, a tab for column. A consumer wanting a different rendering of a column boundary walks `words` instead.
  readonly text: string;
  readonly words: readonly PdfTextWord<TRun>[];
  readonly baselineYPt: number; // the baseline of the run that opened the line, in the line's own frame (page-space y for an unrotated line)
  readonly rotationDeg: number; // normalised into [0, 360)
  readonly bounds?: PdfTextBox; // present only when every run on the line stated an advance width
}

export interface PdfTextGroupingOptions {
  readonly baselineToleranceEm?: number;
  readonly wordGapEm?: number;
  readonly columnGapEm?: number;
}

// Two runs share a baseline when their baselines sit within this fraction of an em of each other, measured against the SMALLER of the two runs. The interval this has to land in is bounded on both sides by real typography. Above: two consecutive lines are never closer than solid setting puts them, leading equal to the font size, one full em, so the fraction must stay below 1 or two lines of the same size can merge. Below: a superscript is raised by at most a third of its parent's size and is set at no less than half that size, so its baseline shift is at most (1/3)/(1/2) of its own em, and a fraction under two thirds starts cutting footnote markers off the line they annotate. Two thirds is the tightest value that admits every such superscript, and the tight end of the interval is the right end to sit at: splitting one line into two loses nothing a consumer cannot rejoin, while merging two lines produces run-together text that nothing downstream can undo.
export const DEFAULT_BASELINE_TOLERANCE_EM = 2 / 3;

// A gap at least this wide, in em of the smaller of the two runs, is a word space. The standard fourteen PDF faces set their space glyph at 250/1000 em, and justified setting compresses word spacing to no less than half its nominal width, so the narrowest genuine inter-word gap is an eighth of an em. Anything below that is a kerning adjustment or positioning noise inside one word.
export const DEFAULT_WORD_GAP_EM = 1 / 8;

// A gap wider than this many em of the smaller of the two runs is a column boundary rather than a word space. The widest single space character typography has is the em space, exactly one em, so a gap wider than that was produced by positioning rather than by a space, and the two sides are separated deliberately: a table's columns, or a tab-aligned label and its value. Keeping the threshold at the em space rather than some multiple of it is what stops a table's own columns being read as one running sentence, which is the whole reason a consumer asks where the columns are.
export const DEFAULT_COLUMN_GAP_EM = 1;

// Rotations are derived from a text rendering matrix through atan2, so two runs set at one angle can report it with a difference in the last bits of a double. Rounding to this many degrees removes that noise without ever merging two angles a producer meant to differ, being some seven orders of magnitude below the smallest angular difference any real layout expresses.
const ROTATION_NOISE_DEG = 1e-6;

const DEGREES_PER_TURN = 360;

interface Projected<TRun extends PdfTextRunGeometry> {
  readonly run: TRun;
  readonly alongPt: number; // position along the baseline direction
  readonly acrossPt: number; // position perpendicular to it, increasing away from the descender side
  readonly sizePt: number;
}

function normaliseRotationDeg(rotationDeg: number | undefined): number {
  const raw = rotationDeg ?? 0;
  const rounded = Math.round(raw / ROTATION_NOISE_DEG) * ROTATION_NOISE_DEG;
  return ((rounded % DEGREES_PER_TURN) + DEGREES_PER_TURN) % DEGREES_PER_TURN;
}

const RADIANS_PER_TURN = 2 * Math.PI;

// The unit vector a baseline at this angle runs along. Its perpendicular, pointing away from the descender side, is (-sin, cos).
function baselineAxis(rotationDeg: number): { cos: number; sin: number } {
  const radians = (rotationDeg * RADIANS_PER_TURN) / DEGREES_PER_TURN;
  return { cos: Math.cos(radians), sin: Math.sin(radians) };
}

// The run's origin resolved into the frame its own baseline defines: alongPt runs with the text, acrossPt across it. At zero rotation this is exactly (xPt, yPt), so the unrotated case pays nothing for the general one and needs no branch of its own.
function project<TRun extends PdfTextRunGeometry>(
  run: TRun,
  rotationDeg: number,
): Projected<TRun> {
  const { cos, sin } = baselineAxis(rotationDeg);
  return {
    run,
    alongPt: run.xPt * cos + run.yPt * sin,
    acrossPt: run.yPt * cos - run.xPt * sin,
    sizePt: run.sizePt,
  };
}

// The inverse of project: a point given in the line's own frame, back in page space.
function unproject(
  alongPt: number,
  acrossPt: number,
  rotationDeg: number,
): { xPt: number; yPt: number } {
  const { cos, sin } = baselineAxis(rotationDeg);
  return {
    xPt: alongPt * cos - acrossPt * sin,
    yPt: alongPt * sin + acrossPt * cos,
  };
}

/**
 * Whether two positioned runs sit on one visual line.
 *
 * The tolerance is a fraction of an em of the smaller of the two runs, never of one nominated run, so a large heading can never claim the small line beneath it. Runs set at different angles never share a line.
 * @param a - one run
 * @param b - the other run
 * @param options - only `baselineToleranceEm` is read; it defaults to {@link DEFAULT_BASELINE_TOLERANCE_EM}
 * @returns true when the two baselines are within tolerance of each other
 */
export function runsShareBaseline(
  a: PdfTextRunGeometry,
  b: PdfTextRunGeometry,
  options: PdfTextGroupingOptions = {},
): boolean {
  const separation = baselineSeparation(
    a,
    b,
    options.baselineToleranceEm ?? DEFAULT_BASELINE_TOLERANCE_EM,
  );
  return separation?.withinTolerance === true;
}

// How far apart two runs' baselines are, and whether that clears the tolerance the smaller of them sets, or undefined when the two are set at different angles and so share no axis to measure across. One derivation serving both the exported predicate and the clustering below, so the rule the caller can test with is literally the rule the grouping applies.
function baselineSeparation(
  a: PdfTextRunGeometry,
  b: PdfTextRunGeometry,
  toleranceEm: number,
): { distancePt: number; withinTolerance: boolean } | undefined {
  const rotationDeg = normaliseRotationDeg(a.rotationDeg);
  if (rotationDeg !== normaliseRotationDeg(b.rotationDeg)) {
    return undefined;
  }
  const distancePt = Math.abs(
    project(a, rotationDeg).acrossPt - project(b, rotationDeg).acrossPt,
  );
  return {
    distancePt,
    withinTolerance: distancePt <= toleranceEm * Math.min(a.sizePt, b.sizePt),
  };
}

/**
 * The horizontal gap along the baseline between the end of `previous` and the start of `next`, or undefined when the geometry does not state one.
 *
 * Undefined has exactly two causes, and a caller must treat both as "no evidence of a space" rather than substituting zero: `previous` stated no advance width, so where it ends is unknown; or the two runs are set at different angles, so they share no axis to measure along. A negative result is real and means the two runs overlap.
 * @param previous - the run to the left, in reading order
 * @param next - the run that follows it
 * @returns the gap in points, or undefined when it cannot be derived
 */
export function runGapPt(
  previous: PdfTextRunGeometry,
  next: PdfTextRunGeometry,
): number | undefined {
  const rotationDeg = normaliseRotationDeg(previous.rotationDeg);
  if (rotationDeg !== normaliseRotationDeg(next.rotationDeg)) {
    return undefined;
  }
  const previousWidthPt = previous.widthPt;
  if (previousWidthPt === undefined) {
    return undefined;
  }
  return (
    project(next, rotationDeg).alongPt -
    (project(previous, rotationDeg).alongPt + previousWidthPt)
  );
}

interface WorkingLine<TRun extends PdfTextRunGeometry> {
  readonly anchor: Projected<TRun>; // the run that opened the line; its baseline is the line's, and its size is the one every later candidate's tolerance is taken against
  readonly entries: Projected<TRun>[];
}

// Greedy baseline clustering: each run joins the open line whose baseline is nearest to it among those it shares a baseline with, and opens a new one when there is none. Nearest rather than first-found, so a run falling between two lines joins the one it is actually closer to instead of whichever the iteration order reached first.
function clusterIntoLines<TRun extends PdfTextRunGeometry>(
  entries: readonly Projected<TRun>[],
  toleranceEm: number,
): WorkingLine<TRun>[] {
  const lines: WorkingLine<TRun>[] = [];
  for (const entry of entries) {
    let best: WorkingLine<TRun> | undefined;
    let bestDistancePt = Number.POSITIVE_INFINITY;
    for (const line of lines) {
      const separation = baselineSeparation(
        line.anchor.run,
        entry.run,
        toleranceEm,
      );
      if (
        separation !== undefined &&
        separation.withinTolerance &&
        separation.distancePt < bestDistancePt
      ) {
        best = line;
        bestDistancePt = separation.distancePt;
      }
    }
    if (best === undefined) {
      lines.push({ anchor: entry, entries: [entry] });
    } else {
      best.entries.push(entry);
    }
  }
  return lines;
}

interface RunTokens {
  readonly words: readonly string[];
  readonly leadingSpace: boolean;
  readonly trailingSpace: boolean;
  readonly whole: boolean; // the run's entire text is exactly one word, so that word can carry the run's own geometry
}

// A run's own text can hold any number of words: a producer is free to show a whole line in one operator, spaces included. Splitting on literal whitespace is the only way to recover those, and a space a run's text states is a space regardless of what the geometry between runs says.
function tokeniseRun(text: string): RunTokens {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const leadingSpace = /^\s/.test(text);
  const trailingSpace = /\s$/.test(text);
  return {
    words,
    leadingSpace,
    trailingSpace,
    whole: words.length === 1 && !leadingSpace && !trailingSpace,
  };
}

interface MutableWord<TRun extends PdfTextRunGeometry> {
  text: string;
  readonly separatorBefore: PdfWordSeparator;
  readonly runs: TRun[];
  // Geometry is carried only while every run that has contributed to this word gave its whole text to it and stated a width; the moment one does not, the word has no derivable extent and drops it for good.
  measurable: boolean;
  minAlongPt: number;
  maxAlongEndPt: number;
  maxSizePt: number;
}

const SEPARATOR_TEXT: Readonly<Record<PdfWordSeparator, string>> = {
  none: "",
  space: " ",
  column: "\t",
};

function separatorForGap(
  gapPt: number | undefined,
  smallerSizePt: number,
  wordGapEm: number,
  columnGapEm: number,
): PdfWordSeparator {
  if (gapPt === undefined) {
    return "none";
  }
  if (gapPt >= columnGapEm * smallerSizePt) {
    return "column";
  }
  if (gapPt >= wordGapEm * smallerSizePt) {
    return "space";
  }
  return "none";
}

function boundsOf(
  minAlongPt: number,
  maxAlongEndPt: number,
  acrossPt: number,
  maxSizePt: number,
  rotationDeg: number,
): PdfTextBox {
  const origin = unproject(minAlongPt, acrossPt, rotationDeg);
  return {
    xPt: origin.xPt,
    yPt: origin.yPt,
    widthPt: maxAlongEndPt - minAlongPt,
    heightPt: maxSizePt,
  };
}

function buildWords<TRun extends PdfTextRunGeometry>(
  line: WorkingLine<TRun>,
  rotationDeg: number,
  wordGapEm: number,
  columnGapEm: number,
): PdfTextWord<TRun>[] {
  const working: MutableWord<TRun>[] = [];
  let previous: Projected<TRun> | undefined;
  let pendingSpace = false;

  for (const entry of line.entries) {
    const tokens = tokeniseRun(entry.run.text);
    const gapSeparator =
      previous === undefined
        ? "none"
        : separatorForGap(
            runGapPt(previous.run, entry.run),
            Math.min(previous.sizePt, entry.sizePt),
            wordGapEm,
            columnGapEm,
          );
    // A line never opens with a separator: whatever a leading whitespace-only run or a left margin puts in front of the first word is not something a reader sees. Past that, a space either side of the boundary is still a space, since whitespace the runs' own text states cannot be overridden by geometry that happens to read as none, and a column boundary is the stronger claim of the two and survives either way.
    let separator: PdfWordSeparator = "none";
    if (working.length > 0) {
      separator =
        gapSeparator === "none" && (pendingSpace || tokens.leadingSpace)
          ? "space"
          : gapSeparator;
    }

    const widthPt = entry.run.widthPt;
    const alongEndPt = entry.alongPt + (widthPt ?? 0);
    tokens.words.forEach((word, index) => {
      const last = working[working.length - 1];
      if (index === 0 && separator === "none" && last !== undefined) {
        last.text += word;
        last.runs.push(entry.run);
        last.measurable =
          last.measurable && tokens.whole && widthPt !== undefined;
        last.minAlongPt = Math.min(last.minAlongPt, entry.alongPt);
        last.maxAlongEndPt = Math.max(last.maxAlongEndPt, alongEndPt);
        last.maxSizePt = Math.max(last.maxSizePt, entry.sizePt);
        return;
      }
      working.push({
        text: word,
        separatorBefore: index === 0 ? separator : "space",
        runs: [entry.run],
        measurable: tokens.whole && widthPt !== undefined,
        minAlongPt: entry.alongPt,
        maxAlongEndPt: alongEndPt,
        maxSizePt: entry.sizePt,
      });
    });

    // A run that contributed no word of its own leaves any space already pending in place; one that did resets it, so only its own trailing whitespace can carry forward.
    pendingSpace =
      tokens.trailingSpace || (tokens.words.length === 0 && pendingSpace);
    previous = entry;
  }

  return working.map((word) => ({
    text: word.text,
    separatorBefore: word.separatorBefore,
    runs: word.runs,
    ...(word.measurable
      ? {
          bounds: boundsOf(
            word.minAlongPt,
            word.maxAlongEndPt,
            line.anchor.acrossPt,
            word.maxSizePt,
            rotationDeg,
          ),
        }
      : {}),
  }));
}

function buildLine<TRun extends PdfTextRunGeometry>(
  line: WorkingLine<TRun>,
  rotationDeg: number,
  wordGapEm: number,
  columnGapEm: number,
): PdfTextLine<TRun> {
  const words = buildWords(line, rotationDeg, wordGapEm, columnGapEm);
  const text = words
    .map((word) => SEPARATOR_TEXT[word.separatorBefore] + word.text)
    .join("");
  let minAlongPt = Number.POSITIVE_INFINITY;
  let maxAlongEndPt = Number.NEGATIVE_INFINITY;
  let maxSizePt = 0;
  let measurable = true;
  for (const entry of line.entries) {
    const widthPt = entry.run.widthPt;
    if (widthPt === undefined) {
      measurable = false;
    }
    minAlongPt = Math.min(minAlongPt, entry.alongPt);
    maxAlongEndPt = Math.max(maxAlongEndPt, entry.alongPt + (widthPt ?? 0));
    maxSizePt = Math.max(maxSizePt, entry.sizePt);
  }
  return {
    text,
    words,
    baselineYPt: line.anchor.acrossPt,
    rotationDeg,
    ...(measurable
      ? {
          bounds: boundsOf(
            minAlongPt,
            maxAlongEndPt,
            line.anchor.acrossPt,
            maxSizePt,
            rotationDeg,
          ),
        }
      : {}),
  };
}

/**
 * Groups positioned PDF text runs into lines of words.
 *
 * Runs are grouped by baseline into lines, ordered down the page, and each line's runs are ordered along the baseline and split into words wherever the geometry between them, or the whitespace their own text carries, says a word ends. A gap wider than a full em of the smaller of the two runs is reported as a column boundary rather than a word space, so a table's columns stay distinct instead of reading as one sentence.
 *
 * Runs set at different angles are never grouped together: each angle is grouped in its own frame and reported as its own block of lines, unrotated text first and the remaining angles in ascending order. No attempt is made to interleave rotated text into the reading order of the unrotated text around it, because a page's geometry alone does not say where a rotated block belongs in that order.
 *
 * Grouping is by baseline alone, with no page segmentation: on a multi-column page whose columns are set at different vertical offsets, a line of one column can fall within tolerance of a line of the next and the two are reported as one line, because from geometry alone at this level that is what they are. The gutter between them still reads as a column boundary, so the separator says where to cut. A caller that needs the columns apart segments the page first, which is what document-outline.js's `segmentPdfRegions` is for, and groups each region's own runs.
 *
 * Known limitations, all of them inherent to what a PDF states rather than to this implementation. Text is reported in visual order, left to right along the baseline: a right-to-left script arrives from the content stream already laid out visually and carries no direction of its own, so a consumer needing logical order applies the Unicode Bidi Algorithm to the result. Vertical writing modes are not recognised, because this package's content interpreter does not read a CMap's WMode and so reports vertically set text with horizontal advances. A word hyphenated across a line end is left split, with its hyphen intact, because rejoining it needs to know the two lines belong to one paragraph, which is a semantic judgement this package deliberately leaves to its consumers. Runs with empty text are dropped, and so are the empty words a whitespace-only run would otherwise produce, but no other normalisation of the decoded text is attempted: a ligature and a zero-width character each reach the output exactly as the font's ToUnicode mapping spelled them.
 * @param runs - positioned text runs, in any order
 * @param options - tolerance overrides; each defaults to the exported constant of the same name
 * @returns the grouped lines, in reading order
 */
export function groupPdfTextRuns<TRun extends PdfTextRunGeometry>(
  runs: readonly TRun[],
  options: PdfTextGroupingOptions = {},
): PdfTextLine<TRun>[] {
  const toleranceEm =
    options.baselineToleranceEm ?? DEFAULT_BASELINE_TOLERANCE_EM;
  const wordGapEm = options.wordGapEm ?? DEFAULT_WORD_GAP_EM;
  const columnGapEm = options.columnGapEm ?? DEFAULT_COLUMN_GAP_EM;

  const byRotation = new Map<number, TRun[]>();
  for (const run of runs) {
    if (run.text.length === 0) {
      continue;
    }
    const rotationDeg = normaliseRotationDeg(run.rotationDeg);
    const bucket = byRotation.get(rotationDeg);
    if (bucket === undefined) {
      byRotation.set(rotationDeg, [run]);
    } else {
      bucket.push(run);
    }
  }

  const result: PdfTextLine<TRun>[] = [];
  for (const rotationDeg of [...byRotation.keys()].sort((a, b) => a - b)) {
    const bucket = byRotation.get(rotationDeg) ?? [];
    const entries = bucket
      .map((run) => project(run, rotationDeg))
      // Down the page first (acrossPt decreases downward in every frame, since the perpendicular axis points away from the descender side), then along the baseline, so clustering meets a line's runs before any run of the line below it.
      .sort((a, b) => b.acrossPt - a.acrossPt || a.alongPt - b.alongPt);
    for (const line of clusterIntoLines(entries, toleranceEm)) {
      line.entries.sort((a, b) => a.alongPt - b.alongPt);
      result.push(buildLine(line, rotationDeg, wordGapEm, columnGapEm));
    }
  }
  return result;
}
