import { readNativeDocumentTree } from "documents.js";
import { flattenTree, rgbHexToColor } from "document-schema.js";
import { describe, expect, it } from "vitest";
import {
  documentAppendParagraphsOperation,
  documentCreateOperation,
} from "./editor";

describe("documentCreateOperation", () => {
  it("creates a blank docx and returns inline bytes", async () => {
    const result = await documentCreateOperation.run({ format: "docx" });
    expect("bytesBase64" in result).toBe(true);
    expect(result.byteLength).toBeGreaterThan(0);
  });

  it.each(["pptx", "odt", "odp", "ods", "odg", "pdf"] as const)(
    "creates a blank %s and returns inline bytes",
    async (format) => {
      const result = await documentCreateOperation.run({ format });
      expect("bytesBase64" in result).toBe(true);
      expect(result.byteLength).toBeGreaterThan(0);
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
          styleId: "Normal",
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
