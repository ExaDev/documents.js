import { bytesToBase64, createDocx } from "documents.js";
import { describe, expect, it } from "vitest";
import { describeFontFileOperation, fontsOperation } from "./fonts";

describe("fontsOperation", () => {
  it("reports no embedded faces for a fresh docx with none", async () => {
    const bytesBase64 = bytesToBase64(createDocx().toBytes());
    const result = await fontsOperation.run({
      source: { bytesBase64, format: "docx" },
    });
    expect(result.faces).toEqual([]);
  });
});

describe("describeFontFileOperation", () => {
  it("propagates a parse failure for bytes that are not a real font", async () => {
    await expect(
      describeFontFileOperation.run({
        source: {
          bytesBase64: bytesToBase64(new TextEncoder().encode("not a font")),
        },
      }),
    ).rejects.toThrow();
  });
});
