// Construct-by-construct tests for the bounded HTML-table recogniser itself (ExaDev/documents.js#1089) -- src/table-html-fallback.test.ts covers the full write -> read round trip through the public surface; this file exercises parseHtmlTable directly, including the shapes it deliberately refuses to guess about.

import type { ContentTable, ContentTableCell } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { parseHtmlTable } from "./html-table";

const CONTENT_WIDTH_PT = 451.28;

// A real, minimal 1x1 PNG -- the identical fixture src/lower/lower.test.ts's own image tests already use.
const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

// That fixture measures one CSS reference pixel each way, which document-schema.js's own point-based geometry records as 72/96 pt.
const ONE_PIXEL_PT = 72 / 96;

const ONE_PIXEL_DATA_URI = `data:image/png;base64,${ONE_PIXEL_PNG_BASE64}`;

// One compact descriptor per cell, so a test can state a whole grid at a glance: the cell's own text, then `|cN` / `|rN` for a colSpan / rowSpan; a covered entry holds no blocks and so reads as the empty string.
function describeCell(cell: ContentTableCell): string {
  const text = cell.blocks
    .flatMap((block) =>
      block.kind === "paragraph" ? block.runs.map((run) => run.text) : [],
    )
    .join("");
  const colSpan = cell.colSpan === undefined ? "" : `|c${String(cell.colSpan)}`;
  const rowSpan = cell.rowSpan === undefined ? "" : `|r${String(cell.rowSpan)}`;
  return `${text}${colSpan}${rowSpan}`;
}

function parse(literal: string): ContentTable | undefined {
  return parseHtmlTable(literal, CONTENT_WIDTH_PT);
}

