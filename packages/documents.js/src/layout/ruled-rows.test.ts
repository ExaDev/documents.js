import { describe, expect, it } from "vitest";
import type { LayoutItem } from "pdf-codec";
import { detectRuledRowLattice } from "./ruled-rows";

// The shapes a table ruled only between its rows takes, built directly as positioned items: where the rules put the rows, where the gutters put the columns, and what is not such a table at all. Text is 10pt Helvetica, whose word space is 2.78pt, so a 20pt strip is a gutter and a 2pt one is a gap between words.

const BLACK = { r: 0, g: 0, b: 0 };

// widthPt undefined leaves the advance unstated, as a reader may.
function text(
  value: string,
  xPt: number,
  yPt: number,
  widthPt: number | undefined,
): LayoutItem {
  return {
    kind: "text",
    text: value,
    xPt,
    yPt,
    ...(widthPt === undefined ? {} : { widthPt }),
    font: { family: "Helvetica", weight: "normal", style: "normal" },
    sizePt: 10,
    color: BLACK,
  };
}

function stroke(
  x1Pt: number,
  y1Pt: number,
  x2Pt: number,
  y2Pt: number,
): LayoutItem {
  return { kind: "line", x1Pt, y1Pt, x2Pt, y2Pt, color: BLACK, widthPt: 0.5 };
}

function rule(yPt: number, leftPt = 20, rightPt = 380): LayoutItem {
  return stroke(leftPt, yPt, rightPt, yPt);
}

function isRuleAt(item: LayoutItem, yPt: number): boolean {
  return item.kind === "line" && item.y1Pt === yPt;
}

// Columns at x 22 (each cell ending by 80), 110 (by 116) and 160: gutters [80, 110] and [116, 160], so dividers at 95 and 138.
const twoRows: readonly LayoutItem[] = [
  rule(150),
  rule(110),
  rule(80),
  text("Shop and", 22, 138, 40),
  text("commercial", 22, 126, 58),
  text("4", 110, 138, 6),
  text("Shops or premises", 160, 138, 85),
  text("for trade.", 160, 126, 45),
  text("Office", 22, 92, 28),
  text("3", 110, 92, 6),
  text("Offices.", 160, 92, 36),
];

