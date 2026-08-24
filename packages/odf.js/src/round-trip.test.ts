import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  decodePackage,
  encodePackage,
  packageCodec,
  xmlCodec,
  zipPackage,
  type ZipEntry,
} from "./index";
import {
  assertMimetypeEntryLayout,
  localFileHeaderNames,
} from "./test-support/zip";

function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

const MIMETYPE_ODT = "application/vnd.oasis.opendocument.text";

const MANIFEST_ODT = enc(
  '<?xml version="1.0" encoding="UTF-8"?>\n<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="Pictures/image1.png" manifest:media-type="image/png"/></manifest:manifest>',
);

const CONTENT_ODT = enc(
  '<?xml version="1.0" encoding="UTF-8"?>\n<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:p>Hello &amp; world</text:p></office:text></office:body></office:document-content>',
);

const PNG_BYTES: Uint8Array<ArrayBuffer> = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5,
]);

// Deliberately scrambled -- mimetype and META-INF/manifest.xml are neither first nor adjacent here -- so a test built on this fixture proves serializePackage's hoisting is driven by part identity, not by preserving whatever order the input happened to arrive in.
function odtEntries(): [string, ZipEntry][] {
  return [
    ["content.xml", { bytes: CONTENT_ODT }],
    ["Pictures/image1.png", { bytes: PNG_BYTES }],
    ["META-INF/manifest.xml", { bytes: MANIFEST_ODT }],
    ["mimetype", { bytes: enc(MIMETYPE_ODT), stored: true }],
  ];
}

// The core guarantee: decode -> encode -> decode is idempotent, so the Package model is a fixed point and the encoded bytes carry the same content as the decoded input.
describe("package round-trip (decode -> encode -> decode)", () => {
  it("is idempotent", () => {
    const pkg1 = decodePackage(zipPackage(odtEntries()));
    const pkg2 = decodePackage(encodePackage(pkg1));
    expect(pkg2).toEqual(pkg1);
  });

  it("preserves the part set", () => {
    const entries = odtEntries();
    const pkg1 = decodePackage(zipPackage(entries));
    expect(Object.keys(pkg1.parts).sort()).toEqual(
      entries.map(([path]) => path).sort(),
    );
  });

  it("binary part round-trips losslessly", () => {
    const pkg1 = decodePackage(zipPackage(odtEntries()));
    const binary = pkg1.parts["Pictures/image1.png"];
    expect(binary?.kind === "binary").toBe(true);
    const pkg2 = decodePackage(encodePackage(pkg1));
    expect(pkg2.parts["Pictures/image1.png"]).toEqual(binary);
  });

  it("XML part preserves namespaced attributes and entities", () => {
    const pkg = decodePackage(zipPackage(odtEntries()));
    const content = pkg.parts["content.xml"];
    expect(content?.kind === "xml").toBe(true);
    if (content?.kind === "xml") {
      const serialised = JSON.stringify(content);
      expect(serialised).toContain("Hello &amp; world");
      expect(serialised).toContain("text:p");
    }
  });
});

// serializePackage's one deliberate departure from a generic zip-of-XML writer: ODF's mimetype-first-stored requirement (see package-io/write.ts and zip.test.ts's byte-offset test).
describe("serializePackage: mimetype/manifest hoisting", () => {
  it("emits mimetype first and META-INF/manifest.xml second, regardless of input key order", () => {
    const pkg = decodePackage(zipPackage(odtEntries()));
    const bytes = encodePackage(pkg);
    const names = localFileHeaderNames(bytes);
    expect(names[0]).toBe("mimetype");
    expect(names[1]).toBe("META-INF/manifest.xml");
    expect(names.slice(2).sort()).toEqual([
      "Pictures/image1.png",
      "content.xml",
    ]);
  });

  it("stores the mimetype entry uncompressed at the exact byte offsets ODF requires, even though the input zip did not necessarily have it first", () => {
    const pkg = decodePackage(zipPackage(odtEntries()));
    const bytes = encodePackage(pkg);
    assertMimetypeEntryLayout(bytes, MIMETYPE_ODT);
  });

  it("never fabricates a mimetype or manifest part that was not present in the input", () => {
    const pkg = decodePackage(
      zipPackage([["content.xml", { bytes: CONTENT_ODT }]]),
    );
    const bytes = encodePackage(pkg);
    expect(localFileHeaderNames(bytes)).toEqual(["content.xml"]);
  });
});

describe("packageCodec / xmlCodec schema validation", () => {
  it("packageCodec rejects bytes that are not a valid zip archive", () => {
    expect(() =>
      z.decode(packageCodec, new Uint8Array([0, 1, 2, 3])),
    ).toThrow();
  });

  it("xmlCodec round-trips a node forest through XML text", () => {
    const nodes = z.decode(xmlCodec, '<a x="1"><b>text</b></a>');
    const xml = z.encode(xmlCodec, nodes);
    expect(z.decode(xmlCodec, xml)).toEqual(nodes);
  });
});
