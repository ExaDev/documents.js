import { describe, expect, it } from "vitest";
import type { Color, ContentBorder, ContentCellFill } from "document-schema.js";
import {
  applyCellDefinitionControlWord,
  borderControlWords,
  CELL_BORDER_SIDES,
  cellFillControlWords,
  newPendingCell,
  resolveBorder,
  resolveCellFill,
  type PendingBorder,
  type PendingCell,
} from "./cell-format";

function pendingBorder(overrides: Partial<PendingBorder> = {}): PendingBorder {
  return {
    style: undefined,
    widthTwips: undefined,
    colorIndex: undefined,
    none: false,
    ...overrides,
  };
}

const RED: Color = { r: 1, g: 0, b: 0 };
const BLUE: Color = { r: 0, g: 0, b: 1 };
const colorTable: (Color | undefined)[] = [undefined, RED, BLUE];
const colorAt = (index: number): Color | undefined => colorTable[index];

describe("applyCellDefinitionControlWord", () => {
  it("recognizes every <celltop>/<cellleft>/<cellbot>/<cellright> side word and starts a fresh border for it", () => {
    for (const [word, side] of CELL_BORDER_SIDES) {
      const cell = newPendingCell();
      expect(applyCellDefinitionControlWord(word, undefined, cell)).toBe(true);
      expect(cell.side).toBe(side);
      expect(cell.borders[side]).toEqual(pendingBorder());
    }
  });

  it("resets the pending border when the same side is named a second time", () => {
    const cell = newPendingCell();
    applyCellDefinitionControlWord("clbrdrt", undefined, cell);
    cell.borders.top = pendingBorder({ style: "dashed", none: true });
    applyCellDefinitionControlWord("clbrdrt", undefined, cell);
    expect(cell.borders.top).toEqual(pendingBorder());
  });

  it.each([
    ["clvmgf", "verticalMergeFirst"],
    ["clvmrg", "verticalMergeContinuation"],
    ["clmgf", "horizontalMergeFirst"],
    ["clmrg", "horizontalMergeContinuation"],
  ] as const)(
    "sets %s's own %s flag and leaves the rest false",
    (word, field) => {
      const cell = newPendingCell();
      expect(applyCellDefinitionControlWord(word, undefined, cell)).toBe(true);
      expect(cell[field]).toBe(true);
      for (const other of [
        "verticalMergeFirst",
        "verticalMergeContinuation",
        "horizontalMergeFirst",
        "horizontalMergeContinuation",
      ] as const) {
        if (other !== field) {
          expect(cell[other]).toBe(false);
        }
      }
    },
  );

  it("stores clcbpat's own parameter as the background index, including when the parameter is absent", () => {
    const withParam = newPendingCell();
    expect(applyCellDefinitionControlWord("clcbpat", 3, withParam)).toBe(true);
    expect(withParam.backgroundIndex).toBe(3);

    const withoutParam = newPendingCell();
    expect(
      applyCellDefinitionControlWord("clcbpat", undefined, withoutParam),
    ).toBe(true);
    expect(withoutParam.backgroundIndex).toBeUndefined();
  });

  it("stores clcfpat's own parameter as the foreground index", () => {
    const cell = newPendingCell();
    expect(applyCellDefinitionControlWord("clcfpat", 7, cell)).toBe(true);
    expect(cell.foregroundIndex).toBe(7);
  });

  it("divides clshdng's hundredths-of-a-percent parameter down to a 0-100 scale", () => {
    const cell = newPendingCell();
    expect(applyCellDefinitionControlWord("clshdng", 2500, cell)).toBe(true);
    expect(cell.shadingPercent).toBe(25);
  });

  it("leaves shadingPercent undefined when clshdng carries no parameter at all", () => {
    const cell = newPendingCell();
    expect(applyCellDefinitionControlWord("clshdng", undefined, cell)).toBe(
      true,
    );
    expect(cell.shadingPercent).toBeUndefined();
  });

  it("sets verticalAlign to center for clvertalc and bottom for clvertalb", () => {
    const centered = newPendingCell();
    applyCellDefinitionControlWord("clvertalc", undefined, centered);
    expect(centered.verticalAlign).toBe("center");

    const bottomed = newPendingCell();
    applyCellDefinitionControlWord("clvertalb", undefined, bottomed);
    expect(bottomed.verticalAlign).toBe("bottom");
  });

  it("leaves verticalAlign undefined for clvertalt, the default top alignment", () => {
    const cell = newPendingCell();
    cell.verticalAlign = "center";
    expect(applyCellDefinitionControlWord("clvertalt", undefined, cell)).toBe(
      true,
    );
    expect(cell.verticalAlign).toBeUndefined();
  });

  it("returns false for a name that is neither a side, a switch case, nor a border descriptor, with no pending side", () => {
    const cell = newPendingCell();
    expect(applyCellDefinitionControlWord("plain", undefined, cell)).toBe(
      false,
    );
  });

  it("returns false for a border descriptor word when no side has been named yet", () => {
    const cell = newPendingCell();
    expect(applyCellDefinitionControlWord("brdrw", 20, cell)).toBe(false);
    expect(applyCellDefinitionControlWord("brdrnone", undefined, cell)).toBe(
      false,
    );
  });

  it("marks the pending side's border as none for each of the three no-border keywords", () => {
    for (const word of ["brdrnone", "brdrnil", "brdrtbl"]) {
      const cell = newPendingCell();
      applyCellDefinitionControlWord("clbrdrt", undefined, cell);
      expect(applyCellDefinitionControlWord(word, undefined, cell)).toBe(true);
      expect(cell.borders.top?.none).toBe(true);
    }
  });

  it("maps a <brdrk> keyword to its ContentStrokeStyle member on the pending side", () => {
    const cell = newPendingCell();
    applyCellDefinitionControlWord("clbrdrl", undefined, cell);
    expect(applyCellDefinitionControlWord("brdrdash", undefined, cell)).toBe(
      true,
    );
    expect(cell.borders.left?.style).toBe("dashed");
  });

  it("stores brdrw's parameter as the pending side's width in twips", () => {
    const cell = newPendingCell();
    applyCellDefinitionControlWord("clbrdrb", undefined, cell);
    expect(applyCellDefinitionControlWord("brdrw", 45, cell)).toBe(true);
    expect(cell.borders.bottom?.widthTwips).toBe(45);
  });

  it("stores brdrcf's parameter as the pending side's colour index", () => {
    const cell = newPendingCell();
    applyCellDefinitionControlWord("clbrdrr", undefined, cell);
    expect(applyCellDefinitionControlWord("brdrcf", 2, cell)).toBe(true);
    expect(cell.borders.right?.colorIndex).toBe(2);
  });

  it("consumes an unrecognized brdr-prefixed word as belonging to the pending border", () => {
    const cell = newPendingCell();
    applyCellDefinitionControlWord("clbrdrt", undefined, cell);
    expect(applyCellDefinitionControlWord("brdrzzz", undefined, cell)).toBe(
      true,
    );
  });

  it("consumes an unrecognized brsp-prefixed word as belonging to the pending border", () => {
    const cell = newPendingCell();
    applyCellDefinitionControlWord("clbrdrt", undefined, cell);
    expect(applyCellDefinitionControlWord("brsp99", undefined, cell)).toBe(
      true,
    );
  });

  it("does not consume a word that merely ends with brdr or brsp without starting with it", () => {
    const cell = newPendingCell();
    applyCellDefinitionControlWord("clbrdrt", undefined, cell);
    expect(applyCellDefinitionControlWord("xxxbrdr", undefined, cell)).toBe(
      false,
    );
    expect(applyCellDefinitionControlWord("xxxbrsp", undefined, cell)).toBe(
      false,
    );
  });
});

