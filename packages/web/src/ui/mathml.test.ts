import type { MathMlNode } from "documents.js";
import { describe, expect, it } from "vitest";

import { appendMathMlNodes, MATHML_NS } from "./mathml";

function render(nodes: readonly MathMlNode[]): Element {
  const parent = document.createElementNS(MATHML_NS, "math");
  appendMathMlNodes(parent, nodes);
  return parent;
}

function text(value: string): MathMlNode {
  return { type: "text", value };
}

function element(
  tag: string,
  children: readonly MathMlNode[] = [],
  attributes: readonly { name: string; value: string }[] = [],
): MathMlNode {
  return {
    type: "element",
    tag,
    attributes: [...attributes],
    children: [...children],
  };
}

describe("appendMathMlNodes", () => {
  it("appends a text node as a real DOM text node", () => {
    const parent = render([text("2")]);
    expect(parent.childNodes.length).toBe(1);
    expect(parent.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    expect(parent.textContent).toBe("2");
  });

  it("appends an element node with its attributes and recurses into its children", () => {
    const parent = render([
      element("mn", [text("3")], [{ name: "mathvariant", value: "bold" }]),
    ]);
    const child = parent.firstElementChild;
    expect(child).not.toBeNull();
    expect(child?.namespaceURI).toBe(MATHML_NS);
    expect(child?.tagName).toBe("mn");
    expect(child?.getAttribute("mathvariant")).toBe("bold");
    expect(child?.textContent).toBe("3");
  });

  it("strips a namespace prefix from an element's tag", () => {
    const parent = render([element("math:mfrac")]);
    expect(parent.firstElementChild?.tagName).toBe("mfrac");
  });

  it("leaves an unprefixed tag untouched", () => {
    const parent = render([element("mfrac")]);
    expect(parent.firstElementChild?.tagName).toBe("mfrac");
  });

  it("skips an <annotation> element entirely, including its children, rather than displaying its encoded content", () => {
    const parent = render([element("annotation", [text("should not appear")])]);
    expect(parent.childNodes.length).toBe(0);
  });

  const NON_DISPLAYABLE_NODES: readonly (readonly [string, MathMlNode])[] = [
    ["cdata", { type: "cdata" }],
    ["comment", { type: "comment" }],
    ["declaration", { type: "declaration" }],
    ["pi", { type: "pi" }],
  ];

  it.each(NON_DISPLAYABLE_NODES)(
    "renders no displayable content for a %s node",
    (_kind, node) => {
      const parent = render([node]);
      expect(parent.childNodes.length).toBe(0);
    },
  );

  it("renders sibling nodes in order, skipping non-displayable ones in between", () => {
    const parent = render([text("a"), { type: "comment" }, text("b")]);
    expect(parent.textContent).toBe("ab");
  });
});
