import { unzipPackage } from "odf.js";
import { describe, expect, it } from "vitest";
import { chapterOdtBytes, odmBytes } from "./odm-fixture";

// odmBytes's own two-or-more-section concatenation is not observable through odmToPdfOperation itself: odf.js's readOdm (typed/odm/read.ts) walks office:text's own children looking for element nodes whose tag is "text:section", explicitly skipping any non-element child -- so a stray text node landing between two sections (a broken join separator, say) is silently ignored by every real reader in the family. These tests instead pin the exact bytes odmBytes/chapterOdtBytes build, the one place that concatenation is actually checkable at all.
function decodeXmlPart(bytes: Uint8Array<ArrayBuffer>, path: string): string {
  const parts = unzipPackage(bytes);
  const part = parts[path];
  if (part === undefined) {
    throw new Error(`decodeXmlPart: no "${path}" entry in this zip`);
  }
  return new TextDecoder().decode(part);
}

describe("odmBytes", () => {
  it("concatenates several sections back to back with no separator between them", () => {
    const xml = decodeXmlPart(
      odmBytes([
        { name: "ch1", href: "../chapter1.odt" },
        { name: "ch2", href: "../chapter2.odt" },
      ]),
      "content.xml",
    );

    expect(xml).toContain(
      '<text:section text:name="ch1"><text:section-source xlink:href="../chapter1.odt" text:filter-name="writer8"/></text:section>' +
        '<text:section text:name="ch2"><text:section-source xlink:href="../chapter2.odt" text:filter-name="writer8"/></text:section>',
    );
  });

  it("emits no sections at all for an empty chapter list", () => {
    const xml = decodeXmlPart(odmBytes([]), "content.xml");

    expect(xml).toContain("<office:text></office:text>");
  });
});

describe("chapterOdtBytes", () => {
  it("builds a heading and a paragraph carrying the given text", () => {
    const xml = decodeXmlPart(
      chapterOdtBytes("Chapter One", "Chapter body text."),
      "content.xml",
    );

    expect(xml).toContain(
      '<text:h text:outline-level="1">Chapter One</text:h><text:p>Chapter body text.</text:p>',
    );
  });
});
