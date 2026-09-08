// Construct-by-construct tests for the bounded HTML-table recogniser itself (ExaDev/documents.js#1089) -- src/table-html-fallback.test.ts covers the full write -> read round trip through the public surface; this file exercises parseHtmlTable directly, including the shapes it deliberately refuses to guess about.

import type { ContentTable } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { parseHtmlTable } from "./html-table";

const CONTENT_WIDTH_PT = 451.28;

// A real, minimal 1x1 PNG -- the identical fixture src/lower/lower.test.ts's own image tests already use.
const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

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
    expect(table?.rows[0]?.cells[1]?.colSpan).toBeUndefined();
    expect(table?.rows[0]?.cells[1]?.rowSpan).toBeUndefined();
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
});
