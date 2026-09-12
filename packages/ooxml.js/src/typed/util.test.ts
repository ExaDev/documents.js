import { describe, expect, it } from "vitest";
import { relsPathFor, resolveRelTarget } from "./util";

describe("relsPathFor", () => {
  it("splits a slash-containing part path into its directory and file name", () => {
    expect(relsPathFor("word/document.xml")).toBe(
      "word/_rels/document.xml.rels",
    );
  });

  it("uses an empty directory for a part path with no slash at all", () => {
    expect(relsPathFor("document.xml")).toBe("/_rels/document.xml.rels");
  });

  it("uses the LAST slash to split a nested part path, not the first", () => {
    expect(relsPathFor("xl/drawings/drawing1.xml")).toBe(
      "xl/drawings/_rels/drawing1.xml.rels",
    );
  });
});

describe("resolveRelTarget", () => {
  it("strips a leading slash from a package-rooted target, ignoring the subject part's own directory", () => {
    expect(resolveRelTarget("word/document.xml", "/media/image1.png")).toBe(
      "media/image1.png",
    );
  });

  it("resolves a relative target against the subject part's own directory", () => {
    expect(resolveRelTarget("word/document.xml", "media/image1.png")).toBe(
      "word/media/image1.png",
    );
  });

  it("resolves a relative target against an empty directory when the subject part path has no slash", () => {
    expect(resolveRelTarget("document.xml", "media/image1.png")).toBe(
      "media/image1.png",
    );
  });

  it("resolves a nested subject part's own directory correctly (the LAST slash, not the first)", () => {
    expect(
      resolveRelTarget("word/embeddings/oleObject1.bin", "image1.png"),
    ).toBe("word/embeddings/image1.png");
  });

  it("pops the enclosing directory for a leading '../' segment", () => {
    expect(
      resolveRelTarget("word/embeddings/oleObject1.bin", "../media/image1.png"),
    ).toBe("word/media/image1.png");
  });

  it("skips a '.' current-directory segment", () => {
    expect(resolveRelTarget("word/document.xml", "./media/image1.png")).toBe(
      "word/media/image1.png",
    );
  });

  it("skips an empty segment produced by a doubled slash", () => {
    expect(resolveRelTarget("word/document.xml", "media//image1.png")).toBe(
      "word/media/image1.png",
    );
  });
});
