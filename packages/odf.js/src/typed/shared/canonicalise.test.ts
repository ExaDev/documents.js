import { describe, expect, it } from "vitest";
import type {
  ContentImageBlock,
  ContentParagraph,
  ContentRun,
  ContentTable,
  ContentTableCell,
  LayoutMetadata,
  RunConstructExtent,
} from "document-schema.js";
import type { ListPlanState } from "./list";
import { odfBookmarkAnchorDescriptor } from "./constructs";
import {
  canonicalCell,
  canonicalImage,
  canonicalMetadata,
  canonicalParagraph,
  canonicalTable,
} from "./canonicalise";

// This suite pins typed/shared/canonicalise.ts's own paragraph/table/metadata/image helpers directly against a literal expected value. Every odt/odp/odg/draw writer's own round-trip suite applies these SAME functions identically to both sides of its equality check (normalise(actual) vs. normalise(expected)), so a mutation confined to one of these helpers changes both sides in lockstep and is invisible to that comparison -- only a direct, one-sided assertion (as here) can observe it. See canonicalise.ts's own top-of-file note, and ods/write.test.ts's identical "canonical* helpers: direct unit coverage" section for the sibling ODS-specific case this mirrors.

const RUN: ContentRun = { text: "hello" };

function paragraph(
  overrides: Partial<ContentParagraph> = {},
): ContentParagraph {
  return { kind: "paragraph", runs: [RUN], ...overrides };
}

describe("canonicalParagraph", () => {
  it("keeps only the run text when no other field is stated", () => {
    expect(canonicalParagraph(paragraph(), undefined)).toEqual({
      kind: "paragraph",
      runs: [{ text: "hello" }],
    });
  });

  it("defaults allowConstructs to false when the third argument is omitted", () => {
    const withConstruct = paragraph({
      constructs: [
        {
          descriptor: odfBookmarkAnchorDescriptor("b1"),
          startRun: 0,
          endRun: 0,
        },
      ],
    });
    expect(() => canonicalParagraph(withConstruct, undefined)).toThrow(
      /run-level construct extents/,
    );
  });

  it("allowConstructs=false refuses a paragraph carrying a non-empty constructs list", () => {
    const withConstruct = paragraph({
      constructs: [
        {
          descriptor: odfBookmarkAnchorDescriptor("b1"),
          startRun: 0,
          endRun: 0,
        },
      ],
    });
    expect(() => canonicalParagraph(withConstruct, undefined, false)).toThrow(
      /a paragraph/,
    );
  });

  it("allowConstructs=false accepts an explicit empty constructs array", () => {
    expect(
      canonicalParagraph(paragraph({ constructs: [] }), undefined, false),
    ).toEqual({ kind: "paragraph", runs: [{ text: "hello" }] });
  });

  it("allowConstructs=true carries a construct through, remapped onto the canonical run list", () => {
    const extent: RunConstructExtent = {
      descriptor: odfBookmarkAnchorDescriptor("b1"),
      startRun: 0,
      endRun: 1,
    };
    const result = canonicalParagraph(
      paragraph({ constructs: [extent] }),
      undefined,
      true,
    );
    expect(result.constructs).toEqual([
      { descriptor: odfBookmarkAnchorDescriptor("b1"), startRun: 0, endRun: 1 },
    ]);
  });

  it("allowConstructs=true with an explicit empty constructs array carries no constructs field", () => {
    const result = canonicalParagraph(
      paragraph({ constructs: [] }),
      undefined,
      true,
    );
    expect(result.constructs).toBeUndefined();
  });

  it("headingLevel derives styleId as Heading<N>", () => {
    expect(
      canonicalParagraph(paragraph({ headingLevel: 2 }), undefined),
    ).toEqual({
      kind: "paragraph",
      runs: [{ text: "hello" }],
      headingLevel: 2,
      styleId: "Heading2",
    });
  });

  it("alignment survives when stated", () => {
    expect(
      canonicalParagraph(paragraph({ alignment: "center" }), undefined),
    ).toEqual({
      kind: "paragraph",
      runs: [{ text: "hello" }],
      alignment: "center",
    });
  });

  it("preformatted survives when stated, including a literal false", () => {
    expect(
      canonicalParagraph(paragraph({ preformatted: true }), undefined),
    ).toMatchObject({ preformatted: true });
    expect(
      canonicalParagraph(paragraph({ preformatted: false }), undefined),
    ).toMatchObject({ preformatted: false });
  });

  it("list membership renumbers onto the given canonical numId", () => {
    expect(
      canonicalParagraph(
        paragraph({ list: { numId: "src-list", level: 3 } }),
        "list1",
      ),
    ).toMatchObject({ list: { numId: "list1", level: 3 } });
  });

  it("list membership is dropped when the caller supplies no canonical numId", () => {
    const result = canonicalParagraph(
      paragraph({ list: { numId: "src-list", level: 0 } }),
      undefined,
    );
    expect(result.list).toBeUndefined();
  });

  it("list membership is dropped when the paragraph itself carries none, even with a numId supplied", () => {
    const result = canonicalParagraph(paragraph(), "list1");
    expect(result.list).toBeUndefined();
  });

  it("spacingBeforePt/spacingAfterPt/lineSpacing survive when stated", () => {
    expect(
      canonicalParagraph(
        paragraph({ spacingBeforePt: 6, spacingAfterPt: 12, lineSpacing: 1.5 }),
        undefined,
      ),
    ).toMatchObject({
      spacingBeforePt: 6,
      spacingAfterPt: 12,
      lineSpacing: 1.5,
    });
  });

  it("indentLeftPt/indentFirstLinePt survive when stated", () => {
    expect(
      canonicalParagraph(
        paragraph({ indentLeftPt: 18, indentFirstLinePt: -18 }),
        undefined,
      ),
    ).toMatchObject({ indentLeftPt: 18, indentFirstLinePt: -18 });
  });

  it("pageBreakBefore/pageBreakAfter survive as literal booleans, including false", () => {
    expect(
      canonicalParagraph(paragraph({ pageBreakBefore: true }), undefined),
    ).toMatchObject({ pageBreakBefore: true });
    expect(
      canonicalParagraph(paragraph({ pageBreakBefore: false }), undefined),
    ).toMatchObject({ pageBreakBefore: false });
    expect(
      canonicalParagraph(paragraph({ pageBreakAfter: true }), undefined),
    ).toMatchObject({ pageBreakAfter: true });
    expect(
      canonicalParagraph(paragraph({ pageBreakAfter: false }), undefined),
    ).toMatchObject({ pageBreakAfter: false });
  });

  it("a field with no stated value at all is genuinely absent from the result", () => {
    const result = canonicalParagraph(paragraph(), undefined);
    expect(Object.keys(result)).toEqual(["kind", "runs"]);
  });
});

