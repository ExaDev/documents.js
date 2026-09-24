import { describe, expect, it } from "vitest";
import { el, txt } from "../xml/fragment";
import type { Package } from "../model/package";
import {
  relsPathFor,
  resolveRelTarget,
  resolveRootRelationships,
  textContent,
} from "./util";

describe("textContent", () => {
  it("concatenates cdata content alongside plain text, not just text nodes", () => {
    const element = el("w:t", {}, [
      txt("plain "),
      { type: "cdata", value: "cdata" },
    ]);
    expect(textContent(element)).toBe("plain cdata");
  });
});

describe("relsPathFor", () => {
  it("splits a slash-containing part path into its directory and file name", () => {
    expect(relsPathFor("word/document.xml")).toBe(
      "word/_rels/document.xml.rels",
    );
  });

  it("keeps a root-level part's rels path free of a leading slash", () => {
    expect(relsPathFor("document.xml")).toBe("_rels/document.xml.rels");
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

  it("resolves a relative target against an empty directory when the subject part path is undefined (the package root)", () => {
    expect(resolveRelTarget(undefined, "media/image1.png")).toBe(
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

describe("resolveRootRelationships", () => {
  const ROOT_RELS = (target: string): Package => ({
    parts: {
      "_rels/.rels": {
        kind: "xml",
        nodes: [
          el(
            "Relationships",
            {
              xmlns:
                "http://schemas.openxmlformats.org/package/2006/relationships",
            },
            [
              el("Relationship", {
                Id: "rId1",
                Type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
                Target: target,
              }),
            ],
          ),
        ],
      },
    },
  });

  it("resolves a root relationship's Target against the package root", () => {
    expect(
      resolveRootRelationships(ROOT_RELS("word/document.xml")).get("rId1")
        ?.target,
    ).toBe("word/document.xml");
  });

  it("strips the leading slash from a package-rooted Target", () => {
    expect(
      resolveRootRelationships(ROOT_RELS("/word/document.xml")).get("rId1")
        ?.target,
    ).toBe("word/document.xml");
  });

  it("collapses a dot segment in a root relationship's Target", () => {
    expect(
      resolveRootRelationships(ROOT_RELS("./word/document.xml")).get("rId1")
        ?.target,
    ).toBe("word/document.xml");
  });

  it("returns an empty map when the package has no _rels/.rels part", () => {
    expect(resolveRootRelationships({ parts: {} }).size).toBe(0);
  });
});
