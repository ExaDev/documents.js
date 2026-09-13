import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  fixtureCalibriFontBytes,
  vendoredCaladeaFaceBytes,
} from "../test-support/font-fixture";
import { loadProvidedFonts } from "./fonts";

let workspace: string;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "document-cli-runtime-fonts-"));
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("loadProvidedFonts", () => {
  it("returns an empty array for no paths, reading nothing", async () => {
    expect(await loadProvidedFonts([])).toEqual([]);
  });

  it("reads a single font file and pairs its bytes with its declared face", async () => {
    const bytes = fixtureCalibriFontBytes();
    const path = join(workspace, "regular.ttf");
    await writeFile(path, bytes);

    const [font] = await loadProvidedFonts([path]);
    expect(font).toBeDefined();
    expect(font?.family).toBe("Calibri");
    expect(font?.bold).toBe(false);
    expect(font?.italic).toBe(false);
    expect(font?.bytes).toEqual(bytes);
  });

  it("reads bold and italic faces and reports the declared style for each", async () => {
    const boldBytes = vendoredCaladeaFaceBytes({ bold: true, italic: false });
    const italicBytes = vendoredCaladeaFaceBytes({
      bold: false,
      italic: true,
    });
    const boldPath = join(workspace, "bold.ttf");
    const italicPath = join(workspace, "italic.ttf");
    await writeFile(boldPath, boldBytes);
    await writeFile(italicPath, italicBytes);

    const [bold, italic] = await loadProvidedFonts([boldPath, italicPath]);
    expect(bold?.bold).toBe(true);
    expect(bold?.italic).toBe(false);
    expect(italic?.bold).toBe(false);
    expect(italic?.italic).toBe(true);
  });

  it("reads multiple font files in the given order", async () => {
    const first = vendoredCaladeaFaceBytes({ bold: false, italic: false });
    const second = vendoredCaladeaFaceBytes({ bold: true, italic: true });
    const firstPath = join(workspace, "first.ttf");
    const secondPath = join(workspace, "second.ttf");
    await writeFile(firstPath, first);
    await writeFile(secondPath, second);

    const fonts = await loadProvidedFonts([firstPath, secondPath]);
    expect(fonts).toHaveLength(2);
    expect(fonts[0]?.bytes).toEqual(first);
    expect(fonts[1]?.bytes).toEqual(second);
    expect(fonts[0]?.bold).toBe(false);
    expect(fonts[1]?.bold).toBe(true);
  });

  it("rejects with the specific missing path when a font file does not exist", async () => {
    const missing = join(workspace, "does-not-exist.ttf");
    await expect(loadProvidedFonts([missing])).rejects.toThrow(/ENOENT/);
  });

  it("stops at the first unreadable path rather than reading the rest", async () => {
    const missing = join(workspace, "still-missing.ttf");
    const goodPath = join(workspace, "after-missing.ttf");
    await writeFile(goodPath, fixtureCalibriFontBytes());

    await expect(loadProvidedFonts([missing, goodPath])).rejects.toThrow(
      /ENOENT/,
    );
  });

  it("rejects instead of reading the file once the given signal is already aborted", async () => {
    const path = join(workspace, "aborted.ttf");
    await writeFile(path, fixtureCalibriFontBytes());
    const controller = new AbortController();
    controller.abort();

    await expect(
      loadProvidedFonts([path], { signal: controller.signal }),
    ).rejects.toThrow(/abort/i);
  });
});
