import type { Package, XmlElement } from "ooxml.js";
import { attr, decodePackage, encodePackage } from "ooxml.js";
import { describe, expect, it } from "vitest";
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
    expect(() => defaultContentTypeForExtension("tiff")).toThrow();
  });
});

describe("ensureDefaultContentType", () => {
  it("creates [Content_Types].xml with a Default entry when none exists", () => {
    const pkg = emptyPackage();
    ensureDefaultContentType(pkg, "png", "image/png");
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
});

describe("round-trip through ooxml.js encodePackage/decodePackage", () => {
  it("produces a package that decodes back to an identical value", () => {
    const pkg = emptyPackage();
    ensureDefaultContentType(pkg, "png", "image/png");
    ensureContentTypeOverride(pkg, "word/document.xml", "application/xml");
    expect(decodePackage(encodePackage(pkg))).toEqual(pkg);
  });
});
