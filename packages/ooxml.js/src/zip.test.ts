import { describe, expect, it, vi } from "vitest";
import { unzipPackage, zipPackage } from "./zip";

function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

describe("zipPackage / unzipPackage round trip", () => {
  it("recovers byte-identical content for every entry", () => {
    const parts: Record<string, Uint8Array<ArrayBuffer>> = {
      "[Content_Types].xml": enc("<Types/>"),
      "word/document.xml": enc("<w:document/>"),
    };
    const unzipped = unzipPackage(zipPackage(parts));
    for (const [path, bytes] of Object.entries(parts)) {
      expect(unzipped[path]).toEqual(bytes);
    }
  });
});

// fflate's default entry mtime is the wall clock, whose 2-second DOS granularity would make identical input zip to different bytes across a boundary tick -- the exact shape that split a shared embedded-object payload into duplicate parts when two serialisations straddled a boundary in one build. The timestamp is pinned instead, so these two serialisations five seconds apart must agree byte for byte.
describe("zipPackage: deterministic bytes regardless of wall-clock time", () => {
  it("zips the same parts to identical bytes across a time boundary", () => {
    const parts: Record<string, Uint8Array<ArrayBuffer>> = {
      "[Content_Types].xml": enc("<Types/>"),
      "word/document.xml": enc("<w:document/>"),
    };
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:01Z"));
      const beforeBoundary = zipPackage(parts);
      vi.setSystemTime(new Date("2026-01-01T00:00:06Z"));
      const afterBoundary = zipPackage(parts);
      expect(afterBoundary).toEqual(beforeBoundary);
    } finally {
      vi.useRealTimers();
    }
  });
});
