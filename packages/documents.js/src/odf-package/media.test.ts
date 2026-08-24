import type { Package } from "odf.js";
import {
  base64ToBytes,
  decodePackage,
  encodePackage,
  readManifest,
  setDocumentMediaType,
} from "odf.js";
import { describe, expect, it } from "vitest";
import { addImageMedia } from "./media";

const ODT_MEDIA_TYPE = "application/vnd.oasis.opendocument.text";
const PNG_BYTES: Uint8Array<ArrayBuffer> = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);
const JPEG_BYTES: Uint8Array<ArrayBuffer> = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 1, 2, 3,
]);

// A minimal, real-shaped .odt-in-progress package: mimetype + content.xml, no manifest.xml yet -- the state a caller is in partway through building a document, once its document media type is established but before its first image is added.
function baseOdtPackage(): Package {
  const pkg: Package = { parts: { "content.xml": { kind: "xml", nodes: [] } } };
  setDocumentMediaType(pkg, ODT_MEDIA_TYPE);
  return pkg;
}

describe("addImageMedia", () => {
  it("adds the binary part under Pictures/ and a matching manifest entry, verified by round-tripping through encodePackage/decodePackage", () => {
    const pkg = baseOdtPackage();
    const added = addImageMedia(pkg, PNG_BYTES, "png");
    expect(added.partPath).toBe("Pictures/image1.png");

    const roundTripped = decodePackage(encodePackage(pkg));

    const part = roundTripped.parts["Pictures/image1.png"];
    expect(part?.kind).toBe("binary");
    expect(
      part?.kind === "binary" ? base64ToBytes(part.base64) : undefined,
    ).toEqual(PNG_BYTES);

    const manifest = readManifest(roundTripped);
    expect(
      manifest.entries.find(
        (entry) => entry.fullPath === "Pictures/image1.png",
      ),
    ).toEqual({
      fullPath: "Pictures/image1.png",
      mediaType: "image/png",
    });
  });

  it("numbers successive same-format images without colliding", () => {
    const pkg = baseOdtPackage();
    const first = addImageMedia(pkg, PNG_BYTES, "png");
    const second = addImageMedia(pkg, PNG_BYTES, "png");
    expect(first.partPath).toBe("Pictures/image1.png");
    expect(second.partPath).toBe("Pictures/image2.png");
  });

  it("numbers each format own images independently", () => {
    const pkg = baseOdtPackage();
    const png = addImageMedia(pkg, PNG_BYTES, "png");
    const jpeg = addImageMedia(pkg, JPEG_BYTES, "jpeg");
    expect(png.partPath).toBe("Pictures/image1.png");
    expect(jpeg.partPath).toBe("Pictures/image1.jpeg");

    const manifest = readManifest(pkg);
    expect(
      manifest.entries.find(
        (entry) => entry.fullPath === "Pictures/image1.jpeg",
      )?.mediaType,
    ).toBe("image/jpeg");
  });

  it("keeps every previously added image listed in the manifest after a later image is added", () => {
    const pkg = baseOdtPackage();
    addImageMedia(pkg, PNG_BYTES, "png");
    addImageMedia(pkg, JPEG_BYTES, "jpeg");
    const manifest = readManifest(pkg);
    const paths = manifest.entries.map((entry) => entry.fullPath).sort();
    expect(paths).toEqual(
      [
        "/",
        "Pictures/image1.jpeg",
        "Pictures/image1.png",
        "content.xml",
      ].sort(),
    );
  });

  it("throws when the package has no known document media type yet", () => {
    const pkg: Package = { parts: {} };
    expect(() => addImageMedia(pkg, PNG_BYTES, "png")).toThrow(
      /documentMediaType/,
    );
  });
});
