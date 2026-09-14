import type { XmlElement } from "ooxml.js";
import { attr, decodePackage, encodePackage, rootElement } from "ooxml.js";
import { describe, expect, it } from "vitest";
import { createEmptyDocxPackage } from "./scaffold";

function elementChildren(
  node: XmlElement | undefined,
  tag: string,
): XmlElement[] {
  if (node === undefined) {
    return [];
  }
  return node.children.filter(
    (c): c is XmlElement => c.type === "element" && c.tag === tag,
  );
}

function elementChild(node: XmlElement | undefined, tag: string): XmlElement {
  const found = elementChildren(node, tag)[0];
  if (found === undefined) {
    throw new Error(`expected a <${tag}> child`);
  }
  return found;
}

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

  it("every XML part starts with the standard version/encoding/standalone declaration", () => {
    const pkg = createEmptyDocxPackage();
    for (const partName of [
      "[Content_Types].xml",
      "_rels/.rels",
      "word/document.xml",
      "word/_rels/document.xml.rels",
      "word/styles.xml",
    ] as const) {
      const part = pkg.parts[partName];
      if (part?.kind !== "xml") {
        throw new Error(`expected ${partName} to be an xml part`);
      }
      expect(part.nodes[0]).toEqual({
        type: "declaration",
        attributes: [
          { name: "version", value: "1.0" },
          { name: "encoding", value: "UTF-8" },
          { name: "standalone", value: "yes" },
        ],
      });
    }
  });

  it("[Content_Types].xml declares the package namespace, the two Default extensions, and both part Overrides with their exact content types", () => {
    const pkg = createEmptyDocxPackage();
    const root = rootElement(pkg.parts["[Content_Types].xml"]);
    if (root === undefined) {
      throw new Error("expected a root element");
    }
    expect(attr(root, "xmlns")).toBe(
      "http://schemas.openxmlformats.org/package/2006/content-types",
    );

    const defaults = elementChildren(root, "Default");
    expect(defaults).toHaveLength(2);
    expect(attr(defaults[0]!, "Extension")).toBe("rels");
    expect(attr(defaults[0]!, "ContentType")).toBe(
      "application/vnd.openxmlformats-package.relationships+xml",
    );
    expect(attr(defaults[1]!, "Extension")).toBe("xml");
    expect(attr(defaults[1]!, "ContentType")).toBe("application/xml");

    const overrides = elementChildren(root, "Override");
    expect(overrides).toHaveLength(2);
    expect(attr(overrides[0]!, "PartName")).toBe("/word/document.xml");
    expect(attr(overrides[0]!, "ContentType")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    );
    expect(attr(overrides[1]!, "PartName")).toBe("/word/styles.xml");
    expect(attr(overrides[1]!, "ContentType")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml",
    );
  });

  it("_rels/.rels points rId1 at word/document.xml via the officeDocument relationship type", () => {
    const pkg = createEmptyDocxPackage();
    const root = rootElement(pkg.parts["_rels/.rels"]);
    if (root === undefined) {
      throw new Error("expected a root element");
    }
    expect(attr(root, "xmlns")).toBe(
      "http://schemas.openxmlformats.org/package/2006/relationships",
    );
    const relationship = elementChild(root, "Relationship");
    expect(attr(relationship, "Id")).toBe("rId1");
    expect(attr(relationship, "Type")).toBe(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
    );
    expect(attr(relationship, "Target")).toBe("word/document.xml");
  });

  it("word/_rels/document.xml.rels points rId1 at styles.xml via the styles relationship type", () => {
    const pkg = createEmptyDocxPackage();
    const root = rootElement(pkg.parts["word/_rels/document.xml.rels"]);
    if (root === undefined) {
      throw new Error("expected a root element");
    }
    expect(attr(root, "xmlns")).toBe(
      "http://schemas.openxmlformats.org/package/2006/relationships",
    );
    const relationship = elementChild(root, "Relationship");
    expect(attr(relationship, "Id")).toBe("rId1");
    expect(attr(relationship, "Type")).toBe(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
    );
    expect(attr(relationship, "Target")).toBe("styles.xml");
  });

  it("word/document.xml declares the wordprocessingml namespace and a US-Letter w:sectPr with 1in margins and 0.5in header/footer", () => {
    const pkg = createEmptyDocxPackage();
    const root = rootElement(pkg.parts["word/document.xml"]);
    if (root === undefined) {
      throw new Error("expected a root element");
    }
    expect(attr(root, "xmlns:w")).toBe(
      "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    );
    const body = elementChild(root, "w:body");
    const sectPr = elementChild(body, "w:sectPr");
    const pgSz = elementChild(sectPr, "w:pgSz");
    expect(attr(pgSz, "w:w")).toBe("12240");
    expect(attr(pgSz, "w:h")).toBe("15840");
    const pgMar = elementChild(sectPr, "w:pgMar");
    expect(attr(pgMar, "w:top")).toBe("1440");
    expect(attr(pgMar, "w:right")).toBe("1440");
    expect(attr(pgMar, "w:bottom")).toBe("1440");
    expect(attr(pgMar, "w:left")).toBe("1440");
    expect(attr(pgMar, "w:header")).toBe("720");
    expect(attr(pgMar, "w:footer")).toBe("720");
    expect(attr(pgMar, "w:gutter")).toBe("0");
  });

  it("word/styles.xml declares the wordprocessingml namespace and the Normal style's exact type/id/name", () => {
    const pkg = createEmptyDocxPackage();
    const root = rootElement(pkg.parts["word/styles.xml"]);
    if (root === undefined) {
      throw new Error("expected a root element");
    }
    expect(attr(root, "xmlns:w")).toBe(
      "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    );
    const style = elementChild(root, "w:style");
    expect(attr(style, "w:type")).toBe("paragraph");
    expect(attr(style, "w:default")).toBe("1");
    expect(attr(style, "w:styleId")).toBe("Normal");
    const name = elementChild(style, "w:name");
    expect(attr(name, "w:val")).toBe("Normal");
  });
});
