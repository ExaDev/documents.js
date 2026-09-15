import { describe, expect, it } from "vitest";
import { el, txt, xmlDeclaration } from "./ooxml-fixture";

describe("xmlDeclaration", () => {
  it("builds the standard XML 1.0 UTF-8 standalone declaration", () => {
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

describe("txt", () => {
  it("builds a text node carrying the given value", () => {
    expect(txt("hello")).toEqual({ type: "text", value: "hello" });
  });
});

describe("el", () => {
  it("builds an element with no attributes and no children by default", () => {
    expect(el("w:p")).toEqual({
      type: "element",
      tag: "w:p",
      attributes: [],
      children: [],
    });
  });

  it("converts an attributes record into an ordered name/value array", () => {
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

  it("carries through the given children unchanged", () => {
    const child = txt("body text");
    expect(el("w:t", {}, [child])).toEqual({
      type: "element",
      tag: "w:t",
      attributes: [],
      children: [child],
    });
  });

  it("copies the children array rather than aliasing the one passed in", () => {
    const children = [txt("a")];
    const element = el("w:r", {}, children);
    children.push(txt("b"));
    expect(element.children).toHaveLength(1);
  });
});
