import { describe, expect, it } from "vitest";
import { el, txt, xmlDeclaration } from "./ooxml-fixture";

// Pins every literal these builders produce against hand-written expected objects (never by calling the builders themselves to construct the expectation) -- every fixture across src/test-support/ that builds real XML via el/txt/xmlDeclaration depends on these three functions producing exactly the right shape, so a mutation here would otherwise only ever be caught (if at all) indirectly through some other fixture's own consumer test.
describe("xmlDeclaration", () => {
  it("declares version 1.0, UTF-8 encoding, standalone yes", () => {
    expect(xmlDeclaration()).toEqual({
      type: "declaration",
      attributes: [
        { name: "version", value: "1.0" },
        { name: "encoding", value: "UTF-8" },
        { name: "standalone", value: "yes" },
      ],
    });
  });
});

describe("el", () => {
  it("builds a childless, attribute-less element from the tag name alone", () => {
    expect(el("w:p")).toEqual({
      type: "element",
      tag: "w:p",
      attributes: [],
      children: [],
    });
  });

  it("converts an attributes record into name/value pairs, preserving insertion order", () => {
    expect(el("w:comment", { "w:id": "0", "w:author": "Alice" })).toEqual({
      type: "element",
      tag: "w:comment",
      attributes: [
        { name: "w:id", value: "0" },
        { name: "w:author", value: "Alice" },
      ],
      children: [],
    });
  });

  it("carries children through as a new array, not the same reference", () => {
    const children = [txt("hello")];
    const result = el("w:t", {}, children);
    expect(result.children).toEqual([{ type: "text", value: "hello" }]);
    expect(result.children).not.toBe(children);
  });
});

describe("txt", () => {
  it("wraps a string as a text node", () => {
    expect(txt("hello world")).toEqual({ type: "text", value: "hello world" });
  });

  it("preserves an empty string rather than treating it as absent", () => {
    expect(txt("")).toEqual({ type: "text", value: "" });
  });
});
