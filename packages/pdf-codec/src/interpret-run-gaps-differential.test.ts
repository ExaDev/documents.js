import { describe, expect, it } from "vitest";
import type { PdfDiagnosticSink } from "./diagnostics";
import type { ExtractedItem, FontMetricsPort } from "./interpret-types";
import { interpretContentStream } from "./interpret";
import { pdfDict } from "./objects";
import type { PdfTextRunGeometry } from "./text-group";
import {
  DEFAULT_COLUMN_GAP_EM,
  DEFAULT_WORD_GAP_EM,
  groupPdfTextRuns,
} from "./text-group";
import { seededRandom } from "./test-support/seeded-random";

// How a producer chooses to chunk its text-showing operators must not change the words a reader gets back. The reference here places every glyph with an operator of its own at the position the producer's form puts it, so the line grouping alone decides where words and columns break; the form under test sets a whole row as one TJ under a character spacing, with adjustments that take the spacing back inside each figure and leave or widen it between figures. Both must read as the same line.

const FONT_SIZE = 10;
const GLYPH_WIDTH_PER_1000 = 500;
const GLYPH_WIDTH = (GLYPH_WIDTH_PER_1000 / 1000) * FONT_SIZE;
const CASES = 300;
// Generated gaps keep this far, in em, from the word-gap and column-gap thresholds, so the rounding of a written number can never move a gap across one and the two forms are compared only where the geometry has one reading.
const THRESHOLD_MARGIN_EM = 0.05;
const ADJUSTMENT_DECIMALS = 4;
const POSITION_DECIMALS = 6;
const MAX_FIGURE_DIGITS = 3;
const MAX_FIGURES = 8;
// The character spacing a case uses, in em: from none up to well past a word space, so cases where the spacing alone is narrower than a word and cases where it is wider are both drawn.
const MAX_CHAR_SPACE_EM = 0.8;

const NOOP_SINK: PdfDiagnosticSink = () => undefined;
const FIXED_WIDTH_METRICS: FontMetricsPort = {
  glyphAdvance: () => ({
    widthPer1000: GLYPH_WIDTH_PER_1000,
    byteLengthConsumed: 1,
  }),
  isVertical: () => false,
};
const RESOLVER = {
  resolve: () => undefined,
  resolveDict: () => undefined,
};

function between(random: () => number, low: number, high: number): number {
  return low + random() * (high - low);
}

// A gap inside a figure: kerning noise either side of zero, well under a word space.
function tightGapEm(random: () => number): number {
  return between(
    random,
    -THRESHOLD_MARGIN_EM,
    DEFAULT_WORD_GAP_EM - THRESHOLD_MARGIN_EM,
  );
}

// A gap between figures: an ordinary word space or a column-wide separation.
function figureGapEm(random: () => number): number {
  return random() < 1 / 2
    ? between(
        random,
        DEFAULT_WORD_GAP_EM + THRESHOLD_MARGIN_EM,
        DEFAULT_COLUMN_GAP_EM - THRESHOLD_MARGIN_EM,
      )
    : between(
        random,
        DEFAULT_COLUMN_GAP_EM + THRESHOLD_MARGIN_EM,
        DEFAULT_COLUMN_GAP_EM * 4,
      );
}

interface GeneratedRow {
  readonly glyphs: readonly string[];
  // The gap after each glyph but the last, in text space units, exactly as the producer form below states it.
  readonly gaps: readonly number[];
  readonly producerContent: string;
  // Whether a word-wide gap in this row falls between two glyphs of one string, with no adjustment to mark it.
  readonly splitsInsideAString: boolean;
}

function generateRow(random: () => number): GeneratedRow {
  const charSpace = between(random, 0, MAX_CHAR_SPACE_EM) * FONT_SIZE;
  const figures = Array.from(
    { length: 1 + Math.floor(random() * MAX_FIGURES) },
    () =>
      Array.from({ length: 1 + Math.floor(random() * MAX_FIGURE_DIGITS) }, () =>
        String(Math.floor(random() * 10)),
      ),
  );
  const glyphs = figures.flat();
  const gaps: number[] = [];
  const elements: string[] = [];
  let splitsInsideAString = false;
  figures.forEach((figure, figureIndex) => {
    figure.forEach((digit, digitIndex) => {
      elements.push(`(${digit})`);
      const lastOfRow =
        figureIndex === figures.length - 1 && digitIndex === figure.length - 1;
      if (lastOfRow) {
        return;
      }
      const endsFigure = digitIndex === figure.length - 1;
      // Half of the figure boundaries are left to the character spacing alone, the way a producer that spaces its figures with it writes them: no adjustment at all, so the next glyph continues the same string.
      if (endsFigure && random() < 1 / 2) {
        gaps.push(charSpace);
        splitsInsideAString ||= charSpace >= DEFAULT_WORD_GAP_EM * FONT_SIZE;
        return;
      }
      const wantedEm = endsFigure ? figureGapEm(random) : tightGapEm(random);
      const adjustment = Number(
        (((charSpace - wantedEm * FONT_SIZE) * 1000) / FONT_SIZE).toFixed(
          ADJUSTMENT_DECIMALS,
        ),
      );
      gaps.push(charSpace - (adjustment / 1000) * FONT_SIZE);
      elements.push(String(adjustment));
    });
  });
  // Adjacent strings with no adjustment between them are one string to the producer.
  const array = elements.join(" ").replaceAll(") (", "");
  return {
    glyphs,
    gaps,
    producerContent: `BT /F1 ${FONT_SIZE} Tf 0 0 Td ${charSpace.toFixed(ADJUSTMENT_DECIMALS)} Tc [${array}] TJ ET`,
    splitsInsideAString,
  };
}

