import { isCompoundFile, readCompoundFile } from "archive-codec";
import { describe, expect, it } from "vitest";
import { compoundFile } from "./cfb";

function fill(length: number, seed = 1): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    out[index] = (seed + index) % 256;
  }
  return out;
}

function headerView(file: Uint8Array<ArrayBuffer>): DataView {
  return new DataView(file.buffer, file.byteOffset, file.byteLength);
}

// A directory entry's own 128-byte slot within the FIRST directory sector -- every test using this builds a fixture small enough that the record it wants sits in that one sector, exactly like directoryStart itself (read from the header rather than assumed) already does for the whole family of tests below.
function directoryEntryView(
  file: Uint8Array<ArrayBuffer>,
  id: number,
): DataView {
  const view = headerView(file);
  const sectorSize = 1 << view.getUint16(0x1e, true);
  const directoryStart = view.getUint32(0x30, true);
  const base = sectorSize + directoryStart * sectorSize + id * 128;
  return new DataView(file.buffer, file.byteOffset + base, 128);
}

// The directory entry's own name field: nameLength counts the terminating null, so the name itself is the first (nameLength - 2) / 2 UTF-16 code units -- mirroring archive-codec's own reader (src/cfb/read.ts) rather than re-deriving a different convention for the same bytes.
function directoryEntryName(entry: DataView): string {
  const nameLength = entry.getUint16(0x40, true);
  const codeUnits = Array.from(
    { length: (nameLength - 2) / 2 },
    (_ignored, index) => entry.getUint16(index * 2, true),
  );
  return String.fromCharCode(...codeUnits);
}

