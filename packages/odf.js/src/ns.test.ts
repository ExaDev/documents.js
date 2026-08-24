import { describe, expect, it } from "vitest";
import { ODF_NAMESPACES, xmlnsAttributes } from "./ns";

// Every value here was verified directly against real LibreOffice-produced parts (see ns.ts's own top-of-file comment) -- these tests pin the exact strings so a future edit can't silently regress to a pattern-matched guess.
describe("ODF_NAMESPACES", () => {
  it("pins the three namespaces that are easy to get wrong by pattern-matching the prefix", () => {
    expect(ODF_NAMESPACES.draw).toBe(
      "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0",
    );
    expect(ODF_NAMESPACES.number).toBe(
      "urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0",
    );
    expect(ODF_NAMESPACES.fo).toBe(
      "urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0",
    );
    expect(ODF_NAMESPACES.svg).toBe(
      "urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0",
    );
    expect(ODF_NAMESPACES.smil).toBe(
      "urn:oasis:names:tc:opendocument:xmlns:smil-compatible:1.0",
    );
  });

  it('reuses the real W3C namespace URIs as-is, not an OASIS-minted "-compatible" variant', () => {
    expect(ODF_NAMESPACES.xlink).toBe("http://www.w3.org/1999/xlink");
    expect(ODF_NAMESPACES.dc).toBe("http://purl.org/dc/elements/1.1/");
    expect(ODF_NAMESPACES.math).toBe("http://www.w3.org/1998/Math/MathML");
    expect(ODF_NAMESPACES.xforms).toBe("http://www.w3.org/2002/xforms");
    expect(ODF_NAMESPACES.xsd).toBe("http://www.w3.org/2001/XMLSchema");
    expect(ODF_NAMESPACES.xsi).toBe(
      "http://www.w3.org/2001/XMLSchema-instance",
    );
  });

  it("pins the core OASIS-owned namespaces used by content.xml/manifest.xml", () => {
    expect(ODF_NAMESPACES.office).toBe(
      "urn:oasis:names:tc:opendocument:xmlns:office:1.0",
    );
    expect(ODF_NAMESPACES.style).toBe(
      "urn:oasis:names:tc:opendocument:xmlns:style:1.0",
    );
    expect(ODF_NAMESPACES.text).toBe(
      "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
    );
    expect(ODF_NAMESPACES.table).toBe(
      "urn:oasis:names:tc:opendocument:xmlns:table:1.0",
    );
    expect(ODF_NAMESPACES.meta).toBe(
      "urn:oasis:names:tc:opendocument:xmlns:meta:1.0",
    );
    expect(ODF_NAMESPACES.manifest).toBe(
      "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0",
    );
    expect(ODF_NAMESPACES.presentation).toBe(
      "urn:oasis:names:tc:opendocument:xmlns:presentation:1.0",
    );
  });

  it('every namespace URI is version-pinned at ":1.0" or a fixed "-compatible" suffix, never a document-version-dependent number -- except rpt:, which predates OASIS standardisation and keeps its own openoffice.org-hosted URI unchanged', () => {
    for (const [prefix, uri] of Object.entries(ODF_NAMESPACES)) {
      expect(
        uri.endsWith(":1.0") ||
          uri.startsWith("http://www.w3.org/") ||
          uri.startsWith("http://purl.org/") ||
          uri.startsWith("http://openoffice.org/"),
        `${prefix} -> ${uri}`,
      ).toBe(true);
    }
  });

  it("pins rpt: (OpenOffice.org Report Builder) to its real, non-OASIS namespace, verified from LibreOffice's own bundled reportbuilder.jar class constant pool strings", () => {
    expect(ODF_NAMESPACES.rpt).toBe("http://openoffice.org/2005/report");
  });
});

describe("xmlnsAttributes", () => {
  it("builds an ordered xmlns:<prefix> attribute map for the given prefixes", () => {
    expect(xmlnsAttributes(["office", "text"])).toEqual({
      "xmlns:office": "urn:oasis:names:tc:opendocument:xmlns:office:1.0",
      "xmlns:text": "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
    });
  });

  it("preserves the given prefix order in the resulting object", () => {
    const keys = Object.keys(xmlnsAttributes(["manifest", "office", "draw"]));
    expect(keys).toEqual(["xmlns:manifest", "xmlns:office", "xmlns:draw"]);
  });

  it("returns an empty object for an empty prefix list", () => {
    expect(xmlnsAttributes([])).toEqual({});
  });
});
