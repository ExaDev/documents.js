import { describe, expect, it } from "vitest";
import { readCompoundFile, readOlePackage } from "archive-codec";
import { oleObjectBin } from "./cfb";

// Direct structural coverage for this file's own compound-file construction (never published, but real code Stryker mutates all the same): every stream this builder writes is read back through archive-codec's OWN independent reader (readCompoundFile/readOlePackage), the same reader real production code depends on, so a wrong offset, a wrong chain value, or a wrong loop bound here surfaces as a genuine read failure or a wrong decoded field -- not merely "did it not throw".

const enc = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);

describe("oleObjectBin", () => {
  it("wraps small file bytes (mini-stream resident) in a 'Package' stream carrying the exact OLE-packaged label and paths", () => {
    const fileBytes = enc("small payload");
    const bytes = oleObjectBin(fileBytes);
    const streams = readCompoundFile(bytes);
    expect(streams).toHaveLength(1);
    expect(streams[0]?.path).toBe("Package");
    const olePackage = readOlePackage(streams[0]?.bytes ?? new Uint8Array(0));
    expect(olePackage.label).toBe("Book1.xlsx");
    expect(olePackage.sourcePath).toBe("C:\\data\\Book1.xlsx");
    expect(olePackage.tempPath).toBe("C:\\temp\\Book1.xlsx");
    expect(olePackage.fileBytes).toEqual(fileBytes);
  });

  it("honours a custom stream name in place of the 'Package' default", () => {
    const bytes = oleObjectBin(enc("native stream content"), {
      streamName: "Workbook",
    });
    const streams = readCompoundFile(bytes);
    expect(streams).toHaveLength(1);
    expect(streams[0]?.path).toBe("Workbook");
  });

  it("round-trips a file whose packaged bytes span several mini sectors (still mini-stream resident, below the 4096-byte cutoff)", () => {
    // packageStreamOf adds a fixed ~60-byte OLE-packaging overhead ahead of the file bytes -- 2000 bytes of payload keeps the whole packaged stream comfortably under MINI_STREAM_CUTOFF (4096) while its own mini-sector padding (64-byte granularity) spans several ordinary 512-byte FAT sectors, exercising the multi-sector FAT chain and the multi-mini-sector mini-FAT chain a single-sector fixture never reaches.
    const fileBytes = new Uint8Array(2000).map((_, i) => i % 256);
    const bytes = oleObjectBin(fileBytes);
    const streams = readCompoundFile(bytes);
    expect(streams).toHaveLength(1);
    expect(streams[0]?.path).toBe("Package");
    const olePackage = readOlePackage(streams[0]?.bytes ?? new Uint8Array(0));
    expect(olePackage.fileBytes).toEqual(fileBytes);
  });

  it("round-trips a file large enough that its packaged stream is NOT mini-stream resident (at or above the 4096-byte cutoff)", () => {
    // Above MINI_STREAM_CUTOFF, oleObjectBin takes its entirely separate code path: ordinary (not mini) sector padding, no mini-FAT block at all, and a root directory entry pointing at ENDOFCHAIN rather than the stream's own start sector.
    const fileBytes = new Uint8Array(6000).map((_, i) => (i * 7) % 256);
    const bytes = oleObjectBin(fileBytes);
    const streams = readCompoundFile(bytes);
    expect(streams).toHaveLength(1);
    expect(streams[0]?.path).toBe("Package");
    const olePackage = readOlePackage(streams[0]?.bytes ?? new Uint8Array(0));
    expect(olePackage.fileBytes).toEqual(fileBytes);
  });

  it("round-trips a second, differently-sized large non-mini-stream file, exercising a different FAT chain length than the fixture above", () => {
    const fileBytes = new Uint8Array(4096).map((_, i) => (i * 3) % 256);
    const bytes = oleObjectBin(fileBytes);
    const streams = readCompoundFile(bytes);
    const olePackage = readOlePackage(streams[0]?.bytes ?? new Uint8Array(0));
    expect(olePackage.fileBytes).toEqual(fileBytes);
  });

  it("takes the non-mini-stream path for a packaged stream of EXACTLY 4096 bytes, not just above it", () => {
    // packageStreamOf's own fixed overhead (2 + 11 + 19 + 8 + 19 + 4 = 63 bytes) means a 4033-byte file produces a packaged stream of exactly MINI_STREAM_CUTOFF (4096) -- "small" is a strict less-than, so this must take the large-file path, not the mini-stream one.
    const fileBytes = new Uint8Array(4033).fill(0xab);
    const bytes = oleObjectBin(fileBytes);
    // The large-file path gives the root entry startSector ENDOFCHAIN (0xfffffffe) and size 0, never the mini-stream-resident shape (small nonzero startSector, size set to the padded stream length) -- read directly off the directory's own root entry bytes (offset 0x74 startSector, 0x78 size), bypassing readCompoundFile's own reader so this checks the builder's actual output shape, not just that it happens to still parse.
    const directoryOffset = 512 + 1 * 512;
    const rootEntryView = new DataView(bytes.buffer, directoryOffset, 128);
    expect(rootEntryView.getUint32(0x74, true)).toBe(0xfffffffe);
    expect(rootEntryView.getUint32(0x78, true)).toBe(0);
    // Still round-trips correctly despite taking the large-file path.
    const streams = readCompoundFile(bytes);
    const olePackage = readOlePackage(streams[0]?.bytes ?? new Uint8Array(0));
    expect(olePackage.fileBytes).toEqual(fileBytes);
  });

  it("writes every fixed [MS-CFB] header field this builder is responsible for, at its exact byte offset", () => {
    // Several of these fields (minor version, number of FAT sectors, DIFAT[0]'s own sibling padding slots, the FAT sector's own two leading entries, the root entry's own name) are never cross-checked by archive-codec's own reader (its header comment says so explicitly for the directory's sibling/count fields, and for the root entry name specifically) -- the only way to prove this builder still writes them correctly is to read the raw bytes directly, the same way a real MS-CFB-conformant reader that DID check them would.
    const fileBytes = enc("x"); // packaged stream length 64 -- exactly one ordinary sector once mini-sector-padded, so streamSectors = 1 and miniFatSector = 2 + 1 = 3, both easy to hand-verify.
    const bytes = oleObjectBin(fileBytes);
    const header = new DataView(bytes.buffer, 0, 512);
    expect(Array.from(bytes.subarray(0, 8))).toEqual([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
    ]);
    expect(header.getUint16(0x18, true)).toBe(0x3e);
    expect(header.getUint16(0x1a, true)).toBe(3);
    expect(header.getUint16(0x1c, true)).toBe(0xfffe);
    expect(header.getUint16(0x1e, true)).toBe(9);
    expect(header.getUint16(0x20, true)).toBe(6);
    expect(header.getUint32(0x28, true)).toBe(0);
    expect(header.getUint32(0x2c, true)).toBe(1);
    expect(header.getUint32(0x30, true)).toBe(1);
    expect(header.getUint32(0x38, true)).toBe(4096);
    expect(header.getUint32(0x3c, true)).toBe(3); // miniFatSector, since this fixture is mini-stream resident
    expect(header.getUint32(0x40, true)).toBe(1);
    expect(header.getUint32(0x44, true)).toBe(0xfffffffe);
    expect(header.getUint32(0x48, true)).toBe(0);
    expect(header.getUint32(0x4c, true)).toBe(0); // DIFAT[0]: the FAT is sector 0
    for (let i = 1; i < 109; i++) {
      expect(header.getUint32(0x4c + i * 4, true)).toBe(0xffffffff);
    }
    // The FAT sector itself (file sector 0, at byte offset 512): its own two leading entries, little-endian.
    const fat = new DataView(bytes.buffer, 512, 512);
    expect(fat.getUint32(0, true)).toBe(0xfffffffd); // FATSECT: sector 0 holds the FAT itself
    expect(fat.getUint32(4, true)).toBe(0xfffffffe); // ENDOFCHAIN: the one-sector directory chain
    // The root entry's own name -- readCompoundFile deliberately never reads it (only the type matters), so a byte-level check is the only way to verify it at all.
    const rootNameBytes = bytes.subarray(1024, 1024 + "Root Entry".length * 2);
    expect(new TextDecoder("utf-16le").decode(rootNameBytes)).toBe(
      "Root Entry",
    );
  });

  it("leaves the mini-FAT's unused padding slot alone, never writing one loop iteration past the mini stream's own sector count", () => {
    // padded.length / MINI_SECTOR_SIZE (miniSectorCount) is capped well under 128 for any mini-stream-resident fixture, so an off-by-one loop bound here can never be caught by a bounds-exceeding crash the way the FAT-chain and mini-FAT-block guards elsewhere in this file are -- only a direct read of the one slot immediately past the real chain shows whether an extra iteration wrote into it.
    const fileBytes = new Uint8Array(2000).fill(0xcd); // packaged stream 2063 bytes -> padded to 2112 -> miniSectorCount 33, streamSectors 5, miniFatSector 7.
    const bytes = oleObjectBin(fileBytes);
    const miniFatOffset = 512 + 7 * 512;
    const miniFat = new DataView(bytes.buffer, miniFatOffset, 512);
    expect(miniFat.getUint32(32 * 4, true)).toBe(0xfffffffe); // the real chain's own last slot: ENDOFCHAIN
    expect(miniFat.getUint32(33 * 4, true)).toBe(0); // one past it: untouched
  });

  it("round-trips a file whose FAT chain lands exactly on the one-FAT-sector boundary this builder is scoped to", () => {
    // This builder always declares exactly one FAT sector (128 possible chain entries), so a large-file stream needing sector indices up to 127 is the largest this builder can address at all -- streamSectors = 126 puts the ordinary FAT chain's own last legitimate write at sector 127 (offset 508, fitting exactly), the tightest large-file fixture this builder can produce without exceeding its own one-FAT-sector design.
    const fileBytes = new Uint8Array(64400).fill(0xef);
    const bytes = oleObjectBin(fileBytes);
    const streams = readCompoundFile(bytes);
    const olePackage = readOlePackage(streams[0]?.bytes ?? new Uint8Array(0));
    expect(olePackage.fileBytes).toEqual(fileBytes);
  });
});
