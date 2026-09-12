/// <reference lib="dom" />
/// <reference types="wicg-file-system-access" />
import { afterEach, describe, expect, it, vi } from "vitest";

import { createNativeFileAccess } from "./nativeFileAccess";

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "showOpenFilePicker");
  Reflect.deleteProperty(window, "showSaveFilePicker");
});

// A fully-typed FileSystemFileHandle double: every member the real interface requires, not just the two (getFile/createWritable) this adapter actually calls, so the double stays sound without casting away the type it stands in for.
function stubHandle(
  bytes: Uint8Array<ArrayBuffer>,
  name: string,
): FileSystemFileHandle {
  const file = new File([bytes], name);
  return {
    kind: "file",
    name,
    isFile: true,
    isDirectory: false,
    isSameEntry: () => Promise.resolve(false),
    queryPermission: () => Promise.resolve("granted"),
    requestPermission: () => Promise.resolve("granted"),
    getFile: () => Promise.resolve(file),
    createWritable: () =>
      Promise.reject(new Error("createWritable not stubbed on this handle")),
  };
}

// Likewise a fully-typed FileSystemWritableFileStream double (write/close are spies the save tests assert on; the rest of WritableStream's own required surface is inert filler this adapter never touches).
function stubWritable() {
  const write = vi.fn(() => Promise.resolve());
  const close = vi.fn(() => Promise.resolve());
  const stream: FileSystemWritableFileStream = {
    locked: false,
    write,
    close,
    abort: () => Promise.resolve(),
    getWriter: () => {
      throw new Error("getWriter is not implemented in this test double");
    },
    seek: () => Promise.resolve(),
    truncate: () => Promise.resolve(),
  };
  return { stream, write, close };
}

