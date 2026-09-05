// Construct-by-construct tests for the ContentDocument -> markdown emission stage (src/emit/emit.ts), the structural inverse of src/lower/lower.test.ts. Most tests here build a ContentDocument directly (bypassing src/lower entirely) so each construct -- including a cross-format shape src/lower itself never produces, like a paragraph with indentLeftPt but no quotable styleId -- can be exercised in isolation; a handful round-trip through src/lower/lower.ts first where that is the more natural way to obtain a real value (a code span run, a task-list item).

import type {
  ContentBlock,
  ContentDocument,
  ContentImageBlock,
  ContentTable,
} from "document-schema.js";
import { PAGE_SIZE_A4 } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { DEFAULT_MARGINS } from "../defaults/defaults";
import {
  MarkdownDiagnosticCodes,
  MarkdownInvalidRunConstructExtentError,
} from "../diagnostics/diagnostics";
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

describe("headings", () => {
  it("emits a Heading{N} styleId as ATX by default", () => {
    expect(
      emitMarkdown(
        doc([
          { kind: "paragraph", runs: [{ text: "foo" }], styleId: "Heading3" },
        ]),
      ),
    ).toBe("### foo");
  });

  it('emits level 1/2 as setext when headingStyle: "setext" is requested, and falls back to ATX beyond level 2', () => {
    expect(
      emitMarkdown(
        doc([
          { kind: "paragraph", runs: [{ text: "foo" }], styleId: "Heading1" },
        ]),
        { headingStyle: "setext" },
      ),
    ).toBe("foo\n===");
    expect(
      emitMarkdown(
        doc([
          { kind: "paragraph", runs: [{ text: "foo" }], styleId: "Heading3" },
        ]),
        { headingStyle: "setext" },
      ),
    ).toBe("### foo");
  });
});

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

  it('renders a division construct pair as a blockquote wrapper, prefixing "> " on every line and ">" alone on blank lines -- without double-prefixing from the blocks\' own indentLeftPt', () => {
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

  it("renders a foreign division whose blocks carry no quote indent transparently, reporting CONSTRUCT_UNREPRESENTED -- a named section from another format is not a markdown blockquote", () => {
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

describe("lists", () => {
  it("renders a bullet, an ordered (custom start), and a task list from their own numId encodings", () => {
    const bullet = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "a" }],
          list: { numId: "md1:bullet", level: 0 },
        },
      ]),
    );
    expect(bullet).toBe("- a");

    const ordered = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "a" }],
          list: { numId: "md2:ordered@3", level: 0 },
        },
        {
          kind: "paragraph",
          runs: [{ text: "b" }],
          list: { numId: "md2:ordered@3", level: 0 },
        },
      ]),
    );
    expect(ordered).toBe("3. a\n4. b");

    const task = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "☒ " }, { text: "done" }],
          list: { numId: "md3:bullet+task", level: 0 },
        },
        {
          kind: "paragraph",
          runs: [{ text: "☐ " }, { text: "todo" }],
          list: { numId: "md3:bullet+task", level: 0 },
        },
      ]),
    );
    expect(task).toBe("- [x] done\n- [ ] todo");
  });

  it("renders a nested list indented under its own parent item", () => {
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "a" }],
          list: { numId: "md1:bullet", level: 0 },
        },
        {
          kind: "paragraph",
          runs: [{ text: "b" }],
          list: { numId: "md1:bullet", level: 1 },
        },
      ]),
    );
    expect(markdown).toBe("- a\n  - b");
  });

  it("renders membership.checked as the [x]/[ ] checkbox directly, no glyph run involved", () => {
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "done" }],
          list: {
            numId: "md1:bullet+task",
            level: 0,
            checked: true,
            itemId: "md-i1",
          },
        },
        {
          kind: "paragraph",
          runs: [{ text: "todo" }],
          list: {
            numId: "md1:bullet+task",
            level: 0,
            checked: false,
            itemId: "md-i2",
          },
        },
      ]),
    );
    expect(markdown).toBe("- [x] done\n- [ ] todo");
  });

  it("still recognises the pre-field checkbox-glyph spelling when membership.checked is absent", () => {
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "☒ " }, { text: "done" }],
          list: { numId: "md1:bullet+task", level: 0 },
        },
      ]),
    );
    expect(markdown).toBe("- [x] done");
  });

  it("renders every block of one itemId as a single item -- a blank line and the continuation indent between blocks, one marker only", () => {
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "a" }],
          list: { numId: "md1:bullet+loose", level: 0, itemId: "md-i1" },
        },
        {
          kind: "paragraph",
          runs: [{ text: "second block" }],
          list: { numId: "md1:bullet+loose", level: 0, itemId: "md-i1" },
        },
      ]),
    );
    expect(markdown).toBe("- a\n\n  second block");
  });

  it("renders same-level paragraphs with DIFFERENT itemIds as separate items even when they share a numId", () => {
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "a" }],
          list: { numId: "md1:bullet", level: 0, itemId: "md-i1" },
        },
        {
          kind: "paragraph",
          runs: [{ text: "b" }],
          list: { numId: "md1:bullet", level: 0, itemId: "md-i2" },
        },
      ]),
    );
    expect(markdown).toBe("- a\n- b");
  });

  it("keeps one item per paragraph for memberships with no itemId at all -- the cross-format shape every foreign producer sends", () => {
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "a" }],
          list: { numId: "md1:bullet", level: 0 },
        },
        {
          kind: "paragraph",
          runs: [{ text: "b" }],
          list: { numId: "md1:bullet", level: 0 },
        },
      ]),
    );
    expect(markdown).toBe("- a\n- b");
  });

  it("round-trips a task list byte for byte, and a multi-block item semantically with a stable re-emission", () => {
    const task = "- [x] done\n- [ ] todo";
    expect(emitMarkdown(lowerMarkdown(task))).toBe(task);
    expect(lowerMarkdown(emitMarkdown(lowerMarkdown(task)))).toEqual(
      lowerMarkdown(task),
    );

    // A loose multi-block item re-emits with the loose sibling spacing the numId itself records, so the text is not byte-identical to a source whose author ran the sibling tight -- but the reparse reproduces the identical document and a second pass is a fixed point.
    const multi = lowerMarkdown("- a\n\n  continuation of a\n- b");
    const written = emitMarkdown(multi);
    expect(lowerMarkdown(written)).toEqual(multi);
    expect(emitMarkdown(lowerMarkdown(written))).toBe(written);
  });

  it("round-trips a TIGHT list item containing a paragraph and a fenced code block as ONE item, not two", () => {
    const source = "- a\n  ```\n  code\n  ```\n- b";
    const first = lowerMarkdown(source);
    if (first.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const blocks = first.sections[0]?.blocks ?? [];
    const [paragraphA, codeBlock, paragraphB] = blocks;
    if (
      paragraphA?.kind !== "paragraph" ||
      codeBlock?.kind !== "paragraph" ||
      paragraphB?.kind !== "paragraph"
    ) {
      throw new Error("expected three paragraph blocks");
    }
    // "a" and the fenced code block are ONE item -- same itemId -- while "b" is a genuinely separate sibling item, never sharing it.
    expect(paragraphA.list?.itemId).toBeDefined();
    expect(codeBlock.list?.itemId).toBe(paragraphA.list?.itemId);
    expect(paragraphB.list?.itemId).not.toBe(paragraphA.list?.itemId);

    const written = emitMarkdown(first);
    expect(written).toBe(source);
    expect(lowerMarkdown(written)).toEqual(first);
  });

  it("keeps a construct (blockquote) directly inside a multi-block list item nested inside that item's own contiguous run on write, rather than fracturing it out as separate top-level content -- ExaDev/documents.js#990", () => {
    const source = doc([
      {
        kind: "paragraph",
        runs: [{ text: "before" }],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
      { kind: "constructStart", descriptor: { kind: "division" } },
      {
        kind: "paragraph",
        runs: [{ text: "quoted" }],
        styleId: "Quote",
        indentLeftPt: 36,
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
      { kind: "constructEnd" },
      {
        kind: "paragraph",
        runs: [{ text: "after" }],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
    ]);
    const written = emitMarkdown(source);
    expect(written).toBe("- before\n  > quoted\n\n  after");

    const reparsed = lowerMarkdown(written);
    if (reparsed.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const blocks = reparsed.sections[0]?.blocks ?? [];
    // The item stays ONE item across the reparse: "before", the quoted division pair, and "after" all still share a single itemId, none of them split out as separate top-level content the way this issue's own root cause used to fracture them.
    const paragraphs = blocks.filter((block) => block.kind === "paragraph");
    expect(paragraphs).toHaveLength(3);
    const itemIds = new Set(
      paragraphs.map((paragraph) => paragraph.list?.itemId),
    );
    expect(itemIds.size).toBe(1);
    expect(itemIds.has(undefined)).toBe(false);
  });

  it("keeps a blockquote directly inside a multi-block list item nested inside that item even when the quote wraps only a NESTED LIST of its own, rather than fracturing the item around it -- ExaDev/documents.js#990", () => {
    const source = "- before\n\n  > - a\n  > - b\n\n  after\n";
    const written = emitMarkdown(lowerMarkdown(source));
    expect(written).toBe("- before\n\n  > - a\n  > - b\n\n  after");

    const reparsed = lowerMarkdown(written);
    if (reparsed.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const blocks = reparsed.sections[0]?.blocks ?? [];
    const paragraphs = blocks.filter((block) => block.kind === "paragraph");
    // Four paragraphs total: "before"/"after" (the outer item) plus "a"/"b" (the quote's own nested list) -- none of them dropped or fused together.
    expect(paragraphs).toHaveLength(4);
    const [before, a, b, after] = paragraphs;
    // "before" and "after" still share ONE outer itemId across the construct, exactly like the plain-paragraph-in-quote case above -- the construct did not fracture the item.
    expect(before?.list?.itemId).toBeDefined();
    expect(after?.list?.itemId).toBe(before?.list?.itemId);
    // "a" and "b" are a GENUINELY separate, freshly-minted nested list -- their own itemIds differ from each other and from the outer item's, and their own numId differs from the outer item's numId, proving this is real nesting (a bullet list inside the blockquote) rather than the quote's content being folded into the outer item's own run.
    expect(a?.list?.itemId).toBeDefined();
    expect(b?.list?.itemId).toBeDefined();
    expect(a?.list?.itemId).not.toBe(before?.list?.itemId);
    expect(b?.list?.itemId).not.toBe(a?.list?.itemId);
    expect(a?.list?.numId).not.toBe(before?.list?.numId);
  });

  it("still renders a blockquote wrapping its own list as separate top-level content when it genuinely sits BETWEEN two unrelated lists, not inside either one's item -- the construct's surrounding itemId differs on both sides, so it must not be absorbed the way the in-item case above is", () => {
    const source = "- a\n- b\n\n> quote\n\n- c\n- d\n";
    const written = emitMarkdown(lowerMarkdown(source));
    expect(written).toBe("- a\n- b\n\n> quote\n\n- c\n- d");
  });

  it("keeps a Quote-styled block and a following plain block of the same item as two separate blocks on write-then-reparse -- Quote is NOT self-delimiting inside a list region: renderListRegion renders every block through renderParagraphBody, which never applies a '> ' prefix, so a Quote-styled block reads back identically to a plain one and the two would otherwise merge into one paragraph via CommonMark's lazy continuation", () => {
    const source = doc([
      {
        kind: "paragraph",
        styleId: "Quote",
        runs: [{ text: "quoted" }],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
      {
        kind: "paragraph",
        runs: [{ text: "after" }],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
    ]);
    const written = emitMarkdown(source);
    expect(written).toBe("- quoted\n\n  after");

    const reparsed = lowerMarkdown(written);
    if (reparsed.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const blocks = reparsed.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(2);
    const [quotedBlock, afterBlock] = blocks;
    if (quotedBlock?.kind !== "paragraph" || afterBlock?.kind !== "paragraph") {
      throw new Error("expected two paragraph blocks");
    }
    expect(quotedBlock.runs.map((run) => run.text).join("")).toBe("quoted");
    expect(afterBlock.runs.map((run) => run.text).join("")).toBe("after");
  });

  it("inserts a blank line between a paragraph and a following thematic break rendered with the default '-' character, since a '---' line right after an open paragraph reads back as a setext level-2 underline rather than a fresh thematic break", () => {
    const source = doc([
      {
        kind: "paragraph",
        runs: [{ text: "a" }],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
      {
        kind: "paragraph",
        styleId: "HorizontalRule",
        runs: [],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
    ]);
    const written = emitMarkdown(source);
    expect(written).toBe("- a\n\n  ---");

    const reparsed = lowerMarkdown(written);
    if (reparsed.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const blocks = reparsed.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(2);
    const [paragraphBlock, ruleBlock] = blocks;
    if (
      paragraphBlock?.kind !== "paragraph" ||
      ruleBlock?.kind !== "paragraph"
    ) {
      throw new Error("expected two paragraph blocks");
    }
    expect(paragraphBlock.styleId).toBeUndefined();
    expect(ruleBlock.styleId).toBe("HorizontalRule");
  });

  it("keeps a paragraph and a following thematic break TIGHT when rendered with a non-default character ('*'), which cannot be misread as a setext underline", () => {
    const source = doc([
      {
        kind: "paragraph",
        runs: [{ text: "a" }],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
      {
        kind: "paragraph",
        styleId: "HorizontalRule",
        runs: [],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
    ]);
    const written = emitMarkdown(source, { thematicBreakChar: "*" });
    expect(written).toBe("- a\n  ***");

    const reparsed = lowerMarkdown(written);
    if (reparsed.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const blocks = reparsed.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(2);
    const [paragraphBlock, ruleBlock] = blocks;
    if (
      paragraphBlock?.kind !== "paragraph" ||
      ruleBlock?.kind !== "paragraph"
    ) {
      throw new Error("expected two paragraph blocks");
    }
    expect(paragraphBlock.styleId).toBeUndefined();
    expect(ruleBlock.styleId).toBe("HorizontalRule");
  });

  it("inserts a blank line between a paragraph and a following heading rendered as setext, since the heading's own text line would otherwise read as more of the preceding paragraph, with the underline retroactively converting both into one heading", () => {
    const source = doc([
      {
        kind: "paragraph",
        runs: [{ text: "a" }],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
      {
        kind: "paragraph",
        styleId: "Heading1",
        runs: [{ text: "h" }],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
    ]);
    const written = emitMarkdown(source, { headingStyle: "setext" });
    expect(written).toBe("- a\n\n  h\n  =");

    const reparsed = lowerMarkdown(written);
    if (reparsed.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const blocks = reparsed.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(2);
    const [paragraphBlock, headingBlock] = blocks;
    if (
      paragraphBlock?.kind !== "paragraph" ||
      headingBlock?.kind !== "paragraph"
    ) {
      throw new Error("expected two paragraph blocks");
    }
    expect(paragraphBlock.runs.map((run) => run.text).join("")).toBe("a");
    expect(headingBlock.styleId).toBe("Heading1");
    expect(headingBlock.runs.map((run) => run.text).join("")).toBe("h");
  });

  it("inserts a blank line before a plain block following an HTMLPreformatted block, since a raw HTML block only ends at a blank line and would otherwise swallow the next block as more of its own literal content", () => {
    const source = doc([
      {
        kind: "paragraph",
        styleId: "HTMLPreformatted",
        runs: [{ text: "<div>x</div>" }],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
      {
        kind: "paragraph",
        runs: [{ text: "after" }],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
    ]);
    const written = emitMarkdown(source);
    expect(written).toBe("- <div>x</div>\n\n  after");

    const reparsed = lowerMarkdown(written);
    if (reparsed.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const blocks = reparsed.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(2);
    const [htmlBlock, afterBlock] = blocks;
    if (htmlBlock?.kind !== "paragraph" || afterBlock?.kind !== "paragraph") {
      throw new Error("expected two paragraph blocks");
    }
    expect(htmlBlock.styleId).toBe("HTMLPreformatted");
    expect(afterBlock.runs.map((run) => run.text).join("")).toBe("after");
  });

  it("inserts a blank line before an HTMLPreformatted block following a plain paragraph, since a lone start/end tag on its own line (CommonMark HTML-block condition 7) cannot interrupt an open paragraph", () => {
    const source = doc([
      {
        kind: "paragraph",
        runs: [{ text: "a" }],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
      {
        kind: "paragraph",
        styleId: "HTMLPreformatted",
        runs: [{ text: "<span>x</span>" }],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
    ]);
    const written = emitMarkdown(source);
    expect(written).toBe("- a\n\n  <span>x</span>");

    const reparsed = lowerMarkdown(written);
    if (reparsed.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const blocks = reparsed.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(2);
    const [paragraphBlock, spanBlock] = blocks;
    if (
      paragraphBlock?.kind !== "paragraph" ||
      spanBlock?.kind !== "paragraph"
    ) {
      throw new Error("expected two paragraph blocks");
    }
    expect(paragraphBlock.runs.map((run) => run.text).join("")).toBe("a");
    expect(spanBlock.runs.map((run) => run.text).join("")).toBe(
      "<span>x</span>",
    );
  });

  it("inserts a blank line before a CodeBlock following an HTMLPreformatted block, even though a fenced code block always interrupts an open PARAGRAPH -- an open HTML block (CommonMark start conditions 6/7) is a different construct that ends only at a blank line, so canInterruptOpenParagraph's answer for the NEXT block is not a valid signal here at all", () => {
    const source = doc([
      {
        kind: "paragraph",
        styleId: "HTMLPreformatted",
        runs: [{ text: "<div>x</div>" }],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
      {
        kind: "paragraph",
        styleId: "CodeBlock",
        runs: [{ text: "code" }],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
    ]);
    const written = emitMarkdown(source);
    expect(written).toBe("- <div>x</div>\n\n  ```\n  code\n  ```");

    const reparsed = lowerMarkdown(written);
    if (reparsed.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const blocks = reparsed.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(2);
    const [htmlBlock, codeBlock] = blocks;
    if (htmlBlock?.kind !== "paragraph" || codeBlock?.kind !== "paragraph") {
      throw new Error("expected two paragraph blocks");
    }
    expect(htmlBlock.styleId).toBe("HTMLPreformatted");
    expect(htmlBlock.runs.map((run) => run.text).join("")).toBe("<div>x</div>");
    expect(codeBlock.styleId).toBe("CodeBlock");
    expect(codeBlock.runs.map((run) => run.text).join("")).toBe("code");
  });

  it("inserts a blank line before an ATX heading following an HTMLPreformatted block, for the same reason as the CodeBlock case above: an ATX heading interrupts a PARAGRAPH unconditionally, but that says nothing about an open HTML block, which absorbs the heading's own line as more literal content without one", () => {
    const source = doc([
      {
        kind: "paragraph",
        styleId: "HTMLPreformatted",
        runs: [{ text: "<div>x</div>" }],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
      {
        kind: "paragraph",
        styleId: "Heading1",
        runs: [{ text: "h" }],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
    ]);
    const written = emitMarkdown(source);
    expect(written).toBe("- <div>x</div>\n\n  # h");

    const reparsed = lowerMarkdown(written);
    if (reparsed.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const blocks = reparsed.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(2);
    const [htmlBlock, headingBlock] = blocks;
    if (htmlBlock?.kind !== "paragraph" || headingBlock?.kind !== "paragraph") {
      throw new Error("expected two paragraph blocks");
    }
    expect(htmlBlock.styleId).toBe("HTMLPreformatted");
    expect(headingBlock.styleId).toBe("Heading1");
    expect(headingBlock.runs.map((run) => run.text).join("")).toBe("h");
  });

  it("inserts a blank line before a MathBlock following an HTMLPreformatted block, for the same reason as the CodeBlock case above: a $$ line interrupts a PARAGRAPH exactly as a code fence does, but an open HTML block is not a paragraph and absorbs it without one", () => {
    const source = doc([
      {
        kind: "paragraph",
        styleId: "HTMLPreformatted",
        runs: [{ text: "<div>x</div>" }],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
      {
        kind: "paragraph",
        styleId: "MathBlock",
        runs: [{ text: "x^2" }],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
    ]);
    const written = emitMarkdown(source);
    expect(written).toBe("- <div>x</div>\n\n  $$\n  x^2\n  $$");

    const reparsed = lowerMarkdown(written);
    if (reparsed.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const blocks = reparsed.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(2);
    const [htmlBlock, mathBlock] = blocks;
    if (htmlBlock?.kind !== "paragraph") {
      throw new Error("expected the first block to be a paragraph");
    }
    expect(htmlBlock.styleId).toBe("HTMLPreformatted");
    expect(mathBlock?.kind).toBe("embeddedObject");
  });

  it("inserts a blank line before a thematic break rendered with a non-default character ('*') following an HTMLPreformatted block -- '*' is never a setext underline, so canInterruptOpenParagraph accepts it, but an open HTML block absorbs any non-blank line regardless of what that line looks like", () => {
    const source = doc([
      {
        kind: "paragraph",
        styleId: "HTMLPreformatted",
        runs: [{ text: "<div>x</div>" }],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
      {
        kind: "paragraph",
        styleId: "HorizontalRule",
        runs: [],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
    ]);
    const written = emitMarkdown(source, { thematicBreakChar: "*" });
    expect(written).toBe("- <div>x</div>\n\n  ***");

    const reparsed = lowerMarkdown(written);
    if (reparsed.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const blocks = reparsed.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(2);
    const [htmlBlock, ruleBlock] = blocks;
    if (htmlBlock?.kind !== "paragraph" || ruleBlock?.kind !== "paragraph") {
      throw new Error("expected two paragraph blocks");
    }
    expect(htmlBlock.styleId).toBe("HTMLPreformatted");
    expect(ruleBlock.styleId).toBe("HorizontalRule");
  });

  it("inserts a blank line resuming an outer item's own blocks after a nested sub-list whose own last block is a plain (open) paragraph, since a line at the outer continuation indent would otherwise be read as the NESTED item's own lazy continuation rather than the outer item resuming (CommonMark spec 0.31.2 example 325's own shape)", () => {
    const source = doc([
      {
        kind: "paragraph",
        runs: [{ text: "foo" }],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
      {
        kind: "paragraph",
        runs: [{ text: "bar" }],
        list: { numId: "md1:bullet", level: 1, itemId: "i2" },
      },
      {
        kind: "paragraph",
        runs: [{ text: "baz" }],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
    ]);
    const written = emitMarkdown(source);
    expect(written).toBe("- foo\n  - bar\n\n  baz");

    const reparsed = lowerMarkdown(written);
    if (reparsed.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const blocks = reparsed.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(3);
    const [fooBlock, barBlock, bazBlock] = blocks;
    if (
      fooBlock?.kind !== "paragraph" ||
      barBlock?.kind !== "paragraph" ||
      bazBlock?.kind !== "paragraph"
    ) {
      throw new Error("expected three paragraph blocks");
    }
    expect(fooBlock.runs.map((run) => run.text).join("")).toBe("foo");
    expect(barBlock.runs.map((run) => run.text).join("")).toBe("bar");
    expect(bazBlock.runs.map((run) => run.text).join("")).toBe("baz");
    // "foo" and "baz" are the SAME outer item -- "baz" resumed the outer item rather than being lazily absorbed into "bar"'s own nested paragraph.
    expect(barBlock.list?.level).toBe(1);
    expect(bazBlock.list?.level).toBe(0);
    expect(bazBlock.list?.itemId).toBe(fooBlock.list?.itemId);
    expect(barBlock.list?.itemId).not.toBe(fooBlock.list?.itemId);
  });

  it("keeps a paragraph and a following ATX heading (the default heading style) TIGHT -- an ATX heading always interrupts an open paragraph, in or out of a list", () => {
    const source = doc([
      {
        kind: "paragraph",
        runs: [{ text: "a" }],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
      {
        kind: "paragraph",
        styleId: "Heading1",
        runs: [{ text: "h" }],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
    ]);
    const written = emitMarkdown(source);
    expect(written).toBe("- a\n  # h");

    const reparsed = lowerMarkdown(written);
    if (reparsed.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const blocks = reparsed.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(2);
    const [paragraphBlock, headingBlock] = blocks;
    if (
      paragraphBlock?.kind !== "paragraph" ||
      headingBlock?.kind !== "paragraph"
    ) {
      throw new Error("expected two paragraph blocks");
    }
    expect(paragraphBlock.runs.map((run) => run.text).join("")).toBe("a");
    expect(headingBlock.styleId).toBe("Heading1");
  });

  it("keeps a paragraph and a following MathBlock TIGHT -- a $$ line interrupts an open paragraph exactly as a code fence does, in or out of a list", () => {
    const source = doc([
      {
        kind: "paragraph",
        runs: [{ text: "a" }],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
      {
        kind: "paragraph",
        styleId: "MathBlock",
        runs: [{ text: "x^2" }],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
    ]);
    const written = emitMarkdown(source);
    expect(written).toBe("- a\n  $$\n  x^2\n  $$");

    const reparsed = lowerMarkdown(written);
    if (reparsed.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const blocks = reparsed.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(2);
    const [paragraphBlock, mathBlock] = blocks;
    if (paragraphBlock?.kind !== "paragraph") {
      throw new Error("expected the first block to be a paragraph");
    }
    expect(paragraphBlock.runs.map((run) => run.text).join("")).toBe("a");
    expect(mathBlock?.kind).toBe("embeddedObject");
  });

  it("separates loose-list siblings with a blank line and tight-list siblings with none", () => {
    const tight = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "a" }],
          list: { numId: "md1:bullet", level: 0 },
        },
        {
          kind: "paragraph",
          runs: [{ text: "b" }],
          list: { numId: "md1:bullet", level: 0 },
        },
      ]),
    );
    expect(tight).toBe("- a\n- b");

    const loose = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "a" }],
          list: { numId: "md1:bullet+loose", level: 0 },
        },
        {
          kind: "paragraph",
          runs: [{ text: "b" }],
          list: { numId: "md1:bullet+loose", level: 0 },
        },
      ]),
    );
    expect(loose).toBe("- a\n\n- b");
  });
});

describe("tables", () => {
  it("emits alignment markers read from the header row's own cell alignment", () => {
    const table: ContentTable = {
      kind: "table",
      columnWidthsPt: [100, 100],
      rows: [
        {
          cells: [
            {
              blocks: [
                { kind: "paragraph", runs: [{ text: "a" }], alignment: "left" },
              ],
            },
            {
              blocks: [
                {
                  kind: "paragraph",
                  runs: [{ text: "b" }],
                  alignment: "right",
                },
              ],
            },
          ],
        },
        {
          cells: [
            { blocks: [{ kind: "paragraph", runs: [{ text: "1" }] }] },
            { blocks: [{ kind: "paragraph", runs: [{ text: "2" }] }] },
          ],
        },
      ],
    };
    expect(emitMarkdown(doc([table]))).toBe(
      "| a | b |\n| :--- | ---: |\n| 1 | 2 |",
    );
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
});

describe("round trip through src/lower", () => {
  it("renders a code span run back as backticks and a plain autolink run back as <dest>", () => {
    const source = "`code` and <http://example.com>";
    const lowered = lowerMarkdown(source);
    expect(emitMarkdown(lowered)).toBe("`code` and <http://example.com>");
  });

  it("preserves inline raw HTML as literal HTML, not escaped text, across a full lower -> emit -> lower round trip", () => {
    const source = "before <em>raw</em> after";
    const first = lowerMarkdown(source);
    const markdown = emitMarkdown(first);
    expect(markdown).toBe(source);
    const second = lowerMarkdown(markdown);
    expect(second).toEqual(first);
  });

  it("re-emits a run's quarantined markdown HTML residue verbatim, so a tag the pattern matcher would miss still comes back as HTML", () => {
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [
            { text: "x", source: { format: "markdown", xml: "<em>raw</em>" } },
          ],
        },
      ]),
    );
    expect(markdown).toBe("<em>raw</em>");
  });

  it('escapes a literal "<" in ordinary text with no HTML residue, so tag-shaped literal text never re-reads as HTML', () => {
    const markdown = emitMarkdown(
      doc([{ kind: "paragraph", runs: [{ text: "a <div> b" }] }]),
    );
    expect(markdown).toBe("a \\<div\\> b");
    // And the escaped spelling round-trips back to the same literal-text document.
    expect(lowerMarkdown("a \\<div\\> b")).toEqual(lowerMarkdown(markdown));
  });

  it("re-emits an HTMLPreformatted paragraph's quarantined residue verbatim in place of the run text", () => {
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "trimmed" }],
          styleId: "HTMLPreformatted",
          source: { format: "markdown", xml: "<div>\nfoo\n</div>" },
        },
      ]),
    );
    expect(markdown).toBe("<div>\nfoo\n</div>");
  });

  it("preserves inline math (\\( \\)), delimiters included, across a full lower -> emit -> lower round trip (ExaDev/markdown-codec#53)", () => {
    const source = "before \\(E = mc^2\\) after";
    const first = lowerMarkdown(source);
    const markdown = emitMarkdown(first);
    expect(markdown).toBe(source);
    const second = lowerMarkdown(markdown);
    expect(second).toEqual(first);
  });

  it("preserves a $$ display math block across a full lower -> emit -> lower round trip", () => {
    const source = "$$\nx^2\n$$";
    const first = lowerMarkdown(source);
    const markdown = emitMarkdown(first);
    expect(markdown).toBe(source);
    const second = lowerMarkdown(markdown);
    expect(second).toEqual(first);
  });

  it("does not let ordinary parenthetical text collide with preserved math on a write-then-reread round trip", () => {
    const source = "a link (not a link) trailing";
    const first = lowerMarkdown(source);
    const markdown = emitMarkdown(first);
    const second = lowerMarkdown(markdown);
    expect(second).toEqual(first);
    expect(markdown).not.toContain("\\(");
  });
});

describe("link and image titles (the `link` construct annotation)", () => {
  it('renders a titled link group as [text](dest "title"), reading the title from the covering run-level extent', () => {
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "text", hyperlink: "/u" }],
          constructs: [
            {
              descriptor: {
                kind: "link",
                target: { kind: "external", uri: "/u" },
                title: "the title",
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    expect(markdown).toBe('[text](/u "the title")');
  });

  it("uses the bracket form for an autolink-shaped run when a title extent covers it, since <...> has no title slot, and the text escapes as ordinary link text does", () => {
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "http://x", hyperlink: "http://x" }],
          constructs: [
            {
              descriptor: {
                kind: "link",
                target: { kind: "external", uri: "http://x" },
                title: "t",
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    expect(markdown).toBe('[http\\:\\/\\/x](http://x "t")');
  });

  it("escapes double quotes and backslashes inside a rendered title", () => {
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "text", hyperlink: "/u" }],
          constructs: [
            {
              descriptor: {
                kind: "link",
                target: { kind: "external", uri: "/u" },
                title: 'say "hi" \\ done',
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    expect(markdown).toBe('[text](/u "say \\"hi\\" \\\\ done")');
  });

  it("preserves a titled link byte for byte across a full lower -> emit -> lower round trip", () => {
    for (const source of [
      '[text](/u "the title")',
      '[one](/1 "a") middle [two](/2 "b")',
    ]) {
      const first = lowerMarkdown(source);
      const markdown = emitMarkdown(first);
      expect(markdown).toBe(source);
      expect(lowerMarkdown(markdown)).toEqual(first);
    }
  });

  it("preserves a titled link inside emphasis semantically -- the emit side re-spells the emphasis boundaries around the hyperlink group exactly as it already does for an untitled one, and the reparse reproduces the identical document", () => {
    const first = lowerMarkdown('a **b [c](/u "t") d** e');
    const markdown = emitMarkdown(first);
    expect(lowerMarkdown(markdown)).toEqual(first);
  });

  it('renders a link construct wrapping exactly one image block as ![alt](dest "title"), restoring the original destination instead of re-embedding bytes', () => {
    const blocks: ContentBlock[] = [
      {
        kind: "constructStart",
        descriptor: {
          kind: "link",
          target: { kind: "external", uri: "https://example.com/a.png" },
          title: "img title",
        },
      },
      {
        kind: "image",
        format: "png",
        base64: "AAAA",
        widthPt: 1,
        heightPt: 1,
        altText: "alt",
      },
      { kind: "constructEnd" },
    ];
    // A remote destination carries no bytes, so images: false (an "omit the bytes" switch) still renders it.
    expect(emitMarkdown(doc(blocks), { images: false })).toBe(
      '![alt](https://example.com/a.png "img title")',
    );
    expect(emitMarkdown(doc(blocks))).toBe(
      '![alt](https://example.com/a.png "img title")',
    );
  });

  it("falls back to the plain no-bytes image rendering when the construct destination is itself a data: URI and images: false asks for no bytes", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "constructStart",
        descriptor: {
          kind: "link",
          target: { kind: "external", uri: "data:image/png;base64,QQ==" },
          title: "t",
        },
      },
      {
        kind: "image",
        format: "png",
        base64: "QQ==",
        widthPt: 1,
        heightPt: 1,
        altText: "alt",
      },
      { kind: "constructEnd" },
    ];
    expect(emitMarkdown(doc(blocks), { images: false })).toBe("![alt]()");
  });

  it("throws for a paragraph whose run-level construct extent does not name real runs", () => {
    expect(() => {
      emitMarkdown(
        doc([
          {
            kind: "paragraph",
            runs: [{ text: "text", hyperlink: "/u" }],
            constructs: [
              {
                descriptor: {
                  kind: "link",
                  target: { kind: "external", uri: "/u" },
                  title: "t",
                },
                startRun: 0,
                endRun: 5,
              },
            ],
          },
        ]),
      );
    }).toThrow(MarkdownInvalidRunConstructExtentError);
    expect(() => {
      emitMarkdown(
        doc([
          {
            kind: "paragraph",
            runs: [{ text: "text", hyperlink: "/u" }],
            constructs: [
              {
                descriptor: {
                  kind: "link",
                  target: { kind: "external", uri: "/u" },
                  title: "t",
                },
                startRun: 2,
                endRun: 1,
              },
            ],
          },
        ]),
      );
    }).toThrow(/ends before it starts/);
  });
});

describe("gaps (MarkdownDiagnosticCodes)", () => {
  it("HEADING_LEVEL_CLAMPED fires when a styleId exceeds Heading6", () => {
    const collector = createDiagnosticCollector();
    const markdown = emitMarkdown(
      doc([{ kind: "paragraph", runs: [{ text: "x" }], styleId: "Heading9" }]),
      { sink: collector.sink },
    );
    expect(markdown).toBe("###### x");
    expect(collector.has(MarkdownDiagnosticCodes.HEADING_LEVEL_CLAMPED)).toBe(
      true,
    );
  });

  it("ADJACENT_LINKS_MERGED fires when two consecutive runs share a hyperlink", () => {
    const collector = createDiagnosticCollector();
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [
            { text: "a", hyperlink: "http://x" },
            { text: "b", hyperlink: "http://x" },
          ],
        },
      ]),
      { sink: collector.sink },
    );
    expect(markdown).toBe("[ab](http://x)");
    expect(collector.has(MarkdownDiagnosticCodes.ADJACENT_LINKS_MERGED)).toBe(
      true,
    );
  });

  it("CODE_SPAN_AS_MONOSPACE_RUN fires for a Courier New run", () => {
    const collector = createDiagnosticCollector();
    const markdown = emitMarkdown(
      doc([
        { kind: "paragraph", runs: [{ text: "x", fontFamily: "Courier New" }] },
      ]),
      { sink: collector.sink },
    );
    expect(markdown).toBe("`x`");
    expect(
      collector.has(MarkdownDiagnosticCodes.CODE_SPAN_AS_MONOSPACE_RUN),
    ).toBe(true);
  });

  it("PARAGRAPH_INDENT_DROPPED fires for indentLeftPt with no quotable styleId, and the indent is dropped", () => {
    const collector = createDiagnosticCollector();
    const markdown = emitMarkdown(
      doc([{ kind: "paragraph", runs: [{ text: "x" }], indentLeftPt: 20 }]),
      { sink: collector.sink },
    );
    expect(markdown).toBe("x");
    expect(
      collector.has(MarkdownDiagnosticCodes.PARAGRAPH_INDENT_DROPPED),
    ).toBe(true);
  });

  it("LIST_NUMID_FALLBACK fires for a numId this package never minted, falling back to a plain bullet", () => {
    const collector = createDiagnosticCollector();
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "x" }],
          list: { numId: "list1", level: 0 },
        },
      ]),
      { sink: collector.sink },
    );
    expect(markdown).toBe("- x");
    expect(collector.has(MarkdownDiagnosticCodes.LIST_NUMID_FALLBACK)).toBe(
      true,
    );
  });

  it("LIST_NUMID_FALLBACK fires once for depth-only memberships with no numId, falling back to one tight plain-bullet list", () => {
    const collector = createDiagnosticCollector();
    const markdown = emitMarkdown(
      doc([
        { kind: "paragraph", runs: [{ text: "x" }], list: { level: 0 } },
        { kind: "paragraph", runs: [{ text: "y" }], list: { level: 1 } },
      ]),
      { sink: collector.sink },
    );
    expect(markdown).toBe("- x\n  - y");
    expect(
      collector.diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === MarkdownDiagnosticCodes.LIST_NUMID_FALLBACK,
      ),
    ).toHaveLength(1);
  });

  it("TABLE_CELL_FORMATTING_DROPPED fires for colSpan/rowSpan/background and for a non-paragraph cell block", () => {
    const collector = createDiagnosticCollector();
    const table: ContentTable = {
      kind: "table",
      columnWidthsPt: [100],
      rows: [
        { cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "h" }] }] }] },
        {
          cells: [
            {
              blocks: [
                { kind: "paragraph", runs: [{ text: "x" }] },
                { kind: "pageBreak" },
              ],
              colSpan: 2,
            },
          ],
        },
      ],
    };
    emitMarkdown(doc([table]), { sink: collector.sink });
    expect(
      collector
        .codes()
        .filter(
          (code) =>
            code === MarkdownDiagnosticCodes.TABLE_CELL_FORMATTING_DROPPED,
        ).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("TABLE_CELL_MULTI_PARAGRAPH_JOINED fires for a cell with more than one paragraph, and the text space-joins", () => {
    const collector = createDiagnosticCollector();
    const table: ContentTable = {
      kind: "table",
      columnWidthsPt: [100],
      rows: [
        { cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "h" }] }] }] },
        {
          cells: [
            {
              blocks: [
                { kind: "paragraph", runs: [{ text: "one" }] },
                { kind: "paragraph", runs: [{ text: "two" }] },
              ],
            },
          ],
        },
      ],
    };
    const markdown = emitMarkdown(doc([table]), { sink: collector.sink });
    expect(markdown).toContain("one two");
    expect(
      collector.has(MarkdownDiagnosticCodes.TABLE_CELL_MULTI_PARAGRAPH_JOINED),
    ).toBe(true);
  });
});
