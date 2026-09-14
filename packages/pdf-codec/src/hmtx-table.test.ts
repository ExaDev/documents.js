import { describe, expect, it } from "vitest";
import { parseHmtx } from "./hmtx-table";
import { parseSfnt } from "./sfnt";
import { buildSfnt } from "./test-support/sfnt";

// A minimal 'hhea' (ISO/IEC 14496-22 clause 5.2.3): only numberOfHMetrics, at its real byte offset 34, is meaningful here.
function buildHheaBytes(numberOfHMetrics: number): Uint8Array<ArrayBuffer> {
  const table = new Uint8Array(36);
  new DataView(table.buffer).setUint16(34, numberOfHMetrics);
  return table;
}

// A minimal 'hmtx' (clause 5.2.4): one 4-byte longHorMetric (advanceWidth uint16, leftSideBearing int16) per declared metric, in order.
function buildHmtxBytes(
  advanceWidths: readonly number[],
): Uint8Array<ArrayBuffer> {
  const table = new Uint8Array(advanceWidths.length * 4);
  const view = new DataView(table.buffer);
  advanceWidths.forEach((width, index) => {
    view.setUint16(index * 4, width);
  });
  return table;
}

function fontWith(
  numberOfHMetrics: number,
  advanceWidths: readonly number[],
): ReturnType<typeof parseSfnt> {
  return parseSfnt(
    buildSfnt(
      new Map([
        ["hhea", buildHheaBytes(numberOfHMetrics)],
        ["hmtx", buildHmtxBytes(advanceWidths)],
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
      buildSfnt(new Map([["hmtx", buildHmtxBytes([100])]])),
    )!;
    expect(() => parseHmtx(font)).toThrow("font has no hhea/hmtx table");
  });

  it("throws when the font has no hmtx table", () => {
    const font = parseSfnt(buildSfnt(new Map([["hhea", buildHheaBytes(1)]])))!;
    expect(() => parseHmtx(font)).toThrow("font has no hhea/hmtx table");
  });

  it("throws when hhea declares zero horizontal metrics", () => {
    const font = fontWith(0, [])!;
    expect(() => parseHmtx(font)).toThrow("font hhea numberOfHMetrics is zero");
  });
});
