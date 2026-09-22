import { describe, expect, it } from "vitest";
import { isXmlNode } from "./node";

// isXmlNode is a hand-written recursive structural guard (used via z.custom, since a genuinely recursive Zod schema collapses to `unknown` under z.lazy in this pinned version) with no direct unit tests at all — every place it runs is exercised only as a side effect of parsing a real XML document, which never constructs the malformed shapes below.

describe("isXmlNode: non-object/malformed input", () => {
  it("rejects null, a primitive, and an array outright", () => {
    expect(isXmlNode(null)).toBe(false);
    expect(isXmlNode("a string")).toBe(false);
    expect(isXmlNode(42)).toBe(false);
    expect(isXmlNode([])).toBe(false);
  });

  it("rejects a plain object with no type field", () => {
    expect(isXmlNode({})).toBe(false);
  });

  it("rejects an unrecognised type value", () => {
    expect(isXmlNode({ type: "bogus" })).toBe(false);
  });

  it("rejects an unrecognised type value even when the rest of the object is shaped exactly like a valid element", () => {
    expect(
      isXmlNode({ type: "bogus", tag: "text:p", attributes: [], children: [] }),
    ).toBe(false);
  });

  it('rejects a non-object value whose typeof is not "object" (a function) even when it carries otherwise-valid text-node properties', () => {
    const fn = Object.assign(() => {}, { type: "text", value: "hi" });
    expect(isXmlNode(fn)).toBe(false);
  });
});

describe("isXmlNode: text/cdata/comment", () => {
  it.each(["text", "cdata", "comment"] as const)(
    "accepts type %s with a string value",
    (type) => {
      expect(isXmlNode({ type, value: "hello" })).toBe(true);
    },
  );

  it.each(["text", "cdata", "comment"] as const)(
    "rejects type %s when value is not a string",
    (type) => {
      expect(isXmlNode({ type, value: 5 })).toBe(false);
      expect(isXmlNode({ type })).toBe(false);
    },
  );
});

describe("isXmlNode: declaration", () => {
  it("accepts a declaration with an empty attributes array", () => {
    expect(isXmlNode({ type: "declaration", attributes: [] })).toBe(true);
  });

  it("accepts a declaration whose every attribute is a valid {name, value} pair", () => {
    expect(
      isXmlNode({
        type: "declaration",
        attributes: [{ name: "version", value: "1.0" }],
      }),
    ).toBe(true);
  });

  it("rejects a declaration whose attributes is not an array", () => {
    expect(isXmlNode({ type: "declaration", attributes: "nope" })).toBe(false);
  });

  it("rejects a declaration whose attribute has a non-string name but a valid string value", () => {
    expect(
      isXmlNode({
        type: "declaration",
        attributes: [{ name: 5, value: "1.0" }],
      }),
    ).toBe(false);
  });

  it("rejects a declaration with one malformed attribute among otherwise-valid ones", () => {
    expect(
      isXmlNode({
        type: "declaration",
        attributes: [
          { name: "version", value: "1.0" },
          { name: "encoding" }, // missing value
        ],
      }),
    ).toBe(false);
  });
});

describe("isXmlNode: pi", () => {
  it("accepts a pi with string target and content", () => {
    expect(
      isXmlNode({ type: "pi", target: "xml-stylesheet", content: "foo" }),
    ).toBe(true);
  });

  it("rejects a pi missing either target or content", () => {
    expect(isXmlNode({ type: "pi", target: "x" })).toBe(false);
    expect(isXmlNode({ type: "pi", content: "x" })).toBe(false);
  });

  it("rejects a pi whose target or content is not a string", () => {
    expect(isXmlNode({ type: "pi", target: 1, content: "x" })).toBe(false);
    expect(isXmlNode({ type: "pi", target: "x", content: 1 })).toBe(false);
  });
});

describe("isXmlNode: element", () => {
  function validElement(overrides: Record<string, unknown> = {}) {
    return {
      type: "element",
      tag: "text:p",
      attributes: [],
      children: [],
      ...overrides,
    };
  }

  it("accepts a leaf element with no attributes or children", () => {
    expect(isXmlNode(validElement())).toBe(true);
  });

  it("rejects an element whose tag is not a string", () => {
    expect(isXmlNode(validElement({ tag: 5 }))).toBe(false);
  });

  it("rejects an element whose attributes is not an array", () => {
    expect(isXmlNode(validElement({ attributes: "nope" }))).toBe(false);
  });

  it("rejects an element with one malformed attribute", () => {
    expect(isXmlNode(validElement({ attributes: [{ name: "x" }] }))).toBe(
      false,
    );
  });

  it("rejects an element whose children is not an array", () => {
    expect(isXmlNode(validElement({ children: "nope" }))).toBe(false);
  });

  it("accepts an element whose children are all valid nodes, recursively", () => {
    const child = { type: "text", value: "hi" };
    expect(isXmlNode(validElement({ children: [child] }))).toBe(true);
  });

  it("rejects an element with one malformed child among otherwise-valid ones", () => {
    const goodChild = { type: "text", value: "hi" };
    const badChild = { type: "text", value: 5 };
    expect(isXmlNode(validElement({ children: [goodChild, badChild] }))).toBe(
      false,
    );
  });

  it("rejects an element nested two levels deep whose innermost grandchild is malformed", () => {
    const malformedGrandchild = { type: "comment", value: 5 };
    const child = {
      type: "element",
      tag: "text:span",
      attributes: [],
      children: [malformedGrandchild],
    };
    expect(isXmlNode(validElement({ children: [child] }))).toBe(false);
  });

  it("accepts an element nested two levels deep whose every descendant is well-formed", () => {
    const grandchild = { type: "text", value: "deep" };
    const child = {
      type: "element",
      tag: "text:span",
      attributes: [],
      children: [grandchild],
    };
    expect(isXmlNode(validElement({ children: [child] }))).toBe(true);
  });
});
