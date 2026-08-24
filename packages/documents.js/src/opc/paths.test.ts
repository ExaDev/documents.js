import { describe, expect, it } from "vitest";
import { buildRelativeTarget, relsPathFor } from "./paths";

describe("relsPathFor", () => {
  it("builds the .rels path alongside the part, prefixed by _rels", () => {
    expect(relsPathFor("word/document.xml")).toBe(
      "word/_rels/document.xml.rels",
    );
    expect(relsPathFor("ppt/slides/slide1.xml")).toBe(
      "ppt/slides/_rels/slide1.xml.rels",
    );
  });

  it("handles a root-level part with no directory", () => {
    expect(relsPathFor("document.xml")).toBe("/_rels/document.xml.rels");
  });
});

describe("buildRelativeTarget", () => {
  it("targets a sibling media directory with no ups", () => {
    expect(
      buildRelativeTarget("word/document.xml", "word/media/image1.png"),
    ).toBe("media/image1.png");
  });

  it("targets a media directory one level up", () => {
    expect(
      buildRelativeTarget("ppt/slides/slide1.xml", "ppt/media/image1.png"),
    ).toBe("../media/image1.png");
  });

  it("targets a part in the same directory", () => {
    expect(buildRelativeTarget("word/document.xml", "word/styles.xml")).toBe(
      "styles.xml",
    );
  });

  it("targets a deeper nested directory from a shallower one", () => {
    expect(
      buildRelativeTarget("ppt/presentation.xml", "ppt/slides/slide1.xml"),
    ).toBe("slides/slide1.xml");
  });
});
