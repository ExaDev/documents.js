import { describe, expect, it } from "vitest";
import type { GdefTable } from "./gdef-table";
import { glyphSkipper } from "./gsub-table";

// glyphSkipper pinned directly on its own class decisions: every flag/class combination through the exported predicate, rather than only through the ligature fixtures that exercise whole paths at a time. A mark-attachment type filter and the useMarkFilteringSet flag ride the same lookupFlag the shapers never spell in full.
describe("glyphSkipper", () => {
  function gdef(): GdefTable {
    // Classes: 10 base, 11 ligature, 12/13 marks (12 in attach class 1, 13 in class 2), 14 unclassified.
    const classes = new Map<number, number>([
      [10, 1],
      [11, 2],
      [12, 3],
      [13, 3],
    ]);
    const attach = new Map<number, number>([
      [12, 1],
      [13, 2],
    ]);
    return {
      glyphClass: (glyphId) => classes.get(glyphId) ?? 0,
      markAttachClass: (glyphId) => attach.get(glyphId) ?? 0,
    } as GdefTable;
  }

  it("skips nothing when the lookupFlag is zero, whatever the GDEF says", () => {
    const skip = glyphSkipper(0, 0, gdef());
    expect(skip(12)).toBe(false);
    expect(skip(10)).toBe(false);
  });

  it("skips only marks when only ignoreMarks is set", () => {
    const skip = glyphSkipper(0x0008, 0, gdef());
    expect(skip(12)).toBe(true);
    expect(skip(10)).toBe(false);
    expect(skip(11)).toBe(false);
    expect(skip(14)).toBe(false);
  });

  it("keeps the mark whose attachment class equals the flag's own high byte, skipping every other mark", () => {
    // High byte 1 (0x0100): mark attach class 1 stays visible, class 2 does not.
    const skip = glyphSkipper(0x0100, 0, gdef());
    expect(skip(12)).toBe(false);
    expect(skip(13)).toBe(true);
    expect(skip(10)).toBe(false);
  });

  it("skips a base glyph under ignoreBase and a ligature glyph under ignoreLigatures, each through its own flag", () => {
    const baseSkip = glyphSkipper(0x0002, 0, gdef());
    expect(baseSkip(10)).toBe(true);
    expect(baseSkip(11)).toBe(false);
    const ligatureSkip = glyphSkipper(0x0004, 0, gdef());
    expect(ligatureSkip(11)).toBe(true);
    expect(ligatureSkip(10)).toBe(false);
  });
});
