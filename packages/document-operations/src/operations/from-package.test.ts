import {
  bytesToBase64,
  createDocx,
  documentTreeWithSchema,
  readNativeDocumentTree,
} from "documents.js";
import { describe, expect, it } from "vitest";
import { fromPackageOperation } from "./from-package";

describe("fromPackageOperation", () => {
  it("rebuilds a docx from a DocumentTree dump of the same document", async () => {
    const editor = createDocx();
    editor.body.appendParagraph({ text: "Round trip me." });
    const originalBytes = editor.toBytes();
    const tree = readNativeDocumentTree("docx", originalBytes);
    const dumpJson = JSON.stringify(documentTreeWithSchema(tree));

    const result = await fromPackageOperation.run({
      source: {
        bytesBase64: bytesToBase64(new TextEncoder().encode(dumpJson)),
        format: "docx",
      },
      targetFormat: "docx",
    });

    expect("bytesBase64" in result).toBe(true);
    expect(result.byteLength).toBeGreaterThan(0);
  });

  it("rejects source bytes that are not valid JSON", async () => {
    await expect(
      fromPackageOperation.run({
        source: {
          bytesBase64: bytesToBase64(new TextEncoder().encode("not json")),
          format: "docx",
        },
        targetFormat: "docx",
      }),
    ).rejects.toThrow(/not valid JSON/);
  });

  it("rejects a value with no recognised $schema", async () => {
    await expect(
      fromPackageOperation.run({
        source: {
          bytesBase64: bytesToBase64(new TextEncoder().encode("{}")),
          format: "docx",
        },
        targetFormat: "docx",
      }),
    ).rejects.toThrow(/no recognised \$schema/);
  });
});
