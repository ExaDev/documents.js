import {
  attr,
  decodePackage,
  resolveRelationships,
  rootElement,
} from "ooxml.js";
import { describe, expect, it } from "vitest";
import { readPptxContent } from "../../ooxml/pptx/read";
import { createPptx } from "./editor";

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);

describe("PptxSlide.addImage media wiring", () => {
  it("adds the media part, content-type default, and a relationship from the slide to it", () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    slide.addImage({
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 },
      format: "png",
      bytes: PNG_BYTES,
    });

    const pkg = editor.toPackage();
    expect(pkg.parts["ppt/media/image1.png"]).toBeDefined();

    const contentTypesRoot = rootElement(pkg.parts["[Content_Types].xml"]);
    const hasDefault = contentTypesRoot?.children.some(
      (c) =>
        c.type === "element" &&
        c.tag === "Default" &&
        attr(c, "Extension") === "png",
    );
    expect(hasDefault).toBe(true);

    const rels = resolveRelationships(pkg, "ppt/slides/slide1.xml");
    const imageRel = [...rels.values()].find(
      (r) => r.target === "ppt/media/image1.png",
    );
    expect(imageRel).toBeDefined();
  });

  it("numbers successive images across slides without colliding", () => {
    const editor = createPptx();
    const slide1 = editor.addSlide();
    const slide2 = editor.addSlide();
    slide1.addImage({
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      format: "png",
      bytes: PNG_BYTES,
    });
    slide2.addImage({
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      format: "png",
      bytes: PNG_BYTES,
    });
    const pkg = editor.toPackage();
    expect(pkg.parts["ppt/media/image1.png"]).toBeDefined();
    expect(pkg.parts["ppt/media/image2.png"]).toBeDefined();
  });

  it("round-trips altText through p:cNvPr/@descr and readPptxContent", () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    slide.addImage({
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 },
      format: "png",
      bytes: PNG_BYTES,
      altText: "A red circle on a white background",
    });

    const content = readPptxContent(decodePackage(editor.toBytes()));
    if (content.kind !== "presentation") {
      throw new Error("expected a presentation ContentDocument");
    }
    const image = content.slides[0]?.shapes[0]?.blocks[0];
    expect(image?.kind).toBe("image");
    expect(image?.kind === "image" ? image.altText : undefined).toBe(
      "A red circle on a white background",
    );
  });

  it("omits p:cNvPr/@descr, and reads back no altText, when none is given", () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    slide.addImage({
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 },
      format: "png",
      bytes: PNG_BYTES,
    });

    const content = readPptxContent(decodePackage(editor.toBytes()));
    if (content.kind !== "presentation") {
      throw new Error("expected a presentation ContentDocument");
    }
    const image = content.slides[0]?.shapes[0]?.blocks[0];
    expect(image?.kind).toBe("image");
    expect(image?.kind === "image" ? image.altText : undefined).toBeUndefined();
  });
});
