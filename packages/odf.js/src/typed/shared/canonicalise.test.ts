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
  canonicalRun,
  canonicalTable,
} from "./canonicalise";

// This suite pins typed/shared/canonicalise.ts's own paragraph/table/metadata/image helpers directly against a literal expected value. Every odt/odp/odg/draw writer's own round-trip suite applies these SAME functions identically to both sides of its equality check (normalise(actual) vs. normalise(expected)), so a mutation confined to one of these helpers changes both sides in lockstep and is invisible to that comparison -- only a direct, one-sided assertion (as here) can observe it. See canonicalise.ts's own top-of-file note, and ods/write.test.ts's identical "canonical* helpers: direct unit coverage" section for the sibling ODS-specific case this mirrors.

const RUN: ContentRun = { text: "hello" };

function paragraph(
  overrides: Partial<ContentParagraph> = {},
): ContentParagraph {
  return { kind: "paragraph", runs: [RUN], ...overrides };
}

describe("canonicalRun", () => {
  // toStrictEqual throughout this block, not toEqual: toEqual ignores an explicit undefined-valued property, so a mutant that turns "if (run.bold !== undefined)" into "if (true)" -- setting canonical.bold = undefined unconditionally instead of leaving the key absent -- would read as equal to the field-omitted expectation under toEqual and survive unnoticed. toStrictEqual treats an explicit `bold: undefined` key as genuinely different from the key being absent altogether.
  it("keeps only text when no other field is stated", () => {
    expect(canonicalRun({ text: "plain" })).toStrictEqual({ text: "plain" });
  });

  it("carries bold through when stated", () => {
    expect(canonicalRun({ text: "x", bold: true })).toStrictEqual({
      text: "x",
      bold: true,
    });
  });

  it("carries italic through when stated", () => {
    expect(canonicalRun({ text: "x", italic: true })).toStrictEqual({
      text: "x",
      italic: true,
    });
  });

  it("carries underline through when stated", () => {
    expect(canonicalRun({ text: "x", underline: true })).toStrictEqual({
      text: "x",
      underline: true,
    });
  });

  it("carries strike through when stated", () => {
    expect(canonicalRun({ text: "x", strike: true })).toStrictEqual({
      text: "x",
      strike: true,
    });
  });

  it("carries fontFamily through when stated", () => {
    expect(canonicalRun({ text: "x", fontFamily: "Arial" })).toStrictEqual({
      text: "x",
      fontFamily: "Arial",
    });
  });

  it("carries sizePt through when stated", () => {
    expect(canonicalRun({ text: "x", sizePt: 12 })).toStrictEqual({
      text: "x",
      sizePt: 12,
    });
  });

  it("quantises color through canonicalColor's own hex-pair round trip when stated", () => {
    expect(
      canonicalRun({ text: "x", color: { r: 0.9, g: 0, b: 0 } }),
    ).toStrictEqual({
      text: "x",
      color: { r: 230 / 255, g: 0, b: 0 },
    });
  });

  it("carries hyperlink through when stated", () => {
    expect(
      canonicalRun({ text: "x", hyperlink: "https://example.com" }),
    ).toStrictEqual({
      text: "x",
      hyperlink: "https://example.com",
    });
  });

  it("carries every field at once, none clobbering another", () => {
    expect(
      canonicalRun({
        text: "x",
        bold: true,
        italic: true,
        underline: true,
        strike: true,
        fontFamily: "Arial",
        sizePt: 12,
        color: { r: 0, g: 0, b: 0 },
        hyperlink: "https://example.com",
      }),
    ).toStrictEqual({
      text: "x",
      bold: true,
      italic: true,
      underline: true,
      strike: true,
      fontFamily: "Arial",
      sizePt: 12,
      color: { r: 0, g: 0, b: 0 },
      hyperlink: "https://example.com",
    });
  });
});

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
  it("a covered cell keeps its own background and borders, in the canonical form an anchor's take, but drops its blocks and spans", () => {
    const cell: ContentTableCell = {
      blocks: [paragraph()],
      colSpan: 3,
      rowSpan: 2,
      background: { kind: "solid", color: { r: 1, g: 0, b: 0 } },
      borders: { left: { color: { r: 0, g: 0, b: 1 }, widthPt: 2 } },
    };
    expect(canonicalCell(cell, true, freshListState())).toStrictEqual({
      blocks: [],
      background: { kind: "solid", color: { r: 1, g: 0, b: 0 } },
      borders: {
        left: { color: { r: 0, g: 0, b: 1 }, widthPt: 2, style: "solid" },
      },
    });
  });

  it("a covered cell stating neither background nor borders canonicalises to bare blocks, with no undefined-valued keys", () => {
    expect(
      canonicalCell({ blocks: [], colSpan: 1 }, true, freshListState()),
    ).toStrictEqual({ blocks: [] });
  });

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
    // toStrictEqual, not toEqual: toEqual ignores an explicit undefined-valued heightPt key, so a mutant that always takes the "state a heightPt" branch (`{ cells, heightPt: row.heightPt }`) for a row with none would set heightPt: undefined and still read as equal to { cells }.
    expect(result.rows[1]).toStrictEqual({ cells: [] });
  });

  it("a cell that is itself covered never marks further cells covered from its own stated span", () => {
    // (0,0) spans two columns, covering (0,1). (0,1) is itself covered, but its OWN source cell states colSpan: 3 (as a real document's covered-position placeholder legitimately might) -- that stated span must never be consulted, because the covering pass is skipped entirely once a cell is already known covered. If it were consulted, (0,1)'s own colSpan: 3 would reach through (0,2) and (0,3), incorrectly marking both covered too.
    const table: ContentTable = {
      kind: "table",
      columnWidthsPt: [10, 10, 10, 10],
      rows: [
        {
          cells: [
            { blocks: [], colSpan: 2 },
            { blocks: [], colSpan: 3 },
            { blocks: [], colSpan: 1 },
            { blocks: [], colSpan: 1 },
          ],
        },
      ],
    };
    const result = canonicalTable(table, freshListState());
    expect(result.rows[0]!.cells[1]).toEqual({ blocks: [] });
    expect(result.rows[0]!.cells[2]).toEqual({ blocks: [], colSpan: 1 });
    expect(result.rows[0]!.cells[3]).toEqual({ blocks: [], colSpan: 1 });
  });

  it("a colSpan=1,rowSpan=1 cell (the default) covers no other grid position at all", () => {
    // r !== rowIndex || c !== columnIndex must be false only for the anchor cell itself, so a 1x1 span marks nothing else covered -- every OTHER cell in the table keeps its own marker colSpan: 1, proving it was never forced through the covered branch.
    const table = tableWithSpan(1, 1);
    const result = canonicalTable(table, freshListState());
    expect(result.rows[0]!.cells[0]).toMatchObject({ colSpan: 1, rowSpan: 1 });
    expect(result.rows[0]!.cells[1]).toEqual({ blocks: [], colSpan: 1 });
    expect(result.rows[1]!.cells[0]).toEqual({ blocks: [], colSpan: 1 });
  });

  it("a covered position's own background survives while its span marker is stripped, at a position the rows above cover vertically", () => {
    const table = tableWithSpan(1, 2);
    const fill = { kind: "solid", color: { r: 0, g: 1, b: 0 } } as const;
    const covered = table.rows[1]!.cells[0]!;
    covered.background = fill;
    const result = canonicalTable(table, freshListState());
    expect(result.rows[1]!.cells[0]).toStrictEqual({
      blocks: [],
      background: fill,
    });
  });

  it("rowSpan=2 covers exactly one row beyond the anchor, never two (< not <=)", () => {
    const table = tableWithSpan(1, 2);
    const result = canonicalTable(table, freshListState());
    // The anchor cell (row 0, col 0) keeps its own span fields (not covered).
    expect(result.rows[0]!.cells[0]).toMatchObject({ rowSpan: 2 });
    // Row 1, col 0 is covered by the rowSpan=2 anchor -- its own marker colSpan: 1 is stripped by the covered branch, even though the SOURCE cell at that grid position stated one.
    expect(result.rows[1]!.cells[0]).toEqual({ blocks: [] });
    // Row 1, col 1 is NOT covered -- the anchor's own colSpan is 1, so its reach into the rows below stays exactly one column wide, never one column further -- so its own marker colSpan: 1 survives untouched.
    expect(result.rows[1]!.cells[1]).toEqual({ blocks: [], colSpan: 1 });
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
    // Simulates exactly the caller shape canonicalCell's own block map produces: a nested table followed by a sibling paragraph in the SAME enclosing cell, both threaded through one shared listState. The sibling deliberately reuses the SAME raw numId ("shared") the inner table's own last paragraph carried: the earlier version of this test used two distinct numIds ("inner" then "outer"), which mints a fresh run either way and can never distinguish "closed" from "left open" -- only a coinciding incoming numId can, since planListMembership only opens a genuinely new run when the incoming key differs from whatever is currently open.
    const listState = freshListState();
    const nested: ContentTable = {
      kind: "table",
      columnWidthsPt: [10],
      rows: [
        {
          cells: [
            { blocks: [paragraph({ list: { numId: "shared", level: 0 } })] },
          ],
        },
      ],
    };
    const nestedResult = canonicalTable(nested, listState);
    const nestedNumId = (
      nestedResult.rows[0]!.cells[0]!.blocks[0] as ContentParagraph
    ).list?.numId;
    // If canonicalTable failed to close the list plan on the way out, listState.openNumId would still read "shared" here -- so this next cell's own paragraph, carrying the identical raw "shared" numId, would be treated as CONTINUING the inner table's own run (planListMembership only mints a fresh canonical numId when the incoming key differs from the one still open) and canonicalise to the SAME numId the table's own paragraph got, despite the two having nothing to do with each other -- exactly the odp text-box "raw numIds happen to coincide" scenario this function's own top-of-file note names as the reason the boundary must be forced.
    const after = canonicalCell(
      { blocks: [paragraph({ list: { numId: "shared", level: 0 } })] },
      false,
      listState,
    );
    const afterParagraph = after.blocks[0] as ContentParagraph;
    expect(afterParagraph.list?.numId).toBeDefined();
    expect(afterParagraph.list?.numId).not.toBe(nestedNumId);
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
    // toStrictEqual, not toEqual: toEqual ignores an explicit undefined-valued property, so a mutant that turns any single "if (metadata.X !== undefined)" guard into "if (true)" -- setting that one field to undefined unconditionally instead of leaving the key absent -- would still read as equal to {} under toEqual and survive unnoticed for every one of the six fields below.
    expect(canonicalMetadata({})).toStrictEqual({});
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
