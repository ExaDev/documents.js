import { describe, expect, it } from "vitest";
import {
  COMPOUND_FILE_MAGIC,
  readCompoundFile,
  readOlePackage,
} from "archive-codec";
import { oleObjectBin } from "./cfb";

// Direct structural coverage for this file's own compound-file construction (never published, but real code Stryker mutates all the same): every stream this builder writes is read back through archive-codec's OWN independent reader (readCompoundFile/readOlePackage), the same reader real production code depends on, so a wrong offset, a wrong chain value, or a wrong loop bound here surfaces as a genuine read failure or a wrong decoded field, not merely "did it not throw".

const enc = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);

// Named to the same meaning as cfb.ts's own (unexported) local constants of the same name, since this file independently re-verifies the builder's raw output rather than importing its internals, matching the whole point of a byte-level check: proving the actual written bytes, not trusting the constant the builder itself used to write them.
const SECTOR_SIZE = 512;
const MINI_STREAM_CUTOFF = 4096;
const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;
const FATSECT = 0xfffffffd;
const DIRECTORY_ENTRY_SIZE = 128;
const DIRECTORY_ENTRY_STARTING_SECTOR_OFFSET = 0x74;
const DIRECTORY_ENTRY_STREAM_SIZE_OFFSET = 0x78;
const FAT_ENTRY_SIZE = 4; // a FAT, mini-FAT, or DIFAT entry is always a 4-byte (uint32) sector reference, per [MS-CFB] 2.3/2.4/2.5
const HEADER_MINOR_VERSION_OFFSET = 0x18;
const HEADER_MAJOR_VERSION_OFFSET = 0x1a;
const HEADER_BYTE_ORDER_OFFSET = 0x1c;
const HEADER_SECTOR_SHIFT_OFFSET = 0x1e;
const HEADER_MINI_SECTOR_SHIFT_OFFSET = 0x20;
const HEADER_RESERVED_OFFSET = 0x28; // [MS-CFB] 2.2's own reserved field; this builder never writes it, so it stays at the buffer's own zero default
const HEADER_FAT_SECTOR_COUNT_OFFSET = 0x2c;
const HEADER_FIRST_DIRECTORY_SECTOR_OFFSET = 0x30;
const HEADER_MINI_STREAM_CUTOFF_OFFSET = 0x38;
const HEADER_FIRST_MINIFAT_SECTOR_OFFSET = 0x3c;
const HEADER_MINIFAT_SECTOR_COUNT_OFFSET = 0x40;
const HEADER_FIRST_DIFAT_SECTOR_OFFSET = 0x44;
const HEADER_DIFAT_SECTOR_COUNT_OFFSET = 0x48; // [MS-CFB] 2.2's own "Number of DIFAT Sectors"; this builder always declares exactly one FAT sector, so it never needs more than the header's own inline DIFAT array and leaves this at zero
const HEADER_DIFAT_OFFSET = 0x4c; // where the header's own inline DIFAT[0..108] array begins
const HEADER_DIFAT_SLOT_COUNT = 109; // the header's own inline DIFAT array holds this many 4-byte slots, filling the header from HEADER_DIFAT_OFFSET to its own 512-byte end
const HEADER_MINOR_VERSION = 0x3e;
const HEADER_MAJOR_VERSION_V3 = 3;
const HEADER_BYTE_ORDER_MARK = 0xfffe;
const HEADER_SECTOR_SHIFT_512 = 9;
const HEADER_MINI_SECTOR_SHIFT_64 = 6;
const HEADER_ONE_FAT_SECTOR = 1;
const HEADER_DIRECTORY_STARTS_AT_SECTOR_1 = 1;
// A pseudo-random-looking byte sequence generator's own wraparound modulus, matching a byte's valid 0-255 range: shared by every large fixture below that fills its bytes with `i % BYTE_VALUE_MODULUS` or `(i * k) % BYTE_VALUE_MODULUS`.
const BYTE_VALUE_MODULUS = 256;

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
    // packageStreamOf adds a fixed ~60-byte OLE-packaging overhead ahead of the file bytes: this many bytes of payload keeps the whole packaged stream comfortably under MINI_STREAM_CUTOFF (4096) while its own mini-sector padding (64-byte granularity) spans several ordinary 512-byte FAT sectors, exercising the multi-sector FAT chain and the multi-mini-sector mini-FAT chain a single-sector fixture never reaches.
    const PAYLOAD_SIZE_BYTES = 2000;
    const fileBytes = new Uint8Array(PAYLOAD_SIZE_BYTES).map(
      (_, i) => i % BYTE_VALUE_MODULUS,
    );
    const bytes = oleObjectBin(fileBytes);
    const streams = readCompoundFile(bytes);
    expect(streams).toHaveLength(1);
    expect(streams[0]?.path).toBe("Package");
    const olePackage = readOlePackage(streams[0]?.bytes ?? new Uint8Array(0));
    expect(olePackage.fileBytes).toEqual(fileBytes);
  });

  it("round-trips a file large enough that its packaged stream is NOT mini-stream resident (at or above the 4096-byte cutoff)", () => {
    // Above MINI_STREAM_CUTOFF, oleObjectBin takes its entirely separate code path: ordinary (not mini) sector padding, no mini-FAT block at all, and a root directory entry pointing at ENDOFCHAIN rather than the stream's own start sector.
    const PAYLOAD_SIZE_BYTES = 6000;
    const BYTE_SEQUENCE_MULTIPLIER = 7; // arbitrary, distinguishing this fixture's own byte sequence from the other large fixtures below
    const fileBytes = new Uint8Array(PAYLOAD_SIZE_BYTES).map(
      (_, i) => (i * BYTE_SEQUENCE_MULTIPLIER) % BYTE_VALUE_MODULUS,
    );
    const bytes = oleObjectBin(fileBytes);
    const streams = readCompoundFile(bytes);
    expect(streams).toHaveLength(1);
    expect(streams[0]?.path).toBe("Package");
    const olePackage = readOlePackage(streams[0]?.bytes ?? new Uint8Array(0));
    expect(olePackage.fileBytes).toEqual(fileBytes);
  });

  it("round-trips a second, differently-sized large non-mini-stream file, exercising a different FAT chain length than the fixture above", () => {
    const PAYLOAD_SIZE_BYTES = 4096;
    const BYTE_SEQUENCE_MULTIPLIER = 3; // arbitrary, distinguishing this fixture's own byte sequence from the other large fixtures
    const fileBytes = new Uint8Array(PAYLOAD_SIZE_BYTES).map(
      (_, i) => (i * BYTE_SEQUENCE_MULTIPLIER) % BYTE_VALUE_MODULUS,
    );
    const bytes = oleObjectBin(fileBytes);
    const streams = readCompoundFile(bytes);
    const olePackage = readOlePackage(streams[0]?.bytes ?? new Uint8Array(0));
    expect(olePackage.fileBytes).toEqual(fileBytes);
  });

  it("takes the non-mini-stream path for a packaged stream of EXACTLY 4096 bytes, not just above it", () => {
    // packageStreamOf's own fixed overhead (2 + 11 + 19 + 8 + 19 + 4 = 63 bytes) means a 4033-byte file produces a packaged stream of exactly MINI_STREAM_CUTOFF (4096): "small" is a strict less-than, so this must take the large-file path, not the mini-stream one.
    const PAYLOAD_SIZE_BYTES = 4033;
    const ARBITRARY_FILL_BYTE = 0xab; // its exact value carries no meaning; only the fixture's own size matters here
    const fileBytes = new Uint8Array(PAYLOAD_SIZE_BYTES).fill(
      ARBITRARY_FILL_BYTE,
    );
    const bytes = oleObjectBin(fileBytes);
    // The large-file path gives the root entry startSector ENDOFCHAIN and size 0, never the mini-stream-resident shape (small nonzero startSector, size set to the padded stream length): read directly off the directory's own root entry bytes (its own starting-sector and stream-size offsets), bypassing readCompoundFile's own reader so this checks the builder's actual output shape, not just that it happens to still parse.
    const directoryOffset = SECTOR_SIZE + 1 * SECTOR_SIZE;
    const rootEntryView = new DataView(
      bytes.buffer,
      directoryOffset,
      DIRECTORY_ENTRY_SIZE,
    );
    expect(
      rootEntryView.getUint32(DIRECTORY_ENTRY_STARTING_SECTOR_OFFSET, true),
    ).toBe(ENDOFCHAIN);
    expect(
      rootEntryView.getUint32(DIRECTORY_ENTRY_STREAM_SIZE_OFFSET, true),
    ).toBe(0);
    // Still round-trips correctly despite taking the large-file path.
    const streams = readCompoundFile(bytes);
    const olePackage = readOlePackage(streams[0]?.bytes ?? new Uint8Array(0));
    expect(olePackage.fileBytes).toEqual(fileBytes);
  });

  it("writes every fixed [MS-CFB] header field this builder is responsible for, at its exact byte offset", () => {
    // Several of these fields (minor version, number of FAT sectors, DIFAT[0]'s own sibling padding slots, the FAT sector's own two leading entries, the root entry's own name) are never cross-checked by archive-codec's own reader (its header comment says so explicitly for the directory's sibling/count fields, and for the root entry name specifically): the only way to prove this builder still writes them correctly is to read the raw bytes directly, the same way a real MS-CFB-conformant reader that DID check them would.
    const fileBytes = enc("x"); // packaged stream length 64: exactly one ordinary sector once mini-sector-padded, so streamSectors = 1 and miniFatSector = 2 + 1 = 3, both easy to hand-verify.
    const bytes = oleObjectBin(fileBytes);
    const header = new DataView(bytes.buffer, 0, SECTOR_SIZE);
    expect(Array.from(bytes.subarray(0, COMPOUND_FILE_MAGIC.length))).toEqual(
      COMPOUND_FILE_MAGIC,
    );
    expect(header.getUint16(HEADER_MINOR_VERSION_OFFSET, true)).toBe(
      HEADER_MINOR_VERSION,
    );
    expect(header.getUint16(HEADER_MAJOR_VERSION_OFFSET, true)).toBe(
      HEADER_MAJOR_VERSION_V3,
    );
    expect(header.getUint16(HEADER_BYTE_ORDER_OFFSET, true)).toBe(
      HEADER_BYTE_ORDER_MARK,
    );
    expect(header.getUint16(HEADER_SECTOR_SHIFT_OFFSET, true)).toBe(
      HEADER_SECTOR_SHIFT_512,
    );
    expect(header.getUint16(HEADER_MINI_SECTOR_SHIFT_OFFSET, true)).toBe(
      HEADER_MINI_SECTOR_SHIFT_64,
    );
    expect(header.getUint32(HEADER_RESERVED_OFFSET, true)).toBe(0);
    expect(header.getUint32(HEADER_FAT_SECTOR_COUNT_OFFSET, true)).toBe(
      HEADER_ONE_FAT_SECTOR,
    );
    expect(header.getUint32(HEADER_FIRST_DIRECTORY_SECTOR_OFFSET, true)).toBe(
      HEADER_DIRECTORY_STARTS_AT_SECTOR_1,
    );
    expect(header.getUint32(HEADER_MINI_STREAM_CUTOFF_OFFSET, true)).toBe(
      MINI_STREAM_CUTOFF,
    );
    const EXPECTED_MINI_FAT_SECTOR = 3; // miniFatSector, since this fixture is mini-stream resident
    expect(header.getUint32(HEADER_FIRST_MINIFAT_SECTOR_OFFSET, true)).toBe(
      EXPECTED_MINI_FAT_SECTOR,
    );
    expect(header.getUint32(HEADER_MINIFAT_SECTOR_COUNT_OFFSET, true)).toBe(1);
    expect(header.getUint32(HEADER_FIRST_DIFAT_SECTOR_OFFSET, true)).toBe(
      ENDOFCHAIN,
    );
    expect(header.getUint32(HEADER_DIFAT_SECTOR_COUNT_OFFSET, true)).toBe(0);
    expect(header.getUint32(HEADER_DIFAT_OFFSET, true)).toBe(0); // DIFAT[0]: the FAT is sector 0
    for (let i = 1; i < HEADER_DIFAT_SLOT_COUNT; i++) {
      expect(
        header.getUint32(HEADER_DIFAT_OFFSET + i * FAT_ENTRY_SIZE, true),
      ).toBe(FREESECT);
    }
    // The FAT sector itself (file sector 0, at byte offset SECTOR_SIZE): its own two leading entries, little-endian.
    const fat = new DataView(bytes.buffer, SECTOR_SIZE, SECTOR_SIZE);
    expect(fat.getUint32(0, true)).toBe(FATSECT); // sector 0 holds the FAT itself
    expect(fat.getUint32(FAT_ENTRY_SIZE, true)).toBe(ENDOFCHAIN); // the one-sector directory chain
    // The root entry's own name: readCompoundFile deliberately never reads it (only the type matters), so a byte-level check is the only way to verify it at all.
    const directoryOffset = SECTOR_SIZE + 1 * SECTOR_SIZE;
    const rootNameBytes = bytes.subarray(
      directoryOffset,
      directoryOffset + "Root Entry".length * 2,
    );
    expect(new TextDecoder("utf-16le").decode(rootNameBytes)).toBe(
      "Root Entry",
    );
  });

  it("leaves the mini-FAT's unused padding slot alone, never writing one loop iteration past the mini stream's own sector count", () => {
    // padded.length / MINI_SECTOR_SIZE (miniSectorCount) is capped well under 128 for any mini-stream-resident fixture, so an off-by-one loop bound here can never be caught by a bounds-exceeding crash the way the FAT-chain and mini-FAT-block guards elsewhere in this file are: only a direct read of the one slot immediately past the real chain shows whether an extra iteration wrote into it.
    const PAYLOAD_SIZE_BYTES = 2000; // packaged stream 2063 bytes -> padded to 2112 -> miniSectorCount 33, streamSectors 5, miniFatSector 7.
    const ARBITRARY_FILL_BYTE = 0xcd;
    const MINI_FAT_SECTOR_INDEX = 7;
    const LAST_REAL_MINI_FAT_SLOT_INDEX = 32;
    const fileBytes = new Uint8Array(PAYLOAD_SIZE_BYTES).fill(
      ARBITRARY_FILL_BYTE,
    );
    const bytes = oleObjectBin(fileBytes);
    const miniFatOffset = SECTOR_SIZE + MINI_FAT_SECTOR_INDEX * SECTOR_SIZE;
    const miniFat = new DataView(bytes.buffer, miniFatOffset, SECTOR_SIZE);
    expect(
      miniFat.getUint32(LAST_REAL_MINI_FAT_SLOT_INDEX * FAT_ENTRY_SIZE, true),
    ).toBe(ENDOFCHAIN); // the real chain's own last slot
    expect(
      miniFat.getUint32(
        (LAST_REAL_MINI_FAT_SLOT_INDEX + 1) * FAT_ENTRY_SIZE,
        true,
      ),
    ).toBe(0); // one past it: untouched
  });

  it("round-trips a file whose FAT chain lands exactly on the one-FAT-sector boundary this builder is scoped to", () => {
    // This builder always declares exactly one FAT sector (128 possible chain entries), so a large-file stream needing sector indices up to 127 is the largest this builder can address at all: streamSectors = 126 puts the ordinary FAT chain's own last legitimate write at sector 127 (offset 508, fitting exactly), the tightest large-file fixture this builder can produce without exceeding its own one-FAT-sector design.
    const PAYLOAD_SIZE_BYTES = 64400;
    const ARBITRARY_FILL_BYTE = 0xef;
    const fileBytes = new Uint8Array(PAYLOAD_SIZE_BYTES).fill(
      ARBITRARY_FILL_BYTE,
    );
    const bytes = oleObjectBin(fileBytes);
    const streams = readCompoundFile(bytes);
    const olePackage = readOlePackage(streams[0]?.bytes ?? new Uint8Array(0));
    expect(olePackage.fileBytes).toEqual(fileBytes);
  });
});
