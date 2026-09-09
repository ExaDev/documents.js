import { describe, expect, it } from "vitest";
import { decodePackage, encodePackage } from "../../codec";
import { readMimetype } from "../../mimetype";
import { validateManifest } from "../../manifest";
import {
  rootElement,
  findChildElement,
  childrenWithTag,
  attrValue,
} from "../../xml/query";
import { readOdm } from "./read";
import { writeOdm } from "./write";

// The section shapes below mirror the real LibreOffice-produced .odm read.ts's own top-of-file note transcribed element-for-element from UNO output: relative sibling-file hrefs ("../chapter1.odt" -- package-relative addressing treats content.xml's base URI as the package file itself), the "writer8" import filter, and self-closing section-source elements.
function twoChapterDocument() {
  return {
    sections: [
      {
        name: "ChapterOne",
        href: "../chapter1.odt",
        filterName: "writer8",
      },
      { name: "ChapterTwo", href: "../chapter2.odt" },
    ],
  };
}

describe("writeOdm", () => {
  it("round-trips a two-chapter master document through real bytes", () => {
    const document = twoChapterDocument();
    expect(readOdm(decodePackage(encodePackage(writeOdm(document))))).toEqual(
      document,
    );
  });

  it("round-trips a master document with no chapters at all", () => {
    expect(readOdm(writeOdm({ sections: [] }))).toEqual({ sections: [] });
  });

  it("writes the text-master media type and a manifest that validates clean", () => {
    const pkg = writeOdm(twoChapterDocument());
    expect(readMimetype(pkg)).toBe(
      "application/vnd.oasis.opendocument.text-master",
    );
    expect(validateManifest(pkg)).toEqual([]);
  });

  it("writes each chapter as a top-level text:section carrying a self-closing text:section-source with href and filter name only", () => {
    const pkg = writeOdm(twoChapterDocument());
    const root = rootElement(
      pkg.parts["content.xml"]?.kind === "xml"
        ? pkg.parts["content.xml"].nodes
        : [],
    );
    const body = findChildElement(root?.children ?? [], "office:body");
    const text = findChildElement(body?.children ?? [], "office:text");
    expect(text).toBeDefined();
    const sections = childrenWithTag(text!, "text:section");
    expect(sections).toHaveLength(2);
    expect(attrValue(sections[0]!, "text:name")).toBe("ChapterOne");
    const source = childrenWithTag(sections[0]!, "text:section-source")[0]!;
    expect(source.children).toHaveLength(0);
    expect(attrValue(source, "xlink:href")).toBe("../chapter1.odt");
    expect(attrValue(source, "text:filter-name")).toBe("writer8");
    expect(source.attributes.map((attribute) => attribute.name).sort()).toEqual(
      ["text:filter-name", "xlink:href"],
    );
  });
});
