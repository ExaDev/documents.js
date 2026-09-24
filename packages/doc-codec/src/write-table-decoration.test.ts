import { readCompoundFile } from "archive-codec";
import type { ContentDocument, ContentTableCell } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { isDocBytes } from "./detect";
import { DocFormatError, DocUnsupportedError } from "./errors";
import { readDocContent } from "./read";
import { writeDocContent } from "./write";
import {
  blocksOf,
  cellText,
  containsSprm,
  coveredCells,
  document,
  onlyCell,
  paragraph,
  roundTrip,
  tableAt,
} from "./test-support/write";

describe("writeDocContent tables: row validation, blank cells and structural edge cases", () => {
  it("throws when a row's own cells cover more columns than the table declares", () => {
    const input = document([
      {
        kind: "table",
        columns: [{ widthPt: 50 }, { widthPt: 50 }],
        rows: [
          {
            cells: [
              { blocks: [paragraph([{ text: "wide" }])], colSpan: 2 },
              ...coveredCells(1),
              { blocks: [paragraph([{ text: "extra" }])] },
            ],
          },
        ],
      },
    ]);
    expect(() => writeDocContent(input)).toThrow(
      /a table cell's own colSpan runs past the table's 2-column grid/,
    );
  });

  it("throws when a row's own cells cover fewer columns than the table declares", () => {
    const input = document([
      {
        kind: "table",
        columns: [{ widthPt: 50 }, { widthPt: 50 }, { widthPt: 50 }],
        rows: [
          {
            cells: [{ blocks: [paragraph([{ text: "narrow" }])] }],
          },
        ],
      },
    ]);
    expect(() => writeDocContent(input)).toThrow(
      /a table row's own cells cover 1 columns \(via colSpan\), but the table declares 3 columns/,
    );
  });

  it("throws naming the exact requirement when a table declares no columns at all", () => {
    const input = document([
      { kind: "table", columns: [], rows: [{ cells: [] }] },
    ]);
    expect(() => writeDocContent(input)).toThrow(
      /a table must have at least one column and one row to write/,
    );
  });

  it("throws naming the exact requirement when a table declares no rows at all", () => {
    const input = document([
      { kind: "table", columns: [{ widthPt: 50 }], rows: [] },
    ]);
    expect(() => writeDocContent(input)).toThrow(
      /a table must have at least one column and one row to write/,
    );
  });

  it("falls all the way back to writing a row wholly unsplit when even its single most valuable assigned boundary cannot fit, warning with the singular wording (ExaDev/documents.js#1013)", () => {
    // 20 ordinary, undecorated single-column cells plus one further 2-wide merged cell (21 columns, 1 row): the 20 plain cells' own boundaries are all recoverable on their own, leaving exactly the merge's own single internal boundary lost — and, being a single row, assigned entirely to this one row. Splitting it would raise the row from 21 to 22 physical cells, which — entirely from the 20 plain cells' own fixed 22-bytes-per-cell cost plus the row's own fixed 15-byte overhead — already sits close enough to the 487-byte PapxInFkp ceiling that the extra cell tips it over, while the unsplit 21-cell form still fits. rowSplitFits therefore rejects the only candidate this row could ever try (kept.length reaches 0), which is the "could not state ... at all" wording this describe block's other trimming tests never reach, since each of them still keeps at least one boundary.
    const plainColumnCount = 20;
    const columns = [
      ...Array.from({ length: plainColumnCount }, () => ({ widthPt: 20 })),
      { widthPt: 20 },
      { widthPt: 20 },
    ];
    const input = document([
      {
        kind: "table",
        columns,
        rows: [
          {
            cells: [
              ...Array.from({ length: plainColumnCount }, (_unused, index) => ({
                blocks: [paragraph([{ text: `c${index}` }])],
              })),
              {
                blocks: [paragraph([{ text: "merged" }])],
                colSpan: 2,
              },
              ...coveredCells(1),
            ],
          },
        ],
      },
    ]);
    const warnings: string[] = [];
    const bytes = writeDocContent(input, {
      onWarning: (message) => {
        warnings.push(message);
      },
    });
    expect(isDocBytes(bytes)).toBe(true);
    const block = tableAt(readDocContent(bytes), 0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("table at block 0, row 0");
    expect(warnings[0]).toMatch(
      /could not state its assigned lost column boundary/,
    );
    expect(warnings[0]).toMatch(/attempting to write it unsplit instead/);
    // Unsplit: the merged cell's own internal boundary never made it into rgdxaCenter, so it reads back as one ordinary column, narrowing the table by exactly one.
    expect(block.columns).toHaveLength(plainColumnCount + 1);
    // Derived from the round-tripped table's own column count, not restated as the plainColumnCount literal: a bare literal index here trips a confirmed @typescript-eslint/no-unnecessary-condition false positive against noUncheckedIndexedAccess (it does not account for a `const`-literal-typed index into an array, even though tsc itself still reports the access as possibly undefined without its own `?.`).
    const mergedIndex = block.columns.length - 1;
    expect(block.rows[0]?.cells[mergedIndex]?.colSpan).toBeUndefined();
    expect(cellText(block.rows[0]?.cells[mergedIndex])).toBe("merged");
  });

  it("never engages the lost-boundary fallback at all for a row with no merges, even one whose own bare cells already overflow the format's own byte budget", () => {
    // 25 ordinary, single-column, unmerged cells: recoverableBoundaries states every internal boundary on its own (nothing merges across any of them), so this row's own assigned lost-boundary set is empty and flattenTable's own fallback code never runs for it at all — not even to try, fail, and warn. The row's own bare, undecorated cells already cost 15 + 22 x 25 = 565 bytes, past the 487-byte PapxInFkp ceiling regardless of any lost-boundary machinery, so writeDocContent still throws — but from the real, unrelated buildPapxPages call this fallback exists to route around only when boundaries are actually lost, never from this describe block's own onWarning at all.
    const columnCount = 25;
    const input = document([
      {
        kind: "table",
        columns: Array.from({ length: columnCount }, () => ({ widthPt: 20 })),
        rows: [
          {
            cells: Array.from({ length: columnCount }, (_unused, index) => ({
              blocks: [paragraph([{ text: `c${index}` }])],
            })),
          },
        ],
      },
    ]);
    const warnings: string[] = [];
    expect(() =>
      writeDocContent(input, {
        onWarning: (message) => {
          warnings.push(message);
        },
      }),
    ).toThrow(/does not fit in one 512-byte formatted disk page/);
    expect(warnings).toEqual([]);
  });

  it("throws for a row so wide that even its own fully-unsplit merged form still overflows the format's byte budget, after warning it could not state any of its assigned boundaries", () => {
    // 30 colSpan-2 pairs (60 columns, 1 row): every pair's own internal boundary is lost (a single row states nothing any other row could corroborate), all 30 assigned to this one row. Even the fully collapsed, wholly-unsplit form — kept.length trimmed all the way to 0, the smallest this row could ever ask rowSplitFits to try — still costs 15 + 22 x 30 = 675 bytes, past the 487-byte ceiling: the trimming loop's own downward scan exhausts every candidate down to kept.length === 0 and stops there (rather than looping forever re-trying an already-empty candidate), leaving flattenRow to encode the row unsplit regardless, which writeDocContent's own later buildPapxPages call then genuinely rejects.
    const pairCount = 30;
    const input = document([
      {
        kind: "table",
        columns: Array.from({ length: pairCount * 2 }, () => ({ widthPt: 20 })),
        rows: [
          {
            cells: Array.from({ length: pairCount }, (_unused, index) => [
              {
                blocks: [paragraph([{ text: `c${index}` }])],
                colSpan: 2,
              },
              ...coveredCells(1),
            ]).flat(),
          },
        ],
      },
    ]);
    const warnings: string[] = [];
    expect(() =>
      writeDocContent(input, {
        onWarning: (message) => {
          warnings.push(message);
        },
      }),
    ).toThrow(/does not fit in one 512-byte formatted disk page/);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(
      new RegExp(`any of its ${pairCount} assigned lost column boundaries`),
    );
    expect(warnings[0]).toMatch(/attempting to write it unsplit instead/);
  });

  it("writes a genuinely blank cell as blank, not as a vertical-merge continuation of the cell above it", () => {
    const input = document([
      {
        kind: "table",
        columns: [{ widthPt: 80 }, { widthPt: 80 }],
        rows: [
          {
            cells: [
              { blocks: [paragraph([{ text: "A1" }])] },
              { blocks: [paragraph([{ text: "B1" }])] },
            ],
          },
          {
            cells: [{ blocks: [] }, { blocks: [paragraph([{ text: "B2" }])] }],
          },
        ],
      },
    ]);
    const result = roundTrip(input);
    const block = blocksOf(result)[0];
    if (block?.kind !== "table") {
      throw new Error("expected a table block");
    }
    // The cell above a genuinely blank cell must not come back claiming a rowSpan it never had — that would be exactly the "blank cell silently mis-written as a vertical-merge continuation" defect.
    expect(block.rows[0]?.cells[0]?.rowSpan).toBeUndefined();
    expect(cellText(block.rows[0]?.cells[0])).toBe("A1");
    // Unlike a vertical-merge continuation (which the reader normalises back to `blocks: []` regardless of its own paragraph content, since a continuation's content is never rendered), an ordinary blank cell keeps the single empty paragraph [MS-DOC] requires every physical cell to carry — the closest a lossless round trip of "no blocks" can reach.
    expect(block.rows[1]?.cells[0]?.blocks).toEqual([
      { kind: "paragraph", runs: [] },
    ]);
    expect(block.rows[1]?.cells[0]?.colSpan).toBeUndefined();
    expect(cellText(block.rows[1]?.cells[1])).toBe("B2");
  });

  it("round-trips a cell merged both horizontally and vertically", () => {
    const input = document([
      {
        kind: "table",
        columns: [{ widthPt: 50 }, { widthPt: 50 }, { widthPt: 50 }],
        rows: [
          {
            cells: [
              {
                blocks: [paragraph([{ text: "anchor" }])],
                colSpan: 2,
                rowSpan: 2,
              },
              ...coveredCells(1),
              { blocks: [paragraph([{ text: "C1" }])] },
            ],
          },
          {
            cells: [
              ...coveredCells(2),
              { blocks: [paragraph([{ text: "C2" }])] },
            ],
          },
          // Neither row above ever states the boundary between the anchor's own 2 merged columns, since both merge across it identically — a third, wholly unmerged row is what reveals the table genuinely has 3 columns here, so the lost-boundary fallback never triggers for this particular table (see this describe block's own "recovers colSpan and columns" tests for what the fallback does when no row reveals it at all).
          {
            cells: [
              { blocks: [paragraph([{ text: "A3" }])] },
              { blocks: [paragraph([{ text: "B3" }])] },
              { blocks: [paragraph([{ text: "C3" }])] },
            ],
          },
        ],
      },
    ]);
    const result = roundTrip(input);
    const block = blocksOf(result)[0];
    if (block?.kind !== "table") {
      throw new Error("expected a table block");
    }
    expect(block.columns.map((c) => c.widthPt)).toEqual([50, 50, 50]);
    expect(block.rows[0]?.cells[0]?.colSpan).toBe(2);
    expect(block.rows[0]?.cells[0]?.rowSpan).toBe(2);
    expect(cellText(block.rows[0]?.cells[0])).toBe("anchor");
    expect(cellText(block.rows[0]?.cells[2])).toBe("C1");
    // Every row holds one entry per grid column: the row below states the 2-wide vertical continuation as two block-less entries, neither carrying a span of its own.
    expect(block.rows[1]?.cells).toHaveLength(3);
    expect(block.rows[1]?.cells.slice(0, 2)).toEqual(coveredCells(2));
    expect(cellText(block.rows[1]?.cells[2])).toBe("C2");
    expect(block.rows[2]?.cells.map((cell) => cellText(cell))).toEqual([
      "A3",
      "B3",
      "C3",
    ]);
  });

  it("appends a trailing empty paragraph when a table is the section's own last block, so the document's last character is a genuine paragraph mark rather than the table's own row-ending cell mark", () => {
    // [MS-DOC]'s own "Main Document" glossary entry: "The last character in the main document MUST be a paragraph mark (Unicode 0x000D)" — never the row-ending mark's own cell-mark character (0x0007), even though a row-ending mark is a perfectly legal paragraph-boundary terminator everywhere else. Without this, a real third-party [MS-DOC] reader (LibreOffice) does not merely lose a property — it fails to recognise the table at all (ExaDev/documents.js#892).
    const input = document([
      {
        kind: "table",
        columns: [{ widthPt: 100 }],
        rows: [{ cells: [{ blocks: [paragraph([{ text: "only cell" }])] }] }],
      },
    ]);
    const result = roundTrip(input);
    const blocks = blocksOf(result);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.kind).toBe("table");
    expect(blocks[1]).toEqual({ kind: "paragraph", runs: [] });
  });

  it("does not append a trailing paragraph when the section already ends in an ordinary paragraph after a table", () => {
    const input = document([
      {
        kind: "table",
        columns: [{ widthPt: 100 }],
        rows: [{ cells: [{ blocks: [paragraph([{ text: "cell" }])] }] }],
      },
      paragraph([{ text: "after the table" }]),
    ]);
    const result = roundTrip(input);
    const blocks = blocksOf(result);
    expect(blocks).toHaveLength(2);
    expect(blocks[1]?.kind).toBe("paragraph");
  });

  it("refuses a table nested inside a table cell", () => {
    const input = document([
      {
        kind: "table",
        columns: [{ widthPt: 100 }],
        rows: [
          {
            cells: [
              {
                blocks: [{ kind: "table", rows: [], columns: [] }],
              },
            ],
          },
        ],
      },
    ]);
    expect(() => writeDocContent(input)).toThrow(DocUnsupportedError);
  });
});