describe("createNativeFileAccess", () => {
  it("reports native picker support", () => {
    expect(createNativeFileAccess().supportsNativePicker()).toBe(true);
  });

  describe("openFile", () => {
    it("resolves the chosen file's bytes, name, and handle", async () => {
      const handle = stubHandle(new Uint8Array([9, 8, 7]), "a.docx");
      const showOpenFilePicker = vi.fn().mockResolvedValue([handle]);
      window.showOpenFilePicker = showOpenFilePicker;

      const opened = await createNativeFileAccess().openFile({});
      expect(opened?.name).toBe("a.docx");
      expect(Array.from(opened?.bytes ?? [])).toEqual([9, 8, 7]);
      expect(opened?.handle).toBe(handle);
    });

    it("passes a Document-described types array built from the given accept option", async () => {
      const handle = stubHandle(new Uint8Array([1]), "a.pdf");
      const showOpenFilePicker = vi.fn().mockResolvedValue([handle]);
      window.showOpenFilePicker = showOpenFilePicker;
      const accept = { "application/pdf": [".pdf"] } as Record<
        MIMEType,
        FileExtension[]
      >;

      await createNativeFileAccess().openFile({ accept });

      expect(showOpenFilePicker).toHaveBeenCalledWith({
        types: [{ description: "Document", accept }],
        multiple: false,
      });
    });

    it("passes undefined types when no accept option is given", async () => {
      const handle = stubHandle(new Uint8Array([1]), "a.pdf");
      const showOpenFilePicker = vi.fn().mockResolvedValue([handle]);
      window.showOpenFilePicker = showOpenFilePicker;

      await createNativeFileAccess().openFile({});

      expect(showOpenFilePicker).toHaveBeenCalledWith({
        types: undefined,
        multiple: false,
      });
    });

    it("resolves undefined when the user aborts the native picker", async () => {
      const showOpenFilePicker = vi
        .fn()
        .mockRejectedValue(new DOMException("cancelled", "AbortError"));
      window.showOpenFilePicker = showOpenFilePicker;

      const opened = await createNativeFileAccess().openFile({});
      expect(opened).toBeUndefined();
    });

    it("rethrows a picker failure that is not an AbortError", async () => {
      const showOpenFilePicker = vi
        .fn()
        .mockRejectedValue(new DOMException("denied", "SecurityError"));
      window.showOpenFilePicker = showOpenFilePicker;

      await expect(createNativeFileAccess().openFile({})).rejects.toThrow(
        "denied",
      );
    });

    it("rethrows a non-DOMException failure from the picker", async () => {
      const showOpenFilePicker = vi.fn().mockRejectedValue(new Error("boom"));
      window.showOpenFilePicker = showOpenFilePicker;

      await expect(createNativeFileAccess().openFile({})).rejects.toThrow(
        "boom",
      );
    });

    it("resolves undefined when the picker resolves an empty handle list", async () => {
      const showOpenFilePicker = vi.fn().mockResolvedValue([]);
      window.showOpenFilePicker = showOpenFilePicker;

      const opened = await createNativeFileAccess().openFile({});
      expect(opened).toBeUndefined();
    });
  });

  describe("saveFile", () => {
    it("writes bytes through a writable stream and resolves the handle", async () => {
      const { stream, write, close } = stubWritable();
      const handle = stubHandle(new Uint8Array([1]), "out.pdf");
      handle.createWritable = () => Promise.resolve(stream);
      const showSaveFilePicker = vi.fn().mockResolvedValue(handle);
      window.showSaveFilePicker = showSaveFilePicker;

      const bytes = new Uint8Array([1, 2, 3]);
      const result = await createNativeFileAccess().saveFile(bytes, {
        suggestedName: "out.pdf",
        mimeType: "application/pdf",
      });

      expect(showSaveFilePicker).toHaveBeenCalledWith({
        suggestedName: "out.pdf",
        types: [
          {
            description: "Document",
            accept: { "application/pdf": [".pdf"] },
          },
        ],
      });
      expect(write).toHaveBeenCalledWith(bytes);
      expect(close).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ handle });
    });

    it("derives the accept extension from the suggested name's own extension", async () => {
      const { stream } = stubWritable();
      const handle = stubHandle(new Uint8Array([1]), "archive.tar.docx");
      handle.createWritable = () => Promise.resolve(stream);
      const showSaveFilePicker = vi.fn().mockResolvedValue(handle);
      window.showSaveFilePicker = showSaveFilePicker;

      await createNativeFileAccess().saveFile(new Uint8Array([1]), {
        suggestedName: "archive.tar.docx",
        mimeType: "application/vnd.openxmlformats",
      });

      expect(showSaveFilePicker).toHaveBeenCalledWith({
        suggestedName: "archive.tar.docx",
        types: [
          {
            description: "Document",
            accept: { "application/vnd.openxmlformats": [".docx"] },
          },
        ],
      });
    });

    it("uses the whole suggested name as the accept extension when it carries no dot at all", async () => {
      const { stream } = stubWritable();
      const handle = stubHandle(new Uint8Array([1]), "noextension");
      handle.createWritable = () => Promise.resolve(stream);
      const showSaveFilePicker = vi.fn().mockResolvedValue(handle);
      window.showSaveFilePicker = showSaveFilePicker;

      await createNativeFileAccess().saveFile(new Uint8Array([1]), {
        suggestedName: "noextension",
        mimeType: "application/octet-stream",
      });

      expect(showSaveFilePicker).toHaveBeenCalledWith({
        suggestedName: "noextension",
        types: [
          {
            description: "Document",
            accept: { "application/octet-stream": [".noextension"] },
          },
        ],
      });
    });

    it("resolves an empty result when the user aborts the save picker", async () => {
      const showSaveFilePicker = vi
        .fn()
        .mockRejectedValue(new DOMException("cancelled", "AbortError"));
      window.showSaveFilePicker = showSaveFilePicker;

      const result = await createNativeFileAccess().saveFile(
        new Uint8Array([1]),
        { suggestedName: "a.pdf", mimeType: "application/pdf" },
      );
      expect(result).toEqual({});
    });

    it("rethrows a save-picker failure that is not an AbortError", async () => {
      const showSaveFilePicker = vi
        .fn()
        .mockRejectedValue(new DOMException("denied", "SecurityError"));
      window.showSaveFilePicker = showSaveFilePicker;

      await expect(
        createNativeFileAccess().saveFile(new Uint8Array([1]), {
          suggestedName: "a.pdf",
          mimeType: "application/pdf",
        }),
      ).rejects.toThrow("denied");
    });

    it("rethrows a non-DOMException failure from the save picker", async () => {
      const showSaveFilePicker = vi.fn().mockRejectedValue(new Error("boom"));
      window.showSaveFilePicker = showSaveFilePicker;

      await expect(
        createNativeFileAccess().saveFile(new Uint8Array([1]), {
          suggestedName: "a.pdf",
          mimeType: "application/pdf",
        }),
      ).rejects.toThrow("boom");
    });
  });
});
