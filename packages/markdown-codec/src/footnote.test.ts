// GitHub footnotes end to end (ExaDev/markdown-codec#66): the block/inline phases that recognise `[^label]` and `[^label]: body`, the lowering that turns a definition into an `anchor` construct's boundary-marker pair (document-schema.js 4.2.0) and a reference into a marked run, and the writer that renders both back. Deliberately one file across all four stages rather than four scattered additions: the whole point of the feature is that the two halves of a footnote are carried by two DIFFERENT mechanisms and still have to reproduce each other, which no single-stage test can show.
//

import type { ContentBlock, ContentDocument } from "document-schema.js";

import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./block/block";
import { MarkdownDiagnosticCodes } from "./diagnostics/diagnostics";

import { readMarkdownContent } from "./read";
import { createDiagnosticCollector } from "./test-support/diagnostics";

function blocksOf(document: ContentDocument): ContentBlock[] {
  if (document.kind !== "wordprocessing") {
    throw new Error(
      `expected a wordprocessing document, got '${document.kind}'`,
    );
  }
  return document.sections.flatMap((section) => section.blocks);
}

function lowered(source: string): ContentBlock[] {
  return blocksOf(readMarkdownContent(source).document);
}

// One full pass through the public surface and back, twice — see this file's own top-of-file note on why the fixed point, rather than the source text, is what a round trip is measured against here.

