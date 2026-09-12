import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  it("propagates a parse failure for bytes that are not a real font, labelling the source 'inline font bytes'", async () => {
    await expect(
      describeFontFileOperation.run({
        source: {
          bytesBase64: bytesToBase64(new TextEncoder().encode("not a font")),
        },
      }),
    ).rejects.toThrow(/^inline font bytes is not a TrueType\/OpenType font/);
  });

  it("propagates a parse failure identically for a font file read from a path, naming the real path in the error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fonts-test-"));
    const path = join(dir, "not-a-font.ttf");
    writeFileSync(path, "not a font");

    await expect(
      describeFontFileOperation.run({ source: { path } }),
    ).rejects.toThrow(new RegExp(path.replace(/[/\\]/g, "\\$&")));
  });
});
