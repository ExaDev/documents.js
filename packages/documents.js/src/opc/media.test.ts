import type { Package } from "ooxml.js";
import {
  attr,
  base64ToBytes,
  resolveRelationships,
  rootElement,
} from "ooxml.js";
import { describe, expect, it } from "vitest";
import { findChildElements } from "../xml/query";
import { addImageMedia } from "./media";

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
