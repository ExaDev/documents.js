import { describe, expect, it } from "vitest";
import { boundedAt, boundedText, textItem } from "./pdf-region-fixtures";

// Direct coverage for the fixture-building helpers in pdf-region-fixtures.ts themselves: every real caller only inspects the geometry (bounds/width) these helpers produce, never the placeholder text content, so a corrupted default text value would pass unnoticed.

describe("boundedAt", () => {
  it("wraps a real text item, not an empty placeholder, so its own item content is genuinely a line of text", () => {
    const bounded = boundedAt({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
    expect(bounded.item.kind).toBe("text");
    expect((bounded.item as { text: string }).text).toBe("x");
  });
});

describe("boundedText", () => {
  it("defaults the item's own text to 'cell' when none is given", () => {
    const bounded = boundedText(0, 0);
    expect((bounded.item as { text: string }).text).toBe("cell");
  });

  it("carries an explicit text through unchanged, not the default", () => {
    const bounded = boundedText(0, 0, "explicit");
    expect((bounded.item as { text: string }).text).toBe("explicit");
  });
});

describe("textItem", () => {
  it("carries a real, non-empty placeholder text, not an empty string", () => {
    const widthPt = 10;
    const item = textItem(0, widthPt);
    expect(item.text).toBe("x");
  });
});
