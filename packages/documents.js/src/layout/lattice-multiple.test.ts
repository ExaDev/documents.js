import { describe, expect, it } from "vitest";
import type { LayoutItem } from "pdf-codec";
import {
  MAX_STROKES_PER_AXIS,
  detectGridLattice,
  detectGridLattices,
} from "./lattice";

const BLACK = { r: 0, g: 0, b: 0 };

function line(
  x1Pt: number,
  y1Pt: number,
  x2Pt: number,
  y2Pt: number,
): LayoutItem {
  return { kind: "line", x1Pt, y1Pt, x2Pt, y2Pt, color: BLACK, widthPt: 1 };
}

describe("detectGridLattices: several tables drawn on one page", () => {
  /** A drawn grid of `rows` by `columns` equal cells whose top-left corner is (xPt, yPt), as stroked lines. */
  function grid(
    xPt: number,
    yPt: number,
    widthPt: number,
    heightPt: number,
    rows: number,
    columns: number,
  ): LayoutItem[] {
    const items: LayoutItem[] = [];
    for (let row = 0; row <= rows; row += 1) {
      const y = yPt - (heightPt / rows) * row;
      items.push(line(xPt, y, xPt + widthPt, y));
    }
    for (let column = 0; column <= columns; column += 1) {
      const x = xPt + (widthPt / columns) * column;
      items.push(line(x, yPt, x, yPt - heightPt));
    }
    return items;
  }

  const upper = grid(20, 700, 300, 120, 3, 3);
  const lower = grid(20, 400, 300, 90, 3, 3);

  it("returns every closed grid, top to bottom, where detectGridLattice keeps the largest", () => {
    const lattices = detectGridLattices([...lower, ...upper]);

    expect(lattices.map((lattice) => lattice.rowBoundariesDescPt)).toEqual([
      [700, 660, 620, 580],
      [400, 370, 340, 310],
    ]);
    expect(
      detectGridLattice([...lower, ...upper])?.rowBoundariesDescPt,
    ).toEqual([700, 660, 620, 580]);
  });

  it("keeps each grid's strokes to itself", () => {
    const [first, second] = detectGridLattices([...upper, ...lower]);

    expect(first?.sourceItems.size).toBe(upper.length);
    expect(second?.sourceItems.size).toBe(lower.length);
  });

  it("returns nothing for a page with no closed grid", () => {
    expect(detectGridLattices([line(20, 700, 320, 700)])).toEqual([]);
  });
});

describe("detectGridLattices: a boundary drawn in pieces", () => {
  // Three rows by three columns whose last column is one cell spanning all three rows: the row rules stop at the last column, so its right border is drawn as one piece per row and the middle piece meets no rule at all.
  const items: LayoutItem[] = [
    line(0, 100, 300, 100),
    line(0, 70, 200, 70),
    line(0, 40, 200, 40),
    line(0, 10, 300, 10),
    line(0, 10, 0, 100),
    line(100, 10, 100, 100),
    line(200, 10, 200, 100),
    line(300, 70, 300, 100),
    line(300, 40, 300, 70),
    line(300, 10, 300, 40),
  ];

  it("reads the pieces as the one border they are, so the table closes", () => {
    const [lattice] = detectGridLattices(items);

    expect(lattice?.rowBoundariesDescPt).toEqual([100, 70, 40, 10]);
    expect(lattice?.columnBoundariesAscPt).toEqual([0, 100, 200, 300]);
  });

  it("does not join pieces that leave a gap between them", () => {
    const gapped = items.map((item) =>
      item.kind === "line" && item.x1Pt === 300 && item.y1Pt === 40
        ? line(300, 40, 300, 60)
        : item,
    );

    expect(detectGridLattices(gapped)).toHaveLength(0);
  });
});

describe("detectGridLattices: a table continuing onto the next page", () => {
  // Three rows by three columns drawn cell by cell, the side borders one piece per row. The table's next row starts at the foot of the page: its first cell's top is the grid's bottom rule, its left border runs on below the grid as one more piece, and a rule under that first cell alone closes it there.
  const table: LayoutItem[] = [100, 70, 40, 10].flatMap((y) => [
    line(0, y, 100, y),
    line(100, y, 200, y),
    line(200, y, 300, y),
  ]);
  for (const x of [0, 100, 200, 300]) {
    for (const [low, high] of [
      [70, 100],
      [40, 70],
      [10, 40],
    ] as const) {
      table.push(line(x, low, x, high));
    }
  }
  const stub = [line(0, -5, 0, 10), line(0, -5, 100, -5)];

  it("reads the grid the table closes, leaving out the stub under one cell", () => {
    const [lattice] = detectGridLattices([...table, ...stub]);

    expect(lattice?.rowBoundariesDescPt).toEqual([100, 70, 40, 10]);
    expect(lattice?.columnBoundariesAscPt).toEqual([0, 100, 200, 300]);
  });

  it("reads the stub's rule as no boundary of the table", () => {
    const [lattice] = detectGridLattices([...table, ...stub]);

    expect(lattice?.sourceItems.has(stub[1]!)).toBe(false);
  });

  it("reads the grid above an open last row whose rule is drawn under its last cell alone", () => {
    // Every border runs on down to the foot of the page and a rule closes only the last column there, as a table whose last column ends on this page and whose other cells continue on the next.
    const open = [
      line(0, -5, 0, 10),
      line(100, -5, 100, 10),
      line(200, -5, 200, 10),
      line(300, -5, 300, 10),
      line(200, -5, 300, -5),
    ];

    const [lattice] = detectGridLattices([...table, ...open]);

    expect(lattice?.rowBoundariesDescPt).toEqual([100, 70, 40, 10]);
    expect(lattice?.columnBoundariesAscPt).toEqual([0, 100, 200, 300]);
  });

  it("reads the grid below a first row the previous page opened, its rule drawn over one cell alone", () => {
    const opened = [
      line(0, 100, 0, 115),
      line(200, 100, 200, 115),
      line(0, 115, 100, 115),
    ];

    const [lattice] = detectGridLattices([...table, ...opened]);

    expect(lattice?.rowBoundariesDescPt).toEqual([100, 70, 40, 10]);
  });

  it("takes off no column boundary, so a side border that stops short leaves the grid unclosed", () => {
    const shortRight = table.filter(
      (item) =>
        !(item.kind === "line" && item.x1Pt === 300 && item.y1Pt === 10),
    );

    expect(detectGridLattices(shortRight)).toHaveLength(0);
  });
});

describe("a page drawing more strokes on one axis than clustering reads", () => {
  it("is read as having no lattice, rather than spending a pair test on every pair of its strokes", () => {
    const grid: LayoutItem[] = [
      line(20, 700, 320, 700),
      line(20, 600, 320, 600),
      line(20, 500, 320, 500),
      line(20, 700, 20, 500),
      line(170, 700, 170, 500),
      line(320, 700, 320, 500),
    ];
    const flood = Array.from({ length: MAX_STROKES_PER_AXIS + 1 }, (_, index) =>
      line(20 + index * 0.01, 300, 40 + index * 0.01, 300),
    );

    expect(detectGridLattices(grid)).toHaveLength(1);
    expect(detectGridLattices([...grid, ...flood])).toEqual([]);
  });
});
