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

describe("lists (continued further)", () => {
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
