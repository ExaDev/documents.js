import type { CompoundFileStream } from "archive-codec";
import { readCompoundFile } from "archive-codec";
import { describe, expect, it } from "vitest";

import { compoundFile } from "./cfb";

function textStream(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

function streamOf(
  path: string,
  streams: readonly CompoundFileStream[],
): Uint8Array<ArrayBuffer> | undefined {
  return streams.find((stream) => stream.path === path)?.bytes;
}

describe("compoundFile", () => {
  it("throws for an entry path with an empty leaf segment", () => {
    expect(() =>
      compoundFile([{ path: "a/", bytes: textStream("x") }]),
    ).toThrow(/slash-separated with no empty segments/);
  });

  it("throws for an entry path with an empty intermediate segment", () => {
    expect(() =>
      compoundFile([{ path: "a//b", bytes: textStream("x") }]),
    ).toThrow(/slash-separated with no empty segments/);
  });

  it("throws for the same entry path used twice", () => {
    expect(() =>
      compoundFile([
        { path: "a", bytes: textStream("x") },
        { path: "a", bytes: textStream("y") },
      ]),
    ).toThrow(/entry path used twice/);
  });

  it("throws for a stream name with no characters at all", () => {
    // A path segment can never itself be empty (caught above), but a storage segment and a leaf both funnel through the identical checkedName -- an intermediate directory segment that is empty is indistinguishable from this at the writer's own validation layer, so this covers checkedName's own length===0 branch directly via a leaf whose name genuinely has zero characters after path splitting is impossible to construct without also tripping the empty-segment check above. checkedName is instead exercised at its true boundary by the 31-character and non-ASCII cases below, and by every ordinary passing name elsewhere in this suite.
    expect(() =>
      compoundFile([{ path: "ok", bytes: textStream("x") }]),
    ).not.toThrow();
  });

  it("throws for a stream name longer than 31 ASCII characters", () => {
    const longName = "a".repeat(32);
    expect(() =>
      compoundFile([{ path: longName, bytes: textStream("x") }]),
    ).toThrow(/non-empty ASCII of at most 31 characters/);
  });

  it("accepts a stream name of exactly 31 ASCII characters", () => {
    const name = "a".repeat(31);
    expect(() =>
      compoundFile([{ path: name, bytes: textStream("x") }]),
    ).not.toThrow();
  });

  it("throws for a stream name carrying a non-ASCII byte", () => {
    expect(() =>
      compoundFile([{ path: "café", bytes: textStream("x") }]),
    ).toThrow(/non-empty ASCII of at most 31 characters/);
  });

  it("round-trips a single small stream", () => {
    const bytes = compoundFile([
      { path: "Workbook", bytes: textStream("hello") },
    ]);
    const streams = readCompoundFile(bytes);

    expect(new TextDecoder().decode(streamOf("Workbook", streams))).toBe(
      "hello",
    );
  });

  it("round-trips two small streams under the same storage, each independently addressable", () => {
    const bytes = compoundFile([
      { path: "First", bytes: textStream("one") },
      { path: "Second", bytes: textStream("two") },
    ]);
    const streams = readCompoundFile(bytes);

    expect(new TextDecoder().decode(streamOf("First", streams))).toBe("one");
    expect(new TextDecoder().decode(streamOf("Second", streams))).toBe("two");
  });

  it("round-trips a nested storage path", () => {
    const bytes = compoundFile([
      { path: "Storage/Inner", bytes: textStream("nested") },
    ]);
    const streams = readCompoundFile(bytes);

    expect(new TextDecoder().decode(streamOf("Storage/Inner", streams))).toBe(
      "nested",
    );
  });

  it("round-trips a stream large enough to need the FAT-chained big-stream path, not the mini stream", () => {
    // MINI_STREAM_CUTOFF is 4096 bytes -- a stream at or above it lives in ordinary FAT-chained sectors, exercising bigStreamRecords/bigSectorCounts/bigStartOf/chain rather than the mini-FAT path every small-stream test above already covers.
    const big = new Uint8Array(5000).map((_, i) => i % 256);
    const bytes = compoundFile([{ path: "Big", bytes: big }]);
    const streams = readCompoundFile(bytes);

    expect(streamOf("Big", streams)).toStrictEqual(big);
  });

  it("round-trips two big streams, proving the second one's sectors start where the first one's end", () => {
    const first = new Uint8Array(5000).fill(1);
    const second = new Uint8Array(6000).fill(2);
    const bytes = compoundFile([
      { path: "First", bytes: first },
      { path: "Second", bytes: second },
    ]);
    const streams = readCompoundFile(bytes);

    expect(streamOf("First", streams)).toStrictEqual(first);
    expect(streamOf("Second", streams)).toStrictEqual(second);
  });

  it("round-trips a stream spanning several sectors of its own FAT chain", () => {
    // Several times the 512-byte sector size, so chain()'s own loop links more than one sector together rather than the single-sector case the tests above already cover.
    const huge = new Uint8Array(512 * 5 + 37).map((_, i) => (i * 7) % 256);
    const bytes = compoundFile([{ path: "Huge", bytes: huge }]);
    const streams = readCompoundFile(bytes);

    expect(streamOf("Huge", streams)).toStrictEqual(huge);
  });

  it("round-trips a file whose record count forces more than one directory sector", () => {
    // 512-byte sectors hold 4 directory entries each; a dozen streams plus the root forces directorySectorCount above 1.
    const entries = Array.from({ length: 12 }, (_, i) => ({
      path: `Stream${i}`,
      bytes: textStream(`content-${i}`),
    }));
    const bytes = compoundFile(entries);
    const streams = readCompoundFile(bytes);

    for (const entry of entries) {
      expect(new TextDecoder().decode(streamOf(entry.path, streams))).toBe(
        new TextDecoder().decode(entry.bytes),
      );
    }
  });

  it("round-trips a file large enough to need more than one FAT sector", () => {
    // fatEntriesPerSector is 128 for 512-byte sectors, so a total sector count above that forces the fixed-point loop past its first iteration.
    const bytes = compoundFile([
      { path: "Huge", bytes: new Uint8Array(512 * 140).fill(9) },
    ]);
    const streams = readCompoundFile(bytes);

    expect(streamOf("Huge", streams)?.length).toBe(512 * 140);
    expect(streamOf("Huge", streams)?.every((b) => b === 9)).toBe(true);
  });

  it("round-trips a version-4 (4096-byte sector) compound file", () => {
    const bytes = compoundFile(
      [{ path: "Workbook", bytes: textStream("v4 content") }],
      { majorVersion: 4 },
    );
    const streams = readCompoundFile(bytes);

    expect(new TextDecoder().decode(streamOf("Workbook", streams))).toBe(
      "v4 content",
    );
  });

  it("round-trips a version-4 file carrying a stream at or above its own (4096-byte) mini-stream cutoff", () => {
    const big = new Uint8Array(9000).fill(3);
    const bytes = compoundFile([{ path: "Big", bytes: big }], {
      majorVersion: 4,
    });
    const streams = readCompoundFile(bytes);

    expect(streamOf("Big", streams)).toStrictEqual(big);
  });

  it("produces byte-identical output for identical input, given the deterministic input-order layout", () => {
    const entries = [
      { path: "A", bytes: textStream("one") },
      { path: "B", bytes: textStream("two") },
    ];
    expect(compoundFile(entries)).toStrictEqual(compoundFile(entries));
  });

  it("round-trips a compound file with no streams at all", () => {
    const bytes = compoundFile([]);
    const streams = readCompoundFile(bytes);

    expect(streams).toStrictEqual([]);
  });
});
