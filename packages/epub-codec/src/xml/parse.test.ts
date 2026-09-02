import { describe, expect, it } from "vitest";
import { buildXml } from "./build";
import { rootElement } from "./query";
import { parseXml } from "./parse";

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
