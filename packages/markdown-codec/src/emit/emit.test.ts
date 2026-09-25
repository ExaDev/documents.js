// Construct-by-construct tests for the ContentDocument -> markdown emission stage (src/emit/emit.ts), the structural inverse of src/lower/lower.test.ts. Most tests here build a ContentDocument directly (bypassing src/lower entirely) so each construct — including a cross-format shape src/lower itself never produces, like a paragraph with indentLeftPt but no quotable styleId — can be exercised in isolation; a handful round-trip through src/lower/lower.ts first where that is the more natural way to obtain a real value (a code span run, a task-list item).

import type {
  ContentBlock,
  ContentDocument,
  ContentImageBlock,
} from "document-schema.js";
import { PAGE_SIZE_A4 } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { DEFAULT_MARGINS } from "../defaults/defaults";
import { MarkdownDiagnosticCodes } from "../diagnostics/diagnostics";
import { lowerMarkdown } from "../lower/lower";
import { createDiagnosticCollector } from "../test-support/diagnostics";
import { emitMarkdown } from "./emit";

function doc(blocks: readonly ContentBlock[]): ContentDocument {
  return {
    kind: "wordprocessing",
    metadata: {},
    sections: [
      { pageSize: PAGE_SIZE_A4, margins: DEFAULT_MARGINS, blocks: [...blocks] },
    ],
  };
}

describe("code blocks, thematic breaks, preformatted HTML", () => {
  it("emits a CodeBlock paragraph as a fenced code block using the configured fence character", () => {
    expect(
      emitMarkdown(
        doc([
          {
            kind: "paragraph",
            runs: [{ text: "foo\nbar" }],
            styleId: "CodeBlock",
          },
        ]),
        { codeFenceChar: "~" },
      ),
    ).toBe("~~~\nfoo\nbar\n~~~");
  });

  it("re-emits the paragraph's codeLanguage as the fence's info word", () => {
    expect(
      emitMarkdown(
        doc([
          {
            kind: "paragraph",
            runs: [{ text: "foo" }],
            styleId: "CodeBlock",
            codeLanguage: "js",
          },
        ]),
      ),
    ).toBe("``` js\nfoo\n```");
  });

  it("re-emits the quarantined info-string remainder after the language word, a single space between them", () => {
    expect(
      emitMarkdown(
        doc([
          {
            kind: "paragraph",
            runs: [{ text: "foo" }],
            styleId: "CodeBlock",
            codeLanguage: "js",
            source: { format: "markdown", xml: "{.numberLines}" },
          },
        ]),
      ),
    ).toBe("``` js {.numberLines}\nfoo\n```");
  });

  it("re-emits a residue-only info string (no language word) as the whole info line", () => {
    expect(
      emitMarkdown(
        doc([
          {
            kind: "paragraph",
            runs: [{ text: "foo" }],
            styleId: "CodeBlock",
            source: { format: "markdown", xml: "{.haskell}" },
          },
        ]),
      ),
    ).toBe("``` {.haskell}\nfoo\n```");
  });

  it("round-trips a language word through read -> emit unchanged", () => {
    const roundTrip = emitMarkdown(lowerMarkdown("``` ruby\ndef x; end\n```"));
    expect(roundTrip).toBe("``` ruby\ndef x; end\n```");
  });

  it("emits a HorizontalRule paragraph as a thematic break using the configured character", () => {
    expect(
      emitMarkdown(
        doc([{ kind: "paragraph", runs: [], styleId: "HorizontalRule" }]),
        { thematicBreakChar: "*" },
      ),
    ).toBe("***");
  });

  it("emits an HTMLPreformatted paragraph's runs verbatim, with no escaping at all", () => {
    expect(
      emitMarkdown(
        doc([
          {
            kind: "paragraph",
            runs: [{ text: "<div>*not emphasis*</div>" }],
            styleId: "HTMLPreformatted",
          },
        ]),
      ),
    ).toBe("<div>*not emphasis*</div>");
  });

  it("joins a CodeBlock paragraph's several runs into one literal with nothing between them", () => {
    expect(
      emitMarkdown(
        doc([
          {
            kind: "paragraph",
            runs: [{ text: "foo" }, { text: "bar" }],
            styleId: "CodeBlock",
          },
        ]),
      ),
    ).toBe("```\nfoobar\n```");
  });

  it("drops an EMPTY codeLanguage from the info line rather than emitting a stray separator ahead of the residue remainder", () => {
    expect(
      emitMarkdown(
        doc([
          {
            kind: "paragraph",
            runs: [{ text: "foo" }],
            styleId: "CodeBlock",
            codeLanguage: "",
            source: { format: "markdown", xml: "{.numberLines}" },
          },
        ]),
      ),
    ).toBe("``` {.numberLines}\nfoo\n```");
  });

  it("joins an HTMLPreformatted paragraph's several runs into one literal with nothing between them", () => {
    expect(
      emitMarkdown(
        doc([
          {
            kind: "paragraph",
            runs: [{ text: "<div>" }, { text: "</div>" }],
            styleId: "HTMLPreformatted",
          },
        ]),
      ),
    ).toBe("<div></div>");
  });
});

