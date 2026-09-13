import { readNativeDocumentTree } from "documents.js";
import { flattenTree, rgbHexToColor } from "document-schema.js";
import { describe, expect, it } from "vitest";
import {
  documentAppendParagraphsOperation,
  documentCreateOperation,
} from "./editor";

// A byte-level signature unique to each writable format's own real output -- checked against the raw bytes so a wrong createDocumentBytes() case (a fallthrough to the wrong writer, or the wrong writer entirely) is caught even though every writer's output is equally non-empty. OOXML formats are identified by a real zip entry name (uncompressed in every zip's local-file-header/central-directory, unlike a compressed entry's own content); ODF formats by their own "mimetype" entry's content-type string; PDF by its literal header.
const FORMAT_SIGNATURES = {
  docx: "word/document.xml",
  pptx: "ppt/presentation.xml",
  odt: "opendocument.text",
  odp: "opendocument.presentation",
  ods: "opendocument.spreadsheet",
  odg: "opendocument.graphics",
  pdf: "%PDF",
} as const;

function bytesContain(bytes: Uint8Array, needle: string): boolean {
  return Buffer.from(bytes).toString("latin1").includes(needle);
}

describe("documentCreateOperation", () => {
  it.each(
    Object.entries(FORMAT_SIGNATURES) as [
      keyof typeof FORMAT_SIGNATURES,
      string,
    ][],
  )(
    "creates a genuine blank %s, not just non-empty bytes",
    async (format, signature) => {
      const result = await documentCreateOperation.run({ format });
      if (!("bytesBase64" in result)) {
        throw new Error("expected inline bytes");
      }
      expect(result.byteLength).toBeGreaterThan(0);
      const bytes = Uint8Array.from(atob(result.bytesBase64), (char) =>
        char.charCodeAt(0),
      );
      expect(bytesContain(bytes, signature)).toBe(true);
    },
  );
});

