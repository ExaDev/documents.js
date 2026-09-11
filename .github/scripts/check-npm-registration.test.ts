import { describe, expect, it } from "vitest";
import {
  isRecord,
  readAcknowledgedNames,
  readWorkspacePackage,
} from "./check-npm-registration";

describe("readWorkspacePackage", () => {
  it("reads a package name from package.json", () => {
    expect(readWorkspacePackage('{"name": "pdf-raster-cpu"}')).toEqual({
      name: "pdf-raster-cpu",
      private: false,
    });
  });

  it("reads private: true", () => {
    expect(readWorkspacePackage('{"name": "web", "private": true}')).toEqual({
      name: "web",
      private: true,
    });
  });

  it("throws when the name field is missing", () => {
    expect(() => readWorkspacePackage("{}")).toThrow(/name/);
  });

  it("throws when the name field is not a string", () => {
    expect(() => readWorkspacePackage('{"name": 1}')).toThrow(/name/);
  });
});

describe("readAcknowledgedNames", () => {
  it("reads a JSON array of package names into a set", () => {
    const names = readAcknowledgedNames('["pdf-raster-cpu", "byte-codec"]');
    expect(names.has("pdf-raster-cpu")).toBe(true);
    expect(names.has("byte-codec")).toBe(true);
    expect(names.has("ooxml.js")).toBe(false);
  });

  it("reads an empty array", () => {
    expect(readAcknowledgedNames("[]").size).toBe(0);
  });

  it("throws when the file is not an array", () => {
    expect(() => readAcknowledgedNames('{"pdf-raster-cpu": true}')).toThrow(
      /JSON array/,
    );
  });

  it("throws when an array entry is not a string", () => {
    expect(() => readAcknowledgedNames("[1, 2]")).toThrow(/JSON array/);
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
