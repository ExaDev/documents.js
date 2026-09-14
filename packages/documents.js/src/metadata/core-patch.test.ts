import { describe, expect, it } from "vitest";
import { hasWritableMetadataOverride, mergeMetadata } from "./core-patch";

describe("hasWritableMetadataOverride", () => {
  it("is false for an empty overrides object", () => {
    expect(hasWritableMetadataOverride({})).toBe(false);
  });

  it("is true when only title is supplied", () => {
    expect(hasWritableMetadataOverride({ title: "T" })).toBe(true);
  });

  it("is true when only author is supplied", () => {
    expect(hasWritableMetadataOverride({ author: "A" })).toBe(true);
  });

  it("is true when only subject is supplied", () => {
    expect(hasWritableMetadataOverride({ subject: "S" })).toBe(true);
  });

  it("is true when keywords is a non-empty array", () => {
    expect(hasWritableMetadataOverride({ keywords: ["a"] })).toBe(true);
  });

  it("is false when keywords is present but empty, since nothing would actually be written", () => {
    expect(hasWritableMetadataOverride({ keywords: [] })).toBe(false);
  });
});

describe("mergeMetadata", () => {
  it("keeps fields the overrides object did not mention", () => {
    expect(
      mergeMetadata({ title: "Original", author: "Ada" }, { title: "New" }),
    ).toEqual({ title: "New", author: "Ada" });
  });

  it("keeps the current subject when overrides does not mention it", () => {
    expect(
      mergeMetadata({ subject: "Original subject" }, { title: "New" }),
    ).toEqual({ subject: "Original subject", title: "New" });
  });

  it("keeps the current keywords when overrides does not mention them", () => {
    expect(mergeMetadata({ keywords: ["a", "b"] }, { title: "New" })).toEqual({
      keywords: ["a", "b"],
      title: "New",
    });
  });
});
