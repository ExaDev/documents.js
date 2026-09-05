import { describe, expect, it } from "vitest";
import type { XmlElement } from "../../model/node";
import { el } from "../../xml/fragment";
import { buildCellShading, readCellShading } from "./shading";

// The w:shd <-> ContentCellFill vocabulary on its own (ExaDev/documents.js#951), at the level typed/docx/read.ts and typed/docx/write.ts actually exchange it -- write.test.ts's own round trips cover what a whole document does with a cell's shading; this file covers the ST_Shd tokens directly, including ones a real producer may state that this package's own writer never emits automatically (w:val absent, "nil", an unrecognised token).

function tcPr(shd: XmlElement | undefined): XmlElement {
  return el("w:tcPr", {}, shd === undefined ? [] : [shd]);
}

describe("readCellShading", () => {
  it("reads no fill from a tcPr with no w:shd at all", () => {
    expect(readCellShading(el("w:tcPr"))).toBeUndefined();
  });

  it("reads no fill for an absent tcPr", () => {
    expect(readCellShading(undefined)).toBeUndefined();
  });

  it('reads w:val="clear" as a solid fill of w:fill', () => {
    const shd = el("w:shd", {
      "w:val": "clear",
      "w:color": "auto",
      "w:fill": "ff0000",
    });
    expect(readCellShading(tcPr(shd))).toEqual({
      kind: "solid",
      color: { r: 1, g: 0, b: 0 },
    });
  });

  it('treats an absent w:val the same as "clear", the schema default', () => {
    const shd = el("w:shd", { "w:fill": "00ff00" });
    expect(readCellShading(tcPr(shd))).toEqual({
      kind: "solid",
      color: { r: 0, g: 1, b: 0 },
    });
  });

  it('reads w:val="solid" as a solid fill of w:color, not w:fill', () => {
    const shd = el("w:shd", {
      "w:val": "solid",
      "w:color": "0000ff",
      "w:fill": "ff0000",
    });
    expect(readCellShading(tcPr(shd))).toEqual({
      kind: "solid",
      color: { r: 0, g: 0, b: 1 },
    });
  });

  it("reads a genuine two-colour percentage pattern, not one of its two colours", () => {
    const shd = el("w:shd", {
      "w:val": "pct50",
      "w:color": "ff0000",
      "w:fill": "0000ff",
    });
    expect(readCellShading(tcPr(shd))).toEqual({
      kind: "pattern",
      patternType: "percent50",
      foregroundColor: { r: 1, g: 0, b: 0 },
      backgroundColor: { r: 0, g: 0, b: 1 },
    });
  });

  it("reads a stripe/cross pattern by its own ST_Shd name", () => {
    const shd = el("w:shd", { "w:val": "diagCross", "w:color": "ff0000" });
    expect(readCellShading(tcPr(shd))).toEqual({
      kind: "pattern",
      patternType: "diagonalCross",
      foregroundColor: { r: 1, g: 0, b: 0 },
    });
  });

  it('reads w:val="nil" as no fill', () => {
    const shd = el("w:shd", { "w:val": "nil" });
    expect(readCellShading(tcPr(shd))).toBeUndefined();
  });

  it("reads an unrecognised token as no fill rather than throwing", () => {
    const shd = el("w:shd", { "w:val": "somethingElse", "w:color": "ff0000" });
    expect(readCellShading(tcPr(shd))).toBeUndefined();
  });

  it('reads "auto"/"none" colours as unstated, matching w:color/@w:val\'s own convention', () => {
    const shd = el("w:shd", { "w:val": "clear", "w:fill": "auto" });
    expect(readCellShading(tcPr(shd))).toBeUndefined();
  });
});

describe("buildCellShading", () => {
  it('writes a solid fill as w:val="clear" with the colour in w:fill', () => {
    const built = buildCellShading({
      kind: "solid",
      color: { r: 1, g: 0, b: 0 },
    });
    expect(built.attributes).toEqual(
      expect.arrayContaining([
        { name: "w:val", value: "clear" },
        { name: "w:color", value: "auto" },
        { name: "w:fill", value: "ff0000" },
      ]),
    );
  });

  it("writes a pattern fill's own foreground/background colours into the <w:shd> readCellShading reads back", () => {
    const fill = {
      kind: "pattern" as const,
      patternType: "percent25" as const,
      foregroundColor: { r: 1, g: 0, b: 0 },
      backgroundColor: { r: 0, g: 0, b: 1 },
    };
    expect(readCellShading(tcPr(buildCellShading(fill)))).toEqual(fill);
  });

  it("writes a pattern fill leaving both colours unstated as automatic, which read back as absent", () => {
    const fill = {
      kind: "pattern" as const,
      patternType: "diagonalCross" as const,
    };
    expect(readCellShading(tcPr(buildCellShading(fill)))).toEqual(fill);
  });

  it("throws writing a SpreadsheetML-only pattern type ECMA-376's own ST_Shd vocabulary has no member for", () => {
    expect(() =>
      buildCellShading({ kind: "pattern", patternType: "gray125" }),
    ).toThrow(/gray125/);
  });
});
