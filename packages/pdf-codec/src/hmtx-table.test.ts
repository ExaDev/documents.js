import { describe, expect, it } from "vitest";
import { parseHmtx } from "./hmtx-table";
import { parseSfnt } from "./sfnt";
import { buildSfnt } from "./test-support/sfnt";
import { buildHheaTable, buildHmtxTable } from "./test-support/sfnt-tables";

function fontWith(
  numberOfHMetrics: number,
  advanceWidths: readonly number[],
): ReturnType<typeof parseSfnt> {
  return parseSfnt(
    buildSfnt(
      new Map([
        ["hhea", buildHheaTable(numberOfHMetrics)],
        ["hmtx", buildHmtxTable(advanceWidths)],
      ]),
    ),
  );
}

describe("parseHmtx", () => {
  it("reads each glyph's own advance width up to numberOfHMetrics", () => {
    const hmtx = parseHmtx(fontWith(3, [100, 200, 300])!);
    expect(hmtx.advanceWidth(0)).toBe(100);
    expect(hmtx.advanceWidth(1)).toBe(200);
    expect(hmtx.advanceWidth(2)).toBe(300);
  });

  it("reuses the last explicit entry's width for every glyph ID at or beyond numberOfHMetrics", () => {
    const hmtx = parseHmtx(fontWith(2, [100, 250])!);
    expect(hmtx.advanceWidth(2)).toBe(250);
    expect(hmtx.advanceWidth(9999)).toBe(250);
  });

  it("throws when the font has no hhea table", () => {
    const font = parseSfnt(
      buildSfnt(new Map([["hmtx", buildHmtxTable([100])]])),
    )!;
    expect(() => parseHmtx(font)).toThrow("font has no hhea/hmtx table");
  });

  it("throws when the font has no hmtx table", () => {
    const font = parseSfnt(buildSfnt(new Map([["hhea", buildHheaTable(1)]])))!;
    expect(() => parseHmtx(font)).toThrow("font has no hhea/hmtx table");
  });

  it("throws when hhea declares zero horizontal metrics", () => {
    const font = fontWith(0, [])!;
    expect(() => parseHmtx(font)).toThrow("font hhea numberOfHMetrics is zero");
  });
});
