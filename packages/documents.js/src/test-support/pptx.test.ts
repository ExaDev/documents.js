import { decodePackage, rootElement, textContent } from "ooxml.js";
import { describe, expect, it } from "vitest";
import { minimalPptxBytes, minimalPptxPackage } from "./pptx";

describe("minimalPptxPackage", () => {
  it("has the parts a minimal pptx needs", () => {
    const pkg = minimalPptxPackage();
    expect(Object.keys(pkg.parts).sort()).toEqual(
      [
        "[Content_Types].xml",
        "_rels/.rels",
        "ppt/presentation.xml",
        "ppt/_rels/presentation.xml.rels",
        "ppt/slides/slide1.xml",
      ].sort(),
    );
  });

  it("contains the expected slide text", () => {
    const pkg = minimalPptxPackage();
    const root = rootElement(pkg.parts["ppt/slides/slide1.xml"]);
    expect(root).toBeDefined();
    expect(textContent(root!)).toContain("Slide text");
  });

  it("minimalPptxBytes decodes to the same package minimalPptxPackage returns", () => {
    expect(decodePackage(minimalPptxBytes())).toEqual(minimalPptxPackage());
  });
});
