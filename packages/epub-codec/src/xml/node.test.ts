import { describe, expect, it } from "vitest";
import { isTextLikeNode, isXmlNode } from "./node";

describe("isXmlNode", () => {
  it("rejects null", () => {
    expect(isXmlNode(null)).toBe(false);
  });

  it("rejects an array", () => {
    expect(isXmlNode([])).toBe(false);
  });

  it("rejects a non-object primitive", () => {
    expect(isXmlNode("not a node")).toBe(false);
    expect(isXmlNode(5)).toBe(false);
  });

  it("rejects an object with an unrecognised type", () => {
    expect(isXmlNode({ type: "unknown" })).toBe(false);
  });

  it("rejects an object with an unrecognised type even when it otherwise has every field an element node would need", () => {
    expect(
      isXmlNode({
        type: "unrecognised",
        tag: "div",
        attributes: [],
        children: [],
      }),
    ).toBe(false);
  });

  it("rejects a value whose typeof is not object even when it carries every property a text node would need", () => {
    // A function value with `type`/`value` properties bolted on directly, deliberately keeping `typeof fnMasqueradingAsText === "function"` -- Object.assign/spread would either lose that (spreading into a plain object) or bypass type checking on the source, so the properties are set one at a time on a value cast to the shape isXmlNode expects a text node to have.
    const fnMasqueradingAsText = (() => {}) as unknown as {
      type: string;
      value: string;
    };
    fnMasqueradingAsText.type = "text";
    fnMasqueradingAsText.value = "hi";
    expect(isXmlNode(fnMasqueradingAsText)).toBe(false);
  });

  it("accepts a text node with a string value", () => {
    expect(isXmlNode({ type: "text", value: "hello" })).toBe(true);
  });

  it("rejects a text node whose value is not a string", () => {
    expect(isXmlNode({ type: "text", value: 5 })).toBe(false);
  });

  it("accepts a cdata node with a string value", () => {
    expect(isXmlNode({ type: "cdata", value: "raw" })).toBe(true);
  });

  it("rejects a cdata node whose value is not a string", () => {
    expect(isXmlNode({ type: "cdata", value: 5 })).toBe(false);
  });

  it("accepts a comment node with a string value", () => {
    expect(isXmlNode({ type: "comment", value: "note" })).toBe(true);
  });

  it("rejects a comment node whose value is not a string", () => {
    expect(isXmlNode({ type: "comment", value: 5 })).toBe(false);
  });

  it("accepts a declaration node whose attributes are all well-formed", () => {
    expect(
      isXmlNode({
        type: "declaration",
        attributes: [{ name: "version", value: "1.0" }],
      }),
    ).toBe(true);
  });

  it("accepts a declaration node with no attributes at all", () => {
    expect(isXmlNode({ type: "declaration", attributes: [] })).toBe(true);
  });

  it("rejects a declaration node whose attributes is not an array", () => {
    expect(isXmlNode({ type: "declaration", attributes: "not-an-array" })).toBe(
      false,
    );
  });

  it("rejects a declaration node with one malformed attribute among well-formed ones", () => {
    expect(
      isXmlNode({
        type: "declaration",
        attributes: [{ name: "version", value: "1.0" }, { name: 5 }],
      }),
    ).toBe(false);
  });

  it("accepts a pi node with string target and content", () => {
    expect(isXmlNode({ type: "pi", target: "t", content: "c" })).toBe(true);
  });

  it("rejects a pi node whose target is not a string", () => {
    expect(isXmlNode({ type: "pi", target: 5, content: "c" })).toBe(false);
  });

  it("rejects a pi node whose content is not a string", () => {
    expect(isXmlNode({ type: "pi", target: "t", content: 5 })).toBe(false);
  });

  it("accepts an element node with well-formed attributes and children", () => {
    expect(
      isXmlNode({
        type: "element",
        tag: "p",
        attributes: [{ name: "class", value: "note" }],
        children: [{ type: "text", value: "hi" }],
      }),
    ).toBe(true);
  });

  it("accepts an element node with no attributes and no children", () => {
    expect(
      isXmlNode({ type: "element", tag: "br", attributes: [], children: [] }),
    ).toBe(true);
  });

  it("rejects an element node whose tag is not a string", () => {
    expect(
      isXmlNode({ type: "element", tag: 5, attributes: [], children: [] }),
    ).toBe(false);
  });

  it("rejects an element node whose attributes is not an array", () => {
    expect(
      isXmlNode({
        type: "element",
        tag: "p",
        attributes: "nope",
        children: [],
      }),
    ).toBe(false);
  });

  it("rejects an element node with a malformed attribute", () => {
    expect(
      isXmlNode({
        type: "element",
        tag: "p",
        attributes: [{ name: 5, value: "x" }],
        children: [],
      }),
    ).toBe(false);
  });

  it("rejects an element node whose attribute has a well-formed name but a non-string value", () => {
    expect(
      isXmlNode({
        type: "element",
        tag: "p",
        attributes: [{ name: "id", value: 5 }],
        children: [],
      }),
    ).toBe(false);
  });

  it("rejects an element node whose children is not an array", () => {
    expect(
      isXmlNode({
        type: "element",
        tag: "p",
        attributes: [],
        children: "nope",
      }),
    ).toBe(false);
  });

  it("rejects an element node whose children contains a malformed node (recursive check)", () => {
    expect(
      isXmlNode({
        type: "element",
        tag: "p",
        attributes: [],
        children: [{ type: "text", value: 5 }],
      }),
    ).toBe(false);
  });

  it("rejects an element node whose children contains a well-formed sibling followed by a malformed one", () => {
    expect(
      isXmlNode({
        type: "element",
        tag: "p",
        attributes: [],
        children: [{ type: "text", value: "ok" }, { type: "unknown" }],
      }),
    ).toBe(false);
  });
});

describe("isTextLikeNode", () => {
  it("is true for a text node", () => {
    expect(isTextLikeNode({ type: "text", value: "x" })).toBe(true);
  });

  it("is true for a cdata node", () => {
    expect(isTextLikeNode({ type: "cdata", value: "x" })).toBe(true);
  });

  it("is false for a comment node", () => {
    expect(isTextLikeNode({ type: "comment", value: "x" })).toBe(false);
  });

  it("is false for an element node", () => {
    expect(
      isTextLikeNode({
        type: "element",
        tag: "p",
        attributes: [],
        children: [],
      }),
    ).toBe(false);
  });
});
