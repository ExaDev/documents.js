// @vitest-environment node
// jsdom's own TextEncoder (patched in from Node's util module by the unit project's jsdom environment) constructs its Uint8Array in a different realm than the one bare `Uint8Array` resolves to inside that same environment, so a router.ts procedure's z.instanceof(Uint8Array) input schema rejects it as "expected Uint8Array, received Uint8Array" -- confirmed directly by comparing `bytes instanceof Uint8Array` (false under jsdom, true under node) for the identical TextEncoder().encode() call. router.ts itself is pure Node-executable document logic with no DOM dependency, so forcing this one file onto vitest's node environment sidesteps the realm split entirely rather than working around it per call site.
import { call } from "@orpc/server";
import { createDocx } from "documents.js";
import { describe, expect, it } from "vitest";

import { router } from "./router";

const MARKDOWN_BYTES = new TextEncoder().encode("# Title\n\nBody text.\n");

describe("formats.list / formats.listConversions", () => {
  it("lists every supported document format", async () => {
    const formats = await call(router.formats.list, undefined);
    expect(formats).toContain("docx");
    expect(formats).toContain("pdf");
    expect(formats).toContain("markdown");
  });

  it("lists at least one real conversion pair", async () => {
    const pairs = await call(router.formats.listConversions, undefined);
    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs[0]).toHaveProperty("source");
    expect(pairs[0]).toHaveProperty("target");
  });
});

describe("convert", () => {
  it("converts markdown to pdf and includes the flattened content alongside the bytes", async () => {
    const result = await call(router.convert, {
      source: "markdown",
      targetFormat: "pdf",
      bytes: MARKDOWN_BYTES,
    });
    expect(result.document.format).toBe("pdf");
    expect(result.document.bytes.byteLength).toBeGreaterThan(0);
    expect(result.content?.kind).toBe("wordprocessing");
  });
});

describe("content.read / content.restore", () => {
  it("reads markdown content and round-trips it through restore back to markdown bytes", async () => {
    const read = await call(router.content.read, {
      format: "markdown",
      bytes: MARKDOWN_BYTES,
    });
    expect(read.content.kind).toBe("wordprocessing");
    expect(read.package.$schema).toBeTruthy();

    const restored = await call(router.content.restore, {
      format: "markdown",
      package: read.package,
    });
    const restoredText = new TextDecoder().decode(restored.bytes);
    expect(restoredText).toContain("Title");
    // markdown-codec's writer escapes a trailing '.' (ambiguous with an ordered-list marker), so the round-tripped bytes read "Body text\." rather than the original "Body text." -- checked without the punctuation, which the escaping doesn't touch.
    expect(restoredText).toContain("Body text");
  });

  it("reads docx content via the OPC package path", async () => {
    const editor = createDocx();
    editor.body.appendParagraph().appendRun({ text: "hello docx" });
    const read = await call(router.content.read, {
      format: "docx",
      bytes: editor.toBytes(),
    });
    expect(read.content.kind).toBe("wordprocessing");
  });
});

describe("metadata.read / metadata.write", () => {
  it("writes metadata overrides onto a docx document, then reads them back", async () => {
    const editor = createDocx();
    editor.body.appendParagraph().appendRun({ text: "hello docx" });
    const written = await call(router.metadata.write, {
      sourceFormat: "docx",
      targetFormat: "docx",
      bytes: editor.toBytes(),
      overrides: { title: "A New Title", author: "Ada" },
    });
    const read = await call(router.metadata.read, {
      format: "docx",
      bytes: written,
    });
    expect(read.title).toBe("A New Title");
    expect(read.author).toBe("Ada");
  });
});

describe("fonts.describe / fonts.extractSourceFonts", () => {
  it("extracts the source fonts embedded in a docx document (none, for a document with no embedded font faces)", async () => {
    const editor = createDocx();
    editor.body.appendParagraph().appendRun({ text: "hello docx" });
    const fonts = await call(router.fonts.extractSourceFonts, {
      format: "docx",
      bytes: editor.toBytes(),
    });
    expect(fonts).toEqual([]);
  });
});

describe("pdf.inspect", () => {
  it("inspects a converted PDF's page count and item-kind breakdown", async () => {
    const converted = await call(router.convert, {
      source: "markdown",
      targetFormat: "pdf",
      bytes: MARKDOWN_BYTES,
    });
    const inspected = await call(router.pdf.inspect, {
      bytes: converted.document.bytes,
    });
    expect(inspected.pageCount).toBeGreaterThan(0);
    expect(inspected.layout.pages.length).toBe(inspected.pageCount);
    // The sanitized layout's images map never carries the unbounded base64 payload key.
    for (const asset of Object.values(inspected.layout.images)) {
      expect(asset).not.toHaveProperty("base64");
      expect(asset.byteLength).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("editor.* lifecycle", () => {
  it("opens a markdown session, edits/adds/removes a paragraph, and saves real markdown bytes", async () => {
    const opened = await call(router.editor.open, {
      format: "markdown",
      bytes: MARKDOWN_BYTES,
    });
    expect(opened.paragraphs).toEqual(["Title", "Body text."]);

    const edited = await call(router.editor.setParagraphText, {
      id: opened.id,
      index: 1,
      text: "Edited body.",
    });
    expect(edited.paragraphs).toEqual(["Title", "Edited body."]);

    const added = await call(router.editor.addParagraph, {
      id: opened.id,
      text: "Third paragraph.",
    });
    expect(added.paragraphs).toEqual([
      "Title",
      "Edited body.",
      "Third paragraph.",
    ]);

    const removed = await call(router.editor.removeParagraph, {
      id: opened.id,
      index: 0,
    });
    expect(removed.paragraphs).toEqual(["Edited body.", "Third paragraph."]);

    const saved = await call(router.editor.save, { id: opened.id });
    const savedText = new TextDecoder().decode(saved.bytes);
    // markdown-codec's writer escapes a trailing '.', so checked without the punctuation (see the identical note on the content.restore round-trip test above).
    expect(savedText).toContain("Edited body");
    expect(savedText).toContain("Third paragraph");
    expect(savedText).not.toContain("Title");
  });

  it("rejects removeParagraph for an index with no paragraph there", async () => {
    const opened = await call(router.editor.open, {
      format: "markdown",
      bytes: MARKDOWN_BYTES,
    });
    await expect(
      call(router.editor.removeParagraph, { id: opened.id, index: 99 }),
    ).rejects.toThrow("no paragraph at index 99");
  });

  it("rejects any mutation against an id from a session that never existed", async () => {
    await expect(
      call(router.editor.setParagraphText, {
        id: 999_999,
        index: 0,
        text: "x",
      }),
    ).rejects.toThrow("no editor session with that id");
  });
});
