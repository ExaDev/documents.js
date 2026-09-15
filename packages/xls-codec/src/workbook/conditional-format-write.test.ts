import { describe, expect, it } from "vitest";

import {
  boundingBoxOf,
  relativeCellRef,
  textRuleFormula,
} from "./conditional-format-write";

const ANCHOR = { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 };

describe("relativeCellRef", () => {
  it("names a single-letter column for indices 0-25", () => {
    expect(relativeCellRef(0, 0)).toBe("A1");
    expect(relativeCellRef(0, 25)).toBe("Z1");
  });

  it("names a two-letter column once the index runs past Z, exercising the loop more than once", () => {
    expect(relativeCellRef(0, 26)).toBe("AA1");
    expect(relativeCellRef(0, 27)).toBe("AB1");
    expect(relativeCellRef(0, 51)).toBe("AZ1");
  });

  it("names a three-letter column, the loop running a third time", () => {
    expect(relativeCellRef(0, 702)).toBe("AAA1");
  });

  it("states the row as one-based", () => {
    expect(relativeCellRef(9, 0)).toBe("A10");
  });
});

describe("boundingBoxOf", () => {
  it("takes the tightest rectangle across several ranges, not just the first or the union of extremes each range states independently", () => {
    const box = boundingBoxOf({
      type: "aboveAverage",
      ranges: [
        { startRow: 5, endRow: 10, startColumn: 3, endColumn: 3 },
        { startRow: 0, endRow: 2, startColumn: 8, endColumn: 20 },
        { startRow: 7, endRow: 7, startColumn: 1, endColumn: 1 },
      ],
    });
    expect(box).toStrictEqual({
      startRow: 0,
      endRow: 10,
      startColumn: 1,
      endColumn: 20,
    });
  });
});

describe("textRuleFormula", () => {
  it("states a distinct formula shape per rule kind, not a shape shared by falling through to the next case", () => {
    expect(
      textRuleFormula(
        { type: "containsText", ranges: [ANCHOR], text: "needle" },
        ANCHOR,
      ),
    ).toBe('NOT(ISERROR(SEARCH("needle",A1)))');
    expect(
      textRuleFormula(
        { type: "notContainsText", ranges: [ANCHOR], text: "needle" },
        ANCHOR,
      ),
    ).toBe('ISERROR(SEARCH("needle",A1))');
    expect(
      textRuleFormula(
        { type: "beginsWith", ranges: [ANCHOR], text: "needle" },
        ANCHOR,
      ),
    ).toBe('LEFT(A1,LEN("needle"))="needle"');
    expect(
      textRuleFormula(
        { type: "endsWith", ranges: [ANCHOR], text: "needle" },
        ANCHOR,
      ),
    ).toBe('RIGHT(A1,LEN("needle"))="needle"');
  });
});
