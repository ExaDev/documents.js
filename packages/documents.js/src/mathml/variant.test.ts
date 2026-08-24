import { describe, expect, it } from "vitest";
import { mapMathVariant } from "./variant";

// Greek "symbol variant" base codepoints, confirmed against UnicodeData.txt (see variant.ts's own top-of-file generation note).
const EPSILON_SYMBOL = 0x3f5; // GREEK LUNATE EPSILON SYMBOL
const THETA_SYMBOL = 0x3d1; // GREEK THETA SYMBOL
const KAPPA_SYMBOL = 0x3f0; // GREEK KAPPA SYMBOL
const PHI_SYMBOL = 0x3d5; // GREEK PHI SYMBOL
const RHO_SYMBOL = 0x3f1; // GREEK RHO SYMBOL
const PI_SYMBOL = 0x3d6; // GREEK PI SYMBOL

describe("mapMathVariant: Greek symbol variants", () => {
  it("maps every symbol-variant base codepoint through bold to its confirmed Mathematical Alphanumeric Symbols codepoint", () => {
    expect(mapMathVariant(EPSILON_SYMBOL, "bold")).toBe(0x1d6dc);
    expect(mapMathVariant(THETA_SYMBOL, "bold")).toBe(0x1d6dd);
    expect(mapMathVariant(KAPPA_SYMBOL, "bold")).toBe(0x1d6de);
    expect(mapMathVariant(PHI_SYMBOL, "bold")).toBe(0x1d6df);
    expect(mapMathVariant(RHO_SYMBOL, "bold")).toBe(0x1d6e0);
    expect(mapMathVariant(PI_SYMBOL, "bold")).toBe(0x1d6e1);
  });

  it("maps every symbol-variant base codepoint through italic to its confirmed Mathematical Alphanumeric Symbols codepoint", () => {
    expect(mapMathVariant(EPSILON_SYMBOL, "italic")).toBe(0x1d716);
    expect(mapMathVariant(THETA_SYMBOL, "italic")).toBe(0x1d717);
    expect(mapMathVariant(KAPPA_SYMBOL, "italic")).toBe(0x1d718);
    expect(mapMathVariant(PHI_SYMBOL, "italic")).toBe(0x1d719);
    expect(mapMathVariant(RHO_SYMBOL, "italic")).toBe(0x1d71a);
    expect(mapMathVariant(PI_SYMBOL, "italic")).toBe(0x1d71b);
  });

  it("maps every symbol-variant base codepoint through bold-italic to its confirmed Mathematical Alphanumeric Symbols codepoint", () => {
    expect(mapMathVariant(EPSILON_SYMBOL, "bold-italic")).toBe(0x1d750);
    expect(mapMathVariant(THETA_SYMBOL, "bold-italic")).toBe(0x1d751);
    expect(mapMathVariant(KAPPA_SYMBOL, "bold-italic")).toBe(0x1d752);
    expect(mapMathVariant(PHI_SYMBOL, "bold-italic")).toBe(0x1d753);
    expect(mapMathVariant(RHO_SYMBOL, "bold-italic")).toBe(0x1d754);
    expect(mapMathVariant(PI_SYMBOL, "bold-italic")).toBe(0x1d755);
  });

  it("maps every symbol-variant base codepoint through bold-sans-serif to its confirmed Mathematical Alphanumeric Symbols codepoint", () => {
    expect(mapMathVariant(EPSILON_SYMBOL, "bold-sans-serif")).toBe(0x1d78a);
    expect(mapMathVariant(THETA_SYMBOL, "bold-sans-serif")).toBe(0x1d78b);
    expect(mapMathVariant(KAPPA_SYMBOL, "bold-sans-serif")).toBe(0x1d78c);
    expect(mapMathVariant(PHI_SYMBOL, "bold-sans-serif")).toBe(0x1d78d);
    expect(mapMathVariant(RHO_SYMBOL, "bold-sans-serif")).toBe(0x1d78e);
    expect(mapMathVariant(PI_SYMBOL, "bold-sans-serif")).toBe(0x1d78f);
  });

  it("maps every symbol-variant base codepoint through sans-serif-bold-italic to its confirmed Mathematical Alphanumeric Symbols codepoint", () => {
    expect(mapMathVariant(EPSILON_SYMBOL, "sans-serif-bold-italic")).toBe(
      0x1d7c4,
    );
    expect(mapMathVariant(THETA_SYMBOL, "sans-serif-bold-italic")).toBe(
      0x1d7c5,
    );
    expect(mapMathVariant(KAPPA_SYMBOL, "sans-serif-bold-italic")).toBe(
      0x1d7c6,
    );
    expect(mapMathVariant(PHI_SYMBOL, "sans-serif-bold-italic")).toBe(0x1d7c7);
    expect(mapMathVariant(RHO_SYMBOL, "sans-serif-bold-italic")).toBe(0x1d7c8);
    expect(mapMathVariant(PI_SYMBOL, "sans-serif-bold-italic")).toBe(0x1d7c9);
  });

  it("falls back to the base symbol codepoint unchanged for a variant with no Greek table at all (e.g. double-struck, script, fraktur, sans-serif)", () => {
    expect(mapMathVariant(EPSILON_SYMBOL, "double-struck")).toBe(
      EPSILON_SYMBOL,
    );
    expect(mapMathVariant(THETA_SYMBOL, "script")).toBe(THETA_SYMBOL);
    expect(mapMathVariant(KAPPA_SYMBOL, "fraktur")).toBe(KAPPA_SYMBOL);
    expect(mapMathVariant(PHI_SYMBOL, "sans-serif")).toBe(PHI_SYMBOL);
  });

  it("leaves a symbol-variant codepoint unchanged for mathvariant=normal", () => {
    expect(mapMathVariant(EPSILON_SYMBOL, "normal")).toBe(EPSILON_SYMBOL);
    expect(mapMathVariant(PI_SYMBOL, "normal")).toBe(PI_SYMBOL);
  });

  it("does not disturb the pre-existing ordinary Greek letter mapping (pi itself, distinct from the pi symbol)", () => {
    const ORDINARY_PI = 0x3c0; // GREEK SMALL LETTER PI
    expect(mapMathVariant(ORDINARY_PI, "bold")).toBe(0x1d6d1); // MATHEMATICAL BOLD SMALL PI
    expect(mapMathVariant(ORDINARY_PI, "bold")).not.toBe(
      mapMathVariant(PI_SYMBOL, "bold"),
    );
  });
});
