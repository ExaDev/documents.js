// Stacked fractions: a numerator line, a short horizontal rule and a denominator line, read in place as `(numerator)/(denominator)` on the equation's own line.
//
// Read a line at a time, a fraction's three parts land in three places: the numerator on the equation's line, the denominator on the line below, and whatever follows the equation (its number, a trailing term) between them in reading order. What the page draws is a rule with a group of glyphs centred above it and another centred below, and that is the whole test: a horizontal line that has glyphs directly above it and glyphs directly below it, none of the rule's extent left bare beyond the glyphs by more than an em, is a fraction bar, whatever the symbols are.
//
// The overhang bound is what keeps a table's ruled line or a heading's underline from reading as a fraction: a rule drawn across a row of cells is far wider than any one cell's glyphs, and an underline has no glyphs below it, while a fraction bar is set just wider than its widest part.
//
// Each glyph run of a part is kept as the run it is and moved, so the rest of the reading still sees what it saw: a superscript stays raised on its base and a subscript stays lowered, because the whole part moves by one offset. The runs are laid end to end on the equation's line, with `(`, `)` and `/` set between them, and everything to the right of the fraction on that line moves right by the room that takes, so the equation reads in order and nothing overlaps.
import type {
  LayoutDocument,
  LayoutItem,
  LayoutLine,
  LayoutPage,
  LayoutText,
} from "pdf-codec";
import { glyphAdvancePt } from "./reading-order";

// How far below a rule a denominator's lowest glyph may sit, in the largest size of the glyphs read: a denominator's baseline is about an ascent below the rule and a subscript hangs under that, so one and a half em reaches the subscripts and stops short of the next line of an equation set below.
const BELOW_EM = 1.5;

// How far above a rule a numerator's baseline may sit, in the largest size of the glyphs read: a numerator's baseline is about a descent above the rule and a superscript stands on that, so one and a half em reaches the superscripts and stops short of the line above.
const ABOVE_EM = 1.5;

// The widest gap, in the largest size of the glyphs read, between two neighbouring runs of one part: a fraction's numerator or denominator is typeset as a unit, its operators and terms at most a space or two apart, where the cells of a table row are set columns apart.
const MAX_GAP_EM = 1;

// How far, in the largest size of the glyphs read, a part's middle may sit from the bar's: a fraction sets each part over its bar, where a line of a table cell, a heading or a paragraph set against a rule is flush to one side of it and so off its middle by half the difference in their widths.
const MAX_OFF_CENTRE_EM = 1;

// The extent of a text run along the line, to the end of its advance (the start alone when the run reports no width).
function endOf(item: LayoutText): number {
  return item.xPt + (item.widthPt ?? 0);
}

function centreOf(item: LayoutText): number {
  return (item.xPt + endOf(item)) / 2;
}

function isHorizontalRule(item: LayoutItem): item is LayoutLine {
  return (
    item.kind === "line" && item.y1Pt === item.y2Pt && item.x1Pt !== item.x2Pt
  );
}

function isText(item: LayoutItem): item is LayoutText {
  return item.kind === "text";
}

// The runs of a page that are the numerator and the denominator of the fraction `rule` is the bar of.
interface Fraction {
  readonly rule: LayoutLine;
  readonly numerator: readonly LayoutText[];
  readonly denominator: readonly LayoutText[];
}

function spanOf(runs: readonly LayoutText[]): { from: number; to: number } {
  return {
    from: Math.min(...runs.map((run) => run.xPt)),
    to: Math.max(...runs.map(endOf)),
  };
}

function ruleSpan(rule: LayoutLine): { from: number; to: number } {
  return {
    from: Math.min(rule.x1Pt, rule.x2Pt),
    to: Math.max(rule.x1Pt, rule.x2Pt),
  };
}

