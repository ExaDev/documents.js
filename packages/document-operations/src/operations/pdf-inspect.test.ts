import { bytesToBase64, createPdf } from "documents.js";
import { describe, expect, it } from "vitest";
import { pdfInspectOperation } from "./pdf-inspect";

describe("pdfInspectOperation", () => {
  it("summarises a fresh single-page PDF", async () => {
    const bytesBase64 = bytesToBase64(createPdf().toBytes());
    const result = await pdfInspectOperation.run({
      source: { bytesBase64, format: "pdf" },
    });
    if (!("pageCount" in result)) {
      throw new Error("expected a summary, not a full LayoutDocument");
    }
    expect(result.pageCount).toBeGreaterThan(0);
  });

  it("rejects a non-pdf source", async () => {
    const bytesBase64 = bytesToBase64(new TextEncoder().encode("not a pdf"));
    await expect(
      pdfInspectOperation.run({
        source: { bytesBase64, format: "markdown" },
      }),
    ).rejects.toThrow(/requires a PDF document/);
  });
});