describe("math (ExaDev/markdown-codec#53)", () => {
  it("emits a MathBlock paragraph as a $$ display math block", () => {
    expect(
      emitMarkdown(
        doc([
          { kind: "paragraph", runs: [{ text: "x^2" }], styleId: "MathBlock" },
        ]),
      ),
    ).toBe("$$\nx^2\n$$");
  });

  it("emits an embedded formula object carrying presentation LaTeX as a $$ display math block", () => {
    expect(
      emitMarkdown(
        doc([
          {
            kind: "embeddedObject",
            objectKind: "formula",
            document: {
              kind: "formula",
              metadata: {},
              formula: { mathml: [], presentation: { latex: "x^2" } },
            },
            frame: { xPt: 0, yPt: 0, widthPt: 0, heightPt: 0 },
          },
        ]),
      ),
    ).toBe("$$\nx^2\n$$");
  });

  it("emits an empty-presentation formula as an empty $$ block", () => {
    expect(
      emitMarkdown(
        doc([
          {
            kind: "embeddedObject",
            objectKind: "formula",
            document: {
              kind: "formula",
              metadata: {},
              formula: { mathml: [], presentation: { latex: "" } },
            },
            frame: { xPt: 0, yPt: 0, widthPt: 0, heightPt: 0 },
          },
        ]),
      ),
    ).toBe("$$\n$$");
  });

  it("does not render the $$ math shortcut when objectKind disagrees with the document's own kind, even though the document itself is a formula carrying real presentation LaTeX — both fields must agree, not just the document's own kind", () => {
    expect(
      emitMarkdown(
        doc([
          {
            kind: "embeddedObject",
            objectKind: "wordprocessing",
            document: {
              kind: "formula",
              metadata: {},
              formula: { mathml: [], presentation: { latex: "x^2" } },
            },
            frame: { xPt: 0, yPt: 0, widthPt: 1, heightPt: 1 },
          },
        ]),
      ),
    ).toBe("");
  });

  it("still silently drops an embedded object of any other kind, and a formula with no presentation LaTeX, which have no markdown spelling", () => {
    expect(
      emitMarkdown(
        doc([
          {
            kind: "embeddedObject",
            objectKind: "wordprocessing",
            document: { kind: "wordprocessing", metadata: {}, sections: [] },
            frame: { xPt: 0, yPt: 0, widthPt: 1, heightPt: 1 },
          },
          {
            kind: "embeddedObject",
            objectKind: "formula",
            document: {
              kind: "formula",
              metadata: {},
              formula: { mathml: [] },
            },
            frame: { xPt: 0, yPt: 0, widthPt: 0, heightPt: 0 },
          },
        ]),
      ),
    ).toBe("");
  });

  it("round-trips a $$ block byte for byte through lower -> emit -> lower", () => {
    const source = "$$\nx^2\n$$";
    const first = lowerMarkdown(source);
    expect(emitMarkdown(first)).toBe(source);
    expect(lowerMarkdown(emitMarkdown(first))).toEqual(first);
  });

  it("emits a Cambria-Math-marked run with \\( \\) delimiters, unescaped", () => {
    expect(
      emitMarkdown(
        doc([
          {
            kind: "paragraph",
            runs: [{ text: "f(x) = x^2", fontFamily: "Cambria Math" }],
          },
        ]),
      ),
    ).toBe("\\(f(x) = x^2\\)");
  });

  it("joins a MathBlock paragraph's several runs into one literal with nothing between them", () => {
    expect(
      emitMarkdown(
        doc([
          {
            kind: "paragraph",
            runs: [{ text: "x^" }, { text: "2" }],
            styleId: "MathBlock",
          },
        ]),
      ),
    ).toBe("$$\nx^2\n$$");
  });
});

