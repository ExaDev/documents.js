import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("reads the master document from a real filesystem path", async () => {
    const masterBytes = odmBytes([{ name: "ch1", href: "../chapter1.odt" }]);
    const chapterBytes = chapterOdtBytes("Chapter One", "Chapter body text.");
    const dir = mkdtempSync(join(tmpdir(), "odm-test-"));
    const masterPath = join(dir, "master.odm");
    writeFileSync(masterPath, masterBytes);

    const result = await odmToPdfOperation.run(
      odmToPdfOperation.inputSchema.parse({
        source: { path: masterPath },
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

  it("resolves an unresolved chapter href from chaptersDir, matched by the href's own basename", async () => {
    const masterBytes = odmBytes([{ name: "ch1", href: "../chapter1.odt" }]);
    const chapterBytes = chapterOdtBytes("Chapter One", "Chapter body text.");
    const dir = mkdtempSync(join(tmpdir(), "odm-test-"));
    writeFileSync(join(dir, "chapter1.odt"), chapterBytes);

    const result = await odmToPdfOperation.run(
      odmToPdfOperation.inputSchema.parse({
        source: { bytesBase64: bytesToBase64(masterBytes) },
        chaptersDir: dir,
      }),
    );

    expect("bytesBase64" in result).toBe(true);
    expect(result.byteLength).toBeGreaterThan(0);
  });

  it("throws OdmUnresolvedSectionError when chaptersDir does not contain the href's own basename either", async () => {
    const masterBytes = odmBytes([{ name: "ch1", href: "../chapter1.odt" }]);
    const dir = mkdtempSync(join(tmpdir(), "odm-test-"));

    await expect(
      odmToPdfOperation.run(
        odmToPdfOperation.inputSchema.parse({
          source: { bytesBase64: bytesToBase64(masterBytes) },
          chaptersDir: dir,
        }),
      ),
    ).rejects.toMatchObject({ hrefs: ["../chapter1.odt"] });
  });
});
