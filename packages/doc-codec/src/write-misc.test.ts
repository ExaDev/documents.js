import { describe, expect, it } from "vitest";
import { readDocContent } from "./read";
import { MAX_TABLE_ROW_CELLS } from "./table/tap-write";
import {
  DISTRIBUTE_LOST_BOUNDARIES_FEWER_BUCKETS_MESSAGE,
  EMPTY_COLUMN_BOUNDARY_ARRAY_MESSAGE,
  exceedsMaxTableRowCells,
  LOST_BOUNDARIES_FEWER_ROW_BUCKETS_MESSAGE,
} from "./table/write";
import { PARAGRAPH_MARK } from "./text/special";
import {
  CLOSE_SECTION_TRAILING_PARAGRAPH_LOST_MESSAGE,
  EMPTY_SECTION_LIST_MESSAGE,
  layoutParagraphText,
  mergeChpxRuns,
  NO_ILFO_MINTED_MESSAGE,
  PARAGRAPH_ISTD_LOST_MESSAGE,
  PARAGRAPH_START_LOST_MESSAGE,
  sameGrpprl,
  SECTION_START_CP_LOST_MESSAGE,
  SEPX_PLACEMENT_LOST_MESSAGE,
  writeDocContent,
} from "./write";
describe("writeDocContent: hyperlinks (#1187)", () => {
  it("round-trips a hyperlink run as a HYPERLINK field whose result carries the uri", () => {
    const bytes = writeDocContent({
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [
            {
              kind: "paragraph",
              runs: [
                { text: "see " },
                { text: "the site", hyperlink: "https://example.com/x" },
                { text: " for more" },
              ],
            },
          ],
        },
      ],
    });
    const reread = readDocContent(bytes);
    if (reread.kind !== "wordprocessing") {
      throw new Error("a .doc always reads back as a wordprocessing document");
    }
    expect(reread.sections[0]?.blocks[0]).toMatchObject({
      kind: "paragraph",
      runs: [
        { text: "see " },
        { text: "the site", hyperlink: "https://example.com/x" },
        { text: " for more" },
      ],
    });
  });

  it("joins consecutive same-uri runs into one field and splits at a differing uri", () => {
    const bytes = writeDocContent({
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [
            {
              kind: "paragraph",
              runs: [
                { text: "one", hyperlink: "https://a.example/" },
                { text: "two", hyperlink: "https://a.example/" },
                { text: "three", hyperlink: "https://b.example/" },
              ],
            },
          ],
        },
      ],
    });
    const reread = readDocContent(bytes);
    if (reread.kind !== "wordprocessing") {
      throw new Error("a .doc always reads back as a wordprocessing document");
    }
    expect(reread.sections[0]?.blocks[0]).toMatchObject({
      kind: "paragraph",
      runs: [
        { text: "onetwo", hyperlink: "https://a.example/" },
        { text: "three", hyperlink: "https://b.example/" },
      ],
    });
  });
});

