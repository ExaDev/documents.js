import { describe, expect, it } from "vitest";
import {
  ArchiveWalkLimitError,
  detectArchiveFormat,
  isZipArchive,
  unzipPackage,
  zipPackage,
  walkArchive,
} from "./index";

describe("archive-codec barrel smoke", () => {
  it("exposes the container, detection, and walking surfaces", () => {
    const enc = new TextEncoder();
    const nested = zipPackage([["inner.txt", { bytes: enc.encode("inner") }]]);
    const outer = zipPackage([
      ["outer.txt", { bytes: enc.encode("outer") }],
      ["embedded.zip", { bytes: nested }],
    ]);
    expect(isZipArchive(outer)).toBe(true);
    expect(detectArchiveFormat(enc.encode("nope"))).toBe("unknown");
    const entries = walkArchive(outer, { maxDepth: 2, maxTotalBytes: 1024 });
    expect(entries.map((e) => e.path).sort()).toEqual([
      "embedded.zip",
      "inner.txt",
      "outer.txt",
    ]);
    expect(unzipPackage(nested)["inner.txt"]).toEqual(enc.encode("inner"));
  });

  it("surfaces ArchiveWalkLimitError for out-of-contract input", () => {
    const bytes = zipPackage([["a.bin", { bytes: new Uint8Array(64) }]]);
    expect(() => walkArchive(bytes, { maxTotalBytes: 8 })).toThrow(
      ArchiveWalkLimitError,
    );
  });
});