describe("reading footnote definitions", () => {
  it("parses a definition as its own block node carrying its label and its body", () => {
    expect(parseMarkdown("[^1]: The note.").document.children).toEqual([
      {
        type: "footnoteDefinition",
        label: "1",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", value: "The note." }],
          },
        ],
      },
    ]);
  });

  it("collects every definition label into the document-global set, before any inline is parsed", () => {
    expect([...parseMarkdown("[^a]: one\n\n[^b]: two").footnotes]).toEqual([
      "a",
      "b",
    ]);
  });

  it("continues a definition body across further indented blocks", () => {
    const [definition] = parseMarkdown(
      "[^1]: First.\n\n    Second.\n\n    - item",
    ).document.children;
    expect(definition).toEqual({
      type: "footnoteDefinition",
      label: "1",
      children: [
        { type: "paragraph", children: [{ type: "text", value: "First." }] },
        { type: "paragraph", children: [{ type: "text", value: "Second." }] },
        {
          type: "list",
          markerType: "bullet",
          bulletMarker: "-",
          tight: true,
          children: [
            {
              type: "listItem",
              children: [
                {
                  type: "paragraph",
                  children: [{ type: "text", value: "item" }],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("ends a definition at a blank line followed by unindented content", () => {
    expect(parseMarkdown("[^1]: note\n\nafter").document.children).toEqual([
      {
        type: "footnoteDefinition",
        label: "1",
        children: [
          { type: "paragraph", children: [{ type: "text", value: "note" }] },
        ],
      },
      { type: "paragraph", children: [{ type: "text", value: "after" }] },
    ]);
  });

  it("continues a definition's own paragraph lazily, exactly as a list item does", () => {
    expect(
      parseMarkdown("[^1]: note\nsame paragraph").document.children,
    ).toEqual([
      {
        type: "footnoteDefinition",
        label: "1",
        children: [
          {
            type: "paragraph",
            children: [
              { type: "text", value: "note" },
              { type: "softBreak" },
              { type: "text", value: "same paragraph" },
            ],
          },
        ],
      },
    ]);
  });

  it("accepts a definition with no body at all", () => {
    expect(parseMarkdown("[^1]:").document.children).toEqual([
      { type: "footnoteDefinition", label: "1", children: [] },
    ]);
  });

  it("does not let a definition interrupt a paragraph", () => {
    expect(
      parseMarkdown("prose\n[^1]: not a definition").document.children,
    ).toEqual([
      {
        type: "paragraph",
        children: [
          { type: "text", value: "prose" },
          { type: "softBreak" },
          { type: "text", value: "[^1]: not a definition" },
        ],
      },
    ]);
  });

  it("recognises a definition directly inside a block quote or a list item (ExaDev/markdown-codec#957)", () => {
    // Both used to stay an ordinary paragraph — see src/block/block.ts's footnoteDefinitionMayOpenIn for why the earlier restriction no longer holds: lowerBlockquote's own dual carry and lowerListItem's own placeholder paragraph (both pre-existing, built for a nested blockquote's division pair) generalise unchanged to a footnote definition's anchor construct pair sitting in the same position.
    expect(parseMarkdown("> [^1]: quoted note text").document.children).toEqual(
      [
        {
          type: "blockquote",
          children: [
            {
              type: "footnoteDefinition",
              label: "1",
              children: [
                {
                  type: "paragraph",
                  children: [{ type: "text", value: "quoted note text" }],
                },
              ],
            },
          ],
        },
      ],
    );
    expect(parseMarkdown("- [^1]: listed note text").document.children).toEqual(
      [
        {
          type: "list",
          markerType: "bullet",
          bulletMarker: "-",
          tight: true,
          children: [
            {
              type: "listItem",
              children: [
                {
                  type: "footnoteDefinition",
                  label: "1",
                  children: [
                    {
                      type: "paragraph",
                      children: [{ type: "text", value: "listed note text" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    );
  });

  it("recognises a definition that follows a list, closing the still-open list rather than folding the definition into a paragraph", () => {
    // continueBlock (src/block/block.ts) reports a `list` node as continued unconditionally, so the container the block-start dispatch sees here is the list itself, not the document — tryFootnoteDefinitionStart has to walk past that before its own document-only restriction applies. Without that walk this whole shape collapses: `[^1]: note` reads as an ordinary paragraph, extractDefinitions swallows it as a LINK reference definition instead, and the note body is gone.
    expect(
      parseMarkdown("Body[^1].\n\n- a\n- b\n\n[^1]: note").document.children,
    ).toEqual([
      {
        type: "paragraph",
        children: [
          { type: "text", value: "Body" },
          { type: "footnoteReference", label: "1" },
          { type: "text", value: "." },
        ],
      },
      {
        type: "list",
        markerType: "bullet",
        bulletMarker: "-",
        tight: true,
        children: [
          {
            type: "listItem",
            children: [
              { type: "paragraph", children: [{ type: "text", value: "a" }] },
            ],
          },
          {
            type: "listItem",
            children: [
              { type: "paragraph", children: [{ type: "text", value: "b" }] },
            ],
          },
        ],
      },
      {
        type: "footnoteDefinition",
        label: "1",
        children: [
          { type: "paragraph", children: [{ type: "text", value: "note" }] },
        ],
      },
    ]);
  });

  it("recognises a definition indented into a list item's own content as that item's own second block (ExaDev/markdown-codec#957)", () => {
    // "[^1]: note" here is indented to the item's own content column, so matchedContainer is the listItem itself — footnoteDefinitionMayOpenIn now accepts that directly, and the definition becomes the item's own second block alongside its first paragraph.
    expect(parseMarkdown("- a\n\n  [^1]: note").document.children).toEqual([
      {
        type: "list",
        markerType: "bullet",
        bulletMarker: "-",
        // Loose, not tight: the item now holds two blocks separated by a blank line, exactly the shape that makes a list loose under CommonMark's own tight/loose rule regardless of what the second block is.
        tight: false,
        children: [
          {
            type: "listItem",
            children: [
              { type: "paragraph", children: [{ type: "text", value: "a" }] },
              {
                type: "footnoteDefinition",
                label: "1",
                children: [
                  {
                    type: "paragraph",
                    children: [{ type: "text", value: "note" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
  });

  it("reports a duplicate label and keeps both definitions as written", () => {
    const collector = createDiagnosticCollector();
    const parsed = parseMarkdown("[^1]: first\n\n[^1]: second", {
      sink: collector.sink,
    });
    expect(
      collector.has(MarkdownDiagnosticCodes.DUPLICATE_FOOTNOTE_DEFINITION),
    ).toBe(true);
    expect(parsed.document.children).toHaveLength(2);
  });

  it("leaves both spellings as ordinary text when footnotes are switched off", () => {
    // A multi-word body deliberately, so the line cannot be read as a LINK reference definition either (`[^1]: note` alone is `[^1]` -> `note`, which is what this package did with the whole shape before footnotes existed).
    expect(
      parseMarkdown("a[^1]\n\n[^1]: note text", { footnotes: false }).document
        .children,
    ).toEqual([
      { type: "paragraph", children: [{ type: "text", value: "a[^1]" }] },
      {
        type: "paragraph",
        children: [{ type: "text", value: "[^1]: note text" }],
      },
    ]);
  });
});

describe("reading footnote references", () => {
  it("parses a reference whose label has a definition somewhere in the document", () => {
    const [paragraph] = parseMarkdown("see[^1] here\n\n[^1]: note").document
      .children;
    expect(paragraph).toEqual({
      type: "paragraph",
      children: [
        { type: "text", value: "see" },
        { type: "footnoteReference", label: "1" },
        { type: "text", value: " here" },
      ],
    });
  });

  it("resolves a reference against a definition that appears later in the document", () => {
    const [paragraph] = parseMarkdown(
      "forward[^late]\n\n[^late]: defined afterwards",
    ).document.children;
    expect(paragraph).toEqual({
      type: "paragraph",
      children: [
        { type: "text", value: "forward" },
        { type: "footnoteReference", label: "late" },
      ],
    });
  });

  it("leaves a label with no definition as ordinary text", () => {
    expect(parseMarkdown("see[^missing] here").document.children).toEqual([
      {
        type: "paragraph",
        children: [{ type: "text", value: "see[^missing] here" }],
      },
    ]);
  });

  it("matches labels exactly, without case folding", () => {
    const [paragraph] = parseMarkdown(
      "a[^Note] b[^note]\n\n[^note]: only the lower-case one is defined",
    ).document.children;
    expect(paragraph).toEqual({
      type: "paragraph",
      children: [
        { type: "text", value: "a[^Note] b" },
        { type: "footnoteReference", label: "note" },
      ],
    });
  });

  it("reads `![^1]` as an exclamation mark followed by a reference, never an image", () => {
    const [paragraph] = parseMarkdown("![^1]\n\n[^1]: note").document.children;
    expect(paragraph).toEqual({
      type: "paragraph",
      children: [
        { type: "text", value: "!" },
        { type: "footnoteReference", label: "1" },
      ],
    });
  });
});

describe("lowering a footnote onto the schema", () => {
  it("lowers a definition to an anchor construct bracketing its own body blocks", () => {
    expect(lowered("[^1]: The note.")).toEqual([
      {
        kind: "constructStart",
        descriptor: { kind: "anchor", anchorType: "footnote", name: "1" },
      },
      { kind: "paragraph", runs: [{ text: "The note." }] },
      { kind: "constructEnd" },
    ]);
  });

  it("carries a multi-block body inside the construct extent", () => {
    expect(lowered("[^1]: One.\n\n    Two.")).toEqual([
      {
        kind: "constructStart",
        descriptor: { kind: "anchor", anchorType: "footnote", name: "1" },
      },
      { kind: "paragraph", runs: [{ text: "One." }] },
      { kind: "paragraph", runs: [{ text: "Two." }] },
      { kind: "constructEnd" },
    ]);
  });

  it("lowers a bodyless definition to a point anchor — a pair with nothing between it", () => {
    expect(lowered("[^1]:")).toEqual([
      {
        kind: "constructStart",
        descriptor: { kind: "anchor", anchorType: "footnote", name: "1" },
      },
      { kind: "constructEnd" },
    ]);
  });

  it("lowers a reference to an ordinary run plus a point run-level anchor extent naming it", () => {
    const document = readMarkdownContent("see[^1]\n\n[^1]: note").document;
    expect(blocksOf(document)[0]).toEqual({
      kind: "paragraph",
      runs: [{ text: "see" }, { text: "[^1]" }],
      constructs: [
        {
          descriptor: { kind: "anchor", anchorType: "footnote", name: "1" },
          startRun: 1,
          endRun: 1,
        },
      ],
    });
  });

  it("carries a reference inside a link as one run of that link, extent and all", () => {
    expect(
      blocksOf(readMarkdownContent("[text[^1]](/u)\n\n[^1]: note").document)[0],
    ).toEqual({
      kind: "paragraph",
      runs: [
        { text: "text", hyperlink: "/u" },
        { text: "[^1]", hyperlink: "/u" },
      ],
      constructs: [
        {
          descriptor: { kind: "anchor", anchorType: "footnote", name: "1" },
          startRun: 1,
          endRun: 1,
        },
      ],
    });
  });

  it("counts footnote-reference extents among the paragraph's constructs in walk order, beside a titled link's own extent", () => {
    const [first] = blocksOf(
      readMarkdownContent('a[^1] and [b](/u "t")\n\n[^1]: note').document,
    );
    if (first?.kind !== "paragraph") {
      throw new Error(
        `expected a paragraph block, got '${first?.kind ?? "none"}'`,
      );
    }
    expect(first.constructs).toEqual([
      {
        descriptor: { kind: "anchor", anchorType: "footnote", name: "1" },
        startRun: 1,
        endRun: 1,
      },
      {
        descriptor: {
          kind: "link",
          target: { kind: "external", uri: "/u" },
          title: "t",
        },
        startRun: 3,
        endRun: 4,
      },
    ]);
  });

  it("keeps a heading inside a definition body as a real heading (ExaDev/document-schema.js#1122)", () => {
    const document = readMarkdownContent(
      "[^1]: intro\n\n    ## inner",
    ).document;
    expect(blocksOf(document)).toEqual([
      {
        kind: "constructStart",
        descriptor: { kind: "anchor", anchorType: "footnote", name: "1" },
      },
      { kind: "paragraph", runs: [{ text: "intro" }] },
      {
        kind: "paragraph",
        runs: [{ text: "inner" }],
        styleId: "Heading2",
        headingLevel: 2,
      },
      { kind: "constructEnd" },
    ]);
  });

  it("leaves every construct marker pair balanced, which is what the schema requires of a producer", () => {
    const blocks = lowered("a[^x]\n\n[^x]: one\n\n    two\n\n[^y]: another");
    const opens = blocks.filter(
      (block) => block.kind === "constructStart",
    ).length;
    const closes = blocks.filter(
      (block) => block.kind === "constructEnd",
    ).length;
    expect(opens).toBe(closes);
  });

  it("nests a definition directly inside a block quote inside the quote's own division pair, dual-carried like any other quoted paragraph (ExaDev/markdown-codec#957)", () => {
    expect(lowered("> [^1]: quoted note.")).toEqual([
      { kind: "constructStart", descriptor: { kind: "division" } },
      {
        kind: "constructStart",
        descriptor: { kind: "anchor", anchorType: "footnote", name: "1" },
      },
      {
        kind: "paragraph",
        runs: [{ text: "quoted note." }],
        indentLeftPt: 36,
        styleId: "Quote",
      },
      { kind: "constructEnd" },
      { kind: "constructEnd" },
    ]);
  });

  it("nests a definition directly inside a list item behind the SAME empty-paragraph placeholder a blockquote's own division pair already needed there (ExaDev/markdown-codec#957)", () => {
    const blocks = lowered("- [^1]: listed note.");
    const placeholder = blocks[0];
    if (placeholder?.kind !== "paragraph") {
      throw new Error(
        `expected a placeholder paragraph, got '${placeholder?.kind}'`,
      );
    }
    const itemId = placeholder.list?.itemId;
    expect(typeof itemId).toBe("string");
    expect(placeholder).toEqual({
      kind: "paragraph",
      runs: [],
      list: { numId: "md1:bullet", level: 0, itemId },
    });
    expect(blocks[1]).toEqual({
      kind: "constructStart",
      descriptor: { kind: "anchor", anchorType: "footnote", name: "1" },
    });
    const body = blocks[2];
    if (body?.kind !== "paragraph") {
      throw new Error(`expected a paragraph body block, got '${body?.kind}'`);
    }
    // The item's own membership is carried straight through the footnote's own body paragraph — the same dual carry lowerBlockquote already threads through a quote's own children — so src/emit's constructCarriesListItemId recognises the anchor construct as belonging to this item rather than fracturing it out as separate top-level content.
    expect(body.list?.itemId).toBe(placeholder.list?.itemId);
    expect(blocks[3]).toEqual({ kind: "constructEnd" });
  });
});
