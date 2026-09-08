import type { ContentBlock, ContentDocument } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { readEpub, readEpubContent } from "./read";
import { fixtureEpub2Bytes } from "./test-support/epub2-fixture";
import { fixtureEpub3Bytes } from "./test-support/epub3-fixture";
import { fixtureEpubMultichapterBytes } from "./test-support/epub-multichapter-fixture";

function assertWordprocessing(
  document: ContentDocument,
): asserts document is Extract<ContentDocument, { kind: "wordprocessing" }> {
  expect(document.kind).toBe("wordprocessing");
}

describe("readEpubContent: a real hand-authored EPUB 3 fixture", () => {
  it("reads Dublin Core metadata", () => {
    const document = readEpubContent(fixtureEpub3Bytes());
    assertWordprocessing(document);
    expect(document.metadata).toEqual({
      title: "Fixture Book (EPUB 3)",
      author: "Ada Lovelace",
      language: "en",
    });
  });

  it("reads the spine's single chapter as one section", () => {
    const document = readEpubContent(fixtureEpub3Bytes());
    assertWordprocessing(document);
    expect(document.sections).toHaveLength(1);
  });

  it("reads the heading, bold/italic text, and external hyperlink", () => {
    const document = readEpubContent(fixtureEpub3Bytes());
    assertWordprocessing(document);
    const blocks = document.sections[0]?.blocks ?? [];
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      headingLevel: 1,
      runs: [{ text: "Chapter One" }],
    });
    const mainParagraph = blocks[1];
    expect(mainParagraph?.kind).toBe("paragraph");
    if (mainParagraph?.kind === "paragraph") {
      expect(mainParagraph.runs).toContainEqual({ text: "bold", bold: true });
      expect(mainParagraph.runs).toContainEqual({
        text: "italic",
        italic: true,
      });
      expect(mainParagraph.runs).toContainEqual({
        text: "link",
        hyperlink: "https://example.com",
      });
    }
  });

  it("reads the EPUB 3 structured footnote idiom (aside + noteref)", () => {
    const document = readEpubContent(fixtureEpub3Bytes());
    assertWordprocessing(document);
    const blocks = document.sections[0]?.blocks ?? [];
    const mainParagraph = blocks[1];
    expect(mainParagraph?.kind).toBe("paragraph");
    if (mainParagraph?.kind === "paragraph") {
      expect(mainParagraph.constructs).toHaveLength(1);
      expect(mainParagraph.constructs?.[0]?.descriptor).toEqual({
        kind: "anchor",
        anchorType: "footnote",
        name: "fn1",
      });
    }
    const footnoteStart = blocks.find(
      (b): b is Extract<ContentBlock, { kind: "constructStart" }> =>
        b.kind === "constructStart",
    );
    expect(footnoteStart?.descriptor).toEqual({
      kind: "anchor",
      anchorType: "footnote",
      name: "fn1",
    });
  });

  it("reads the bullet list", () => {
    const document = readEpubContent(fixtureEpub3Bytes());
    assertWordprocessing(document);
    const blocks = document.sections[0]?.blocks ?? [];
    const listParagraphs = blocks.filter(
      (b): b is Extract<ContentBlock, { kind: "paragraph" }> =>
        b.kind === "paragraph" && b.list !== undefined,
    );
    expect(listParagraphs.map((p) => p.runs[0]?.text)).toEqual([
      "First item",
      "Second item",
    ]);
  });

  it("reads the manifest image as a PNG ContentImageBlock", () => {
    const document = readEpubContent(fixtureEpub3Bytes());
    assertWordprocessing(document);
    const blocks = document.sections[0]?.blocks ?? [];
    const image = blocks.find(
      (b): b is Extract<ContentBlock, { kind: "image" }> => b.kind === "image",
    );
    expect(image?.format).toBe("png");
    expect(image?.altText).toBe("the cover image");
  });

  it("readEpub (tree form) assembles without a nav/spine mismatch, so no residue is recorded", () => {
    const tree = readEpub(fixtureEpub3Bytes());
    expect(tree.source?.nav).toBeUndefined();
  });
});

