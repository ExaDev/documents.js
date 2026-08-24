import type { XmlElement, XmlNode } from "documents.js";

// A tiny, local stand-in for ooxml.js's own `el`/`txt`/declaration-node builders, needed because ooxml.js itself is not a direct dependency of this repo -- only its types are, re-exported through documents.js. `XmlElement`/`XmlNode` are plain data shapes, so constructing them as object literals here is not reimplementing ooxml.js, it is just satisfying the same public schema documents.js already re-exports. Ported from document-cli's own src/test-support/ooxml-fixture.ts.

export function xmlDeclaration(): XmlNode {
  return {
    type: "declaration",
    attributes: [
      { name: "version", value: "1.0" },
      { name: "encoding", value: "UTF-8" },
      { name: "standalone", value: "yes" },
    ],
  };
}

export function el(
  tag: string,
  attributes: Readonly<Record<string, string>> = {},
  children: readonly XmlNode[] = [],
): XmlElement {
  return {
    type: "element",
    tag,
    attributes: Object.entries(attributes).map(([name, value]) => ({
      name,
      value,
    })),
    children: [...children],
  };
}

export function txt(value: string): XmlNode {
  return { type: "text", value };
}
