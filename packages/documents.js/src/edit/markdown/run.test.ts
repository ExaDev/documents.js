import { describe, expect, it } from "vitest";
import { openMarkdown } from "./editor";
import type { MarkdownRun } from "./run";

function freshRun(): MarkdownRun {
  const editor = openMarkdown("");
  return editor.body.appendParagraph().appendRun();
}

describe("MarkdownRun text", () => {
  it("reads and writes plain text", () => {
    const run = freshRun();
    run.text = "Hello";
    expect(run.text).toBe("Hello");
    run.text = "Goodbye";
    expect(run.text).toBe("Goodbye");
  });
});

describe("MarkdownRun bold/italic/strike", () => {
  // markdown-codec's own default emphasisMarker is "_", but its dist/emit/inline.js pickEmphasisMarker treats "_" as an intraword risk whenever the body starts or ends with a word character (CommonMark disallows intraword "_" emphasis) -- ordinary word text like "bold"/"italic" therefore always falls back to the "*" alternate regardless of the configured default, which is what these two assertions pin down.
  it("render the exact expected markdown syntax on toMarkdownText()", () => {
    const editor = openMarkdown("");
    const paragraph = editor.body.appendParagraph();
    paragraph.appendRun({ text: "bold", bold: true });
    expect(editor.toMarkdownText()).toBe("**bold**");
  });

  it('italic renders with the "*" fallback marker (word-boundary text is an intraword risk for the default "_")', () => {
    const editor = openMarkdown("");
    const paragraph = editor.body.appendParagraph();
    paragraph.appendRun({ text: "italic", italic: true });
    expect(editor.toMarkdownText()).toBe("*italic*");
  });

  it("strike renders with the GFM tilde marker", () => {
    const editor = openMarkdown("");
    const paragraph = editor.body.appendParagraph();
    paragraph.appendRun({ text: "struck", strike: true });
    expect(editor.toMarkdownText()).toBe("~~struck~~");
  });

  it("default to false and can be toggled on and off independently", () => {
    const run = freshRun();
    expect(run.bold).toBe(false);
    expect(run.italic).toBe(false);
    expect(run.strike).toBe(false);
    run.bold = true;
    run.italic = true;
    expect(run.bold).toBe(true);
    expect(run.italic).toBe(true);
    run.bold = false;
    expect(run.bold).toBe(false);
    expect(run.italic).toBe(true); // unaffected by the other toggle
  });
});

describe("MarkdownRun hyperlink", () => {
  it("renders a real markdown link on toMarkdownText()", () => {
    const editor = openMarkdown("");
    const paragraph = editor.body.appendParagraph();
    paragraph.appendRun({ text: "docs", hyperlink: "https://example.com/" });
    expect(editor.toMarkdownText()).toBe("[docs](https://example.com/)");
  });

  it("reads and writes hyperlink via get/set", () => {
    const run = freshRun();
    expect(run.hyperlink).toBeUndefined();
    run.hyperlink = "https://example.com/";
    expect(run.hyperlink).toBe("https://example.com/");
    run.hyperlink = undefined;
    expect(run.hyperlink).toBeUndefined();
  });
});

describe("MarkdownRun code", () => {
  it("renders a real code span on toMarkdownText(), backed by the MONOSPACE_FONT_FAMILY convention", () => {
    const editor = openMarkdown("");
    const paragraph = editor.body.appendParagraph();
    paragraph.appendRun({ text: "const x = 1", code: true });
    expect(editor.toMarkdownText()).toBe("`const x = 1`");
  });

  it("reads and writes code via get/set", () => {
    const run = freshRun();
    expect(run.code).toBe(false);
    run.code = true;
    expect(run.code).toBe(true);
    run.code = false;
    expect(run.code).toBe(false);
  });
});

describe("MarkdownRun.remove", () => {
  it("removes the run from its paragraph and throws on any further use", () => {
    const editor = openMarkdown("");
    const paragraph = editor.body.appendParagraph();
    const run = paragraph.appendRun({ text: "Bye" });
    expect(paragraph.runs()).toHaveLength(1);
    run.remove();
    expect(paragraph.runs()).toHaveLength(0);
    expect(() => run.text).toThrow(/removed/);
    expect(() => {
      run.bold = true;
    }).toThrow(/removed/);
  });
});

describe("MarkdownRun has no underline/color/sizePt/fontFamily property", () => {
  it("is a compile-time-only guarantee -- see the @ts-expect-error lines below", () => {
    const run = freshRun();
    // @ts-expect-error underline has no markdown-codec counterpart: CommonMark/GFM has no underline syntax, and ContentRun itself carries no underline field at all.
    run.underline = true;
    // @ts-expect-error color is never read by markdown-codec's own dist/emit/inline.js (renderLeaf/emitRuns read only text/bold/italic/strike/hyperlink/fontFamily).
    run.color = { r: 1, g: 0, b: 0 };
    // @ts-expect-error sizePt is never read by markdown-codec's own dist/emit/inline.js either.
    run.sizePt = 14;
    // @ts-expect-error fontFamily has no free-form setter here -- only the boolean `code` view over MONOSPACE_FONT_FAMILY is exposed.
    run.fontFamily = "Arial";
  });
});