describe("resolveBorder", () => {
  it("returns undefined when the side is explicitly stated to have no border", () => {
    expect(
      resolveBorder(pendingBorder({ none: true }), colorAt),
    ).toBeUndefined();
  });

  it("falls back to the default width when none is stated", () => {
    const border = resolveBorder(pendingBorder(), colorAt);
    expect(border?.widthPt).toBe(0.75);
  });

  it("uses the stated width, converted from twips to points", () => {
    const border = resolveBorder(pendingBorder({ widthTwips: 40 }), colorAt);
    expect(border?.widthPt).toBe(2);
  });

  it("returns undefined when the resolved width is exactly zero", () => {
    expect(
      resolveBorder(pendingBorder({ widthTwips: 0 }), colorAt),
    ).toBeUndefined();
  });

  it("defaults an unstated colour index to black", () => {
    const border = resolveBorder(pendingBorder(), colorAt);
    expect(border?.color).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("defaults to black when the colour index resolves to no table entry", () => {
    const border = resolveBorder(pendingBorder({ colorIndex: 0 }), colorAt);
    expect(border?.color).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("resolves a stated colour index through the colour table", () => {
    const border = resolveBorder(pendingBorder({ colorIndex: 1 }), colorAt);
    expect(border?.color).toEqual(RED);
  });

  it("omits the style field for an unstated style", () => {
    const border = resolveBorder(pendingBorder(), colorAt);
    expect(border).not.toHaveProperty("style");
  });

  it("omits the style field for an explicit solid style", () => {
    const border = resolveBorder(pendingBorder({ style: "solid" }), colorAt);
    expect(border).not.toHaveProperty("style");
  });

  it("carries a non-solid style through", () => {
    const border = resolveBorder(pendingBorder({ style: "double" }), colorAt);
    expect(border?.style).toBe("double");
  });
});

function pendingCell(overrides: Partial<PendingCell> = {}): PendingCell {
  return { ...newPendingCell(), ...overrides };
}

describe("resolveCellFill", () => {
  it("returns undefined when no background colour was ever stated", () => {
    expect(resolveCellFill(pendingCell(), colorAt)).toBeUndefined();
  });

  it("returns undefined when the background index resolves to no colour and there is no shading", () => {
    expect(
      resolveCellFill(pendingCell({ backgroundIndex: 0 }), colorAt),
    ).toBeUndefined();
  });

  it("resolves a flat background with no shading percentage stated at all", () => {
    expect(
      resolveCellFill(pendingCell({ backgroundIndex: 1 }), colorAt),
    ).toEqual({ kind: "solid", color: RED });
  });

  it("resolves a flat background when shading is exactly zero", () => {
    expect(
      resolveCellFill(
        pendingCell({ backgroundIndex: 2, shadingPercent: 0 }),
        colorAt,
      ),
    ).toEqual({ kind: "solid", color: BLUE });
  });

  it("resolves a flat foreground colour when shading is exactly 100", () => {
    expect(
      resolveCellFill(
        pendingCell({
          backgroundIndex: 1,
          foregroundIndex: 2,
          shadingPercent: 100,
        }),
        colorAt,
      ),
    ).toEqual({ kind: "solid", color: BLUE });
  });

  it("returns undefined at full shading when the foreground index resolves to no colour", () => {
    expect(
      resolveCellFill(
        pendingCell({
          backgroundIndex: 1,
          foregroundIndex: 0,
          shadingPercent: 100,
        }),
        colorAt,
      ),
    ).toBeUndefined();
  });

  it("returns undefined at full shading when no foreground index was stated at all", () => {
    expect(
      resolveCellFill(
        pendingCell({ backgroundIndex: 1, shadingPercent: 100 }),
        colorAt,
      ),
    ).toBeUndefined();
  });

  it("resolves a genuine two-colour pattern for shading strictly between 0 and 100", () => {
    expect(
      resolveCellFill(
        pendingCell({
          backgroundIndex: 2,
          foregroundIndex: 1,
          shadingPercent: 50,
        }),
        colorAt,
      ),
    ).toEqual({
      kind: "pattern",
      patternType: "percent50",
      foregroundColor: RED,
      backgroundColor: BLUE,
    });
  });

  it("omits foregroundColor from a pattern fill when the foreground index resolves to no colour", () => {
    const fill = resolveCellFill(
      pendingCell({
        backgroundIndex: 1,
        foregroundIndex: 0,
        shadingPercent: 50,
      }),
      colorAt,
    );
    expect(fill).not.toHaveProperty("foregroundColor");
  });

  it("omits backgroundColor from a pattern fill when the background index resolves to no colour", () => {
    const fill = resolveCellFill(
      pendingCell({
        backgroundIndex: 0,
        foregroundIndex: 1,
        shadingPercent: 50,
      }),
      colorAt,
    );
    expect(fill).not.toHaveProperty("backgroundColor");
  });

  it("snaps a tied shading percentage to the earlier, not the later, equally-near percentN step", () => {
    // 7.5 sits exactly halfway between percent5 and percent10 -- the reduce must keep the first-seen closest step on a tie, not overwrite it with a later equally-close one.
    const fill = resolveCellFill(
      pendingCell({
        backgroundIndex: 1,
        foregroundIndex: 2,
        shadingPercent: 7.5,
      }),
      colorAt,
    );
    expect(fill).toMatchObject({ patternType: "percent5" });
  });
});

describe("borderControlWords", () => {
  const solidBorder: ContentBorder = { color: RED, widthPt: 1 };

  it.each(["top", "left", "bottom", "right"] as const)(
    "writes the %s side's own control word",
    (side) => {
      const expectedWord = [...CELL_BORDER_SIDES].find(
        ([, value]) => value === side,
      )?.[0];
      expect(borderControlWords(side, solidBorder, undefined)).toContain(
        `\\${expectedWord}`,
      );
    },
  );

  it("writes the canonical control word for each ContentStrokeStyle member", () => {
    expect(
      borderControlWords("top", { ...solidBorder, style: "solid" }, undefined),
    ).toContain("\\brdrs\\");
    expect(
      borderControlWords("top", { ...solidBorder, style: "dashed" }, undefined),
    ).toContain("\\brdrdash\\");
    expect(
      borderControlWords("top", { ...solidBorder, style: "dotted" }, undefined),
    ).toContain("\\brdrdot\\");
    expect(
      borderControlWords("top", { ...solidBorder, style: "double" }, undefined),
    ).toContain("\\brdrdb\\");
  });

  it("defaults to the solid style when style is unstated", () => {
    expect(borderControlWords("top", solidBorder, undefined)).toContain(
      "\\brdrs\\",
    );
  });

  it("floors the written width to at least one twip", () => {
    expect(
      borderControlWords("top", { ...solidBorder, widthPt: 0.01 }, undefined),
    ).toContain("\\brdrw1");
  });

  it("writes the width converted to twips for an ordinary width", () => {
    expect(
      borderControlWords("top", { ...solidBorder, widthPt: 2 }, undefined),
    ).toContain("\\brdrw40");
  });

  it("appends the colour control word only when a colour index is given", () => {
    expect(borderControlWords("top", solidBorder, undefined)).not.toContain(
      "\\brdrcf",
    );
    expect(borderControlWords("top", solidBorder, 3)).toContain("\\brdrcf3");
  });
});

describe("cellFillControlWords", () => {
  const colorIndexOf = (color: Color): number | undefined =>
    color === RED ? 1 : color === BLUE ? 2 : undefined;

  it("writes clcbpat alone for a solid fill whose colour resolves to an index", () => {
    expect(
      cellFillControlWords({ kind: "solid", color: RED }, colorIndexOf),
    ).toBe("\\clcbpat1");
  });

  it("writes nothing for a solid fill whose colour resolves to no index", () => {
    expect(
      cellFillControlWords(
        { kind: "solid", color: { r: 0.5, g: 0.5, b: 0.5 } },
        colorIndexOf,
      ),
    ).toBe("");
  });

  it("throws for a pattern fill type outside the percentN family", () => {
    expect(() =>
      cellFillControlWords(
        { kind: "pattern", patternType: "gray125" },
        colorIndexOf,
      ),
    ).toThrow(/gray125/);
  });

  it("writes all three control words for a two-colour pattern with both colours resolvable", () => {
    const fill: ContentCellFill = {
      kind: "pattern",
      patternType: "percent50",
      backgroundColor: BLUE,
      foregroundColor: RED,
    };
    const text = cellFillControlWords(fill, colorIndexOf);
    expect(text).toBe("\\clcbpat2\\clcfpat1\\clshdng5000");
  });

  it("omits clcbpat when the background colour resolves to no index", () => {
    const fill: ContentCellFill = {
      kind: "pattern",
      patternType: "percent50",
      backgroundColor: { r: 0.2, g: 0.2, b: 0.2 },
      foregroundColor: RED,
    };
    expect(cellFillControlWords(fill, colorIndexOf)).toBe(
      "\\clcfpat1\\clshdng5000",
    );
  });

  it("omits clcfpat when the foreground colour resolves to no index", () => {
    const fill: ContentCellFill = {
      kind: "pattern",
      patternType: "percent50",
      backgroundColor: BLUE,
      foregroundColor: { r: 0.2, g: 0.2, b: 0.2 },
    };
    expect(cellFillControlWords(fill, colorIndexOf)).toBe(
      "\\clcbpat2\\clshdng5000",
    );
  });

  it("writes only clshdng when neither pattern colour is stated at all", () => {
    const fill: ContentCellFill = { kind: "pattern", patternType: "percent25" };
    expect(cellFillControlWords(fill, colorIndexOf)).toBe("\\clshdng2500");
  });

  it("throws for a fill kind outside the solid/pattern discriminated union", () => {
    const bogus = { kind: "bogus" } as unknown as ContentCellFill;
    expect(() => cellFillControlWords(bogus, colorIndexOf)).toThrow(/bogus/);
  });
});
