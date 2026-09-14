import type { ContentBlock, ContentDocument } from "document-schema.js";
import { describe, expect, it } from "vitest";
import {
  EpubEmptySpineError,
  EpubInvalidContainerError,
  EpubInvalidMimetypeError,
  EpubInvalidOpfError,
} from "./diagnostics";
import { EPUB_MIME_TYPE } from "./format";
import { readEpub, readEpubContent } from "./read";
import { fixtureEpub2Bytes } from "./test-support/epub2-fixture";
import { fixtureEpub3Bytes } from "./test-support/epub3-fixture";
import { fixtureEpubMultichapterBytes } from "./test-support/epub-multichapter-fixture";
import { fixtureEpub2MultichapterBytes } from "./test-support/epub2-multichapter-fixture";
import { zipPackage } from "./zip";

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

describe("readEpubContent: cross-document footnotes (ExaDev/documents.js#963)", () => {
  it("recognises an EPUB 3 structured (epub:type=noteref/footnote) reference whose own body lives in a different spine document", () => {
    const document = readEpubContent(fixtureEpubMultichapterBytes());
    assertWordprocessing(document);
    const chapter1Blocks = document.sections[0]?.blocks ?? [];
    const mainParagraph = chapter1Blocks.find(
      (b): b is Extract<ContentBlock, { kind: "paragraph" }> =>
        b.kind === "paragraph" && b.runs.some((r) => r.text === "1"),
    );
    const footnoteExtent = mainParagraph?.constructs?.find(
      (c) =>
        c.descriptor.kind === "anchor" &&
        c.descriptor.anchorType === "footnote",
    );
    expect(footnoteExtent?.descriptor).toEqual({
      kind: "anchor",
      anchorType: "footnote",
      name: "OEBPS/chapter2.xhtml#note1",
    });

    const chapter2Blocks = document.sections[1]?.blocks ?? [];
    const footnoteStart = chapter2Blocks.find(
      (b): b is Extract<ContentBlock, { kind: "constructStart" }> =>
        b.kind === "constructStart" &&
        b.descriptor.kind === "anchor" &&
        b.descriptor.anchorType === "footnote",
    );
    expect(footnoteStart?.descriptor).toEqual({
      kind: "anchor",
      anchorType: "footnote",
      name: "OEBPS/chapter2.xhtml#note1",
    });
  });

  it("recognises the EPUB 2 linked-anchor idiom (class=footnote, no epub:type at all) across a spine document boundary", () => {
    const document = readEpubContent(fixtureEpub2MultichapterBytes());
    assertWordprocessing(document);
    const chapter1Blocks = document.sections[0]?.blocks ?? [];
    const mainParagraph = chapter1Blocks.find(
      (b): b is Extract<ContentBlock, { kind: "paragraph" }> =>
        b.kind === "paragraph" && b.runs.some((r) => r.text === "1"),
    );
    const footnoteExtent = mainParagraph?.constructs?.find(
      (c) =>
        c.descriptor.kind === "anchor" &&
        c.descriptor.anchorType === "footnote",
    );
    expect(footnoteExtent?.descriptor).toEqual({
      kind: "anchor",
      anchorType: "footnote",
      name: "OEBPS/chapter2.xhtml#note1",
    });

    const chapter2Blocks = document.sections[1]?.blocks ?? [];
    const footnoteStart = chapter2Blocks.find(
      (b): b is Extract<ContentBlock, { kind: "constructStart" }> =>
        b.kind === "constructStart" &&
        b.descriptor.kind === "anchor" &&
        b.descriptor.anchorType === "footnote",
    );
    expect(footnoteStart?.descriptor).toEqual({
      kind: "anchor",
      anchorType: "footnote",
      name: "OEBPS/chapter2.xhtml#note1",
    });
  });
});

describe("readEpubContent: the OCF container.xml entry", () => {
  it("throws EpubInvalidContainerError with a real, non-empty message when the entry is missing entirely", () => {
    const encoder = new TextEncoder();
    const bytes = zipPackage([
      ["mimetype", { bytes: encoder.encode(EPUB_MIME_TYPE), stored: true }],
    ]);
    try {
      readEpubContent(bytes);
      expect.unreachable("readEpubContent should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(EpubInvalidContainerError);
      expect(
        error instanceof EpubInvalidContainerError ? error.message : undefined,
      ).toBe("the zip carries no META-INF/container.xml entry");
    }
  });
});

describe("readEpubContent: the OPF rootfile container.xml names", () => {
  it("throws EpubInvalidOpfError naming the missing rootfile's own path when the zip does not contain it", () => {
    const encoder = new TextEncoder();
    const container = `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;
    const bytes = zipPackage([
      ["mimetype", { bytes: encoder.encode(EPUB_MIME_TYPE), stored: true }],
      ["META-INF/container.xml", { bytes: encoder.encode(container) }],
    ]);
    try {
      readEpubContent(bytes);
      expect.unreachable("readEpubContent should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(EpubInvalidOpfError);
      expect(
        error instanceof EpubInvalidOpfError ? error.message : undefined,
      ).toBe(
        'META-INF/container.xml names an OPF rootfile ("OEBPS/content.opf") the zip does not contain',
      );
    }
  });
});

describe("readEpubContent: an empty resolvable spine", () => {
  it("throws EpubEmptySpineError when every spine itemref resolves to no real content", () => {
    const encoder = new TextEncoder();
    const container = `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;
    const opf = `<package xmlns="http://www.idpf.org/2007/opf">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title></metadata>
      <manifest></manifest>
      <spine><itemref idref="ghost"/></spine>
    </package>`;
    const bytes = zipPackage([
      ["mimetype", { bytes: encoder.encode(EPUB_MIME_TYPE), stored: true }],
      ["META-INF/container.xml", { bytes: encoder.encode(container) }],
      ["OEBPS/content.opf", { bytes: encoder.encode(opf) }],
    ]);
    expect(() => readEpubContent(bytes, { sink: () => undefined })).toThrow(
      EpubEmptySpineError,
    );
  });
});

describe("readEpubContent: a section with no quarantined CSS residue", () => {
  it("carries no source key at all, rather than an explicit undefined one", () => {
    const document = readEpubContent(fixtureEpub3Bytes());
    assertWordprocessing(document);
    expect("source" in (document.sections[0] ?? {})).toBe(false);
  });
});

describe("readEpubContent: the OCF mimetype entry", () => {
  it("throws EpubInvalidMimetypeError when the mimetype entry is present but carries the wrong content", () => {
    const encoder = new TextEncoder();
    const bytes = zipPackage([
      ["mimetype", { bytes: encoder.encode("text/plain"), stored: true }],
    ]);
    expect(() => readEpubContent(bytes)).toThrow(EpubInvalidMimetypeError);
  });

  it("throws EpubInvalidMimetypeError when the mimetype entry is missing entirely", () => {
    const encoder = new TextEncoder();
    const bytes = zipPackage([
      ["META-INF/container.xml", { bytes: encoder.encode("<container/>") }],
    ]);
    expect(() => readEpubContent(bytes)).toThrow(EpubInvalidMimetypeError);
  });

  it("does not throw when the mimetype entry carries exactly the real content", () => {
    const encoder = new TextEncoder();
    const bytes = zipPackage([
      ["mimetype", { bytes: encoder.encode(EPUB_MIME_TYPE), stored: true }],
    ]);
    expect(() => readEpubContent(bytes)).not.toThrow(EpubInvalidMimetypeError);
  });
});
