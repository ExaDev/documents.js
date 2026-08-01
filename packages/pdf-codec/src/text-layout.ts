import type { Color as LayoutColor } from 'document-content-model';
import type { LayoutFont } from 'document-content-model';
import type { TextMeasurer } from './measure';

export interface StyledRun {
  readonly text: string;
  readonly font: LayoutFont;
  readonly sizePt: number;
  readonly color: LayoutColor;
  readonly underline?: boolean;
  // An external URI, carried through atomisation/wrapping unchanged so a caller (src/layout/slides.ts) can emit a LayoutLink covering each wrapped fragment's own position -- text-layout.ts itself never interprets this, purely a pass-through field.
  readonly hyperlink?: string;
  // The originating ContentRun's own sourcePath (see document-content-model), carried through atomisation/wrapping unchanged so a caller can stamp it onto every LayoutText/LayoutLink fragment this run produces -- text-layout.ts itself never interprets this, purely a pass-through field. When one run's word is split across a line-wrap boundary or an emergency character-level split, every resulting fragment keeps this same value: the path identifies the source run, not the specific wrapped piece.
  readonly sourcePath?: string;
}

export interface StyledFragment {
  readonly text: string;
  readonly font: LayoutFont;
  readonly sizePt: number;
  readonly color: LayoutColor;
  readonly underline?: boolean;
  readonly hyperlink?: string;
  readonly sourcePath?: string;
}

export interface WrappedLine {
  readonly fragments: readonly (StyledFragment & { readonly xOffsetPt: number })[];
  readonly widthPt: number;
  readonly maxSizePt: number;
  readonly ascentPt: number;
  readonly descentPt: number; // negative, per AFM convention
}

interface BoxAtom {
  readonly kind: 'box';
  readonly fragments: readonly StyledFragment[];
  readonly widthPt: number;
}
interface GlueAtom {
  readonly kind: 'glue';
  readonly widthPt: number;
}
interface BreakAtom {
  readonly kind: 'break';
  readonly widthPt: 0;
}
type Atom = BoxAtom | GlueAtom | BreakAtom;

const WORD_OR_WHITESPACE_PATTERN = /\n|\s+|\S+/g;

// Splits `runs` into word-shaped "box" atoms, "glue" (space) atoms, and explicit line-"break" atoms. Critically, atomisation happens *across run boundaries*: a word split by a formatting change (e.g. "hel" in a plain run immediately followed by "lo" in a bold run) becomes a single box atom carrying both styled fragments, so it can never be broken apart -- only between boxes, and boxes are word-shaped regardless of how the source text was split across runs.
function atomizeRuns(runs: readonly StyledRun[], measurer: TextMeasurer): Atom[] {
  const atoms: Atom[] = [];
  let wordFragments: StyledFragment[] = [];
  let wordWidth = 0;

  function flushWord(): void {
    if (wordFragments.length > 0) {
      atoms.push({ kind: 'box', fragments: wordFragments, widthPt: wordWidth });
      wordFragments = [];
      wordWidth = 0;
    }
  }

  for (const run of runs) {
    const tokens = run.text.match(WORD_OR_WHITESPACE_PATTERN) ?? [];
    for (const token of tokens) {
      if (token === '\n') {
        flushWord();
        atoms.push({ kind: 'break', widthPt: 0 });
      } else if (/^\s+$/.test(token)) {
        flushWord();
        atoms.push({ kind: 'glue', widthPt: measurer.widthOfTextAtSize(token, run.font, run.sizePt) });
      } else {
        wordFragments.push({ text: token, font: run.font, sizePt: run.sizePt, color: run.color, underline: run.underline, hyperlink: run.hyperlink, sourcePath: run.sourcePath });
        wordWidth += measurer.widthOfTextAtSize(token, run.font, run.sizePt);
      }
    }
  }
  flushWord();
  return atoms;
}

