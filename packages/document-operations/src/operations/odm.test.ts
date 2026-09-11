import { bytesToBase64 } from "documents.js";
import { describe, expect, it } from "vitest";
import { chapterOdtBytes, odmBytes } from "../test-support/odm-fixture";
import { odmToPdfOperation } from "./odm";

describe("odmToPdfOperation", () => {
  it("converts a master document with its chapters supplied inline", async () => {
    const masterBytes = odmBytes([{ name: "ch1", href: "../chapter1.odt" }]);
    const chapterBytes = chapterOdtBytes("Chapter One", "Chapter body text.");

    const result = await odmToPdfOperation.run(
      odmToPdfOperation.inputSchema.parse({
        source: { bytesBase64: bytesToBase64(masterBytes) },
        chapters: [
          {
            href: "../chapter1.odt",
            source: {
              bytesBase64: bytesToBase64(chapterBytes),
              format: "odt",
            },
          },
        ],
      }),
    );

    expect("bytesBase64" in result).toBe(true);
    expect(result.byteLength).toBeGreaterThan(0);
  });

  it("throws OdmUnresolvedSectionError naming the unresolved href", async () => {
    const masterBytes = odmBytes([{ name: "ch1", href: "../missing.odt" }]);

    await expect(
      odmToPdfOperation.run(
        odmToPdfOperation.inputSchema.parse({
          source: { bytesBase64: bytesToBase64(masterBytes) },
        }),
      ),
    ).rejects.toMatchObject({ hrefs: ["../missing.odt"] });
  });
});
