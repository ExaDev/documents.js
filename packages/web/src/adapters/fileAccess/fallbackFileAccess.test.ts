/// <reference lib="dom" />
import { afterEach, describe, expect, it, vi } from "vitest";

import { createFallbackFileAccess } from "./fallbackFileAccess";

afterEach(() => {
  vi.restoreAllMocks();
});

// The adapter only ever reads input.files?.[0] -- a numeric-indexed, length-and-item object is all FileList's real interface requires for that, so this builds one directly rather than via object-spreading a File[] (which TypeScript flags as overwriting length/index properties it considers already declared by the array's own structural type).
function fileList(files: File[]): FileList {
  const list: FileList = {
    length: files.length,
    item: (index: number) => files[index] ?? null,
    [Symbol.iterator]: () => files[Symbol.iterator](),
  };
  files.forEach((file, index) => {
    list[index] = file;
  });
  return list;
}

// The adapter drives the picker via input.click(), which a real browser resolves only after the user interacts -- here we intercept the click itself to synthesize the OS picker's outcome (a chosen file, or none) before dispatching the 'change' listener the code awaits.
function stubPickedFiles(files: File[]): void {
  vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
    this: HTMLInputElement,
  ) {
    Object.defineProperty(this, "files", {
      value: fileList(files),
      configurable: true,
    });
    this.dispatchEvent(new Event("change"));
  });
}

describe("createFallbackFileAccess", () => {
  it("reports no native picker support", () => {
    expect(createFallbackFileAccess().supportsNativePicker()).toBe(false);
  });

  it("resolves the opened file's bytes and name when a file is chosen", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "report.pdf", {
      type: "application/pdf",
    });
    stubPickedFiles([file]);
    const opened = await createFallbackFileAccess().openFile({});
    expect(opened?.name).toBe("report.pdf");
    expect(Array.from(opened?.bytes ?? [])).toEqual([1, 2, 3]);
    expect(opened?.handle).toBeUndefined();
  });

  it("resolves undefined when the picker is dismissed with no file chosen", async () => {
    stubPickedFiles([]);
    const opened = await createFallbackFileAccess().openFile({});
    expect(opened).toBeUndefined();
  });

  it("flattens and joins an accept map's extension groups into the input's accept attribute", async () => {
    let capturedAccept = "";
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
      this: HTMLInputElement,
    ) {
      capturedAccept = this.accept;
      Object.defineProperty(this, "files", {
        value: fileList([]),
        configurable: true,
      });
      this.dispatchEvent(new Event("change"));
    });
    await createFallbackFileAccess().openFile({
      accept: {
        "application/pdf": [".pdf"],
        "text/markdown": [".md", ".markdown"],
      },
    });
    expect(capturedAccept).toBe(".pdf,.md,.markdown");
  });

  it("leaves the input's accept attribute empty when no accept option is given", async () => {
    let capturedAccept = "not set";
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
      this: HTMLInputElement,
    ) {
      capturedAccept = this.accept;
      Object.defineProperty(this, "files", {
        value: fileList([]),
        configurable: true,
      });
      this.dispatchEvent(new Event("change"));
    });
    await createFallbackFileAccess().openFile({});
    expect(capturedAccept).toBe("");
  });

  it("saves via a Blob-URL download anchor and revokes the object URL afterwards", async () => {
    const createObjectURLSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:mock-url");
    const revokeObjectURLSpy = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    let clickedHref = "";
    let clickedDownload = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clickedHref = this.href;
      clickedDownload = this.download;
    });

    const result = await createFallbackFileAccess().saveFile(
      new Uint8Array([1, 2, 3]),
      { suggestedName: "out.pdf", mimeType: "application/pdf" },
    );

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(clickedHref).toBe("blob:mock-url");
    expect(clickedDownload).toBe("out.pdf");
    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:mock-url");
    expect(result).toEqual({});
  });
});
