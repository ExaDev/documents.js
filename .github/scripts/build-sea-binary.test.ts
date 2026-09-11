import { describe, expect, it } from "vitest";
import {
  binaryFileName,
  mainFormatFor,
  postBuildCommandsFor,
} from "./build-sea-binary";

describe("mainFormatFor", () => {
  it("reads module for a .mjs bundle and commonjs for anything else", () => {
    expect(mainFormatFor("dist-sea/sea-entry.mjs")).toBe("module");
    expect(mainFormatFor("dist-sea/sea-entry.cjs")).toBe("commonjs");
  });
});

describe("binaryFileName", () => {
  it("qualifies every platform with a distinct, human-readable label, appending .exe only on win32", () => {
    expect(binaryFileName("document-rest", "win32")).toBe(
      "document-rest-windows.exe",
    );
    expect(binaryFileName("document-rest", "darwin")).toBe(
      "document-rest-macos",
    );
    expect(binaryFileName("document-rest", "linux")).toBe(
      "document-rest-linux",
    );
  });
});

describe("postBuildCommandsFor", () => {
  it("force ad-hoc signs only on darwin, overwriting the copied Node binary's own real signature", () => {
    expect(postBuildCommandsFor("darwin", "/out/app")).toEqual([
      ["codesign", ["--sign", "-", "--force", "/out/app"]],
    ]);
    expect(postBuildCommandsFor("linux", "/out/app")).toEqual([]);
    expect(postBuildCommandsFor("win32", "C:\\out\\app.exe")).toEqual([]);
  });
});
