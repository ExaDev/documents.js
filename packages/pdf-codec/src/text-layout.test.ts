import type { TextMeasurer } from 'document-schema.js';
import { describe, expect, it } from 'vitest';
import { wrapRunsToWidth, wrapTextToWidth } from './text-layout';

// A fake monospace measurer: every character is exactly 1pt wide at size 10 (i.e. sizePt/10 pt per character), so wrap-point assertions can be exact integers rather than depending on real font metrics -- this is the whole reason TextMeasurer is an interface (src/pdf/measure.ts).
function fakeMeasurer(): TextMeasurer {
  return {
    widthOfTextAtSize: (text, _font, sizePt) => Array.from(text).length * (sizePt / 10),
    lineHeightAtSize: (_font, sizePt) => sizePt * 1.2,
    ascenderAtSize: (_font, sizePt) => sizePt * 0.8,
    descenderAtSize: (_font, sizePt) => -sizePt * 0.2,
    underlineAtSize: (_font, sizePt) => ({ offsetPt: -sizePt * 0.1, thicknessPt: sizePt * 0.05 }),
    horizontalScaleFor: () => 1,
  };
}

const FONT = { family: 'Test', weight: 'normal', style: 'normal' } as const;
const COLOR = { r: 0, g: 0, b: 0 };

function run(text: string, sizePt = 10): { text: string; font: typeof FONT; sizePt: number; color: typeof COLOR } {
  return { text, font: FONT, sizePt, color: COLOR };
}

// Fragments carry no text for the glue (space) atoms between them -- spacing is expressed purely via xOffsetPt, not literal space characters -- so reconstructing readable text for assertions means inserting a space wherever a fragment's offset leaves a gap after the previous one, rather than joining fragment text directly.
const OFFSET_GAP_EPSILON = 1e-6;

function lineTexts(lines: ReturnType<typeof wrapRunsToWidth>, measurer: TextMeasurer): string[] {
  return lines.map((line) => {
    let text = '';
    let cursorPt = 0;
    for (const fragment of line.fragments) {
      if (fragment.xOffsetPt > cursorPt + OFFSET_GAP_EPSILON) {
        text += ' ';
      }
      text += fragment.text;
      cursorPt = fragment.xOffsetPt + measurer.widthOfTextAtSize(fragment.text, fragment.font, fragment.sizePt);
    }
    return text;
  });
}

describe('wrapRunsToWidth: basic wrapping', () => {
  it('fits everything on one line when it all fits', () => {
    const measurer = fakeMeasurer();
    const lines = wrapRunsToWidth([run('hi there')], measurer, 100);
    expect(lineTexts(lines, measurer)).toEqual(['hi there']);
  });

  it('wraps at a word boundary when a line would otherwise overflow', () => {
    const measurer = fakeMeasurer();
    // "hello" (5) + space (1) + "world" (5) = 11pt; a width of 8 fits "hello" but not the space+world.
    const lines = wrapRunsToWidth([run('hello world')], measurer, 8);
    expect(lineTexts(lines, measurer)).toEqual(['hello', 'world']);
  });

  it('strips trailing glue rather than measuring it into the line width', () => {
    const measurer = fakeMeasurer();
    const lines = wrapRunsToWidth([run('ab cd')], measurer, 3);
    // "ab" (2) fits in 3; the space would push to 3 but "cd" doesn't fit after it, so break after "ab".
    expect(lineTexts(lines, measurer)).toEqual(['ab', 'cd']);
    expect(lines[0]?.widthPt).toBe(2); // trailing space is not counted in line width
  });

  it('an explicit newline forces a line break regardless of remaining width', () => {
    const measurer = fakeMeasurer();
    const lines = wrapRunsToWidth([run('ab\ncd')], measurer, 100);
    expect(lineTexts(lines, measurer)).toEqual(['ab', 'cd']);
  });
});

