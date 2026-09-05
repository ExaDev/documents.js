import { describe, expect, it } from "vitest";
import type { XmlNode } from "./node";
import { decodedTextContent, textContent } from "./query";

function text(value: string): XmlNode {
  return { type: "text", value };
}

function cdata(value: string): XmlNode {
  return { type: "cdata", value };
}

function el(tag: string, children: XmlNode[]): XmlNode {
  return { type: "element", tag, attributes: [], children };
}

// ExaDev/documents.js#994's round-9 finding: textContent is a real published export (re-exported from the package's own barrel), and this package's own internal code -- opf/metadata.ts, before this fix -- used to decode its result with decodeEntities itself. A stale external caller doing the identical decodeEntities(textContent(x)) must keep getting the raw, undecoded text it always got, or that caller silently double-decodes.
describe("textContent", () => {
  it("returns raw, undecoded text content of every text-node descendant", () => {
    expect(textContent([text("Tom &amp; Jerry")])).toBe("Tom &amp; Jerry");
  });

  it("does not visit a CDATA descendant at all", () => {
    expect(textContent([el("p", [cdata("if (a < b) { return; }")])])).toBe("");
  });

  it("concatenates across nested elements", () => {
    expect(textContent([el("p", [text("a"), el("b", [text("c")])])])).toBe(
      "ac",
    );
  });
});

describe("decodedTextContent", () => {
  it("decodes entities in a text-node descendant exactly once", () => {
    // A literal source "&amp;amp;" is the two-character entity "&amp;" written out verbatim -- one decode pass restores it to the five-character string "&amp;"; a second pass would over-decode it to a bare "&".
    expect(decodedTextContent([text("&amp;amp;")])).toBe("&amp;");
  });

  it("includes a CDATA descendant's own value untouched, with no entity decoding applied to it", () => {
    expect(
      decodedTextContent([el("p", [cdata("if (a < b) { return; }")])]),
    ).toBe("if (a < b) { return; }");
  });

  it("concatenates a decoded text node and a raw CDATA section across nested elements", () => {
    const tree = el("p", [
      text("caf&#233; &amp; "),
      el("code", [cdata("a && b")]),
    ]);
    expect(decodedTextContent([tree])).toBe("caf&#233; & a && b");
  });
});
