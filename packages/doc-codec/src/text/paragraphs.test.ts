import { describe, expect, it } from "vitest";
import { PARAGRAPH_MARK } from "./special";
import { splitEntriesByBoundaries, type ParagraphEntry } from "./paragraphs";

function entry(endCp: number): ParagraphEntry {
  return {
    blocks: [{ kind: "paragraph", runs: [] }],
    properties: {},
    grpprl: [],
    terminator: PARAGRAPH_MARK,
    endCp,
  };
}

describe("splitEntriesByBoundaries", () => {
  it("splits entries into groups at each boundary", () => {
    const entries = [entry(3), entry(6), entry(10)];
    const groups = splitEntriesByBoundaries(entries, [0, 6, 10]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual([entries[0], entries[1]]);
    expect(groups[1]).toEqual([entries[2]]);
  });

  it("produces one fewer group than the boundary array's own length", () => {
    const groups = splitEntriesByBoundaries([], [0, 5, 10, 15]);
    expect(groups).toHaveLength(3);
  });

  it("skips a zero-width leading group before any entry is assigned", () => {
    const entries = [entry(5)];
    // boundaries[0] === boundaries[1] (both 0): the first group is empty and must be skipped, landing the one entry in the second group.
    const groups = splitEntriesByBoundaries(entries, [0, 0, 5]);
    expect(groups[0]).toEqual([]);
    expect(groups[1]).toEqual(entries);
  });

  it("skips several consecutive zero-width groups in a row", () => {
    const entries = [entry(5)];
    const groups = splitEntriesByBoundaries(entries, [0, 0, 0, 0, 5]);
    expect(groups).toHaveLength(4);
    expect(groups[0]).toEqual([]);
    expect(groups[1]).toEqual([]);
    expect(groups[2]).toEqual([]);
    expect(groups[3]).toEqual(entries);
  });

  it("skips a zero-width group between two non-empty groups", () => {
    const entries = [entry(3), entry(6)];
    // Group [3,3) is empty; the second entry (endCp 6) lands in the group after it, [3,6).
    const groups = splitEntriesByBoundaries(entries, [0, 3, 3, 6]);
    expect(groups).toHaveLength(3);
    expect(groups[0]).toEqual([entries[0]]);
    expect(groups[1]).toEqual([]);
    expect(groups[2]).toEqual([entries[1]]);
  });

  it("drops an entry past the final boundary rather than folding it into the last group", () => {
    const entries = [entry(3), entry(10)];
    // Only one group, [0,3): the second entry's endCp (10) never matches boundaries[1], so index never advances and every subsequent entry is dropped once groups are exhausted.
    const groups = splitEntriesByBoundaries(entries, [0, 3]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual([entries[0]]);
  });

  it("returns no groups at all for a boundary array of length one", () => {
    const groups = splitEntriesByBoundaries([entry(5)], [0]);
    expect(groups).toEqual([]);
  });

  it("returns no groups for an empty boundary array", () => {
    const groups = splitEntriesByBoundaries([entry(5)], []);
    expect(groups).toEqual([]);
  });

  it("returns an empty group rather than throwing when given no entries at all", () => {
    const groups = splitEntriesByBoundaries([], [0, 5]);
    expect(groups).toEqual([[]]);
  });
});