describe("blockquotes", () => {
  it('prefixes "> " once per recovered nesting level, on every line of the body', () => {
    const fenced = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "a\nb" }],
          styleId: "CodeBlock",
          indentLeftPt: 72,
        },
      ]),
    );
    expect(fenced).toBe("> > ```\n> > a\n> > b\n> > ```");
  });

  it("keeps a Heading{N} styleId while quoted, applying indent on top", () => {
    expect(
      emitMarkdown(
        doc([
          {
            kind: "paragraph",
            runs: [{ text: "foo" }],
            styleId: "Heading2",
            indentLeftPt: 36,
          },
        ]),
      ),
    ).toBe("> ## foo");
  });

  it('renders a division construct pair as a blockquote wrapper, prefixing "> " on every line and ">" alone on blank lines — without double-prefixing from the blocks\' own indentLeftPt', () => {
    const markdown = emitMarkdown(
      doc([
        { kind: "constructStart", descriptor: { kind: "division" } },
        {
          kind: "paragraph",
          runs: [{ text: "a" }],
          styleId: "Quote",
          indentLeftPt: 36,
        },
        {
          kind: "paragraph",
          runs: [{ text: "b" }],
          styleId: "Quote",
          indentLeftPt: 36,
        },
        { kind: "constructEnd" },
      ]),
    );
    expect(markdown).toBe("> a\n>\n> b");
  });

  it('renders nested division pairs one "> " per level', () => {
    const markdown = emitMarkdown(
      doc([
        { kind: "constructStart", descriptor: { kind: "division" } },
        { kind: "constructStart", descriptor: { kind: "division" } },
        {
          kind: "paragraph",
          runs: [{ text: "deep" }],
          styleId: "Quote",
          indentLeftPt: 72,
        },
        { kind: "constructEnd" },
        { kind: "constructEnd" },
      ]),
    );
    expect(markdown).toBe("> > deep");
  });

  it("renders two adjacent division pairs as two independent quotes separated by a blank line", () => {
    const markdown = emitMarkdown(
      doc([
        { kind: "constructStart", descriptor: { kind: "division" } },
        {
          kind: "paragraph",
          runs: [{ text: "a" }],
          styleId: "Quote",
          indentLeftPt: 36,
        },
        { kind: "constructEnd" },
        { kind: "constructStart", descriptor: { kind: "division" } },
        {
          kind: "paragraph",
          runs: [{ text: "b" }],
          styleId: "Quote",
          indentLeftPt: 36,
        },
        { kind: "constructEnd" },
      ]),
    );
    expect(markdown).toBe("> a\n\n> b");
  });

  it("renders a foreign division whose blocks carry no quote indent transparently, reporting CONSTRUCT_UNREPRESENTED — a named section from another format is not a markdown blockquote", () => {
    const collector = createDiagnosticCollector();
    const markdown = emitMarkdown(
      doc([
        {
          kind: "constructStart",
          descriptor: { kind: "division", name: "chapter-one" },
        },
        { kind: "paragraph", runs: [{ text: "body" }] },
        { kind: "constructEnd" },
      ]),
      { sink: collector.sink },
    );
    expect(markdown).toBe("body");
    expect(collector.has(MarkdownDiagnosticCodes.CONSTRUCT_UNREPRESENTED)).toBe(
      true,
    );
    const diagnostic = collector.diagnostics.find(
      (d) => d.code === MarkdownDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
    );
    expect(diagnostic?.message).toContain("division");
    expect(diagnostic?.message).toContain("no markdown syntax");
  });

  it("renders a division transparently (no '> ' wrapping) when only SOME of its wrapped paragraphs carry the dual-carry quote indent, not all of them — isMaterialisedDivision requires EVERY child to qualify, not just one", () => {
    const markdown = emitMarkdown(
      doc([
        {
          kind: "constructStart",
          descriptor: { kind: "division", name: "mixed" },
        },
        {
          kind: "paragraph",
          runs: [{ text: "quoted" }],
          styleId: "Quote",
          indentLeftPt: 36,
        },
        { kind: "paragraph", runs: [{ text: "plain" }] },
        { kind: "constructEnd" },
      ]),
    );
    // Transparent, not materialised — so each wrapped paragraph still recovers (or doesn't) its own quote depth independently, exactly as if the division weren't there at all: "quoted" keeps its own '> ' from indentLeftPt, "plain" has none.
    expect(markdown).toBe("> quoted\n\nplain");
  });

  it("round-trips blockquote shapes byte for byte through lower -> emit -> lower, including nesting and adjacency", () => {
    for (const source of [
      "> a\n>\n> b",
      "> > deep",
      "> a\n\n> b",
      "> first para\n>\n> second para",
    ]) {
      const first = lowerMarkdown(source);
      expect(emitMarkdown(first)).toBe(source);
      expect(lowerMarkdown(emitMarkdown(first))).toEqual(first);
    }
  });
});

describe("images", () => {
  it("embeds the image bytes as a data: URI by default, and omits them when images: false", () => {
    const image: ContentImageBlock = {
      kind: "image",
      format: "png",
      base64: "AA==",
      widthPt: 1,
      heightPt: 1,
      altText: "alt",
    };
    expect(emitMarkdown(doc([image]))).toBe(
      "![alt](data:image/png;base64,AA==)",
    );
    expect(emitMarkdown(doc([image]), { images: false })).toBe("![alt]()");
  });

  it("emits an empty alt attribute for an image block with no altText at all", () => {
    const image: ContentImageBlock = {
      kind: "image",
      format: "png",
      base64: "AA==",
      widthPt: 1,
      heightPt: 1,
    };
    expect(emitMarkdown(doc([image]))).toBe("![](data:image/png;base64,AA==)");
  });
});