describe('wrapRunsToWidth: words spanning run boundaries', () => {
  it('never breaks a word that spans two runs with different formatting', () => {
    const measurer = fakeMeasurer();
    // "hel" + "lo" = "hello" (5 chars), must stay together as one atom even though it's two runs.
    const lines = wrapRunsToWidth([run('hel'), run('lo world')], measurer, 100);
    expect(lineTexts(lines, measurer)).toEqual(['hello world']);
  });

  it('wraps correctly when a run-spanning word does not fit on the current line', () => {
    const measurer = fakeMeasurer();
    // "ab" (2) + space (1) + "hello" (5, spanning two runs) = 8pt, which doesn't fit in 6; but "hello" alone (5pt) does fit a fresh 6pt line, so it moves down rather than being emergency-split.
    const lines = wrapRunsToWidth([run('ab '), run('hel'), run('lo')], measurer, 6);
    expect(lineTexts(lines, measurer)).toEqual(['ab', 'hello']);
  });

  it('preserves per-fragment styling across the run boundary within one wrapped word', () => {
    const measurer = fakeMeasurer();
    const boldRun = { ...run('lo'), sizePt: 20 };
    const lines = wrapRunsToWidth([run('hel'), boldRun], measurer, 100);
    expect(lines[0]?.fragments.map((f) => [f.text, f.sizePt])).toEqual([
      ['hel', 10],
      ['lo', 20],
    ]);
  });
});

describe('wrapRunsToWidth: emergency split of an over-long word', () => {
  it('splits a single word wider than the column, making progress across multiple lines', () => {
    const measurer = fakeMeasurer();
    const lines = wrapRunsToWidth([run('abcdefghij')], measurer, 4); // 10-char word, 4pt column
    expect(lineTexts(lines, measurer).join('')).toBe('abcdefghij');
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line.widthPt).toBeLessThanOrEqual(4);
    }
  });

  it('guarantees at least one character of progress even in a pathologically narrow column', () => {
    const measurer = fakeMeasurer();
    const lines = wrapRunsToWidth([run('abc')], measurer, 0.5);
    expect(lineTexts(lines, measurer).join('')).toBe('abc');
    expect(lines.length).toBe(3); // one character per line, since even one character exceeds 0.5pt
  });

  it('does not split when breakLongWords is false, placing the whole word on its own line instead', () => {
    const measurer = fakeMeasurer();
    const lines = wrapRunsToWidth([run('ab '), run('abcdefghij')], measurer, 4, { breakLongWords: false });
    expect(lineTexts(lines, measurer)).toEqual(['ab', 'abcdefghij']);
  });
});

describe('wrapRunsToWidth: edge cases', () => {
  it('returns a single unwrapped line when maxWidthPt is zero or negative', () => {
    const measurer = fakeMeasurer();
    const lines = wrapRunsToWidth([run('hello world')], measurer, 0);
    expect(lineTexts(lines, measurer)).toEqual(['hello world']);
  });

  it('returns one empty line for an empty run list', () => {
    const measurer = fakeMeasurer();
    const lines = wrapRunsToWidth([], measurer, 100);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.fragments).toHaveLength(0);
  });

  it('line ascent/descent reflect the tallest/deepest fragment on the line', () => {
    const measurer = fakeMeasurer();
    const lines = wrapRunsToWidth([run('a', 10), run(' b', 20)], measurer, 100);
    expect(lines[0]?.ascentPt).toBe(20 * 0.8);
    expect(lines[0]?.descentPt).toBe(-20 * 0.2);
  });
});

describe('wrapTextToWidth', () => {
  it('wraps single-style text and returns plain strings per line', () => {
    const measurer = fakeMeasurer();
    expect(wrapTextToWidth('hello world', FONT, 10, COLOR, measurer, 8)).toEqual(['hello', 'world']);
  });
});

describe('wrapRunsToWidth: hyperlink pass-through', () => {
  it('carries a run\'s hyperlink through onto every fragment it produces, including across a wrap and an emergency split', () => {
    const measurer = fakeMeasurer();
    const linked = { ...run('helloworld'), hyperlink: 'https://example.com' };
    const lines = wrapRunsToWidth([linked], measurer, 4); // forces an emergency character-level split
    for (const line of lines) {
      for (const fragment of line.fragments) {
        expect(fragment.hyperlink).toBe('https://example.com');
      }
    }
  });

  it('leaves hyperlink undefined for a run that has none', () => {
    const measurer = fakeMeasurer();
    const lines = wrapRunsToWidth([run('hello')], measurer, 100);
    expect(lines[0]?.fragments[0]?.hyperlink).toBeUndefined();
  });
});
