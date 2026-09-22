import { describe, expect, it } from "vitest";
import { FKP_PAGE_SIZE, PropertyBinTable } from "../prop/fkp";
import { buildBinTable } from "../test-support/fkp";
import { PARAGRAPH_MARK } from "./special";
import {
  computeCharacterProperties,
  noByteOffsetForCharacterMessage,
  noByteOffsetForParagraphMarkMessage,
  noByteOffsetForTrailingParagraphMessage,
  noOpenFieldWhileInInstructionMessage,
  splitEntriesByBoundaries,
  type ParagraphEntry,
  type ReadContext,
} from "./paragraphs";

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

describe("paragraphs.ts's own internal-defect messages", () => {
  // Every message named here is an invariant this module already maintains elsewhere in the same function, never one a caller's own input could violate — see each message function's own comment. Tested against a hardcoded duplicate of the exact text, the same discipline prop/fkp-write.ts's own internal-defect messages follow.
  it("carries noByteOffsetForParagraphMarkMessage's own exact text", () => {
    expect(noByteOffsetForParagraphMarkMessage(3)).toBe(
      "character 3 has no byte offset, so its paragraph's properties cannot be located",
    );
  });

  it("carries noByteOffsetForTrailingParagraphMessage's own exact text", () => {
    expect(noByteOffsetForTrailingParagraphMessage(7)).toBe(
      "character 7 has no byte offset, so the trailing paragraph's properties cannot be located",
    );
  });

  it("carries noByteOffsetForCharacterMessage's own exact text", () => {
    expect(noByteOffsetForCharacterMessage(9)).toBe(
      "character 9 of a paragraph has no byte offset, so its formatting cannot be located",
    );
  });

  it("carries noOpenFieldWhileInInstructionMessage's own exact text", () => {
    expect(noOpenFieldWhileInInstructionMessage()).toBe(
      "internal defect: inInstruction is true with no open field on the stack, but it is only ever set true in the same statement that pushes one",
    );
  });
});

describe("computeCharacterProperties", () => {
  // A ReadContext whose chpxTable/papxTable are never consulted by computeCharacterProperties itself (it takes grpprl and paragraphStyleCharacterPrls as plain arguments, never deriving them from these tables) — built from real PropertyBinTable instances anyway, since ReadContext's own type carries no looser alternative and constructing genuine (if otherwise-unused) ones costs nothing here.
  function unusedBinTable(): PropertyBinTable {
    return new PropertyBinTable(
      new Uint8Array(FKP_PAGE_SIZE),
      buildBinTable([0, FKP_PAGE_SIZE], [0]),
      "unused",
    );
  }

  it("caches its own returned result on context.characterProperties under the given key", () => {
    const context: ReadContext = {
      chpxTable: unusedBinTable(),
      papxTable: unusedBinTable(),
      styles: undefined,
      fonts: undefined,
      characterProperties: new Map(),
      dataStream: undefined,
    };
    const result = computeCharacterProperties("k", undefined, [], context);
    expect(context.characterProperties.get("k")).toBe(result);
  });
});
