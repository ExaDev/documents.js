import { assertNeverRenderableBlock } from "./emit";
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

// The document's own first block's leaf text, concatenated across every run — used where a round trip is expected to preserve CONTENT but not necessarily the exact run boundaries (entity decoding does not re-merge adjacent plain-text runs on a reparse, since src/lower/inline.ts deliberately attempts no adjacent-run merging of its own).
function leafText(source: ContentDocument): string {
  if (source.kind !== "wordprocessing") {
    throw new Error("expected a wordprocessing ContentDocument");
  }
  const block = source.sections[0]?.blocks[0];
  if (block?.kind !== "paragraph") {
    throw new Error(`expected a paragraph block, got ${block?.kind}`);
  }
  return block.runs.map((run) => run.text).join("");
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

  it("re-emits a soft line break as a literal newline, restoring cmark's own soft-break convention rather than collapsing it to a space (ExaDev/documents.js#940)", () => {
    const source = "foo\nbar";
    const first = lowerMarkdown(source);
    const markdown = emitMarkdown(first);
    expect(markdown).toBe(source);
    const second = lowerMarkdown(markdown);
    expect(second).toEqual(first);
  });

  it("keeps a soft line break bracketed by emphasis as one nested wrap across the line break, not two independently-wrapped spans", () => {
    const source = "**foo\nbar**";
    const first = lowerMarkdown(source);
    const markdown = emitMarkdown(first);
    expect(markdown).toBe(source);
    expect(lowerMarkdown(markdown)).toEqual(first);
  });

  it("does not swallow a &nbsp;-derived character sitting at a paragraph's own edge as insignificant trim padding (ExaDev/documents.js#940)", () => {
    const source = "&nbsp; &amp; foo";
    const first = lowerMarkdown(source);
    const markdown = emitMarkdown(first);
    const nbspCharCode = 0x00a0; // &nbsp;'s own resolved codepoint, U+00A0 NO-BREAK SPACE
    expect(markdown.charCodeAt(0)).toBe(nbspCharCode);
    expect(leafText(lowerMarkdown(markdown))).toBe(leafText(first));
  });
});

describe("quoteDepthOf, longestRunLength, and leadingIndentColumns boundaries", () => {
  it("treats indentLeftPt: 0 the same as no indentLeftPt at all — no quote depth, no '>' prefix", () => {
    expect(
      emitMarkdown(
        doc([
          {
            kind: "paragraph",
            runs: [{ text: "x" }],
            styleId: "Quote",
            indentLeftPt: 0,
          },
        ]),
      ),
    ).toBe("x");
  });

  it("resets the fence-character run counter after a non-fence character interrupts it, rather than compounding the interrupted run's own length into a later run of the SAME length as if nothing had broken it", () => {
    // The genuine longest run of '`' here is 4 (the second one); a counter that failed to reset after 'xxx' would instead carry the first run's own length of 3 into the second, overcounting to 7 and picking an unnecessarily long fence.
    const literal = "```xxx````";
    expect(
      emitMarkdown(
        doc([
          {
            kind: "paragraph",
            runs: [{ text: literal }],
            styleId: "CodeBlock",
          },
        ]),
      ),
    ).toBe(`\`\`\`\`\`\n${literal}\n\`\`\`\`\``);
  });

  it("expands a leading tab to the correct tab-stop-aligned column count, not merely to SOME value past the 4-column indented-code-block threshold, when the tab is not the first character of the line", () => {
    // Two leading spaces (column 2) then a tab: the correct tab-stop rule rounds up to the NEXT multiple of 4, landing on column 4 (2 + 2) — exactly at, not past, CODE_INDENT_COLUMNS. A `%` -> `*` mutation of the tab-stop arithmetic computes 2 + (4 - 2*4) = 2 + -4 = -2 instead, which is NOT >= 4 and would wrongly let this promote to setext.
    const collector = createDiagnosticCollector();
    const written = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [
            {
              text: "  \tx",
              source: { format: "markdown", xml: "  \tx" },
            },
          ],
          styleId: "Heading1",
        },
      ]),
      { headingStyle: "setext", sink: collector.sink },
    );
    expect(written).toBe("#   \tx");
    expect(
      collector.has(
        MarkdownDiagnosticCodes.HEADING_LINE_BREAK_UNSAFE_FOR_SETEXT,
      ),
    ).toBe(true);
  });

  it("stops counting leading indentation at the first non-space, non-tab character, rather than resuming the count at a LATER space in the same line as if it were still leading", () => {
    // Correct: 'a' immediately stops the leading-indent scan at column 0 (well under the 4-column threshold), so this promotes safely to setext. A dropped `break` would instead skip over 'a' and keep scanning, picking up the run of 4 spaces that follows it as if it were still leading indentation, reaching column 4 and wrongly refusing the promotion.
    const collector = createDiagnosticCollector();
    const written = emitMarkdown(
      doc([
        { kind: "paragraph", runs: [{ text: "a    x" }], styleId: "Heading1" },
      ]),
      { headingStyle: "setext", sink: collector.sink },
    );
    expect(written).toBe("a    x\n======");
    expect(
      collector.has(
        MarkdownDiagnosticCodes.HEADING_LINE_BREAK_UNSAFE_FOR_SETEXT,
      ),
    ).toBe(false);
  });

  it("does not treat a heading's own SECOND line, indented 4+ columns, as an interrupting construct — CommonMark absorbs indented content as ordinary paragraph continuation, exactly like its own indented-code paragraph-interruption exception requires", () => {
    // "    - item" would itself match parseListMarker if the leading 4-column indent were not first exempted — indented content is absorbed as continuation instead, so this must still promote safely to setext rather than being refused as an interrupting list marker.
    const written = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [
            { text: "foo" },
            { text: "\n" },
            {
              text: "    - item",
              source: { format: "markdown", xml: "    - item" },
            },
          ],
          styleId: "Heading1",
        },
      ]),
    );
    expect(written).toBe("foo\\\n    - item\n====");

    const reparsed = lowerMarkdown(written);
    if (reparsed.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const [headingBlock] = reparsed.sections[0]?.blocks ?? [];
    if (headingBlock?.kind !== "paragraph") {
      throw new Error("expected a paragraph block");
    }
    expect(headingBlock.styleId).toBe("Heading1");
  });
});

