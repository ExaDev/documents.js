import { describe, expect, it } from "vitest";
import type { LayoutDocument, LayoutItem, LayoutText } from "pdf-codec";
import { renderContentDocumentToMarkdown } from "../markdown/render";
import { reconstructWordprocessing } from "./reconstruct";
import { readStackedFractions } from "./stacked-fractions";

// A stacked fraction as a standards PDF sets it: equation E.4 of an IEC specification is the quotient of two differences of temperature over a second pair, followed by `= e` and the exponent's own fraction `h / τ0`, with the number `(E.4)` out at the right. The positions are those of that page (numerators about 4pt above their rule, denominators about 10pt below), and the glyphs are placed as the page places them, one run each.
const SIZE_PT = 9.9928;
const SMALL_PT = 7.9943;
const BLACK = { r: 0, g: 0, b: 0 };

function run(
  text: string,
  xPt: number,
  yPt: number,
  sizePt = SIZE_PT,
  widthPt = 4.9,
): LayoutText {
  return {
    kind: "text",
    text,
    xPt,
    yPt,
    widthPt,
    font: { family: "Times-Roman", weight: "normal", style: "normal" },
    sizePt,
    color: BLACK,
  };
}

function rule(x1Pt: number, x2Pt: number, yPt: number): LayoutItem {
  return {
    kind: "line",
    x1Pt,
    y1Pt: yPt,
    x2Pt,
    y2Pt: yPt,
    color: BLACK,
    widthPt: 0.5,
  };
}

/** `∆θ2 - ∆θ1` over `∆θ3 - ∆θ2`, as one run per glyph, centred on a rule from 264.8 to 302. */
function quotientOfDifferences(): LayoutItem[] {
  return [
    run("∆", 266.2, 681.3, SIZE_PT, 6.1),
    run("θ", 272.3, 681.3),
    run("2", 277.1, 678.5, SMALL_PT, 4.4),
    run("-", 282.7, 681.3, SIZE_PT, 3.3),
    run("∆", 286.0, 681.3, SIZE_PT, 6.1),
    run("θ", 292.1, 681.3),
    run("1", 296.2, 678.5, SMALL_PT, 4.4),
    rule(264.8, 302.0, 677.0),
    run("∆", 265.4, 666.5, SIZE_PT, 6.1),
    run("θ", 271.5, 666.5),
    run("-", 281.9, 666.5, SIZE_PT, 3.3),
    run("∆", 285.2, 666.5, SIZE_PT, 6.1),
    run("θ", 291.2, 666.5),
    run("3", 276.2, 663.7, SMALL_PT, 4.4),
    run("2", 296.0, 663.7, SMALL_PT, 4.4),
  ];
}

function documentOf(items: LayoutItem[]): LayoutDocument {
  return {
    formatVersion: 1,
    metadata: {},
    pages: [{ widthPt: 595, heightPt: 842, items }],
    images: {},
  };
}

/** The text of the page as `reconstructWordprocessing` and the Markdown writer read it, without the backslashes the writer escapes syntax characters with. */
function markdownOf(items: LayoutItem[]): string {
  return renderContentDocumentToMarkdown(
    reconstructWordprocessing(documentOf(items)),
  ).replaceAll("\\", "");
}

