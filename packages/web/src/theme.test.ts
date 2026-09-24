import { describe, expect, it } from "vitest";

import { theme } from "./theme";

// The scales are meant to be read off a grid and off a ratio, not memorised. These assert those two properties rather than restating each value, so a deliberate re-tuning of the scale stays a one-line change while a step that quietly breaks the grid, or a heading that is no smaller than the one above it, fails here.
const SPACING_ORDER = ["xs", "sm", "md", "lg", "xl"] as const;
const HEADING_ORDER = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

// The grid the spacing scale is laid out on. Every step is a whole multiple of it, which is what stops two adjacent steps landing close enough together to be indistinguishable on screen.
const GRID_PX = 4;

// Every length in the theme is authored in rem against the browser's own default root size, which is what makes a step scale with a reader's font-size preference rather than pinning it to a device pixel.
const ROOT_FONT_SIZE_PX = 16;

// The two CSS font-weight keywords a heading sits between: `normal` is what body text renders at, `bold` is Mantine's own heading default and the weight this theme deliberately steps back from.
const REGULAR_WEIGHT = 400;
const BOLD_WEIGHT = 700;

function toPixels(length: string): number {
  expect(length).toMatch(/rem$/);
  return Number.parseFloat(length) * ROOT_FONT_SIZE_PX;
}

describe("theme spacing", () => {
  it("places every step on the grid", () => {
    for (const step of SPACING_ORDER) {
      const pixels = toPixels(theme.spacing[step]);
      expect(pixels % GRID_PX).toBe(0);
    }
  });

  it("orders the steps so each is strictly larger than the one before it", () => {
    const pixels = SPACING_ORDER.map((step) => toPixels(theme.spacing[step]));
    expect(pixels).toStrictEqual([...pixels].sort((a, b) => a - b));
    expect(new Set(pixels).size).toBe(pixels.length);
  });
});

describe("theme headings", () => {
  it("orders the levels so each is strictly smaller than the one above it", () => {
    const pixels = HEADING_ORDER.map((level) =>
      toPixels(theme.headings.sizes[level].fontSize),
    );
    expect(pixels).toStrictEqual([...pixels].sort((a, b) => b - a));
    expect(new Set(pixels).size).toBe(pixels.length);
  });

  it("weights a heading between body text and bold, so it reads as a label rather than a banner", () => {
    const headingWeight = Number(theme.headings.fontWeight);
    expect(headingWeight).toBeGreaterThan(REGULAR_WEIGHT);
    expect(headingWeight).toBeLessThan(BOLD_WEIGHT);
  });

  it("gives every level a line height tighter than body text, since a heading is one or two lines rather than a paragraph", () => {
    const bodyLineHeight = Number.parseFloat(theme.lineHeights.md);
    for (const level of HEADING_ORDER) {
      const { lineHeight } = theme.headings.sizes[level];
      expect(Number.parseFloat(lineHeight)).toBeLessThan(bodyLineHeight);
    }
  });
});