// Every one of these names an invariant writeDocContent's own logic maintains, never one a caller's input could violate — no real call through writeDocContent's own public surface can ever reach the assertDefined each one guards (see write.ts's own top comment for why). Asserted against a hardcoded duplicate rather than by importing and comparing a constant to itself, the same discipline errors.test.ts's own assertDefined tests follow — otherwise a mutant emptying the constant's own declaration would still pass, since both sides of the comparison would be the identical mutated value.
describe("writeDocContent's own internal-defect messages", () => {
  it("names the numId NO_ILFO_MINTED_MESSAGE reports, JSON-quoted", () => {
    expect(NO_ILFO_MINTED_MESSAGE("3")).toBe(
      'internal defect: writeDocContent\'s own list-usage map has no ilfo minted for numId "3"',
    );
  });

  it("carries PARAGRAPH_START_LOST_MESSAGE's own exact text", () => {
    expect(PARAGRAPH_START_LOST_MESSAGE).toBe(
      "internal defect: writeDocContent lost a paragraph's own start position",
    );
  });

  it("carries PARAGRAPH_ISTD_LOST_MESSAGE's own exact text", () => {
    expect(PARAGRAPH_ISTD_LOST_MESSAGE).toBe(
      "internal defect: writeDocContent lost a paragraph's own minted istd",
    );
  });

  it("carries EMPTY_SECTION_LIST_MESSAGE's own exact text", () => {
    expect(EMPTY_SECTION_LIST_MESSAGE).toBe(
      "internal defect: writeDocContent built an empty section list despite the earlier at-least-one-section guard",
    );
  });

  it("names the section index SEPX_PLACEMENT_LOST_MESSAGE reports", () => {
    expect(SEPX_PLACEMENT_LOST_MESSAGE(2)).toBe(
      "internal defect: writeDocContent lost section 2's own Sepx placement",
    );
  });

  it("names the section index SECTION_START_CP_LOST_MESSAGE reports", () => {
    expect(SECTION_START_CP_LOST_MESSAGE(1)).toBe(
      "internal defect: writeDocContent lost section 1's own start CP",
    );
  });

  it("carries CLOSE_SECTION_TRAILING_PARAGRAPH_LOST_MESSAGE's own exact text", () => {
    expect(CLOSE_SECTION_TRAILING_PARAGRAPH_LOST_MESSAGE).toBe(
      "internal defect: closeSection lost its own just-ensured trailing paragraph",
    );
  });

  it("carries DISTRIBUTE_LOST_BOUNDARIES_FEWER_BUCKETS_MESSAGE's own exact text", () => {
    expect(DISTRIBUTE_LOST_BOUNDARIES_FEWER_BUCKETS_MESSAGE).toBe(
      "internal defect: distributeLostBoundaries built fewer row buckets than the row count it was given",
    );
  });

  it("carries EMPTY_COLUMN_BOUNDARY_ARRAY_MESSAGE's own exact text", () => {
    expect(EMPTY_COLUMN_BOUNDARY_ARRAY_MESSAGE).toBe(
      "internal defect: a table's own column-boundary array is empty despite the columnCount guard above",
    );
  });

  it("carries LOST_BOUNDARIES_FEWER_ROW_BUCKETS_MESSAGE's own exact text", () => {
    expect(LOST_BOUNDARIES_FEWER_ROW_BUCKETS_MESSAGE).toBe(
      "internal defect: distributeLostBoundaries returned fewer buckets than the table has rows",
    );
  });

  it("treats exactly MAX_TABLE_ROW_CELLS as still fitting, one cell more as exceeding it", () => {
    // rowSplitFits' own note explains why no real trial from flattenTable's own splitting search ever reaches this ceiling in practice; exercised directly here so the boundary itself (63 fits, 64 does not) stays pinned regardless.
    expect(exceedsMaxTableRowCells(MAX_TABLE_ROW_CELLS)).toBe(false);
    expect(exceedsMaxTableRowCells(MAX_TABLE_ROW_CELLS + 1)).toBe(true);
  });
});

