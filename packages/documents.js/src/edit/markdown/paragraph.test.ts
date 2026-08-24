import { MarkdownDiagnosticCodes } from "markdown-codec";
import { describe, expect, it } from "vitest";
import { openMarkdown } from "./editor";
import type { MarkdownParagraph } from "./paragraph";

function freshParagraph(): MarkdownParagraph {
  const editor = openMarkdown("");
  return editor.body.appendParagraph();
}

describe("MarkdownParagraph.appendRun / runs / text", () => {
  it("aggregates text across multiple runs in order", () => {
    const paragraph = freshParagraph();
    paragraph.appendRun({ text: "Left " });
    paragraph.appendRun({ text: "Right" });
    expect(paragraph.text).toBe("Left Right");
    expect(paragraph.runs().map((run) => run.text)).toEqual(["Left ", "Right"]);
  });

  it("insertRunAt inserts at the requested run position", () => {
    const paragraph = freshParagraph();
    paragraph.appendRun({ text: "First" });
    paragraph.appendRun({ text: "Third" });
    paragraph.insertRunAt(1, { text: "Second" });
    expect(paragraph.runs().map((run) => run.text)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
  });
});

describe("MarkdownParagraph.styleId", () => {
  it("reads and writes styleId directly", () => {
    const paragraph = freshParagraph();
    expect(paragraph.styleId).toBeUndefined();
    paragraph.styleId = "Quote";
    expect(paragraph.styleId).toBe("Quote");
    paragraph.styleId = undefined;
    expect(paragraph.styleId).toBeUndefined();
  });
});

describe("MarkdownParagraph.headingLevel", () => {
  it("reads and writes headingLevel via the Heading<N> styleId convention", () => {
    const paragraph = freshParagraph();
    expect(paragraph.headingLevel).toBeUndefined();
    paragraph.headingLevel = 2;
    expect(paragraph.styleId).toBe("Heading2");
    expect(paragraph.headingLevel).toBe(2);
    paragraph.headingLevel = undefined;
    expect(paragraph.styleId).toBeUndefined();
    expect(paragraph.headingLevel).toBeUndefined();
  });
});

describe("MarkdownParagraph.quoteDepth", () => {
  it("reads and writes quoteDepth in QUOTE_INDENT_PT steps on a quotable paragraph", () => {
    const paragraph = freshParagraph();
    paragraph.styleId = "Quote";
    expect(paragraph.quoteDepth).toBe(0);
    paragraph.quoteDepth = 2;
    expect(paragraph.quoteDepth).toBe(2);
    paragraph.quoteDepth = 0;
    expect(paragraph.quoteDepth).toBe(0);
  });

  it("is silently dropped on save for a paragraph whose styleId is not quotable, reported via PARAGRAPH_INDENT_DROPPED", () => {
    const editor = openMarkdown("");
    const paragraph = editor.body.appendParagraph();
    paragraph.appendRun({ text: "Plain text" });
    // No quotable styleId (Quote/CodeBlock/HorizontalRule/HTMLPreformatted/Heading1..6) is set -- this indent has no markdown representation to render into.
    paragraph.quoteDepth = 1;
    expect(paragraph.quoteDepth).toBe(1);

    const diagnosticCodes: string[] = [];
    const output = editor.toMarkdownText({
      sink: (diagnostic) => diagnosticCodes.push(diagnostic.code),
    });
    expect(output).toBe("Plain text");
    expect(output).not.toContain(">");
    expect(diagnosticCodes).toContain(
      MarkdownDiagnosticCodes.PARAGRAPH_INDENT_DROPPED,
    );
  });
});

describe("MarkdownParagraph.list", () => {
  it("reads and writes a flat {numId, level} membership", () => {
    const paragraph = freshParagraph();
    expect(paragraph.list).toBeUndefined();
    paragraph.list = { numId: "md1:bullet", level: 0 };
    expect(paragraph.list).toEqual({ numId: "md1:bullet", level: 0 });
    paragraph.list = undefined;
    expect(paragraph.list).toBeUndefined();
  });
});

describe("MarkdownParagraph.remove", () => {
  it("removes the paragraph from its body and throws on any further use", () => {
    const editor = openMarkdown("");
    const paragraph = editor.body.appendParagraph({ text: "Bye" });
    expect(editor.paragraphs()).toHaveLength(1);
    paragraph.remove();
    expect(editor.paragraphs()).toHaveLength(0);
    expect(() => paragraph.text).toThrow(/removed/);
  });
});
