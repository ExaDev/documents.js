import { describe, expect, it } from "vitest";
import { buildXml } from "./build";

describe("buildXml", () => {
  it("builds a bare text node with no wrapping tag", () => {
    expect(buildXml([{ type: "text", value: "hello" }])).toBe("hello");
  });

  it("builds a comment node", () => {
    expect(buildXml([{ type: "comment", value: "a comment" }])).toBe(
      "<!--a comment-->",
    );
  });

  it("builds a cdata node", () => {
    expect(buildXml([{ type: "cdata", value: "raw <data>" }])).toBe(
      "<![CDATA[raw <data>]]>",
    );
  });

  it("builds a processing instruction node, keyed by its own target", () => {
    expect(
      buildXml([
        { type: "pi", target: "xml-stylesheet", content: 'href="x.xsl"' },
      ]),
    ).toBe("<?xml-stylesheet?>");
  });

  it("builds an XML declaration carrying its own attributes", () => {
    expect(
      buildXml([
        {
          type: "declaration",
          attributes: [
            { name: "version", value: "1.0" },
            { name: "encoding", value: "UTF-8" },
          ],
        },
      ]),
    ).toBe('<?xml version="1.0" encoding="UTF-8"?>');
  });

  it("builds an element with no attributes, omitting the attribute object entirely", () => {
    expect(
      buildXml([
        {
          type: "element",
          tag: "p",
          attributes: [],
          children: [{ type: "text", value: "hi" }],
        },
      ]),
    ).toBe("<p>hi</p>");
  });

  it("builds an element carrying its own attributes", () => {
    expect(
      buildXml([
        {
          type: "element",
          tag: "p",
          attributes: [{ name: "class", value: "note" }],
          children: [],
        },
      ]),
    ).toBe('<p class="note"></p>');
  });

  it("builds nested elements in document order", () => {
    expect(
      buildXml([
        {
          type: "element",
          tag: "div",
          attributes: [],
          children: [
            {
              type: "element",
              tag: "span",
              attributes: [],
              children: [{ type: "text", value: "x" }],
            },
          ],
        },
      ]),
    ).toBe("<div><span>x</span></div>");
  });
});
