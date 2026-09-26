import { describe, expect, it } from "vitest";
import { COLOR_BLACK } from "./color";
import {
  ContentTableCellSchema,
  ContentTableRowSchema,
  ContentTableSchema,
  isContentBlock,
} from "./content";
import {} from "./content-vocabulary";
import {
  ContentCellBordersSchema,
  ContentCellFillSchema,
  ContentCellPatternTypeSchema,
  ContentSheetCellSchema,
  resolveCellFillColor,
  unrecognizedFillKind,
} from "./content-sheet";

// Deliberately deep nesting: a table whose cell contains a table whose cell contains a table — the highest-risk case for the hand-written recursive isContentBlock guard. Typed as ContentTable (not the broader ContentBlock union) at each level so the nested `.rows`/`.cells` access below needs no narrowing or assertion.

describe("ContentCellBorders diagonals", () => {
  it("parses diagonalUp and diagonalDown alongside the four sides", () => {
    const border = { color: COLOR_BLACK, widthPt: 1 };
    const parsed = ContentCellBordersSchema.parse({
      diagonalUp: border,
      diagonalDown: border,
    });
    expect(parsed.diagonalUp).toEqual(border);
    expect(parsed.diagonalDown).toEqual(border);
  });
});

describe("ContentCellFill", () => {
  it("parses a solid fill", () => {
    const parsed = ContentCellFillSchema.parse({
      kind: "solid",
      color: COLOR_BLACK,
    });
    expect(parsed).toEqual({ kind: "solid", color: COLOR_BLACK });
  });

  it("parses a pattern fill carrying both a foreground and a background colour", () => {
    const parsed = ContentCellFillSchema.parse({
      kind: "pattern",
      patternType: "percent50",
      foregroundColor: COLOR_BLACK,
      backgroundColor: { r: 1, g: 1, b: 1 },
    });
    expect(parsed).toEqual({
      kind: "pattern",
      patternType: "percent50",
      foregroundColor: COLOR_BLACK,
      backgroundColor: { r: 1, g: 1, b: 1 },
    });
  });

  it("parses a pattern fill whose foreground and background colours are both left unstated", () => {
    const parsed = ContentCellFillSchema.parse({
      kind: "pattern",
      patternType: "diagonalCross",
    });
    if (parsed.kind !== "pattern") {
      throw new Error("expected a pattern fill");
    }
    expect(parsed.foregroundColor).toBeUndefined();
    expect(parsed.backgroundColor).toBeUndefined();
  });

  it("accepts every Word-family and Excel-family pattern type", () => {
    for (const patternType of ContentCellPatternTypeSchema.options) {
      expect(
        ContentCellFillSchema.safeParse({ kind: "pattern", patternType })
          .success,
      ).toBe(true);
    }
  });

  it("refuses a pattern type outside the closed vocabulary", () => {
    expect(
      ContentCellFillSchema.safeParse({
        kind: "pattern",
        patternType: "confetti",
      }).success,
    ).toBe(false);
  });

  it("refuses a solid fill missing its colour", () => {
    expect(ContentCellFillSchema.safeParse({ kind: "solid" }).success).toBe(
      false,
    );
  });

  it("refuses an unrecognised kind", () => {
    expect(
      ContentCellFillSchema.safeParse({ kind: "gradient", color: COLOR_BLACK })
        .success,
    ).toBe(false);
  });
});

describe("resolveCellFillColor", () => {
  it("resolves a solid fill to its own colour", () => {
    expect(resolveCellFillColor({ kind: "solid", color: COLOR_BLACK })).toEqual(
      COLOR_BLACK,
    );
  });

  it("prefers a pattern fill's own foreground colour", () => {
    const backgroundColor = { r: 1, g: 1, b: 1 };
    expect(
      resolveCellFillColor({
        kind: "pattern",
        patternType: "percent50",
        foregroundColor: COLOR_BLACK,
        backgroundColor,
      }),
    ).toEqual(COLOR_BLACK);
  });

  it("falls back to a pattern fill's own background colour when no foreground colour is stated", () => {
    const backgroundColor = { r: 1, g: 1, b: 1 };
    expect(
      resolveCellFillColor({
        kind: "pattern",
        patternType: "percent50",
        backgroundColor,
      }),
    ).toEqual(backgroundColor);
  });

  it("resolves to undefined when a pattern fill states neither colour", () => {
    expect(
      resolveCellFillColor({ kind: "pattern", patternType: "gray125" }),
    ).toBeUndefined();
  });
});

describe("unrecognizedFillKind", () => {
  it("stringifies a value's own kind field", () => {
    expect(unrecognizedFillKind({ kind: "gradient" })).toBe("gradient");
  });

  it("stringifies an absent kind field as the literal string 'undefined'", () => {
    expect(unrecognizedFillKind({})).toBe("undefined");
  });
});

