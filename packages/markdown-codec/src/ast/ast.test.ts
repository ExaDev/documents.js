import { describe, expect, it } from "vitest";
import { isMarkdownBlockNode, isMarkdownInlineNode } from "./ast";
import type { MarkdownNode } from "./ast";

const blockNode: MarkdownNode = { type: "paragraph", children: [] };
const inlineNode: MarkdownNode = { type: "text", value: "hi" };

describe("isMarkdownBlockNode / isMarkdownInlineNode", () => {
  it("classifies a block node as a block and not inline", () => {
    expect(isMarkdownBlockNode(blockNode)).toBe(true);
    expect(isMarkdownInlineNode(blockNode)).toBe(false);
  });

  it("classifies an inline node as inline and not a block", () => {
    expect(isMarkdownBlockNode(inlineNode)).toBe(false);
    expect(isMarkdownInlineNode(inlineNode)).toBe(true);
  });

  it("recognises every real block node type named in the table, not just one representative", () => {
    const types: MarkdownNode["type"][] = [
      "document",
      "paragraph",
      "heading",
      "blockquote",
      "list",
      "listItem",
      "codeBlock",
      "thematicBreak",
      "htmlBlock",
      "table",
      "tableRow",
      "tableCell",
      "mathBlock",
      "footnoteDefinition",
    ];
    for (const type of types) {
      // isMarkdownBlockNode reads only `.type`, so a bare-type fixture is a faithful runtime input; the cast is unavoidable since a real MarkdownNode variant also carries fields (children, value, ...) this loop has no reason to construct per type.
      expect(isMarkdownBlockNode({ type } as MarkdownNode)).toBe(true);
    }
  });
});
