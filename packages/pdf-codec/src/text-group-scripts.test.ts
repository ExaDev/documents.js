// Superscripts and subscripts: scriptPositionOf, the rule that says whether a run decorates the run it touches, and attachScriptRuns, which returns a script baseline clustering put on a line of its own to its base's line, alone and inside groupPdfTextRuns.
import { describe, expect, it } from "vitest";
import type { PdfTextRunGeometry } from "./text-group";
import {
  attachScriptRuns,
  groupPdfTextRuns,
  scriptPositionOf,
} from "./text-group";

// A run carrying only the geometry the rules read, every width stated explicitly since an absent width is itself a case under test.
function run(
  text: string,
  xPt: number,
  yPt: number,
  sizePt: number,
  widthPt?: number,
  rotationDeg?: number,
): PdfTextRunGeometry {
  return {
    text,
    xPt,
    yPt,
    sizePt,
    ...(widthPt === undefined ? {} : { widthPt }),
    ...(rotationDeg === undefined ? {} : { rotationDeg }),
  };
}

describe("groupPdfTextRuns: a script raised past the line tolerance", () => {
  it("keeps a unit's exponent raised by more than two thirds of its own em on its base's line", () => {
    // 7pt "2" raised 5pt over a 12pt line: beyond two thirds of the 7pt em (4.67pt), within half the 12pt em.
    const lines = groupPdfTextRuns([
      run("area of 280m", 10, 60, 12, 70),
      run("2", 80, 65, 7, 3.9),
      run(".", 83.9, 60, 12, 3.3),
    ]);
    expect(lines.map((line) => line.text)).toEqual(["area of 280m2."]);
  });

  it("takes a line's baseline from the run left on it when the run that opened it was a script that moved away", () => {
    // The raised "2" is met first, down the page, and opens the line the unrelated 7pt "note" joins, then moves to its base's line.
    const lines = groupPdfTextRuns([
      run("2", 80, 65, 7, 3.9),
      run("note", 150, 65, 7, 15),
      run("280m", 50, 60, 12, 30),
    ]);
    expect(lines.map((line) => [line.text, line.baselineYPt])).toEqual([
      ["note", 65],
      ["280m2", 60],
    ]);
  });
});

describe("attachScriptRuns", () => {
  const base = run("280m", 50, 60, 12, 30);
  const exponent = run("2", 80, 65, 7, 3.9);
  const below = run("next line", 50, 46, 12, 50);

  it("moves a script onto its base's line, leaving its own line empty and in place", () => {
    const attached = attachScriptRuns(
      [[exponent], [base], [below]],
      (line) => line,
    );
    expect(attached.map(({ runs }) => runs)).toEqual([
      [],
      [base, exponent],
      [below],
    ]);
  });

  it("returns each line it was given as the line of its entry", () => {
    const lines = [[exponent], [base]];
    const attached = attachScriptRuns(lines, (line) => line);
    expect(attached.map(({ line }) => line)).toEqual(lines);
  });

  it("leaves a small run that touches no larger run where it is", () => {
    const footnote = run("Note", 50, 30, 7, 15);
    const attached = attachScriptRuns([[base], [footnote]], (line) => line);
    expect(attached.map(({ runs }) => runs)).toEqual([[base], [footnote]]);
  });

  it("does not move a run that is a script of a run on its own line", () => {
    const lowered = run("1", 80, 58, 7, 3.9);
    const attached = attachScriptRuns([[base, lowered]], (line) => line);
    expect(attached.map(({ runs }) => runs)).toEqual([[base, lowered]]);
  });
});

describe("an equation's exponent set at four fifths of its base's size", () => {
  // A fraction's numerator "1 + K", "2", "R" in 9.16pt with the exponent in 7.33pt, as an equation setter sizes a first-level script, and a denominator 14pt below. "1 + K" is 21.645pt wide in Helvetica (2363/1000 em), so the exponent starts at x 41.645 and is 4.075pt wide (556/1000 em).
  const numerator = run("1 + K", 20, 60, 9.16, 21.645);
  const after = run("R", 45.72, 60, 9.16, 6.614);
  const denominator = run("R + X", 20, 46, 9.16, 24.6);
  const exponent = (raisedPt: number, xPt = 41.645, sizePt = 7.33) =>
    run("2", xPt, 60 + raisedPt, sizePt, 4.075);

  it("reads the exponent raised by 0.35 of its base's em as a superscript", () => {
    expect(scriptPositionOf(numerator, exponent(0.35 * 9.16))).toBe(
      "superscript",
    );
  });

  it("returns the exponent raised 4.3pt from a line of its own to its base's line", () => {
    const raised = exponent(4.3);
    const attached = attachScriptRuns(
      [[raised], [numerator, after], [denominator]],
      (line) => line,
    );
    expect(attached.map(({ runs }) => runs)).toEqual([
      [],
      [numerator, after, raised],
      [denominator],
    ]);
  });

  it("does not read a raised run set at its base's own size", () => {
    expect(
      scriptPositionOf(numerator, exponent(0.35 * 9.16, 41.645, 9.16)),
    ).toBeUndefined();
  });

  it("does not read a run at four fifths of its base's size on its base's baseline", () => {
    expect(scriptPositionOf(numerator, exponent(0))).toBeUndefined();
  });

  it("does not read a run at four fifths of its base's size raised but set well to the right of it", () => {
    expect(
      scriptPositionOf(numerator, exponent(0.35 * 9.16, 41.645 + 9.16)),
    ).toBeUndefined();
  });
});

