import { describe, expect, it } from "vitest";
import {
  isRecord,
  readWorkspacePackage,
  touchedPackageDirectories,
} from "./check-npm-registration";

describe("readWorkspacePackage", () => {
  it("reads a package name and directory from package.json", () => {
    expect(
      readWorkspacePackage('{"name": "pdf-raster-cpu"}', "pdf-raster-cpu"),
    ).toEqual({
      name: "pdf-raster-cpu",
      directory: "pdf-raster-cpu",
      private: false,
    });
  });

  it("reads private: true", () => {
    expect(
      readWorkspacePackage('{"name": "web", "private": true}', "web"),
    ).toEqual({ name: "web", directory: "web", private: true });
  });

  it("keeps the directory separate from a scoped package name", () => {
    expect(readWorkspacePackage('{"name": "@exadev/thing"}', "thing")).toEqual({
      name: "@exadev/thing",
      directory: "thing",
      private: false,
    });
  });

  it("throws when the name field is missing", () => {
    expect(() => readWorkspacePackage("{}", "thing")).toThrow(/name/);
  });

  it("throws when the name field is not a string", () => {
    expect(() => readWorkspacePackage('{"name": 1}', "thing")).toThrow(/name/);
  });
});

describe("touchedPackageDirectories", () => {
  it("extracts the package directory from a changed source path", () => {
    const touched = touchedPackageDirectories([
      "packages/pdf-raster-cpu/src/index.ts",
    ]);
    expect(touched.has("pdf-raster-cpu")).toBe(true);
  });

  it("extracts the package directory from a changed package.json alone", () => {
    const touched = touchedPackageDirectories([
      "packages/byte-codec/package.json",
    ]);
    expect(touched.has("byte-codec")).toBe(true);
  });

  it("ignores paths outside packages/", () => {
    const touched = touchedPackageDirectories([
      "README.md",
      ".github/workflows/ci.yml",
    ]);
    expect(touched.size).toBe(0);
  });

  it("ignores a bare packages/ path with no directory beneath it", () => {
    expect(touchedPackageDirectories(["packages/README.md"]).size).toBe(0);
  });

  it("collects every distinct directory across several changed paths", () => {
    const touched = touchedPackageDirectories([
      "packages/byte-codec/src/index.ts",
      "packages/byte-codec/src/crc32.ts",
      "packages/pdf-codec/src/read.ts",
    ]);
    expect([...touched].sort()).toEqual(["byte-codec", "pdf-codec"]);
  });
});

describe("isRecord", () => {
  it("accepts a plain object", () => {
    expect(isRecord({})).toBe(true);
  });

  it("rejects an array", () => {
    expect(isRecord([])).toBe(false);
  });

  it("rejects null", () => {
    expect(isRecord(null)).toBe(false);
  });

  it("rejects a primitive", () => {
    expect(isRecord("string")).toBe(false);
  });
});
