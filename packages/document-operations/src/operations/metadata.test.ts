import { bytesToBase64, createDocx } from "documents.js";
import { describe, expect, it } from "vitest";
import { metadataReadOperation, metadataWriteOperation } from "./metadata";

describe("metadataReadOperation", () => {
  it("reads back metadata written by metadataWriteOperation", async () => {
    const bytesBase64 = bytesToBase64(createDocx().toBytes());
    const written = await metadataWriteOperation.run({
      source: { bytesBase64, format: "docx" },
      targetFormat: "docx",
      setTitle: "A title",
      setAuthor: "An author",
    });
    if (!("bytesBase64" in written)) {
      throw new Error("expected inline bytes");
    }

    const metadata = await metadataReadOperation.run({
      source: { bytesBase64: written.bytesBase64, format: "docx" },
    });

    expect(metadata.title).toBe("A title");
    expect(metadata.author).toBe("An author");
  });
});

describe("metadataWriteOperation", () => {
  it("rejects a targetFormat that does not match the source format", async () => {
    const bytesBase64 = bytesToBase64(createDocx().toBytes());
    await expect(
      metadataWriteOperation.run({
        source: { bytesBase64, format: "docx" },
        // Deliberately mismatches the docx source to exercise setDocumentMetadata's own format-mismatch refusal.
        targetFormat: "odt",
      }),
    ).rejects.toThrow();
  });
});