// Whether the gaps between neighbouring runs of `runs`, left to right, are all at most MAX_GAP_EM of `size`. A run that reports no width gives no gap to judge, so a group holding one is not tight.
function isTightGroup(runs: readonly LayoutText[], size: number): boolean {
  const ordered = runs.toSorted((a, b) => a.xPt - b.xPt);
  return ordered.every((run, index) => {
    const previous = ordered[index - 1];
    if (previous === undefined) {
      return true;
    }
    return (
      previous.widthPt !== undefined &&
      run.xPt - endOf(previous) <= MAX_GAP_EM * size
    );
  });
}

function fractionOf(
  rule: LayoutLine,
  texts: readonly LayoutText[],
): Fraction | undefined {
  const { from, to } = ruleSpan(rule);
  const under = texts.filter(
    (run) =>
      run.text.trim() !== "" &&
      run.rotationDeg === undefined &&
      centreOf(run) >= from &&
      centreOf(run) <= to,
  );
  const size = Math.max(0, ...under.map((run) => run.sizePt));
  const numerator = under.filter(
    (run) => run.yPt > rule.y1Pt && run.yPt - rule.y1Pt <= ABOVE_EM * size,
  );
  const denominator = under.filter(
    (run) => run.yPt < rule.y1Pt && rule.y1Pt - run.yPt <= BELOW_EM * size,
  );
  if (numerator.length === 0 || denominator.length === 0) {
    return undefined;
  }
  const parts = [numerator, denominator];
  const spans = parts.map(spanOf);
  const left = Math.min(...spans.map((part) => part.from));
  const right = Math.max(...spans.map((part) => part.to));
  // The rule is set just wider than its widest part: more bare rule than an em either side is a ruled line across something else.
  if (left - from > size || to - right > size) {
    return undefined;
  }
  // Each part is one tight group centred over the bar: a table's header rule has rows of cells above and below it, set apart and flush to their columns, and a heading's underline has a paragraph under it flush to the left.
  const barCentre = (from + to) / 2;
  const isFraction = parts.every(
    (part, index) =>
      isTightGroup(part, size) &&
      Math.abs(
        ((spans[index]?.from ?? 0) + (spans[index]?.to ?? 0)) / 2 - barCentre,
      ) <=
        MAX_OFF_CENTRE_EM * size,
  );
  return isFraction ? { rule, numerator, denominator } : undefined;
}

// The baseline of a part: where the runs of its largest size sit, which leaves a superscript or subscript (set smaller) out of it. The first such run along the line, so a part reads the same however its runs are ordered.
function baselineOfPart(runs: readonly LayoutText[]): number {
  const size = Math.max(...runs.map((run) => run.sizePt));
  const [first] = runs
    .filter((run) => run.sizePt === size)
    .toSorted((a, b) => a.xPt - b.xPt);
  if (first === undefined) {
    throw new Error("a part of a fraction has runs");
  }
  return first.yPt;
}

// The baseline the fraction is read on: the line the equation around it sits on. The nearest run beside the bar that shares the bar's height (its baseline at or below the rule and no more than its size above it) gives it; with none, the rule's own height.
function equationBaseline(
  fraction: Fraction,
  texts: readonly LayoutText[],
): number {
  const { rule } = fraction;
  const { from, to } = ruleSpan(rule);
  const members = new Set([...fraction.numerator, ...fraction.denominator]);
  const [nearest] = texts
    .filter(
      (run) =>
        !members.has(run) &&
        run.text.trim() !== "" &&
        run.yPt <= rule.y1Pt &&
        rule.y1Pt - run.yPt <= run.sizePt,
    )
    .toSorted(
      (a, b) =>
        Math.min(Math.abs(a.xPt - to), Math.abs(endOf(a) - from)) -
        Math.min(Math.abs(b.xPt - to), Math.abs(endOf(b) - from)),
    );
  return nearest?.yPt ?? rule.y1Pt;
}

