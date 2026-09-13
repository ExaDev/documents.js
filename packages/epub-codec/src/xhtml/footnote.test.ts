import { describe, expect, it } from "vitest";
import type { XmlElement } from "../xml/node";
import {
  isFootnoteAside,
  isFootnoteReference,
  sameDocumentFragment,
} from "./footnote";

function element(
  tag: string,
  attributes: { name: string; value: string }[] = [],
): XmlElement {
  return { type: "element", tag, attributes, children: [] };
}

describe("sameDocumentFragment", () => {
  it("returns undefined for an undefined href", () => {
    expect(sameDocumentFragment(undefined)).toBeUndefined();
  });

  it("returns undefined for an href with no leading '#'", () => {
    expect(sameDocumentFragment("chapter2.xhtml")).toBeUndefined();
  });

  it("returns undefined for a cross-document href with a fragment", () => {
    expect(sameDocumentFragment("chapter2.xhtml#note1")).toBeUndefined();
  });

  it("returns undefined for a bare '#' with no fragment name", () => {
    expect(sameDocumentFragment("#")).toBeUndefined();
  });

  it("returns the single-character fragment name at the length-2 boundary", () => {
    expect(sameDocumentFragment("#a")).toBe("a");
  });

  it("returns the fragment name for a real same-document href", () => {
    expect(sameDocumentFragment("#note1")).toBe("note1");
  });
});

describe("isFootnoteReference", () => {
  it('recognises the structured EPUB 3 epub:type="noteref"', () => {
    const anchor = element("a", [{ name: "epub:type", value: "noteref" }]);
    const target = element("aside");
    expect(isFootnoteReference(anchor, target)).toBe(true);
  });

  it("recognises noteref among several space-separated epub:type values", () => {
    const anchor = element("a", [
      { name: "epub:type", value: "footnote noteref" },
    ]);
    const target = element("aside");
    expect(isFootnoteReference(anchor, target)).toBe(true);
  });

  it("recognises the EPUB 2 class idiom on the anchor itself", () => {
    const anchor = element("a", [{ name: "class", value: "footnote" }]);
    const target = element("aside");
    expect(isFootnoteReference(anchor, target)).toBe(true);
  });

  it("recognises the EPUB 2 class idiom on the target when the anchor carries no signal", () => {
    const anchor = element("a");
    const target = element("aside", [{ name: "class", value: "noteref" }]);
    expect(isFootnoteReference(anchor, target)).toBe(true);
  });

  it("is case-insensitive for the class idiom", () => {
    const anchor = element("a", [{ name: "class", value: "FootNote" }]);
    expect(isFootnoteReference(anchor, element("aside"))).toBe(true);
  });

  it("is false for an ordinary internal link with neither signal", () => {
    const anchor = element("a", [{ name: "epub:type", value: "bodymatter" }]);
    const target = element("section");
    expect(isFootnoteReference(anchor, target)).toBe(false);
  });
});

describe("isFootnoteAside", () => {
  it('recognises epub:type="footnote" on an aside', () => {
    expect(
      isFootnoteAside(
        element("aside", [{ name: "epub:type", value: "footnote" }]),
      ),
    ).toBe(true);
  });

  it('recognises epub:type="rearnote" on an aside', () => {
    expect(
      isFootnoteAside(
        element("aside", [{ name: "epub:type", value: "rearnote" }]),
      ),
    ).toBe(true);
  });

  it("recognises footnote among several space-separated epub:type values, not requiring every value to match", () => {
    expect(
      isFootnoteAside(
        element("aside", [{ name: "epub:type", value: "footnote bodymatter" }]),
      ),
    ).toBe(true);
  });

  it('is false for a non-aside element, even carrying epub:type="footnote"', () => {
    expect(
      isFootnoteAside(
        element("div", [{ name: "epub:type", value: "footnote" }]),
      ),
    ).toBe(false);
  });

  it("is false for an aside with an unrelated epub:type", () => {
    expect(
      isFootnoteAside(
        element("aside", [{ name: "epub:type", value: "bodymatter" }]),
      ),
    ).toBe(false);
  });

  it("is false for an aside with no epub:type at all", () => {
    expect(isFootnoteAside(element("aside"))).toBe(false);
  });
});
