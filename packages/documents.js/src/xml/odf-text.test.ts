import type { XmlNode } from "ooxml.js";
import { describe, expect, it } from "vitest";
import { decodeOdfText, encodeOdfText } from "./odf-text";

// The wrong behaviour decodeOdfText exists specifically to avoid: a naive concatenation of ONLY XmlText nodes, exactly what ooxml.js's own textContent() helper does and exactly why this codebase's own top-of-file warning in odf-text.ts forbids using it on ODF content. Defined only for the one regression test below, never exported.
function naiveTextNodeOnlyConcat(nodes: readonly XmlNode[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text") {
      out += node.value;
    }
  }
  return out;
}

describe("encodeOdfText", () => {
  it("keeps a single space as a literal text-node character", () => {
    expect(encodeOdfText(" ")).toEqual([{ type: "text", value: " " }]);
  });

  it("encodes a run of exactly 2 spaces as text:s", () => {
    expect(encodeOdfText("  ")).toEqual([
      {
        type: "element",
        tag: "text:s",
        attributes: [{ name: "text:c", value: "2" }],
        children: [],
      },
    ]);
  });

  it("encodes a run of 3 spaces as text:s", () => {
    expect(encodeOdfText("   ")).toEqual([
      {
        type: "element",
        tag: "text:s",
        attributes: [{ name: "text:c", value: "3" }],
        children: [],
      },
    ]);
  });

  it("encodes a run of 10 spaces as text:s", () => {
    expect(encodeOdfText(" ".repeat(10))).toEqual([
      {
        type: "element",
        tag: "text:s",
        attributes: [{ name: "text:c", value: "10" }],
        children: [],
      },
    ]);
  });

  it("encodes a tab as text:tab", () => {
    expect(encodeOdfText("\t")).toEqual([
      { type: "element", tag: "text:tab", attributes: [], children: [] },
    ]);
  });

  it("encodes a newline as text:line-break", () => {
    expect(encodeOdfText("\n")).toEqual([
      { type: "element", tag: "text:line-break", attributes: [], children: [] },
    ]);
  });

  it("encodes an empty string as no nodes at all", () => {
    expect(encodeOdfText("")).toEqual([]);
  });

  it("encodes a mixed sequence, coalescing adjacent literal runs into as few text nodes as practical", () => {
    const nodes = encodeOdfText("a  b\tc\nd");
    expect(nodes).toEqual([
      { type: "text", value: "a" },
      {
        type: "element",
        tag: "text:s",
        attributes: [{ name: "text:c", value: "2" }],
        children: [],
      },
      { type: "text", value: "b" },
      { type: "element", tag: "text:tab", attributes: [], children: [] },
      { type: "text", value: "c" },
      { type: "element", tag: "text:line-break", attributes: [], children: [] },
      { type: "text", value: "d" },
    ]);
  });

  it("coalesces a long run of plain characters (including single spaces) into one text node, not one per character", () => {
    const nodes = encodeOdfText("a b c");
    expect(nodes).toEqual([{ type: "text", value: "a b c" }]);
  });

  it("XML-encodes literal text content", () => {
    expect(encodeOdfText("Tom & Jerry")).toEqual([
      { type: "text", value: "Tom &amp; Jerry" },
    ]);
  });
});

describe("decodeOdfText", () => {
  it("is the exact inverse of encodeOdfText for single spaces, space runs, tabs, newlines, and mixed sequences", () => {
    for (const value of [
      " ",
      "  ",
      "   ",
      " ".repeat(10),
      "\t",
      "\n",
      "a  b\tc\nd",
      "",
      "plain text",
      "a b c",
    ]) {
      expect(decodeOdfText(encodeOdfText(value))).toBe(value);
    }
  });

  it("decodes a pre-existing text:s with no text:c attribute as a single space, per the ODF default", () => {
    expect(
      decodeOdfText([
        { type: "element", tag: "text:s", attributes: [], children: [] },
      ]),
    ).toBe(" ");
  });

  it("recurses into a nested text:span", () => {
    const nodes: XmlNode[] = [
      { type: "text", value: "a" },
      {
        type: "element",
        tag: "text:span",
        attributes: [{ name: "text:style-name", value: "T1" }],
        children: [{ type: "text", value: "b" }],
      },
      { type: "text", value: "c" },
    ];
    expect(decodeOdfText(nodes)).toBe("abc");
  });

  // The concrete, undeniable proof this module exists to guard against: decodeOdfText must recover the FULL original string, while a naive plain-text-node-only concatenation -- exactly what ooxml.js's own textContent() does -- silently produces a shorter, corrupted result by dropping every text:s/text:tab/text:line-break element entirely. Both a correctness assertion and a length assertion, so the corruption is undeniable, not just implicit.
  it("regression: recovers the full string, unlike a naive text-node-only concatenation which silently corrupts it", () => {
    const original = "a  b\tc";
    const nodes = encodeOdfText(original);

    const correct = decodeOdfText(nodes);
    expect(correct).toBe(original);
    expect(correct).toHaveLength(6);

    const corrupted = naiveTextNodeOnlyConcat(nodes);
    expect(corrupted).toBe("abc");
    expect(corrupted).toHaveLength(3);
    expect(corrupted).not.toBe(original);
    expect(corrupted.length).toBeLessThan(correct.length);
  });
});
