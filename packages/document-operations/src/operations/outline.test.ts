import { bytesToBase64, createDocx } from "documents.js";
import { describe, expect, it } from "vitest";
import { outlineDocumentOperation } from "./outline";

describe("outlineDocumentOperation", () => {
  it("projects a heading and a plain paragraph as an outline", async () => {
    const editor = createDocx();
    editor.body.appendParagraph({ text: "Heading", headingLevel: 1 });
    editor.body.appendParagraph({ text: "Body text." });
    const bytesBase64 = bytesToBase64(editor.toBytes());

    const result = await outlineDocumentOperation.run({
      source: { bytesBase64, format: "docx" },
    });

    expect(result.sourceFormat).toBe("docx");
    expect(result.outline.length).toBeGreaterThan(0);
  });
});