// ContentTableCell.background and .borders, through TC80's own four Brc80 fields, the sprmTSetBrc exact-colour layer beside them, and the row's own sprmTDefTableShd array (src/table/decoration.ts). Every case here was additionally checked against real LibreOffice 26.2.5.2 output in both directions — see the README's own "Third-party verification" paragraph for exactly which sub-cases that covered and which it did not.
describe("cell decoration", () => {
  // A single-cell table carrying whatever decoration a test wants to state, so each assertion below is about the decoration alone rather than about cell structure it re-establishes every time.
  const decorated = (cell: Partial<ContentTableCell>): ContentDocument =>
    document([
      {
        kind: "table",
        columns: [{ widthPt: 120 }],
        rows: [{ cells: [{ blocks: [paragraph([{ text: "x" }])], ...cell }] }],
      },
    ]);

  it("round-trips a cell's solid background fill", () => {
    const background = {
      kind: "solid" as const,
      color: { r: 1, g: 1, b: 0 },
    };
    const result = roundTrip(decorated({ background }));
    expect(onlyCell(result).background).toEqual(background);
  });

  it("round-trips a background colour the Ico palette cannot state, through Shd's own exact COLORREFs", () => {
    // #4C7FBF is deliberately nowhere near a palette entry: Shd carries cvFore/cvBack as full COLORREFs, so unlike a Brc80 border there is no palette step to lose it at.
    const background = {
      kind: "solid" as const,
      color: { r: 0x4c / 255, g: 0x7f / 255, b: 0xbf / 255 },
    };
    const result = roundTrip(decorated({ background }));
    expect(onlyCell(result).background).toEqual(background);
  });

  it("round-trips a genuine two-colour pattern fill — a percentage grey — instead of dropping it (ExaDev/documents.js#951)", () => {
    const background = {
      kind: "pattern" as const,
      patternType: "percent20" as const,
      foregroundColor: { r: 0, g: 0, b: 0 },
      backgroundColor: { r: 1, g: 1, b: 1 },
    };
    const result = roundTrip(decorated({ background }));
    expect(onlyCell(result).background).toEqual(background);
  });

  it("round-trips a genuine two-colour crosshatch pattern fill (ExaDev/documents.js#951)", () => {
    const background = {
      kind: "pattern" as const,
      patternType: "diagonalCross" as const,
      foregroundColor: { r: 1, g: 0, b: 0 },
      backgroundColor: { r: 0, g: 0, b: 1 },
    };
    const result = roundTrip(decorated({ background }));
    expect(onlyCell(result).background).toEqual(background);
  });

  it("round-trips all four borders, each with its own style, width and colour", () => {
    const borders = {
      top: { color: { r: 1, g: 0, b: 0 }, widthPt: 0.5 },
      left: { color: { r: 0, g: 0, b: 1 }, widthPt: 1, style: "dashed" },
      bottom: { color: { r: 0, g: 0x80 / 255, b: 0 }, widthPt: 2.5 },
      // 0x80/255 rather than a round 0.5: every colour in this schema is written as a byte, so a component that is not itself a whole byte comes back rounded, exactly as a run's own sprmCCv colour already does.
      right: {
        color: { r: 0x80 / 255, g: 0, b: 0x80 / 255 },
        widthPt: 1.5,
        style: "dotted",
      },
    } as const;
    const result = roundTrip(decorated({ borders }));
    expect(onlyCell(result).borders).toEqual(borders);
  });

  it("round-trips a cell bordered on some sides but not others, leaving the unbordered sides absent", () => {
    const result = roundTrip(
      decorated({
        borders: {
          top: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
          bottom: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
        },
      }),
    );
    const cellBorders = onlyCell(result).borders;
    expect(cellBorders?.top).toEqual({
      color: { r: 0, g: 0, b: 0 },
      widthPt: 1,
    });
    expect(cellBorders?.bottom).toEqual({
      color: { r: 0, g: 0, b: 0 },
      widthPt: 1,
    });
    expect(cellBorders?.left).toBeUndefined();
    expect(cellBorders?.right).toBeUndefined();
  });

  it("emits no decoration at all for a cell that states none", () => {
    const result = roundTrip(decorated({}));
    const cell = onlyCell(result);
    expect(cell.background).toBeUndefined();
    expect(cell.borders).toBeUndefined();
  });

  it("round-trips a border colour the Ico palette cannot state, through the sprmTSetBrc layer beside TC80's own Brc80", () => {
    // #336699 is not a palette entry, so Brc80.ico alone would snap it to the nearest one; recovering it exactly proves the sprmTSetBrc override is both written and folded back on read.
    const color = { r: 0x33 / 255, g: 0x66 / 255, b: 0x99 / 255 };
    const result = roundTrip(
      decorated({ borders: { top: { color, widthPt: 1 } } }),
    );
    expect(onlyCell(result).borders?.top).toEqual({ color, widthPt: 1 });
  });

  it("round-trips a border colour the Ico palette states exactly, without needing the sprmTSetBrc layer at all", () => {
    const color = { r: 1, g: 1, b: 0 }; // Ico 0x07, yellow.
    const result = roundTrip(
      decorated({ borders: { right: { color, widthPt: 0.75 } } }),
    );
    expect(onlyCell(result).borders?.right).toEqual({ color, widthPt: 0.75 });
    // The exact-colour override is emitted only where the palette genuinely cannot hold the colour, so this table's row mark carries no sprmTSetBrc (0xD62F) opcode anywhere in it.
    const bytes = writeDocContent(
      decorated({ borders: { right: { color, widthPt: 0.75 } } }),
    );
    expect(containsSprm(bytes, 0xd62f)).toBe(false);
  });

  it("round-trips a border width in the 1/8-point steps [MS-DOC]'s own dptLineWidth states", () => {
    const color = { r: 0, g: 0, b: 0 };
    const result = roundTrip(
      decorated({ borders: { top: { color, widthPt: 3.125 } } }),
    );
    expect(onlyCell(result).borders?.top?.widthPt).toBe(3.125);
  });

  it("refuses a border wider than the single-byte dptLineWidth can state, rather than silently writing a thinner one", () => {
    expect(() =>
      writeDocContent(
        decorated({
          borders: { top: { color: { r: 0, g: 0, b: 0 }, widthPt: 40 } },
        }),
      ),
    ).toThrow(DocFormatError);
  });

  it("round-trips decoration on a cell that is also horizontally merged", () => {
    const input = document([
      {
        kind: "table",
        columns: [{ widthPt: 80 }, { widthPt: 80 }],
        rows: [
          {
            cells: [
              {
                blocks: [paragraph([{ text: "wide" }])],
                colSpan: 2,
                background: { kind: "solid", color: { r: 0, g: 1, b: 1 } },
                borders: {
                  bottom: { color: { r: 1, g: 0, b: 0 }, widthPt: 1.5 },
                },
              },
              ...coveredCells(1),
            ],
          },
          {
            cells: [
              { blocks: [paragraph([{ text: "a" }])] },
              { blocks: [paragraph([{ text: "b" }])] },
            ],
          },
        ],
      },
    ]);
    const anchor = tableAt(roundTrip(input), 0).rows[0]?.cells[0];
    expect(anchor?.colSpan).toBe(2);
    expect(anchor?.background).toEqual({
      kind: "solid",
      color: { r: 0, g: 1, b: 1 },
    });
    expect(anchor?.borders?.bottom).toEqual({
      color: { r: 1, g: 0, b: 0 },
      widthPt: 1.5,
    });
  });

  it("keeps each cell's decoration its own across a row of differently decorated cells", () => {
    const input = document([
      {
        kind: "table",
        columns: [{ widthPt: 60 }, { widthPt: 60 }, { widthPt: 60 }],
        rows: [
          {
            cells: [
              {
                blocks: [paragraph([{ text: "fill" }])],
                background: { kind: "solid", color: { r: 1, g: 1, b: 0 } },
              },
              {
                blocks: [paragraph([{ text: "border" }])],
                borders: {
                  left: { color: { r: 0, g: 0, b: 1 }, widthPt: 1 },
                },
              },
              { blocks: [paragraph([{ text: "bare" }])] },
            ],
          },
        ],
      },
    ]);
    const cells = tableAt(roundTrip(input), 0).rows[0]?.cells;
    expect(cells?.[0]?.background).toEqual({
      kind: "solid",
      color: { r: 1, g: 1, b: 0 },
    });
    expect(cells?.[0]?.borders).toBeUndefined();
    expect(cells?.[1]?.background).toBeUndefined();
    expect(cells?.[1]?.borders?.left).toEqual({
      color: { r: 0, g: 0, b: 1 },
      widthPt: 1,
    });
    expect(cells?.[2]?.background).toBeUndefined();
    expect(cells?.[2]?.borders).toBeUndefined();
  });
});