describe("renderConstruct's own unrepresentable shapes", () => {
  it("reports CONSTRUCT_UNREPRESENTED, with the invalid label named, for a footnote anchor whose name cannot be spelled as a [^label]: marker", () => {
    const collector = createDiagnosticCollector();
    const markdown = emitMarkdown(
      doc([
        {
          kind: "constructStart",
          descriptor: {
            kind: "anchor",
            anchorType: "footnote",
            name: "bad label",
          },
        },
        { kind: "paragraph", runs: [{ text: "body" }] },
        { kind: "constructEnd" },
      ]),
      { sink: collector.sink },
    );
    expect(markdown).toBe("body");
    const diagnostic = collector.diagnostics.find(
      (d) => d.code === MarkdownDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
    );
    expect(diagnostic?.message).toContain("bad label");
    expect(diagnostic?.message).toContain("footnote");
  });

  it("reports CONSTRUCT_UNREPRESENTED with 'anchor (bookmark)' as the detail for a non-footnote anchor, distinguishing it from a bare 'anchor'", () => {
    const collector = createDiagnosticCollector();
    const markdown = emitMarkdown(
      doc([
        {
          kind: "constructStart",
          descriptor: { kind: "anchor", anchorType: "bookmark", name: "b1" },
        },
        { kind: "paragraph", runs: [{ text: "body" }] },
        { kind: "constructEnd" },
      ]),
      { sink: collector.sink },
    );
    expect(markdown).toBe("body");
    const diagnostic = collector.diagnostics.find(
      (d) => d.code === MarkdownDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
    );
    expect(diagnostic?.message).toContain("anchor (bookmark)");
  });

  it("does not leave an extra blank-line gap for a CONSTRUCT that renders to nothing at all, such as a bodyless footnote anchor (a point anchor with an empty extent) sitting between two paragraphs", () => {
    const markdown = emitMarkdown(
      doc([
        { kind: "paragraph", runs: [{ text: "a" }] },
        {
          kind: "constructStart",
          descriptor: { kind: "anchor", anchorType: "bookmark", name: "empty" },
        },
        { kind: "constructEnd" },
        { kind: "paragraph", runs: [{ text: "b" }] },
      ]),
    );
    expect(markdown).toBe("a\n\nb");
  });

  it("does not leave an extra blank-line gap for a top-level block that renders to nothing at all, such as a page break sitting between two paragraphs", () => {
    const markdown = emitMarkdown(
      doc([
        { kind: "paragraph", runs: [{ text: "a" }] },
        { kind: "pageBreak" },
        { kind: "paragraph", runs: [{ text: "b" }] },
      ]),
    );
    // Exactly one blank line between "a" and "b" — not two, which pushing the page break's own empty string into the joined parts array would produce.
    expect(markdown).toBe("a\n\nb");
  });

  it("does not double-count a division-wrapped paragraph's own indentLeftPt as additional quote depth on top of the division's own '> ' wrapping", () => {
    const markdown = emitMarkdown(
      doc([
        {
          kind: "constructStart",
          descriptor: { kind: "division", name: "d1" },
        },
        {
          kind: "paragraph",
          runs: [{ text: "x" }],
          styleId: "Quote",
          indentLeftPt: 72,
        },
        { kind: "constructEnd" },
      ]),
    );
    // Exactly one level of '> ' from the division itself — NOT '> > x', which double-counting the paragraph's own indentLeftPt (72pt, two quote levels' worth) on top of the division's own wrapping would produce.
    expect(markdown).toBe("> x");
  });

  it("restores divisionDepth to its own PRIOR value once a division closes, rather than leaking an elevated depth into whatever renders after it", () => {
    const markdown = emitMarkdown(
      doc([
        {
          kind: "constructStart",
          descriptor: { kind: "division", name: "d1" },
        },
        {
          kind: "paragraph",
          runs: [{ text: "x" }],
          styleId: "Quote",
          indentLeftPt: 36,
        },
        { kind: "constructEnd" },
        {
          kind: "paragraph",
          runs: [{ text: "y" }],
          styleId: "Quote",
          indentLeftPt: 36,
        },
      ]),
    );
    // A STANDALONE paragraph after the division closes must recover its own '> ' from indentLeftPt alone — a decrement that failed to restore divisionDepth to 0 would leave this second paragraph's own quote prefix wrongly suppressed, rendering plain "y" instead of "> y".
    expect(markdown).toBe("> x\n\n> y");
  });

  it("still re-embeds a data: URI destination for a link construct wrapping exactly one image when images is left at its own default (true), rather than always falling back to the no-bytes rendering", () => {
    const dataUri = "data:image/png;base64,AAAA";
    const markdown = emitMarkdown(
      doc([
        {
          kind: "constructStart",
          descriptor: {
            kind: "link",
            target: { kind: "external", uri: dataUri },
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
      ]),
    );
    expect(markdown).toBe(`![alt](${dataUri})`);
  });
});

describe("emitMarkdown's own top-level assembly", () => {
  it("joins multiple sections with a blank line, not concatenating them directly", () => {
    const document: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: PAGE_SIZE_A4,
          margins: DEFAULT_MARGINS,
          blocks: [{ kind: "paragraph", runs: [{ text: "first" }] }],
        },
        {
          pageSize: PAGE_SIZE_A4,
          margins: DEFAULT_MARGINS,
          blocks: [{ kind: "paragraph", runs: [{ text: "second" }] }],
        },
      ],
    };
    expect(emitMarkdown(document)).toBe("first\n\nsecond");
  });

  it("prepends a YAML front matter block, separated from the body by a blank line, when frontMatter: true and the metadata carries a field it can emit", () => {
    const document: ContentDocument = {
      kind: "wordprocessing",
      metadata: { title: "My Title" },
      sections: [
        {
          pageSize: PAGE_SIZE_A4,
          margins: DEFAULT_MARGINS,
          blocks: [{ kind: "paragraph", runs: [{ text: "body" }] }],
        },
      ],
    };
    expect(emitMarkdown(document, { frontMatter: true })).toBe(
      "---\ntitle: My Title\n---\n\nbody",
    );
  });

  it("emits no front matter block at all when frontMatter is not requested, even though the metadata carries a field emitFrontMatter could have emitted", () => {
    const document: ContentDocument = {
      kind: "wordprocessing",
      metadata: { title: "My Title" },
      sections: [
        {
          pageSize: PAGE_SIZE_A4,
          margins: DEFAULT_MARGINS,
          blocks: [{ kind: "paragraph", runs: [{ text: "body" }] }],
        },
      ],
    };
    expect(emitMarkdown(document)).toBe("body");
  });

  it("rewrites every line ending to CRLF when lineEnding: 'crlf' is requested", () => {
    expect(
      emitMarkdown(
        doc([
          { kind: "paragraph", runs: [{ text: "first" }] },
          { kind: "paragraph", runs: [{ text: "second" }] },
        ]),
        { lineEnding: "crlf" },
      ),
    ).toBe("first\r\n\r\nsecond");
  });
});

describe("assertNeverRenderableBlock", () => {
  it("throws naming the unhandled renderable block, proving renderTopLevelBlock's own exhaustiveness guard fires at runtime", () => {
    expect(() => {
      assertNeverRenderableBlock({ kind: "bogus" } as never);
    }).toThrow('markdown-codec: unhandled renderable block {"kind":"bogus"}');
  });
});