describe("scriptPositionOf", () => {
  // A 12pt base "280m" ending at x 100, and the shapes a unit's exponent or a symbol's index takes beside it.
  const base = run("280m", 70, 500, 12, 30);

  it("reads a smaller run raised beside its base as a superscript", () => {
    expect(scriptPositionOf(base, run("2", 100, 504, 7, 3.9))).toBe(
      "superscript",
    );
  });

  it("reads a smaller run lowered beside its base as a subscript", () => {
    expect(scriptPositionOf(base, run("1", 100, 498, 7, 3.9))).toBe(
      "subscript",
    );
  });

  it("reads a script set before its base, touching it", () => {
    expect(scriptPositionOf(base, run("2", 66.1, 504, 7, 3.9))).toBe(
      "superscript",
    );
  });

  it("reads a script tucked back under its base's overhang", () => {
    expect(scriptPositionOf(base, run("1", 98, 498, 7, 3.9))).toBe("subscript");
  });

  it("does not read a run set at the closest ratio of two type-scale steps, 9pt against 11pt", () => {
    const eleven = run("A", 70, 500, 11, 30);
    expect(scriptPositionOf(eleven, run("2", 100, 503, 9, 5))).toBeUndefined();
    expect(scriptPositionOf(eleven, run("2", 100, 503, 8.99, 5))).toBe(
      "superscript",
    );
  });

  it("does not read a run one type-scale step smaller than its base set off its baseline, 10pt against 12pt", () => {
    expect(
      scriptPositionOf(base, run("Page", 100, 503, 10, 20)),
    ).toBeUndefined();
  });

  it("does not read a smaller run on its base's own baseline, small capitals for instance", () => {
    expect(
      scriptPositionOf(base, run("PDF", 100, 500.5, 8, 15)),
    ).toBeUndefined();
  });

  it("reads a shift of exactly a twentieth of the base's em", () => {
    expect(scriptPositionOf(base, run("2", 100, 500.6, 7, 3.9))).toBe(
      "superscript",
    );
  });

  it("does not read a run moved further than half its base's em", () => {
    expect(
      scriptPositionOf(base, run("2", 100, 506.5, 7, 3.9)),
    ).toBeUndefined();
    expect(
      scriptPositionOf(base, run("2", 100, 493.5, 7, 3.9)),
    ).toBeUndefined();
  });

  it("reads a run moved by exactly half its base's em", () => {
    expect(scriptPositionOf(base, run("2", 100, 506, 7, 3.9))).toBe(
      "superscript",
    );
  });

  it("does not read a run a word space or more away from its base", () => {
    // An eighth of the 7pt script's em is 0.875pt.
    expect(
      scriptPositionOf(base, run("2", 100.875, 504, 7, 3.9)),
    ).toBeUndefined();
    expect(scriptPositionOf(base, run("2", 100.8, 504, 7, 3.9))).toBe(
      "superscript",
    );
  });

  it("does not read a run reaching back past its own em under its base", () => {
    expect(scriptPositionOf(base, run("2", 93, 504, 7, 3.9))).toBeUndefined();
    expect(scriptPositionOf(base, run("2", 93.1, 504, 7, 3.9))).toBe(
      "superscript",
    );
  });

  it("does not read a run beside a base with no stated width, since their gap is unknown", () => {
    const widthless = run("280m", 70, 500, 12);
    expect(
      scriptPositionOf(widthless, run("2", 100, 504, 7, 3.9)),
    ).toBeUndefined();
  });

  it("does not read runs set at different angles", () => {
    expect(
      scriptPositionOf(base, run("2", 100, 504, 7, 3.9, 90)),
    ).toBeUndefined();
  });

  it("measures the shift across a rotated line, not along the page's y", () => {
    // A line turned a quarter turn anticlockwise advances up the page; its raised script sits to the left of it.
    const turned = run("280m", 500, 70, 12, 30, 90);
    expect(scriptPositionOf(turned, run("2", 496, 100, 7, 3.9, 90))).toBe(
      "superscript",
    );
  });
});
