import { describe, expect, it } from "vitest";
import { isXmlNode } from "./node";

describe("isXmlNode: non-record inputs", () => {
  it("is false for null, even though typeof null === 'object'", () => {
    expect(isXmlNode(null)).toBe(false);
  });

  it("is false for an array, even though arrays are typeof 'object'", () => {
    expect(isXmlNode([])).toBe(false);
    expect(isXmlNode([{ type: "text", value: "x" }])).toBe(false);
  });

  it("is false for a primitive", () => {
    expect(isXmlNode(42)).toBe(false);
    expect(isXmlNode("x")).toBe(false);
    expect(isXmlNode(undefined)).toBe(false);
  });

  it("is false for a plain object naming no recognised type at all", () => {
    expect(isXmlNode({})).toBe(false);
    expect(isXmlNode({ type: "unknown" })).toBe(false);
  });

  it("is false for an unrecognised type even when the value otherwise carries every field a valid element needs", () => {
    // Proves the "element" branch is reached only when type === "element", not merely because the value happens to shape-match an element -- a value shaped exactly like a valid element under an unrecognised type name must still fall through to the final `return false`.
    expect(
      isXmlNode({ type: "unknown", tag: "a", attributes: [], children: [] }),
    ).toBe(false);
  });
});

describe("isXmlNode: text/cdata/comment", () => {
  it("is true for a well-formed text, cdata, or comment node", () => {
    expect(isXmlNode({ type: "text", value: "x" })).toBe(true);
    expect(isXmlNode({ type: "cdata", value: "x" })).toBe(true);
    expect(isXmlNode({ type: "comment", value: "x" })).toBe(true);
  });

  it("is false when 'value' is not a string", () => {
    expect(isXmlNode({ type: "text", value: 42 })).toBe(false);
    expect(isXmlNode({ type: "text" })).toBe(false);
  });
});

describe("isXmlNode: declaration", () => {
  it("is true for a declaration with a well-formed (possibly empty) attributes array", () => {
    expect(isXmlNode({ type: "declaration", attributes: [] })).toBe(true);
    expect(
      isXmlNode({
        type: "declaration",
        attributes: [{ name: "version", value: "1.0" }],
      }),
    ).toBe(true);
  });

  it("is false when 'attributes' is not an array at all", () => {
    expect(isXmlNode({ type: "declaration", attributes: {} })).toBe(false);
    expect(isXmlNode({ type: "declaration" })).toBe(false);
  });

  it("is false when any attribute in the array is malformed", () => {
    expect(
      isXmlNode({ type: "declaration", attributes: ["not an object"] }),
    ).toBe(false);
    expect(
      isXmlNode({
        type: "declaration",
        attributes: [{ name: 42, value: "1.0" }],
      }),
    ).toBe(false);
    expect(
      isXmlNode({
        type: "declaration",
        attributes: [{ name: "version", value: 42 }],
      }),
    ).toBe(false);
  });
});

describe("isXmlNode: pi", () => {
  it("is true for a well-formed processing instruction", () => {
    expect(isXmlNode({ type: "pi", target: "custom", content: "x" })).toBe(
      true,
    );
  });

  it("is false when 'target' is not a string", () => {
    expect(isXmlNode({ type: "pi", target: 42, content: "x" })).toBe(false);
  });

  it("is false when 'content' is not a string", () => {
    expect(isXmlNode({ type: "pi", target: "custom", content: 42 })).toBe(
      false,
    );
  });
});

describe("isXmlNode: element", () => {
  const validAttributes = [{ name: "id", value: "1" }];
  const validChildren = [{ type: "text", value: "x" }];

  it("is true for a well-formed element with attributes and children", () => {
    expect(
      isXmlNode({
        type: "element",
        tag: "a",
        attributes: validAttributes,
        children: validChildren,
      }),
    ).toBe(true);
  });

  it("is true for a well-formed element with empty attributes and children", () => {
    expect(
      isXmlNode({ type: "element", tag: "a", attributes: [], children: [] }),
    ).toBe(true);
  });

  it("is false when 'tag' is not a string", () => {
    expect(
      isXmlNode({
        type: "element",
        tag: 42,
        attributes: [],
        children: [],
      }),
    ).toBe(false);
  });

  it("is false when 'attributes' is not an array", () => {
    expect(
      isXmlNode({
        type: "element",
        tag: "a",
        attributes: {},
        children: [],
      }),
    ).toBe(false);
  });

  it("is false when any attribute in 'attributes' is malformed", () => {
    expect(
      isXmlNode({
        type: "element",
        tag: "a",
        attributes: [{ name: "id" }],
        children: [],
      }),
    ).toBe(false);
  });

  it("is false when 'children' is not an array", () => {
    expect(
      isXmlNode({
        type: "element",
        tag: "a",
        attributes: [],
        children: {},
      }),
    ).toBe(false);
  });

  it("is false when any child in 'children' does not itself satisfy isXmlNode, proving the check recurses", () => {
    expect(
      isXmlNode({
        type: "element",
        tag: "a",
        attributes: [],
        children: [{ type: "text", value: 42 }],
      }),
    ).toBe(false);
  });

  it("is true for a nested element whose own child is itself a well-formed element", () => {
    expect(
      isXmlNode({
        type: "element",
        tag: "outer",
        attributes: [],
        children: [
          { type: "element", tag: "inner", attributes: [], children: [] },
        ],
      }),
    ).toBe(true);
  });
});
