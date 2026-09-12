import { bytesToBase64, createDocx } from "documents.js";
import { describe, expect, it } from "vitest";
import { computeFormulaOperation } from "./compute-formula";

describe("computeFormulaOperation", () => {
  it("reports zero formulas for a document that embeds none", async () => {
    const editor = createDocx();
    editor.body.appendParagraph({ text: "No maths here." });
    const bytesBase64 = bytesToBase64(editor.toBytes());

    const result = await computeFormulaOperation.run({
      source: { bytesBase64, format: "docx" },
    });

    expect(result.sourceFormat).toBe("docx");
    expect(result.formulaCount).toBe(0);
    expect(result.formulas).toEqual([]);
  });

  it("propagates an already-aborted signal through to reading the document's own native tree", async () => {
    const editor = createDocx();
    editor.body.appendParagraph({ text: "No maths here." });
    const bytesBase64 = bytesToBase64(editor.toBytes());
    const controller = new AbortController();
    controller.abort();

    await expect(
      computeFormulaOperation.run(
        { source: { bytesBase64, format: "docx" } },
        { signal: controller.signal },
      ),
    ).rejects.toThrow();
  });

  it("propagates an already-aborted signal through to resolving a path source's own bytes", async () => {
    // A path that does not exist, so a real fs error (not the tree-read's own abort check) would result if resolveDocumentInput's own signal forwarding were ever dropped -- distinguishing this call site's abort handling from readNativeDocumentTree's, which would otherwise mask the difference (a real file's read would succeed either way, and the SAME signal would still abort the downstream tree read).
    const controller = new AbortController();
    controller.abort();

    await expect(
      computeFormulaOperation.run(
        { source: { path: "/tmp/does-not-exist-compute-formula-test.docx" } },
        { signal: controller.signal },
      ),
    ).rejects.toThrow(/abort/i);
  });
});
