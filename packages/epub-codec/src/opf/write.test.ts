import { describe, expect, it } from "vitest";
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
});