describe("compoundFile", () => {
  it("round-trips a single small stream at the root", () => {
    const data = fill(10, 5);
    const file = compoundFile([{ path: "Foo", bytes: data }]);
    expect(isCompoundFile(file)).toBe(true);
    const streams = readCompoundFile(file);
    expect(streams).toHaveLength(1);
    expect(streams[0]?.path).toBe("Foo");
    expect(Array.from(streams[0]?.bytes ?? [])).toEqual(Array.from(data));
  });

  it("round-trips several small streams at the root, each recovered by name and content", () => {
    const a = fill(3, 1);
    const b = fill(7, 50);
    const c = fill(1, 200);
    const file = compoundFile([
      { path: "A", bytes: a },
      { path: "B", bytes: b },
      { path: "C", bytes: c },
    ]);
    const streams = readCompoundFile(file);
    const byPath = new Map(
      streams.map((stream) => [stream.path, stream.bytes]),
    );
    expect(byPath.size).toBe(3);
    expect(Array.from(byPath.get("A") ?? [])).toEqual(Array.from(a));
    expect(Array.from(byPath.get("B") ?? [])).toEqual(Array.from(b));
    expect(Array.from(byPath.get("C") ?? [])).toEqual(Array.from(c));
  });

  it("round-trips enough streams to force more than one directory sector", () => {
    // entriesPerDirectorySector is 4 for 512-byte sectors (root plus 6 leaves is 7 records, past that bound).
    const entries = Array.from({ length: 6 }, (_, index) => ({
      path: `Entry${String(index)}`,
      bytes: fill(2, index + 1),
    }));
    const streams = readCompoundFile(compoundFile(entries));
    expect(streams).toHaveLength(6);
    const byPath = new Map(
      streams.map((stream) => [stream.path, stream.bytes]),
    );
    for (const entry of entries) {
      expect(Array.from(byPath.get(entry.path) ?? [])).toEqual(
        Array.from(entry.bytes),
      );
    }
  });

  it("round-trips nested storage paths, sharing one storage entry for streams under the same directory", () => {
    const a = fill(4, 9);
    const b = fill(4, 90);
    const c = fill(4, 190);
    const file = compoundFile([
      { path: "Dir/A", bytes: a },
      { path: "Dir/B", bytes: b },
      { path: "Other/C", bytes: c },
    ]);
    const streams = readCompoundFile(file);
    const byPath = new Map(
      streams.map((stream) => [stream.path, stream.bytes]),
    );
    expect(Array.from(byPath.get("Dir/A") ?? [])).toEqual(Array.from(a));
    expect(Array.from(byPath.get("Dir/B") ?? [])).toEqual(Array.from(b));
    expect(Array.from(byPath.get("Other/C") ?? [])).toEqual(Array.from(c));
  });

  it("round-trips a deeply nested path", () => {
    const data = fill(5, 3);
    const streams = readCompoundFile(
      compoundFile([{ path: "A/B/C/Leaf", bytes: data }]),
    );
    expect(streams).toHaveLength(1);
    expect(streams[0]?.path).toBe("A/B/C/Leaf");
    expect(Array.from(streams[0]?.bytes ?? [])).toEqual(Array.from(data));
  });

  it("round-trips a stream exactly one byte under the mini-stream cutoff (a mini-stream stream)", () => {
    const data = fill(4095, 3);
    const streams = readCompoundFile(
      compoundFile([{ path: "Small", bytes: data }]),
    );
    expect(streams).toHaveLength(1);
    expect(Array.from(streams[0]?.bytes ?? [])).toEqual(Array.from(data));
  });

  it("round-trips a stream exactly at the mini-stream cutoff (a FAT-sectored stream)", () => {
    const data = fill(4096, 4);
    const streams = readCompoundFile(
      compoundFile([{ path: "Boundary", bytes: data }]),
    );
    expect(streams).toHaveLength(1);
    expect(Array.from(streams[0]?.bytes ?? [])).toEqual(Array.from(data));
  });

  it("round-trips a stream one byte over the mini-stream cutoff", () => {
    const data = fill(4097, 5);
    const streams = readCompoundFile(
      compoundFile([{ path: "OverBoundary", bytes: data }]),
    );
    expect(Array.from(streams[0]?.bytes ?? [])).toEqual(Array.from(data));
  });

  it("round-trips several big (FAT-sectored) streams together", () => {
    const a = fill(5000, 11);
    const b = fill(9000, 22);
    const streams = readCompoundFile(
      compoundFile([
        { path: "Big1", bytes: a },
        { path: "Big2", bytes: b },
      ]),
    );
    const byPath = new Map(
      streams.map((stream) => [stream.path, stream.bytes]),
    );
    expect(Array.from(byPath.get("Big1") ?? [])).toEqual(Array.from(a));
    expect(Array.from(byPath.get("Big2") ?? [])).toEqual(Array.from(b));
  });

  it("round-trips a mix of small and big streams together", () => {
    const small = fill(20, 1);
    const big = fill(5000, 2);
    const streams = readCompoundFile(
      compoundFile([
        { path: "Small", bytes: small },
        { path: "Big", bytes: big },
      ]),
    );
    const byPath = new Map(
      streams.map((stream) => [stream.path, stream.bytes]),
    );
    expect(Array.from(byPath.get("Small") ?? [])).toEqual(Array.from(small));
    expect(Array.from(byPath.get("Big") ?? [])).toEqual(Array.from(big));
  });

  it("round-trips a stream large enough to need more than one FAT sector to map it", () => {
    const data = fill(200_000, 7);
    const streams = readCompoundFile(
      compoundFile([{ path: "Huge", bytes: data }]),
    );
    expect(streams).toHaveLength(1);
    expect(Array.from(streams[0]?.bytes ?? [])).toEqual(Array.from(data));
  });

  it("round-trips an empty compound file with no streams at all", () => {
    const streams = readCompoundFile(compoundFile([]));
    expect(streams).toEqual([]);
  });

  it("round-trips a version-4 (4096-byte sector) compound file identically to version 3", () => {
    const data = fill(9000, 42);
    const streams = readCompoundFile(
      compoundFile([{ path: "V4", bytes: data }], { majorVersion: 4 }),
    );
    expect(streams).toHaveLength(1);
    expect(Array.from(streams[0]?.bytes ?? [])).toEqual(Array.from(data));
  });

  it("produces different bytes between a version-3 and a version-4 file for the same input", () => {
    const data = fill(10, 1);
    const v3 = compoundFile([{ path: "X", bytes: data }]);
    const v4 = compoundFile([{ path: "X", bytes: data }], { majorVersion: 4 });
    expect(v3.length).not.toBe(v4.length);
  });

  it("rejects a stream/storage name longer than 31 ASCII characters", () => {
    const name = "a".repeat(32);
    expect(() => compoundFile([{ path: name, bytes: fill(1) }])).toThrow(
      /non-empty ASCII of at most 31 characters/,
    );
  });

  it("accepts a name of exactly 31 ASCII characters", () => {
    const name = "a".repeat(31);
    const streams = readCompoundFile(
      compoundFile([{ path: name, bytes: fill(1) }]),
    );
    expect(streams[0]?.path).toBe(name);
  });

  it("rejects a name containing a non-ASCII byte", () => {
    expect(() => compoundFile([{ path: "café", bytes: fill(1) }])).toThrow(
      /non-empty ASCII/,
    );
  });

  it("rejects an entry path with an empty segment", () => {
    expect(() => compoundFile([{ path: "Dir//Leaf", bytes: fill(1) }])).toThrow(
      /no empty segments/,
    );
  });

  it("rejects an entry path that is empty", () => {
    expect(() => compoundFile([{ path: "", bytes: fill(1) }])).toThrow(
      /no empty segments/,
    );
  });

  it("rejects the same entry path used twice", () => {
    expect(() =>
      compoundFile([
        { path: "Same", bytes: fill(1) },
        { path: "Same", bytes: fill(2) },
      ]),
    ).toThrow(/entry path used twice/);
  });

  it("writes a header whose fields this package's own reader relies on match the sector geometry", () => {
    const file = compoundFile([{ path: "X", bytes: fill(1) }]);
    const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
    expect(view.getUint16(0x1a, true)).toBe(3); // majorVersion
    expect(view.getUint16(0x1c, true)).toBe(0xfffe); // byte order
    expect(view.getUint16(0x1e, true)).toBe(9); // sector shift (512-byte sectors)
    expect(view.getUint16(0x20, true)).toBe(6); // mini sector shift (64-byte mini sectors)
    expect(view.getUint32(0x38, true)).toBe(4096); // mini stream cutoff
    expect(view.getUint32(0x44, true)).toBe(0xfffffffe); // first DIFAT sector: none (ENDOFCHAIN)
    // The magic signature bytes readCompoundFile's own isCompoundFile checks.
    expect(Array.from(file.subarray(0, 8))).toEqual([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
    ]);
  });

  it("writes a version-4 header with the version-4 sector shift", () => {
    const file = compoundFile([{ path: "X", bytes: fill(1) }], {
      majorVersion: 4,
    });
    const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
    expect(view.getUint16(0x1a, true)).toBe(4);
    expect(view.getUint16(0x1e, true)).toBe(12); // sector shift (4096-byte sectors)
  });

  it("accepts a name containing the ASCII DEL byte (0x7f), the exact non-ASCII boundary", () => {
    const name = `a${String.fromCharCode(0x7f)}b`;
    const streams = readCompoundFile(
      compoundFile([{ path: name, bytes: fill(1) }]),
    );
    expect(streams[0]?.path).toBe(name);
  });

  it("writes the root directory entry's own name as the exact spec-mandated 'Root Entry'", () => {
    const file = compoundFile([{ path: "X", bytes: fill(1) }]);
    expect(directoryEntryName(directoryEntryView(file, 0))).toBe("Root Entry");
  });

  it("reuses a single storage entry for a directory shared by multiple streams, rather than creating a duplicate", () => {
    const file = compoundFile([
      { path: "Dir/A", bytes: fill(1) },
      { path: "Dir/B", bytes: fill(1) },
    ]);
    // 4 directory records (root, Dir, A, B) fit the single 512-byte directory sector 4 records-per-sector allows, and both 1-byte streams pad to one 64-byte mini sector each: 1 FAT + 1 directory + 1 mini-stream + 1 mini-FAT sector, plus the header. A duplicated "Dir" storage would need a 5th record and a second directory sector, growing the file by one whole 512-byte sector.
    expect(file.length).toBe(5 * 512);
    expect(directoryEntryName(directoryEntryView(file, 1))).toBe("Dir");
  });

  it("keeps a stream and a like-named storage as separate directory entries, rather than descending into the stream as if it were the storage", () => {
    const file = compoundFile([
      { path: "A", bytes: fill(1) },
      { path: "A/B", bytes: fill(1) },
    ]);
    const streams = readCompoundFile(file);
    const byPath = new Map(
      streams.map((stream) => [stream.path, stream.bytes]),
    );
    expect(byPath.has("A")).toBe(true);
    expect(byPath.has("A/B")).toBe(true);
  });

  it("marks each FAT sector's own FAT entry as FATSECT, not left as an unused FREESECT", () => {
    const file = compoundFile([{ path: "X", bytes: fill(1) }]); // fatSectorCount is 1 for this tiny fixture.
    const view = headerView(file);
    const sectorSize = 1 << view.getUint16(0x1e, true);
    // Sector 0, the sole FAT sector here, begins right after the header.
    expect(view.getUint32(sectorSize, true)).toBe(0xfffffffd); // FATSECT
  });

  it("keeps a stream exactly at the mini-stream cutoff out of the mini stream entirely", () => {
    const file = compoundFile([{ path: "Boundary", bytes: fill(4096, 4) }]);
    // The root entry's own stream IS the mini stream: a FAT-sectored stream must never inflate it, so the root's declared size stays 0.
    expect(directoryEntryView(file, 0).getUint32(0x78, true)).toBe(0);
  });

  it("sizes the file from records.length divided by entries-per-sector, and mini-sector counts divided (never multiplied) by their own per-sector capacity", () => {
    // One small stream: 2 directory records (root + the stream) fit the single 512-byte directory sector; the 1-byte stream pads to one 64-byte mini sector, needing one mini-stream sector and one mini-FAT sector. 1 FAT + 1 directory + 1 mini-stream + 1 mini-FAT sector, plus the header.
    const file = compoundFile([{ path: "X", bytes: fill(1) }]);
    expect(file.length).toBe(5 * 512);
  });

  it("writes header fields this package's own reader never reads but a spec-conformant writer still must", () => {
    const file = compoundFile([{ path: "X", bytes: fill(1) }]);
    const view = headerView(file);
    expect(view.getUint16(0x18, true)).toBe(0x3e); // minor version
    expect(view.getUint32(0x28, true)).toBe(0); // version 3: this field is reserved at 0
    expect(view.getUint32(0x2c, true)).toBe(1); // FAT sector count
    expect(view.getUint32(0x40, true)).toBe(1); // mini-FAT sector count
    expect(view.getUint32(0x48, true)).toBe(0); // number of DIFAT sectors: none, the DIFAT fits the header array
  });

  it("writes the real directory-sector count at 0x28 for a version-4 file, never the version-3 reserved zero", () => {
    const entries = Array.from({ length: 35 }, (_ignored, index) => ({
      path: `E${String(index)}`,
      bytes: fill(1, index + 1),
    }));
    const file = compoundFile(entries, { majorVersion: 4 });
    // 36 records (root + 35 leaves) need 2 of the 32-entries-per-4096-byte-sector directory sectors.
    expect(headerView(file).getUint32(0x28, true)).toBe(2);
  });

  it("marks the header DIFAT entry immediately after the last real FAT sector as FREESECT, not a bogus sector reference", () => {
    const file = compoundFile([{ path: "X", bytes: fill(1) }]); // fatSectorCount is 1 for this tiny fixture.
    expect(headerView(file).getUint32(0x4c + 1 * 4, true)).toBe(0xffffffff);
  });

  it("round-trips a multi-mini-sector stream whose own chain crosses into a second mini-FAT sector", () => {
    // 128 one-mini-sector streams exactly fill the first (128-entry) mini-FAT sector with real chain data, then one 200-byte stream needs 4 more mini sectors (ceil(200/64)) of its own -- entries that only the second mini-FAT sector holds, and that (unlike a single-mini-sector stream's own always-ENDOFCHAIN entry) are genuinely position-dependent "next mini sector" pointers a corrupted second sector cannot reproduce by coincidence.
    const small = Array.from({ length: 128 }, (_ignored, index) => ({
      path: `S${String(index)}`,
      bytes: fill(1, index + 1),
    }));
    const large = { path: "Large", bytes: fill(200, 7) };
    const entries = [...small, large];
    const streams = readCompoundFile(compoundFile(entries));
    expect(streams).toHaveLength(129);
    const byPath = new Map(
      streams.map((stream) => [stream.path, stream.bytes]),
    );
    for (const entry of entries) {
      expect(Array.from(byPath.get(entry.path) ?? [])).toEqual(
        Array.from(entry.bytes),
      );
    }
  });

  it("builds byte-identical files for identical inputs", () => {
    const data = fill(10, 1);
    const first = compoundFile([{ path: "X", bytes: data }]);
    const second = compoundFile([{ path: "X", bytes: data }]);
    expect(Array.from(first)).toEqual(Array.from(second));
  });
});
