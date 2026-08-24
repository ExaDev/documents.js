import { MarkdownDiagnosticCodes } from "markdown-codec";
import { describe, expect, it } from "vitest";
import { readMarkdownContent } from "../../markdown/read";
import { buildMarkdownText } from "../../markdown/write";
import { createMarkdownEditor, openMarkdown } from "./editor";

describe("createMarkdownEditor", () => {
  it("produces a document whose toMarkdownText() matches what an empty readMarkdownContent round trip produces", () => {
    const editor = createMarkdownEditor();
    const expected = buildMarkdownText(readMarkdownContent(""));
    expect(editor.toMarkdownText()).toBe(expected);
  });
});

describe("openMarkdown / toMarkdownText round trip", () => {
  const fixture = [
    "# Title",
    "",
    "Some **bold**, *italic*, and ~~struck~~ text with a [link](https://example.com/page).",
    "",
    "- First item",
    "- Second item",
    "",
    "| A | B |",
    "| --- | --- |",
    "| A1 | B1 |",
  ].join("\n");

  it("round-trips headings, bold/italic/strike, a hyperlink, a bullet list, and a table", () => {
    const editor = openMarkdown(fixture);

    const [heading, prose] = editor.paragraphs();
    expect(heading?.headingLevel).toBe(1);
    expect(heading?.text).toBe("Title");

    const runs = prose?.runs() ?? [];
    expect(runs.some((run) => run.bold)).toBe(true);
    expect(runs.some((run) => run.italic)).toBe(true);
    expect(runs.some((run) => run.strike)).toBe(true);
    expect(runs.find((run) => run.hyperlink !== undefined)?.hyperlink).toBe(
      "https://example.com/page",
    );

    const listItems = editor
      .paragraphs()
      .filter((paragraph) => paragraph.list !== undefined);
    expect(listItems.map((paragraph) => paragraph.text)).toEqual([
      "First item",
      "Second item",
    ]);

    const [table] = editor.tables();
    expect(
      table?.rows().map((row) => row.cells().map((cell) => cell.text)),
    ).toEqual([
      ["A", "B"],
      ["A1", "B1"],
    ]);

    // markdown-codec's own default emphasisMarker is "_", not the "**"/"*" the fixture happens to use -- CommonMark discards which literal marker an author chose, so the byte-for-byte source text is not expected to survive, only the semantic content it expressed. Re-parsing the emitted output must recover the identical structure the original fixture produced.
    const output = editor.toMarkdownText();
    const reopened = openMarkdown(output);
    const [reopenedHeading, reopenedProse] = reopened.paragraphs();
    expect(reopenedHeading?.headingLevel).toBe(1);
    expect(reopenedHeading?.text).toBe("Title");
    const reopenedRuns = reopenedProse?.runs() ?? [];
    expect(reopenedRuns.some((run) => run.bold)).toBe(true);
    expect(reopenedRuns.some((run) => run.italic)).toBe(true);
    expect(reopenedRuns.some((run) => run.strike)).toBe(true);
    expect(
      reopenedRuns.find((run) => run.hyperlink !== undefined)?.hyperlink,
    ).toBe("https://example.com/page");
    const reopenedListItems = reopened
      .paragraphs()
      .filter((paragraph) => paragraph.list !== undefined);
    expect(reopenedListItems.map((paragraph) => paragraph.text)).toEqual([
      "First item",
      "Second item",
    ]);
    const [reopenedTable] = reopened.tables();
    expect(
      reopenedTable?.rows().map((row) => row.cells().map((cell) => cell.text)),
    ).toEqual([
      ["A", "B"],
      ["A1", "B1"],
    ]);
  });

  it("produces the documented degradation for a heading level beyond the ATX/setext six-level ceiling", () => {
    const editor = openMarkdown(fixture);
    const [heading] = editor.paragraphs();
    // Pushed directly through the editor, past MAX_HEADING_STYLE_LEVEL -- markdown-codec's own dist/emit/emit.js clamps this to level 6 on write and reports HEADING_LEVEL_CLAMPED, rather than emitting a seventh "#".
    heading!.headingLevel = 8;
    const diagnosticCodes: string[] = [];
    const output = editor.toMarkdownText({
      sink: (diagnostic) => diagnosticCodes.push(diagnostic.code),
    });
    expect(output).toContain("###### Title");
    expect(output).not.toContain("####### Title");
    expect(diagnosticCodes).toContain(
      MarkdownDiagnosticCodes.HEADING_LEVEL_CLAMPED,
    );
  });
});

describe("open -> edit -> toMarkdownText -> reopen", () => {
  it("preserves every paragraph/run/table/list-item edit made through the live editor", () => {
    const editor = openMarkdown("# Start\n");
    const [heading] = editor.paragraphs();
    expect(heading?.headingLevel).toBe(1);

    const intro = editor.body.appendParagraph();
    intro.appendRun({ text: "Intro " });
    const emphasised = intro.appendRun({
      text: "important",
      bold: true,
      italic: true,
    });
    intro.appendRun({ text: " see " });
    const link = intro.appendRun({
      text: "docs",
      hyperlink: "https://example.com/",
    });

    const table = editor.body.appendTable({ rows: 1, columns: 2 });
    table.rows()[0]!.cells()[0]!.text = "Name";
    table.rows()[0]!.cells()[1]!.text = "Score";
    const dataRow = table.appendRow();
    dataRow.cells()[0]!.text = "Ada";
    dataRow.cells()[1]!.text = "100";

    const list = editor.body.startList({ type: "bullet" });
    list.appendItem(0, { text: "First" });
    list.appendItem(0, { text: "Second" });

    expect(emphasised.bold).toBe(true);
    expect(link.hyperlink).toBe("https://example.com/");

    const output = editor.toMarkdownText();
    const reopened = openMarkdown(output);

    const reopenedParagraphs = reopened.paragraphs();
    expect(reopenedParagraphs[0]?.headingLevel).toBe(1);
    expect(reopenedParagraphs[0]?.text).toBe("Start");

    const reopenedIntro = reopenedParagraphs.find((paragraph) =>
      paragraph.text.startsWith("Intro"),
    );
    expect(reopenedIntro).toBeDefined();
    const reopenedRuns = reopenedIntro!.runs();
    const importantRun = reopenedRuns.find((run) => run.text === "important");
    expect(importantRun?.bold).toBe(true);
    expect(importantRun?.italic).toBe(true);
    const linkRun = reopenedRuns.find((run) => run.hyperlink !== undefined);
    expect(linkRun?.hyperlink).toBe("https://example.com/");
    expect(linkRun?.text).toBe("docs");

    const [reopenedTable] = reopened.tables();
    expect(
      reopenedTable?.rows().map((row) => row.cells().map((cell) => cell.text)),
    ).toEqual([
      ["Name", "Score"],
      ["Ada", "100"],
    ]);

    const reopenedListItems = reopenedParagraphs.filter(
      (paragraph) => paragraph.list !== undefined,
    );
    expect(reopenedListItems.map((paragraph) => paragraph.text)).toEqual([
      "First",
      "Second",
    ]);
  });
});
