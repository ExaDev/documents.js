// The list suites split from emit.test.ts: ordering, markers, tightness and the adjacent-glyph cases, sharing the doc/diagnostics harness.

import type { ContentBlock, ContentDocument } from "document-schema.js";
import { PAGE_SIZE_A4 } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { DEFAULT_MARGINS } from "../defaults/defaults";

import { lowerMarkdown } from "../lower/lower";

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

describe("lists", () => {
  it("still renders a blockquote wrapping its own list as separate top-level content when it genuinely sits BETWEEN two unrelated lists, not inside either one's item — the construct's surrounding itemId differs on both sides, so it must not be absorbed the way the in-item case above is", () => {
    const source = "- a\n- b\n\n> quote\n\n- c\n- d\n";
    const written = emitMarkdown(lowerMarkdown(source));
    expect(written).toBe("- a\n- b\n\n> quote\n\n- c\n- d");
  });

  // ExaDev/documents.js#1012: a list item whose entire content is a construct, with no leading plain paragraph of its own to trigger renderItems' region-collection scan in the first place — the simplest shape being a bare `* > quote` with nothing else in the item. Fixed at src/lower/lower.ts's own lowerListItem, which now gives such an item the same empty-placeholder anchor a nested-list-only item already gets (see lower.test.ts's own "carries itemId on an empty placeholder too, when the item's only content is a construct"), rather than at emit.ts: a construct sitting at an item's own head is otherwise indistinguishable, from the flat block data alone, from a genuinely unrelated construct that merely wraps a fresh list of its own (CommonMark spec 0.31.2 example 235, `> - foo\n- bar`, is exactly that unrelated shape — see the test just below, which must keep rendering unchanged).
  it("nests a list item's own construct correctly when the item has no other content at all — the bullet is no longer emitted inside the blockquote (ExaDev/documents.js#1012)", () => {
    const source = "* > quote\n";
    const written = emitMarkdown(lowerMarkdown(source));
    expect(written).toBe("- \n  > quote");

    // A stable fixed point: writing the reparsed output again reproduces the identical text.
    const rewritten = emitMarkdown(lowerMarkdown(`${written}\n`));
    expect(rewritten).toBe(written);

    const reparsed = lowerMarkdown(written);
    if (reparsed.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const paragraphs = (reparsed.sections[0]?.blocks ?? []).filter(
      (block) => block.kind === "paragraph",
    );
    const [placeholder, quote] = paragraphs;
    expect(paragraphs).toHaveLength(2);
    expect(placeholder?.list?.itemId).toBeDefined();
    // "quote" is the SAME item continuing into the construct's own dual-carried interior, not a fresh nested one.
    expect(quote?.list?.itemId).toBe(placeholder?.list?.itemId);
  });

  it("still renders a bare blockquote wrapping only a single-item fresh list as itself, with no borrowed outer item to attach it to (CommonMark spec 0.31.2 example 235) — the exact shape ExaDev/documents.js#1012's own fix must not misidentify as a construct-only list item", () => {
    const source = "> - foo\n- bar\n";
    const written = emitMarkdown(lowerMarkdown(source));
    expect(written).toBe("> - foo\n\n- bar");
  });

  it("keeps a Quote-styled block and a following plain block of the same item as two separate blocks on write-then-reparse — Quote is NOT self-delimiting inside a list region: renderListRegion renders every block through renderParagraphBody, which never applies a '> ' prefix, so a Quote-styled block reads back identically to a plain one and the two would otherwise merge into one paragraph via CommonMark's lazy continuation", () => {
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

  it("inserts a blank line between a paragraph and a following Heading2 rendered as setext too, not just Heading1 — willRenderAsSetext's own level > MAX_SETEXT_LEVEL check must correctly admit level 2 AT the boundary, not treat it the same as a level that exceeds it", () => {
    const written = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "a" }],
          list: { numId: "md1:bullet", level: 0, itemId: "i1" },
        },
        {
          kind: "paragraph",
          styleId: "Heading2",
          runs: [{ text: "h" }],
          list: { numId: "md1:bullet", level: 0, itemId: "i1" },
        },
      ]),
      { headingStyle: "setext" },
    );
    expect(written).toBe("- a\n\n  h\n  -");
  });

  it("keeps a paragraph and a following Heading3 TIGHT even with headingStyle: 'setext' requested — level 3 always renders as ATX regardless of the configured style (there is no setext spelling beyond level 2), so willRenderAsSetext must still refuse it rather than treating any level as eligible whenever setext is merely requested", () => {
    const written = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "a" }],
          list: { numId: "md1:bullet", level: 0, itemId: "i1" },
        },
        {
          kind: "paragraph",
          styleId: "Heading3",
          runs: [{ text: "h" }],
          list: { numId: "md1:bullet", level: 0, itemId: "i1" },
        },
      ]),
      { headingStyle: "setext" },
    );
    expect(written).toBe("- a\n  ### h");
  });

  it("inserts a blank line between a paragraph and a following heading that is forced to setext by its OWN embedded line break, even with the default ATX headingStyle — the interrupt guard must key off what the heading will actually render as, not the configured style, or the preceding paragraph is silently absorbed into it on reparse (ExaDev/documents.js#940)", () => {
    const softBreakRuns = [
      { text: "h1" },
      { text: " ", source: { format: "markdown" as const, xml: "\n" } },
      { text: "h2" },
    ];
    const source = doc([
      {
        kind: "paragraph",
        runs: [{ text: "a" }],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
      {
        kind: "paragraph",
        styleId: "Heading1",
        runs: softBreakRuns,
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
    ]);
    const written = emitMarkdown(source);
    expect(written).toBe("- a\n\n  h1\n  h2\n  ==");

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
    expect(paragraphBlock.styleId).toBeUndefined();
    expect(paragraphBlock.runs.map((run) => run.text).join("")).toBe("a");
    expect(headingBlock.styleId).toBe("Heading1");
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

  it("inserts a blank line before a CodeBlock following an HTMLPreformatted block, even though a fenced code block always interrupts an open PARAGRAPH — an open HTML block (CommonMark start conditions 6/7) is a different construct that ends only at a blank line, so canInterruptOpenParagraph's answer for the NEXT block is not a valid signal here at all", () => {
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

  it("inserts a blank line before a thematic break rendered with a non-default character ('*') following an HTMLPreformatted block — '*' is never a setext underline, so canInterruptOpenParagraph accepts it, but an open HTML block absorbs any non-blank line regardless of what that line looks like", () => {
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
});