describe("metadata", () => {
  it('round-trips title/subject/author/keywords/dates through a real "\\x05SummaryInformation" stream', () => {
    const input: ContentDocument = {
      ...document([paragraph([{ text: "Hello." }])]),
      metadata: {
        title: "Quarterly report",
        subject: "Finance",
        author: "Joe",
        keywords: ["finance", "quarterly"],
        createdIso: "2024-01-15T09:00:00.000Z",
        modifiedIso: "2024-03-20T14:30:00.000Z",
      },
    };
    const result = roundTrip(input);
    expect(result.metadata).toEqual(input.metadata);
  });

  it('writes no "\\x05SummaryInformation" stream at all when metadata carries nothing that stream can hold', () => {
    const input = document([paragraph([{ text: "Hello." }])]);
    const bytes = writeDocContent(input);
    const streams = readCompoundFile(bytes);
    expect(
      streams.some((stream) => stream.path === "\x05SummaryInformation"),
    ).toBe(false);
    expect(readDocContent(bytes).metadata).toEqual({});
  });

  it("drops creator/producer/language, which SummaryInformation cannot hold, without writing an empty stream for them alone", () => {
    const input: ContentDocument = {
      ...document([paragraph([{ text: "Hello." }])]),
      metadata: {
        creator: "Some Tool",
        producer: "Some Producer",
        language: "en-GB",
      },
    };
    const bytes = writeDocContent(input);
    const streams = readCompoundFile(bytes);
    expect(
      streams.some((stream) => stream.path === "\x05SummaryInformation"),
    ).toBe(false);
    expect(readDocContent(bytes).metadata).toEqual({});
  });

  it("throws a DocFormatError, not a raw RangeError, for a malformed createdIso", () => {
    const input: ContentDocument = {
      ...document([paragraph([{ text: "Hello." }])]),
      metadata: { createdIso: "not-a-real-date" },
    };
    expect(() => writeDocContent(input)).toThrow(DocFormatError);
  });

  it("throws a DocFormatError, not a raw RangeError, for a malformed modifiedIso", () => {
    const input: ContentDocument = {
      ...document([paragraph([{ text: "Hello." }])]),
      metadata: { modifiedIso: "not-a-real-date" },
    };
    expect(() => writeDocContent(input)).toThrow(DocFormatError);
  });
});