describe("ContentTableCell background", () => {
  it("accepts a solid background", () => {
    const parsed = ContentTableCellSchema.parse({
      blocks: [],
      background: { kind: "solid", color: COLOR_BLACK },
    });
    expect(parsed.background).toEqual({ kind: "solid", color: COLOR_BLACK });
  });

  it("accepts a genuine two-colour pattern background instead of dropping it", () => {
    const parsed = ContentTableCellSchema.parse({
      blocks: [],
      background: {
        kind: "pattern",
        patternType: "percent20",
        foregroundColor: COLOR_BLACK,
        backgroundColor: { r: 1, g: 1, b: 1 },
      },
    });
    expect(parsed.background).toEqual({
      kind: "pattern",
      patternType: "percent20",
      foregroundColor: COLOR_BLACK,
      backgroundColor: { r: 1, g: 1, b: 1 },
    });
  });

  it("refuses a bare Color, the pre-#951 shape, now that background is a discriminated fill", () => {
    expect(
      ContentTableCellSchema.safeParse({ blocks: [], background: COLOR_BLACK })
        .success,
    ).toBe(false);
  });
});

describe("ContentTableCell formula", () => {
  it("accepts a wordprocessing table cell's own formula, carried verbatim", () => {
    const parsed = ContentTableCellSchema.parse({
      blocks: [],
      formula: "(A1+B1)",
    });
    expect(parsed.formula).toBe("(A1+B1)");
  });

  it("omits formula for a cell with none, the overwhelming common case", () => {
    const parsed = ContentTableCellSchema.parse({ blocks: [] });
    expect(parsed.formula).toBeUndefined();
  });
});

describe("ContentSheetCell background", () => {
  const base = {
    row: 0,
    column: 0,
    value: { kind: "empty" as const },
    displayText: "",
  };

  it("accepts a solid background", () => {
    const parsed = ContentSheetCellSchema.parse({
      ...base,
      background: { kind: "solid", color: COLOR_BLACK },
    });
    expect(parsed.background).toEqual({ kind: "solid", color: COLOR_BLACK });
  });

  it("accepts a genuine two-colour pattern background instead of dropping it", () => {
    const parsed = ContentSheetCellSchema.parse({
      ...base,
      background: {
        kind: "pattern",
        patternType: "darkTrellis",
        foregroundColor: COLOR_BLACK,
      },
    });
    expect(parsed.background).toEqual({
      kind: "pattern",
      patternType: "darkTrellis",
      foregroundColor: COLOR_BLACK,
    });
  });
});

describe("ContentTableCell verticalAlign", () => {
  it.each(["top", "center", "bottom"] as const)(
    "accepts %s",
    (verticalAlign) => {
      expect(
        ContentTableCellSchema.parse({ blocks: [], verticalAlign })
          .verticalAlign,
      ).toBe(verticalAlign);
    },
  );
});

describe("ContentTableRow direction", () => {
  it("parses an rtl row, RTF's own \\rtlrow scope", () => {
    expect(
      ContentTableRowSchema.parse({ cells: [], direction: "rtl" }).direction,
    ).toBe("rtl");
  });
});

describe("ContentTableRow isHeader", () => {
  it("parses a header row", () => {
    expect(
      ContentTableRowSchema.parse({ cells: [], isHeader: true }).isHeader,
    ).toBe(true);
  });

  it("leaves a row that states nothing without the field, rather than defaulting it to false", () => {
    expect(ContentTableRowSchema.parse({ cells: [] })).toEqual({ cells: [] });
  });

  it("rejects a non-boolean flag", () => {
    expect(
      ContentTableRowSchema.safeParse({ cells: [], isHeader: "yes" }).success,
    ).toBe(false);
  });

  // The flag says nothing about where a header row sits: any row may carry it, including a non-leading or non-contiguous one, which is exactly the shape a docx w:tblHeader can legally state and a leading-header-count field could not hold.
  it("accepts a table whose header rows are neither leading nor contiguous", () => {
    const parsedTable = ContentTableSchema.parse({
      kind: "table",
      rows: [
        { cells: [] },
        { cells: [], isHeader: true },
        { cells: [] },
        { cells: [], isHeader: true },
      ],
      columns: [],
    });
    expect(parsedTable.rows.map((row) => row.isHeader)).toEqual([
      undefined,
      true,
      undefined,
      true,
    ]);
  });

  it("guards the flag's type on the recursive block guard as well as the schema", () => {
    expect(
      isContentBlock({
        kind: "table",
        rows: [{ cells: [], isHeader: true }],
        columns: [],
      }),
    ).toBe(true);
    expect(
      isContentBlock({
        kind: "table",
        rows: [{ cells: [], isHeader: "yes" }],
        columns: [],
      }),
    ).toBe(false);
  });
});
