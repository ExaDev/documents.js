import { describe, expect, it, vi } from "vitest";
import { STANDARD_METRICS, widthOfCode } from "./afm-widths";
import { WINANSI_GLYPH_NAMES } from "./encoding";

// Spot-check values against the published Adobe Core-14 AFM data (cross-verified during implementation against the Hopding/standard-fonts mirror — see the module's own provenance comment), not trusted from memory alone.
describe("STANDARD_METRICS spot checks", () => {
  it("Helvetica: space=278, A=667, M=833, W=944, i=222", () => {
    const w = STANDARD_METRICS.Helvetica.widths;
    expect(w.get("space")).toBe(278);
    expect(w.get("A")).toBe(667);
    expect(w.get("M")).toBe(833);
    expect(w.get("W")).toBe(944);
    expect(w.get("i")).toBe(222);
  });

  it("Times-Roman: space=250, A=722", () => {
    const w = STANDARD_METRICS["Times-Roman"].widths;
    expect(w.get("space")).toBe(250);
    expect(w.get("A")).toBe(722);
  });

  it("every Courier face is a fixed 600 units wide", () => {
    for (const face of [
      "Courier",
      "Courier-Bold",
      "Courier-Oblique",
      "Courier-BoldOblique",
    ] as const) {
      expect(STANDARD_METRICS[face].fixedWidth).toBe(600);
    }
  });

  it("Helvetica ascender/descender/capHeight/xHeight/underline metrics match the AFM", () => {
    const m = STANDARD_METRICS.Helvetica;
    expect(m.ascender).toBe(718);
    expect(m.descender).toBe(-207);
    expect(m.capHeight).toBe(718);
    expect(m.xHeight).toBe(523);
    expect(m.underlinePosition).toBe(-100);
    expect(m.underlineThickness).toBe(50);
  });

  it("every WinAnsi code 32-255 with a non-empty glyph name resolves to a width for every proportional face", () => {
    const proportionalFaces = [
      "Helvetica",
      "Helvetica-Bold",
      "Helvetica-Oblique",
      "Helvetica-BoldOblique",
      "Times-Roman",
      "Times-Bold",
      "Times-Italic",
      "Times-BoldItalic",
    ] as const;
    for (const face of proportionalFaces) {
      for (let code = 32; code < 256; code++) {
        const glyphName = WINANSI_GLYPH_NAMES[code];
        if (glyphName === undefined || glyphName === "") {
          continue;
        }
        expect(STANDARD_METRICS[face].widths.get(glyphName)).toBeDefined();
      }
    }
  });
});

describe("widthOfCode", () => {
  it("returns the fixed width for Courier regardless of code", () => {
    expect(widthOfCode("Courier", 65)).toBe(600);
    expect(widthOfCode("Courier", 105)).toBe(600);
  });

  it("returns the fixed width without ever consulting the per-glyph AFM table for a monospace face", () => {
    const getSpy = vi.spyOn(STANDARD_METRICS.Courier.widths, "get");
    expect(widthOfCode("Courier", 65)).toBe(600);
    expect(getSpy).not.toHaveBeenCalled();
    getSpy.mockRestore();
  });

  it("returns the AFM width for a proportional face", () => {
    expect(widthOfCode("Helvetica", 65)).toBe(667); // 'A'
  });

  it("throws for a code with no WinAnsi glyph mapping", () => {
    expect(() => widthOfCode("Helvetica", 1)).toThrow(/WinAnsi/);
  });

  it("throws naming the face, glyph, and code when a face's own AFM table is genuinely missing a glyph its widths map should carry", () => {
    // Every real standard-14 AFM defines a width for every WinAnsi-mapped glyph (proved by the spot-check above), so this path is unreachable through the public API with real data — it exists as a caller-invariant guard against a future data gap, per the function's own doc comment. STANDARD_METRICS is exported specifically so a test can reach behind that invariant and exercise the guard directly, deleting one real entry and restoring it immediately after. The cast undoes only this module's own `ReadonlyMap` return type, which exists to stop ordinary callers mutating shared metrics — the backing object is a genuine mutable Map, and this test's whole point is temporarily mutating it.
    const widths = STANDARD_METRICS.Helvetica.widths as Map<string, number>;
    const original = widths.get("A");
    widths.delete("A");
    try {
      expect(() => widthOfCode("Helvetica", 65)).toThrow(
        "Helvetica has no AFM width for glyph 'A' (code 65)",
      );
    } finally {
      widths.set("A", original!);
    }
  });
});
