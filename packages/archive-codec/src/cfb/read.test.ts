import { describe, expect, it } from "vitest";
import { compoundFile } from "../test-support/cfb";
import { CompoundFileFormatError, readCompoundFile } from "./read";
import { writeCompoundFile } from "./write";

// Coverage for the bounded [MS-CFB] reader (src/cfb/read.ts): header/sector-size parsing, DIFAT/FAT chain walking, the directory entry tree, stream extraction from both the FAT and the mini stream, and the guards. Fixtures come from src/test-support/cfb.ts -- a hand-built minimal compound-file writer whose construction is documented there -- because the reader under test consumes actual compound-file bytes (a hand-built in-memory model would skip the parse entirely).

const enc = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);

describe("readCompoundFile", () => {
  it("extracts a FAT-resident stream larger than the mini-stream cutoff", () => {
    // 5000 bytes >= the 4096-byte cutoff, so the stream occupies whole sectors chained in the FAT -- the plain path every large stream takes.
    const payload = enc("X".repeat(5000));
    const streams = readCompoundFile(
      compoundFile([{ path: "BigStream", bytes: payload }]),
    );
    expect(streams.map((s) => s.path)).toEqual(["BigStream"]);
    expect(streams[0]?.bytes).toEqual(payload);
  });

  it("extracts a mini-stream-resident stream shorter than the cutoff, via the mini-FAT", () => {
    // 100 bytes < 4096, so the stream lives in the mini stream -- the root entry's own stream, carved into 64-byte mini sectors by the mini-FAT -- which is where a small real-world embed (an OLE-packaged file of a few kilobytes) genuinely lands.
    const payload = enc("mini stream payload");
    const streams = readCompoundFile(
      compoundFile([{ path: "SmallStream", bytes: payload }]),
    );
    expect(streams.map((s) => s.path)).toEqual(["SmallStream"]);
    expect(streams[0]?.bytes).toEqual(payload);
  });

  it("mixes FAT-resident and mini-stream-resident streams in one file", () => {
    const small = enc("tiny");
    const large = enc("Y".repeat(4096));
    const streams = readCompoundFile(
      compoundFile([
        { path: "Large", bytes: large },
        { path: "Small", bytes: small },
      ]),
    );
    expect(streams.map((s) => s.path)).toEqual(["Large", "Small"]);
    expect(streams.find((s) => s.path === "Small")?.bytes).toEqual(small);
    expect(streams.find((s) => s.path === "Large")?.bytes).toEqual(large);
  });

  it("extracts both FAT- and mini-stream-resident streams from a version-4 file (4096-byte sectors)", () => {
    // Version 4 zero-pads the 512-byte header out to the full 4096-byte first sector ([MS-CFB] 2.2), so sector N starts at (N + 1) * 4096 -- an offset that only coincides with version 3's 512 + N * sectorSize because version 3's sector size is itself 512. Real-world .bin embeds written by 64-bit producers are version 4, so this is the layout the embedded-object recovery path genuinely meets.
    const small = enc("mini stream payload");
    const large = enc("V".repeat(4096));
    const streams = readCompoundFile(
      compoundFile(
        [
          { path: "Large", bytes: large },
          { path: "Small", bytes: small },
        ],
        { majorVersion: 4 },
      ),
    );
    expect(streams.map((s) => s.path)).toEqual(["Large", "Small"]);
    expect(streams.find((s) => s.path === "Small")?.bytes).toEqual(small);
    expect(streams.find((s) => s.path === "Large")?.bytes).toEqual(large);
  });

  it("derives slash-joined paths for streams nested inside storages", () => {
    const payload = enc("nested");
    const streams = readCompoundFile(
      compoundFile([
        { path: "ObjectStorage/Package", bytes: payload },
        { path: "Sibling", bytes: enc("root-level") },
      ]),
    );
    expect(streams.map((s) => s.path)).toEqual([
      "ObjectStorage/Package",
      "Sibling",
    ]);
    expect(streams[0]?.bytes).toEqual(payload);
  });

  it("extracts a FAT-resident stream whose size is not a whole multiple of the sector size, truncating to the declared size", () => {
    // 4500 bytes sits above the cutoff (FAT-resident) but needs 9 sectors = 4608 bytes of storage, so extraction must slice the chain's 4608 bytes back to 4500 -- trailing sector padding never becomes stream content. The mini-stream arm of the same truncation is covered by the small-stream tests (their payloads never fill their last 64-byte mini sector either).
    const payload = enc("Z".repeat(4500));
    const streams = readCompoundFile(
      compoundFile([{ path: "Partial", bytes: payload }]),
    );
    expect(streams[0]?.bytes).toEqual(payload);
    expect(streams[0]?.bytes.length).toBe(4500);
  });

  it("returns an empty listing for a compound file with no streams", () => {
    expect(readCompoundFile(compoundFile([]))).toEqual([]);
  });

  it("writes ENDOFCHAIN as the root entry's own starting sector when there is no mini stream at all", () => {
    // header (512) + one FAT sector (512) + the root entry (id 0) at the directory sector's own start.
    const bytes = compoundFile([]);
    expect(new DataView(bytes.buffer).getUint32(512 * 2 + 0x74, true)).toBe(
      0xfffffffe,
    );
  });

  it("extracts several mini-resident streams from the same mini stream, each at its own sequential mini sector", () => {
    // Four same-length names (so length-first sibling ordering, mirrored from [MS-CFB] 2.6.4, leaves them in plain alphabetical/insertion order) with individually distinguishable mini-sector counts: 1, 2, 1, and 3 mini sectors (64 bytes each).
    const streams = readCompoundFile(
      compoundFile([
        { path: "Aaa", bytes: enc("a".repeat(30)) }, // ceil(30/64) = 1
        { path: "Bbb", bytes: enc("b".repeat(100)) }, // ceil(100/64) = 2
        { path: "Ccc", bytes: enc("c".repeat(10)) }, // ceil(10/64) = 1
        { path: "Ddd", bytes: enc("d".repeat(150)) }, // ceil(150/64) = 3
      ]),
    );
    expect(streams.map((s) => s.path)).toEqual(["Aaa", "Bbb", "Ccc", "Ddd"]);
    expect(streams.find((s) => s.path === "Aaa")?.bytes).toEqual(
      enc("a".repeat(30)),
    );
    expect(streams.find((s) => s.path === "Bbb")?.bytes).toEqual(
      enc("b".repeat(100)),
    );
    expect(streams.find((s) => s.path === "Ccc")?.bytes).toEqual(
      enc("c".repeat(10)),
    );
    expect(streams.find((s) => s.path === "Ddd")?.bytes).toEqual(
      enc("d".repeat(150)),
    );
  });

  it("extracts several FAT-resident streams, each occupying its own run of whole sectors", () => {
    const streams = readCompoundFile(
      compoundFile([
        { path: "One", bytes: enc("1".repeat(5000)) },
        { path: "Two", bytes: enc("2".repeat(6000)) },
        { path: "Three", bytes: enc("3".repeat(4200)) },
      ]),
    );
    expect(streams.find((s) => s.path === "One")?.bytes).toEqual(
      enc("1".repeat(5000)),
    );
    expect(streams.find((s) => s.path === "Two")?.bytes).toEqual(
      enc("2".repeat(6000)),
    );
    expect(streams.find((s) => s.path === "Three")?.bytes).toEqual(
      enc("3".repeat(4200)),
    );
  });

  it("extracts a storage with several sibling children, not just one", () => {
    const streams = readCompoundFile(
      compoundFile([
        { path: "Pool/First", bytes: enc("1") },
        { path: "Pool/Second", bytes: enc("2") },
        { path: "Pool/Third", bytes: enc("3") },
      ]),
    );
    expect(streams.map((s) => s.path).sort()).toEqual([
      "Pool/First",
      "Pool/Second",
      "Pool/Third",
    ]);
  });

  it("reads every stream of a file needing more than one 512-byte directory sector (more than 4 entries)", () => {
    // 4 entries per 512-byte directory sector ([MS-CFB] 2.6.1's 128-byte entry): 10 streams plus the root need 3 directory sectors.
    const inputs = Array.from({ length: 10 }, (_unused, index) => ({
      path: `Stream${index}`,
      bytes: enc(`payload ${index}`),
    }));
    const streams = readCompoundFile(compoundFile(inputs));
    expect(streams).toHaveLength(10);
    for (const input of inputs) {
      expect(streams.find((s) => s.path === input.path)?.bytes).toEqual(
        input.bytes,
      );
    }
  });

  it("reads a file large enough to need more than one FAT sector", () => {
    // A 512-byte-sector FAT sector maps 128 sectors (64 KiB); a 300 KiB stream forces the fixed-point FAT-sector-count loop to grow past 1 and reach a genuine fixed point.
    const payload = new Uint8Array(300 * 1024);
    for (let i = 0; i < payload.length; i++) {
      payload[i] = (i * 13 + 5) & 0xff;
    }
    const bytes = compoundFile([{ path: "Big", bytes: payload }]);
    expect(new DataView(bytes.buffer).getUint32(0x2c, true)).toBeGreaterThan(1);
    const streams = readCompoundFile(bytes);
    expect(streams[0]?.bytes).toEqual(payload);
  }, 20000); // v8 coverage instrumentation (CI's own _test:coverage task, and every Stryker mutant run) multiplies this test's real cost far past the default 5000ms budget: a 300 KiB byte-fill loop plus a full round trip is measured well under a second uninstrumented, but has been observed to exceed 5s on a loaded GitHub runner under coverage. A generous fixed timeout, not a smaller payload, keeps the fixture large enough to force the fixed-point loop past 1 while removing the flake.

  it("needs a second mini FAT sector once the mini stream passes 128 mini sectors", () => {
    // Each stream's own byte content is distinct (filled with its own index), not uniformly zero: a mini-FAT sector physically misplaced during the write would corrupt whichever OTHER stream's data actually occupies that sector, and only content that differs per stream can make that corruption visible -- an all-zero payload would still read back as all zero even after such a misplacement.
    const miniSectorsNeeded = 129;
    const inputs = Array.from({ length: miniSectorsNeeded }, (_unused, i) => ({
      path: `M${i}`,
      bytes: new Uint8Array(64).fill(i % 256), // exactly one mini sector each
    }));
    const bytes = compoundFile(inputs);
    expect(new DataView(bytes.buffer).getUint32(0x40, true)).toBe(2);
    const streams = readCompoundFile(bytes);
    expect(streams).toHaveLength(miniSectorsNeeded);
    for (let i = 0; i < miniSectorsNeeded; i++) {
      expect(streams.find((s) => s.path === `M${i}`)?.bytes).toEqual(
        new Uint8Array(64).fill(i % 256),
      );
    }
  });

  it("writes 0 as the directory-sector count for a version 3 file, and the real count for version 4", () => {
    const inputs = Array.from({ length: 10 }, (_unused, index) => ({
      path: `Stream${index}`,
      bytes: enc("x"),
    }));
    const v3 = compoundFile(inputs, { majorVersion: 3 });
    const v4 = compoundFile(inputs, { majorVersion: 4 });
    expect(new DataView(v3.buffer).getUint32(0x28, true)).toBe(0);
    expect(new DataView(v4.buffer).getUint32(0x28, true)).toBeGreaterThan(0);
  });
});

