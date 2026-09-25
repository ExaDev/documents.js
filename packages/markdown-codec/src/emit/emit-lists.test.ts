// The list suites split from emit.test.ts: ordering, markers, tightness and the adjacent-glyph cases, sharing the doc/diagnostics harness.

import type { ContentBlock, ContentDocument } from "document-schema.js";
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

  it("recognises the pre-field UNCHECKED glyph spelling on its OWN, with no checked item preceding it in the same call, and with real text following the glyph in the SAME run (so startsWith and endsWith genuinely disagree)", () => {
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "☐ todo" }],
          list: { numId: "md1:bullet+task", level: 0 },
        },
      ]),
    );
    expect(markdown).toBe("- [ ] todo");
  });

  it("never strips a run's own leading text when the checkbox comes from membership.checked instead of a legacy glyph, even when that text happens to look exactly like the legacy glyph spelling", () => {
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "☒ literal text not a glyph to strip" }],
          list: {
            numId: "md1:bullet+task",
            level: 0,
            checked: true,
            itemId: "i1",
          },
        },
      ]),
    );
    // stripGlyph must be false here — the checkbox already came from membership.checked, so this run's own text is ordinary content, never a legacy glyph prefix to strip back off.
    expect(markdown).toBe("- [x] ☒ literal text not a glyph to strip");
  });

  it("strips a legacy checkbox glyph from a run that ALSO carries its own following text, not just when the glyph fills a whole separate run of its own", () => {
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "☒ done" }],
          list: { numId: "md1:bullet+task", level: 0 },
        },
      ]),
    );
    expect(markdown).toBe("- [x] done");
  });

  it("renders an ordinary bullet with no checkbox at all for a task-flagged numId whose leading text matches neither legacy glyph", () => {
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "ordinary" }],
          list: { numId: "md1:bullet+task", level: 0 },
        },
      ]),
    );
    expect(markdown).toBe("- ordinary");
  });

  it("never misreads a ballot-box glyph as a checkbox for an ORDINARY (non-task-flagged) numId, even though its leading text happens to match the legacy glyph spelling exactly", () => {
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "☒ not a checkbox" }],
          list: { numId: "md1:bullet", level: 0 },
        },
      ]),
    );
    expect(markdown).toBe("- ☒ not a checkbox");
  });

  it("does not pad a genuinely blank line inside a NESTED sub-list's own rendering with trailing indent whitespace once that rendering is indented under its parent item", () => {
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "a" }],
          list: { numId: "md1:bullet", level: 0, itemId: "i1" },
        },
        {
          kind: "paragraph",
          runs: [{ text: "b" }],
          list: { numId: "md1:bullet+loose", level: 1 },
        },
        {
          kind: "paragraph",
          runs: [{ text: "c" }],
          list: { numId: "md1:bullet+loose", level: 1 },
        },
      ]),
    );
    expect(markdown).toBe("- a\n  - b\n\n  - c");
    // Split on "\n" and re-check the blank line specifically: exactly "", never "  " (indent with nothing on it).
    expect(markdown.split("\n")).toContain("");
  });

  it("recognises a construct as carrying an item's own itemId when ONLY ONE of its several children actually carries it, not requiring every child to — constructCarriesListItemId is an ANY match, not an ALL match", () => {
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "a" }],
          list: { numId: "md1:bullet", level: 0, itemId: "i1" },
        },
        {
          kind: "constructStart",
          descriptor: { kind: "division", name: "d1" },
        },
        {
          kind: "paragraph",
          runs: [{ text: "carries i1" }],
          list: { numId: "md1:bullet", level: 0, itemId: "i1" },
        },
        { kind: "paragraph", runs: [{ text: "other" }] },
        { kind: "constructEnd" },
      ]),
    );
    // The construct is recognised as belonging to item i1 (one of its two children carries that itemId, and ANY match is enough) and stays absorbed into i1's own run, rather than fracturing out as an unrelated top-level construct.
    expect(markdown).toBe("- a\n\n  carries i1\n\n  other");
  });

  it("pops a SIBLING item's own membership off openMemberships before pushing the next one at the SAME level, not just a genuinely deeper one — a stale sibling entry left on the stack could wrongly absorb a later construct that only carries THAT earlier sibling's own itemId", () => {
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "i1" }],
          list: { numId: "md1:bullet", level: 0, itemId: "i1" },
        },
        {
          kind: "paragraph",
          runs: [{ text: "i2" }],
          list: { numId: "md1:bullet", level: 0, itemId: "i2" },
        },
        {
          kind: "constructStart",
          descriptor: { kind: "division", name: "d1" },
        },
        {
          kind: "paragraph",
          runs: [{ text: "carries i1" }],
          list: { numId: "md1:bullet", level: 0, itemId: "i1" },
        },
        { kind: "constructEnd" },
      ]),
    );
    // i1's own membership must already be off the stack once i2 (its sibling at the SAME level) is pushed — so this construct, which carries only i1's itemId, cannot still be absorbed into the (no-longer-open) i1 item; it fractures out and re-enters as its OWN fresh list region instead (its wrapped paragraph still carries itemId i1, but as a new region, not a continuation of the item above).
    expect(markdown).toBe("- i1\n- i2\n\n- carries i1");
  });

  it("finds the REAL last styleId of a NESTED sub-list's own last block, not just undefined, so the outer item's own resuming block reflects what that sub-list actually ends on", () => {
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "a" }],
          list: { numId: "md1:bullet", level: 0, itemId: "i1" },
        },
        {
          kind: "paragraph",
          runs: [{ text: "b" }],
          styleId: "CodeBlock",
          list: { numId: "md1:bullet", level: 1, itemId: "i2" },
        },
        {
          kind: "paragraph",
          runs: [{ text: "z" }],
          list: { numId: "md1:bullet", level: 0, itemId: "i1" },
        },
      ]),
    );
    // No forced blank line before "z": the nested sub-list's own last (and only) item is a CodeBlock, which terminates cleanly — reading segment.blocks[segment.blocks.length - 1] must actually find that item, not silently report undefined (which would wrongly force a blank line here).
    expect(markdown).toBe("- a\n  - ```\n    b\n    ```\n  z");
  });

  it("needs no forced blank line before a construct whose own FIRST child is an EMPTY, non-division nested construct, in the SAME list item — emitItemCanInterrupt's construct-recursion base case (an empty children array) defaults to interrupting, exactly like the non-paragraph fallback it mirrors", () => {
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "a" }],
          list: { numId: "md1:bullet", level: 0, itemId: "i1" },
        },
        {
          kind: "constructStart",
          descriptor: {
            kind: "link",
            target: { kind: "external", uri: "https://example.com" },
          },
        },
        {
          kind: "constructStart",
          descriptor: { kind: "anchor", anchorType: "bookmark", name: "empty" },
        },
        { kind: "constructEnd" },
        {
          kind: "paragraph",
          runs: [{ text: "caption" }],
          list: { numId: "md1:bullet", level: 0, itemId: "i1" },
        },
        { kind: "constructEnd" },
      ]),
    );
    expect(markdown).toBe("- a\n  caption");
  });

  it("needs no forced blank line between an open (styleId-less) paragraph and a following link-construct whose FIRST child is a non-paragraph IMAGE block, in the SAME list item — a non-paragraph block always interrupts an open paragraph unconditionally, per emitItemCanInterrupt's non-construct fallback", () => {
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "a" }],
          list: { numId: "md1:bullet", level: 0, itemId: "i1" },
        },
        {
          kind: "constructStart",
          descriptor: {
            kind: "link",
            target: { kind: "external", uri: "https://example.com/a.png" },
          },
        },
        {
          kind: "image",
          format: "png",
          base64: "AAAA",
          widthPt: 1,
          heightPt: 1,
          altText: "img",
        },
        {
          kind: "paragraph",
          runs: [{ text: "caption" }],
          list: { numId: "md1:bullet", level: 0, itemId: "i1" },
        },
        { kind: "constructEnd" },
      ]),
    );
    expect(markdown).toBe(
      "- a\n  ![img](data:image/png;base64,AAAA)\n\n  caption",
    );
  });

  it("finds the REAL last styleId inside a construct that resumes a list item, not just undefined, so a following block's own blank-line decision reflects what that construct actually ends on", () => {
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "a" }],
          list: { numId: "md1:bullet", level: 0, itemId: "i1" },
        },
        {
          kind: "constructStart",
          descriptor: { kind: "division", name: "d1" },
        },
        {
          kind: "paragraph",
          runs: [{ text: "mid" }],
          styleId: "CodeBlock",
          list: { numId: "md1:bullet", level: 0, itemId: "i1" },
        },
        { kind: "constructEnd" },
        {
          kind: "paragraph",
          runs: [{ text: "z" }],
          list: { numId: "md1:bullet", level: 0, itemId: "i1" },
        },
      ]),
    );
    // No forced blank line before "z": the construct's own last (and only) wrapped block is a CodeBlock, which terminates cleanly — lastStyleIdOf must actually find that CodeBlock styleId through the construct's own children, not silently report undefined (which would wrongly force a blank line here).
    expect(markdown).toBe("- a\n  ```\n  mid\n  ```\n  z");
  });

  it("renders every block of one itemId as a single item — a blank line and the continuation indent between blocks, one marker only", () => {
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

  it("does not pad a genuinely blank line inside a LATER (continuation) block's own body with trailing indent whitespace once that block is indented under the item's marker", () => {
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "a" }],
          list: { numId: "md1:bullet", level: 0, itemId: "md-i1" },
        },
        {
          kind: "paragraph",
          runs: [{ text: "x\n\ny" }],
          styleId: "CodeBlock",
          list: { numId: "md1:bullet", level: 0, itemId: "md-i1" },
        },
      ]),
    );
    expect(markdown).toBe("- a\n  ```\n  x\n\n  y\n  ```");
    expect(markdown.split("\n")).toContain("");
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

  it("keeps one item per paragraph for memberships with no itemId at all — the cross-format shape every foreign producer sends", () => {
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

    // A loose multi-block item re-emits with the loose sibling spacing the numId itself records, so the text is not byte-identical to a source whose author ran the sibling tight — but the reparse reproduces the identical document and a second pass is a fixed point.
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
    // "a" and the fenced code block are ONE item — same itemId — while "b" is a genuinely separate sibling item, never sharing it.
    expect(paragraphA.list?.itemId).toBeDefined();
    expect(codeBlock.list?.itemId).toBe(paragraphA.list?.itemId);
    expect(paragraphB.list?.itemId).not.toBe(paragraphA.list?.itemId);

    const written = emitMarkdown(first);
    expect(written).toBe(source);
    expect(lowerMarkdown(written)).toEqual(first);
  });

  it("keeps a construct (blockquote) directly inside a multi-block list item nested inside that item's own contiguous run on write, rather than fracturing it out as separate top-level content — ExaDev/documents.js#990", () => {
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
    const paragraphCount = 3;
    expect(paragraphs).toHaveLength(paragraphCount);
    const itemIds = new Set(
      paragraphs.map((paragraph) => paragraph.list?.itemId),
    );
    expect(itemIds.size).toBe(1);
    expect(itemIds.has(undefined)).toBe(false);
  });

  it("keeps a blockquote directly inside a multi-block list item nested inside that item even when the quote wraps only a NESTED LIST of its own, rather than fracturing the item around it — ExaDev/documents.js#990", () => {
    const source = "- before\n\n  > - a\n  > - b\n\n  after\n";
    const written = emitMarkdown(lowerMarkdown(source));
    expect(written).toBe("- before\n\n  > - a\n  > - b\n\n  after");

    const reparsed = lowerMarkdown(written);
    if (reparsed.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const blocks = reparsed.sections[0]?.blocks ?? [];
    const paragraphs = blocks.filter((block) => block.kind === "paragraph");
    // Four paragraphs total: "before"/"after" (the outer item) plus "a"/"b" (the quote's own nested list) — none of them dropped or fused together.
    const paragraphCount = 4;
    expect(paragraphs).toHaveLength(paragraphCount);
    const [before, a, b, after] = paragraphs;
    // "before" and "after" still share ONE outer itemId across the construct, exactly like the plain-paragraph-in-quote case above — the construct did not fracture the item.
    expect(before?.list?.itemId).toBeDefined();
    expect(after?.list?.itemId).toBe(before?.list?.itemId);
    // "a" and "b" are a GENUINELY separate, freshly-minted nested list — their own itemIds differ from each other and from the outer item's, and their own numId differs from the outer item's numId, proving this is real nesting (a bullet list inside the blockquote) rather than the quote's content being folded into the outer item's own run.
    expect(a?.list?.itemId).toBeDefined();
    expect(b?.list?.itemId).toBeDefined();
    expect(a?.list?.itemId).not.toBe(before?.list?.itemId);
    expect(b?.list?.itemId).not.toBe(a?.list?.itemId);
    expect(a?.list?.numId).not.toBe(before?.list?.numId);
  });

  it("keeps a blockquote wrapping only a nested list of its own nested inside the item even when it is that item's own LAST block, with nothing after it to look ahead to — ExaDev/documents.js#990", () => {
    const source = "- before\n\n  > - a\n  > - b\n";
    const written = emitMarkdown(lowerMarkdown(source));
    expect(written).toBe("- before\n\n  > - a\n  > - b");

    const reparsed = lowerMarkdown(written);
    if (reparsed.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const paragraphs = (reparsed.sections[0]?.blocks ?? []).filter(
      (block) => block.kind === "paragraph",
    );
    const [before, a, b] = paragraphs;
    const paragraphCount = 3;
    expect(paragraphs).toHaveLength(paragraphCount);
    expect(before?.list?.itemId).toBeDefined();
    expect(a?.list?.itemId).toBeDefined();
    expect(b?.list?.itemId).toBeDefined();
    expect(a?.list?.itemId).not.toBe(before?.list?.itemId);
    expect(b?.list?.itemId).not.toBe(a?.list?.itemId);
  });

  it("keeps two constructs sitting back to back, with no paragraph directly between them, both nested inside the item they interrupt — ExaDev/documents.js#990", () => {
    const source = "- before\n\n  > - a\n\n  > - b\n\n  after\n";
    const written = emitMarkdown(lowerMarkdown(source));
    expect(written).toBe("- before\n\n  > - a\n\n  > - b\n\n  after");

    const reparsed = lowerMarkdown(written);
    if (reparsed.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const paragraphs = (reparsed.sections[0]?.blocks ?? []).filter(
      (block) => block.kind === "paragraph",
    );
    const [before, a, b, after] = paragraphs;
    const paragraphCount = 4;
    expect(paragraphs).toHaveLength(paragraphCount);
    // "before" and "after" still share one outer itemId across BOTH constructs.
    expect(before?.list?.itemId).toBeDefined();
    expect(after?.list?.itemId).toBe(before?.list?.itemId);
    // "a" and "b" are each their own genuinely separate, freshly-minted single-item list.
    expect(a?.list?.itemId).toBeDefined();
    expect(b?.list?.itemId).toBeDefined();
    expect(a?.list?.itemId).not.toBe(before?.list?.itemId);
    expect(b?.list?.itemId).not.toBe(a?.list?.itemId);
  });

  it("keeps a construct nested inside the item it interrupts even when a DIFFERENT list item's own paragraph follows it, rather than merging the two items or fracturing the construct out — ExaDev/documents.js#990", () => {
    const source = "- before\n\n  > - a\n\n- second\n";
    const written = emitMarkdown(lowerMarkdown(source));
    expect(written).toBe("- before\n\n  > - a\n\n- second");

    const reparsed = lowerMarkdown(written);
    if (reparsed.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const paragraphs = (reparsed.sections[0]?.blocks ?? []).filter(
      (block) => block.kind === "paragraph",
    );
    const [before, a, second] = paragraphs;
    const paragraphCount = 3;
    expect(paragraphs).toHaveLength(paragraphCount);
    expect(before?.list?.itemId).toBeDefined();
    expect(a?.list?.itemId).toBeDefined();
    expect(a?.list?.itemId).not.toBe(before?.list?.itemId);
    // "second" is a genuinely different, sibling item of the SAME outer list — same numId, different itemId.
    expect(second?.list?.itemId).toBeDefined();
    expect(second?.list?.itemId).not.toBe(before?.list?.itemId);
    expect(second?.list?.numId).toBe(before?.list?.numId);
  });

  it("keeps a construct nested inside a NESTED (level 1) item across a reparse, rather than fracturing it out to the outer list's own level — ExaDev/documents.js#990", () => {
    const source =
      "- outer\n\n  - inner\n\n    > - a\n    > - b\n\n  - inner2\n";
    const written = emitMarkdown(lowerMarkdown(source));

    const reparsed = lowerMarkdown(written);
    if (reparsed.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const paragraphs = (reparsed.sections[0]?.blocks ?? []).filter(
      (block) => block.kind === "paragraph",
    );
    const [outer, inner, a, b, inner2] = paragraphs;
    const paragraphCount = 5;
    expect(paragraphs).toHaveLength(paragraphCount);
    // "outer" stays level 0; "inner"/"inner2" stay level 1, siblings of the SAME nested list, never displaced to level 0 by the construct sitting between them.
    expect(outer?.list?.level).toBe(0);
    expect(inner?.list?.level).toBe(1);
    expect(inner2?.list?.level).toBe(1);
    expect(inner?.list?.numId).toBe(inner2?.list?.numId);
    expect(inner?.list?.itemId).not.toBe(inner2?.list?.itemId);
    // "a"/"b" are their own genuinely separate, freshly-minted list, unrelated to "inner"'s own numId.
    expect(a?.list?.itemId).toBeDefined();
    expect(b?.list?.itemId).toBeDefined();
    expect(a?.list?.numId).not.toBe(inner?.list?.numId);
  });

  it("keeps a construct nested inside the OUTER item when it directly resumes that item right after a NESTED sub-list closes, rather than fracturing the item and rendering the construct with an inverted marker — a single most-recently-absorbed membership cannot tell this apart from the nested item's own construct, since the nested item's own paragraph was the last one absorbed before the construct is reached — ExaDev/documents.js#990", () => {
    const source = "- before\n\n  - nested\n\n  > quoted\n\n  after\n";
    const written = emitMarkdown(lowerMarkdown(source));

    const reparsed = lowerMarkdown(written);
    if (reparsed.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const paragraphs = (reparsed.sections[0]?.blocks ?? []).filter(
      (block) => block.kind === "paragraph",
    );
    const [before, nested, quoted, after] = paragraphs;
    const paragraphCount = 4;
    expect(paragraphs).toHaveLength(paragraphCount);
    // "before", "quoted", and "after" all still share the OUTER item's own itemId across the reparse — the construct resuming the outer item after the nested sub-list closes did not fracture it apart, and the construct's own marker is never inverted (no bullet ends up rendered inside the blockquote).
    expect(before?.list?.level).toBe(0);
    expect(quoted?.list?.level).toBe(0);
    expect(after?.list?.level).toBe(0);
    expect(before?.list?.itemId).toBeDefined();
    expect(quoted?.list?.itemId).toBe(before?.list?.itemId);
    expect(after?.list?.itemId).toBe(before?.list?.itemId);
    // "nested" is a genuinely separate, deeper item — its own itemId at level 1, unrelated to the outer item's.
    expect(nested?.list?.level).toBe(1);
    expect(nested?.list?.itemId).toBeDefined();
    expect(nested?.list?.itemId).not.toBe(before?.list?.itemId);
  });

  it("keeps a construct nested inside the OUTER item resuming after a NESTED sub-list even when the construct itself wraps a FRESH nested list of its own, not just plain prose — the owner-tag match (constructCarriesListItemId's numId path) must also be tried against the outer item, not only the nested item most recently absorbed — ExaDev/documents.js#990", () => {
    const source = "- before\n\n  - nested\n\n  > - q1\n  > - q2\n\n  after\n";
    const written = emitMarkdown(lowerMarkdown(source));

    const reparsed = lowerMarkdown(written);
    if (reparsed.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const paragraphs = (reparsed.sections[0]?.blocks ?? []).filter(
      (block) => block.kind === "paragraph",
    );
    const [before, nested, q1, q2, after] = paragraphs;
    const paragraphCount = 5;
    expect(paragraphs).toHaveLength(paragraphCount);
    expect(before?.list?.itemId).toBeDefined();
    expect(after?.list?.itemId).toBe(before?.list?.itemId);
    // "nested" is the outer item's own deeper sibling list, untouched by the quote resuming past it.
    expect(nested?.list?.level).toBe(1);
    expect(nested?.list?.itemId).not.toBe(before?.list?.itemId);
    // "q1"/"q2" are their own genuinely separate, freshly-minted nested list — neither their itemIds nor their numId match the outer item's or "nested"'s own.
    expect(q1?.list?.itemId).toBeDefined();
    expect(q2?.list?.itemId).toBeDefined();
    expect(q1?.list?.itemId).not.toBe(before?.list?.itemId);
    expect(q2?.list?.itemId).not.toBe(q1?.list?.itemId);
    expect(q1?.list?.numId).not.toBe(before?.list?.numId);
    expect(q1?.list?.numId).not.toBe(nested?.list?.numId);
  });

  it("keeps a construct nested inside the OUTER item resuming after a NESTED sub-list even when it is that outer item's own LAST block, with nothing after it to look ahead to — ExaDev/documents.js#990", () => {
    const source = "- before\n\n  - nested\n\n  > quoted\n";
    const written = emitMarkdown(lowerMarkdown(source));

    const reparsed = lowerMarkdown(written);
    if (reparsed.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const paragraphs = (reparsed.sections[0]?.blocks ?? []).filter(
      (block) => block.kind === "paragraph",
    );
    const [before, nested, quoted] = paragraphs;
    const paragraphCount = 3;
    expect(paragraphs).toHaveLength(paragraphCount);
    expect(before?.list?.itemId).toBeDefined();
    expect(quoted?.list?.itemId).toBe(before?.list?.itemId);
    expect(nested?.list?.itemId).not.toBe(before?.list?.itemId);
  });

  it("still fractures a list item around a quote wrapping ONLY a table — a ContentTable has no ContentListMembership field of its own to carry either a direct itemId or a numId owner tag, so constructCarriesListItemId cannot recognise it — but LIST_ITEM_BLOCK_UNLISTED already reports the underlying cause at lower time, so the loss is diagnosed rather than silent (LIST_ITEM_MULTI_BLOCK_FLATTENED stays retired: every other shape a blockquote can wrap either carries list-membership data (a paragraph, of any kind decorateParagraph produces, at any list nesting depth and regardless of how many nested sub-list runs intervene before the quote resumes its own enclosing item — renderItems' own openMemberships stack, not just constructCarriesListItemId's recursion, is what makes that true) or is one of the three block kinds LIST_ITEM_BLOCK_UNLISTED already covers — table, resolved image, display math)", () => {
    const source =
      "- before\n\n  > | a | b |\n  > | - | - |\n  > | 1 | 2 |\n\n  after\n";
    const collector = createDiagnosticCollector();
    const lowered = lowerMarkdown(source, { sink: collector.sink });
    expect(
      collector.has(MarkdownDiagnosticCodes.LIST_ITEM_BLOCK_UNLISTED),
    ).toBe(true);

    const written = emitMarkdown(lowered);
    // The diagnosed loss: with no list-membership signal anywhere inside the quote, "before" and "after" are no longer recognised as the same item — the quote renders unindented and "after" starts a fresh item.
    expect(written).toBe(
      "- before\n\n> | a | b |\n> | --- | --- |\n> | 1 | 2 |\n\n- after",
    );
  });

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
    const blockCount = 3;
    expect(blocks).toHaveLength(blockCount);
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
    // "foo" and "baz" are the SAME outer item — "baz" resumed the outer item rather than being lazily absorbed into "bar"'s own nested paragraph.
    expect(barBlock.list?.level).toBe(1);
    expect(bazBlock.list?.level).toBe(0);
    expect(bazBlock.list?.itemId).toBe(fooBlock.list?.itemId);
    expect(barBlock.list?.itemId).not.toBe(fooBlock.list?.itemId);
  });

  it("keeps a paragraph and a following ATX heading (the default heading style) TIGHT — an ATX heading always interrupts an open paragraph, in or out of a list", () => {
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

  it("keeps a paragraph and a following MathBlock TIGHT — a $$ line interrupts an open paragraph exactly as a code fence does, in or out of a list", () => {
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

  it("needs no forced blank line between a CodeBlock and a following plain paragraph in the SAME tight list item — a fenced code block's own closing fence terminates cleanly, with nothing left open for the next line to lazily continue", () => {
    const source = doc([
      {
        kind: "paragraph",
        styleId: "CodeBlock",
        runs: [{ text: "x" }],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
      {
        kind: "paragraph",
        runs: [{ text: "y" }],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
    ]);
    expect(emitMarkdown(source)).toBe("- ```\n  x\n  ```\n  y");
  });

  it("needs no forced blank line between a MathBlock and a following plain paragraph in the SAME tight list item — a $$ block's own closing delimiter terminates cleanly", () => {
    const source = doc([
      {
        kind: "paragraph",
        styleId: "MathBlock",
        runs: [{ text: "x" }],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
      {
        kind: "paragraph",
        runs: [{ text: "y" }],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
    ]);
    expect(emitMarkdown(source)).toBe("- $$\n  x\n  $$\n  y");
  });

  it("needs no forced blank line between a HorizontalRule and a following plain paragraph in the SAME tight list item — a thematic break is a single complete line with nothing left open", () => {
    const source = doc([
      {
        kind: "paragraph",
        styleId: "HorizontalRule",
        runs: [],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
      {
        kind: "paragraph",
        runs: [{ text: "y" }],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
    ]);
    expect(emitMarkdown(source, { thematicBreakChar: "*" })).toBe("- ***\n  y");
  });

  it("DOES force a blank line between two plain paragraphs sharing an unrecognised, non-quotable, non-clean-terminating styleId in the same tight list item — src/lower's own reader can only ever have produced this pair from a genuine source blank line, so the write side must reinsert it even though the list itself is tight", () => {
    const source = doc([
      {
        kind: "paragraph",
        styleId: "SomeUnrecognisedStyle",
        runs: [{ text: "a" }],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
      {
        kind: "paragraph",
        runs: [{ text: "b" }],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
    ]);
    expect(emitMarkdown(source)).toBe("- a\n\n  b");
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

  it("keeps two same-level items of DEPTH-ONLY memberships tight, since an absent numId carries no loose flag of its own to read one from", () => {
    expect(
      emitMarkdown(
        doc([
          { kind: "paragraph", runs: [{ text: "a" }], list: { level: 0 } },
          { kind: "paragraph", runs: [{ text: "b" }], list: { level: 0 } },
        ]),
      ),
    ).toBe("- a\n- b");
  });

  it("separates two adjacent lists of DIFFERENT numIds with a blank line even when the first of them is loose, since looseness only decides spacing within one list", () => {
    expect(
      emitMarkdown(
        doc([
          {
            kind: "paragraph",
            runs: [{ text: "a" }],
            list: { numId: "md1:bullet+loose", level: 0 },
          },
          {
            kind: "paragraph",
            runs: [{ text: "b" }],
            list: { numId: "md2:bullet+loose", level: 0 },
          },
        ]),
      ),
    ).toBe("- a\n\n+ b");
  });

  it("does NOT report LIST_NUMID_FALLBACK for a numId this package minted itself", () => {
    const collector = createDiagnosticCollector();
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "a" }],
          list: { numId: "md1:bullet", level: 0 },
        },
      ]),
      { sink: collector.sink },
    );
    expect(markdown).toBe("- a");
    expect(collector.has(MarkdownDiagnosticCodes.LIST_NUMID_FALLBACK)).toBe(
      false,
    );
  });

  it("drops a legacy checkbox glyph run ENTIRELY when the glyph is all that run holds, rather than leaving an empty run behind for the item's own styling to wrap around nothing", () => {
    expect(
      emitMarkdown(
        doc([
          {
            kind: "paragraph",
            runs: [{ text: "☒ ", bold: true }, { text: "done" }],
            list: { numId: "md1:bullet+task", level: 0 },
          },
        ]),
      ),
    ).toBe("- [x] done");
  });

  it("renders a task-flagged item whose first block has no runs at all as a plain marker, with no checkbox sniffed from a leading run that does not exist", () => {
    expect(
      emitMarkdown(
        doc([
          {
            kind: "paragraph",
            runs: [],
            list: { numId: "md1:bullet+task", level: 0 },
          },
        ]),
      ),
    ).toBe("- ");
  });
});

describe("adjacent same-type lists get different marker glyphs (ExaDev/markdown-codec#957)", () => {
  it("alternates the bullet character when two adjacent bullet lists share the configured default", () => {
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "foo" }],
          list: { numId: "md1:bullet", level: 0 },
        },
        {
          kind: "paragraph",
          runs: [{ text: "bar" }],
          list: { numId: "md1:bullet", level: 0 },
        },
        {
          kind: "paragraph",
          runs: [{ text: "baz" }],
          list: { numId: "md2:bullet", level: 0 },
        },
      ]),
    );
    expect(markdown).toBe("- foo\n- bar\n\n+ baz");
  });

  it("alternates the ordered delimiter when two adjacent ordered lists share the configured default, keeping each its own start", () => {
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "foo" }],
          list: { numId: "md1:ordered", level: 0 },
        },
        {
          kind: "paragraph",
          runs: [{ text: "bar" }],
          list: { numId: "md1:ordered", level: 0 },
        },
        {
          kind: "paragraph",
          runs: [{ text: "baz" }],
          list: { numId: "md2:ordered@3", level: 0 },
        },
      ]),
    );
    expect(markdown).toBe("1. foo\n2. bar\n\n3) baz");
  });

  it("alternates back for a third adjacent same-type list rather than drifting through every candidate", () => {
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
          list: { numId: "md2:bullet", level: 0 },
        },
        {
          kind: "paragraph",
          runs: [{ text: "c" }],
          list: { numId: "md3:bullet", level: 0 },
        },
      ]),
    );
    expect(markdown).toBe("- a\n\n+ b\n\n- c");
  });

  it("does not alternate when the two adjacent lists are of different types (bullet then ordered)", () => {
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
          list: { numId: "md2:ordered", level: 0 },
        },
      ]),
    );
    expect(markdown).toBe("- a\n\n1. b");
  });
});
