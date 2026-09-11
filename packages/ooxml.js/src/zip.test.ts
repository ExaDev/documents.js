import { describe, expect, it, vi } from "vitest";
import { FIXED_ENTRY_MTIME, unzipPackage, zipPackage } from "./zip";

function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

// fflate's DOS-date encoding reads the pinned mtime through Date's *local* calendar getters, not UTC -- a value sitting exactly on fflate's own 1980 floor previously rolled back into 1979 under any reading process whose local zone has a negative UTC offset at that instant, and fflate throws for a year outside 1980-2099. Checked here against the two POSIX-sign-inverted Etc/GMT zones bracketing every real IANA offset, present or historical (Etc/GMT+12 = UTC-12, the most negative offset any zone has used; Etc/GMT-14 = UTC+14, the most positive) via Intl.DateTimeFormat's own explicit-zone resolution rather than by mutating process.env.TZ, which a worker_threads pool -- exactly the pool Stryker's own vitest-runner forces -- does not reliably propagate to Date's local getters at all, so a mutation-based version of this test would silently stop exercising the offset it names under mutation testing.
describe("zipPackage: entry mtime survives every real-world timezone offset", () => {
  it.each([
    ["Etc/GMT+12", "the most negative real-world UTC offset"],
    ["Etc/GMT-14", "the most positive real-world UTC offset"],
  ])("stays within fflate's 1980-2099 DOS-date range under %s (%s)", (zone) => {
    const year = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric" })
        .formatToParts(FIXED_ENTRY_MTIME)
        .find((part) => part.type === "year")?.value,
    );
    expect(year).toBeGreaterThanOrEqual(1980);
    expect(year).toBeLessThanOrEqual(2099);
  });
});

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
