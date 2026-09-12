import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bytesToBase64,
  createDocx,
  readNativeDocumentTree,
} from "documents.js";
import { flattenTree } from "document-schema.js";
import { describe, expect, it } from "vitest";
import {
  convertDocumentOperation,
  listDocumentConversionsOperation,
} from "./convert";

// The same real 1x1 PNG markdown-codec's own lower.test.ts (and documents.js's own convert/markdown-image.test.ts) resolves through a MarkdownImageResolver -- decoded so detectImageFormat/readImageDimensions accept it and a genuine image block is produced rather than the alt-text degradation an unresolvable image becomes.
const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function containsImageBlock(bytes: Uint8Array<ArrayBuffer>): boolean {
  const tree = readNativeDocumentTree("docx", bytes);
  const document = flattenTree(tree);
  if (document.kind !== "wordprocessing") {
    return false;
  }
  return document.sections.some((section) =>
    section.blocks.some((block) => block.kind === "image"),
  );
}

describe("convertDocumentOperation", () => {
  it("converts a docx to markdown and returns inline base64 bytes", async () => {
    const editor = createDocx();
    editor.body.appendParagraph({ text: "Hello, world." });
    const bytesBase64 = bytesToBase64(editor.toBytes());

    const result = await convertDocumentOperation.run({
      source: { bytesBase64, format: "docx" },
      targetFormat: "markdown",
    });

    expect(result.targetFormat).toBe("markdown");
    expect("bytesBase64" in result.output).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it("propagates a resolution failure for an unrecognised file extension", async () => {
    await expect(
      convertDocumentOperation.run({
        source: { path: "/tmp/does-not-exist.notaformat" },
        targetFormat: "markdown",
      }),
    ).rejects.toThrow(/Could not infer a document format/);
  });

  it("propagates an already-aborted signal for a path source", async () => {
    // A path that does not exist, so a real fs error (not the conversion's own abort check) would result if resolveDocumentInput's own signal forwarding were ever dropped -- a real file's read would succeed either way, masking the difference behind the SAME signal still aborting the conversion downstream.
    const controller = new AbortController();
    controller.abort();

    await expect(
      convertDocumentOperation.run(
        {
          source: { path: "/tmp/does-not-exist-convert-test.docx" },
          targetFormat: "markdown",
        },
        { signal: controller.signal },
      ),
    ).rejects.toThrow(/abort/i);
  });

  it("writes the converted document to outputPath when one is given", async () => {
    const editor = createDocx();
    editor.body.appendParagraph({ text: "Hello, world." });
    const bytesBase64 = bytesToBase64(editor.toBytes());
    const dir = mkdtempSync(join(tmpdir(), "convert-test-"));
    const outputPath = join(dir, "out.md");

    const result = await convertDocumentOperation.run({
      source: { bytesBase64, format: "docx" },
      targetFormat: "markdown",
      output: { outputPath },
    });

    if (!("path" in result.output)) {
      throw new Error("expected a written-file output");
    }
    expect(result.output.path).toBe(outputPath);
    expect(result.output.byteLength).toBeGreaterThan(0);
  });

  it("reports a real font substitution both as a diagnostic and, when requested, as a structured fontSubstitutions entry", async () => {
    const editor = createDocx();
    const paragraph = editor.body.appendParagraph({});
    paragraph.appendRun({ text: "Set in Calibri.", fontFamily: "Calibri" });
    const bytesBase64 = bytesToBase64(editor.toBytes());

    const result = await convertDocumentOperation.run({
      source: { bytesBase64, format: "docx" },
      targetFormat: "pdf",
      onSubstitutionDiagnostics: true,
    });

    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.fontSubstitutions).toEqual([
      expect.objectContaining({ requestedFamily: "Calibri" }),
    ]);
  });

  it("omits fontSubstitutions entirely when onSubstitutionDiagnostics is not set, even though a real substitution occurred", async () => {
    const editor = createDocx();
    const paragraph = editor.body.appendParagraph({});
    paragraph.appendRun({ text: "Set in Calibri.", fontFamily: "Calibri" });
    const bytesBase64 = bytesToBase64(editor.toBytes());

    const result = await convertDocumentOperation.run({
      source: { bytesBase64, format: "docx" },
      targetFormat: "pdf",
    });

    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect("fontSubstitutions" in result).toBe(false);
  });

  it("resolves a markdown source's own relative image reference through the images map into a real image block", async () => {
    const markdownBytes = new TextEncoder().encode(
      "![a local image](./local.png)",
    );

    const result = await convertDocumentOperation.run({
      source: { bytesBase64: bytesToBase64(markdownBytes), format: "markdown" },
      targetFormat: "docx",
      images: { "./local.png": ONE_PIXEL_PNG_BASE64 },
    });

    if (!("bytesBase64" in result.output)) {
      throw new Error("expected inline bytes");
    }
    const docxBytes = Uint8Array.from(atob(result.output.bytesBase64), (char) =>
      char.charCodeAt(0),
    );
    expect(containsImageBlock(docxBytes)).toBe(true);
  });

  it("degrades a markdown image to alt text when its destination is absent from the images map", async () => {
    const markdownBytes = new TextEncoder().encode(
      "![a local image](./local.png)",
    );

    const result = await convertDocumentOperation.run({
      source: { bytesBase64: bytesToBase64(markdownBytes), format: "markdown" },
      targetFormat: "docx",
      images: { "./other.png": ONE_PIXEL_PNG_BASE64 },
    });

    if (!("bytesBase64" in result.output)) {
      throw new Error("expected inline bytes");
    }
    const docxBytes = Uint8Array.from(atob(result.output.bytesBase64), (char) =>
      char.charCodeAt(0),
    );
    expect(containsImageBlock(docxBytes)).toBe(false);
  });
});

describe("listDocumentConversionsOperation", () => {
  it("lists at least one supported conversion pair", async () => {
    const result = await listDocumentConversionsOperation.run({});
    expect(result.conversions.length).toBeGreaterThan(0);
    expect(result.conversions[0]).toHaveProperty("source");
    expect(result.conversions[0]).toHaveProperty("target");
  });
});
