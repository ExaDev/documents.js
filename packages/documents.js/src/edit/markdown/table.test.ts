import { describe, expect, it } from "vitest";
import { openMarkdown } from "./editor";

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
});
