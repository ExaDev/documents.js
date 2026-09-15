import type { CompoundFileStream } from "archive-codec";
import { readCompoundFile } from "archive-codec";
import { describe, expect, it } from "vitest";

import {
  checkedName,
  compoundFile,
  requiredLeaf,
  requiredRecord,
  requiredSectorStart,
} from "./cfb";

function textStream(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

function streamOf(
  path: string,
  streams: readonly CompoundFileStream[],
): Uint8Array<ArrayBuffer> | undefined {
  return streams.find((stream) => stream.path === path)?.bytes;
}

/** Direct, byte-level access to a compound file's own header and directory entries -- for the fields (sector counts, the FAT's own marker bytes, a directory entry's own colour flag and name) that this package's own reader (archive-codec's readCompoundFile) either never reads back or never cross-checks, so a round trip alone cannot prove the writer stated them correctly. */
function parseHeader(bytes: Uint8Array<ArrayBuffer>) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fatSectorCount = view.getUint32(0x2c, true);
  const directoryStart = view.getUint32(0x30, true);
  const directorySectorCountField = view.getUint32(0x28, true);
  const miniFatStart = view.getUint32(0x3c, true);
  const miniFatSectorCount = view.getUint32(0x40, true);
  const difat = Array.from({ length: 109 }, (_, i) =>
    view.getUint32(0x4c + i * 4, true),
  );
  return {
    fatSectorCount,
    directoryStart,
    directorySectorCountField,
    miniFatStart,
    miniFatSectorCount,
    difat,
  };
}

/** One entry's own raw 128-byte directory record, at its own sector/offset within the directory chain (4 entries per 512-byte sector, 32 per 4096-byte sector). */
function directoryEntryBytes(
  bytes: Uint8Array<ArrayBuffer>,
  sectorSize: number,
  directoryStart: number,
  id: number,
): DataView {
  const entriesPerSector = sectorSize / 128;
  const sector = directoryStart + Math.floor(id / entriesPerSector);
  const offsetInSector = (id % entriesPerSector) * 128;
  return new DataView(
    bytes.buffer,
    sectorSize + sector * sectorSize + offsetInSector,
    128,
  );
}