// A part that is one letter, one number or one word, which reads as itself between the slash and its neighbours and needs no parentheses; anything with an operator or a space in it does.
const SIMPLE_TOKEN = /^[\p{L}\p{N}.,]+$/u;

// A glyph set between the parts, in the numerator's style.
function glyph(template: LayoutText, text: string, xPt: number, yPt: number) {
  return {
    ...template,
    text,
    xPt,
    yPt,
    widthPt: glyphAdvancePt(template, text),
  } satisfies LayoutText;
}

// `runs` moved so the first starts at `xPt` and the part stands on `baselinePt`, each run keeping its distance from the others along the line. A run of the part's largest size stands exactly on the baseline: a symbol such as a minus is drawn a little above it to sit on the math axis, which is not a raised run, and left that high it would break the line it belongs to in two. A smaller run keeps its offset from the part's baseline, so a superscript stays raised and a subscript lowered.
function placedPart(
  runs: readonly LayoutText[],
  xPt: number,
  baselinePt: number,
): { placed: LayoutText[]; widthPt: number } {
  const { from, to } = spanOf(runs);
  const size = Math.max(...runs.map((run) => run.sizePt));
  const dy = baselinePt - baselineOfPart(runs);
  return {
    placed: runs.map((run) => ({
      ...run,
      xPt: run.xPt - from + xPt,
      yPt: run.sizePt === size ? baselinePt : run.yPt + dy,
    })),
    widthPt: to - from,
  };
}

// The runs a fraction is read as, from `from`: `(numerator)/(denominator)`, a part that is one simple token (a letter, a number, a word) without its parentheses, and the width they take together.
function readFraction(
  fraction: Fraction,
  baselinePt: number,
  fromPt: number,
): { runs: LayoutText[]; widthPt: number } {
  const [template] = fraction.numerator.toSorted((a, b) => a.xPt - b.xPt);
  if (template === undefined) {
    throw new Error("a fraction has a numerator");
  }
  const size = Math.max(
    ...[...fraction.numerator, ...fraction.denominator].map(
      (run) => run.sizePt,
    ),
  );
  const style: LayoutText = {
    ...template,
    sizePt: size,
    font: { ...template.font, weight: "normal", style: "normal" },
  };
  const runs: LayoutText[] = [];
  let cursor = fromPt;
  const put = (text: string): void => {
    const run = glyph(style, text, cursor, baselinePt);
    runs.push(run);
    cursor += run.widthPt;
  };
  const putPart = (part: readonly LayoutText[]): void => {
    const [only] = part;
    const wrapped =
      only === undefined ||
      part.length > 1 ||
      !SIMPLE_TOKEN.test(only.text.trim());
    if (wrapped) {
      put("(");
    }
    const { placed, widthPt } = placedPart(part, cursor, baselinePt);
    runs.push(...placed);
    cursor += widthPt;
    if (wrapped) {
      put(")");
    }
  };
  putPart(fraction.numerator);
  put("/");
  putPart(fraction.denominator);
  return { runs, widthPt: cursor - fromPt };
}

// `item` moved right by `deltaPt` when it is a text run or a horizontal rule standing on the equation's line, at or to the right of `fromPt`.
function shifted(
  item: LayoutItem,
  fromPt: number,
  bandPt: { lowPt: number; highPt: number },
  deltaPt: number,
): LayoutItem {
  if (
    isText(item) &&
    item.xPt >= fromPt &&
    item.yPt >= bandPt.lowPt &&
    item.yPt <= bandPt.highPt
  ) {
    return { ...item, xPt: item.xPt + deltaPt };
  }
  if (
    isHorizontalRule(item) &&
    Math.min(item.x1Pt, item.x2Pt) >= fromPt &&
    item.y1Pt >= bandPt.lowPt &&
    item.y1Pt <= bandPt.highPt
  ) {
    return { ...item, x1Pt: item.x1Pt + deltaPt, x2Pt: item.x2Pt + deltaPt };
  }
  return item;
}

