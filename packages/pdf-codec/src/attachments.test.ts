import { describe, expect, it } from "vitest";
import { readPdf } from "./read";
import { embeddedFilesPdf } from "./test-support/pdf";
import { bytesToBase64 } from "./util/base64";

// Embedded files (#721 phase 2): /Names /EmbeddedFiles name-tree entries, /FileAttachment annotations' /FS filespecs, and catalog /AF associated files (ISO 32000-2), all decoded to base64 through the ordinary stream filters and deduplicated by filespec name.

function b64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

describe("readPdf: embedded files", () => {
  it("reads a name-tree embedded file with its description and MIME type, decoding the stream", () => {
    const doc = readPdf(embeddedFilesPdf());
    expect(doc.attachments?.find((a) => a.name === "notes.txt")).toEqual({
      name: "notes.txt",
      description: "Meeting notes",
      mimeType: "text/plain",
      base64: b64("Attached file body"),
    });
  });

  it("collects a /FileAttachment annotation's filespec and a catalog /AF entry, deduplicated against the name tree by name", () => {
    const doc = readPdf(embeddedFilesPdf());
    const names = doc.attachments?.map((a) => a.name);
    expect(names).toEqual(["notes.txt", "logo.bin", "manifest.json"]);
    const logo = doc.attachments?.find((a) => a.name === "logo.bin");
    expect(logo?.base64).toBe(bytesToBase64(new Uint8Array([0, 1, 2])));
    expect(logo?.mimeType).toBeUndefined();
    const manifest = doc.attachments?.find((a) => a.name === "manifest.json");
    expect(manifest?.description).toBeUndefined();
  });
});
