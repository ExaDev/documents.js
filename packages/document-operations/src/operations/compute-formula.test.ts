import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    const editor = createDocx();
    editor.body.appendParagraph({ text: "No maths here." });
    const dir = mkdtempSync(join(tmpdir(), "compute-formula-test-"));
    const path = join(dir, "doc.docx");
    writeFileSync(path, editor.toBytes());
    const controller = new AbortController();
    controller.abort();

    await expect(
      computeFormulaOperation.run(
        { source: { path } },
        { signal: controller.signal },
      ),
    ).rejects.toThrow();
  });
});