// Whether `rule` is one stroke of a table's ruling and not a fraction's bar: another horizontal rule on the page covers the same extent (a column's row rules, drawn one under each row) or abuts one of its ends (a row rule drawn in a segment per cell). A fraction's bar stands alone, and ruling is drawn in families. Two rules are the same extent, or abut, when they differ by no more than the thicker stroke of the two.
function isPartOfRuling(
  rule: LayoutLine,
  rules: readonly LayoutLine[],
): boolean {
  const { from, to } = ruleSpan(rule);
  return rules.some((other) => {
    if (other === rule) {
      return false;
    }
    const span = ruleSpan(other);
    const tolerance = Math.max(rule.widthPt, other.widthPt);
    const sameHeight = Math.abs(other.y1Pt - rule.y1Pt) <= tolerance;
    const sameExtent =
      !sameHeight &&
      Math.abs(span.from - from) <= tolerance &&
      Math.abs(span.to - to) <= tolerance;
    const abuts =
      sameHeight &&
      (Math.abs(span.from - to) <= tolerance ||
        Math.abs(span.to - from) <= tolerance);
    return sameExtent || abuts;
  });
}

function readFractionsOf(page: LayoutPage): LayoutPage {
  const claimed = new Set<LayoutText>();
  const fractions: Fraction[] = [];
  const rules = page.items.filter(isHorizontalRule);
  for (const rule of rules) {
    if (isPartOfRuling(rule, rules)) {
      continue;
    }
    const fraction = fractionOf(
      rule,
      page.items.filter(isText).filter((run) => !claimed.has(run)),
    );
    if (fraction === undefined) {
      continue;
    }
    fractions.push(fraction);
    for (const run of [...fraction.numerator, ...fraction.denominator]) {
      claimed.add(run);
    }
  }
  if (fractions.length === 0) {
    return page;
  }
  // Right to left, so the room a fraction takes is made before the fractions to its left are placed, and what was moved right for one is moved again for the next.
  let items: LayoutItem[] = [...page.items];
  for (const fraction of fractions.toSorted(
    (a, b) => ruleSpan(b.rule).from - ruleSpan(a.rule).from,
  )) {
    const members = new Set<LayoutItem>([
      fraction.rule,
      ...fraction.numerator,
      ...fraction.denominator,
    ]);
    const beside = items.filter((item) => !members.has(item));
    const baselinePt = equationBaseline(fraction, beside.filter(isText));
    const { from, to } = ruleSpan(fraction.rule);
    const read = readFraction(fraction, baselinePt, from);
    const size = Math.max(...read.runs.map((run) => run.sizePt));
    const band = {
      lowPt: baselinePt - BELOW_EM * size,
      highPt: baselinePt + ABOVE_EM * size,
    };
    const deltaPt = Math.max(0, read.widthPt - (to - from));
    items = [
      ...beside.map((item) => shifted(item, to, band, deltaPt)),
      ...read.runs,
    ];
  }
  return { ...page, items };
}

/**
 * `doc` with every stacked fraction on its pages read in place as `(numerator)/(denominator)` on the line of the equation it is in, in place of the rule and the glyphs above and below it. A rule is a fraction bar when glyphs sit directly above it and directly below it, centred within its extent, with no more bare rule beyond them than an em; a table rule, an underline or an overline is not.
 *
 * Every run of a part is kept and moved by one offset for the whole part, so a superscript stays raised and a subscript lowered. The runs on the equation's line to the right of a fraction, and any horizontal rule there, move right by the room the fraction then takes; other items on the page stay where they are. A page with no fraction is returned as the same object, and so is a document with none.
 */
export function readStackedFractions(doc: LayoutDocument): LayoutDocument {
  const pages = doc.pages.map(readFractionsOf);
  return pages.every((page, index) => page === doc.pages[index])
    ? doc
    : { ...doc, pages };
}
