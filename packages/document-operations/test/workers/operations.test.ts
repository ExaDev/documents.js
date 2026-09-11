import { bytesToBase64, encodeMarkdownText } from "documents.js";
import { describe, expect, it } from "vitest";
import { convertDocumentOperation, listDocumentConversionsOperation } from "../../src/operations/convert";

// Exercises two operations' run() directly under the Cloudflare Workers runtime (workerd, via @cloudflare/vitest-pool-workers) with only the bytesBase64 input path -- the same restriction document-mcp's own workers test suite documents for the identical reason: resolveDocumentInput's 'path' branch is Node-only (node:fs/promises), but 'bytesBase64' is not. If the exercised path touched a Node-only API, the workerd isolate would throw at import or invocation rather than these passing.
describe("convertDocumentOperation under the Cloudflare Workers runtime", () => {
  it("converts markdown to docx via the bytesBase64 input path", async () => {
    const markdownBytes = encodeMarkdownText(
      "# Heading\n\nA paragraph with **bold** text.\n",
    );

    const result = await convertDocumentOperation.run({
      source: { bytesBase64: bytesToBase64(markdownBytes), format: "markdown" },
      targetFormat: "docx",
    });

    expect("bytesBase64" in result.output).toBe(true);
    expect(result.output.byteLength).toBeGreaterThan(0);
  });

  it("lists the converter's own dispatch table", async () => {
    const result = await listDocumentConversionsOperation.run({});
    expect(result.conversions).toContainEqual({
      source: "markdown",
      target: "docx",
    });
  });
});
