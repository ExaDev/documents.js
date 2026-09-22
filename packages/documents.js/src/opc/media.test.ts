import type { Package } from "ooxml.js";
import {
  attr,
  base64ToBytes,
  resolveRelationships,
  rootElement,
} from "ooxml.js";
import { describe, expect, it } from "vitest";
import { findChildElements } from "../xml/query";
import { addImageMedia, nextMediaIndex } from "./media";

function emptyPackage(): Package {
  return { parts: {} };
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

describe("addImageMedia", () => {
  it("adds the binary part, a content-type default, and a relationship together", () => {
    const pkg = emptyPackage();
    const added = addImageMedia(
      pkg,
      "word/document.xml",
      "word/media",
      "png",
      PNG_BYTES,
    );

    expect(added.partPath).toBe("word/media/image1.png");
    const part = pkg.parts["word/media/image1.png"];
    expect(part?.kind).toBe("binary");
    expect(
      part?.kind === "binary" ? base64ToBytes(part.base64) : undefined,
    ).toEqual(PNG_BYTES);

    const contentTypesRoot = rootElement(pkg.parts["[Content_Types].xml"]);
    expect(contentTypesRoot).toBeDefined();
    const defaults =
      contentTypesRoot === undefined
        ? []
        : findChildElements(contentTypesRoot.children, "Default");
    expect(defaults.some((d) => attr(d.node, "Extension") === "png")).toBe(
      true,
    );

    const rels = resolveRelationships(pkg, "word/document.xml");
    expect(rels.get(added.relationshipId)?.target).toBe(
      "word/media/image1.png",
    );
  });

  it("numbers successive images without colliding, even across formats", () => {
    const pkg = emptyPackage();
    const first = addImageMedia(
      pkg,
      "word/document.xml",
      "word/media",
      "png",
      PNG_BYTES,
    );
    const second = addImageMedia(
      pkg,
      "word/document.xml",
      "word/media",
      "png",
      PNG_BYTES,
    );
    expect(first.partPath).toBe("word/media/image1.png");
    expect(second.partPath).toBe("word/media/image2.png");
  });

  it("resolves a pptx media path relative to a slide one directory down", () => {
    const pkg = emptyPackage();
    const added = addImageMedia(
      pkg,
      "ppt/slides/slide1.xml",
      "ppt/media",
      "jpeg",
      PNG_BYTES,
    );
    const rels = resolveRelationships(pkg, "ppt/slides/slide1.xml");
    expect(rels.get(added.relationshipId)?.target).toBe(
      "ppt/media/image1.jpeg",
    );
  });

  it("does not add a duplicate [Content_Types].xml Default entry for a second image of the same format", () => {
    const pkg = emptyPackage();
    addImageMedia(pkg, "word/document.xml", "word/media", "png", PNG_BYTES);
    addImageMedia(pkg, "word/document.xml", "word/media", "png", PNG_BYTES);
    const contentTypesRoot = rootElement(pkg.parts["[Content_Types].xml"]);
    const defaults =
      contentTypesRoot === undefined
        ? []
        : findChildElements(contentTypesRoot.children, "Default");
    expect(
      defaults.filter((d) => attr(d.node, "Extension") === "png"),
    ).toHaveLength(1);
  });
});

describe("nextMediaIndex", () => {
  it("ignores a same-named file outside the given media directory", () => {
    const pkg: Package = {
      parts: {
        "ppt/media/image9.png": { kind: "binary", base64: "" },
      },
    };
    expect(nextMediaIndex(pkg, "word/media", "image", "png")).toBe(1);
  });

  it("continues from a pre-existing higher index rather than starting from 1", () => {
    const pkg: Package = {
      parts: {
        "word/media/image5.png": { kind: "binary", base64: "" },
      },
    };
    expect(nextMediaIndex(pkg, "word/media", "image", "png")).toBe(6);
  });

  it("does not let an extension containing a regex-special character match unrelated files", () => {
    // "p.g" contains a literal dot — if escapeRegExp's own replacement text were dropped (turning the escape into a no-op deletion instead), the built pattern's dot would match ANY character, wrongly matching "pXg" too.
    const pkg: Package = {
      parts: {
        "word/media/image1.pXg": { kind: "binary", base64: "" },
      },
    };
    expect(nextMediaIndex(pkg, "word/media", "image", "p.g")).toBe(1);
  });

  it("still matches an extension containing a regex-special character against its own literal spelling", () => {
    // "p+g" contains a literal plus — if escapeRegExp deleted the special character instead of escaping it, the built pattern would require the literal text "pg" and this genuinely matching "p+g" part would be missed.
    const pkg: Package = {
      parts: {
        "word/media/image1.p+g": { kind: "binary", base64: "" },
      },
    };
    expect(nextMediaIndex(pkg, "word/media", "image", "p+g")).toBe(2);
  });

  // "word/mediaXimage5.png" is exactly as long as "word/media/" ("word/mediaX" is 11 characters, matching "word/media/"'s own 11), so slicing it at the media-directory-prefix length spells "image5.png" by coincidence — deliberately exercising the same prefix-check coincidence as src/odf-package/media.test.ts's own nextPictureIndex case, for the sibling OOXML-side implementation.
  it("ignores a same-named file outside the media directory even when slicing its path at the prefix length would coincidentally spell a valid image filename", () => {
    const pkg: Package = {
      parts: {
        "word/media/image1.png": { kind: "binary", base64: "" },
        "word/mediaXimage5.png": { kind: "binary", base64: "" },
      },
    };
    expect(nextMediaIndex(pkg, "word/media", "image", "png")).toBe(2);
  });
});
