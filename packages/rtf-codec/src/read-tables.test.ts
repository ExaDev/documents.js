import { describe, expect, it } from "vitest";
import type { ContentParagraph } from "document-schema.js";
import { RtfDiagnosticCodes } from "./diagnostics";
import { readRtfContent } from "./read";
import { HEADER, blocksOf, firstTable } from "./test-support/read-fixtures";
import { bytes } from "./test-support/bytes";

describe("tables", () => {
  const ROW =
    "\\trowd\\trgaph108\\trleft0\\cellx4320\\cellx8640" +
    "\\pard\\intbl A\\cell\\pard\\intbl B\\cell\\row";

  it("builds a table from the \\cell and \\row marks, since RTF has no table group", () => {
    const table = firstTable(`${HEADER}${ROW}\\pard After.\\par}`);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]?.cells).toHaveLength(2);
  });

  it("takes each cell's text from the paragraphs the \\cell mark closes", () => {
    const table = firstTable(`${HEADER}${ROW}\\pard After.\\par}`);
    const firstCell = table.rows[0]?.cells[0]?.blocks[0];
    expect(firstCell?.kind).toBe("paragraph");
    expect(
      firstCell?.kind === "paragraph"
        ? firstCell.runs.map((run) => run.text).join("")
        : undefined,
    ).toBe("A");
  });

  it("derives column widths from the differences between consecutive \\cellxN boundaries", () => {
    const table = firstTable(`${HEADER}${ROW}\\pard After.\\par}`);
    expect(table.columns.map((c) => c.widthPt)).toEqual([216, 216]);
  });

  it("accumulates several rows into one table", () => {
    const table = firstTable(`${HEADER}${ROW}${ROW}\\pard After.\\par}`);
    expect(table.rows).toHaveLength(2);
  });

  it("reads the \\rtlrow/\\ltrrow <rowwrite> member onto ContentTableRow.direction", () => {
    // Each row's own \trowd opens a fresh row definition, so a direction stated inside one row's definition reaches that row alone — the second row's plain \trowd leaves it at the unstated default.
    const table = firstTable(
      HEADER +
        "\\trowd\\trleft0\\rtlrow\\cellx4320\\cellx8640" +
        "\\pard\\intbl A\\cell\\pard\\intbl B\\cell\\row" +
        "\\trowd\\trleft0\\ltrrow\\cellx4320\\cellx8640" +
        "\\pard\\intbl C\\cell\\pard\\intbl D\\cell\\row" +
        "\\trowd\\trleft0\\cellx4320\\cellx8640" +
        "\\pard\\intbl E\\cell\\pard\\intbl F\\cell\\row" +
        "\\pard After.\\par",
    );
    expect(table.rows.map((row) => row.direction)).toEqual([
      "rtl",
      "ltr",
      undefined,
    ]);
  });

  it("reads \\trhdr onto ContentTableRow.isHeader, for whichever rows state it", () => {
    // Each row's own \trowd opens a fresh row definition, so \trhdr reaches the row it was stated in and no other: the flag is neither carried forward to the rows below it nor pulled back to the rows above.
    const table = firstTable(
      HEADER +
        "\\trowd\\trleft0\\trhdr\\cellx4320\\cellx8640" +
        "\\pard\\intbl A\\cell\\pard\\intbl B\\cell\\row" +
        "\\trowd\\trleft0\\cellx4320\\cellx8640" +
        "\\pard\\intbl C\\cell\\pard\\intbl D\\cell\\row" +
        "\\trowd\\trleft0\\trhdr\\cellx4320\\cellx8640" +
        "\\pard\\intbl E\\cell\\pard\\intbl F\\cell\\row" +
        "\\pard After.\\par",
    );
    expect(table.rows.map((row) => row.isHeader)).toEqual([
      true,
      undefined,
      true,
    ]);
  });

  it("leaves every row of a table that states no \\trhdr unflagged", () => {
    const table = firstTable(`${HEADER}${ROW}${ROW}\\pard After.\\par}`);
    expect(table.rows.map((row) => row.isHeader)).toEqual([
      undefined,
      undefined,
    ]);
  });

  // \trowd's own startRowDefinition is what resets isHeader to false between rows, so every test above states \trowd for every row and never actually observes the field's own starting value before any \trowd has run. A row can still close via \cell/\row with no \trowd at all, since both are handled independently of it, so a malformed producer that omits \trowd entirely still reaches ContentBuilder's own unreset default, and that default must itself be "not a header", not just the post-\trowd reset.
  it("leaves a row's own isHeader unset when it closes with no \\trowd ever seen to reset it explicitly", () => {
    const table = firstTable(
      `${HEADER}\\trleft0\\cellx4320\\cellx8640\\pard\\intbl A\\cell\\pard\\intbl B\\cell\\row\\pard After.\\par}`,
    );
    expect(table.rows[0]?.isHeader).toBeUndefined();
  });

  // The same starting-value gap as above, but for the isolated scratch accumulator \result's own fallback content renders into (ContentBuilder's own beginResultScratch/freshAccumulatorState): a table row built inside \result, with no \trowd of its own, must default to unheadered from that scratch's own fresh state rather than carrying over anything from the document \object sits in.
  it("leaves a row built inside \\result's own scratch content unset when it closes with no \\trowd ever seen there either", () => {
    const table = firstTable(
      `${HEADER}\\pard{\\object\\objemb{\\*\\objdata 68656c6c6f}{\\result\\trleft0\\cellx4320\\cellx8640\\pard\\intbl A\\cell\\pard\\intbl B\\cell\\row}}\\par}`,
    );
    expect(table.rows[0]?.isHeader).toBeUndefined();
  });

  it("closes the table when an ordinary paragraph follows it", () => {
    const kinds = blocksOf(`${HEADER}${ROW}\\pard After.\\par}`).map(
      (block) => block.kind,
    );
    expect(kinds).toEqual(["table", "paragraph"]);
  });

  it("keeps several paragraphs inside one cell", () => {
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\cellx4320\\pard\\intbl one\\par\\pard\\intbl two\\cell\\row\\pard After.\\par}`,
    );
    expect(table.rows[0]?.cells[0]?.blocks).toHaveLength(2);
  });

  it("falls back to an even split, with a diagnostic, when the \\cellxN boundaries do not increase", () => {
    const { diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\trowd\\trleft0\\cellx4320\\cellx4320\\pard\\intbl A\\cell\\pard\\intbl B\\cell\\row\\pard x\\par}`,
      ),
    );
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.TABLE_COLUMN_WIDTH_INVALID,
      ),
    ).toBe(true);
  });
});

