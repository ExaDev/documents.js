import { describe, expect, it } from "vitest";
import { parseXml } from "../xml/parse";
import { findChildElement, rootElement } from "../xml/query";
import { parseOpf } from "./parse";
import { writeOpf } from "./write";

describe("writeOpf", () => {
  it("round-trips metadata, manifest, and spine through parseOpf", () => {
    const xml = writeOpf({
      metadata: {
        title: "A Test Book",
        author: "Ada Lovelace",
        keywords: ["Fiction"],
        language: "en",
        createdIso: "2026-01-01",
      },
      manifestItems: [
        {
          id: "nav",
          href: "nav.xhtml",
          mediaType: "application/xhtml+xml",
          properties: ["nav"],
        },
        {
          id: "s1",
          href: "section1.xhtml",
          mediaType: "application/xhtml+xml",
          properties: [],
        },
      ],
      spineIdrefs: ["s1"],
      identifier: "urn:uuid:12345",
    });
    const parsed = parseOpf(xml);
    expect(parsed.metadata).toEqual({
      title: "A Test Book",
      author: "Ada Lovelace",
      keywords: ["Fiction"],
      language: "en",
      createdIso: "2026-01-01",
    });
    expect(parsed.manifest).toEqual([
      {
        id: "nav",
        href: "nav.xhtml",
        mediaType: "application/xhtml+xml",
        properties: ["nav"],
      },
      {
        id: "s1",
        href: "section1.xhtml",
        mediaType: "application/xhtml+xml",
        properties: [],
      },
    ]);
    expect(parsed.spine).toEqual([{ idref: "s1", linear: true }]);
  });

  it("defaults dc:language to 'en' when none is given", () => {
    const xml = writeOpf({
      metadata: {},
      manifestItems: [],
      spineIdrefs: [],
      identifier: "urn:uuid:abc",
    });
    expect(parseOpf(xml).metadata.language).toBe("en");
  });

  it("writes a generated identifier as dc:identifier", () => {
    const xml = writeOpf({
      metadata: {},
      manifestItems: [],
      spineIdrefs: [],
      identifier: "urn:uuid:deadbeef",
    });
    expect(xml).toContain("urn:uuid:deadbeef");
  });

  it("joins more than one manifest item property with a real space, not concatenated bare", () => {
    const xml = writeOpf({
      metadata: {},
      manifestItems: [
        {
          id: "nav",
          href: "nav.xhtml",
          mediaType: "application/xhtml+xml",
          properties: ["nav", "scripted"],
        },
      ],
      spineIdrefs: [],
      identifier: "urn:uuid:abc",
    });
    expect(parseOpf(xml).manifest[0]?.properties).toEqual(["nav", "scripted"]);
  });

  it("writes a dcterms:modified meta element when modifiedIso is given", () => {
    const xml = writeOpf({
      metadata: { modifiedIso: "2026-02-03T04:05:06Z" },
      manifestItems: [],
      spineIdrefs: [],
      identifier: "urn:uuid:abc",
    });
    const packageElement = rootElement(parseXml(xml));
    if (packageElement === undefined) {
      throw new Error("expected a <package> root element");
    }
    const metadataElement = findChildElement(
      packageElement.children,
      "metadata",
    );
    if (metadataElement === undefined) {
      throw new Error("expected a <metadata> element");
    }
    const meta = findChildElement(metadataElement.children, "meta");
    if (meta === undefined) {
      throw new Error("expected a <meta> element");
    }
    expect(meta.attributes).toEqual([
      { name: "property", value: "dcterms:modified" },
    ]);
    expect(meta.children).toEqual([
      { type: "text", value: "2026-02-03T04:05:06Z" },
    ]);
  });

  it("emits every fixed OPF element and attribute down to its exact tag and value", () => {
    const xml = writeOpf({
      metadata: {},
      manifestItems: [
        {
          id: "s1",
          href: "section1.xhtml",
          mediaType: "application/xhtml+xml",
          properties: [],
        },
      ],
      spineIdrefs: ["s1"],
      identifier: "urn:uuid:abc",
    });
    const packageElement = rootElement(parseXml(xml));
    if (packageElement === undefined) {
      throw new Error("expected a <package> root element");
    }
    expect(packageElement.tag).toBe("package");
    expect(packageElement.attributes).toEqual([
      { name: "xmlns", value: "http://www.idpf.org/2007/opf" },
      { name: "version", value: "3.0" },
      { name: "unique-identifier", value: "pub-id" },
    ]);
    const metadataElement = findChildElement(
      packageElement.children,
      "metadata",
    );
    if (metadataElement === undefined) {
      throw new Error("expected a <metadata> element");
    }
    expect(metadataElement.attributes).toEqual([
      { name: "xmlns:dc", value: "http://purl.org/dc/elements/1.1/" },
    ]);
    const identifierElement = findChildElement(
      metadataElement.children,
      "dc:identifier",
    );
    if (identifierElement === undefined) {
      throw new Error("expected a <dc:identifier> element");
    }
    expect(identifierElement.attributes).toEqual([
      { name: "id", value: "pub-id" },
    ]);
    expect(identifierElement.children).toEqual([
      { type: "text", value: "urn:uuid:abc" },
    ]);
    const manifestElement = findChildElement(
      packageElement.children,
      "manifest",
    );
    if (manifestElement === undefined) {
      throw new Error("expected a <manifest> element");
    }
    const item = findChildElement(manifestElement.children, "item");
    if (item === undefined) {
      throw new Error("expected an <item> element");
    }
    expect(item.attributes.map((a) => a.name)).not.toContain("properties");
  });
});
