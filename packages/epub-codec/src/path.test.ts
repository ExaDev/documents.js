import { describe, expect, it } from "vitest";
import { dirname, resolvePackagePath } from "./path";

describe("dirname", () => {
  it("returns the directory portion of a package path", () => {
    expect(dirname("OEBPS/content.opf")).toBe("OEBPS");
    expect(dirname("OEBPS/text/chapter1.xhtml")).toBe("OEBPS/text");
  });

  it("returns an empty string for a root-level path", () => {
    expect(dirname("content.opf")).toBe("");
  });
});

describe("resolvePackagePath", () => {
  it("resolves a same-directory relative reference", () => {
    expect(resolvePackagePath("OEBPS", "chapter1.xhtml")).toBe(
      "OEBPS/chapter1.xhtml",
    );
  });

  it("resolves a reference into a subdirectory", () => {
    expect(resolvePackagePath("OEBPS", "images/cover.png")).toBe(
      "OEBPS/images/cover.png",
    );
  });

  it("resolves a parent-directory reference", () => {
    expect(resolvePackagePath("OEBPS/text", "../images/cover.png")).toBe(
      "OEBPS/images/cover.png",
    );
  });

  it("resolves against an empty (root) base directory", () => {
    expect(resolvePackagePath("", "content.opf")).toBe("content.opf");
  });

  it("leaves an absolute or scheme-carrying reference unchanged", () => {
    expect(resolvePackagePath("OEBPS", "/absolute.png")).toBe("/absolute.png");
    expect(resolvePackagePath("OEBPS", "https://example.com/x.png")).toBe(
      "https://example.com/x.png",
    );
  });
});
