import { describe, expect, it } from "vitest";
import { unzipPackage, zipPackage } from "./zip";
import {
  assertMimetypeEntryLayout,
  localFileHeaderNames,
  readUint32LE,
} from "./test-support/zip";

function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

// The single test that proves the format-defining constraint this package exists to satisfy: ODF (OASIS Open Document Format Part 3, "Packages", the mimetype file requirement) requires the "mimetype" part to be the very first zip entry, stored uncompressed with a zero-length extra field, so a reader can identify the container's media type from fixed byte offsets alone, without parsing the zip central directory first.
describe("zipPackage: mimetype entry byte layout", () => {
  it('places a stored "mimetype" entry at the exact offsets ODF pins', () => {
    const mediaType = "application/vnd.oasis.opendocument.text";
    const bytes = zipPackage([
      ["mimetype", { bytes: enc(mediaType), stored: true }],
      ["content.xml", { bytes: enc("<office:document-content/>") }],
    ]);
    assertMimetypeEntryLayout(bytes, mediaType);
  });

  it("holds regardless of the media type string length", () => {
    const mediaType = "application/vnd.oasis.opendocument.spreadsheet";
    const bytes = zipPackage([
      ["mimetype", { bytes: enc(mediaType), stored: true }],
    ]);
    assertMimetypeEntryLayout(bytes, mediaType);
  });
});

describe("zipPackage / unzipPackage round trip", () => {
  it("recovers byte-identical content for every entry", () => {
    const entries: [
      string,
      { bytes: Uint8Array<ArrayBuffer>; stored?: boolean },
    ][] = [
      [
        "mimetype",
        {
          bytes: enc("application/vnd.oasis.opendocument.presentation"),
          stored: true,
        },
      ],
      ["META-INF/manifest.xml", { bytes: enc("<manifest:manifest/>") }],
      ["content.xml", { bytes: enc("<office:document-content/>") }],
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
      ["z-part.xml", { bytes: enc("<z/>") }],
      ["a-part.xml", { bytes: enc("<a/>") }],
      ["mimetype", { bytes: enc("text/plain"), stored: true }],
    ]);
    expect(localFileHeaderNames(bytes)).toEqual([
      "z-part.xml",
      "a-part.xml",
      "mimetype",
    ]);
  });

  it('stores a "stored" entry uncompressed, with a compressed size equal to its input length', () => {
    const original = enc(
      "plain text with no compressible repetition at all, 12345",
    );
    const bytes = zipPackage([["mimetype", { bytes: original, stored: true }]]);
    expect(readUint32LE(bytes, 18)).toBe(original.length);
  });

  it("deflates a non-stored entry of repetitive content to fewer bytes than the input", () => {
    const original = enc("a".repeat(1000));
    const bytes = zipPackage([["content.xml", { bytes: original }]]);
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
      [
        "mimetype",
        { bytes: enc("application/vnd.oasis.opendocument.text"), stored: true },
      ],
      ["content.xml", { bytes: enc("<office:document-content/>") }],
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