describe("compoundFile input validation", () => {
  it("rejects a storage or stream name that is empty", () => {
    expect(() => compoundFile([{ path: "", bytes: enc("x") }])).toThrow();
  });

  it("rejects a storage or stream name longer than 31 characters", () => {
    expect(() =>
      compoundFile([{ path: "N".repeat(32), bytes: enc("x") }]),
    ).toThrow(/at most 31 characters/);
    expect(() =>
      compoundFile([{ path: "N".repeat(31), bytes: enc("x") }]),
    ).not.toThrow();
  });

  it("rejects a storage or stream name holding a non-ASCII byte", () => {
    expect(() => compoundFile([{ path: "café", bytes: enc("x") }])).toThrow(
      /non-empty ASCII/,
    );
  });

  it("rejects an empty path segment", () => {
    for (const path of ["/Leading", "Trailing/", "Double//Segment"]) {
      expect(() => compoundFile([{ path, bytes: enc("x") }])).toThrow(
        /no empty segments/,
      );
    }
  });

  it("rejects the same path supplied twice", () => {
    expect(() =>
      compoundFile([
        { path: "Dup", bytes: enc("1") },
        { path: "Dup", bytes: enc("2") },
      ]),
    ).toThrow(/used twice/);
  });
});

describe("readCompoundFile malformed-input handling", () => {
  // Every corrupt-structure case asserts the named error, never a partial listing: a compound file that fails any structural check fails whole, per the family's loud-failure policy (the same stance walkArchive takes with its guards).
  const expectFormatError = (bytes: Uint8Array<ArrayBuffer>): void => {
    try {
      readCompoundFile(bytes);
      throw new Error(
        "expected readCompoundFile to throw CompoundFileFormatError",
      );
    } catch (error) {
      expect(error).toBeInstanceOf(CompoundFileFormatError);
    }
  };

  // Layout constants for the single-stream, single-FAT-sector fixtures below: header (512) + one FAT sector (512) puts the directory at byte 1024, entry 0 (root) at 1024, entry 1 (the one stream) at 1024 + 128.
  const HEADER_BYTES = 512;
  const FAT_SECTOR_BYTES = 512;
  const DIRECTORY_START = HEADER_BYTES + FAT_SECTOR_BYTES;
  const entryOffset = (id: number): number => DIRECTORY_START + id * 128;

  it("names its own error class CompoundFileFormatError, not merely an instance of it", () => {
    let caught: unknown;
    try {
      readCompoundFile(enc("not a compound file at all"));
    } catch (error) {
      caught = error;
    }
    expect((caught as Error).name).toBe("CompoundFileFormatError");
  });

  it("throws its exact message for bytes without the compound-file signature", () => {
    expect(() => readCompoundFile(enc("not a compound file at all"))).toThrow(
      "readCompoundFile input does not carry the compound-file signature (leading magic bytes are not D0 CF 11 E0 A1 B1 1A E1)",
    );
  });

  it("throws naming the exact byte count for input shorter than the 512-byte header", () => {
    const bytes = new Uint8Array([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00,
    ]);
    expect(() => readCompoundFile(bytes)).toThrow(
      `compound file is ${bytes.length} bytes, shorter than the fixed 512-byte header`,
    );
  });

  it("accepts input exactly the 512-byte header's own length, rejecting it only for having no sector past it", () => {
    // Exactly HEADER_SIZE bytes must not trip the "shorter than the header" check (bytes.length < HEADER_SIZE is false at equality) -- it fails a later, distinct check instead (no complete sector follows the header), proving the boundary itself is inclusive.
    const bytes = compoundFile([]).slice(0, 512);
    expect(() => readCompoundFile(bytes)).toThrow(
      "compound file holds no complete 512-byte sector after its header",
    );
  });

  it("throws naming the exact declared major version when it is neither 3 nor 4", () => {
    const bytes = compoundFile([{ path: "A", bytes: enc("x") }]);
    bytes[0x1a] = 5;
    expect(() => readCompoundFile(bytes)).toThrow(
      "compound file major version 5 is not 3 or 4",
    );
  });

  it("throws its exact message for a big-endian byte-order field", () => {
    const bytes = compoundFile([{ path: "A", bytes: enc("x") }]);
    // The field holds FE FF (little-endian 0xFFFE); swapping to FF FE reads as 0xFEFF, the big-endian marker this reader refuses.
    bytes[0x1c] = 0xff;
    bytes[0x1d] = 0xfe;
    expect(() => readCompoundFile(bytes)).toThrow(
      "compound file byte order is not little-endian",
    );
  });

  it("throws naming both the found sector shift and the major version it contradicts, in both directions", () => {
    const v3 = compoundFile([{ path: "A", bytes: enc("x") }], {
      majorVersion: 3,
    });
    v3[0x1e] = 12; // version 3 declaring 4096-byte sectors, which version 3 forbids
    expect(() => readCompoundFile(v3)).toThrow(
      "compound file sector shift 2^12 does not match major version 3 (version 3 requires 512-byte sectors, version 4 requires 4096-byte)",
    );

    const v4 = compoundFile([{ path: "A", bytes: enc("x") }], {
      majorVersion: 4,
    });
    v4[0x1e] = 9; // version 4 declaring 512-byte sectors, which version 4 forbids
    expect(() => readCompoundFile(v4)).toThrow(
      "compound file sector shift 2^9 does not match major version 4 (version 3 requires 512-byte sectors, version 4 requires 4096-byte)",
    );
  });

  it("throws naming the exact mini sector shift when it is not the mandated 64-byte mini sector", () => {
    const bytes = compoundFile([{ path: "A", bytes: enc("x") }]);
    bytes[0x20] = 5; // 2^5 = 32, not the mandated 64
    expect(() => readCompoundFile(bytes)).toThrow(
      "compound file mini sector shift 2^5 is not the mandated 64-byte mini sector",
    );
  });

  it("accepts a mini stream cutoff exactly at the mini sector size, and rejects one byte below it", () => {
    const atCutoff = compoundFile([{ path: "A", bytes: enc("x") }]);
    new DataView(atCutoff.buffer).setUint32(0x38, 64, true); // exactly the 64-byte mini sector
    expect(() => readCompoundFile(atCutoff)).not.toThrow();

    const belowCutoff = compoundFile([{ path: "A", bytes: enc("x") }]);
    new DataView(belowCutoff.buffer).setUint32(0x38, 63, true);
    expect(() => readCompoundFile(belowCutoff)).toThrow(
      "compound file mini stream cutoff 63 is smaller than the 64-byte mini sector itself",
    );
  });

  it("throws naming the exact sector size when the file holds no complete sector after its header", () => {
    const bytes = compoundFile([{ path: "A", bytes: enc("x") }]).slice(
      0,
      HEADER_BYTES + 100, // less than one whole 512-byte sector past the header
    );
    expect(() => readCompoundFile(bytes)).toThrow(
      "compound file holds no complete 512-byte sector after its header",
    );
  });

  it("accepts a file with exactly one complete sector past the header (sectorCount 1)", () => {
    // Truncating compoundFile([])'s own 3-sector file (FAT, directory, nothing else) to just the header plus its one FAT sector leaves sectorCount === 1 -- the boundary sectorCount < 1 must not reject, so the failure instead comes from the directory chain stepping onto sector 1, which this truncation removed.
    const bytes = compoundFile([]).slice(0, HEADER_BYTES + FAT_SECTOR_BYTES);
    expect(() => readCompoundFile(bytes)).toThrow(
      "a FAT chain steps to sector 1, which is outside the file's 1 sectors",
    );
  });

  it("throws its exact message for a DIFAT chain of exactly one sector that terminates without cycling", () => {
    // A hand-built fixture, not compoundFile()/writeCompoundFile() output: both always keep the DIFAT inside the header's own 109-entry array, so a genuinely chained DIFAT walk of a KNOWN, minimal length has to be built directly. sectorCount is pinned to 1 (one sector past the header) so the chain-walk's own iteration counter reaches its "sectorCount visited" boundary on the very first, legitimate, non-repeating sector -- proving the counter's bound is inclusive of that many sectors, not exclusive.
    const bytes = new Uint8Array(HEADER_BYTES + 512);
    const view = new DataView(bytes.buffer);
    bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
    view.setUint16(0x1a, 3, true); // majorVersion 3
    view.setUint16(0x1c, 0xfffe, true); // byte order
    view.setUint16(0x1e, 9, true); // sectorShift: 512-byte sectors
    view.setUint16(0x20, 6, true); // miniSectorShift: 64-byte mini sectors
    view.setUint32(0x38, 64, true); // miniStreamCutoff, at least the mini sector size
    view.setUint32(0x44, 0, true); // firstDifatSector: sector 0 is the sole chained DIFAT sector
    // The header's own 109-entry DIFAT array: every slot FREESECT, so it contributes no FAT sectors of its own -- every candidate comes from the chained DIFAT sector below.
    for (let i = 0; i < 109; i++) {
      view.setUint32(0x4c + i * 4, 0xffffffff, true);
    }
    // Sector 0, the sole DIFAT sector: its 127 real entries all FREESECT, its own final slot (the next-DIFAT-sector pointer) set to ENDOFCHAIN so the chain is exactly one sector long and terminates cleanly.

    for (let i = 0; i < 127; i++) {
      view.setUint32(HEADER_BYTES + i * 4, 0xffffffff, true);
    }
    view.setUint32(HEADER_BYTES + 127 * 4, 0xfffffffe, true);
    // With no FAT sectors accepted from either source, the walk must reach the "no FAT sectors" check -- which it can only do if the one-sector DIFAT walk above was allowed to complete rather than being rejected as "too many sectors visited".
    expect(() => readCompoundFile(bytes)).toThrow(
      "compound file declares no FAT sectors, so no sector chain can be walked",
    );
  });

  it("names a chained DIFAT sector's own provenance when one of its entries is out of range", () => {
    // Same minimal one-DIFAT-sector fixture as above, except entry 0 of the chained sector names a FAT sector one past the file's own single sector -- proving the thrown message cites "a DIFAT sector", not the header array's own provenance string (already covered by the header-DIFAT-array case elsewhere in this file).
    const bytes = new Uint8Array(HEADER_BYTES + 512);
    const view = new DataView(bytes.buffer);
    bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
    view.setUint16(0x1a, 3, true);
    view.setUint16(0x1c, 0xfffe, true);
    view.setUint16(0x1e, 9, true);
    view.setUint16(0x20, 6, true);
    view.setUint32(0x38, 64, true);
    view.setUint32(0x44, 0, true);
    for (let i = 0; i < 109; i++) {
      view.setUint32(0x4c + i * 4, 0xffffffff, true);
    }

    view.setUint32(HEADER_BYTES, 1, true); // entry 0: sector 1, one past this file's single sector
    for (let i = 1; i < 127; i++) {
      view.setUint32(HEADER_BYTES + i * 4, 0xffffffff, true);
    }
    view.setUint32(HEADER_BYTES + 127 * 4, 0xfffffffe, true);
    expect(() => readCompoundFile(bytes)).toThrow(
      "a DIFAT sector names FAT sector 1, which is outside the file's 1 sectors",
    );
  });

  it("throws naming the exact sector when a FAT chain entry lies beyond the sectors the DIFAT named", () => {
    // The DIFAT names only sector 0 as a FAT sector (a single 512-byte FAT table of 128 entries, valid sector numbers 0-127), but the file itself holds 200 sectors -- large enough that a directory chain starting at sector 128 passes the chain-walk's own file-bounds check yet steps past what the one declared FAT sector can address.
    const totalSectors = 200;
    const bytes = new Uint8Array(HEADER_BYTES + totalSectors * 512);
    const view = new DataView(bytes.buffer);
    bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
    view.setUint16(0x1a, 3, true);
    view.setUint16(0x1c, 0xfffe, true);
    view.setUint16(0x1e, 9, true);
    view.setUint16(0x20, 6, true);
    view.setUint32(0x38, 64, true);
    view.setUint32(0x44, 0xfffffffe, true); // firstDifatSector: none, the header array alone suffices
    view.setUint32(0x4c, 0, true); // header DIFAT[0]: sector 0 is the sole FAT sector
    for (let i = 1; i < 109; i++) {
      view.setUint32(0x4c + i * 4, 0xffffffff, true);
    }
    view.setUint32(0x30, 128, true); // firstDirectorySector: sector 128, past the FAT's own 128-entry coverage
    expect(() => readCompoundFile(bytes)).toThrow(
      "FAT entry for sector 128 lies beyond the sectors the DIFAT named",
    );
  });

  it("accepts a FAT entry read exactly at the declared FAT sectors' own last valid offset", () => {
    // Sector 127 is the very last entry a single 512-byte FAT sector addresses (128 four-byte entries, indices 0-127) -- the boundary offset + 4 > fatBytes.length must not reject it. Its own FAT entry (left as zero from the allocation) reads back as 0, not ENDOFCHAIN, so the chain would loop forever if extended; instead its slot is set to ENDOFCHAIN directly so the chain resolves to one bare sector, whose all-zero directory contents fail a later, distinct check.
    const totalSectors = 200;
    const bytes = new Uint8Array(HEADER_BYTES + totalSectors * 512);
    const view = new DataView(bytes.buffer);
    bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
    view.setUint16(0x1a, 3, true);
    view.setUint16(0x1c, 0xfffe, true);
    view.setUint16(0x1e, 9, true);
    view.setUint16(0x20, 6, true);
    view.setUint32(0x38, 64, true);
    view.setUint32(0x44, 0xfffffffe, true);
    view.setUint32(0x4c, 0, true);
    for (let i = 1; i < 109; i++) {
      view.setUint32(0x4c + i * 4, 0xffffffff, true);
    }
    view.setUint32(0x30, 127, true); // firstDirectorySector: sector 127, the FAT's own last addressable entry
    // Sector 0's own raw bytes double as the FAT table; entry 127 (the directory chain's own continuation) is set to ENDOFCHAIN so the chain is exactly one sector long.
    view.setUint32(HEADER_BYTES + 127 * 4, 0xfffffffe, true);
    expect(() => readCompoundFile(bytes)).toThrow(
      "the first directory entry is not the root storage entry (object type 5), as [MS-CFB] 2.6.1 requires",
    );
  });

  it("throws for a truncated file (sectors the header references are gone)", () => {
    const bytes = compoundFile([{ path: "A", bytes: enc("x".repeat(5000)) }]);
    expectFormatError(bytes.slice(0, 700));
  });

  it("throws naming the header DIFAT array by name, and the exact sector/count, one sector past the file's own total", () => {
    const bytes = compoundFile([{ path: "A", bytes: enc("x".repeat(5000)) }]);
    // This fixture's own file-total sector count (computed the same way the reader itself derives it: whole sectorSize-byte sectors after the header).
    const sectorCount = Math.floor(bytes.length / 512) - 1;
    const view = new DataView(bytes.buffer);
    view.setUint32(0x4c, sectorCount, true); // header DIFAT[0] -> exactly one past the last valid sector
    expect(() => readCompoundFile(bytes)).toThrow(
      `the header DIFAT array names FAT sector ${sectorCount}, which is outside the file's ${sectorCount} sectors`,
    );
  });

  it("throws for a DIFAT chain entry naming a sector outside the file", () => {
    // test-support/cfb.ts's own compoundFile never chains a DIFAT sector (its header comment says so: the DIFAT always fits the header's 109-entry array). Corrupting a DIFAT-chain entry specifically needs a file that genuinely has one, so this reaches for ../cfb/write.ts's writeCompoundFile instead -- not to test a round trip (write.test.ts already does that), but purely as a source of valid DIFAT-chained bytes to corrupt one byte of, exactly like every other case in this block corrupts a compoundFile()-built fixture.
    const payload = new Uint8Array(8 * 1024 * 1024);
    const bytes = writeCompoundFile([{ path: "WordDocument", bytes: payload }]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const sectorShift = view.getUint16(0x1e, true);
    const sectorSize = 1 << sectorShift;
    const firstDifatSector = view.getUint32(0x44, true);
    expect(firstDifatSector).not.toBe(0xfffffffe); // sanity: this fixture really does chain a DIFAT sector
    const sectorCount = Math.floor(bytes.length / sectorSize) - 1;
    const entriesPerDifatSector = sectorSize / 4 - 1;
    // Corrupt the chained DIFAT sector's own final slot -- its next-DIFAT-sector pointer, ENDOFCHAIN in this one-DIFAT-sector fixture -- to point past the file. This is the DIFAT chain-walk's own sector-number check (on the sector named IN the chain), not acceptFatSector's check on an ordinary FAT-index entry within it.
    view.setUint32(
      (firstDifatSector + 1) * sectorSize + entriesPerDifatSector * 4,
      sectorCount,
      true,
    );
    expect(() => readCompoundFile(bytes)).toThrow(
      `the DIFAT chain names sector ${sectorCount}, which is outside the file's ${sectorCount} sectors`,
    );
  });

  it("throws when the DIFAT chain visits more sectors than the file holds", () => {
    // Same rationale as the case above: a genuine DIFAT-chained fixture is needed to corrupt, which only ../cfb/write.ts's writer currently produces.
    const payload = new Uint8Array(8 * 1024 * 1024);
    const bytes = writeCompoundFile([{ path: "WordDocument", bytes: payload }]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const sectorShift = view.getUint16(0x1e, true);
    const sectorSize = 1 << sectorShift;
    const firstDifatSector = view.getUint32(0x44, true);
    const entriesPerDifatSector = sectorSize / 4 - 1;
    // The chained DIFAT sector's own final slot (its own next-DIFAT-sector pointer), corrupted to point back at itself rather than ENDOFCHAIN or a genuinely later sector -- an infinite chain that must trip the visited-sector-count guard rather than looping forever.
    view.setUint32(
      (firstDifatSector + 1) * sectorSize + entriesPerDifatSector * 4,
      firstDifatSector,
      true,
    );
    expect(() => readCompoundFile(bytes)).toThrow(
      "the DIFAT chain visits more sectors than the file holds, so it must cycle",
    );
  });

  it("throws its exact message when every header DIFAT slot is FREESECT and no DIFAT chain names any FAT sector", () => {
    const bytes = compoundFile([{ path: "A", bytes: enc("x") }]);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < 109; i++) {
      view.setUint32(0x4c + i * 4, 0xffffffff, true); // FREESECT
    }
    expect(() => readCompoundFile(bytes)).toThrow(
      "compound file declares no FAT sectors, so no sector chain can be walked",
    );
  });

  it("throws naming the exact sector and count for a FAT chain stepping outside the file", () => {
    const bytes = compoundFile([{ path: "A", bytes: enc("x".repeat(5000)) }]);
    const sectorCount = Math.floor(bytes.length / 512) - 1;
    const view = new DataView(bytes.buffer);
    // The stream's first data sector is sector 2 (FAT at 0, directory at 1); point its own FAT entry one sector past the file's own total.
    view.setUint32(512 + 2 * 4, sectorCount, true);
    expect(() => readCompoundFile(bytes)).toThrow(
      `a FAT chain steps to sector ${sectorCount}, which is outside the file's ${sectorCount} sectors`,
    );
  });

  it("throws naming the exact sector and its role-marker entry for a FAT chain stepping onto a FATSECT/DIFSECT slot", () => {
    const bytes = compoundFile([{ path: "A", bytes: enc("x".repeat(5000)) }]);
    const view = new DataView(bytes.buffer);
    view.setUint32(512 + 2 * 4, 0xfffffffd, true); // FATSECT, not a chain continuation
    expect(() => readCompoundFile(bytes)).toThrow(
      "a FAT chain steps to sector 2's entry 4294967293, which is a sector-role marker, not a chain continuation",
    );
  });

  it("throws for a FAT chain stepping onto a FREESECT slot", () => {
    const bytes = compoundFile([{ path: "A", bytes: enc("x".repeat(5000)) }]);
    const view = new DataView(bytes.buffer);
    view.setUint32(512 + 2 * 4, 0xffffffff, true); // FREESECT, an unused slot, not a chain continuation
    expect(() => readCompoundFile(bytes)).toThrow(
      "a FAT chain steps to sector 2's entry 4294967295, which is a sector-role marker, not a chain continuation",
    );
  });

  it("throws for a FAT chain stepping onto a DIFSECT slot", () => {
    const bytes = compoundFile([{ path: "A", bytes: enc("x".repeat(5000)) }]);
    const view = new DataView(bytes.buffer);
    view.setUint32(512 + 2 * 4, 0xfffffffc, true); // DIFSECT, not a chain continuation
    expect(() => readCompoundFile(bytes)).toThrow(
      "a FAT chain steps to sector 2's entry 4294967292, which is a sector-role marker, not a chain continuation",
    );
  });

  it("throws for a FAT chain that cycles", () => {
    const bytes = compoundFile([{ path: "A", bytes: enc("x".repeat(5000)) }]);
    // The stream's first data sector is sector 2 (FAT at 0, directory at 1); point its FAT entry back at itself so the chain never reaches ENDOFCHAIN.
    const view = new DataView(bytes.buffer);
    view.setUint32(512 + 2 * 4, 2, true);
    expect(() => readCompoundFile(bytes)).toThrow(
      "a FAT chain visits more sectors than the file holds, so it must cycle",
    );
  });

  it("throws its exact message for an empty directory chain", () => {
    // A directory whose own single sector's chain entry is corrupted straight to ENDOFCHAIN, making chainBytes(firstDirectorySector) return zero bytes -- the directory's FAT chain, not its content, is what determines emptiness here.
    const bytes = compoundFile([{ path: "A", bytes: enc("x") }]);
    const view = new DataView(bytes.buffer);
    view.setUint32(0x30, 0xfffffffe, true); // firstDirectorySector := ENDOFCHAIN
    expect(() => readCompoundFile(bytes)).toThrow(
      "compound file has an empty directory chain",
    );
  });

  it("throws its exact message when the first directory entry is not the root storage type", () => {
    const bytes = compoundFile([{ path: "A", bytes: enc("x") }]);
    bytes[entryOffset(0) + 0x42] = 1; // root entry's own object type, corrupted from 5 (root) to 1 (storage)
    expect(() => readCompoundFile(bytes)).toThrow(
      "the first directory entry is not the root storage entry (object type 5), as [MS-CFB] 2.6.1 requires",
    );
  });

  it("throws naming the exact mini sector and count for a mini-FAT chain stepping outside the mini stream", () => {
    const bytes = compoundFile([{ path: "A", bytes: enc("x") }]); // 1 byte -> 1 mini sector
    const view = new DataView(bytes.buffer);
    const miniFatStart = view.getUint32(0x3c, true);
    // Pointed exactly one mini sector past the mini stream's single sector -- the boundary itself, not merely somewhere comfortably out of range, so a >= mutated to > cannot let it through unnoticed.
    view.setUint32((miniFatStart + 1) * 512, 1, true);
    expect(() => readCompoundFile(bytes)).toThrow(
      "a mini-FAT chain steps to mini sector 1, which is outside the mini stream's 1 mini sectors",
    );
  });

  it("throws its exact message for a mini-FAT chain that cycles", () => {
    const bytes = compoundFile([{ path: "A", bytes: enc("x") }]);
    const view = new DataView(bytes.buffer);
    const miniFatStart = view.getUint32(0x3c, true);
    view.setUint32((miniFatStart + 1) * 512, 0, true); // the one mini sector's own entry, pointed back at itself
    expect(() => readCompoundFile(bytes)).toThrow(
      "a mini-FAT chain visits more mini sectors than the mini stream holds, so it must cycle",
    );
  });

  it("throws naming the exact mini sector and its role-marker entry for a mini-FAT chain stepping onto a FATSECT/DIFSECT slot", () => {
    const bytes = compoundFile([{ path: "A", bytes: enc("x") }]);
    const view = new DataView(bytes.buffer);
    const miniFatStart = view.getUint32(0x3c, true);
    view.setUint32((miniFatStart + 1) * 512, 0xfffffffc, true); // DIFSECT
    expect(() => readCompoundFile(bytes)).toThrow(
      "a mini-FAT chain steps to mini sector 0's entry 4294967292, which is a sector-role marker, not a chain continuation",
    );
  });

  it("throws for a mini-FAT chain stepping onto a FREESECT slot", () => {
    const bytes = compoundFile([{ path: "A", bytes: enc("x") }]);
    const view = new DataView(bytes.buffer);
    const miniFatStart = view.getUint32(0x3c, true);
    view.setUint32((miniFatStart + 1) * 512, 0xffffffff, true); // FREESECT
    expect(() => readCompoundFile(bytes)).toThrow(
      "a mini-FAT chain steps to mini sector 0's entry 4294967295, which is a sector-role marker, not a chain continuation",
    );
  });

  it("throws for a mini-FAT chain stepping onto a FATSECT slot", () => {
    const bytes = compoundFile([{ path: "A", bytes: enc("x") }]);
    const view = new DataView(bytes.buffer);
    const miniFatStart = view.getUint32(0x3c, true);
    view.setUint32((miniFatStart + 1) * 512, 0xfffffffd, true); // FATSECT
    expect(() => readCompoundFile(bytes)).toThrow(
      "a mini-FAT chain steps to mini sector 0's entry 4294967293, which is a sector-role marker, not a chain continuation",
    );
  });

  it("throws naming the entry, its declared size, and its chain's real length when the declared size exceeds it", () => {
    const bytes = compoundFile([{ path: "A", bytes: enc("x".repeat(5000)) }]);
    // Entry 1 is the stream; inflate its declared size to a figure no chain in this small file can fill.
    const view = new DataView(bytes.buffer);
    view.setUint32(entryOffset(1) + 0x78, 0x00ffffff, true);
    expect(() => readCompoundFile(bytes)).toThrow(
      "stream 'A' declares 16777215 bytes but its chain holds only",
    );
  });

  it("combines the size field's low and high 32-bit halves by addition and a 2^32 multiplier", () => {
    // A high half of 1 with a zero low half declares exactly 4294967296 bytes (2^32) -- a size only the high half's own *4294967296 term, added to the low half, can produce. Corrupting either the operator (+ to -) or the multiplier (* to /) yields a size so different (negative, or a tiny fraction) that the mini-resident extraction path below it never throws at all, rather than citing this exact figure.
    const bytes = compoundFile([{ path: "A", bytes: enc("x".repeat(5000)) }]);
    const view = new DataView(bytes.buffer);
    view.setUint32(entryOffset(1) + 0x78, 0, true);
    view.setUint32(entryOffset(1) + 0x7c, 1, true);
    expect(() => readCompoundFile(bytes)).toThrow(
      "stream 'A' declares 4294967296 bytes but its chain holds only",
    );
  });

  it("accepts a declared size of exactly Number.MAX_SAFE_INTEGER, rejecting only one byte past it", () => {
    // Number.MAX_SAFE_INTEGER itself must not trip the "beyond the integer range" guard -- the boundary is inclusive -- so this fixture's own tiny chain instead fails the (distinct) declared-size-versus-chain-length check.
    const atLimit = compoundFile([{ path: "A", bytes: enc("x".repeat(5000)) }]);
    const atLimitView = new DataView(atLimit.buffer);
    atLimitView.setUint32(entryOffset(1) + 0x78, 0xffffffff, true);
    atLimitView.setUint32(entryOffset(1) + 0x7c, 2097151, true); // together: exactly Number.MAX_SAFE_INTEGER
    expect(() => readCompoundFile(atLimit)).toThrow(
      "stream 'A' declares 9007199254740991 bytes but its chain holds only",
    );

    const pastLimit = compoundFile([
      { path: "A", bytes: enc("x".repeat(5000)) },
    ]);
    const pastLimitView = new DataView(pastLimit.buffer);
    pastLimitView.setUint32(entryOffset(1) + 0x78, 0, true);
    pastLimitView.setUint32(entryOffset(1) + 0x7c, 2097152, true); // together: Number.MAX_SAFE_INTEGER + 1
    expect(() => readCompoundFile(pastLimit)).toThrow(
      "stream 'A' declares a size beyond the integer range this reader addresses",
    );
  });

  it("extracts a zero-length stream without ever inspecting its own starting sector", () => {
    // [MS-CFB] 2.6.1: a zero-length stream's starting sector is meaningless, so extractStream must return empty without walking anything -- corrupt entry 1's own startSector to a mini sector far outside this 1-mini-sector fixture's single valid one, so a version that DID walk it would throw, while the real early return never gets that far.
    const bytes = compoundFile([{ path: "A", bytes: enc("x") }]);
    const view = new DataView(bytes.buffer);
    view.setUint32(entryOffset(1) + 0x78, 0, true); // size := 0
    view.setUint32(entryOffset(1) + 0x74, 99, true); // startSector := an out-of-range mini sector
    const streams = readCompoundFile(bytes);
    expect(streams).toEqual([{ path: "A", bytes: new Uint8Array(0) }]);
  });

  it("throws naming the exact entry id and directory size when the directory tree links outside the directory's own entries", () => {
    const bytes = compoundFile([{ path: "A", bytes: enc("x") }]);
    // The root's own child link (its sole real entry, id 1) corrupted to name an entry id past this file's directory. entryCount reflects the whole padded 512-byte directory sector (4 entries of 128 bytes each), not just the 2 real ones (root + A), so it is 4, not 2.
    const view = new DataView(bytes.buffer);
    view.setUint32(entryOffset(0) + 0x4c, 9, true);
    expect(() => readCompoundFile(bytes)).toThrow(
      "the directory tree links to entry 9, which is outside the directory's 4 entries",
    );
  });

  it("throws its exact message when the directory tree reaches the same entry twice", () => {
    const bytes = compoundFile([
      { path: "A", bytes: enc("x") },
      { path: "B", bytes: enc("y") },
    ]);
    // A's own right sibling (entry 1's rightId) already names B (entry 2); make B's own right sibling point back at A too, so the tree visits entry 1 a second time.
    const view = new DataView(bytes.buffer);
    view.setUint32(entryOffset(2) + 0x48, 1, true);
    expect(() => readCompoundFile(bytes)).toThrow(
      "the directory tree reaches entry 1 twice, so its sibling and child links cycle",
    );
  });

  it("throws naming the exact entry id and declared name length when it is out of the valid 2-64 even-byte range", () => {
    const bytes = compoundFile([{ path: "A", bytes: enc("x") }]);
    const view = new DataView(bytes.buffer);
    view.setUint16(entryOffset(1) + 0x40, 65, true); // odd, and past 64
    expect(() => readCompoundFile(bytes)).toThrow(
      "directory entry 1 declares name length 65, which is not an even byte count between 2 and 64",
    );
  });

  it.each([
    [0, "below the 2-byte minimum, and even"],
    [1, "below the 2-byte minimum, and odd"],
    [3, "within range, but odd"],
    [63, "within range, but odd"],
    [66, "even, but past the 64-byte maximum"],
  ])("throws for a declared name length of %i (%s)", (nameLength: number) => {
    const bytes = compoundFile([{ path: "A", bytes: enc("x") }]);
    const view = new DataView(bytes.buffer);
    view.setUint16(entryOffset(1) + 0x40, nameLength, true);
    expect(() => readCompoundFile(bytes)).toThrow(
      `directory entry 1 declares name length ${nameLength}, which is not an even byte count between 2 and 64`,
    );
  });

  it("accepts a declared name length of exactly 2 (an empty name) and exactly 64 (a 31-character name)", () => {
    // 2 is the smallest legal name-length field (the terminating null alone, no real characters); 64 is the largest (31 UTF-16 code units plus the null). Both boundaries must be accepted, not rejected alongside the values one step outside them above.
    const empty = compoundFile([{ path: "A", bytes: enc("x") }]);
    new DataView(empty.buffer).setUint16(entryOffset(1) + 0x40, 2, true);
    expect(readCompoundFile(empty).map((s) => s.path)).toEqual([""]);

    const maxName = compoundFile([{ path: "A".repeat(31), bytes: enc("x") }]);
    expect(readCompoundFile(maxName).map((s) => s.path)).toEqual([
      "A".repeat(31),
    ]);
  });

  it("throws naming the exact entry id, name, and object type for an unsupported directory entry type", () => {
    const bytes = compoundFile([{ path: "A", bytes: enc("x") }]);
    bytes[entryOffset(1) + 0x42] = 9; // neither storage (1), stream (2), nor root (5)
    expect(() => readCompoundFile(bytes)).toThrow(
      "directory entry 1 ('A') carries object type 9, which is not a storage (1), stream (2), or root (5) entry",
    );
  });

  it("throws its exact message when the tree reaches a second root-typed (object type 5) entry", () => {
    // Object type 5 passes the descend-stage's own storage/stream/root check (line ~384) unchanged, since ROOT is one of the three types it accepts -- it is only the self-stage's own switch, which explicitly handles STREAM and STORAGE alone, that has no case for a second type-5 entry reached anywhere but the directory's own id-0 slot. A's own name and length stay genuinely valid, so this exercises that check in isolation from the name-length and object-type-acceptance checks above it.
    const bytes = compoundFile([{ path: "A", bytes: enc("x") }]);
    bytes[entryOffset(1) + 0x42] = 5; // A's own object type, corrupted from STREAM (2) to ROOT (5)
    expect(() => readCompoundFile(bytes)).toThrow(
      "the directory tree reaches entry A, which is not a storage or stream entry",
    );
  });

  it("throws for a directory tree whose sibling links cycle", () => {
    const bytes = compoundFile([
      { path: "A", bytes: enc("x".repeat(5000)) },
      { path: "B", bytes: enc("y".repeat(5000)) },
    ]);
    // Entries 1 (A) and 2 (B) are siblings chained 1 -> 2; point B's right sibling back at A.
    const view = new DataView(bytes.buffer);
    view.setUint32(entryOffset(2) + 0x48, 1, true);
    expectFormatError(bytes);
  });

  it("throws naming the exact budget and entry name when the cumulative extracted size exceeds it", () => {
    // Two 5000-byte streams with a 6000-byte budget: the second extraction tips the cumulative total over, so the whole read fails rather than returning a partial listing -- the same stance archive-codec's ZIP walk takes on its guards, and for the same reason (a hostile FAT can alias one sector into many streams, multiplying extraction beyond the file's own size).
    const bytes = compoundFile([
      { path: "A", bytes: enc("x".repeat(5000)) },
      { path: "B", bytes: enc("y".repeat(5000)) },
    ]);
    expect(() => readCompoundFile(bytes, { maxTotalBytes: 6000 })).toThrow(
      "cumulative extracted stream size exceeded the 6000-byte budget at 'B'",
    );
    // The same file under the default budget reads fine -- the guard fires on the budget, not on the structure.
    expect(readCompoundFile(bytes)).toHaveLength(2);
  });

  it("accepts a cumulative extracted size exactly equal to the budget", () => {
    // 5000 bytes twice is exactly 10000 -- the boundary itself must be allowed, not just amounts strictly under it.
    const bytes = compoundFile([
      { path: "A", bytes: enc("x".repeat(5000)) },
      { path: "B", bytes: enc("y".repeat(5000)) },
    ]);
    expect(readCompoundFile(bytes, { maxTotalBytes: 10000 })).toHaveLength(2);
  });
});
