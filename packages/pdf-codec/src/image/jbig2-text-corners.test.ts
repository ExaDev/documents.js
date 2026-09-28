import { describe, expect, it, vi } from "vitest";

// The T.88 RTCORNER code table pinned entry for entry. Each code names one of the four combinations of bottom-half/right-half reference-corner selection (T.88 6.5.8.2.3's own two-bit enumeration), and every entry is a load-bearing pair: flipping either flag moves where a refinement places its reference bitmap, which shifts every refined symbol instance the text region draws. The literals below are an independent transcription of the table, not a re-import of the module under test, loaded by dynamic import inside the test so each entry's execution lands on this test's own coverage record (a table entry executes at module load, when no test is active).
describe("referenceCornerFromCode", () => {
  it("answers each of the four codes with its own corner selection", async () => {
    vi.resetModules();
    const { referenceCornerFromCode } = await import("./jbig2-text");
    expect(referenceCornerFromCode(0)).toEqual({ right: false, bottom: true });
    expect(referenceCornerFromCode(1)).toEqual({ right: false, bottom: false });
    expect(referenceCornerFromCode(2)).toEqual({ right: true, bottom: true });
    expect(referenceCornerFromCode(3)).toEqual({ right: true, bottom: false });
  });

  it("answers undefined outside the table on either side", async () => {
    vi.resetModules();
    const { referenceCornerFromCode } = await import("./jbig2-text");
    expect(referenceCornerFromCode(-1)).toBeUndefined();
    expect(referenceCornerFromCode(4)).toBeUndefined();
  });
});

// The IAID symbol-code width: a bit count computed by doubling, never by log2, so no rounding sits between a symbol count and its width. Pinned at both boundaries a log-based implementation gets wrong.
describe("symbolCodeLength", () => {
  it("floors at one bit for a one-symbol dictionary", async () => {
    vi.resetModules();
    const { symbolCodeLength } = await import("./jbig2-text");
    expect(symbolCodeLength(1)).toBe(1);
  });

  it("widens exactly when the count passes each power of two", async () => {
    vi.resetModules();
    const { symbolCodeLength } = await import("./jbig2-text");
    expect(symbolCodeLength(2)).toBe(1);
    expect(symbolCodeLength(3)).toBe(2);
    expect(symbolCodeLength(4)).toBe(2);
    expect(symbolCodeLength(5)).toBe(3);
  });
});
