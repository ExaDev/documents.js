import type { Package } from "odf.js";
import {
  base64ToBytes,
  decodePackage,
  encodePackage,
  readManifest,
  setDocumentMediaType,
} from "odf.js";
import { describe, expect, it } from "vitest";
import { addImageMedia, nextPictureIndex } from "./media";

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

describe("nextPictureIndex", () => {
  it("ignores a same-named file outside Pictures/", () => {
    const pkg: Package = {
      parts: { "Other/image9.png": { kind: "binary", base64: "" } },
    };
    expect(nextPictureIndex(pkg, "png")).toBe(1);
  });

  it("continues from a pre-existing higher index rather than starting from 1", () => {
    const pkg: Package = {
      parts: { "Pictures/image5.png": { kind: "binary", base64: "" } },
    };
    expect(nextPictureIndex(pkg, "png")).toBe(6);
  });

  it("does not let an extension containing a regex-special character match unrelated files", () => {
    const pkg: Package = {
      parts: { "Pictures/image1.pXg": { kind: "binary", base64: "" } },
    };
    expect(nextPictureIndex(pkg, "p.g")).toBe(1);
  });

  // "Pictures0image5.png" is 9 characters ("Pictures0") ahead of a slice that -- once the leading "Pictures/" (also 9 characters) is stripped off a real Pictures/ path -- looks exactly like "image5.png". A path-prefix check that only LOOKED at whether the loop should skip a part, without actually gating the pattern match against it, would still slice this non-Pictures path at the same fixed offset and misread it as Pictures/image5.png -- this path is deliberately crafted so that coincidence is exercised, unlike a plain "Other/imageN.ext" path (whose own 9-character-in slice does not happen to spell a valid image filename).
  it("ignores a same-named file outside Pictures/ even when slicing its path at the Pictures/ prefix length would coincidentally spell a valid image filename", () => {
    const pkg: Package = {
      parts: {
        "Pictures/image1.png": { kind: "binary", base64: "" },
        "Pictures0image5.png": { kind: "binary", base64: "" },
      },
    };
    expect(nextPictureIndex(pkg, "png")).toBe(2);
  });
});
