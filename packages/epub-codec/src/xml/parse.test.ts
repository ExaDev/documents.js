import { describe, expect, it } from "vitest";
import { buildXml } from "./build";
import { rootElement } from "./query";
import {
  parseAttributes,
  parseNode,
  parseNodes,
  parseXml,
  scalarText,
} from "./parse";

describe("parseXml", () => {
  it("parses a simple element with attributes and text", () => {
    const nodes = parseXml('<p class="a">Hello</p>');
    const root = rootElement(nodes);
    expect(root?.tag).toBe("p");
    expect(root?.attributes).toEqual([{ name: "class", value: "a" }]);
    expect(root?.children).toEqual([{ type: "text", value: "Hello" }]);
  });

  it("preserves mixed content order", () => {
    const nodes = parseXml("<p>before <em>middle</em> after</p>");
    const root = rootElement(nodes);
    expect(root?.children).toEqual([
      { type: "text", value: "before " },
      {
        type: "element",
        tag: "em",
        attributes: [],
        children: [{ type: "text", value: "middle" }],
      },
      { type: "text", value: " after" },
    ]);
  });

  it("keeps entity encoding raw rather than decoding it", () => {
    const nodes = parseXml("<p>A &amp; B</p>");
    const root = rootElement(nodes);
    expect(root?.children).toEqual([{ type: "text", value: "A &amp; B" }]);
  });

  it("parses a leading XML declaration", () => {
    const nodes = parseXml('<?xml version="1.0" encoding="utf-8"?><p/>');
    expect(nodes[0]).toEqual({
      type: "declaration",
      attributes: [
        { name: "version", value: "1.0" },
        { name: "encoding", value: "utf-8" },
      ],
    });
  });

  it("parses a comment node", () => {
    const nodes = parseXml("<!--a comment--><p/>");
    expect(nodes[0]).toEqual({ type: "comment", value: "a comment" });
  });

  it("parses a cdata node", () => {
    const nodes = parseXml("<p><![CDATA[raw <data>]]></p>");
    const root = rootElement(nodes);
    expect(root?.children).toEqual([{ type: "cdata", value: "raw <data>" }]);
  });

  it("parses a processing instruction node, keyed by its own target", () => {
    const nodes = parseXml('<?xml-stylesheet href="x.xsl"?><p/>');
    expect(nodes[0]).toEqual({
      type: "pi",
      target: "xml-stylesheet",
      content: "",
    });
  });

  it("parses namespaced tag and attribute names verbatim", () => {
    const nodes = parseXml(
      '<html xmlns:epub="http://www.idpf.org/2007/ops"><body epub:type="bodymatter"/></html>',
    );
    const root = rootElement(nodes);
    const body = root?.children[0];
    expect(body?.type).toBe("element");
    if (body?.type === "element") {
      expect(body.tag).toBe("body");
      expect(body.attributes).toEqual([
        { name: "epub:type", value: "bodymatter" },
      ]);
    }
  });
});

describe("buildXml", () => {
  it("round-trips a parsed document back to equivalent XML", () => {
    const original = '<p class="a">before <em>middle</em> after</p>';
    const rebuilt = buildXml(parseXml(original));
    expect(parseXml(rebuilt)).toEqual(parseXml(original));
  });

  it("builds an empty element without self-closing collapse issues", () => {
    const xml = buildXml([
      { type: "element", tag: "hr", attributes: [], children: [] },
    ]);
    const reparsed = rootElement(parseXml(xml));
    expect(reparsed?.tag).toBe("hr");
    expect(reparsed?.children).toEqual([]);
  });
});

// The functions below validate the shape of fast-xml-parser's own `any`-typed output -- no syntactically valid XML string can drive parseXml itself into most of these branches, since the shape they check is the library's own internal invariant, not something malformed markup can violate. Exercised directly with adversarial `unknown` values instead, exactly like node.ts's own isXmlNode.
describe("parseNodes", () => {
  it("rejects a value that is not an array", () => {
    expect(() => parseNodes("not an array")).toThrow(
      "fast-xml-parser output was not an ordered array",
    );
  });
});

describe("parseNode", () => {
  it("rejects a value that is not a plain record", () => {
    expect(() => parseNode("not a record")).toThrow(
      "fast-xml-parser node was not an object",
    );
  });

  it("rejects null", () => {
    expect(() => parseNode(null)).toThrow(
      "fast-xml-parser node was not an object",
    );
  });

  it("rejects an array", () => {
    expect(() => parseNode([])).toThrow(
      "fast-xml-parser node was not an object",
    );
  });

  it("rejects a record with more than one non-:@ key", () => {
    expect(() => parseNode({ a: [], b: [] })).toThrow(
      "XML node had multiple tag keys",
    );
  });

  it("rejects a record with no tag key at all", () => {
    expect(() => parseNode({ ":@": {} })).toThrow("XML node had no tag key");
  });

  it("rejects a #text node whose own text is not a string", () => {
    expect(() => parseNode({ "#text": 5 })).toThrow(
      "expected string while parsing XML, got number",
    );
  });
});

describe("parseAttributes", () => {
  it("returns an empty list for undefined", () => {
    expect(parseAttributes(undefined)).toEqual([]);
  });

  it("rejects a value that is not a plain record", () => {
    expect(() => parseAttributes("not a record")).toThrow(
      "XML attributes were not an object",
    );
  });

  it("rejects a key without the @_ prefix", () => {
    expect(() => parseAttributes({ id: "x" })).toThrow(
      "unexpected attribute key without @_ prefix: id",
    );
  });
});

describe("scalarText", () => {
  it("rejects a value that is not an array", () => {
    expect(() => scalarText("not an array")).toThrow(
      "expected a scalar-text wrapper array",
    );
  });

  it("rejects an empty array", () => {
    expect(() => scalarText([])).toThrow(
      "expected a scalar-text wrapper array",
    );
  });

  it("rejects a wrapper whose first element is not a record", () => {
    expect(() => scalarText(["not a record"])).toThrow(
      "scalar-text wrapper was not an object",
    );
  });
});