describe("documentAppendParagraphsOperation", () => {
  it("appends a paragraph carrying every docx/odt paragraph and run property, all of which land on the decoded content", async () => {
    const created = await documentCreateOperation.run({ format: "docx" });
    if (!("bytesBase64" in created)) {
      throw new Error("expected inline bytes");
    }

    const result = await documentAppendParagraphsOperation.run({
      source: { bytesBase64: created.bytesBase64, format: "docx" },
      targetFormat: "docx",
      paragraphs: [
        {
          styleId: "Normal",
          headingLevel: 2,
          alignment: "center",
          runs: [
            {
              text: "styled",
              bold: true,
              italic: true,
              strike: true,
              underline: true,
              fontFamily: "Arial",
              sizePt: 14,
              colorHex: "#ff0000",
            },
          ],
        },
      ],
    });

    if (!("bytesBase64" in result)) {
      throw new Error("expected inline bytes");
    }
    const bytes = Uint8Array.from(atob(result.bytesBase64), (char) =>
      char.charCodeAt(0),
    );
    const tree = readNativeDocumentTree("docx", bytes);
    const document = flattenTree(tree);
    if (document.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing document");
    }
    const appended = document.sections[0]?.blocks.at(-1);
    if (appended?.kind !== "paragraph") {
      throw new Error("expected an appended paragraph block");
    }
    expect(appended.headingLevel).toBe(2);
    expect(appended.alignment).toBe("center");
    const run = appended.runs[0];
    expect(run).toMatchObject({
      text: "styled",
      bold: true,
      italic: true,
      strike: true,
      underline: true,
      fontFamily: "Arial",
      sizePt: 14,
      color: rgbHexToColor("#ff0000"),
    });
  });

  it("appends a paragraph to an odt document", async () => {
    const created = await documentCreateOperation.run({ format: "odt" });
    if (!("bytesBase64" in created)) {
      throw new Error("expected inline bytes");
    }

    const result = await documentAppendParagraphsOperation.run({
      source: { bytesBase64: created.bytesBase64, format: "odt" },
      targetFormat: "odt",
      paragraphs: [{ text: "An odt paragraph." }],
    });

    if (!("bytesBase64" in result)) {
      throw new Error("expected inline bytes");
    }
    const bytes = Uint8Array.from(atob(result.bytesBase64), (char) =>
      char.charCodeAt(0),
    );
    const tree = readNativeDocumentTree("odt", bytes);
    const document = flattenTree(tree);
    if (document.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing document");
    }
    const appended = document.sections[0]?.blocks.at(-1);
    expect(appended).toMatchObject({
      kind: "paragraph",
      runs: [expect.objectContaining({ text: "An odt paragraph." })],
    });
  });

  it("appends a paragraph carrying every markdown-supported run property, all of which land on the decoded content", async () => {
    const created = await documentCreateOperation.run({ format: "markdown" });
    if (!("bytesBase64" in created)) {
      throw new Error("expected inline bytes");
    }

    const result = await documentAppendParagraphsOperation.run({
      source: { bytesBase64: created.bytesBase64, format: "markdown" },
      targetFormat: "markdown",
      paragraphs: [
        {
          // Heading1, not a plain style: proves body.appendParagraph's own styleId argument genuinely reached the editor (a plain paragraph and a heading are otherwise indistinguishable by run content alone) -- markdown lowers it to a real "# " heading, read back as headingLevel below.
          styleId: "Heading1",
          runs: [
            {
              text: "formatted",
              bold: true,
              italic: true,
              strike: true,
            },
            {
              text: "linked",
              hyperlink: "https://example.com",
            },
            {
              text: "coded",
              code: true,
            },
          ],
        },
      ],
    });

    if (!("bytesBase64" in result)) {
      throw new Error("expected inline bytes");
    }
    const bytes = Uint8Array.from(atob(result.bytesBase64), (char) =>
      char.charCodeAt(0),
    );
    const tree = readNativeDocumentTree("markdown", bytes);
    const document = flattenTree(tree);
    if (document.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing document");
    }
    const appended = document.sections[0]?.blocks.at(-1);
    if (appended?.kind !== "paragraph") {
      throw new Error("expected an appended paragraph block");
    }
    expect(appended.headingLevel).toBe(1);
    expect(appended.runs).toEqual([
      expect.objectContaining({
        text: "formatted",
        bold: true,
        italic: true,
        strike: true,
      }),
      expect.objectContaining({
        text: "linked",
        hyperlink: "https://example.com",
      }),
      expect.objectContaining({ text: "coded", fontFamily: "Courier New" }),
    ]);
  });

  it("rejects a single docx/odt-only run field for a markdown target, naming it singularly", async () => {
    const created = await documentCreateOperation.run({ format: "markdown" });
    if (!("bytesBase64" in created)) {
      throw new Error("expected inline bytes");
    }

    await expect(
      documentAppendParagraphsOperation.run({
        source: { bytesBase64: created.bytesBase64, format: "markdown" },
        targetFormat: "markdown",
        paragraphs: [{ text: "x", runs: [{ underline: true }] }],
      }),
    ).rejects.toThrow(
      "A run does not support underline for markdown -- remove it or target docx/odt instead.",
    );
  });

  it("rejects several markdown-unsupported run fields at once, naming every one and pluralising the remedy", async () => {
    const created = await documentCreateOperation.run({ format: "markdown" });
    if (!("bytesBase64" in created)) {
      throw new Error("expected inline bytes");
    }

    await expect(
      documentAppendParagraphsOperation.run({
        source: { bytesBase64: created.bytesBase64, format: "markdown" },
        targetFormat: "markdown",
        paragraphs: [
          { text: "x", runs: [{ underline: true, fontFamily: "Arial" }] },
        ],
      }),
    ).rejects.toThrow(
      "A run does not support underline, fontFamily for markdown -- remove them or target docx/odt instead.",
    );
  });

  it("rejects a markdown-only run field for a docx target, naming docx/odt as the unsupported format", async () => {
    const created = await documentCreateOperation.run({ format: "docx" });
    if (!("bytesBase64" in created)) {
      throw new Error("expected inline bytes");
    }

    await expect(
      documentAppendParagraphsOperation.run({
        source: { bytesBase64: created.bytesBase64, format: "docx" },
        targetFormat: "docx",
        paragraphs: [
          { text: "x", runs: [{ hyperlink: "https://example.com" }] },
        ],
      }),
    ).rejects.toThrow(
      "A run does not support hyperlink for docx/odt -- remove it or target docx/odt instead.",
    );
  });

  it("rejects a markdown-only paragraph-level field (headingLevel) for a markdown target", async () => {
    const created = await documentCreateOperation.run({ format: "markdown" });
    if (!("bytesBase64" in created)) {
      throw new Error("expected inline bytes");
    }

    await expect(
      documentAppendParagraphsOperation.run({
        source: { bytesBase64: created.bytesBase64, format: "markdown" },
        targetFormat: "markdown",
        paragraphs: [{ text: "x", headingLevel: 1 }],
      }),
    ).rejects.toThrow(
      "A paragraph does not support headingLevel for markdown -- remove it or target docx/odt instead.",
    );
  });

  it("rejects a source/targetFormat mismatch", async () => {
    const created = await documentCreateOperation.run({ format: "docx" });
    if (!("bytesBase64" in created)) {
      throw new Error("expected inline bytes");
    }

    await expect(
      documentAppendParagraphsOperation.run({
        source: { bytesBase64: created.bytesBase64, format: "docx" },
        targetFormat: "odt",
        paragraphs: [{ text: "x" }],
      }),
    ).rejects.toThrow(/never converts format/);
  });
});