function fragmentsWidth(fragments: readonly StyledFragment[], measurer: TextMeasurer): number {
  let total = 0;
  for (const f of fragments) {
    total += measurer.widthOfTextAtSize(f.text, f.font, f.sizePt);
  }
  return total;
}

// Splits `text` at the largest character prefix that fits within `maxWidthPt`, guaranteeing at least one character of progress (so an emergency split of a single, over-long word can never spin forever even in a pathologically narrow column).
function splitTextToWidth(text: string, font: LayoutFont, sizePt: number, measurer: TextMeasurer, maxWidthPt: number): { fitText: string; restText: string } {
  const chars = Array.from(text);
  let width = 0;
  let splitIndex = 0;
  for (let i = 0; i < chars.length; i++) {
    const charWidth = measurer.widthOfTextAtSize(chars[i]!, font, sizePt);
    if (width + charWidth > maxWidthPt && splitIndex > 0) {
      break;
    }
    width += charWidth;
    splitIndex = i + 1;
  }
  if (splitIndex === 0 && chars.length > 0) {
    splitIndex = 1;
  }
  return { fitText: chars.slice(0, splitIndex).join(''), restText: chars.slice(splitIndex).join('') };
}

// Splits a box atom that alone exceeds maxWidthPt into a `fit` part (placed on the current line) and an optional `rest` part (requeued for the next line), splitting only within the one fragment where the width budget runs out.
function splitBoxToWidth(atom: BoxAtom, measurer: TextMeasurer, maxWidthPt: number): { fit: BoxAtom; rest: BoxAtom | undefined } {
  const fitFragments: StyledFragment[] = [];
  let fitWidth = 0;
  for (let idx = 0; idx < atom.fragments.length; idx++) {
    const fragment = atom.fragments[idx]!;
    const fragmentWidth = measurer.widthOfTextAtSize(fragment.text, fragment.font, fragment.sizePt);
    if (fitWidth + fragmentWidth <= maxWidthPt) {
      fitFragments.push(fragment);
      fitWidth += fragmentWidth;
      continue;
    }
    const { fitText, restText } = splitTextToWidth(fragment.text, fragment.font, fragment.sizePt, measurer, maxWidthPt - fitWidth);
    if (fitText.length > 0) {
      fitFragments.push({ ...fragment, text: fitText });
    }
    const restFragments: StyledFragment[] = [];
    if (restText.length > 0) {
      restFragments.push({ ...fragment, text: restText });
    }
    restFragments.push(...atom.fragments.slice(idx + 1));
    if (restFragments.length === 0) {
      return { fit: { kind: 'box', fragments: fitFragments, widthPt: fragmentsWidth(fitFragments, measurer) }, rest: undefined };
    }
    return {
      fit: { kind: 'box', fragments: fitFragments, widthPt: fragmentsWidth(fitFragments, measurer) },
      rest: { kind: 'box', fragments: restFragments, widthPt: fragmentsWidth(restFragments, measurer) },
    };
  }
  return { fit: atom, rest: undefined };
}

function buildLine(atoms: readonly Atom[], measurer: TextMeasurer): WrappedLine {
  const fragments: (StyledFragment & { xOffsetPt: number })[] = [];
  let xOffsetPt = 0;
  let maxSizePt = 0;
  let ascentPt = 0;
  let descentPt = 0;
  for (const atom of atoms) {
    if (atom.kind === 'box') {
      for (const fragment of atom.fragments) {
        fragments.push({ ...fragment, xOffsetPt });
        xOffsetPt += measurer.widthOfTextAtSize(fragment.text, fragment.font, fragment.sizePt);
        maxSizePt = Math.max(maxSizePt, fragment.sizePt);
        ascentPt = Math.max(ascentPt, measurer.ascenderAtSize(fragment.font, fragment.sizePt));
        descentPt = Math.min(descentPt, measurer.descenderAtSize(fragment.font, fragment.sizePt));
      }
    } else {
      xOffsetPt += atom.widthPt;
    }
  }
  return { fragments, widthPt: xOffsetPt, maxSizePt, ascentPt, descentPt };
}