describe("parseHtmlTable", () => {
  it("returns undefined for anything not starting with <table", () => {
    expect(parse("<div>not a table</div>")).toBeUndefined();
    expect(parse("plain text")).toBeUndefined();
  });

  it("parses a minimal table with no attributes", () => {
    const table = parse("<table>\n<tr><td>a</td></tr>\n</table>");
    expect(table?.rows).toEqual([
      { cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "a" }] }] }] },
    ]);
  });

  it("reads colspan/rowspan as positive integers, and omits them when absent", () => {
    const table = parse(
      '<table>\n<tr><td colspan="2" rowspan="3">x</td><td>y</td></tr>\n</table>',
    );
    expect(table?.rows[0]?.cells[0]?.colSpan).toBe(2);
    expect(table?.rows[0]?.cells[0]?.rowSpan).toBe(3);
    expect(table?.rows[0]?.cells[2]?.colSpan).toBeUndefined();
    expect(table?.rows[0]?.cells[2]?.rowSpan).toBeUndefined();
  });

  it("supplies a block-less covered entry for every grid column a colspan reaches, and sizes the columns from the dense width", () => {
    const table = parse(
      '<table>\n<tr><td colspan="2">wide</td><td>x</td></tr>\n<tr><td>a</td><td>b</td><td>c</td></tr>\n</table>',
    );
    expect(table?.rows.map((row) => row.cells.map(describeCell))).toEqual([
      ["wide|c2", "", "x"],
      ["a", "b", "c"],
    ]);
    expect(table?.rows[0]?.cells[1]).toEqual({ blocks: [] });
    expect(table?.columnWidthsPt).toEqual([
      CONTENT_WIDTH_PT / 3,
      CONTENT_WIDTH_PT / 3,
      CONTENT_WIDTH_PT / 3,
    ]);
  });

  it("places a covered entry at the column a rowspan consumes in the row below, and places that row's own cells after it", () => {
    const table = parse(
      '<table>\n<tr><td rowspan="2">tall</td><td>a</td></tr>\n<tr><td>b</td></tr>\n</table>',
    );
    expect(table?.rows.map((row) => row.cells.map(describeCell))).toEqual([
      ["tall|r2", "a"],
      ["", "b"],
    ]);
    expect(table?.rows[1]?.cells[0]).toEqual({ blocks: [] });
  });

  it("covers every position of a 2x2 merge except its anchor", () => {
    const table = parse(
      '<table>\n<tr><td colspan="2" rowspan="2">m</td><td>x</td></tr>\n<tr><td>y</td></tr>\n</table>',
    );
    expect(table?.rows.map((row) => row.cells.map(describeCell))).toEqual([
      ["m|c2|r2", "", "x"],
      ["", "", "y"],
    ]);
  });

  it("takes the column count from the dense width when a later row is wider than the header, and a header rowspan consumes a column below it", () => {
    const table = parse(
      '<table>\n<tr><th rowspan="2">h</th></tr>\n<tr><td>a</td><td>b</td></tr>\n</table>',
    );
    expect(table?.rows.map((row) => row.cells.map(describeCell))).toEqual([
      ["h|r2", "", ""],
      ["", "a", "b"],
    ]);
    expect(table?.columnWidthsPt).toHaveLength(3);
  });

  it("sizes the columns from a header whose own colspan already exceeds every later row", () => {
    const table = parse(
      '<table>\n<tr><th colspan="3">h</th></tr>\n<tr><td>a</td></tr>\n</table>',
    );
    expect(table?.rows.map((row) => row.cells.map(describeCell))).toEqual([
      ["h|c3", "", ""],
      ["a", "", ""],
    ]);
    expect(table?.columnWidthsPt).toHaveLength(3);
  });

  it("ignores a non-positive or non-numeric colspan/rowspan rather than guessing", () => {
    const table = parse(
      '<table>\n<tr><td colspan="0" rowspan="abc">x</td></tr>\n</table>',
    );
    expect(table?.rows[0]?.cells[0]?.colSpan).toBeUndefined();
    expect(table?.rows[0]?.cells[0]?.rowSpan).toBeUndefined();
  });

  it("reads a solid background-color from a double-quoted style attribute, 3- and 6-digit hex alike", () => {
    const table = parse(
      '<table>\n<tr><td style="background-color:#ff0000">a</td><td style="background-color:#0f0">b</td></tr>\n</table>',
    );
    expect(table?.rows[0]?.cells[0]?.background).toEqual({
      kind: "solid",
      color: { r: 1, g: 0, b: 0 },
    });
    expect(table?.rows[0]?.cells[1]?.background).toEqual({
      kind: "solid",
      color: { r: 0, g: 1, b: 0 },
    });
  });

  it("reads text-align from the same style attribute onto the cell's own paragraph", () => {
    const table = parse(
      '<table>\n<tr><td style="text-align:center">a</td></tr>\n</table>',
    );
    const block = table?.rows[0]?.cells[0]?.blocks[0];
    expect(block?.kind === "paragraph" && block.alignment).toBe("center");
  });

  it("ignores a single-quoted or unquoted attribute value -- double-quoted only, matching exactly what the writer itself emits", () => {
    const table = parse(
      "<table>\n<tr><td colspan='2'>a</td><td colspan=3>b</td></tr>\n</table>",
    );
    expect(table?.rows[0]?.cells[0]?.colSpan).toBeUndefined();
    expect(table?.rows[0]?.cells[1]?.colSpan).toBeUndefined();
  });

  it("recognises bold/italic/strike/hyperlink/code inline tags in any combination and nesting order", () => {
    const table = parse(
      '<table>\n<tr><td><strong><em>both</em></strong> <del>gone</del> <code>mono</code> <a href="https://example.com">link</a></td></tr>\n</table>',
    );
    const block = table?.rows[0]?.cells[0]?.blocks[0];
    if (block?.kind !== "paragraph") {
      throw new Error("expected a paragraph block");
    }
    expect(block.runs).toEqual([
      { text: "both", bold: true, italic: true },
      { text: " " },
      { text: "gone", strike: true },
      { text: " " },
      { text: "mono", fontFamily: "Courier New" },
      { text: " " },
      { text: "link", hyperlink: "https://example.com" },
    ]);
  });

  it("recognises the b/i/s/strike tag synonyms real hand-authored HTML commonly uses", () => {
    const table = parse(
      "<table>\n<tr><td><b>bold</b> <i>italic</i> <s>struck</s></td></tr>\n</table>",
    );
    const block = table?.rows[0]?.cells[0]?.blocks[0];
    if (block?.kind !== "paragraph") {
      throw new Error("expected a paragraph block");
    }
    expect(block.runs).toEqual([
      { text: "bold", bold: true },
      { text: " " },
      { text: "italic", italic: true },
      { text: " " },
      { text: "struck", strike: true },
    ]);
  });

  it("splits multiple <br>-joined segments into separate paragraph blocks", () => {
    const table = parse("<table>\n<tr><td>first<br>second</td></tr>\n</table>");
    expect(table?.rows[0]?.cells[0]?.blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "first" }] },
      { kind: "paragraph", runs: [{ text: "second" }] },
    ]);
  });

  it("recognises an <img> tag as an image block via the same data: URI decoding a markdown image destination already uses", () => {
    const table = parse(
      `<table>\n<tr><td><img src="data:image/png;base64,${ONE_PIXEL_PNG_BASE64}" alt="a pixel"></td></tr>\n</table>`,
    );
    const block = table?.rows[0]?.cells[0]?.blocks[0];
    expect(block?.kind).toBe("image");
    expect(block?.kind === "image" && block.altText).toBe("a pixel");
  });

  it("recognises a cell whose entire content is one nested table as a real nested ContentTable", () => {
    const table = parse(
      "<table>\n<tr><td><table>\n<tr><td>n</td></tr>\n</table></td></tr>\n</table>",
    );
    const block = table?.rows[0]?.cells[0]?.blocks[0];
    expect(block?.kind).toBe("table");
    expect(block?.kind === "table" && block.rows[0]?.cells[0]?.blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "n" }] },
    ]);
  });

  it("returns undefined for an unterminated element rather than guessing", () => {
    expect(parse("<table>\n<tr><td>a</td></tr>")).toBeUndefined();
    expect(parse("<table>\n<tr><td>a\n</table>")).toBeUndefined();
  });

  it("returns undefined for stray content alongside the table, or more than one top-level table in the same block", () => {
    expect(
      parse("<table>\n<tr><td>a</td></tr>\n</table>\nstray text"),
    ).toBeUndefined();
    expect(
      parse(
        "<table>\n<tr><td>a</td></tr>\n</table>\n<table>\n<tr><td>b</td></tr>\n</table>",
      ),
    ).toBeUndefined();
  });

  it("returns undefined for a table with no rows, or a row with no cells", () => {
    expect(parse("<table>\n</table>")).toBeUndefined();
    expect(parse("<table>\n<tr></tr>\n</table>")).toBeUndefined();
  });

  it("decodes the same fixed handful of HTML entities the writer itself escapes to, in an order that never double-unescapes", () => {
    const table = parse(
      "<table>\n<tr><td>a &amp;lt; b &amp; c</td></tr>\n</table>",
    );
    const block = table?.rows[0]?.cells[0]?.blocks[0];
    expect(block?.kind === "paragraph" && block.runs[0]?.text).toBe(
      "a &lt; b & c",
    );
  });

  it("decodes each entity in that handful to its own character", () => {
    const table = parse(
      "<table>\n<tr><td>&lt;a&gt; &quot;q&quot; &#39;s&#39; &amp;</td></tr>\n</table>",
    );
    const block = table?.rows[0]?.cells[0]?.blocks[0];
    expect(block?.kind === "paragraph" && block.runs[0]?.text).toBe(
      "<a> \"q\" 's' &",
    );
  });

  it("returns undefined for stray text sitting between two elements of the same level", () => {
    expect(
      parse("<table>\nstray\n<tr><td>a</td></tr>\n</table>"),
    ).toBeUndefined();
    expect(
      parse("<table>\n<tr>stray<td>a</td></tr>\n</table>"),
    ).toBeUndefined();
  });

  it("reads an attribute whose own name is spelled in any case, as real HTML allows", () => {
    const table = parse('<table>\n<tr><td COLSPAN="2">a</td></tr>\n</table>');
    expect(table?.rows[0]?.cells[0]?.colSpan).toBe(2);
  });

  it("reads the style attribute itself rather than whichever attribute merely comes first", () => {
    const table = parse(
      '<table>\n<tr><td colspan="2" style="background-color:#ff0000;text-align:right">a</td></tr>\n</table>',
    );
    const cell = table?.rows[0]?.cells[0];
    expect(cell?.background).toEqual({
      kind: "solid",
      color: { r: 1, g: 0, b: 0 },
    });
    const block = cell?.blocks[0];
    expect(block?.kind === "paragraph" && block.alignment).toBe("right");
  });

  it("reads every text-align value the writer can produce, and refuses one it cannot", () => {
    const table = parse(
      '<table>\n<tr><td style="text-align:left">l</td><td style="text-align:justify">j</td><td style="text-align:sideways">s</td></tr>\n</table>',
    );
    const cells = table?.rows[0]?.cells;
    const left = cells?.[0]?.blocks[0];
    expect(left?.kind === "paragraph" && left.alignment).toBe("left");
    const justify = cells?.[1]?.blocks[0];
    expect(justify?.kind === "paragraph" && justify.alignment).toBe("justify");
    const unrecognised = cells?.[2]?.blocks[0];
    expect(
      unrecognised?.kind === "paragraph" && unrecognised.alignment,
    ).toBeUndefined();
  });

  it("recognises the <strike> tag synonym alongside <del> and <s>", () => {
    const table = parse(
      "<table>\n<tr><td><strike>gone</strike></td></tr>\n</table>",
    );
    const block = table?.rows[0]?.cells[0]?.blocks[0];
    expect(block?.kind === "paragraph" && block.runs).toEqual([
      { text: "gone", strike: true },
    ]);
  });

  it("reads an anchor's own href rather than whichever attribute merely comes first", () => {
    const table = parse(
      '<table>\n<tr><td><a title="t" href="https://example.com">link</a></td></tr>\n</table>',
    );
    const block = table?.rows[0]?.cells[0]?.blocks[0];
    expect(block?.kind === "paragraph" && block.runs).toEqual([
      { text: "link", hyperlink: "https://example.com" },
    ]);
  });

  it("leaves an unterminated inline tag's own markup literal rather than guessing where it closes", () => {
    const table = parse(
      "<table>\n<tr><td>before <strong>after</td></tr>\n</table>",
    );
    const block = table?.rows[0]?.cells[0]?.blocks[0];
    expect(block?.kind === "paragraph" && block.runs).toEqual([
      { text: "before <strong>after" },
    ]);
  });

  it("reads an <img> tag's own src rather than whichever attribute merely comes first", () => {
    const table = parse(
      `<table>\n<tr><td><img alt="a pixel" src="${ONE_PIXEL_DATA_URI}"></td></tr>\n</table>`,
    );
    const block = table?.rows[0]?.cells[0]?.blocks[0];
    expect(block?.kind).toBe("image");
    expect(block?.kind === "image" && block.altText).toBe("a pixel");
  });

  it("reads an <img> with no alt attribute as an image carrying empty alt text", () => {
    const table = parse(
      `<table>\n<tr><td><img src="${ONE_PIXEL_DATA_URI}"></td></tr>\n</table>`,
    );
    const block = table?.rows[0]?.cells[0]?.blocks[0];
    expect(block?.kind === "image" && block.altText).toBe("");
  });

  it("splits on every <br> spelling, self-closing and spaced alike", () => {
    const table = parse("<table>\n<tr><td>a<br />b<br/>c</td></tr>\n</table>");
    expect(table?.rows[0]?.cells[0]?.blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "a" }] },
      { kind: "paragraph", runs: [{ text: "b" }] },
      { kind: "paragraph", runs: [{ text: "c" }] },
    ]);
  });

  it("trims each <br>-separated segment's own surrounding whitespace", () => {
    const table = parse("<table>\n<tr><td>a <br> b</td></tr>\n</table>");
    expect(table?.rows[0]?.cells[0]?.blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "a" }] },
      { kind: "paragraph", runs: [{ text: "b" }] },
    ]);
  });

  it("skips an empty segment rather than minting a blank paragraph for it", () => {
    const table = parse("<table>\n<tr><td>a<br><br>b</td></tr>\n</table>");
    expect(table?.rows[0]?.cells[0]?.blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "a" }] },
      { kind: "paragraph", runs: [{ text: "b" }] },
    ]);
  });

  it("applies a cell's own alignment to its first block only, leaving every later block untouched", () => {
    const table = parse(
      '<table>\n<tr><td style="text-align:center">a<br>b</td></tr>\n</table>',
    );
    expect(table?.rows[0]?.cells[0]?.blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "a" }], alignment: "center" },
      { kind: "paragraph", runs: [{ text: "b" }] },
    ]);
  });

  it("leaves a cell's own alignment off a first block that is not a paragraph at all", () => {
    const table = parse(
      `<table>\n<tr><td style="text-align:center"><img src="${ONE_PIXEL_DATA_URI}" alt="a pixel"></td></tr>\n</table>`,
    );
    expect(table?.rows[0]?.cells[0]?.blocks[0]).toStrictEqual({
      kind: "image",
      format: "png",
      base64: ONE_PIXEL_PNG_BASE64,
      widthPt: ONE_PIXEL_PT,
      heightPt: ONE_PIXEL_PT,
      altText: "a pixel",
    });
  });

  it("reads an empty cell as one empty paragraph rather than no blocks at all", () => {
    const table = parse("<table>\n<tr><td></td><td>a</td></tr>\n</table>");
    expect(table?.rows[0]?.cells[0]?.blocks).toEqual([
      { kind: "paragraph", runs: [] },
    ]);
  });

  it("omits colSpan, rowSpan and background entirely rather than carrying them as undefined", () => {
    const table = parse("<table>\n<tr><td>a</td></tr>\n</table>");
    expect(table?.rows[0]?.cells[0]).toStrictEqual({
      blocks: [{ kind: "paragraph", runs: [{ text: "a" }] }],
    });
  });
});
