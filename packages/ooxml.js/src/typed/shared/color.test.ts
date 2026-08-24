import { describe, expect, it } from "vitest";
import { applyColorTransforms } from "./color";

// Ported verbatim from documents.js's src/model/color.test.ts. rgbHexToColor/colorToRgbHex/ColorSchema/COLOR_BLACK coverage now lives in document-schema.js's own test suite -- this file keeps only applyColorTransforms, the DrawingML-specific logic that stayed here.
describe("applyColorTransforms", () => {
  it("lumMod halves luminance for a fully-desaturated colour without touching hue/saturation", () => {
    const white = { r: 1, g: 1, b: 1 };
    expect(
      applyColorTransforms(white, [{ kind: "lumMod", value: 50_000 }]),
    ).toEqual({ r: 0.5, g: 0.5, b: 0.5 });
  });

  it("lumOff shifts luminance additively", () => {
    const black = { r: 0, g: 0, b: 0 };
    expect(
      applyColorTransforms(black, [{ kind: "lumOff", value: 25_000 }]),
    ).toEqual({ r: 0.25, g: 0.25, b: 0.25 });
  });

  it("shade darkens in linear (gamma-decoded) space, not by a naive direct multiply", () => {
    const white = { r: 1, g: 1, b: 1 };
    const result = applyColorTransforms(white, [
      { kind: "shade", value: 50_000 },
    ]);
    // A naive direct multiply would give exactly 0.5; the correct linear-space result is measurably higher.
    expect(result.r).toBeCloseTo(0.7353569830524495, 12);
    expect(result.r).not.toBeCloseTo(0.5, 2);
    expect(result.g).toBe(result.r);
    expect(result.b).toBe(result.r);
  });

  it("tint lightens in linear space, symmetric to shade for the opposite base colour", () => {
    const black = { r: 0, g: 0, b: 0 };
    const result = applyColorTransforms(black, [
      { kind: "tint", value: 50_000 },
    ]);
    expect(result.r).toBeCloseTo(0.7353569830524495, 12);
  });

  it("applies shade/tint before lumMod/lumOff regardless of array order", () => {
    const grey = { r: 0.5, g: 0.5, b: 0.5 };
    const orderA = applyColorTransforms(grey, [
      { kind: "lumMod", value: 80_000 },
      { kind: "shade", value: 60_000 },
    ]);
    const orderB = applyColorTransforms(grey, [
      { kind: "shade", value: 60_000 },
      { kind: "lumMod", value: 80_000 },
    ]);
    expect(orderA).toEqual(orderB);
  });

  it("returns the base colour unchanged for an empty transform list", () => {
    const color = { r: 0.2, g: 0.4, b: 0.6 };
    expect(applyColorTransforms(color, [])).toEqual(color);
  });

  it("clamps luminance to [0, 1] rather than overflowing", () => {
    const white = { r: 1, g: 1, b: 1 };
    const result = applyColorTransforms(white, [
      { kind: "lumMod", value: 200_000 },
    ]);
    expect(result).toEqual({ r: 1, g: 1, b: 1 });
  });
});