describe("readStackedFractions", () => {
  it("reads a numerator, a rule and a denominator in parentheses over a slash on the equation's own line, keeping the small digits as subscripts", () => {
    const equation = [
      ...quotientOfDifferences(),
      run("=", 306.6, 674.4, SIZE_PT, 5.8),
      run("e", 315.2, 674.4, SIZE_PT, 5.5),
    ];

    expect(markdownOf(equation).trim()).toBe(
      "(∆θ<sub>2</sub> -∆θ<sub>1</sub>)/(∆θ<sub>3</sub> -∆θ<sub>2</sub>) = e",
    );
  });

  it("moves the parts onto the equation's line and removes the rule", () => {
    const equation = [
      ...quotientOfDifferences(),
      run("=", 306.6, 674.4, SIZE_PT, 5.8),
    ];

    const read = readStackedFractions(documentOf(equation));

    expect(
      (read.pages[0]?.items ?? []).some((item) => item.kind === "line"),
    ).toBe(false);
    const full = (read.pages[0]?.items ?? []).filter(
      (item): item is LayoutText =>
        item.kind === "text" && item.sizePt === SIZE_PT,
    );
    expect(new Set(full.map((item) => item.yPt))).toEqual(new Set([674.4]));
  });

  it("moves what follows the fraction on its line right by the room the fraction then takes, so nothing overlaps", () => {
    const equation = [
      ...quotientOfDifferences(),
      run("=", 306.6, 674.4, SIZE_PT, 5.8),
    ];

    const read = readStackedFractions(documentOf(equation));

    const texts = (read.pages[0]?.items ?? []).filter(
      (item): item is LayoutText => item.kind === "text",
    );
    const equals = texts.find((item) => item.text === "=");
    const widest = Math.max(
      ...texts
        .filter((item) => item !== equals)
        .map((item) => item.xPt + (item.widthPt ?? 0)),
    );
    expect(equals?.xPt).toBeGreaterThanOrEqual(widest);
  });

  it("puts a part that is one simple token without parentheses, and a part with an operator in it with them", () => {
    const exponent = [
      run("h", 323.5, 690.6, SMALL_PT, 4),
      rule(321.2, 329.7, 687.6),
      run("τ", 321.8, 679.3, SMALL_PT, 2.9),
      run("0", 324.8, 677.1, 6.995, 3.9),
    ];

    expect(markdownOf(exponent).trim()).toBe("h/(τ0)");
  });

  it("keeps a superscript raised on its base inside a numerator", () => {
    const fraction = [
      run("1", 100, 704, SIZE_PT, 5),
      run("+", 106, 704, SIZE_PT, 5),
      run("K", 112, 704, SIZE_PT, 7),
      run("2", 119.5, 708.3, 8, 4),
      run("R", 124, 704, SIZE_PT, 7),
      rule(98, 134, 700),
      run("R", 112, 690, SIZE_PT, 7),
    ];

    expect(markdownOf(fraction).trim()).toBe("(1 + K<sup>2</sup>R)/R");
  });

  it("reads two fractions on one page each with its own parts, when their bars do not share an extent", () => {
    const second = quotientOfDifferences().map((item) =>
      item.kind === "text"
        ? { ...item, xPt: item.xPt + 150, yPt: item.yPt - 100 }
        : item.kind === "line"
          ? {
              ...item,
              x1Pt: item.x1Pt + 150,
              x2Pt: item.x2Pt + 150,
              y1Pt: item.y1Pt - 100,
              y2Pt: item.y2Pt - 100,
            }
          : item,
    );

    expect(
      markdownOf([...quotientOfDifferences(), ...second])
        .split("\n")
        .filter((line) => line.includes("/(")),
    ).toHaveLength(2);
  });

  it("reads two fractions whose bars differ in extent by a couple of points as two fractions, however wide the stroke is reported", () => {
    // Equation E.1 and the next fraction of a loading guide: bars of 53.5 and 51.4 points, the strokes reported 16 wide by the file's own scale.
    const wide = (item: LayoutItem): LayoutItem =>
      item.kind === "line" ? { ...item, widthPt: 16 } : item;
    const second = quotientOfDifferences().map((item) =>
      item.kind === "text"
        ? { ...item, xPt: item.xPt + 2.5, yPt: item.yPt - 100 }
        : item.kind === "line"
          ? {
              ...item,
              x1Pt: item.x1Pt + 2.5,
              x2Pt: item.x2Pt + 0.4,
              y1Pt: item.y1Pt - 100,
              y2Pt: item.y2Pt - 100,
            }
          : item,
    );

    expect(
      markdownOf([...quotientOfDifferences().map(wide), ...second.map(wide)])
        .split("\n")
        .filter((line) => line.includes("/(")),
    ).toHaveLength(2);
  });

  it("leaves rules alone that share an extent, as the row rules of a table's column do", () => {
    const rows = [0, 100].flatMap((drop) =>
      quotientOfDifferences().map((item) =>
        item.kind === "text"
          ? { ...item, yPt: item.yPt - drop }
          : item.kind === "line"
            ? { ...item, y1Pt: item.y1Pt - drop, y2Pt: item.y2Pt - drop }
            : item,
      ),
    );
    const doc = documentOf(rows);

    expect(readStackedFractions(doc)).toBe(doc);
  });

  it("leaves a rule alone that abuts another at its end, as a row rule drawn in a segment per cell does", () => {
    const [first, ...rest] = quotientOfDifferences();
    const segment: LayoutItem = rule(302.0, 340.0, 677.0);
    const doc = documentOf([...(first ? [first] : []), ...rest, segment]);

    expect(readStackedFractions(doc)).toBe(doc);
  });

  it("leaves an underline alone, which has glyphs above it and none below", () => {
    const underlined = [
      run("Total", 100, 700, SIZE_PT, 25),
      rule(98, 128, 697),
    ];
    const doc = documentOf(underlined);

    expect(readStackedFractions(doc)).toBe(doc);
  });

  it("leaves a ruled line across a table alone, which is far wider than the glyphs on either side of it", () => {
    const table = [
      run("Size", 60, 700, SIZE_PT, 20),
      run("Rating", 260, 700, SIZE_PT, 30),
      rule(50, 500, 690),
      run("1.5", 60, 675, SIZE_PT, 14),
      run("21", 260, 675, SIZE_PT, 10),
    ];
    const doc = documentOf(table);

    expect(readStackedFractions(doc)).toBe(doc);
  });

  it("leaves a ruled table alone: the rule between a row of cells and the row below it has cells above and below, set columns apart", () => {
    // The header band of a ruled table, as a standards table sets it: a row of column headings, the rule under it, a row of figures.
    const cells = [141, 176, 211, 246, 282, 318];
    const table = [
      ...cells.map((x, index) => run(String(index + 2), x, 641, 9, 4)),
      rule(78, 340, 635),
      ...cells.map((x, index) => run(`${String(index + 1)}.5`, x, 620, 9, 12)),
    ];
    const doc = documentOf(table);

    expect(readStackedFractions(doc)).toBe(doc);
  });

  it("leaves a heading's underline alone when a paragraph set flush left runs under it", () => {
    const heading = [
      run("Maximum earth fault loop impedance", 72, 700, 12, 150),
      rule(72, 222, 696),
      run("Table", 72, 684, 10, 24),
      run("sets out the values", 100, 684, 10, 90),
    ];
    const doc = documentOf(heading);

    expect(readStackedFractions(doc)).toBe(doc);
  });

  it("leaves a one-row table's rule alone when its cells are set apart", () => {
    const table = [
      run("Rating", 85, 641, 9, 28),
      run("2", 141, 641, 9, 4),
      run("4", 178, 641, 9, 4),
      rule(78, 200, 635),
      run("Zs", 79, 622, 9, 10),
      run("33.1", 136, 622, 9, 18),
      run("15.6", 172, 622, 9, 18),
    ];
    const doc = documentOf(table);

    expect(readStackedFractions(doc)).toBe(doc);
  });

  it("leaves a vertical rule alone", () => {
    const doc = documentOf([
      run("a", 100, 700),
      {
        kind: "line",
        x1Pt: 110,
        y1Pt: 690,
        x2Pt: 110,
        y2Pt: 720,
        color: BLACK,
        widthPt: 0.5,
      },
      run("b", 100, 670),
    ]);

    expect(readStackedFractions(doc)).toBe(doc);
  });

  it("returns a document with no fraction as the same object", () => {
    const doc = documentOf([run("plain", 72, 700, SIZE_PT, 25)]);

    expect(readStackedFractions(doc)).toBe(doc);
  });
});

describe("reconstructWordprocessing on a page with a stacked fraction", () => {
  it("reads the fraction inside its equation's line, before the equation's number", () => {
    const equation = [
      ...quotientOfDifferences(),
      run("=", 306.6, 674.4, SIZE_PT, 5.8),
      run("e", 315.2, 674.4, SIZE_PT, 5.5),
      run("(E.4)", 500.8, 674.4, SIZE_PT, 23.1),
    ];

    expect(markdownOf(equation)).toMatch(
      /\(∆θ<sub>2<\/sub> -∆θ<sub>1<\/sub>\)\/\(∆θ<sub>3<\/sub> -∆θ<sub>2<\/sub>\)\s*=\s*e\s*\(E\.4\)/u,
    );
  });
});
