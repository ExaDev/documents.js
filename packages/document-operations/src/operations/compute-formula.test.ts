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
});
