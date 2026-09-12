import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bytesToBase64,
  contentDocumentWithSchema,
  createDocx,
  documentTreeWithSchema,
  readNativeDocumentTree,
} from "documents.js";
import { flattenTree } from "document-schema.js";
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

  it("reads a DocumentTree dump from a real filesystem path", async () => {
    const editor = createDocx();
    editor.body.appendParagraph({ text: "Round trip me." });
    const originalBytes = editor.toBytes();
    const tree = readNativeDocumentTree("docx", originalBytes);
    const dumpJson = JSON.stringify(documentTreeWithSchema(tree));
    const dir = mkdtempSync(join(tmpdir(), "from-package-test-"));
    const path = join(dir, "dump.json");
    writeFileSync(path, dumpJson);

    const result = await fromPackageOperation.run({
      source: { path },
      targetFormat: "docx",
    });

    expect("bytesBase64" in result).toBe(true);
    expect(result.byteLength).toBeGreaterThan(0);
  });

  it("rejects a real $schema whose value fails validation against its own schema, naming the schema kind", async () => {
    const editor = createDocx();
    editor.body.appendParagraph({ text: "Round trip me." });
    const tree = readNativeDocumentTree("docx", editor.toBytes());
    const dump = documentTreeWithSchema(tree);
    // A DocumentTree's own kind must be a recognised literal -- corrupting it keeps $schema pointing at a real, current DocumentTree schema (so the version/stem checks all pass) while failing DocumentTreeSchema.parse itself with a genuine ZodError.
    const corrupted = { ...dump, kind: "not-a-real-kind" };

    await expect(
      fromPackageOperation.run({
        source: {
          bytesBase64: bytesToBase64(
            new TextEncoder().encode(JSON.stringify(corrupted)),
          ),
          format: "docx",
        },
        targetFormat: "docx",
      }),
    ).rejects.toThrow(/'source' failed DocumentTree validation/);
  });

  it("rejects a value carrying a real ContentDocument $schema, naming it as not a DocumentTree", async () => {
    const editor = createDocx();
    editor.body.appendParagraph({ text: "Round trip me." });
    const tree = readNativeDocumentTree("docx", editor.toBytes());
    const content = flattenTree(tree);
    const dumpJson = JSON.stringify(contentDocumentWithSchema(content));

    await expect(
      fromPackageOperation.run({
        source: {
          bytesBase64: bytesToBase64(new TextEncoder().encode(dumpJson)),
          format: "docx",
        },
        targetFormat: "docx",
      }),
    ).rejects.toThrow(
      "'source' is a ContentDocument, not a DocumentTree -- only a file carrying a real DocumentTree (e.g. written by a caller's own --dump-package-equivalent step) can be read back by this operation",
    );
  });
});
