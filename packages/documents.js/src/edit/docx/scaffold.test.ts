import { decodePackage, encodePackage, rootElement } from "ooxml.js";
import { describe, expect, it } from "vitest";
import { createEmptyDocxPackage } from "./scaffold";

describe("createEmptyDocxPackage", () => {
  it("has every part a minimal docx needs", () => {
    const pkg = createEmptyDocxPackage();
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

  it("round-trips through encodePackage/decodePackage unchanged", () => {
    const pkg = createEmptyDocxPackage();
    expect(decodePackage(encodePackage(pkg))).toEqual(pkg);
  });

  it("has a w:body with a default section", () => {
    const pkg = createEmptyDocxPackage();
    const root = rootElement(pkg.parts["word/document.xml"]);
    expect(root?.tag).toBe("w:document");
    const body = root?.children.find(
      (c) => c.type === "element" && c.tag === "w:body",
    );
    expect(body).toBeDefined();
    const sectPr =
      body?.type === "element"
        ? body.children.find(
            (c) => c.type === "element" && c.tag === "w:sectPr",
          )
        : undefined;
    expect(sectPr).toBeDefined();
  });

  it("has a styles part with a default Normal style", () => {
    const pkg = createEmptyDocxPackage();
    const root = rootElement(pkg.parts["word/styles.xml"]);
    const normalStyle = root?.children.find(
      (c) =>
        c.type === "element" &&
        c.tag === "w:style" &&
        c.attributes.some((a) => a.name === "w:default" && a.value === "1"),
    );
    expect(normalStyle).toBeDefined();
  });
});
