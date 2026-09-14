// @vitest-environment node
// jsdom's own TextEncoder (patched in from Node's util module by the unit project's jsdom environment) constructs its Uint8Array in a different realm than the one bare `Uint8Array` resolves to inside that same environment, so a router.ts procedure's z.instanceof(Uint8Array) input schema rejects it as "expected Uint8Array, received Uint8Array" -- confirmed directly by comparing `bytes instanceof Uint8Array` (false under jsdom, true under node) for the identical TextEncoder().encode() call. router.ts itself is pure Node-executable document logic with no DOM dependency, so forcing this one file onto vitest's node environment sidesteps the realm split entirely rather than working around it per call site.
import { call } from "@orpc/server";
import type { ContentDocument } from "documents.js";
import {
  buildDocumentBytes,
  createDocx,
  createOdg,
  createOdp,
  createOds,
  createOdt,
  createPptx,
  documentTreeWithSchema,
  zipPackage,
} from "documents.js";
import { assembleTree } from "document-schema.js";
import { describe, expect, it } from "vitest";

import { router } from "./router";

const MARKDOWN_BYTES = new TextEncoder().encode("# Title\n\nBody text.\n");

function enc(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

// A structurally authentic embedded-HSQLDB .odb, built directly from documents.js's own public zipPackage/parsePackage/readOdbInventory/readOdbTables surface rather than importing odf.js (which this UI layer never depends on) -- the identical shape documents.js's own internal odb fixtures use (mimetype, a manifest naming content.xml and database/script, an office:database pointing at "sdbc:embedded:hsqldb", and a real HSQLDB TEXT-format script), just assembled here with the pieces router.ts's odb.read handler already imports.
function minimalOdbBytes(): Uint8Array<ArrayBuffer> {
  const script = [
    "CREATE SCHEMA PUBLIC AUTHORIZATION DBA",
    "CREATE MEMORY TABLE PUBLIC.WIDGETS(ID INTEGER NOT NULL PRIMARY KEY,NAME VARCHAR(50))",
    "SET SCHEMA PUBLIC",
    "INSERT INTO WIDGETS VALUES(1,'Sprocket')",
    "INSERT INTO WIDGETS VALUES(2,'Cog')",
  ].join("\n");
  return zipPackage({
    mimetype: enc("application/vnd.oasis.opendocument.base"),
    "META-INF/manifest.xml": enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<manifest:manifest manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.base"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="database/script" manifest:media-type=""/></manifest:manifest>',
    ),
    "content.xml": enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:db="urn:oasis:names:tc:opendocument:xmlns:database:1.0" xmlns:xlink="http://www.w3.org/1999/xlink"><office:body><office:database><db:data-source><db:connection-data><db:connection-resource xlink:href="sdbc:embedded:hsqldb" xlink:type="simple"/></db:connection-data></db:data-source></office:database></office:body></office:document-content>',
    ),
    "database/script": enc(script),
  });
}

