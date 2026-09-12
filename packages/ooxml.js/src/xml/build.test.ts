import { describe, expect, it } from "vitest";
import type { XmlNode } from "../model/node";
import { assertBuiltString, buildXml } from "./build";

describe("assertBuiltString", () => {
  it("passes a real string straight through", () => {
    expect(assertBuiltString("<a/>")).toBe("<a/>");
  });

  it("throws the exact 'XMLBuilder did not return a string' message for a non-string value", () => {
    expect(() => assertBuiltString([])).toThrow(
      "XMLBuilder did not return a string",
    );
    expect(() => assertBuiltString(undefined)).toThrow(
      "XMLBuilder did not return a string",
    );
  });
});

describe("buildXml", () => {
  it("builds a bare text node as its own literal text", () => {
    expect(buildXml([{ type: "text", value: "hello" }])).toBe("hello");
  });

  it("builds a comment node wrapping its value in XML comment markers", () => {
    expect(buildXml([{ type: "comment", value: " a comment " }])).toBe(
      "<!-- a comment -->",
    );
  });

  it("builds a cdata node wrapping its value in a CDATA section", () => {
    expect(buildXml([{ type: "cdata", value: "raw <stuff>" }])).toBe(
      "<![CDATA[raw <stuff>]]>",
    );
  });

  it("builds a processing instruction from its target alone, regardless of any content it carries", () => {
    const pi: XmlNode = { type: "pi", target: "custom", content: "ignored" };
    expect(buildXml([pi])).toBe("<?custom?>");
  });

  it("builds a declaration from its attributes alone", () => {
    const declaration: XmlNode = {
      type: "declaration",
      attributes: [
        { name: "version", value: "1.0" },
        { name: "encoding", value: "UTF-8" },
      ],
    };
    expect(buildXml([declaration])).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>',
    );
  });

  it("builds an attribute-less element as a plain open/close pair with no stray attribute markup", () => {
    const element: XmlNode = {
      type: "element",
      tag: "a",
      attributes: [],
      children: [{ type: "text", value: "x" }],
    };
    expect(buildXml([element])).toBe("<a>x</a>");
  });

  it("builds an element's own attributes, distinct from an attribute-less sibling", () => {
    const element: XmlNode = {
      type: "element",
      tag: "a",
      attributes: [{ name: "id", value: "42" }],
      children: [],
    };
    expect(buildXml([element])).toBe('<a id="42"></a>');
  });

  it("builds nested elements in document order, proving toOrdered recurses into children rather than stopping at the first level", () => {
    const outer: XmlNode = {
      type: "element",
      tag: "outer",
      attributes: [],
      children: [
        {
          type: "element",
          tag: "inner",
          attributes: [],
          children: [{ type: "text", value: "leaf" }],
        },
      ],
    };
    expect(buildXml([outer])).toBe("<outer><inner>leaf</inner></outer>");
  });

  it("builds several root-level nodes in the array's own order", () => {
    const first: XmlNode = {
      type: "element",
      tag: "a",
      attributes: [],
      children: [],
    };
    const second: XmlNode = {
      type: "element",
      tag: "b",
      attributes: [],
      children: [],
    };
    expect(buildXml([first, second])).toBe("<a></a><b></b>");
  });
});
