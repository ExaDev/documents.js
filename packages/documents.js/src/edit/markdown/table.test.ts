import type { ContentBlock, ContentTableCell } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { openMarkdown } from "./editor";
import { buildTable, MarkdownTable, MarkdownTableCell } from "./table";

describe("MarkdownTable appendTable / appendRow / cell.text", () => {
  it("produces a real GFM table, re-parseable back into the same cell texts", () => {
    const editor = openMarkdown("");
    const table = editor.body.appendTable({ rows: 1, columns: 2 });
    table.rows()[0]!.cells()[0]!.text = "Name";
    table.rows()[0]!.cells()[1]!.text = "Score";
    const dataRow = table.appendRow();
    dataRow.cells()[0]!.text = "Ada";
    dataRow.cells()[1]!.text = "100";

    expect(
      table.rows().map((row) => row.cells().map((cell) => cell.text)),
    ).toEqual([
      ["Name", "Score"],
      ["Ada", "100"],
    ]);

    const output = editor.toMarkdownText();
    expect(output).toBe("| Name | Score |\n| --- | --- |\n| Ada | 100 |");

    const reopened = openMarkdown(output);
    const [reopenedTable] = reopened.tables();
    expect(
      reopenedTable?.rows().map((row) => row.cells().map((cell) => cell.text)),
    ).toEqual([
      ["Name", "Score"],
      ["Ada", "100"],
    ]);
  });

  it("appendParagraph/paragraphs() reach a cell own content directly, not just via text", () => {
    const editor = openMarkdown("");
    const table = editor.body.appendTable({ rows: 1, columns: 1 });
    const cell = table.rows()[0]!.cells()[0]!;
    expect(cell.paragraphs()).toHaveLength(1);
    const paragraph = cell.appendParagraph({ text: "Second" });
    expect(cell.paragraphs()).toHaveLength(2);
    expect(paragraph.text).toBe("Second");
    // Two paragraphs joined with a real newline, not concatenated bare — the first is the cell's own untouched default (empty text), the second is "Second".
    expect(cell.text).toBe("\nSecond");
  });

  it("paragraphs()/text ignore a non-paragraph block sharing the cell, filtering strictly by kind", () => {
    const node: ContentTableCell = {
      blocks: [
        { kind: "paragraph", runs: [{ text: "First" }] },
        { kind: "pageBreak" },
        { kind: "paragraph", runs: [{ text: "Third" }] },
      ],
    };
    const cell = new MarkdownTableCell(node);
    expect(cell.paragraphs()).toHaveLength(2);
    expect(cell.text).toBe("First\nThird");
  });
});

describe("buildTable", () => {
  it("divides the default table width evenly across the requested column count", () => {
    const table = buildTable({ rows: 1, columns: 4 });
    expect(table.columnWidthsPt).toEqual([117, 117, 117, 117]);
    expect(table.columnWidthsPt.reduce((sum, w) => sum + w, 0)).toBe(468);
  });
});

describe("MarkdownTable.remove", () => {
  it("removes the table from the body and throws on any further use", () => {
    const editor = openMarkdown("");
    const table = editor.body.appendTable({ rows: 1, columns: 1 });
    expect(editor.tables()).toHaveLength(1);
    table.remove();
    expect(editor.tables()).toHaveLength(0);
    expect(() => table.rows()).toThrow(/removed/);
  });

  it("does nothing to the container when its own node is no longer in it, rather than splicing the wrong element", () => {
    // If the not-found guard were skipped, Array.prototype.splice(-1, 1) would silently remove the container's own LAST element instead of doing nothing.
    const tableNode = buildTable({ rows: 1, columns: 1 });
    const other: ContentBlock = { kind: "paragraph", runs: [] };
    const container: ContentBlock[] = [other, tableNode];
    const table = new MarkdownTable(container, tableNode);
    // Remove the table's own node from the container by some other means first, so remove()'s own indexOf lookup genuinely fails to find it.
    container.splice(container.indexOf(tableNode), 1);
    expect(container).toEqual([other]);
    table.remove();
    expect(container).toEqual([other]);
  });
});

describe("MarkdownTable grid view", () => {
  it("reports the column count and resolves every position to its own cell, as an anchor", () => {
    const editor = openMarkdown("");
    const table = editor.body.appendTable({ rows: 2, columns: 3 });
    table.rows()[1]!.cells()[2]!.text = "corner";

    expect(table.gridColumnCount()).toBe(3);
    const grid = table.gridRows();
    expect(grid).toHaveLength(2);
    expect(grid.every((row) => row.length === 3)).toBe(true);
    expect(grid[1]![2]!.cell.text).toBe("corner");
    expect(
      grid.every((row) => row.every((position) => position?.isAnchor === true)),
    ).toBe(true);
  });

  it("is empty for a table with no rows and no columns", () => {
    const table = openMarkdown("").body.appendTable({ rows: 0, columns: 0 });
    expect(table.gridColumnCount()).toBe(0);
    expect(table.gridRows()).toEqual([]);
  });
});
