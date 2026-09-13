import { readCompoundFile } from "archive-codec";
import { describe, expect, it } from "vitest";
import { compoundFile } from "./compound-file";

// [MS-CFB] constants this file's own assertions are built against, restated independently of compound-file.ts's own copies for the same reason every other test-support fixture in this package restates its own spec constants rather than importing the implementation's.
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const FATSECT = 0xfffffffd;
const NOSTREAM = 0xffffffff;
const SECTOR_SIZE = 512;
const HEADER_SIZE = 512;
const FAT_ENTRIES_PER_SECTOR = SECTOR_SIZE / 4;

function bytesOf(length: number, fill: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(length).fill(fill);
}

function sectorOffset(sector: number): number {
  return HEADER_SIZE + sector * SECTOR_SIZE;
}

describe("compoundFile", () => {
  it("rejects a stream shorter than the mini stream cutoff", () => {
    expect(() =>
      compoundFile([{ name: "short", bytes: bytesOf(63, 0xaa) }]),
    ).toThrow(
      'compoundFile writes every stream through the FAT, so each must be at least 64 bytes (got 63 for "short")',
    );
  });

  it("accepts a stream exactly at the mini stream cutoff", () => {
    expect(() =>
      compoundFile([{ name: "exact", bytes: bytesOf(64, 0xaa) }]),
    ).not.toThrow();
  });

  it("rejects the second of two streams even when the first is long enough", () => {
    // Proves the length guard checks every stream in the loop, not merely the first.
    expect(() =>
      compoundFile([
        { name: "long-enough", bytes: bytesOf(64, 0xaa) },
        { name: "too-short", bytes: bytesOf(10, 0xbb) },
      ]),
    ).toThrow(
      'compoundFile writes every stream through the FAT, so each must be at least 64 bytes (got 10 for "too-short")',
    );
  });

  it("round-trips every stream's own bytes and name through archive-codec's own reader", () => {
    const streamA = bytesOf(512, 0x11);
    const streamB = bytesOf(600, 0x22);
    const file = compoundFile([
      { name: "First", bytes: streamA },
      { name: "Second", bytes: streamB },
    ]);
    const streams = readCompoundFile(file);
    expect(streams).toHaveLength(2);
    expect(streams[0]).toEqual({ path: "First", bytes: streamA });
    expect(streams[1]).toEqual({ path: "Second", bytes: streamB });
  });

  it("states every header field's own exact byte value, not just a value archive-codec's reader happens to tolerate", () => {
    // Two streams (512 and 600 bytes: one exactly one sector, one spanning two) chosen so every derived quantity below -- sector counts, chain links, directory sibling ids -- takes a distinct, hand-checkable value rather than a coincidentally-symmetric one.
    const streamA = bytesOf(512, 0x11);
    const streamB = bytesOf(600, 0x22);
    const file = compoundFile([
      { name: "First", bytes: streamA },
      { name: "Second", bytes: streamB },
    ]);
    const view = new DataView(file.buffer, file.byteOffset, file.byteLength);

    // Signature, checked only to anchor the offsets below against a real compound file rather than an arbitrary buffer.
    expect(Array.from(file.subarray(0, 8))).toEqual([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
    ]);
    expect(view.getUint16(0x18, true)).toBe(0x003e); // minorVersion
    expect(view.getUint16(0x1a, true)).toBe(3); // majorVersion
    expect(view.getUint16(0x1c, true)).toBe(0xfffe); // byte order mark
    expect(view.getUint16(0x1e, true)).toBe(9); // sectorShift (512-byte sectors)
    expect(view.getUint16(0x20, true)).toBe(6); // miniSectorShift
    // directorySectors = ceil(3 entries / 4 per sector) = 1; streamSectors = [1, 2]; nonFatSectors = 1 + 1 + 2 = 4; fatSectors stays 1 since 1*128 = 128 is not < 4 + 1 = 5.
    expect(view.getUint32(0x2c, true)).toBe(1); // fatSectors count
    expect(view.getUint32(0x30, true)).toBe(1); // firstDirectorySector = fatSectors
    expect(view.getUint32(0x38, true)).toBe(64); // miniStreamCutoff
    expect(view.getUint32(0x3c, true)).toBe(ENDOFCHAIN); // firstMiniFatSector -- no mini stream at all
    expect(view.getUint32(0x40, true)).toBe(0); // miniFatSectorCount
    expect(view.getUint32(0x44, true)).toBe(ENDOFCHAIN); // firstDifatSector -- every FAT sector fits the header's own 109-entry array
    expect(view.getUint32(0x48, true)).toBe(0); // difatSectorCount

    // The header DIFAT array: sector 0 (the file's one FAT sector) at entry 0, FREESECT padding after it.
    expect(view.getUint32(0x4c, true)).toBe(0);
    expect(view.getUint32(0x4c + 4, true)).toBe(FREESECT);
    expect(view.getUint32(0x4c + 108 * 4, true)).toBe(FREESECT);

    // The FAT table itself, at sector 0: index 0 is the FAT sector marking itself; 1 is the one-sector directory (ends immediately); 2 is streamA's own one sector (ends immediately); 3-4 is streamB's own two-sector chain; 5 onward is unused.
    const fatAt = (index: number): number =>
      view.getUint32(sectorOffset(0) + index * 4, true);
    expect(fatAt(0)).toBe(FATSECT);
    expect(fatAt(1)).toBe(ENDOFCHAIN);
    expect(fatAt(2)).toBe(ENDOFCHAIN);
    expect(fatAt(3)).toBe(4);
    expect(fatAt(4)).toBe(ENDOFCHAIN);
    expect(fatAt(5)).toBe(FREESECT);
    expect(fatAt(FAT_ENTRIES_PER_SECTOR - 1)).toBe(FREESECT);

    // The directory, at sector 1 (firstDirectorySector): Root Entry (id 0), First (id 1), Second (id 2).
    const directoryAt = (id: number): number => sectorOffset(1) + id * 128;
    const nameOf = (id: number, length: number): string => {
      let name = "";
      for (let i = 0; i < length; i++) {
        name += String.fromCharCode(
          view.getUint16(directoryAt(id) + i * 2, true),
        );
      }
      return name;
    };
    // Root Entry.
    expect(nameOf(0, "Root Entry".length)).toBe("Root Entry");
    expect(view.getUint16(directoryAt(0) + 0x40, true)).toBe(
      ("Root Entry".length + 1) * 2,
    );
    expect(view.getUint8(directoryAt(0) + 0x42)).toBe(5); // OBJECT_TYPE_ROOT
    expect(view.getUint8(directoryAt(0) + 0x43)).toBe(1); // colour flag
    expect(view.getUint32(directoryAt(0) + 0x44, true)).toBe(NOSTREAM); // left sibling
    expect(view.getUint32(directoryAt(0) + 0x48, true)).toBe(NOSTREAM); // right sibling
    expect(view.getUint32(directoryAt(0) + 0x4c, true)).toBe(1); // child -- the first stream
    expect(view.getUint32(directoryAt(0) + 0x7c, true)).toBe(0); // size high dword

    // First (id 1): right sibling is Second (id 2), since it is not the last stream.
    expect(nameOf(1, "First".length)).toBe("First");
    expect(view.getUint8(directoryAt(1) + 0x42)).toBe(2); // OBJECT_TYPE_STREAM
    expect(view.getUint32(directoryAt(1) + 0x44, true)).toBe(NOSTREAM);
    expect(view.getUint32(directoryAt(1) + 0x48, true)).toBe(2);
    expect(view.getUint32(directoryAt(1) + 0x4c, true)).toBe(NOSTREAM); // no child -- a stream, not a storage
    expect(view.getUint32(directoryAt(1) + 0x74, true)).toBe(2); // startSector
    expect(view.getUint32(directoryAt(1) + 0x78, true)).toBe(512);
    expect(view.getUint32(directoryAt(1) + 0x7c, true)).toBe(0);

    // Second (id 2): the last stream, so no right sibling.
    expect(nameOf(2, "Second".length)).toBe("Second");
    expect(view.getUint32(directoryAt(2) + 0x48, true)).toBe(NOSTREAM);
    expect(view.getUint32(directoryAt(2) + 0x74, true)).toBe(3); // startSector
    expect(view.getUint32(directoryAt(2) + 0x78, true)).toBe(600);

    // The stream bytes themselves, at their own chained sectors.
    expect(
      Array.from(file.subarray(sectorOffset(2), sectorOffset(2) + 512)),
    ).toEqual(Array.from(streamA));
    expect(
      Array.from(file.subarray(sectorOffset(3), sectorOffset(3) + 600)),
    ).toEqual(Array.from(streamB));
  });

  it("writes Root Entry's own child as NOSTREAM for an empty stream list, rather than the first stream's id", () => {
    const file = compoundFile([]);
    const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
    expect(view.getUint32(sectorOffset(1) + 0x4c, true)).toBe(NOSTREAM);
  });

  it("stays at one FAT sector when the non-FAT sector count exactly fills it", () => {
    // One FAT sector addresses 128 total sectors including its own: fatSectors * 128 < nonFatSectors + fatSectors is the fixed-point test, and 127 non-FAT sectors is exactly the boundary where 1 * 128 (128) is not less than 127 + 1 (128) -- the one nonFatSectors value where < and <= actually disagree, since either comparison agrees everywhere else. 101 one-sector (64-byte) streams plus their own 26-sector directory (ceil(102 entries / 4 per sector)) is exactly 127.
    const streams = Array.from({ length: 101 }, (_unused, index) => ({
      name: `s${index}`,
      bytes: bytesOf(64, index % 256),
    }));
    const file = compoundFile(streams);
    const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
    expect(view.getUint32(0x2c, true)).toBe(1);
    expect(readCompoundFile(file)).toHaveLength(101);
  });

  it("grows to two FAT sectors when the non-FAT sector count needs the growth loop's own +fatSectors term, not -fatSectors", () => {
    // 128 non-FAT sectors: 1 * 128 (128) IS less than 128 + 1 (129), so growth to 2 FAT sectors is required (1 FAT sector cannot address a 129th sector, itself included). Subtracting fatSectors instead of adding it would compute 128 < 128 - 1 (127), false, wrongly stopping at 1 FAT sector -- too few slots for the file's own 129 sectors. 102 one-sector streams plus their own 26-sector directory is exactly 128.
    const streams = Array.from({ length: 102 }, (_unused, index) => ({
      name: `t${index}`,
      bytes: bytesOf(64, index % 256),
    }));
    const file = compoundFile(streams);
    const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
    expect(view.getUint32(0x2c, true)).toBe(2);
    expect(readCompoundFile(file)).toHaveLength(102);
  });

  it("grows past one FAT sector once the stream count needs it", () => {
    // FAT_ENTRIES_PER_SECTOR is 128; one FAT sector addresses 128 sectors including itself, so enough 64-byte (one-sector) streams to push nonFatSectors past 127 forces a second FAT sector. 130 streams (130 sectors) plus a multi-sector directory comfortably clears that.
    const streams = Array.from({ length: 130 }, (_unused, index) => ({
      name: `s${index}`,
      bytes: bytesOf(64, index % 256),
    }));
    const file = compoundFile(streams);
    const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
    const fatSectors = view.getUint32(0x2c, true);
    expect(fatSectors).toBe(2);
    // Both FAT sectors are marked FATSECT at their own index in the table sector 0 carries.
    expect(view.getUint32(sectorOffset(0), true)).toBe(FATSECT);
    expect(view.getUint32(sectorOffset(0) + 4, true)).toBe(FATSECT);
    expect(view.getUint32(sectorOffset(0) + 8, true)).not.toBe(FATSECT);
    // The header DIFAT array names both FAT sectors (0 and 1) before padding with FREESECT.
    expect(view.getUint32(0x4c, true)).toBe(0);
    expect(view.getUint32(0x4c + 4, true)).toBe(1);
    expect(view.getUint32(0x4c + 8, true)).toBe(FREESECT);
    const readBack = readCompoundFile(file);
    expect(readBack).toHaveLength(130);
    expect(readBack[0]).toEqual({ path: "s0", bytes: streams[0]?.bytes });
    expect(readBack[129]).toEqual({
      path: "s129",
      bytes: streams[129]?.bytes,
    });
  });
});