describe("detectRuledRowLattice", () => {
  it("takes the rows from the rules and the columns from the middle of each gutter", () => {
    const lattice = detectRuledRowLattice(twoRows);
    expect(lattice?.rowBoundariesDescPt).toEqual([150, 110, 80]);
    expect(lattice?.columnBoundariesAscPt).toEqual([20, 95, 138, 380]);
    expect(lattice?.regions).toHaveLength(6);
  });

  it("reads lines directly above the first rule that keep to the columns as a heading row", () => {
    const lattice = detectRuledRowLattice([
      ...twoRows,
      text("Title", 22, 157, 22),
      text("Group", 110, 157, 26),
      text("Purpose", 160, 157, 38),
    ]);
    // The heading's top is its line's em box: baseline 157 plus 10pt.
    expect(lattice?.rowBoundariesDescPt).toEqual([167, 150, 110, 80]);
  });

  it("leaves a caption above the first rule, set in one column, out of the table", () => {
    const lattice = detectRuledRowLattice([
      ...twoRows,
      text("Table 1 Uses", 22, 157, 60),
    ]);
    expect(lattice?.rowBoundariesDescPt).toEqual([150, 110, 80]);
  });

  it("leaves a line above the first rule that crosses a gutter out of the table", () => {
    const lattice = detectRuledRowLattice([
      ...twoRows,
      text("A sentence of prose running across the columns", 22, 157, 200),
    ]);
    expect(lattice?.rowBoundariesDescPt).toEqual([150, 110, 80]);
  });

  it("leaves a heading row standing further off than a paragraph gap out of the table", () => {
    const lattice = detectRuledRowLattice([
      ...twoRows,
      text("Title", 22, 190, 22),
      text("Group", 110, 190, 26),
    ]);
    expect(lattice?.rowBoundariesDescPt).toEqual([150, 110, 80]);
  });

  it("reads a row whose text runs across a gutter as one cell spanning the columns it covers", () => {
    const lattice = detectRuledRowLattice([
      rule(170),
      ...twoRows,
      text("Group heading reaching into the second column", 22, 158, 110),
    ]);
    expect(lattice?.regions.filter((region) => region.rowStart === 0)).toEqual([
      { rowStart: 0, rowEnd: 1, colStart: 0, colEnd: 2 },
      { rowStart: 0, rowEnd: 1, colStart: 2, colEnd: 3 },
    ]);
  });

  it("counts a closing rule drawn wider than the rules between the rows as the table's", () => {
    const lattice = detectRuledRowLattice([
      ...twoRows.filter((item) => !isRuleAt(item, 80)),
      rule(80, 14, 386),
    ]);
    expect(lattice?.rowBoundariesDescPt).toEqual([150, 110, 80]);
    expect(lattice?.columnBoundariesAscPt).toEqual([14, 95, 138, 386]);
  });

  it("splits a band whose every line fills the first line's columns into a row per line", () => {
    const lattice = detectRuledRowLattice([
      rule(150),
      rule(130),
      rule(70),
      text("h", 22, 138, 6),
      text("I", 110, 138, 6),
      text("5", 22, 118, 6),
      text("24", 110, 118, 12),
      text("7", 22, 106, 6),
      text("13", 110, 106, 12),
      text("11", 22, 94, 12),
      text("65", 110, 94, 12),
    ]);
    // Each later row starts halfway between its baseline and the one above.
    expect(lattice?.rowBoundariesDescPt).toEqual([150, 130, 112, 100, 70]);
  });

  it("keeps a band whose later lines leave a column empty as one row", () => {
    const lattice = detectRuledRowLattice(twoRows);
    expect(lattice?.rowBoundariesDescPt).toEqual([150, 110, 80]);
  });

  it("finds no table when only one row holds text in more than one place", () => {
    expect(
      detectRuledRowLattice([
        rule(150),
        rule(110),
        rule(80),
        text("Shop and", 22, 138, 40),
        text("4", 110, 138, 6),
        text("One paragraph of prose across the whole row", 22, 92, 300),
      ]),
    ).toBeUndefined();
  });

  it("finds no table when a row runs across a gap another row leaves between two places", () => {
    // A group heading over two sub-columns, set in one band with the sub-headings under it, runs across the gutter the body leaves between those sub-columns; read as one row it would merge each body row's two figures into one cell.
    expect(
      detectRuledRowLattice([
        rule(170),
        rule(140),
        rule(80),
        text("Label", 22, 158, 30),
        text("Group heading", 110, 158, 90),
        text("a", 110, 146, 6),
        text("b", 160, 146, 6),
        ...[128, 116, 104, 92].flatMap((yPt) => [
          text("1", 22, yPt, 6),
          text("2", 110, yPt, 6),
          text("3", 160, yPt, 6),
        ]),
      ]),
    ).toBeUndefined();
  });

  it("finds no table between fewer than three rules", () => {
    expect(
      detectRuledRowLattice(twoRows.filter((item) => !isRuleAt(item, 80))),
    ).toBeUndefined();
  });

  it("finds no table when a stroke crosses the area, as a diagram's would", () => {
    expect(
      detectRuledRowLattice([...twoRows, stroke(100, 85, 100, 145)]),
    ).toBeUndefined();
  });

  it("still finds the table when a box drawn round it runs along its edges", () => {
    expect(
      detectRuledRowLattice([
        ...twoRows,
        stroke(20, 80, 20, 150),
        stroke(380, 80, 380, 150),
      ]),
    ).toBeDefined();
  });

  it("still finds the table when a row is shaded across its whole width", () => {
    expect(
      detectRuledRowLattice([
        {
          kind: "rect",
          xPt: 20,
          yPt: 110,
          widthPt: 360,
          heightPt: 40,
          fill: { r: 0.9, g: 0.9, b: 0.9 },
        },
        ...twoRows,
      ]),
    ).toBeDefined();
  });

  it("finds no table when a box narrower than the table sits inside it", () => {
    expect(
      detectRuledRowLattice([
        ...twoRows,
        {
          kind: "rect",
          xPt: 100,
          yPt: 90,
          widthPt: 40,
          heightPt: 40,
          stroke: { color: BLACK, widthPt: 0.5 },
        },
      ]),
    ).toBeUndefined();
  });

  it("finds no table when a text item states no advance width", () => {
    expect(
      detectRuledRowLattice([
        ...twoRows.slice(0, -1),
        text("Offices.", 160, 92, undefined),
      ]),
    ).toBeUndefined();
  });
});
