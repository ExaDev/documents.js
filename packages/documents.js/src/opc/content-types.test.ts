import type { Package, XmlElement } from "ooxml.js";
import { attr, decodePackage, encodePackage } from "ooxml.js";
import { describe, expect, it } from "vitest";
import { el } from "../xml/fragment";
import type { ElementCursor } from "../xml/query";
import { findChildElements } from "../xml/query";
import {
  defaultContentTypeForExtension,
  ensureContentTypeOverride,
  ensureDefaultContentType,
} from "./content-types";

function emptyPackage(): Package {
  return { parts: {} };
}

function rootChildren(pkg: Package) {
  const part = pkg.parts["[Content_Types].xml"];
  if (part?.kind !== "xml") {
    throw new Error("expected an xml part");
  }
  const root = part.nodes[0];
  if (root?.type !== "element") {
    throw new Error("expected an element root");
  }
  return root.children;
}

function soleNode(cursors: ElementCursor[]): XmlElement {
  const [first, ...rest] = cursors;
  if (first === undefined || rest.length > 0) {
    throw new Error(`expected exactly one match, got ${cursors.length}`);
  }
  return first.node;
}

describe("defaultContentTypeForExtension", () => {
  it("resolves known extensions case-insensitively", () => {
    expect(defaultContentTypeForExtension("png")).toBe("image/png");
    expect(defaultContentTypeForExtension("JPEG")).toBe("image/jpeg");
    expect(defaultContentTypeForExtension("jpg")).toBe("image/jpeg");
    expect(defaultContentTypeForExtension("gif")).toBe("image/gif");
  });

  it("throws for an unknown extension rather than guessing", () => {
    expect(() => defaultContentTypeForExtension("tiff")).toThrow(
      "no known default content type for extension: tiff",
    );
  });
});

describe("ensureDefaultContentType", () => {
  it("creates [Content_Types].xml with a Default entry when none exists", () => {
    const pkg = emptyPackage();
    ensureDefaultContentType(pkg, "png", "image/png");
    const part = pkg.parts["[Content_Types].xml"];
    const root = part?.kind === "xml" ? part.nodes[0] : undefined;
    expect(root?.type === "element" ? root.tag : undefined).toBe("Types");
    expect(root?.type === "element" ? attr(root, "xmlns") : undefined).toBe(
      "http://schemas.openxmlformats.org/package/2006/content-types",
    );
    const defaults = findChildElements(rootChildren(pkg), "Default");
    const node = soleNode(defaults);
    expect(attr(node, "Extension")).toBe("png");
    expect(attr(node, "ContentType")).toBe("image/png");
  });

  it("does not add a duplicate entry for an extension already present", () => {
    const pkg = emptyPackage();
    ensureDefaultContentType(pkg, "png", "image/png");
    ensureDefaultContentType(pkg, "png", "image/png");
    expect(findChildElements(rootChildren(pkg), "Default")).toHaveLength(1);
  });

  it("adds a second entry for a different extension", () => {
    const pkg = emptyPackage();
    ensureDefaultContentType(pkg, "png", "image/png");
    ensureDefaultContentType(pkg, "jpeg", "image/jpeg");
    expect(findChildElements(rootChildren(pkg), "Default")).toHaveLength(2);
  });

  it("does not mistake an Override element carrying the same Extension attribute value for an existing Default", () => {
    const pkg = emptyPackage();
    ensureContentTypeOverride(pkg, "png", "image/png");
    // Force an Extension attribute onto that Override entry, matching what ensureDefaultContentType would look for on a Default — proving the presence check keys on the element's own tag, not merely on the attribute value.
    const [override] = findChildElements(rootChildren(pkg), "Override");
    if (override !== undefined) {
      override.node.attributes.push({ name: "Extension", value: "png" });
    }
    ensureDefaultContentType(pkg, "png", "image/png");
    expect(findChildElements(rootChildren(pkg), "Default")).toHaveLength(1);
  });
});

describe("ensureContentTypeOverride", () => {
  it("creates an Override entry keyed by part name with a leading slash", () => {
    const pkg = emptyPackage();
    ensureContentTypeOverride(
      pkg,
      "word/document.xml",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    );
    const overrides = findChildElements(rootChildren(pkg), "Override");
    expect(attr(soleNode(overrides), "PartName")).toBe("/word/document.xml");
  });

  it("does not duplicate an existing override for the same part", () => {
    const pkg = emptyPackage();
    ensureContentTypeOverride(pkg, "word/document.xml", "application/xml");
    ensureContentTypeOverride(pkg, "word/document.xml", "application/xml");
    expect(findChildElements(rootChildren(pkg), "Override")).toHaveLength(1);
  });

  // A sibling element that merely happens to carry a matching PartName attribute must not be mistaken for an existing Override — the scan has to check the element's own tag, not just its PartName, or a same-named non-Override child would suppress the real Override this call is meant to add. No real Override exists yet, so a scan that matched on PartName alone would wrongly conclude one is already present and add nothing.
  it("does not treat a non-Override element with a matching PartName as an existing entry", () => {
    const pkg = emptyPackage();
    ensureDefaultContentType(pkg, "png", "image/png");
    const root = rootChildren(pkg);
    root.push(el("NotAnOverride", { PartName: "/word/document.xml" }));
    ensureContentTypeOverride(pkg, "word/document.xml", "application/xml");
    expect(findChildElements(rootChildren(pkg), "Override")).toHaveLength(1);
  });
});

describe("round-trip through ooxml.js encodePackage/decodePackage", () => {
  it("produces a package that decodes back to an identical value", () => {
    const pkg = emptyPackage();
    ensureDefaultContentType(pkg, "png", "image/png");
    ensureContentTypeOverride(pkg, "word/document.xml", "application/xml");
    expect(decodePackage(encodePackage(pkg))).toEqual(pkg);
  });
});