// RTF 1.9.1, "Table Definitions": <celldef> is the run of properties before each \cellxN, and <brdr> is `<brdrk> \brdrwN? \brspN? \brdrcfN?` — the same border production paragraph borders use, so a cell's side is named by \clbrdrt/l/b/r and described by what follows it.
describe("table cell formatting", () => {
  it("reads each side's own \\clbrdr* border with its style, width and colour", () => {
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0` +
        "\\clbrdrt\\brdrs\\brdrw15\\brdrcf2\\clbrdrb\\brdrdot\\brdrw30\\brdrcf1\\cellx1440" +
        "\\pard\\intbl A\\cell\\row\\pard x\\par}",
    );
    const borders = table.rows[0]?.cells[0]?.borders;
    // No `style` key: ContentBorder's own "absent means 'solid'" already says what \brdrs says, and restating a default carries no information.
    expect(borders?.top).toEqual({
      color: { r: 1, g: 0, b: 0 },
      widthPt: 0.75,
    });
    expect(borders?.bottom).toEqual({
      color: { r: 0, g: 0, b: 0 },
      widthPt: 1.5,
      style: "dotted",
    });
    expect(borders?.left).toBeUndefined();
  });

  it("treats \\brdrnone and \\brdrnil as no border rather than a zero-width one", () => {
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\clbrdrt\\brdrnone\\clbrdrl\\brdrnil\\cellx1440` +
        "\\pard\\intbl A\\cell\\row\\pard x\\par}",
    );
    expect(table.rows[0]?.cells[0]?.borders).toBeUndefined();
  });

  it("reads \\clcbpatN as the cell's background colour", () => {
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\clcbpat2\\cellx1440\\pard\\intbl A\\cell\\row\\pard x\\par}`,
    );
    expect(table.rows[0]?.cells[0]?.background).toEqual({
      kind: "solid",
      color: { r: 1, g: 0, b: 0 },
    });
  });

  // ExaDev/documents.js#1024: \clcbpatN/\clcfpatN/\clshdngN together state a real two-colour pattern fill, not just a flat background colour.
  it("reads \\clshdngN between 0 and 10000 as a genuine two-colour pattern fill", () => {
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\clcbpat1\\clcfpat2\\clshdng2500\\cellx1440\\pard\\intbl A\\cell\\row\\pard x\\par}`,
    );
    expect(table.rows[0]?.cells[0]?.background).toEqual({
      kind: "pattern",
      patternType: "percent25",
      foregroundColor: { r: 1, g: 0, b: 0 },
      backgroundColor: { r: 0, g: 0, b: 0 },
    });
  });

  it("reads \\clshdng0 (or its absence) as a flat background colour, the same shape \\clcbpatN alone already produces", () => {
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\clcbpat2\\clshdng0\\cellx1440\\pard\\intbl A\\cell\\row\\pard x\\par}`,
    );
    expect(table.rows[0]?.cells[0]?.background).toEqual({
      kind: "solid",
      color: { r: 1, g: 0, b: 0 },
    });
  });

  it("reads \\clshdng10000 (100%) as a flat fill of the foreground colour instead", () => {
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\clcbpat1\\clcfpat2\\clshdng10000\\cellx1440\\pard\\intbl A\\cell\\row\\pard x\\par}`,
    );
    expect(table.rows[0]?.cells[0]?.background).toEqual({
      kind: "solid",
      color: { r: 1, g: 0, b: 0 },
    });
  });

  it("snaps an odd \\clshdngN value to its nearest percentN member", () => {
    const table = firstTable(
      // 2222/100 = 22.22%, nearest to 20 (2) rather than 25 (3).
      `${HEADER}\\trowd\\trleft0\\clcbpat1\\clcfpat2\\clshdng2222\\cellx1440\\pard\\intbl A\\cell\\row\\pard x\\par}`,
    );
    const background = table.rows[0]?.cells[0]?.background;
    expect(
      background?.kind === "pattern" ? background.patternType : undefined,
    ).toBe("percent20");
  });

  it("derives rowSpan from \\clvmgf and the \\clvmrg cells beneath it", () => {
    const table = firstTable(
      HEADER +
        "\\trowd\\trleft0\\clvmgf\\cellx1440\\cellx2880\\pard\\intbl A\\cell\\pard\\intbl B\\cell\\row" +
        "\\trowd\\trleft0\\clvmrg\\cellx1440\\cellx2880\\pard\\intbl\\cell\\pard\\intbl C\\cell\\row" +
        "\\pard x\\par}",
    );
    expect(table.rows[0]?.cells[0]?.rowSpan).toBe(2);
    // The continuation cell stays in the row with no blocks of its own, matching how every other codec in this family states a covered cell.
    expect(table.rows[1]?.cells[0]?.blocks).toEqual([]);
    expect(table.rows[1]?.cells[0]?.rowSpan).toBeUndefined();
  });

  it("derives colSpan from \\clmgf and the \\clmrg cells beside it", () => {
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\clmgf\\cellx1440\\clmrg\\cellx2880\\cellx4320` +
        "\\pard\\intbl A\\cell\\pard\\intbl\\cell\\pard\\intbl C\\cell\\row\\pard x\\par}",
    );
    expect(table.rows[0]?.cells[0]?.colSpan).toBe(2);
    // One entry per grid column: the covered column keeps its own block-less entry rather than being folded into the anchor.
    expect(table.rows[0]?.cells).toHaveLength(3);
    expect(table.rows[0]?.cells[1]).toEqual({
      blocks: [],
      background: undefined,
      borders: undefined,
      verticalAlign: undefined,
    });
    expect(table.rows[0]?.cells[2]?.blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "C", sizePt: 12 }] },
    ]);
  });

  it("leaves a plain cell carrying no borders, background, or span fields at all", () => {
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\cellx1440\\pard\\intbl A\\cell\\row\\pard x\\par}`,
    );
    expect(table.rows[0]?.cells[0]).toEqual({
      blocks: [{ kind: "paragraph", runs: [{ text: "A", sizePt: 12 }] }],
    });
  });

  it("reads the \\clvertalt/\\clvertalc/\\clvertalb <cellalign> member onto ContentTableCell.verticalAlign, with the stated default collapsing into absence", () => {
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\clvertalt\\cellx1440\\clvertalc\\cellx2880\\clvertalb\\cellx4320` +
        "\\pard\\intbl top\\cell\\pard\\intbl middle\\cell\\pard\\intbl bottom\\cell\\row\\pard x\\par}",
    );
    // \clvertalt is the spec's own default ("Text is top-aligned in cell (the default)"), and the field's absence already means top, so the word carries nothing the absence doesn't — the same collapse the reader applies to \sbkpage against ContentSection.breakType.
    expect(table.rows[0]?.cells.map((cell) => cell.verticalAlign)).toEqual([
      undefined,
      "center",
      "bottom",
    ]);
  });
});

describe("table cell merge span", () => {
  it("gives a plain, non-anchor cell a span of one even when a later, unrelated cell carries its own continuation flag", () => {
    // The second cell's own \clmrg is malformed here (no preceding \clmgf anchors it), but horizontalSpanAt's own guard must still be keyed on THIS cell's own horizontalMergeFirst flag, not fall through to scanning forward regardless of it.
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\cellx1440\\clmrg\\cellx2880\\pard\\intbl A\\cell\\pard\\intbl B\\cell\\row\\pard x\\par}`,
    );
    expect(table.rows[0]?.cells[0]?.colSpan).toBeUndefined();
    // The unanchored continuation still occupies its own grid column.
    expect(table.rows[0]?.cells).toHaveLength(2);
    expect(table.rows[0]?.cells[1]?.blocks).toEqual([]);
  });
});

