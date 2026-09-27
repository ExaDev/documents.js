import { describe, expect, it, vi } from "vitest";

// The T.88 template tables pinned entry for entry in their published orderings (Figures 4-7 for generic, 12-13 for refinement): a template's SET of positions is what decodes correctly, but its ORDER ties the generic context numbering to GENERIC_SLTP_CONTEXT and the refinement AT defaults, so a reordered or shifted entry is a real regression even when decoding happens to survive it. The literals below are an independent transcription of the figures, not a re-import of the module under test, with the refinement constructors expanded into plain objects so the pin shares no helper with the module. Loaded by dynamic import inside each test for the same per-test-coverage reason as the glyph-table pin: a table entry is code that executes at module load, and a top-level import records it while no test is active, leaving the pin never selected against an entry mutant.
describe("GENERIC_TEMPLATES", () => {
  it("matches the T.88 Figures 4-7 orderings", async () => {
    vi.resetModules();
    const { GENERIC_TEMPLATES } = await import("./jbig2-generic");
    expect(GENERIC_TEMPLATES).toEqual([
      [
        { kind: "at", index: 3 },
        { kind: "fixed", dx: -1, dy: -2 },
        { kind: "fixed", dx: 0, dy: -2 },
        { kind: "fixed", dx: 1, dy: -2 },
        { kind: "at", index: 2 },
        { kind: "at", index: 1 },
        { kind: "fixed", dx: -2, dy: -1 },
        { kind: "fixed", dx: -1, dy: -1 },
        { kind: "fixed", dx: 0, dy: -1 },
        { kind: "fixed", dx: 1, dy: -1 },
        { kind: "fixed", dx: 2, dy: -1 },
        { kind: "at", index: 0 },
        { kind: "fixed", dx: -4, dy: 0 },
        { kind: "fixed", dx: -3, dy: 0 },
        { kind: "fixed", dx: -2, dy: 0 },
        { kind: "fixed", dx: -1, dy: 0 },
      ],
      [
        { kind: "fixed", dx: -1, dy: -2 },
        { kind: "fixed", dx: 0, dy: -2 },
        { kind: "fixed", dx: 1, dy: -2 },
        { kind: "fixed", dx: 2, dy: -2 },
        { kind: "fixed", dx: -2, dy: -1 },
        { kind: "fixed", dx: -1, dy: -1 },
        { kind: "fixed", dx: 0, dy: -1 },
        { kind: "fixed", dx: 1, dy: -1 },
        { kind: "fixed", dx: 2, dy: -1 },
        { kind: "at", index: 0 },
        { kind: "fixed", dx: -3, dy: 0 },
        { kind: "fixed", dx: -2, dy: 0 },
        { kind: "fixed", dx: -1, dy: 0 },
      ],
      [
        { kind: "fixed", dx: -1, dy: -2 },
        { kind: "fixed", dx: 0, dy: -2 },
        { kind: "fixed", dx: 1, dy: -2 },
        { kind: "fixed", dx: -2, dy: -1 },
        { kind: "fixed", dx: -1, dy: -1 },
        { kind: "fixed", dx: 0, dy: -1 },
        { kind: "fixed", dx: 1, dy: -1 },
        { kind: "at", index: 0 },
        { kind: "fixed", dx: -2, dy: 0 },
        { kind: "fixed", dx: -1, dy: 0 },
      ],
      [
        { kind: "fixed", dx: -3, dy: -1 },
        { kind: "fixed", dx: -2, dy: -1 },
        { kind: "fixed", dx: -1, dy: -1 },
        { kind: "fixed", dx: 0, dy: -1 },
        { kind: "fixed", dx: 1, dy: -1 },
        { kind: "at", index: 0 },
        { kind: "fixed", dx: -4, dy: 0 },
        { kind: "fixed", dx: -3, dy: 0 },
        { kind: "fixed", dx: -2, dy: 0 },
        { kind: "fixed", dx: -1, dy: 0 },
      ],
    ]);
  });
});

describe("REFINEMENT_TEMPLATES", () => {
  it("matches the T.88 Figures 12-13 orderings", async () => {
    vi.resetModules();
    const { REFINEMENT_TEMPLATES } = await import("./jbig2-generic");
    expect(REFINEMENT_TEMPLATES).toEqual([
      [
        { source: "destination", dx: 0, dy: -1 },
        { source: "destination", dx: 1, dy: -1 },
        { source: "destination", dx: -1, dy: 0 },
        { source: "destination-at", index: 0 },
        { source: "reference", dx: 0, dy: -1 },
        { source: "reference", dx: 1, dy: -1 },
        { source: "reference", dx: -1, dy: 0 },
        { source: "reference", dx: 0, dy: 0 },
        { source: "reference", dx: 1, dy: 0 },
        { source: "reference", dx: -1, dy: 1 },
        { source: "reference", dx: 0, dy: 1 },
        { source: "reference", dx: 1, dy: 1 },
        { source: "reference-at", index: 1 },
      ],
      [
        { source: "destination", dx: -1, dy: -1 },
        { source: "destination", dx: 0, dy: -1 },
        { source: "destination", dx: 1, dy: -1 },
        { source: "destination", dx: -1, dy: 0 },
        { source: "reference", dx: 0, dy: -1 },
        { source: "reference", dx: -1, dy: 0 },
        { source: "reference", dx: 0, dy: 0 },
        { source: "reference", dx: 1, dy: 0 },
        { source: "reference", dx: 0, dy: 1 },
        { source: "reference", dx: 1, dy: 1 },
      ],
    ]);
  });
});

describe("NOMINAL_REFINEMENT_AT", () => {
  it("matches the nominal adaptive-pixel offsets T.88 states", async () => {
    vi.resetModules();
    const { NOMINAL_REFINEMENT_AT } = await import("./jbig2-generic");
    expect(NOMINAL_REFINEMENT_AT).toEqual([
      { x: -1, y: -1 },
      { x: -1, y: -1 },
    ]);
  });
});
