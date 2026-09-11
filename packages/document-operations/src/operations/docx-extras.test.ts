import { bytesToBase64, createDocx } from "documents.js";
import { describe, expect, it } from "vitest";
import { docxExtrasOperation } from "./docx-extras";

describe("docxExtrasOperation", () => {
  it("reports empty extras for a fresh docx with none", async () => {
    const bytesBase64 = bytesToBase64(createDocx().toBytes());
    const extras = await docxExtrasOperation.run({
      source: { bytesBase64, format: "docx" },
    });
    expect(extras.comments).toEqual([]);
    expect(extras.footnotes).toEqual([]);
  });
});