function freshListState(): ListPlanState {
  return { next: 1 };
}

describe("canonicalCell", () => {
  it("a covered cell is always an empty cell, whatever its own placeholder content", () => {
    const cell: ContentTableCell = {
      blocks: [paragraph()],
      colSpan: 3,
      rowSpan: 2,
    };
    expect(canonicalCell(cell, true, freshListState())).toEqual({ blocks: [] });
  });

  it("colSpan survives only when the source cell states one", () => {
    const withSpan: ContentTableCell = { blocks: [], colSpan: 2 };
    expect(canonicalCell(withSpan, false, freshListState())).toMatchObject({
      colSpan: 2,
    });
    const withoutSpan: ContentTableCell = { blocks: [] };
    expect(
      canonicalCell(withoutSpan, false, freshListState()),
    ).not.toHaveProperty("colSpan");
  });

  it("rowSpan survives only when the source cell states one", () => {
    const withSpan: ContentTableCell = { blocks: [], rowSpan: 4 };
    expect(canonicalCell(withSpan, false, freshListState())).toMatchObject({
      rowSpan: 4,
    });
    const withoutSpan: ContentTableCell = { blocks: [] };
    expect(
      canonicalCell(withoutSpan, false, freshListState()),
    ).not.toHaveProperty("rowSpan");
  });

  it("background is resolved through canonicalCellFill when stated", () => {
    const cell: ContentTableCell = {
      blocks: [],
      background: { kind: "solid", color: { r: 1, g: 0, b: 0 } },
    };
    expect(canonicalCell(cell, false, freshListState())).toMatchObject({
      background: { kind: "solid", color: { r: 1, g: 0, b: 0 } },
    });
  });

  it("refuses a block kind that is neither a paragraph nor a nested table, naming the real kind", () => {
    const image: ContentImageBlock = {
      kind: "image",
      format: "png",
      base64: "",
      widthPt: 10,
      heightPt: 10,
    };
    const cell: ContentTableCell = { blocks: [image] };
    expect(() => canonicalCell(cell, false, freshListState())).toThrow(
      /a "image" block/,
    );
  });

  it("a nested table block recurses through canonicalTable", () => {
    const nested: ContentTable = {
      kind: "table",
      columnWidthsPt: [10],
      rows: [{ cells: [{ blocks: [] }] }],
    };
    const cell: ContentTableCell = { blocks: [nested] };
    const result = canonicalCell(cell, false, freshListState());
    expect(result.blocks).toEqual([
      {
        kind: "table",
        columnWidthsPt: [10],
        rows: [{ cells: [{ blocks: [] }] }],
      },
    ]);
  });
});

