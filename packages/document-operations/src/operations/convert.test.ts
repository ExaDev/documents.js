import { bytesToBase64, createDocx } from "documents.js";
import { describe, expect, it } from "vitest";
import {
  convertDocumentOperation,
  listDocumentConversionsOperation,
} from "./convert";

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
});

describe("listDocumentConversionsOperation", () => {
  it("lists at least one supported conversion pair", async () => {
    const result = await listDocumentConversionsOperation.run({});
    expect(result.conversions.length).toBeGreaterThan(0);
    expect(result.conversions[0]).toHaveProperty("source");
    expect(result.conversions[0]).toHaveProperty("target");
  });
});
