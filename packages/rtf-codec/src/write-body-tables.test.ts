import { describe, expect, it } from "vitest";
import { RtfDiagnosticCodes } from "./diagnostics";
import { asciiText } from "./test-support/bytes";
import { expectBalancedBraces } from "./test-support/brace-balance";
import { writeRtfContent } from "./write";
import { wordprocessing, write } from "./test-support/wordprocessing-document";

describe("tables", () => {
  it("writes a table as \\trowd/\\cellxN row definitions with \\cell and \\row marks", () => {
    const out = write(
      wordprocessing([
        {
          kind: "table",
          columns: [{ widthPt: 72 }, { widthPt: 144 }],
          rows: [
            {
              cells: [
                { blocks: [{ kind: "paragraph", runs: [{ text: "A" }] }] },
                { blocks: [{ kind: "paragraph", runs: [{ text: "B" }] }] },
              ],
            },
          ],
        },
      ]),
    );
    expect(out).toContain("\\trowd\\trgaph108\\trleft0\\cellx1440\\cellx4320");
    expect(out).toContain("\\intbl");
    expect(out).toContain("\\cell");
    expect(out).toContain("\\row");
    // Exactly one \pard\plain\intbl per cell (two cells, two occurrences) — wroteBlock = true after writing each cell's own paragraph is what keeps the !wroteBlock fallback shell from ALSO firing and appending a second, empty one.
    expect(out.match(/\\pard\\plain\\intbl/g)).toHaveLength(2);
    expectBalancedBraces(out);
  });

  it("reports a header column's own drop with a message naming why RTF cannot state it", () => {
    const diagnostics: { code: string; message: string }[] = [];
    writeRtfContent(
      wordprocessing([
        {
          kind: "table",
          columns: [{ widthPt: 72, isHeader: true }, { widthPt: 144 }],
          rows: [
            {
              cells: [
                { blocks: [{ kind: "paragraph", runs: [{ text: "A" }] }] },
                { blocks: [{ kind: "paragraph", runs: [{ text: "B" }] }] },
              ],
            },
          ],
        },
      ]),
      {
        sink: (diagnostic) => {
          diagnostics.push({
            code: diagnostic.code,
            message: diagnostic.message,
          });
        },
      },
    );
    expect(diagnostics).toEqual([
      {
        code: RtfDiagnosticCodes.TABLE_HEADER_COLUMN_DROPPED,
        message:
          "this table states one or more header columns, and RTF has no control word for a column repeating at the left of each printed page, so the flag is dropped and will not read back",
      },
    ]);
  });

  it("resets to \\pard after the table, before whatever follows, so a paragraph after it does not inherit \\intbl", () => {
    const out = write(
      wordprocessing([
        {
          kind: "table",
          columns: [{ widthPt: 72 }],
          rows: [{ cells: [{ blocks: [] }] }],
        },
        { kind: "paragraph", runs: [{ text: "after" }] },
      ]),
    );
    // A bare \pard of its own, on its own line, distinct from the following paragraph's own \pard\plain — removing writeTable's own trailing reset would leave \row immediately followed by the next paragraph's \pard\plain with nothing bare in between.
    expect(out).toMatch(/\\row\n\\pard\n\\pard\\plain \{after\}/);
    // A cell with no blocks at all writes wroteBlock's own fallback shell rather than leaving the \intbl paragraph shell out entirely — wroteBlock starts false and this cell's own loop body never sets it, so an empty cell is the one case that proves the initial value, not just later reassignment, is load-bearing.
    expect(out).toContain("\\pard\\plain\\intbl ");
  });

  it("mints a font table entry for a run's own font family inside a table cell, not only at the top block level", () => {
    // The table-collecting pass's own cell-block loop (noteBlock recursing into cell.blocks) must reach a cell's runs, distinct from the body-writing pass that clearly already does (writeCellBlocks below has its own coverage) — a table with no font this survey pass ever saw would still write \fN references the font table itself never minted.
    const out = write(
      wordprocessing([
        {
          kind: "table",
          columns: [{ widthPt: 72 }],
          rows: [
            {
              cells: [
                {
                  blocks: [
                    {
                      kind: "paragraph",
                      runs: [{ text: "A", fontFamily: "Consolas" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]),
    );
    expect(out).toContain("Consolas;");
  });

  it("writes a header row's \\trhdr inside its own \\trowd, and nothing for an ordinary row", () => {
    const out = write(
      wordprocessing([
        {
          kind: "table",
          columns: [{ widthPt: 72 }],
          rows: [
            {
              isHeader: true,
              cells: [
                { blocks: [{ kind: "paragraph", runs: [{ text: "H" }] }] },
              ],
            },
            {
              cells: [
                { blocks: [{ kind: "paragraph", runs: [{ text: "B" }] }] },
              ],
            },
          ],
        },
      ]),
    );
    expect(out).toContain("\\trowd\\trgaph108\\trleft0\\trhdr\\cellx");
    expect(out).toContain("\\trowd\\trgaph108\\trleft0\\cellx");
  });

  it("writes a header row's direction and \\trhdr together, header first", () => {
    const out = write(
      wordprocessing([
        {
          kind: "table",
          columns: [{ widthPt: 72 }],
          rows: [
            {
              isHeader: true,
              direction: "rtl",
              cells: [
                { blocks: [{ kind: "paragraph", runs: [{ text: "H" }] }] },
              ],
            },
          ],
        },
      ]),
    );
    expect(out).toContain("\\trowd\\trgaph108\\trleft0\\trhdr\\rtlrow\\cellx");
  });

  it("writes a row's direction as the \\rtlrow/\\ltrrow <rowwrite> member inside its own \\trowd", () => {
    const out = write(
      wordprocessing([
        {
          kind: "table",
          columns: [{ widthPt: 72 }],
          rows: [
            {
              direction: "rtl",
              cells: [
                { blocks: [{ kind: "paragraph", runs: [{ text: "A" }] }] },
              ],
            },
            {
              direction: "ltr",
              cells: [
                { blocks: [{ kind: "paragraph", runs: [{ text: "B" }] }] },
              ],
            },
          ],
        },
      ]),
    );
    expect(out).toContain("\\trowd\\trgaph108\\trleft0\\rtlrow");
    expect(out).toContain("\\trowd\\trgaph108\\trleft0\\ltrrow");
    // An unstated row direction writes no <rowwrite> member at all rather than restating the \ltrrow default.
    const plain = write(
      wordprocessing([
        {
          kind: "table",
          columns: [{ widthPt: 72 }],
          rows: [
            {
              cells: [
                { blocks: [{ kind: "paragraph", runs: [{ text: "A" }] }] },
              ],
            },
          ],
        },
      ]),
    );
    expect(plain).toContain("\\trowd\\trgaph108\\trleft0\\cellx");
  });

  it("writes cell verticalAlign as the \\clvertalc/\\clvertalb <cellalign> member, never restating the \\clvertalt default", () => {
    const out = write(
      wordprocessing([
        {
          kind: "table",
          columns: [{ widthPt: 72 }, { widthPt: 72 }],
          rows: [
            {
              cells: [
                {
                  verticalAlign: "center",
                  blocks: [{ kind: "paragraph", runs: [{ text: "A" }] }],
                },
                {
                  verticalAlign: "bottom",
                  blocks: [{ kind: "paragraph", runs: [{ text: "B" }] }],
                },
              ],
            },
          ],
        },
      ]),
    );
    expect(out).toContain("\\clvertalc\\cellx");
    expect(out).toContain("\\clvertalb\\cellx");
    // 'top' and absent both mean the spec's own default, so neither restates \clvertalt.
    expect(out).not.toContain("\\clvertalt");
    const topStated = write(
      wordprocessing([
        {
          kind: "table",
          columns: [{ widthPt: 72 }],
          rows: [
            {
              cells: [
                {
                  verticalAlign: "top",
                  blocks: [{ kind: "paragraph", runs: [{ text: "A" }] }],
                },
              ],
            },
          ],
        },
      ]),
    );
    expect(topStated).not.toContain("\\clvertalt");
  });

  // writeCellBlocks writes a cell's own content as \intbl <pict>/<obj>/paragraph groups — image and embeddedObject blocks borrow the identical \pard\plain\intbl shell a paragraph gets (see the "round trip" describe block below for both), since read.ts's own reader already proves that shape round-trips. A table or pageBreak block placed directly in a cell has no such shell to borrow — a nested table needs its own \itapN row grammar this writer does not build, and a mid-row \page would \pard-reset the row's own \intbl state — so those two kinds are still dropped rather than embedded, reported through CONSTRUCT_UNREPRESENTED rather than filtered out with no diagnostic at all.
  it("reports rather than silently dropping a page break placed directly in a table cell", () => {
    const diagnostics: { code: string; message: string }[] = [];
    const out = asciiText(
      writeRtfContent(
        wordprocessing([
          {
            kind: "table",
            columns: [{ widthPt: 72 }],
            rows: [
              {
                cells: [
                  {
                    blocks: [{ kind: "pageBreak" }],
                  },
                ],
              },
            ],
          },
        ]),
        {
          sink: (diagnostic) => {
            diagnostics.push({
              code: diagnostic.code,
              message: diagnostic.message,
            });
          },
        },
      ),
    );
    expect(diagnostics).toEqual([
      {
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        message:
          "a pageBreak block inside a table cell is dropped: this writer cannot yet splice a pageBreak's own destination grammar into a table row's own \\intbl flow",
      },
    ]);
    expect(out).not.toContain("\\page");
  });

  it("writes a page break as \\page", () => {
    expect(write(wordprocessing([{ kind: "pageBreak" }]))).toContain("\\page");
  });
});