// Empty-paragraph or forced-break case: the line has no content but still needs a plausible height, derived from whatever run supplied the paragraph's own (possibly empty) run list.
function buildEmptyLine(runs: readonly StyledRun[], measurer: TextMeasurer): WrappedLine {
  const first = runs[0];
  if (first === undefined) {
    return { fragments: [], widthPt: 0, maxSizePt: 0, ascentPt: 0, descentPt: 0 };
  }
  return {
    fragments: [],
    widthPt: 0,
    maxSizePt: first.sizePt,
    ascentPt: measurer.ascenderAtSize(first.font, first.sizePt),
    descentPt: measurer.descenderAtSize(first.font, first.sizePt),
  };
}

export interface WrapOptions {
  readonly breakLongWords?: boolean;
}

// Greedy first-fit line breaking over word-shaped atoms -- the same algorithm Word itself uses (an optimal-fit breaker like Knuth-Plass would produce different, not merely better, line breaks, which is the opposite of matching Word's own output). Never breaks inside a word, regardless of how many runs it spans; an over-long single word is emergency-split at the character level, always making at least one character of progress.
export function wrapRunsToWidth(runs: readonly StyledRun[], measurer: TextMeasurer, maxWidthPt: number, options: WrapOptions = {}): WrappedLine[] {
  const breakLongWords = options.breakLongWords ?? true;

  if (maxWidthPt <= 0) {
    // Guards against an infinite loop when placeholder geometry resolution fails upstream (e.g. a shape with zero content width) -- return one unwrapped line rather than looping forever.
    const atoms = atomizeRuns(runs, measurer).filter((a): a is BoxAtom | GlueAtom => a.kind !== 'break');
    return atoms.length === 0 ? [buildEmptyLine(runs, measurer)] : [buildLine(atoms, measurer)];
  }

  const queue = atomizeRuns(runs, measurer);
  const lines: WrappedLine[] = [];
  let current: Atom[] = [];
  let currentWidth = 0;

  function pushLine(): void {
    while (current.length > 0 && current[current.length - 1]?.kind === 'glue') {
      const removed = current.pop();
      currentWidth -= removed?.widthPt ?? 0;
    }
    lines.push(current.length === 0 ? buildEmptyLine(runs, measurer) : buildLine(current, measurer));
    current = [];
    currentWidth = 0;
  }

  let i = 0;
  while (i < queue.length) {
    const atom = queue[i]!;
    if (atom.kind === 'break') {
      pushLine();
      i++;
      continue;
    }
    if (currentWidth + atom.widthPt <= maxWidthPt) {
      current.push(atom);
      currentWidth += atom.widthPt;
      i++;
      continue;
    }
    if (current.length > 0) {
      // Doesn't fit what's already on the line -- start a new line and re-attempt this same atom.
      pushLine();
      continue;
    }
    // The atom alone doesn't fit an empty line.
    if (atom.kind === 'box' && breakLongWords) {
      const { fit, rest } = splitBoxToWidth(atom, measurer, maxWidthPt);
      current.push(fit);
      currentWidth += fit.widthPt;
      if (rest === undefined) {
        i++;
      } else {
        queue[i] = rest;
      }
      pushLine();
      continue;
    }
    // Splitting disallowed, or a glue atom alone wider than the column: place it anyway to guarantee forward progress rather than looping.
    current.push(atom);
    currentWidth += atom.widthPt;
    i++;
    pushLine();
  }
  if (current.length > 0 || lines.length === 0) {
    pushLine();
  }
  return lines;
}

// A single-style convenience over wrapRunsToWidth, returning just the wrapped text of each line.
export function wrapTextToWidth(text: string, font: LayoutFont, sizePt: number, color: LayoutColor, measurer: TextMeasurer, maxWidthPt: number): string[] {
  const lines = wrapRunsToWidth([{ text, font, sizePt, color }], measurer, maxWidthPt);
  return lines.map((line) => line.fragments.map((f) => f.text).join(''));
}