describe("table merges read into the dense grid", () => {
  const text = (value: string) => ({
    kind: "paragraph",
    runs: [{ text: value, sizePt: 12 }],
  });

  it("reads a horizontal merge as one cell per grid column with the anchor carrying colSpan", () => {
    const table = firstTable(
      HEADER +
        "\\trowd\\trleft0\\clmgf\\cellx1440\\clmrg\\cellx2880\\clmrg\\cellx4320\\cellx5760" +
        "\\pard\\intbl A\\cell\\pard\\intbl\\cell\\pard\\intbl\\cell\\pard\\intbl B\\cell\\row" +
        "\\trowd\\trleft0\\cellx1440\\cellx2880\\cellx4320\\cellx5760" +
        "\\pard\\intbl 1\\cell\\pard\\intbl 2\\cell\\pard\\intbl 3\\cell\\pard\\intbl 4\\cell\\row\\pard z\\par}",
    );
    expect(table.columns).toHaveLength(4);
    expect(table.rows.map((row) => row.cells.length)).toEqual([4, 4]);
    const [first] = table.rows;
    expect(first?.cells.map((cell) => cell.colSpan)).toEqual([
      3,
      undefined,
      undefined,
      undefined,
    ]);
    expect(first?.cells.map((cell) => cell.blocks)).toEqual([
      [text("A")],
      [],
      [],
      [text("B")],
    ]);
  });

  it("reads a vertical merge as one cell per grid column in every row with the anchor carrying rowSpan", () => {
    const table = firstTable(
      HEADER +
        "\\trowd\\trleft0\\clvmgf\\cellx1440\\cellx2880" +
        "\\pard\\intbl A\\cell\\pard\\intbl x\\cell\\row" +
        "\\trowd\\trleft0\\clvmrg\\cellx1440\\cellx2880" +
        "\\pard\\intbl\\cell\\pard\\intbl y\\cell\\row" +
        "\\trowd\\trleft0\\clvmrg\\cellx1440\\cellx2880" +
        "\\pard\\intbl\\cell\\pard\\intbl z\\cell\\row\\pard z\\par}",
    );
    expect(table.rows.map((row) => row.cells.length)).toEqual([2, 2, 2]);
    expect(table.rows.map((row) => row.cells[0]?.rowSpan)).toEqual([
      3,
      undefined,
      undefined,
    ]);
    expect(table.rows.map((row) => row.cells[0]?.blocks)).toEqual([
      [text("A")],
      [],
      [],
    ]);
  });

  it("reads a 2x2 merge as an anchor carrying both spans and a block-less entry at each other position", () => {
    // Word's own spelling of a 2x2 region: every position of the second row and the second column carries the flags mirroring the first row and column.
    const table = firstTable(
      HEADER +
        "\\trowd\\trleft0\\clmgf\\clvmgf\\cellx1440\\clmrg\\clvmgf\\cellx2880\\cellx4320" +
        "\\pard\\intbl A\\cell\\pard\\intbl\\cell\\pard\\intbl B\\cell\\row" +
        "\\trowd\\trleft0\\clmgf\\clvmrg\\cellx1440\\clmrg\\clvmrg\\cellx2880\\cellx4320" +
        "\\pard\\intbl\\cell\\pard\\intbl\\cell\\pard\\intbl C\\cell\\row\\pard z\\par}",
    );
    expect(table.rows.map((row) => row.cells.length)).toEqual([3, 3]);
    expect(table.rows[0]?.cells[0]).toMatchObject({ colSpan: 2, rowSpan: 2 });
    for (const covered of [
      table.rows[0]?.cells[1],
      table.rows[1]?.cells[0],
      table.rows[1]?.cells[1],
    ]) {
      expect(covered?.blocks).toEqual([]);
      expect(covered?.colSpan).toBeUndefined();
      expect(covered?.rowSpan).toBeUndefined();
    }
    expect(table.rows[0]?.cells[2]?.blocks).toEqual([text("B")]);
    expect(table.rows[1]?.cells[2]?.blocks).toEqual([text("C")]);
  });

  it("pads a row that ends before the definition's last boundary with empty entries", () => {
    const table = firstTable(
      HEADER +
        "\\trowd\\trleft0\\cellx1440\\cellx2880\\cellx4320\\pard\\intbl A\\cell\\row\\pard z\\par}",
    );
    expect(table.rows[0]?.cells).toHaveLength(3);
    expect(table.rows[0]?.cells[2]?.blocks).toEqual([]);
  });

  it("carries a covered position's own borders, shading and vertical alignment from its own cell definition", () => {
    const table = firstTable(
      HEADER +
        "\\trowd\\trleft0\\clmgf\\cellx1440\\clmrg\\clvertalb\\clbrdrt\\brdrs\\brdrw30\\clcbpat1\\cellx2880" +
        "\\pard\\intbl A\\cell\\pard\\intbl\\cell\\row" +
        "\\trowd\\trleft0\\clvmgf\\cellx1440\\clvmrg\\clvertalc\\cellx2880" +
        "\\pard\\intbl A\\cell\\pard\\intbl\\cell\\row\\pard z\\par}",
    );
    const horizontallyCovered = table.rows[0]?.cells[1];
    expect(horizontallyCovered?.blocks).toEqual([]);
    expect(horizontallyCovered?.verticalAlign).toBe("bottom");
    expect(horizontallyCovered?.borders?.top?.widthPt).toBe(1.5);
    expect(table.rows[1]?.cells[1]?.verticalAlign).toBe("center");
  });
});

