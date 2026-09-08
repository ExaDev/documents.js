import { describe, expect, it } from "vitest";
import { z } from "zod";
import { EPUB_MIME_TYPE, OCF_MIMETYPE_PATH } from "./format";
import { decodePackage, encodePackage, packageCodec } from "./codec";
import {
  assertMimetypeEntryLayout,
  localFileHeaderNames,
} from "./test-support/zip";
import { zipPackage, type ZipEntry } from "./zip";

// The lossless byte-level Package model (ExaDev/documents.js#963): decodePackage/encodePackage's own core round-trip guarantee, exercised independently of any ContentDocument/DocumentTree mapping -- src/roundtrip.test.ts's own identically-named file (no hyphen) covers THAT higher, lossy level; this file covers only the Package model itself, mirroring odf.js's own round-trip.test.ts precedent for the identical OCF-style mimetype-first/stored requirement.

function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

const CONTAINER_XML =
  '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';

const CHAPTER1_XHTML =
  '<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Hello &amp; world</p></body></html>';

const PNG_BYTES: Uint8Array<ArrayBuffer> = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5,
]);

// Deliberately scrambled -- mimetype is neither first nor adjacent to META-INF/container.xml here -- so a test built on this fixture proves serializePackage's hoisting is driven by part identity, not by preserving whatever order the input happened to arrive in.
function epubEntries(): [string, ZipEntry][] {
  return [
    ["OEBPS/chapter1.xhtml", { bytes: enc(CHAPTER1_XHTML) }],
    ["OEBPS/images/cover.png", { bytes: PNG_BYTES }],
    ["META-INF/container.xml", { bytes: enc(CONTAINER_XML) }],
    [OCF_MIMETYPE_PATH, { bytes: enc(EPUB_MIME_TYPE), stored: true }],
  ];
}

describe("package round-trip (decode -> encode -> decode)", () => {
  it("is idempotent", () => {
    const pkg1 = decodePackage(zipPackage(epubEntries()));
    const pkg2 = decodePackage(encodePackage(pkg1));
    expect(pkg2).toEqual(pkg1);
  });

  it("preserves the part set", () => {
    const entries = epubEntries();
    const pkg1 = decodePackage(zipPackage(entries));
    expect(Object.keys(pkg1.parts).sort()).toEqual(
      entries.map(([path]) => path).sort(),
    );
  });

  it("binary part round-trips losslessly", () => {
    const pkg1 = decodePackage(zipPackage(epubEntries()));
    const binary = pkg1.parts["OEBPS/images/cover.png"];
    expect(binary?.kind === "binary").toBe(true);
    const pkg2 = decodePackage(encodePackage(pkg1));
    expect(pkg2.parts["OEBPS/images/cover.png"]).toEqual(binary);
  });

  it("XML part preserves entities and structure", () => {
    const pkg = decodePackage(zipPackage(epubEntries()));
    const chapter = pkg.parts["OEBPS/chapter1.xhtml"];
    expect(chapter?.kind === "xml").toBe(true);
    if (chapter?.kind === "xml") {
      const serialised = JSON.stringify(chapter);
      expect(serialised).toContain("Hello &amp; world");
      expect(serialised).toContain('"tag":"body"');
    }
  });
});

// serializePackage's one deliberate departure from a generic zip-of-XML writer: OCF's mimetype-first-stored requirement (EPUB 3.3 section 6.3, and see zip.test.ts's own byte-offset test).
describe("serializePackage: mimetype hoisting", () => {
  it("emits mimetype first, regardless of input key order", () => {
    const pkg = decodePackage(zipPackage(epubEntries()));
    const bytes = encodePackage(pkg);
    const names = localFileHeaderNames(bytes);
    expect(names[0]).toBe(OCF_MIMETYPE_PATH);
    expect(names.slice(1).sort()).toEqual(
      [
        "META-INF/container.xml",
        "OEBPS/chapter1.xhtml",
        "OEBPS/images/cover.png",
      ].sort(),
    );
  });

  it("stores the mimetype entry uncompressed at the exact byte offsets OCF requires, even though the input zip did not necessarily have it first", () => {
    const pkg = decodePackage(zipPackage(epubEntries()));
    const bytes = encodePackage(pkg);
    assertMimetypeEntryLayout(bytes, EPUB_MIME_TYPE);
  });

  it("never fabricates a mimetype part that was not present in the input", () => {
    const pkg = decodePackage(
      zipPackage([["META-INF/container.xml", { bytes: enc(CONTAINER_XML) }]]),
    );
    const bytes = encodePackage(pkg);
    expect(localFileHeaderNames(bytes)).toEqual(["META-INF/container.xml"]);
  });
});

describe("packageCodec schema validation", () => {
  it("rejects bytes that are not a valid zip archive", () => {
    expect(() =>
      z.decode(packageCodec, new Uint8Array([0, 1, 2, 3])),
    ).toThrow();
  });
});
