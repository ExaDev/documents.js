import { describe, expect, it } from "vitest";
import { compoundFile } from "../test-support/cfb";
import { CompoundFileFormatError, readCompoundFile } from "./read";

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
  });

  it("needs a second mini FAT sector once the mini stream passes 128 mini sectors", () => {
    const miniSectorsNeeded = 129;
    const inputs = Array.from({ length: miniSectorsNeeded }, (_unused, i) => ({
      path: `M${i}`,
      bytes: new Uint8Array(64), // exactly one mini sector each
    }));
    const bytes = compoundFile(inputs);
    expect(new DataView(bytes.buffer).getUint32(0x40, true)).toBe(2);
    expect(readCompoundFile(bytes)).toHaveLength(miniSectorsNeeded);
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

  it("throws for bytes without the compound-file signature", () => {
    expectFormatError(enc("not a compound file at all"));
  });

  it("throws for input shorter than the 512-byte header", () => {
    expectFormatError(
      new Uint8Array([
        0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00,
      ]),
    );
  });

  it("throws for a header whose sector shift contradicts its major version", () => {
    const bytes = compoundFile([{ path: "A", bytes: enc("x".repeat(5000)) }]);
    bytes[0x1a] = 4; // major version 4 ...
    bytes[0x1e] = 9; // ... still declaring 512-byte sectors, which version 4 forbids
    expectFormatError(bytes);
  });

  it("throws for a big-endian byte-order field", () => {
    const bytes = compoundFile([{ path: "A", bytes: enc("x".repeat(5000)) }]);
    // The field holds FE FF (little-endian 0xFFFE); swapping to FF FE reads as 0xFEFF, the big-endian marker this reader refuses.
    bytes[0x1c] = 0xff;
    bytes[0x1d] = 0xfe;
    expectFormatError(bytes);
  });

  it("throws for a truncated file (sectors the header references are gone)", () => {
    const bytes = compoundFile([{ path: "A", bytes: enc("x".repeat(5000)) }]);
    expectFormatError(bytes.slice(0, 700));
  });

  it("throws for a DIFAT entry naming a sector outside the file", () => {
    const bytes = compoundFile([{ path: "A", bytes: enc("x".repeat(5000)) }]);
    const view = new DataView(bytes.buffer);
    view.setUint32(0x4c, 0x0000ff00, true); // header DIFAT[0] -> far beyond the file's sector count
    expectFormatError(bytes);
  });

  it("throws for a FAT chain that cycles", () => {
    const bytes = compoundFile([{ path: "A", bytes: enc("x".repeat(5000)) }]);
    // The stream's first data sector is sector 2 (FAT at 0, directory at 1); point its FAT entry back at itself so the chain never reaches ENDOFCHAIN.
    const view = new DataView(bytes.buffer);
    view.setUint32(512 + 2 * 4, 2, true);
    expectFormatError(bytes);
  });

  it("throws for a stream whose declared size exceeds its chain", () => {
    const bytes = compoundFile([{ path: "A", bytes: enc("x".repeat(5000)) }]);
    // Entry 1 is the stream; inflate its declared size to a figure no chain in this small file can fill.
    const view = new DataView(bytes.buffer);
    const entryOffset = 512 + 512 + 1 * 128; // header + FAT sector + directory sector, entry 1
    view.setUint32(entryOffset + 0x78, 0x00ffffff, true);
    expectFormatError(bytes);
  });

  it("throws for a directory tree whose sibling links cycle", () => {
    const bytes = compoundFile([
      { path: "A", bytes: enc("x".repeat(5000)) },
      { path: "B", bytes: enc("y".repeat(5000)) },
    ]);
    // Entries 1 (A) and 2 (B) are siblings chained 1 -> 2; point B's right sibling back at A.
    const view = new DataView(bytes.buffer);
    const entryOffset = (id: number) => 512 + 512 + id * 128;
    view.setUint32(entryOffset(2) + 0x48, 1, true);
    expectFormatError(bytes);
  });

  it("throws when the cumulative extracted size exceeds the configured budget", () => {
    // Two 5000-byte streams with a 6000-byte budget: the second extraction tips the cumulative total over, so the whole read fails rather than returning a partial listing -- the same stance archive-codec's ZIP walk takes on its guards, and for the same reason (a hostile FAT can alias one sector into many streams, multiplying extraction beyond the file's own size).
    const bytes = compoundFile([
      { path: "A", bytes: enc("x".repeat(5000)) },
      { path: "B", bytes: enc("y".repeat(5000)) },
    ]);
    expect(() => readCompoundFile(bytes, { maxTotalBytes: 6000 })).toThrow(
      CompoundFileFormatError,
    );
    // The same file under the default budget reads fine -- the guard fires on the budget, not on the structure.
    expect(readCompoundFile(bytes)).toHaveLength(2);
  });
});
