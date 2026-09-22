import { unzipPackage } from "odf.js";
import { describe, expect, it } from "vitest";
import { chapterOdtBytes, odmBytes } from "./odm-fixture";

// content.xml is written through zipPackage with no `stored: true`, so it is genuinely deflate-compressed in the zip — decoding the raw zip bytes as text (as assertMimetypeEntryLayout deliberately does for the mimetype entry) never recovers its real markup. unzipPackage inflates it back to the real bytes odmContentXml/chapterContentXml produced.
function contentXmlText(bytes: Uint8Array<ArrayBuffer>): string {
  const unzipped = unzipPackage(bytes);
  const contentXml = unzipped["content.xml"];
  if (contentXml === undefined) {
    throw new Error("expected a content.xml entry in the zip");
  }
  return new TextDecoder().decode(contentXml);
}

// ODF (OASIS Open Document Format Part 3, "Packages") requires the "mimetype" part to be the zip's very first entry, stored uncompressed with a zero-length extra field, so a reader can identify the container's media type from fixed byte offsets alone. Checked directly against the raw zip bytes (a DataView over the local file header, not odf.js's own unzipPackage, which normalises stored vs deflated content away entirely) — otherwise nothing pins the entry's own name or its "stored" flag, both of which a real ODF-consuming reader depends on. Duplicated from src/test-support/odf-formula-fixture.test.ts's own identical helper rather than shared, since both are small, test-only, and pin two genuinely separate fixtures.
function assertMimetypeEntryLayout(bytes: Uint8Array, mediaType: string): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  expect(
    Array.from(bytes.subarray(0, 4)),
    "local file header signature",
  ).toEqual([0x50, 0x4b, 0x03, 0x04]);
  expect(view.getUint16(8, true), "compression method (0 = stored)").toBe(0);
  const filenameLength = view.getUint16(26, true);
  expect(filenameLength, 'filename length ("mimetype".length)').toBe(8);
  expect(view.getUint16(28, true), "extra field length").toBe(0);
  expect(
    decoder.decode(bytes.subarray(30, 30 + filenameLength)),
    "filename bytes",
  ).toBe("mimetype");
  const contentStart = 30 + filenameLength;
  expect(
    decoder.decode(
      bytes.subarray(contentStart, contentStart + mediaType.length),
    ),
    "mimetype content bytes",
  ).toBe(mediaType);
}

describe("odmBytes", () => {
  it("places a stored mimetype entry declaring the real ODF master-document media type first", () => {
    assertMimetypeEntryLayout(
      odmBytes([{ name: "Chapter1", href: "chapter1.odt" }]),
      "application/vnd.oasis.opendocument.text-master",
    );
  });

  it("joins multiple sections directly adjacent, with no separator between them", () => {
    const bytes = odmBytes([
      { name: "One", href: "one.odt" },
      { name: "Two", href: "two.odt" },
    ]);
    const text = contentXmlText(bytes);
    // The two text:section elements sit back to back in source order — a non-empty join separator (e.g. Stryker's own canary string) would appear literally between </text:section> and the next <text:section, which this substring search would catch directly.
    expect(text).toContain(
      '<text:section text:name="One">' +
        '<text:section-source xlink:href="one.odt" text:filter-name="writer8"/>' +
        "</text:section>" +
        '<text:section text:name="Two">' +
        '<text:section-source xlink:href="two.odt" text:filter-name="writer8"/>' +
        "</text:section>",
    );
  });

  it("declares zero sections as an empty office:text body, not an error", () => {
    expect(contentXmlText(odmBytes([]))).toContain(
      "<office:text></office:text>",
    );
  });
});

describe("chapterOdtBytes", () => {
  it("places a stored mimetype entry declaring the real ODF text media type first", () => {
    assertMimetypeEntryLayout(
      chapterOdtBytes("Heading", "Body"),
      "application/vnd.oasis.opendocument.text",
    );
  });

  it("writes the given heading and body text into a single-section chapter", () => {
    const text = contentXmlText(
      chapterOdtBytes("Chapter One", "Once upon a time."),
    );
    expect(text).toContain(
      '<text:h text:outline-level="1">Chapter One</text:h>',
    );
    expect(text).toContain("<text:p>Once upon a time.</text:p>");
  });
});