// Where each glyph of a row starts along the line.
function glyphPositions(row: GeneratedRow): number[] {
  let x = 0;
  return row.glyphs.map((_, index) => {
    const at = x;
    x += GLYPH_WIDTH + (row.gaps[index] ?? 0);
    return at;
  });
}

// The same glyphs, each shown by its own operator at the position the producer form gives it.
function referenceContent(row: GeneratedRow): string {
  const positions = glyphPositions(row);
  return row.glyphs
    .map(
      (glyph, index) =>
        `BT /F1 ${FONT_SIZE} Tf ${(positions[index] ?? 0).toFixed(POSITION_DECIMALS)} 0 Td (${glyph}) Tj ET`,
    )
    .join(" ");
}

// The same glyphs shown by one TJ in a shuffled order, each reached from where the glyph before left the pen by the adjustment that lands it on its own position: the way an equation setter draws a symbol, steps back for the bracket before it and forward again for its subscript. The first glyph is placed by Td, so the array opens on a glyph.
function outOfOrderContent(
  row: GeneratedRow,
  random: () => number,
): { content: string; stepsBack: boolean } {
  const positions = glyphPositions(row);
  const order = row.glyphs.map((_, index) => index);
  for (let index = order.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [order[index], order[swap]] = [order[swap]!, order[index]!];
  }
  const [first, ...rest] = order;
  if (first === undefined) {
    throw new Error("a generated row holds at least one glyph");
  }
  let pen = (positions[first] ?? 0) + GLYPH_WIDTH;
  let previous = first;
  let stepsBack = false;
  const elements = [`(${row.glyphs[first] ?? ""})`];
  for (const index of rest) {
    const target = positions[index] ?? 0;
    elements.push(
      ((pen - target) * (1000 / FONT_SIZE)).toFixed(ADJUSTMENT_DECIMALS),
      `(${row.glyphs[index] ?? ""})`,
    );
    pen = target + GLYPH_WIDTH;
    stepsBack ||= index < previous;
    previous = index;
  }
  const content = `BT /F1 ${FONT_SIZE} Tf ${(positions[first] ?? 0).toFixed(POSITION_DECIMALS)} 0 Td [${elements.join(" ")}] TJ ET`;
  return { content, stepsBack };
}

function runsOf(items: readonly ExtractedItem[]): PdfTextRunGeometry[] {
  return items.flatMap((item) =>
    item.kind === "text"
      ? [
          {
            text: new TextDecoder().decode(item.codes),
            xPt: item.startMatrix[4],
            yPt: item.startMatrix[5],
            sizePt: FONT_SIZE,
            widthPt: item.endMatrix[4] - item.startMatrix[4],
          },
        ]
      : [],
  );
}

function readLine(content: string): string[] {
  const items = interpretContentStream(
    new TextEncoder().encode(content),
    pdfDict({}),
    { fontMetrics: FIXED_WIDTH_METRICS, resolver: RESOLVER, sink: NOOP_SINK },
  );
  return groupPdfTextRuns(runsOf(items)).map((line) => line.text);
}

describe("interpretContentStream: a row's words do not depend on how its glyphs were chunked into operators", () => {
  it(`reads ${CASES} seeded rows set as one TJ under a character spacing exactly as the same glyphs placed one by one`, () => {
    const random = seededRandom(1716);
    let rowsSplitInsideAString = 0;
    for (let index = 0; index < CASES; index++) {
      const row = generateRow(random);
      if (row.splitsInsideAString) {
        rowsSplitInsideAString++;
      }
      expect(readLine(row.producerContent), row.producerContent).toEqual(
        readLine(referenceContent(row)),
      );
    }
    // The comparison only discriminates if the seeded rows include the case the fix is for: a word-wide gap inside one string, which only the character spacing opens.
    expect(rowsSplitInsideAString).toBeGreaterThan(0);
  });

  it(`reads ${CASES} seeded rows whose glyphs one TJ draws in a shuffled order exactly as the same glyphs placed one by one`, () => {
    const random = seededRandom(3693);
    let rowsSteppingBack = 0;
    for (let index = 0; index < CASES; index++) {
      const row = generateRow(random);
      const { content, stepsBack } = outOfOrderContent(row, random);
      if (stepsBack) {
        rowsSteppingBack++;
      }
      expect(readLine(content), content).toEqual(
        readLine(referenceContent(row)),
      );
    }
    // The comparison only discriminates if some rows draw a glyph to the left of the one drawn before it.
    expect(rowsSteppingBack).toBeGreaterThan(0);
  });
});
