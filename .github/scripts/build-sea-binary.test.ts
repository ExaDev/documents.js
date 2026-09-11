import { describe, expect, it } from "vitest";
import {
  binaryFileName,
  postInjectionCommandsFor,
  postjectArgsFor,
  preInjectionCommandsFor,
} from "./build-sea-binary";

describe("binaryFileName", () => {
  it("appends .exe only on win32", () => {
    expect(binaryFileName("document-rest", "win32")).toBe("document-rest.exe");
    expect(binaryFileName("document-rest", "darwin")).toBe("document-rest");
    expect(binaryFileName("document-rest", "linux")).toBe("document-rest");
  });
});

describe("postjectArgsFor", () => {
  it("adds the Mach-O segment name only on darwin", () => {
    expect(postjectArgsFor("darwin")).toEqual([
      "--macho-segment-name",
      "NODE_SEA",
    ]);
    expect(postjectArgsFor("linux")).toEqual([]);
    expect(postjectArgsFor("win32")).toEqual([]);
  });
});

describe("preInjectionCommandsFor", () => {
  it("removes an existing signature only on win32", () => {
    expect(preInjectionCommandsFor("win32", "C:\\out\\app.exe")).toEqual([
      ["signtool", ["remove", "/s", "C:\\out\\app.exe"]],
    ]);
    expect(preInjectionCommandsFor("darwin", "/out/app")).toEqual([]);
    expect(preInjectionCommandsFor("linux", "/out/app")).toEqual([]);
  });
});

describe("postInjectionCommandsFor", () => {
  it("ad-hoc signs only on darwin, removing the copied signature first", () => {
    expect(postInjectionCommandsFor("darwin", "/out/app")).toEqual([
      ["codesign", ["--remove-signature", "/out/app"]],
      ["codesign", ["--sign", "-", "/out/app"]],
    ]);
    expect(postInjectionCommandsFor("linux", "/out/app")).toEqual([]);
    expect(postInjectionCommandsFor("win32", "C:\\out\\app.exe")).toEqual([]);
  });
});