// A minimal, structurally authentic .odm master document: office:text carrying one text:section per chapter, each pointing at that chapter's own href via a text:section-source -- the shape odf.js's own readOdm expects (see documents.js's odmToPdf module comment). Built with plain zipPackage rather than odf.js's own package model, since this UI layer never depends on odf.js directly.
function minimalOdmBytes(
  sections: readonly { name: string; href: string }[],
): Uint8Array<ArrayBuffer> {
  const sectionsXml = sections
    .map(
      (section) =>
        `<text:section text:name="${section.name}"><text:section-source xlink:href="${section.href}" text:filter-name="writer8"/></text:section>`,
    )
    .join("");
  return zipPackage({
    mimetype: enc("application/vnd.oasis.opendocument.text-master"),
    "content.xml": enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:xlink="http://www.w3.org/1999/xlink"><office:body><office:text>${sectionsXml}</office:text></office:body></office:document-content>`,
    ),
  });
}

function chapterOdtBytes(text: string): Uint8Array<ArrayBuffer> {
  const editor = createOdt();
  editor.body.appendParagraph().appendRun({ text });
  return editor.toBytes();
}

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

  it("reads pptx content via the OPC package path", async () => {
    const read = await call(router.content.read, {
      format: "pptx",
      bytes: createPptx().toBytes(),
    });
    expect(read.content.kind).toBe("presentation");
  });

  it("reads xlsx content via the OPC package path", async () => {
    const converted = await call(router.convert, {
      source: "markdown",
      targetFormat: "xlsx",
      bytes: MARKDOWN_BYTES,
    });
    const read = await call(router.content.read, {
      format: "xlsx",
      bytes: converted.document.bytes,
    });
    expect(read.content.kind).toBe("spreadsheet");
  });

  it("reads odp content via the ODF package path", async () => {
    const read = await call(router.content.read, {
      format: "odp",
      bytes: createOdp().toBytes(),
    });
    expect(read.content.kind).toBe("presentation");
  });

  it("reads ods content via the ODF package path", async () => {
    const read = await call(router.content.read, {
      format: "ods",
      bytes: createOds().toBytes(),
    });
    expect(read.content.kind).toBe("spreadsheet");
  });

  it("reads odg content via the ODF package path", async () => {
    const read = await call(router.content.read, {
      format: "odg",
      bytes: createOdg().toBytes(),
    });
    expect(read.content.kind).toBe("drawing");
  });

  it("throws for pdf, which has no standalone content reader", async () => {
    const converted = await call(router.convert, {
      source: "markdown",
      targetFormat: "pdf",
      bytes: MARKDOWN_BYTES,
    });
    await expect(
      call(router.content.read, {
        format: "pdf",
        bytes: converted.document.bytes,
      }),
    ).rejects.toThrow("PDF has no standalone content reader");
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

describe("odb.read", () => {
  it("reads an embedded HSQLDB .odb's inventory and table data as a spreadsheet document", async () => {
    const read = await call(router.odb.read, { bytes: minimalOdbBytes() });
    // inventory.tables names only what content.xml's own db:table-representations/db:schema-definition declare -- a display customisation this minimal fixture never adds, not the embedded engine's real table names (those come from readOdbTables, exercised via read.content below).
    expect(read.inventory.tables).toEqual([]);
    expect(read.content.kind).toBe("spreadsheet");
    if (read.content.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    const sheet = read.content.sheets[0];
    if (sheet === undefined) throw new Error("expected a WIDGETS sheet");
    expect(sheet.name).toBe("WIDGETS");
    const header = sheet.cells
      .filter((cell) => cell.row === 0)
      .sort((a, b) => a.column - b.column)
      .map((cell) => cell.displayText);
    expect(header).toEqual(["ID", "NAME"]);
    const firstRow = sheet.cells
      .filter((cell) => cell.row === 1)
      .sort((a, b) => a.column - b.column)
      .map((cell) => cell.displayText);
    expect(firstRow).toEqual(["1", "Sprocket"]);
  });
});

describe("odm.render", () => {
  it("renders a master document's chapters into one combined PDF once every section resolves", async () => {
    const master = minimalOdmBytes([
      { name: "Chapter1", href: "chapter1.odt" },
    ]);
    const result = await call(router.odm.render, {
      master,
      chapters: [
        { href: "chapter1.odt", bytes: chapterOdtBytes("hello chapter") },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected an ok result");
    expect(result.pdf.byteLength).toBeGreaterThan(0);
  });

  it("reports every unresolved chapter href as data rather than throwing", async () => {
    const master = minimalOdmBytes([
      { name: "Chapter1", href: "chapter1.odt" },
      { name: "Chapter2", href: "chapter2.odt" },
    ]);
    const result = await call(router.odm.render, { master, chapters: [] });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected an unresolved result");
    expect(result.unresolved).toEqual(["chapter1.odt", "chapter2.odt"]);
  });
});

// A real, minimal, valid 1x1 transparent PNG -- decoded and re-embedded (never re-encoded) so a docx built through the tree pipeline below carries a genuine image the PDF layout pass places a real "image" item for, rather than only text.
const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

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

  it("counts every item of every kind across every page, and sanitizes each real embedded image", async () => {
    const content: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 595, heightPt: 842 },
          margins: { topPt: 36, rightPt: 36, bottomPt: 36, leftPt: 36 },
          blocks: [
            { kind: "paragraph", runs: [{ text: "Some text" }] },
            {
              kind: "image",
              format: "png",
              base64: PNG_1X1_BASE64,
              widthPt: 10,
              heightPt: 10,
            },
          ],
        },
      ],
    };
    const docxBytes = buildDocumentBytes(
      documentTreeWithSchema(assembleTree(content)),
      "docx",
    );
    const converted = await call(router.convert, {
      source: "docx",
      targetFormat: "pdf",
      bytes: docxBytes,
    });
    const inspected = await call(router.pdf.inspect, {
      bytes: converted.document.bytes,
    });
    // A real image item was placed on the page, and the per-kind tally reflects the real page/item walk rather than an empty or stubbed count.
    expect(inspected.itemKindCounts.image).toBeGreaterThanOrEqual(1);
    const totalCounted = Object.values(inspected.itemKindCounts).reduce(
      (sum, count) => sum + count,
      0,
    );
    const totalItems = inspected.layout.pages.reduce(
      (sum, page) => sum + page.items.length,
      0,
    );
    expect(totalCounted).toBe(totalItems);
    expect(totalItems).toBeGreaterThan(1);
    // The sanitized images map carries one real, non-empty entry per embedded image, each with a genuine positive byteLength -- not an empty object a no-op map body would also produce.
    const imageIds = Object.keys(inspected.layout.images);
    expect(imageIds.length).toBeGreaterThanOrEqual(1);
    const [firstId] = imageIds;
    expect(inspected.layout.images[firstId!]).toMatchObject({
      format: "png",
      widthPx: 1,
      heightPx: 1,
    });
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