describe("layoutParagraphText", () => {
  it("lays out a single plain-text paragraph, its own last run's exception extended over its terminator", () => {
    const { text, paragraphStarts, chpxRuns } = layoutParagraphText([
      { runs: [{ text: "Hi", grpprl: [] }], terminator: PARAGRAPH_MARK },
    ]);
    expect(text).toBe("Hi\r");
    expect(paragraphStarts).toEqual([0]);
    expect(chpxRuns).toEqual([{ start: 0, end: 3, grpprl: undefined }]);
  });

  it("extends a formatted run's own exception over its paragraph's terminator, rather than adding a second one", () => {
    const boldGrpprl = [1, 2, 3];
    const { chpxRuns } = layoutParagraphText([
      {
        runs: [{ text: "Hi", grpprl: boldGrpprl }],
        terminator: PARAGRAPH_MARK,
      },
    ]);
    expect(chpxRuns).toEqual([{ start: 0, end: 3, grpprl: boldGrpprl }]);
  });

  it("gives a paragraph with no runs of its own a fresh, plain exception for its terminator alone", () => {
    // No run at all means chpxRuns is still empty when the mark is reached — lastRun is undefined, so the extension check can never match, and the mark gets pushed as its own one-character exception rather than extending nothing.
    const { chpxRuns } = layoutParagraphText([
      { runs: [], terminator: PARAGRAPH_MARK },
    ]);
    expect(chpxRuns).toEqual([{ start: 0, end: 1, grpprl: undefined }]);
  });

  it("skips a run whose own text is empty, adding no Chpx exception for it at all", () => {
    const { text, chpxRuns } = layoutParagraphText([
      {
        runs: [
          { text: "", grpprl: [9] },
          { text: "Body", grpprl: [] },
        ],
        terminator: PARAGRAPH_MARK,
      },
    ]);
    expect(text).toBe("Body\r");
    expect(chpxRuns).toEqual([{ start: 0, end: 5, grpprl: undefined }]);
  });

  it("records each paragraph's own start position, across more than one paragraph", () => {
    const { paragraphStarts } = layoutParagraphText([
      { runs: [{ text: "AB", grpprl: [] }], terminator: PARAGRAPH_MARK },
      { runs: [{ text: "C", grpprl: [] }], terminator: PARAGRAPH_MARK },
    ]);
    expect(paragraphStarts).toEqual([0, 3]);
  });

  it("uses each paragraph's own terminator character, not always the ordinary paragraph mark", () => {
    const { text } = layoutParagraphText([
      { runs: [{ text: "Row", grpprl: [] }], terminator: 0x07 },
    ]);
    expect(text).toBe("Row");
  });
});

describe("sameGrpprl", () => {
  it("treats two absent grpprls as the same formatting", () => {
    expect(sameGrpprl(undefined, undefined)).toBe(true);
  });

  it("treats an absent grpprl and a present one as different, in either direction", () => {
    expect(sameGrpprl(undefined, [1])).toBe(false);
    expect(sameGrpprl([1], undefined)).toBe(false);
  });

  it("treats two byte-identical grpprls as the same formatting", () => {
    expect(sameGrpprl([1, 2, 3], [1, 2, 3])).toBe(true);
  });

  it("treats grpprls of equal length but differing bytes as different", () => {
    expect(sameGrpprl([1, 2], [1, 3])).toBe(false);
  });

  it("treats grpprls of differing length as different, regardless of which is longer", () => {
    expect(sameGrpprl([1, 2], [1, 2, 3])).toBe(false);
    expect(sameGrpprl([1, 2, 3], [1, 2])).toBe(false);
  });
});

describe("mergeChpxRuns", () => {
  it("merges two contiguous runs carrying byte-identical grpprl into one", () => {
    const merged = mergeChpxRuns([
      { start: 0, end: 2, grpprl: [1, 2] },
      { start: 2, end: 5, grpprl: [1, 2] },
    ]);
    expect(merged).toEqual([{ start: 0, end: 5, grpprl: [1, 2] }]);
  });

  it("does not merge two contiguous runs whose grpprl differs", () => {
    const merged = mergeChpxRuns([
      { start: 0, end: 2, grpprl: [1, 2] },
      { start: 2, end: 5, grpprl: [3, 4] },
    ]);
    expect(merged).toEqual([
      { start: 0, end: 2, grpprl: [1, 2] },
      { start: 2, end: 5, grpprl: [3, 4] },
    ]);
  });

  it("does not merge two runs with identical grpprl that are not actually contiguous", () => {
    const merged = mergeChpxRuns([
      { start: 0, end: 2, grpprl: [1] },
      { start: 3, end: 5, grpprl: [1] },
    ]);
    expect(merged).toEqual([
      { start: 0, end: 2, grpprl: [1] },
      { start: 3, end: 5, grpprl: [1] },
    ]);
  });

  it("merges a whole chain of contiguous, identically formatted runs into one", () => {
    const merged = mergeChpxRuns([
      { start: 0, end: 2, grpprl: [1] },
      { start: 2, end: 4, grpprl: [1] },
      { start: 4, end: 6, grpprl: [1] },
    ]);
    expect(merged).toEqual([{ start: 0, end: 6, grpprl: [1] }]);
  });

  it("returns an empty list for an empty input", () => {
    expect(mergeChpxRuns([])).toEqual([]);
  });
});
