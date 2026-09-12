/// <reference lib="dom" />
/// <reference types="wicg-file-system-access" />
import { afterEach, describe, expect, it } from "vitest";

import { createFileAccess } from "./createFileAccess";

afterEach(() => {
  Reflect.deleteProperty(window, "showOpenFilePicker");
});

describe("createFileAccess", () => {
  it("returns the native adapter when the browser exposes showOpenFilePicker", () => {
    window.showOpenFilePicker = (): Promise<[FileSystemFileHandle]> =>
      Promise.reject(new Error("not used by this test"));
    const access = createFileAccess();
    expect(access.supportsNativePicker()).toBe(true);
  });

  it("returns the fallback adapter when the browser has no showOpenFilePicker", () => {
    Reflect.deleteProperty(window, "showOpenFilePicker");
    const access = createFileAccess();
    expect(access.supportsNativePicker()).toBe(false);
  });
});
