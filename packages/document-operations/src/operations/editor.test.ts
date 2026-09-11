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
});

describe("documentAppendParagraphsOperation", () => {
  it("appends a paragraph with a formatted run to a fresh docx", async () => {
    const created = await documentCreateOperation.run({ format: "docx" });
    if (!("bytesBase64" in created)) {
      throw new Error("expected inline bytes");
    }

    const result = await documentAppendParagraphsOperation.run({
      source: { bytesBase64: created.bytesBase64, format: "docx" },
      targetFormat: "docx",
      paragraphs: [
        {
          text: "Plain text, then ",
          runs: [{ text: "bold text.", bold: true }],
        },
      ],
    });

    expect("bytesBase64" in result).toBe(true);
    expect(result.byteLength).toBeGreaterThan(created.byteLength);
  });

  it("rejects a docx/odt-only run field for a markdown target", async () => {
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
    ).rejects.toThrow(/does not support underline for markdown/);
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
