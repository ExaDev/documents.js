import { describe, expect, it } from "vitest";
import { EPUB_MIME_TYPE } from "./format";
import { unzipPackage, zipPackage } from "./zip";
import {
  assertMimetypeEntryLayout,
  localFileHeaderNames,
  readUint32LE,
} from "./test-support/zip";

function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

// The single test that proves the format-defining constraint this module exists to satisfy: EPUB 3.3 section 6.3 requires the "mimetype" part to be the very first zip entry, stored uncompressed with a zero-length extra field, containing exactly "application/epub+zip", so a reader can identify the container's media type from fixed byte offsets alone, without parsing the zip central directory first.
describe("zipPackage: mimetype entry byte layout", () => {
  it('places a stored "mimetype" entry at the exact offsets EPUB pins', () => {
    const bytes = zipPackage([
      ["mimetype", { bytes: enc(EPUB_MIME_TYPE), stored: true }],
      ["META-INF/container.xml", { bytes: enc("<container/>") }],
    ]);
    assertMimetypeEntryLayout(bytes, EPUB_MIME_TYPE);
  });
});

describe("zipPackage / unzipPackage round trip", () => {
  it("recovers byte-identical content for every entry", () => {
    const entries: [
      string,
      { bytes: Uint8Array<ArrayBuffer>; stored?: boolean },
    ][] = [
      ["mimetype", { bytes: enc(EPUB_MIME_TYPE), stored: true }],
      ["META-INF/container.xml", { bytes: enc("<container/>") }],
      ["OEBPS/content.opf", { bytes: enc("<package/>") }],
    ];
    const zipped = zipPackage(entries);
    const unzipped = unzipPackage(zipped);
    for (const [path, entry] of entries) {
      expect(unzipped[path]).toEqual(entry.bytes);
    }
    expect(Object.keys(unzipped).sort()).toEqual(
      entries.map(([path]) => path).sort(),
    );
  });

  it("preserves caller-supplied emission order regardless of path name", () => {
    const bytes = zipPackage([
      ["z-part.xhtml", { bytes: enc("<z/>") }],
      ["a-part.xhtml", { bytes: enc("<a/>") }],
      ["mimetype", { bytes: enc("text/plain"), stored: true }],
    ]);
    expect(localFileHeaderNames(bytes)).toEqual([
      "z-part.xhtml",
      "a-part.xhtml",
      "mimetype",
    ]);
  });

  it('stores a "stored" entry uncompressed, with a compressed size equal to its input length', () => {
    const original = enc(EPUB_MIME_TYPE);
    const bytes = zipPackage([["mimetype", { bytes: original, stored: true }]]);
    expect(readUint32LE(bytes, 18)).toBe(original.length);
  });

  it("deflates a non-stored entry of repetitive content to fewer bytes than the input", () => {
    const original = enc("a".repeat(1000));
    const bytes = zipPackage([["content.opf", { bytes: original }]]);
    expect(readUint32LE(bytes, 18)).toBeLessThan(original.length);
  });
});

// fflate's default entry mtime is the wall clock, whose 2-second DOS granularity would make identical input zip to different bytes across a boundary tick. The timestamp is pinned instead, so these two serialisations five seconds apart must agree byte for byte.
describe("zipPackage: deterministic bytes regardless of wall-clock time", () => {
  it("zips the same entries to identical bytes across a time boundary", async () => {
    const { vi } = await import("vitest");
    const entries: [
      string,
      { bytes: Uint8Array<ArrayBuffer>; stored?: boolean },
    ][] = [
      ["mimetype", { bytes: enc(EPUB_MIME_TYPE), stored: true }],
      ["META-INF/container.xml", { bytes: enc("<container/>") }],
    ];
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:01Z"));
      const beforeBoundary = zipPackage(entries);
      vi.setSystemTime(new Date("2026-01-01T00:00:06Z"));
      const afterBoundary = zipPackage(entries);
      expect(afterBoundary).toEqual(beforeBoundary);
    } finally {
      vi.useRealTimers();
    }
  });
});