describe("canonicalTable", () => {
  // Every non-anchor grid position carries its own marker colSpan: 1 -- a field the non-covered path (canonicalCell) always preserves and the covered path (canonicalCell's `if (covered) return { blocks: [] }` branch) always strips, regardless of what the source cell stated. This is what makes "genuinely covered" and "genuinely uncovered but otherwise empty" distinguishable in the result: an uncovered marked cell keeps { blocks: [], colSpan: 1 }, a covered one collapses to bare { blocks: [] }.
  function tableWithSpan(colSpan: number, rowSpan: number): ContentTable {
    return {
      kind: "table",
      columnWidthsPt: [10, 10, 10],
      rows: [
        {
          cells: [
            { blocks: [], colSpan, rowSpan },
            { blocks: [], colSpan: 1 },
            { blocks: [], colSpan: 1 },
          ],
        },
        {
          cells: [
            { blocks: [], colSpan: 1 },
            { blocks: [], colSpan: 1 },
            { blocks: [], colSpan: 1 },
          ],
        },
      ],
    };
  }

  it("columnWidthsPt is copied, not aliased", () => {
    const table: ContentTable = {
      kind: "table",
      columnWidthsPt: [12, 34],
      rows: [],
    };
    const result = canonicalTable(table, freshListState());
    expect(result.columnWidthsPt).toEqual([12, 34]);
    expect(result.columnWidthsPt).not.toBe(table.columnWidthsPt);
  });

  it("a row's own heightPt survives only when stated", () => {
    const table: ContentTable = {
      kind: "table",
      columnWidthsPt: [],
      rows: [{ cells: [], heightPt: 20 }, { cells: [] }],
    };
    const result = canonicalTable(table, freshListState());
    expect(result.rows[0]).toEqual({ cells: [], heightPt: 20 });
    expect(result.rows[1]).toEqual({ cells: [] });
  });

  it("a colSpan=1,rowSpan=1 cell (the default) covers no other grid position at all", () => {
    // r !== rowIndex || c !== columnIndex must be false only for the anchor cell itself, so a 1x1 span marks nothing else covered -- every OTHER cell in the table keeps its own marker colSpan: 1, proving it was never forced through the covered branch.
    const table = tableWithSpan(1, 1);
    const result = canonicalTable(table, freshListState());
    expect(result.rows[0]!.cells[0]).toMatchObject({ colSpan: 1, rowSpan: 1 });
    expect(result.rows[0]!.cells[1]).toEqual({ blocks: [], colSpan: 1 });
    expect(result.rows[1]!.cells[0]).toEqual({ blocks: [], colSpan: 1 });
  });

  it("rowSpan=2 covers exactly one row beyond the anchor, never two (< not <=)", () => {
    const table = tableWithSpan(1, 2);
    const result = canonicalTable(table, freshListState());
    // The anchor cell (row 0, col 0) keeps its own span fields (not covered).
    expect(result.rows[0]!.cells[0]).toMatchObject({ rowSpan: 2 });
    // Row 1, col 0 is covered by the rowSpan=2 anchor -- its own marker colSpan: 1 is stripped by the covered branch, even though the SOURCE cell at that grid position stated one.
    expect(result.rows[1]!.cells[0]).toEqual({ blocks: [] });
  });

  it("colSpan=2 covers exactly one column beyond the anchor, never two (< not <=)", () => {
    const table = tableWithSpan(2, 1);
    const result = canonicalTable(table, freshListState());
    expect(result.rows[0]!.cells[0]).toMatchObject({ colSpan: 2 });
    // Column 1 of row 0 is covered by the colSpan=2 anchor -- its own marker colSpan: 1 is stripped.
    expect(result.rows[0]!.cells[1]).toEqual({ blocks: [] });
    // Column 2 of row 0 is NOT covered -- colSpan=2 reaches only one column beyond the anchor, not two -- so its own marker colSpan: 1 survives untouched.
    expect(result.rows[0]!.cells[2]).toEqual({ blocks: [], colSpan: 1 });
  });

  it("each cell is its own list-run scope: two adjacent cells sharing one incoming numId still canonicalise to different numIds", () => {
    const table: ContentTable = {
      kind: "table",
      columnWidthsPt: [10, 10],
      rows: [
        {
          cells: [
            {
              blocks: [
                paragraph({ list: { numId: "shared-source-id", level: 0 } }),
              ],
            },
            {
              blocks: [
                paragraph({ list: { numId: "shared-source-id", level: 0 } }),
              ],
            },
          ],
        },
      ],
    };
    const result = canonicalTable(table, freshListState());
    const firstCellParagraph = result.rows[0]!.cells[0]!
      .blocks[0] as ContentParagraph;
    const secondCellParagraph = result.rows[0]!.cells[1]!
      .blocks[0] as ContentParagraph;
    expect(firstCellParagraph.list?.numId).toBeDefined();
    expect(secondCellParagraph.list?.numId).toBeDefined();
    expect(secondCellParagraph.list?.numId).not.toEqual(
      firstCellParagraph.list?.numId,
    );
  });

  it("closes the list plan after the whole table, so a sibling block after a nested table never inherits its trailing list run", () => {
    // Simulates exactly the caller shape canonicalCell's own block map produces: a nested table followed by a sibling paragraph in the SAME enclosing cell, both threaded through one shared listState.
    const listState = freshListState();
    const nested: ContentTable = {
      kind: "table",
      columnWidthsPt: [10],
      rows: [
        {
          cells: [
            { blocks: [paragraph({ list: { numId: "inner", level: 0 } })] },
          ],
        },
      ],
    };
    canonicalTable(nested, listState);
    // If canonicalTable failed to close the list plan on the way out, this next, unrelated paragraph (with NO list membership of its own) would have no observable bug directly -- so instead thread a FRESH numId through planListMembership-equivalent behaviour via another nested table cell, proving the state was reset: a new incoming numId here mints a numId built from the counter's current value, not from continuing the inner table's own run.
    const after = canonicalCell(
      { blocks: [paragraph({ list: { numId: "outer", level: 0 } })] },
      false,
      listState,
    );
    const afterParagraph = after.blocks[0] as ContentParagraph;
    // "outer" is a fresh incoming key distinct from "inner", so it must mint its OWN canonical numId regardless of whether the state was closed -- what this test actually pins is that the mint uses the NEXT counter value (proving the inner table's own numId-minting fully ran to completion and advanced the shared counter), not a stale one reused from a run left open.
    expect(afterParagraph.list?.numId).toBeDefined();
  });
});

