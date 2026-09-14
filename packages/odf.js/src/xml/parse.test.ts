import { describe, expect, it } from "vitest";
import { parseXml } from "./parse";

// parseXml had no direct unit tests at all -- every reader test in this package exercises it only indirectly, through a whole XML document string, which never isolates a single node kind's own mapping. These pin each of parseNode's own branches (text/comment/cdata/declaration/pi/element) directly against a minimal real XML string, plus attribute parsing and nested-element recursion.

describe("parseXml: node kinds", () => {
  it("parses a bare element with no children, attributes, or text", () => {
    expect(parseXml("<a/>")).toEqual([
      { type: "element", tag: "a", attributes: [], children: [] },
    ]);
  });

  it("parses an element's own text content as a text node child", () => {
    const [node] = parseXml("<a>hello</a>");
    expect(node).toMatchObject({
      type: "element",
      tag: "a",
      children: [{ type: "text", value: "hello" }],
    });
  });

  it("parses a comment as its own comment node, not folded into surrounding text", () => {
    const [node] = parseXml("<a><!--a note--></a>");
    expect(node).toMatchObject({
      type: "element",
      tag: "a",
      children: [{ type: "comment", value: "a note" }],
    });
  });

  it("parses a CDATA section as its own cdata node with the raw text preserved", () => {
    const [node] = parseXml("<a><![CDATA[raw <text>]]></a>");
    expect(node).toMatchObject({
      type: "element",
      tag: "a",
      children: [{ type: "cdata", value: "raw <text>" }],
    });
  });

  it("parses the leading <?xml ...?> as a declaration node carrying its own attributes", () => {
    const [node] = parseXml('<?xml version="1.0" encoding="UTF-8"?><a/>');
    expect(node).toEqual({
      type: "declaration",
      attributes: [
        { name: "version", value: "1.0" },
        { name: "encoding", value: "UTF-8" },
      ],
    });
  });

  it("parses a non-xml processing instruction with its own target", () => {
    const [, pi] = parseXml('<a/><?xml-stylesheet href="x.xsl"?>');
    if (pi?.type !== "pi") {
      throw new Error("expected a pi node");
    }
    expect(pi.target).toBe("xml-stylesheet");
    expect(typeof pi.content).toBe("string");
  });

  it("parses an element's own attributes, stripping the @_ prefix and preserving order", () => {
    const [node] = parseXml('<a x="1" y="2"/>');
    expect(node).toMatchObject({
      type: "element",
      tag: "a",
      attributes: [
        { name: "x", value: "1" },
        { name: "y", value: "2" },
      ],
    });
  });

  it("parses an element with no attributes to an empty attributes array, not undefined", () => {
    const [node] = parseXml("<a/>");
    expect(node).toMatchObject({ attributes: [] });
  });

  it("recurses into nested elements, preserving document order across mixed element and text children", () => {
    const [node] = parseXml("<a>one<b/>two</a>");
    expect(node).toMatchObject({
      type: "element",
      tag: "a",
      children: [
        { type: "text", value: "one" },
        { type: "element", tag: "b", attributes: [], children: [] },
        { type: "text", value: "two" },
      ],
    });
  });

  it("does not re-encode entities -- an already-encoded &amp; comes back exactly as written", () => {
    const [node] = parseXml("<a>x &amp; y</a>");
    expect(node).toMatchObject({
      children: [{ type: "text", value: "x &amp; y" }],
    });
  });

  it("does not trim leading/trailing whitespace out of text content", () => {
    const [node] = parseXml("<a>  padded  </a>");
    expect(node).toMatchObject({
      children: [{ type: "text", value: "  padded  " }],
    });
  });
});
