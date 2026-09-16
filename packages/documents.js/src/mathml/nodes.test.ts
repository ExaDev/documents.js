import { describe, expect, it } from "vitest";
import type { MathMlElement, MathMlNode } from "./nodes";
import {
  attrValue,
  elementChildren,
  elementLocalName,
  firstChildByLocalName,
  isMathMlElement,
  localName,
  textContent,
} from "./nodes";

function element(
  tag: string,
  attributes: readonly { name: string; value: string }[] = [],
  children: readonly MathMlNode[] = [],
): MathMlElement {
  return { type: "element", tag, attributes, children };
}

function text(value: string): MathMlNode {
  return { type: "text", value };
}

describe("localName / elementLocalName", () => {
  it("strips a single leading namespace prefix", () => {
    expect(localName("math:mfrac")).toBe("mfrac");
    expect(elementLocalName(element("math:mfrac"))).toBe("mfrac");
  });

  it("leaves an unprefixed tag unchanged", () => {
    expect(localName("mfrac")).toBe("mfrac");
  });
});

describe("attrValue", () => {
  it("finds the value of the attribute matching the requested name, not just the first one present", () => {
    const el = element("mo", [
      { name: "stretchy", value: "false" },
      { name: "fence", value: "true" },
    ]);
    expect(attrValue(el, "fence")).toBe("true");
    expect(attrValue(el, "stretchy")).toBe("false");
  });

  it("returns undefined when no attribute matches", () => {
    expect(
      attrValue(element("mo", [{ name: "fence", value: "true" }]), "missing"),
    ).toBeUndefined();
  });
});

describe("elementChildren", () => {
  it("keeps only element children, skipping text siblings", () => {
    const child = element("mi");
    const node = element("mrow", [], [text("x"), child, text("y")]);
    expect(elementChildren(node)).toEqual([child]);
  });
});

describe("firstChildByLocalName", () => {
  it("finds the first element child whose local name matches, ignoring namespace prefixes", () => {
    const numerator = element("math:mn");
    const denominator = element("math:mn");
    const node = element("mfrac", [], [numerator, denominator]);
    expect(firstChildByLocalName(node, "mn")).toBe(numerator);
  });

  it("returns undefined when no element child has that local name", () => {
    const node = element("mfrac", [], [element("mn")]);
    expect(firstChildByLocalName(node, "mrow")).toBeUndefined();
  });

  it("skips a non-matching child rather than returning it regardless of name", () => {
    const wrong = element("mo");
    const right = element("mi");
    const node = element("mrow", [], [wrong, right]);
    expect(firstChildByLocalName(node, "mi")).toBe(right);
  });
});

describe("isMathMlElement", () => {
  it("distinguishes an element node from a text node", () => {
    expect(isMathMlElement(element("mi"))).toBe(true);
    expect(isMathMlElement(text("x"))).toBe(false);
  });
});

describe("textContent", () => {
  it("returns a text node's own value", () => {
    expect(textContent(text("x"))).toBe("x");
  });

  it("concatenates every descendant text node depth-first, in document order", () => {
    const node = element(
      "mrow",
      [],
      [
        element("mi", [], [text("a")]),
        text("b"),
        element("mo", [], [text("c")]),
      ],
    );
    expect(textContent(node)).toBe("abc");
  });

  it("returns an empty string for a node that is neither text nor element", () => {
    const comment: MathMlNode = { type: "comment" };
    expect(textContent(comment)).toBe("");
  });

  it("returns an empty string for an element with no children, not undefined", () => {
    expect(textContent(element("mspace"))).toBe("");
  });
});