describe("readEpubContent: a real hand-authored EPUB 2 fixture", () => {
  it("reads Dublin Core metadata", () => {
    const document = readEpubContent(fixtureEpub2Bytes());
    assertWordprocessing(document);
    expect(document.metadata).toEqual({
      title: "Fixture Book (EPUB 2)",
      author: "Charles Babbage",
      language: "en",
    });
  });

  it("reads the spine's single chapter, navigated by the NCX rather than an EPUB 3 nav document", () => {
    const document = readEpubContent(fixtureEpub2Bytes());
    assertWordprocessing(document);
    expect(document.sections).toHaveLength(1);
    const blocks = document.sections[0]?.blocks ?? [];
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      headingLevel: 1,
      runs: [{ text: "Chapter One" }],
    });
  });

  it("reads the EPUB 2 linked-anchor footnote idiom (class=footnote, no epub:type at all)", () => {
    const document = readEpubContent(fixtureEpub2Bytes());
    assertWordprocessing(document);
    const blocks = document.sections[0]?.blocks ?? [];
    const mainParagraph = blocks[1];
    expect(mainParagraph?.kind).toBe("paragraph");
    if (mainParagraph?.kind === "paragraph") {
      expect(mainParagraph.constructs).toHaveLength(1);
      expect(mainParagraph.constructs?.[0]?.descriptor).toEqual({
        kind: "anchor",
        anchorType: "footnote",
        name: "note1",
      });
    }
    const footnoteStart = blocks.find(
      (b): b is Extract<ContentBlock, { kind: "constructStart" }> =>
        b.kind === "constructStart",
    );
    expect(footnoteStart?.descriptor).toEqual({
      kind: "anchor",
      anchorType: "footnote",
      name: "note1",
    });
  });

  it("readEpub (tree form) reconciles the NCX against the spine with no mismatch residue", () => {
    const tree = readEpub(fixtureEpub2Bytes());
    expect(tree.source?.nav).toBeUndefined();
  });
});

describe("readEpubContent: internal-link semantics (ExaDev/documents.js#963)", () => {
  it("builds a same-document internal link construct for a same-document fragment href, rather than a plain hyperlink", () => {
    const document = readEpubContent(fixtureEpubMultichapterBytes());
    assertWordprocessing(document);
    const chapter1Blocks = document.sections[0]?.blocks ?? [];
    const mainParagraph = chapter1Blocks.find(
      (b): b is Extract<ContentBlock, { kind: "paragraph" }> =>
        b.kind === "paragraph" && b.runs.some((r) => r.text === "next section"),
    );
    expect(mainParagraph?.runs).toContainEqual({ text: "next section" });
    const linkExtent = mainParagraph?.constructs?.find(
      (c) => c.descriptor.kind === "link",
    );
    expect(linkExtent?.descriptor).toEqual({
      kind: "link",
      target: { kind: "internal", anchor: "sec1b" },
    });
  });

  it("still stores a genuinely external href verbatim on ContentRun.hyperlink", () => {
    const document = readEpubContent(fixtureEpubMultichapterBytes());
    assertWordprocessing(document);
    const chapter1Blocks = document.sections[0]?.blocks ?? [];
    const mainParagraph = chapter1Blocks.find(
      (b): b is Extract<ContentBlock, { kind: "paragraph" }> =>
        b.kind === "paragraph" &&
        b.runs.some((r) => r.hyperlink === "https://example.com"),
    );
    expect(mainParagraph?.runs).toContainEqual({
      text: "external site",
      hyperlink: "https://example.com",
    });
  });

  it("wraps the same-document target heading in a bookmark constructStart/constructEnd pair, restoring its id", () => {
    const document = readEpubContent(fixtureEpubMultichapterBytes());
    assertWordprocessing(document);
    const chapter1Blocks = document.sections[0]?.blocks ?? [];
    const bookmarkStart = chapter1Blocks.find(
      (b): b is Extract<ContentBlock, { kind: "constructStart" }> =>
        b.kind === "constructStart" &&
        b.descriptor.kind === "anchor" &&
        b.descriptor.anchorType === "bookmark",
    );
    expect(bookmarkStart?.descriptor).toEqual({
      kind: "anchor",
      anchorType: "bookmark",
      name: "sec1b",
    });
  });

  it("builds a cross-document internal link construct for an href naming another spine document's own id, qualified with the target document's own path", () => {
    const document = readEpubContent(fixtureEpubMultichapterBytes());
    assertWordprocessing(document);
    const chapter1Blocks = document.sections[0]?.blocks ?? [];
    const mainParagraph = chapter1Blocks.find(
      (b): b is Extract<ContentBlock, { kind: "paragraph" }> =>
        b.kind === "paragraph" && b.runs.some((r) => r.text === "Chapter Two"),
    );
    const runIndex = mainParagraph?.runs.findIndex(
      (r) => r.text === "Chapter Two",
    );
    const linkExtent = mainParagraph?.constructs?.find(
      (c) => c.descriptor.kind === "link" && c.startRun === runIndex,
    );
    expect(linkExtent?.descriptor).toEqual({
      kind: "link",
      target: {
        kind: "internal",
        anchor: "OEBPS/chapter2.xhtml#sec2",
      },
    });

    const chapter2Blocks = document.sections[1]?.blocks ?? [];
    const bookmarkStart = chapter2Blocks.find(
      (b): b is Extract<ContentBlock, { kind: "constructStart" }> =>
        b.kind === "constructStart" &&
        b.descriptor.kind === "anchor" &&
        b.descriptor.anchorType === "bookmark",
    );
    expect(bookmarkStart?.descriptor).toEqual({
      kind: "anchor",
      anchorType: "bookmark",
      name: "OEBPS/chapter2.xhtml#sec2",
    });
  });
});
