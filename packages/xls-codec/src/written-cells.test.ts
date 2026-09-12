import type { ContentSheetCell } from "document-schema.js";
import { describe, expect, it } from "vitest";

import { cellCarriesFormatting, writesCellRecord } from "./written-cells";

function emptyCell(
  overrides: Partial<ContentSheetCell> = {},
): ContentSheetCell {
  return {
    row: 0,
    column: 0,
    value: { kind: "empty" },
    displayText: "",
    ...overrides,
  };
}

describe("cellCarriesFormatting", () => {
  it("is false for a bare, unformatted cell", () => {
    expect(cellCarriesFormatting(emptyCell())).toBe(false);
  });

  it("is true when the cell carries a background fill", () => {
    expect(
      cellCarriesFormatting(
        emptyCell({
          background: { kind: "solid", color: { rgbHex: "FF0000" } },
        }),
      ),
    ).toBe(true);
  });

  it("is true when the cell carries a horizontal alignment", () => {
    expect(cellCarriesFormatting(emptyCell({ alignment: "center" }))).toBe(
      true,
    );
  });

  it("is true when the cell carries a vertical alignment", () => {
    expect(cellCarriesFormatting(emptyCell({ verticalAlignment: "top" }))).toBe(
      true,
    );
  });

  it("is true when the cell's font differs from Normal", () => {
    expect(
      cellCarriesFormatting(
        emptyCell({ font: { fontFamily: "Arial", sizePt: 10, bold: true } }),
      ),
    ).toBe(true);
  });

  it("is false when the cell's font merely restates the default", () => {
    expect(
      cellCarriesFormatting(
        emptyCell({ font: { fontFamily: "Arial", sizePt: 10, bold: false } }),
      ),
    ).toBe(false);
  });

  it("is false when borders is present but every side is absent", () => {
    expect(cellCarriesFormatting(emptyCell({ borders: {} }))).toBe(false);
  });

  it("is true when only the left border is set", () => {
    expect(
      cellCarriesFormatting(
        emptyCell({ borders: { left: { style: "thin" } } }),
      ),
    ).toBe(true);
  });

  it("is true when only the right border is set", () => {
    expect(
      cellCarriesFormatting(
        emptyCell({ borders: { right: { style: "thin" } } }),
      ),
    ).toBe(true);
  });

  it("is true when only the top border is set", () => {
    expect(
      cellCarriesFormatting(emptyCell({ borders: { top: { style: "thin" } } })),
    ).toBe(true);
  });

  it("is true when only the bottom border is set", () => {
    expect(
      cellCarriesFormatting(
        emptyCell({ borders: { bottom: { style: "thin" } } }),
      ),
    ).toBe(true);
  });
});

describe("writesCellRecord", () => {
  it("is false for an empty, unformatted, formula-free cell", () => {
    expect(writesCellRecord(emptyCell())).toBe(false);
  });

  it("is true for a cell carrying a real value", () => {
    expect(
      writesCellRecord(emptyCell({ value: { kind: "number", value: 1 } })),
    ).toBe(true);
  });

  it("is true for an otherwise-empty cell carrying formatting", () => {
    expect(writesCellRecord(emptyCell({ alignment: "center" }))).toBe(true);
  });

  it("is true for an otherwise-empty cell carrying a formula", () => {
    expect(writesCellRecord(emptyCell({ formula: "=1+1" }))).toBe(true);
  });
});