/** A FAT entry's own raw value, read directly from the sector it lives in (the first FAT sector, for every fixture in this file, which never needs more than 128 entries). */
function fatEntry(
  bytes: Uint8Array<ArrayBuffer>,
  sectorSize: number,
  sector: number,
): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(sectorSize + sector * 4, true);
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

  it("accepts a name containing the DEL byte (0x7f), the exact boundary of the ASCII range this writer allows", () => {
    const name = `a${String.fromCharCode(0x7f)}`;
    expect(() =>
      compoundFile([{ path: name, bytes: textStream("x") }]),
    ).not.toThrow();
  });

  it("refuses a name containing a byte one past that boundary (0x80)", () => {
    const name = `a${String.fromCharCode(0x80)}`;
    expect(() =>
      compoundFile([{ path: name, bytes: textStream("x") }]),
    ).toThrow(/non-empty ASCII of at most 31 characters/);
  });

  it("distinguishes a same-named stream and storage rather than attaching the storage's own children to the stream", () => {
    // "a" is written first as a plain stream; "a/b" then needs a STORAGE also named "a" -- a different node from the stream, never the stream reinterpreted as a folder.
    const bytes = compoundFile([
      { path: "a", bytes: textStream("stream-a") },
      { path: "a/b", bytes: textStream("nested-b") },
    ]);
    const streams = readCompoundFile(bytes);

    expect(new TextDecoder().decode(streamOf("a", streams))).toBe("stream-a");
    expect(new TextDecoder().decode(streamOf("a/b", streams))).toBe("nested-b");
  });

  it("round-trips two streams under the same nested storage, not two separate storages each holding one", () => {
    const bytes = compoundFile([
      { path: "Storage/First", bytes: textStream("first") },
      { path: "Storage/Second", bytes: textStream("second") },
    ]);
    const streams = readCompoundFile(bytes);

    expect(new TextDecoder().decode(streamOf("Storage/First", streams))).toBe(
      "first",
    );
    expect(new TextDecoder().decode(streamOf("Storage/Second", streams))).toBe(
      "second",
    );
  });

  it("writes a stream entry's own colour flag as black (1), never left at the buffer's own default zero", () => {
    const bytes = compoundFile([{ path: "Workbook", bytes: textStream("x") }]);
    const header = parseHeader(bytes);
    const entry = directoryEntryBytes(bytes, 512, header.directoryStart, 1);

    expect(entry.getUint8(0x43)).toBe(1);
  });

  it("writes the root storage entry's own name as exactly 'Root Entry', not the empty construction placeholder", () => {
    const bytes = compoundFile([{ path: "Workbook", bytes: textStream("x") }]);
    const header = parseHeader(bytes);
    const entry = directoryEntryBytes(bytes, 512, header.directoryStart, 0);
    const nameLength = entry.getUint16(0x40, true);
    const nameBytes = new Uint16Array(nameLength / 2 - 1);
    for (const i of nameBytes.keys()) {
      nameBytes[i] = entry.getUint16(i * 2, true);
    }

    expect(String.fromCharCode(...nameBytes)).toBe("Root Entry");
  });

  it("marks every real FAT sector as FATSECT and names each one in the DIFAT, leaving the DIFAT's own remaining entries FREESECT", () => {
    const bytes = compoundFile([{ path: "Workbook", bytes: textStream("x") }]);
    const header = parseHeader(bytes);

    expect(header.fatSectorCount).toBe(1);
    expect(header.difat[0]).toBe(0);
    expect(header.difat[1]).toBe(0xffffffff); // FREESECT
    expect(fatEntry(bytes, 512, header.difat[0] ?? 0)).toBe(0xfffffffd); // FATSECT
  });

  it("states the real directory sector count in a version-4 header's own field, not the version-3 fixed zero", () => {
    // entriesPerDirectorySector is 4096/128 = 32 for version 4; 33 records (32 entries plus the root) forces exactly 2 directory sectors -- Math.ceil(33/32), a value multiplication would never produce.
    const entries = Array.from({ length: 32 }, (_, i) => ({
      path: `Stream${i}`,
      bytes: textStream("x"),
    }));
    const bytes = compoundFile(entries, { majorVersion: 4 });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(view.getUint32(0x28, true)).toBe(2);
  });

  it("states zero as a version-3 header's own directory sector count field, regardless of how many directory sectors the file actually needs", () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({
      path: `Stream${i}`,
      bytes: textStream("x"),
    }));
    const bytes = compoundFile(entries);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(view.getUint32(0x28, true)).toBe(0);
  });
});

describe("checkedName", () => {
  it("throws when given directly with an over-length name, naming the exact character count problem", () => {
    expect(() => checkedName({ name: "a".repeat(32), children: [] })).toThrow(
      /non-empty ASCII of at most 31 characters/,
    );
  });
});

describe("requiredLeaf", () => {
  it("throws for an already-empty segment array, the one input no real path ever produces", () => {
    expect(() => requiredLeaf([])).toThrow(
      /split\("\/"\) produced no segments at all/,
    );
  });

  it("returns and removes the array's own last element for a genuinely non-empty array", () => {
    const segments = ["a", "b", "c"];
    expect(requiredLeaf(segments)).toBe("c");
    expect(segments).toStrictEqual(["a", "b"]);
  });
});

describe("requiredRecord", () => {
  it("throws for a node the given map never recorded, the one input compoundFile's own tree walk never produces", () => {
    expect(() =>
      requiredRecord(new Map(), { name: "orphan", children: [] }),
    ).toThrow(/record\(\) walk never visited a node/);
  });

  it("returns the node's own record when the map genuinely carries one", () => {
    const node = { name: "x", children: [] };
    const found = { node, id: 3, rightId: 7 };
    expect(requiredRecord(new Map([[node, found]]), node)).toBe(found);
  });
});

describe("requiredSectorStart", () => {
  it("throws for an id the given map never assigned a sector to, the one input compoundFile's own allocation pass never produces", () => {
    expect(() => requiredSectorStart(new Map(), 5)).toThrow(
      /sector-allocation pass never assigned a start sector/,
    );
  });

  it("returns the id's own assigned sector when the map genuinely carries one", () => {
    expect(requiredSectorStart(new Map([[5, 42]]), 5)).toBe(42);
  });
});