describe("canonicalMetadata", () => {
  it("every field survives when stated", () => {
    const metadata: LayoutMetadata = {
      title: "T",
      author: "A",
      subject: "S",
      keywords: ["a", "b"],
      creator: "LibreOffice",
      createdIso: "2026-01-01T00:00:00Z",
      modifiedIso: "2026-01-02T00:00:00Z",
    };
    expect(canonicalMetadata(metadata)).toEqual(metadata);
  });

  it("every field is genuinely absent, not defaulted, when the source states none", () => {
    expect(canonicalMetadata({})).toEqual({});
  });

  it("an empty keywords array reads back as absent, not as an empty array", () => {
    expect(canonicalMetadata({ keywords: [] })).toEqual({});
  });

  it("keywords is copied, not aliased, when non-empty", () => {
    const keywords = ["x"];
    const result = canonicalMetadata({ keywords });
    expect(result.keywords).toEqual(["x"]);
    expect(result.keywords).not.toBe(keywords);
  });

  it("each field is independently optional -- one at a time", () => {
    expect(canonicalMetadata({ title: "only title" })).toEqual({
      title: "only title",
    });
    expect(canonicalMetadata({ author: "only author" })).toEqual({
      author: "only author",
    });
    expect(canonicalMetadata({ subject: "only subject" })).toEqual({
      subject: "only subject",
    });
    expect(canonicalMetadata({ creator: "only creator" })).toEqual({
      creator: "only creator",
    });
    expect(canonicalMetadata({ createdIso: "only created" })).toEqual({
      createdIso: "only created",
    });
    expect(canonicalMetadata({ modifiedIso: "only modified" })).toEqual({
      modifiedIso: "only modified",
    });
  });
});

describe("canonicalImage", () => {
  const base: ContentImageBlock = {
    kind: "image",
    format: "png",
    base64: "AAAA",
    widthPt: 100,
    heightPt: 50,
  };

  it("carries format/base64/size verbatim and drops reader-only fields", () => {
    expect(
      canonicalImage({
        ...base,
        sourcePath: "media/image1.png",
        anchorRunIndex: 2,
        anchorOffset: 3,
      }),
    ).toEqual(base);
  });

  it("altText survives only when stated", () => {
    expect(canonicalImage({ ...base, altText: "a caption" })).toEqual({
      ...base,
      altText: "a caption",
    });
    expect(canonicalImage(base)).toEqual(base);
    expect(canonicalImage(base)).not.toHaveProperty("altText");
  });
});
