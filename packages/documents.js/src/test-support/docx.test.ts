import { decodePackage, rootElement, textContent } from "ooxml.js";
import { describe, expect, it } from "vitest";
import { minimalDocxBytes, minimalDocxPackage } from "./docx";

describe("minimalDocxPackage", () => {
  it("has the parts a minimal docx needs", () => {
    const pkg = minimalDocxPackage();
    expect(Object.keys(pkg.parts).sort()).toEqual(
      [
        "[Content_Types].xml",
        "_rels/.rels",
        "word/_rels/document.xml.rels",
        "word/document.xml",
        "word/styles.xml",
      ].sort(),
    );
  });

  it("contains the expected paragraph text", () => {
    const pkg = minimalDocxPackage();
    const root = rootElement(pkg.parts["word/document.xml"]);
    expect(root).toBeDefined();
    expect(textContent(root!)).toContain("Hello, world!");
  });

  it("minimalDocxBytes decodes to the same package minimalDocxPackage returns", () => {
    expect(decodePackage(minimalDocxBytes())).toEqual(minimalDocxPackage());
  });

  it("starts with a ZIP local-file-header signature", () => {
    const bytes = minimalDocxBytes();
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });
});
