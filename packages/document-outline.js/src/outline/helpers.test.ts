import { describe, expect, it } from "vitest";
import type { ContentParagraph } from "document-schema.js";
import { buildOutline } from "./build";
import { effectivePackage } from "./effective";
import { flattenOutline, leafContentHash, outlineLeafText } from "./helpers";
import {
  embeddedObject,
  formulaPackage,
  headingGroup,
  imageBlock,
  listGroup,
  pageBreak,
  paragraph,
  sectionGroup,
  table,
  vectorLine,
  wordprocessingPackage,
} from "../test-support/fixtures";

describe("flattenOutline", () => {
  it("flattens to leaves in document order, skipping group nodes", () => {
    const before = paragraph("before");
    const nestedTable = table([["cell"]]);
    const after = paragraph("after");
    const pkg = wordprocessingPackage([
      sectionGroup([
        before,
        headingGroup("Chapter", 1, [
          listGroup("A", 0, [listGroup("B", 1, [nestedTable])]),
          headingGroup("Section", 2, [after]),
        ]),
      ]),
    ]);
    // The table attaches at the current depth -- under list item B -- and the heading group pops the list nesting back under the chapter, so document order is before, the table, then after.
    expect(flattenOutline(buildOutline(pkg))).toEqual([
      before,
      nestedTable,
      after,
    ]);
  });

  it("returns an empty array for an outline of empty groups", () => {
    const pkg = wordprocessingPackage([
      sectionGroup([
        headingGroup("Chapter", 1, [headingGroup("Section", 2, [])]),
      ]),
    ]);
    expect(flattenOutline(buildOutline(pkg))).toEqual([]);
  });
});

describe("outlineLeafText", () => {
  it("concatenates a paragraph run texts with no separator", () => {
    const leaf: ContentParagraph = {
      kind: "paragraph",
      runs: [{ text: "Hello " }, { text: "world" }],
    };
    expect(outlineLeafText(leaf)).toBe("Hello world");
  });

  it("joins table cell paragraphs within a row by space and rows by newline", () => {
    expect(
      outlineLeafText(
        table([
          ["a", "b"],
          ["c", "d"],
        ]),
      ),
    ).toBe("a b\nc d");
  });

  it("returns an image altText, empty when absent", () => {
    expect(outlineLeafText(imageBlock("A chart"))).toBe("A chart");
    expect(outlineLeafText(imageBlock())).toBe("");
  });

  it("returns the empty string for the textless leaves", () => {
    expect(outlineLeafText(pageBreak())).toBe("");
    expect(outlineLeafText(embeddedObject())).toBe("");
    expect(outlineLeafText(vectorLine())).toBe("");
  });

  it("returns a formula LaTeX linearisation, empty when absent", () => {
    const withLatex = formulaPackage("x^2");
    if (withLatex.kind !== "formula") throw new Error("unreachable");
    expect(outlineLeafText(withLatex.children[0]!)).toBe("x^2");
    const bare = formulaPackage();
    if (bare.kind !== "formula") throw new Error("unreachable");
    expect(outlineLeafText(bare.children[0]!)).toBe("");
  });
});

describe("leafContentHash", () => {
  it("hashes independently constructed identical content identically regardless of key order", () => {
    const first = paragraph("same text");
    const second: ContentParagraph = {
      runs: [{ text: "same text" }],
      kind: "paragraph",
    };
    expect(leafContentHash(first)).toBe(leafContentHash(second));
  });

  it("is deterministic across repeated calls", () => {
    const leaf = paragraph("same text");
    expect(leafContentHash(leaf)).toBe(leafContentHash(leaf));
  });

  it("differs when the content differs", () => {
    expect(leafContentHash(paragraph("a"))).not.toBe(
      leafContentHash(paragraph("b")),
    );
    const styled: ContentParagraph = {
      kind: "paragraph",
      runs: [{ text: "same text", bold: true }],
    };
    expect(leafContentHash(paragraph("same text"))).not.toBe(
      leafContentHash(styled),
    );
  });

  it("treats an explicitly undefined optional field as absent", () => {
    const first = paragraph("same text");
    const second: ContentParagraph = {
      kind: "paragraph",
      runs: [{ text: "same text" }],
      styleId: undefined,
    };
    expect(leafContentHash(first)).toBe(leafContentHash(second));
  });

  it("names the document, not the factoring: a resolved leaf hashes equal to its unfactored twin", () => {
    // Law ii at the hash layer: the factored package styles its heading anchor via a styles-table ref, the unfactored twin carries the same properties inline on the paragraph, and after effectivePackage both leaves are identical -- so their hashes are.
    const entry = { paragraph: { indentLeftPt: 24 } };
    const factored = wordprocessingPackage(
      [
        sectionGroup([
          headingGroup("Chapter", 1, [paragraph("body")], {
            style: "body-text",
          }),
        ]),
      ],
      { styles: { "body-text": entry } },
    );
    const unfactored = wordprocessingPackage([
      sectionGroup([
        {
          node: {
            kind: "paragraph",
            runs: [{ text: "Chapter" }],
            headingLevel: 1,
            indentLeftPt: 24,
          },
          children: [paragraph("body", { indentLeftPt: 24 })],
        },
      ]),
    ]);
    const resolvedLeaf = flattenOutline(
      buildOutline(effectivePackage(factored)),
    )[0];
    const twinLeaf = flattenOutline(buildOutline(unfactored))[0];
    expect(leafContentHash(resolvedLeaf!)).toBe(leafContentHash(twinLeaf!));
  });
});
