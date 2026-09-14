import type { ContentSection } from "document-schema.js";
import { describe, expect, it } from "vitest";
import type { XmlElement } from "../xml/node";
import { parseXml } from "../xml/parse";
import { findChildElement, rootElement } from "../xml/query";
import { readNav3TocHrefs } from "./nav3";
import { writeNav3Document } from "./write";

function section(blocks: ContentSection["blocks"]): ContentSection {
  return {
    pageSize: { widthPt: 595.28, heightPt: 841.89 },
    margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
    blocks,
  };
}

describe("writeNav3Document", () => {
  it("writes one toc entry per section, titled from its first heading", () => {
    const xml = writeNav3Document([
      {
        href: "section1.xhtml",
        section: section([
          {
            kind: "paragraph",
            headingLevel: 1,
            runs: [{ text: "Chapter One" }],
          },
        ]),
      },
      {
        href: "section2.xhtml",
        section: section([
          { kind: "paragraph", runs: [{ text: "no heading" }] },
        ]),
      },
    ]);
    expect(xml).toContain(">Chapter One<");
    expect(xml).toContain(">Section 2<");
    expect(readNav3TocHrefs(xml)).toEqual(["section1.xhtml", "section2.xhtml"]);
  });

  it("emits a fully well-formed EPUB 3 nav document down to every element, attribute, and text node", () => {
    const xml = writeNav3Document([
      {
        href: "section1.xhtml",
        section: section([
          {
            kind: "paragraph",
            headingLevel: 1,
            runs: [{ text: "Foo" }, { text: "Bar" }],
          },
        ]),
      },
    ]);
    const html = rootElement(parseXml(xml));
    if (html === undefined) {
      throw new Error("expected a root element");
    }
    expect(html.tag).toBe("html");
    expect(html.attributes).toEqual([
      { name: "xmlns", value: "http://www.w3.org/1999/xhtml" },
      { name: "xmlns:epub", value: "http://www.idpf.org/2007/ops" },
    ]);
    const body = findChildElement(html.children, "body");
    if (body === undefined) {
      throw new Error("expected a <body> element");
    }
    const nav = findChildElement(body.children, "nav");
    if (nav === undefined) {
      throw new Error("expected a <nav> element");
    }
    expect(nav.attributes).toEqual([{ name: "epub:type", value: "toc" }]);
    const h1 = findChildElement(nav.children, "h1");
    if (h1 === undefined) {
      throw new Error("expected an <h1> element");
    }
    expect(h1.children).toEqual([{ type: "text", value: "Table of Contents" }]);
    const ol = findChildElement(nav.children, "ol");
    if (ol === undefined) {
      throw new Error("expected an <ol> element");
    }
    const li = findChildElement(ol.children, "li");
    if (li === undefined) {
      throw new Error("expected an <li> element");
    }
    const a = findChildElement(li.children, "a");
    if (a === undefined) {
      throw new Error("expected an <a> element");
    }
    expect(a.attributes).toEqual([{ name: "href", value: "section1.xhtml" }]);
    expect(a.children).toEqual([{ type: "text", value: "FooBar" }]);
  });

  it("falls back to a generated section title when the heading's own text is entirely whitespace", () => {
    const xml = writeNav3Document([
      {
        href: "section1.xhtml",
        section: section([
          { kind: "paragraph", headingLevel: 1, runs: [{ text: "   " }] },
        ]),
      },
    ]);
    const html = rootElement(parseXml(xml));
    const a = html === undefined ? undefined : findLinkText(html);
    expect(a).toBe("Section 1");
  });
});

// Walks down to the nav document's single <a> element's own text content -- a small local helper rather than repeating the same body/nav/ol/li/a descent inline in every test that only cares about the link's final text.
function findLinkText(html: XmlElement) {
  const body = findChildElement(html.children, "body");
  const nav =
    body === undefined ? undefined : findChildElement(body.children, "nav");
  const ol =
    nav === undefined ? undefined : findChildElement(nav.children, "ol");
  const li = ol === undefined ? undefined : findChildElement(ol.children, "li");
  const a = li === undefined ? undefined : findChildElement(li.children, "a");
  const textNode = a?.children[0];
  return textNode?.type === "text" ? textNode.value : undefined;
}
