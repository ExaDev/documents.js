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

  // A single-character directory puts the slash at index 1 — deliberately exercising a genuinely different lastSlash value from the -1/no-slash case above, so a mutation swapping which index the filename split point compares against would extract the whole path as the filename rather than just the part after the slash.
  it("splits correctly when the directory is a single character", () => {
    expect(relsPathFor("a/file.xml")).toBe("a/_rels/file.xml.rels");
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

  it("targets a nested part from a root-level part with no directory of its own", () => {
    expect(buildRelativeTarget("document.xml", "word/document.xml")).toBe(
      "word/document.xml",
    );
  });

  // Both parts share the identical, fully-matching directory chain ("a/b"), so the common-prefix scan runs all the way to that shared length on both sides at once — the one case where the two length bounds stop protecting each other (see buildRelativeTarget's own comment on combinedLimit).
  it("targets a sibling part in a two-level-deep identical directory chain", () => {
    expect(buildRelativeTarget("a/b/x.xml", "a/b/y.xml")).toBe("y.xml");
  });
});
