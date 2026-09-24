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

/** Invalid lead bytes for UTF-8. */
const INVALID_UTF8_LEAD_BYTE_1 = 0xff;
const INVALID_UTF8_LEAD_BYTE_2 = 0xfe;

/** The ASCII codes for `{` and `}`, appended after the invalid lead bytes so the fixture also looks, at a glance, like it might open a JSON object. */
const ASCII_OPEN_BRACE = 0x7b;
const ASCII_CLOSE_BRACE = 0x7d;

/** A byte sequence that fails UTF-8 decoding before any JSON parsing is attempted — the fixture `fromPackageOperation` needs to prove the raw-decode failure is reported distinctly from the "not valid JSON" wrapper. */
const INVALID_UTF8_JSON_LOOKALIKE_BYTES = [
  INVALID_UTF8_LEAD_BYTE_1,
  INVALID_UTF8_LEAD_BYTE_2,
  ASCII_OPEN_BRACE,
  ASCII_CLOSE_BRACE,
];

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the promise to reject");
}

describe("fromPackageOperation", () => {
  it("propagates a raw decode failure for invalid UTF-8 bytes, distinct from the 'not valid JSON' wrapper", async () => {
    const invalidUtf8 = new Uint8Array(INVALID_UTF8_JSON_LOOKALIKE_BYTES);

    await expect(
      fromPackageOperation.run({
        source: { bytesBase64: bytesToBase64(invalidUtf8), format: "docx" },
        targetFormat: "docx",
      }),
    ).rejects.toThrow(/not valid for encoding/);
  });

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

  it("rejects source bytes that are not valid JSON, carrying the original parse error as its cause", async () => {
    const error = await captureRejection(
      fromPackageOperation.run({
        source: {
          bytesBase64: bytesToBase64(new TextEncoder().encode("not json")),
          format: "docx",
        },
        targetFormat: "docx",
      }),
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/not valid JSON/);
    expect((error as Error).cause).toBeInstanceOf(Error);
  });

  it("rejects a value with no recognised $schema, carrying the original error as its cause", async () => {
    const error = await captureRejection(
      fromPackageOperation.run({
        source: {
          bytesBase64: bytesToBase64(new TextEncoder().encode("{}")),
          format: "docx",
        },
        targetFormat: "docx",
      }),
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/no recognised \$schema/);
    expect((error as Error).cause).toBeInstanceOf(Error);
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
    // A DocumentTree's own kind must be a recognised literal — corrupting it keeps $schema pointing at a real, current DocumentTree schema (so the version/stem checks all pass) while failing DocumentTreeSchema.parse itself with a genuine ZodError.
    const corrupted = { ...dump, kind: "not-a-real-kind" };

    const error = await captureRejection(
      fromPackageOperation.run({
        source: {
          bytesBase64: bytesToBase64(
            new TextEncoder().encode(JSON.stringify(corrupted)),
          ),
          format: "docx",
        },
        targetFormat: "docx",
      }),
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(
      /'source' failed DocumentTree validation/,
    );
    expect((error as Error).cause).toBeInstanceOf(Error);
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
      "'source' is a ContentDocument, not a DocumentTree — only a file carrying a real DocumentTree (e.g. written by a caller's own --dump-package-equivalent step) can be read back by this operation",
    );
  });
});
