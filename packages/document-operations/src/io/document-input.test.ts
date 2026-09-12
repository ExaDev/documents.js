import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bytesToBase64 } from "documents.js";
import { describe, expect, it } from "vitest";
import {
  inferFormatFromExtension,
  resolveDocumentInput,
} from "./document-input";

describe("inferFormatFromExtension", () => {
  it("infers a format from a plain filename's extension, case-insensitively", () => {
    expect(inferFormatFromExtension("report.DOCX")).toBe("docx");
  });

  it("reads the extension from the final path segment, ignoring dots in earlier segments", () => {
    expect(inferFormatFromExtension("a.b/c.docx")).toBe("docx");
  });

  it("splits on a backslash separator too, not only a forward slash", () => {
    expect(inferFormatFromExtension("C:\\docs\\report.docx")).toBe("docx");
  });

  it("returns undefined for a path with no dot at all", () => {
    expect(inferFormatFromExtension("README")).toBeUndefined();
  });

  it("returns undefined for a leading dot with no further dot (dotIndex === 0)", () => {
    expect(inferFormatFromExtension(".gitignore")).toBeUndefined();
  });

  it("returns undefined for an unrecognised extension", () => {
    expect(inferFormatFromExtension("archive.notaformat")).toBeUndefined();
  });
});

describe("resolveDocumentInput", () => {
  it("reads real bytes and infers the format from a real file's own extension", async () => {
    const dir = mkdtempSync(join(tmpdir(), "document-input-test-"));
    const path = join(dir, "hello.md");
    writeFileSync(path, "# Hello");

    const resolved = await resolveDocumentInput({ path });

    expect(resolved.format).toBe("markdown");
    expect(new TextDecoder().decode(resolved.bytes)).toBe("# Hello");
  });

  it("throws naming every recognised extension, comma-separated, for an unrecognised one", async () => {
    await expect(
      resolveDocumentInput({ path: "/tmp/does-not-exist.notaformat" }),
    ).rejects.toThrow(/Recognised extensions: docx, dotx, docm/);
  });

  it("decodes inline bytesBase64 and uses the caller-supplied format directly, ignoring any extension", async () => {
    const bytes = new TextEncoder().encode("plain text");
    const resolved = await resolveDocumentInput({
      bytesBase64: bytesToBase64(bytes),
      format: "markdown",
    });

    expect(resolved.format).toBe("markdown");
    expect(new TextDecoder().decode(resolved.bytes)).toBe("plain text");
  });

  it("propagates an already-aborted signal for a path input", async () => {
    const dir = mkdtempSync(join(tmpdir(), "document-input-test-"));
    const path = join(dir, "hello.md");
    writeFileSync(path, "# Hello");
    const controller = new AbortController();
    controller.abort();

    await expect(
      resolveDocumentInput({ path }, { signal: controller.signal }),
    ).rejects.toThrow();
  });
});