describe("table row and column derivation", () => {
  it("does not open a synthetic empty cell when a \\row closes with no pending text and no cell already collected", () => {
    // \row with genuinely nothing accumulated — no \cell mark reached at all — must not call endCell and manufacture a phantom cell from nothing; TABLE_ROW_WITHOUT_DEFINITION already covers that case on its own terms.
    const { diagnostics } = readRtfContent(
      bytes(`${HEADER}\\trowd\\trleft0\\cellx1440\\row\\pard x\\par}`),
    );
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.TABLE_ROW_WITHOUT_DEFINITION,
      ),
    ).toBe(true);
  });

  it("resets inTable to false once \\row closes, even with no \\pard afterward to do it instead", () => {
    // Every other table fixture in this file follows its own \row with an explicit \pard, which resets para.inTable back to false on its own via defaultParagraphState() — masking whether \row's OWN reset does anything at all. Typing text directly after \row, with no \pard in between, is the one shape that actually depends on \row's own case resetting inTable itself: without it, "after" would stay routed into the now-closed table's own cellBlocks instead of the section's real blocks.
    const blocks = blocksOf(
      `${HEADER}\\trowd\\trleft0\\cellx1440\\pard\\intbl cell\\cell\\row after\\par}`,
    );
    const paragraphs = blocks.filter(
      (block): block is ContentParagraph => block.kind === "paragraph",
    );
    expect(
      paragraphs.some((paragraph) =>
        paragraph.runs.some((run) => run.text.includes("after")),
      ),
    ).toBe(true);
  });

  it("still closes a dangling cell whose own \\cell mark is missing but a \\row follows it directly", () => {
    // Real producers occasionally omit the final \cell before \row; endRow's own guard must still call endCell for whatever text or blocks accumulated, rather than losing it because \row's own trigger conditions were read too narrowly.
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\cellx1440\\pard\\intbl dangling\\row\\pard x\\par}`,
    );
    expect(table.rows[0]?.cells).toHaveLength(1);
    const firstBlock = table.rows[0]?.cells[0]?.blocks[0];
    expect(
      firstBlock?.kind === "paragraph"
        ? firstBlock.runs.map((run) => run.text).join("")
        : undefined,
    ).toBe("dangling");
  });

  it("still closes a dangling cell holding only an already-flushed block (no pending text at all) when \\row follows directly", () => {
    // A picture already pushed into cellBlocks via addBlocks, with nothing typed after it — pendingRunText is genuinely empty here, so this exercises endRow's own cellBlocks.length check specifically, not the pendingRunText half of its guard.
    const PNG_HEX =
      "89504e470d0a1a0a0000000d494844520000000100000001080600000" +
      "01f15c4890000000a49444154789c6300010000050001" +
      "0d0a2db40000000049454e44ae426082";
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\cellx1440\\pard\\intbl{\\pict\\pngblip\\picwgoal720\\pichgoal720 ${PNG_HEX}}\\row\\pard x\\par}`,
    );
    expect(table.rows[0]?.cells).toHaveLength(1);
    expect(table.rows[0]?.cells[0]?.blocks[0]?.kind).toBe("image");
  });

  it("produces a genuinely empty cell (no blocks at all) for a cell with no content, rather than a phantom empty paragraph", () => {
    // endCell's own endParagraph(para, false) must NOT force-close: an empty, never-typed-in cell has zero runs, and force=false is exactly what lets that produce no block at all.
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\cellx1440\\pard\\intbl\\cell\\row\\pard x\\par}`,
    );
    expect(table.rows[0]?.cells[0]?.blocks).toEqual([]);
  });

  it("splices a bookmark closed inside a cell into that cell's own blocks, not the section's", () => {
    // 'inCell' opens in the cell's first paragraph and closes in its second, still inside the same cell — endCell's own flushClosingBookmarks call must target inTable=true (the cell's own cellBlockExtents), not the section's, or the marker pair ends up missing from the cell entirely.
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\cellx1440\\pard\\intbl{\\*\\bkmkstart inCell}One\\par\\pard\\intbl Two{\\*\\bkmkend inCell}\\cell\\row\\pard x\\par}`,
    );
    const kinds = table.rows[0]?.cells[0]?.blocks.map((block) => block.kind);
    expect(kinds).toEqual([
      "constructStart",
      "paragraph",
      "paragraph",
      "constructEnd",
    ]);
  });

  it("still resolves a bookmark whose own \\bkmkend lands in an otherwise-empty trailing paragraph right before \\cell, via endCell's own explicit flush rather than endParagraph's", () => {
    // \bkmkend here is the ONLY thing in its paragraph — no text follows it before \cell — so endParagraph's own force=false early return (runs.length === 0) fires without ever calling resolveBookmarkPositions, leaving 'trailing' still sitting in closingBookmarks when endCell reaches its OWN explicit flushClosingBookmarks(true, ...) call two lines later. That explicit call is the only thing that still resolves it; if its own hardcoded inTable argument read false instead of true, closing.inTable (true, since the bookmark opened inside \intbl) would no longer match, and 'trailing' would be wrongly dropped as straddling a cell boundary it never actually crossed.
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\cellx1440\\pard\\intbl{\\*\\bkmkstart trailing}One\\par\\pard\\intbl{\\*\\bkmkend trailing}\\cell\\row\\pard x\\par}`,
    );
    const kinds = table.rows[0]?.cells[0]?.blocks.map((block) => block.kind);
    expect(kinds).toEqual(["constructStart", "paragraph", "constructEnd"]);
  });

  it("reports the exact TABLE_ROW_WITHOUT_DEFINITION message text", () => {
    const { diagnostics } = readRtfContent(
      bytes(`${HEADER}\\trowd\\trleft0\\cellx1440\\row\\pard x\\par}`),
    );
    const found = diagnostics.find(
      (diagnostic) =>
        diagnostic.code === RtfDiagnosticCodes.TABLE_ROW_WITHOUT_DEFINITION,
    );
    expect(found?.message).toBe(
      "a \\row closed a table row that contained no \\cell marks",
    );
  });

  it("takes column widths from the FIRST row's own \\cellxN boundaries, not a later row's", () => {
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\cellx1000\\cellx2000\\pard\\intbl A\\cell\\pard\\intbl B\\cell\\row` +
        "\\trowd\\trleft0\\cellx5000\\cellx9000\\pard\\intbl C\\cell\\pard\\intbl D\\cell\\row\\pard x\\par}",
    );
    expect(table.columns.map((c) => c.widthPt)).toEqual([50, 50]);
  });

  it("counts grid columns from a row's own cell spans when they exceed the \\cellxN boundary count", () => {
    // \cellxN only ever names 2 boundaries here, but a horizontally merged anchor covering both plus a genuinely wider second row proves columnCount is derived from actual cell spans, not capped at the boundary count alone.
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\clmgf\\cellx2160\\clmrg\\cellx4320\\pard\\intbl wide\\cell\\pard\\intbl\\cell\\row` +
        "\\trowd\\trleft0\\cellx1440\\cellx2880\\cellx4320\\pard\\intbl a\\cell\\pard\\intbl b\\cell\\pard\\intbl c\\cell\\row\\pard x\\par}",
    );
    expect(table.columns.length).toBeGreaterThanOrEqual(3);
    // Every row is as wide as the grid, the first row being padded with an empty entry to reach the wider second row's width.
    expect(table.rows.map((row) => row.cells.length)).toEqual([3, 3]);
  });

  it("keeps both a horizontal and a vertical continuation as a block-less entry at its own grid column", () => {
    const table = firstTable(
      HEADER +
        "\\trowd\\trleft0\\clmgf\\cellx1440\\clmrg\\cellx2880\\pard\\intbl merged\\cell\\pard\\intbl stray\\cell\\row" +
        "\\trowd\\trleft0\\clvmgf\\cellx1440\\cellx2880\\pard\\intbl v\\cell\\pard\\intbl w\\cell\\row" +
        "\\trowd\\trleft0\\clvmrg\\cellx1440\\cellx2880\\pard\\intbl stray\\cell\\pard\\intbl x\\cell\\row\\pard z\\par}",
    );
    // Row 0's horizontal continuation keeps its own entry, so the row has one cell per grid column. The continuation carried a "stray" run in the source (a real producer's own continuation cell does sometimes still write placeholder text, even though the spec's own merge model says only the anchor's content is real) and it is discarded.
    expect(table.rows[0]?.cells).toHaveLength(2);
    expect(table.rows[0]?.cells[1]?.blocks).toEqual([]);
    expect(table.rows[2]?.cells).toHaveLength(2);
    expect(table.rows[2]?.cells[0]?.blocks).toEqual([]);
    expect(table.rows[2]?.cells[1]?.blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "x", sizePt: 12 }] },
    ]);
  });

  it("derives rowSpan of exactly two, not three, when the row after a merge run is a genuinely ordinary row", () => {
    const table = firstTable(
      HEADER +
        "\\trowd\\trleft0\\clvmgf\\cellx1440\\pard\\intbl A\\cell\\row" +
        "\\trowd\\trleft0\\clvmrg\\cellx1440\\pard\\intbl\\cell\\row" +
        "\\trowd\\trleft0\\cellx1440\\pard\\intbl B\\cell\\row\\pard x\\par}",
    );
    expect(table.rows[0]?.cells[0]?.rowSpan).toBe(2);
    expect(table.rows[2]?.cells[0]?.rowSpan).toBeUndefined();
  });

  it("never scans for a continuation at all under a genuinely ordinary cell that carries no \\clvmgf anchor of its own", () => {
    // Row 0's cell is a plain, unmerged cell — no \clvmgf — while row 1's cell at the identical column IS a \clvmrg continuation (malformed on its own, since nothing anchors it, but the reader's own rowSpan derivation must still be gated on THIS cell's own verticalMergeFirst flag, not on whether a match happens to exist somewhere later). A guard that entered the scanning loop unconditionally would find row 1's continuation anyway and wrongly extend row 0's plain cell to rowSpan 2.
    const table = firstTable(
      HEADER +
        "\\trowd\\trleft0\\cellx1440\\pard\\intbl A\\cell\\row" +
        "\\trowd\\trleft0\\clvmrg\\cellx1440\\pard\\intbl\\cell\\row\\pard x\\par}",
    );
    expect(table.rows[0]?.cells[0]?.rowSpan).toBeUndefined();
  });

  it("derives rowSpan of exactly three when a merge run spans two genuine continuation rows, not one", () => {
    // Two REAL \clvmrg continuation rows after the anchor, not one: a scan loop that stepped backwards instead of forwards would revisit the anchor's own row on its second iteration (rowIndex itself is never a verticalMergeContinuation, so that immediately breaks the loop) and stop after counting only the FIRST continuation — rowSpan 2 — indistinguishable from the existing "exactly two, not three" fixture above, which only ever has one continuation row to begin with and so cannot tell a reversed loop direction apart from a correct one.
    const table = firstTable(
      HEADER +
        "\\trowd\\trleft0\\clvmgf\\cellx1440\\pard\\intbl A\\cell\\row" +
        "\\trowd\\trleft0\\clvmrg\\cellx1440\\pard\\intbl\\cell\\row" +
        "\\trowd\\trleft0\\clvmrg\\cellx1440\\pard\\intbl\\cell\\row" +
        "\\trowd\\trleft0\\cellx1440\\pard\\intbl B\\cell\\row\\pard x\\par}",
    );
    expect(table.rows[0]?.cells[0]?.rowSpan).toBe(3);
  });

  it("still matches a continuation whose own row places it at grid column one, not only at column zero", () => {
    // The anchor is the SECOND cell of its own row here (a plain first cell precedes it), and the continuation row below it also places its \\clvmrg as its second cell. A scan that only ever looked at column zero would never find it, as every other fixture here places its match there.
    const table = firstTable(
      HEADER +
        "\\trowd\\trleft0\\cellx1440\\clvmgf\\cellx2880\\pard\\intbl first\\cell\\pard\\intbl anchor\\cell\\row" +
        "\\trowd\\trleft0\\cellx1440\\clvmrg\\cellx2880\\pard\\intbl x\\cell\\pard\\intbl\\cell\\row\\pard z\\par}",
    );
    expect(table.rows[0]?.cells[1]?.rowSpan).toBe(2);
  });

  it("leaves rowSpan at one for a \\clvmgf anchor in the table's own last row, with no following row to continue into", () => {
    const table = firstTable(
      `${HEADER}\\trowd\\trleft0\\clvmgf\\cellx1440\\pard\\intbl only\\cell\\row\\pard x\\par}`,
    );
    expect(table.rows[0]?.cells[0]?.rowSpan).toBeUndefined();
  });

  it("matches a \\clvmgf anchor sitting after a real \\clmgf/\\clmrg column span against the continuation at the same grid column", () => {
    // The anchor sits at grid column 2, after a colSpan-2 pair that occupies columns 0 and 1. The continuation row reaches the same column through two plain cells and then the \\clvmrg, so the two rows only agree because a cell's index in its row is its grid column.
    const table = firstTable(
      HEADER +
        "\\trowd\\trleft0\\clmgf\\cellx1440\\clmrg\\cellx2880\\clvmgf\\cellx4320" +
        "\\pard\\intbl first\\cell\\pard\\intbl\\cell\\pard\\intbl anchor\\cell\\row" +
        "\\trowd\\trleft0\\cellx1440\\cellx2880\\clvmrg\\cellx4320" +
        "\\pard\\intbl\\cell\\pard\\intbl\\cell\\pard\\intbl\\cell\\row" +
        "\\pard z\\par}",
    );
    expect(table.rows[0]?.cells[0]?.colSpan).toBe(2);
    expect(table.rows[0]?.cells[2]?.blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "anchor", sizePt: 12 }] },
    ]);
    expect(table.rows[0]?.cells[2]?.rowSpan).toBe(2);
    expect(table.rows[1]?.cells[2]?.blocks).toEqual([]);
    expect(table.rows[1]?.cells[2]?.rowSpan).toBeUndefined();
  });

  it("does not extend a \\clvmgf anchor through a continuation at a different grid column", () => {
    // The continuation below sits at column 3, one past the anchor's own column 2, so it belongs to no vertical merge of this anchor.
    const table = firstTable(
      HEADER +
        "\\trowd\\trleft0\\cellx1440\\cellx2880\\clvmgf\\cellx4320\\cellx5760" +
        "\\pard\\intbl\\cell\\pard\\intbl\\cell\\pard\\intbl anchor\\cell\\pard\\intbl\\cell\\row" +
        "\\trowd\\trleft0\\cellx1440\\cellx2880\\cellx4320\\clvmrg\\cellx5760" +
        "\\pard\\intbl\\cell\\pard\\intbl\\cell\\pard\\intbl\\cell\\pard\\intbl\\cell\\row" +
        "\\pard z\\par}",
    );
    expect(table.rows[0]?.cells[2]?.rowSpan).toBeUndefined();
  });

  it("falls back to an even split when the \\cellxN boundaries describe fewer columns than the row actually has", () => {
    const { diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\trowd\\trleft0\\cellx4320\\pard\\intbl A\\cell\\pard\\intbl B\\cell\\row\\pard x\\par}`,
      ),
    );
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.TABLE_COLUMN_WIDTH_INVALID,
      ),
    ).toBe(true);
  });

  it("reports the exact TABLE_COLUMN_WIDTH_INVALID message text", () => {
    const { diagnostics } = readRtfContent(
      bytes(
        `${HEADER}\\trowd\\trleft0\\cellx4320\\cellx4320\\pard\\intbl A\\cell\\pard\\intbl B\\cell\\row\\pard x\\par}`,
      ),
    );
    const found = diagnostics.find(
      (diagnostic) =>
        diagnostic.code === RtfDiagnosticCodes.TABLE_COLUMN_WIDTH_INVALID,
    );
    expect(found?.message).toBe(
      "the row's \\cellxN boundaries do not describe increasing column widths for every column; falling back to an even split of the page's text width",
    );
  });

  it("splits the even-split fallback width by dividing the usable width, not multiplying it, across the column count", () => {
    const table = firstTable(
      "{\\rtf1\\ansi\\ansicpg1252\\deff0" +
        "{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}}{\\colortbl;}" +
        "\\paperw12240\\paperh15840\\margl1440\\margr1440" +
        "\\trowd\\trleft0\\cellx1440\\cellx1440\\pard\\intbl A\\cell\\pard\\intbl B\\cell\\row\\pard x\\par}",
    );
    // Usable width is 8.5in - 2in = 6.5in = 468pt, split across 2 columns.
    expect(table.columns.map((c) => c.widthPt)).toEqual([234, 234]);
  });
});
