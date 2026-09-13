import { describe, expect, it } from "vitest";
import { type CompoundFileStream, readCompoundFile } from "./read";
import {
  CompoundFileWriteError,
  deepestDepth,
  exceedsVersion3StreamCeiling,
  highSizeWord,
  writeCompoundFile,
} from "./write";

// Coverage for the [MS-CFB] writer (src/cfb/write.ts). Two kinds of check, deliberately kept separate:
//
// 1. Byte-layout assertions derived by hand from the spec's own field tables ([MS-CFB] 2.2 header, 2.3 FAT, 2.4 mini FAT, 2.5 DIFAT, 2.6.1 directory entry), so a header field silently written at the wrong offset or in the wrong endianness fails here rather than surviving because this package's own reader happens to make the same mistake.
// 2. Round trips through readCompoundFile, which is the real correctness proof for anything structural: chains, the mini stream, nested storages, and the DIFAT chain are all things a hand-checked byte dump cannot practically cover.
//
// The red-black invariants get their own directory-parsing check, because they are the one part of the format where a wrong-but-plausible answer (insertion order, or an unbalanced right-spine chain) reads back perfectly through a structural reader and is still rejected by a reader that validates the tree.

const enc = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);

const stream = (
  path: string,
  bytes: Uint8Array<ArrayBuffer>,
): CompoundFileStream => ({ path, bytes });

const u16 = (bytes: Uint8Array<ArrayBuffer>, offset: number): number =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(
    offset,
    true,
  );

const u32 = (bytes: Uint8Array<ArrayBuffer>, offset: number): number =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    offset,
    true,
  );

const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const FATSECT = 0xfffffffd;
const DIFSECT = 0xfffffffc;
const NOSTREAM = 0xffffffff;

// Byte-for-byte comparison that reports the first differing index rather than dumping megabytes into the failure message, for the multi-megabyte fixtures the FAT- and DIFAT-growth tests need.
function firstDifference(
  actual: Uint8Array<ArrayBuffer>,
  expected: Uint8Array<ArrayBuffer>,
): number {
  if (actual.length !== expected.length) {
    return Math.min(actual.length, expected.length);
  }
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i]) {
      return i;
    }
  }
  return -1;
}

function expectSameBytes(
  actual: Uint8Array<ArrayBuffer> | undefined,
  expected: Uint8Array<ArrayBuffer>,
): void {
  expect(actual?.length).toBe(expected.length);
  expect(firstDifference(actual ?? new Uint8Array(0), expected)).toBe(-1);
}

interface ParsedDirectoryEntry {
  readonly id: number;
  readonly name: string;
  readonly nameLength: number;
  readonly objectType: number;
  readonly colour: number;
  readonly left: number;
  readonly right: number;
  readonly child: number;
  readonly startSector: number;
  readonly size: number;
}

// An independent directory reader for the invariant checks below: header -> header DIFAT -> FAT -> directory chain. Deliberately not readCompoundFile, which returns extracted streams and discards the entry links, colours, and sibling structure this file exists to assert on. Only the header's own 109 DIFAT entries are followed, which covers every fixture here that inspects entries.
function parseDirectory(
  bytes: Uint8Array<ArrayBuffer>,
): ParsedDirectoryEntry[] {
  const sectorSize = 1 << u16(bytes, 0x1e);
  const sectorAt = (sector: number): number => (sector + 1) * sectorSize;
  const fatSectorCount = u32(bytes, 0x2c);
  const fatSectors: number[] = [];
  for (let i = 0; i < Math.min(fatSectorCount, 109); i++) {
    fatSectors.push(u32(bytes, 0x4c + i * 4));
  }
  const fatEntry = (sector: number): number => {
    const perSector = sectorSize / 4;
    const holder = fatSectors[Math.floor(sector / perSector)];
    if (holder === undefined) {
      throw new Error(
        `test directory parse: no FAT sector holds the entry for sector ${sector}`,
      );
    }
    return u32(bytes, sectorAt(holder) + (sector % perSector) * 4);
  };

  const directory: number[] = [];
  for (
    let sector = u32(bytes, 0x30);
    sector !== ENDOFCHAIN;
    sector = fatEntry(sector)
  ) {
    directory.push(sector);
    if (directory.length > 1024) {
      throw new Error(
        "test directory parse: directory chain did not terminate",
      );
    }
  }

  const entries: ParsedDirectoryEntry[] = [];
  const perDirectorySector = sectorSize / 128;
  for (let i = 0; i < directory.length; i++) {
    const sector = directory[i] ?? 0;
    for (let slot = 0; slot < perDirectorySector; slot++) {
      const base = sectorAt(sector) + slot * 128;
      const nameLength = u16(bytes, base + 0x40);
      entries.push({
        id: i * perDirectorySector + slot,
        name: new TextDecoder("utf-16le").decode(
          bytes.subarray(base, base + Math.max(0, nameLength - 2)),
        ),
        nameLength,
        objectType: bytes[base + 0x42] ?? 0,
        colour: bytes[base + 0x43] ?? 0,
        left: u32(bytes, base + 0x44),
        right: u32(bytes, base + 0x48),
        child: u32(bytes, base + 0x4c),
        startSector: u32(bytes, base + 0x74),
        size: u32(bytes, base + 0x78) + u32(bytes, base + 0x7c) * 4294967296,
      });
    }
  }
  return entries;
}

// The [MS-CFB] 2.6.4 sorting relationship, restated independently of the implementation: a shorter name is less than a longer one, and equal-length names compare by uppercased UTF-16 code point. Every name in these fixtures is ASCII, so the uppercase mapping here is the plain one.
function compareNamesForTest(a: string, b: string): number {
  if (a.length !== b.length) {
    return a.length - b.length;
  }
  const ua = a.toUpperCase();
  const ub = b.toUpperCase();
  return ua < ub ? -1 : ua > ub ? 1 : 0;
}

// Asserts every [MS-CFB] 2.6.4 constraint over one storage's sibling tree, plus the black-height property a red-black tree carries by definition, and returns the tree's black height so a caller can recurse into child storages.
function expectRedBlackTree(
  entries: readonly ParsedDirectoryEntry[],
  rootId: number,
): void {
  const entryOf = (id: number): ParsedDirectoryEntry => {
    const entry = entries[id];
    if (entry === undefined) {
      throw new Error(
        `sibling tree links to entry ${id}, which the directory does not hold`,
      );
    }
    return entry;
  };

  if (rootId === NOSTREAM) {
    return;
  }
  // Constraint 1: the top of each sibling tree is black.
  expect(entryOf(rootId).colour).toBe(1);

  const blackHeight = (id: number, parentColour: number): number => {
    if (id === NOSTREAM) {
      return 1;
    }
    const entry = entryOf(id);
    expect(entry.colour === 0 || entry.colour === 1).toBe(true);
    // Constraint 2: two consecutive nodes must not both be red.
    if (entry.colour === 0) {
      expect(parentColour).toBe(1);
    }
    // Constraint 3: the left sibling is less than the right sibling, which over the whole tree means it is a genuine binary search tree under the spec's ordering.
    if (entry.left !== NOSTREAM) {
      expect(
        compareNamesForTest(entryOf(entry.left).name, entry.name),
      ).toBeLessThan(0);
    }
    if (entry.right !== NOSTREAM) {
      expect(
        compareNamesForTest(entryOf(entry.right).name, entry.name),
      ).toBeGreaterThan(0);
    }
    const left = blackHeight(entry.left, entry.colour);
    const right = blackHeight(entry.right, entry.colour);
    // Every path from a node down to a leaf holds the same number of black nodes -- the defining red-black property, and the one a chain of right siblings (the naive "sorted linked list" shape) fails.
    expect(left).toBe(right);
    return left + (entry.colour === 1 ? 1 : 0);
  };
  blackHeight(rootId, 1);
}

describe("writeCompoundFile header and sector layout", () => {
  // One 5-byte stream: small enough for the mini stream, so the file is the minimal shape that still exercises every structure -- header, one FAT sector, one directory sector, the mini stream, and the mini FAT. Every expectation below is derived from the spec's field tables, then checked against the layout this writer commits to: sector 0 FAT, sector 1 directory, sector 2 mini stream, sector 3 mini FAT.
  const minimal = writeCompoundFile([stream("Foo", enc("hello"))]);

  it("writes the header signature, CLSID, versions, and byte order [MS-CFB] 2.2", () => {
    expect([...minimal.subarray(0, 8)]).toEqual([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
    ]);
    // Header CLSID MUST be all zeroes (CLSID_NULL).
    expect([...minimal.subarray(0x08, 0x18)]).toEqual(
      Array.from({ length: 16 }, () => 0),
    );
    expect(u16(minimal, 0x18)).toBe(0x003e); // minor version, SHOULD be 0x003E for major 3 or 4
    expect(u16(minimal, 0x1a)).toBe(3);
    expect(u16(minimal, 0x1c)).toBe(0xfffe); // byte order mark: little-endian
    expect(u16(minimal, 0x1e)).toBe(9); // sector shift: 2^9 = 512, mandated for major version 3
    expect(u16(minimal, 0x20)).toBe(6); // mini sector shift: 2^6 = 64
    // Reserved (6 bytes) MUST be all zeroes.
    expect([...minimal.subarray(0x22, 0x28)]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("writes the sector-count and location fields the minimal file's layout implies", () => {
    expect(u32(minimal, 0x28)).toBe(0); // number of directory sectors MUST be zero for major version 3
    expect(u32(minimal, 0x2c)).toBe(1); // one FAT sector maps all four sectors of this file
    expect(u32(minimal, 0x30)).toBe(1); // first directory sector
    expect(u32(minimal, 0x34)).toBe(0); // transaction signature number, zero with no transaction support
    expect(u32(minimal, 0x38)).toBe(0x1000); // mini stream cutoff MUST be 0x00001000
    expect(u32(minimal, 0x3c)).toBe(3); // first mini FAT sector
    expect(u32(minimal, 0x40)).toBe(1); // one mini FAT sector
    expect(u32(minimal, 0x44)).toBe(ENDOFCHAIN); // no DIFAT sector is needed, so the chain is empty
    expect(u32(minimal, 0x48)).toBe(0);
  });

  it("writes the header DIFAT array: the FAT sector locations in order, then FREESECT padding", () => {
    expect(u32(minimal, 0x4c)).toBe(0);
    for (let i = 1; i < 109; i++) {
      expect(u32(minimal, 0x4c + i * 4)).toBe(FREESECT);
    }
  });

  it("sizes the file at one header sector plus its sectors, and lays the sectors out contiguously", () => {
    // Sector N occupies bytes [(N + 1) * sectorSize, (N + 2) * sectorSize) ([MS-CFB] 2.3), so a four-sector version 3 file is 5 * 512 bytes.
    expect(minimal.length).toBe(512 * 5);
  });

  it("marks the FAT sector as FATSECT and terminates every one-sector chain [MS-CFB] 2.3", () => {
    const fat = 512;
    expect(u32(minimal, fat + 0 * 4)).toBe(FATSECT); // sector 0 holds the FAT itself
    expect(u32(minimal, fat + 1 * 4)).toBe(ENDOFCHAIN); // directory
    expect(u32(minimal, fat + 2 * 4)).toBe(ENDOFCHAIN); // mini stream
    expect(u32(minimal, fat + 3 * 4)).toBe(ENDOFCHAIN); // mini FAT
    // Entries covering past the end of the file MUST be FREESECT.
    for (let i = 4; i < 128; i++) {
      expect(u32(minimal, fat + i * 4)).toBe(FREESECT);
    }
  });

  it("writes the root directory entry per [MS-CFB] 2.6.1/2.6.2", () => {
    const root = 512 * 2;
    expect(
      new TextDecoder("utf-16le").decode(minimal.subarray(root, root + 20)),
    ).toBe("Root Entry");
    expect(u16(minimal, root + 0x40)).toBe(22); // 10 code points plus the terminating null, doubled
    expect(minimal[root + 0x42]).toBe(5); // root storage object
    expect(minimal[root + 0x43]).toBe(1); // the root storage object MUST always be black
    expect(u32(minimal, root + 0x44)).toBe(NOSTREAM);
    expect(u32(minimal, root + 0x48)).toBe(NOSTREAM);
    expect(u32(minimal, root + 0x4c)).toBe(1); // its only child is the sole stream entry
    expect([...minimal.subarray(root + 0x50, root + 0x60)]).toEqual(
      Array.from({ length: 16 }, () => 0),
    ); // CLSID
    expect(u32(minimal, root + 0x60)).toBe(0); // state bits
    expect([...minimal.subarray(root + 0x64, root + 0x74)]).toEqual(
      Array.from({ length: 16 }, () => 0),
    ); // creation and modified time MUST be zero for the root
    expect(u32(minimal, root + 0x74)).toBe(2); // the mini stream's first sector
    expect(u32(minimal, root + 0x78)).toBe(64); // the mini stream is one 64-byte mini sector long
    expect(u32(minimal, root + 0x7c)).toBe(0);
  });

  it("writes the stream directory entry, mini-resident because it is under the cutoff", () => {
    const entry = 512 * 2 + 128;
    expect(
      new TextDecoder("utf-16le").decode(minimal.subarray(entry, entry + 6)),
    ).toBe("Foo");
    expect(u16(minimal, entry + 0x40)).toBe(8);
    expect(minimal[entry + 0x42]).toBe(2); // stream object
    expect(u32(minimal, entry + 0x44)).toBe(NOSTREAM);
    expect(u32(minimal, entry + 0x48)).toBe(NOSTREAM);
    expect(u32(minimal, entry + 0x4c)).toBe(NOSTREAM); // a stream entry MUST have no child
    expect(u32(minimal, entry + 0x74)).toBe(0); // mini sector 0 of the mini stream
    expect(u32(minimal, entry + 0x78)).toBe(5);
    expect(u32(minimal, entry + 0x7c)).toBe(0);
  });

  it("writes the unallocated directory entries padding the sector as object type 0 with NOSTREAM links", () => {
    for (const slot of [2, 3]) {
      const base = 512 * 2 + slot * 128;
      expect(u16(minimal, base + 0x40)).toBe(0);
      expect(minimal[base + 0x42]).toBe(0); // unknown or unallocated
      expect(u32(minimal, base + 0x44)).toBe(NOSTREAM);
      expect(u32(minimal, base + 0x48)).toBe(NOSTREAM);
      expect(u32(minimal, base + 0x4c)).toBe(NOSTREAM);
    }
  });

  it("stores the small stream in the mini stream, zero-padded to a whole mini sector, chained by the mini FAT", () => {
    const miniStream = 512 * 3;
    expect([...minimal.subarray(miniStream, miniStream + 5)]).toEqual([
      ...enc("hello"),
    ]);
    expect([...minimal.subarray(miniStream + 5, miniStream + 64)]).toEqual(
      Array.from({ length: 59 }, () => 0),
    );
    const miniFat = 512 * 4;
    expect(u32(minimal, miniFat)).toBe(ENDOFCHAIN);
    for (let i = 1; i < 128; i++) {
      expect(u32(minimal, miniFat + i * 4)).toBe(FREESECT);
    }
  });

  it("zero-pads a version 4 header out to its full 4096-byte sector [MS-CFB] 2.2", () => {
    const bytes = writeCompoundFile([stream("Foo", enc("hello"))], {
      majorVersion: 4,
    });
    expect(u16(bytes, 0x1a)).toBe(4);
    expect(u16(bytes, 0x1e)).toBe(12); // sector shift: 2^12 = 4096, mandated for major version 4
    expect(u32(bytes, 0x28)).toBe(1); // the directory-sector count is carried for version 4, unlike version 3
    expect([...bytes.subarray(512, 4096)]).toEqual(
      Array.from({ length: 3584 }, () => 0),
    );
    expect(bytes.length % 4096).toBe(0);
  });
});

describe("writeCompoundFile round-trips through readCompoundFile", () => {
  it("round-trips a mini-stream-resident stream shorter than the cutoff", () => {
    const payload = enc("a small stream");
    const streams = readCompoundFile(
      writeCompoundFile([stream("Small", payload)]),
    );
    expect(streams.map((s) => s.path)).toEqual(["Small"]);
    expectSameBytes(streams[0]?.bytes, payload);
  });

  it("round-trips a FAT-resident stream at exactly the cutoff", () => {
    // 4096 is >= the cutoff, so the stream is allocated from the FAT rather than the mini FAT ([MS-CFB] 2.2) -- the exact boundary the comparison has to get right.
    const payload = enc("B".repeat(4096));
    const streams = readCompoundFile(
      writeCompoundFile([stream("AtCutoff", payload)]),
    );
    expectSameBytes(streams[0]?.bytes, payload);
  });

  it("round-trips a FAT-resident stream whose size is not a whole multiple of the sector size", () => {
    const payload = enc("C".repeat(5000));
    const streams = readCompoundFile(
      writeCompoundFile([stream("Ragged", payload)]),
    );
    expectSameBytes(streams[0]?.bytes, payload);
  });

  it("round-trips a zero-length stream", () => {
    const streams = readCompoundFile(
      writeCompoundFile([
        stream("Empty", new Uint8Array(0)),
        stream("Other", enc("x")),
      ]),
    );
    expect(streams.map((s) => s.path)).toEqual(["Empty", "Other"]);
    expect(streams[0]?.bytes.length).toBe(0);
  });

  it("round-trips a file holding no streams at all", () => {
    const bytes = writeCompoundFile([]);
    expect(readCompoundFile(bytes)).toEqual([]);
    expect(u32(bytes, 0x3c)).toBe(ENDOFCHAIN); // no mini FAT is required when no stream is mini-resident
    expect(u32(bytes, 512 * 2 + 0x74)).toBe(ENDOFCHAIN); // ... and the root entry's own starting sector says the same
  });

  it("round-trips the mix of mini- and FAT-resident streams the four binary-format codecs actually write", () => {
    // The real shape: one large content stream plus a small companion. 'Current User' is a few dozen bytes in a genuine .ppt, so the mini path is not a corner case for these consumers -- it is the normal case for half their streams.
    const document = enc("D".repeat(20000));
    const currentUser = enc("E".repeat(48));
    const table = enc("F".repeat(9000));
    const streams = readCompoundFile(
      writeCompoundFile([
        stream("PowerPoint Document", document),
        stream("Current User", currentUser),
        stream("1Table", table),
      ]),
    );
    expectSameBytes(
      streams.find((s) => s.path === "PowerPoint Document")?.bytes,
      document,
    );
    expectSameBytes(
      streams.find((s) => s.path === "Current User")?.bytes,
      currentUser,
    );
    expectSameBytes(streams.find((s) => s.path === "1Table")?.bytes, table);
  });

  it("round-trips streams nested inside storages, at more than one level", () => {
    const inner = enc("nested payload");
    const streams = readCompoundFile(
      writeCompoundFile([
        stream("ObjectPool/_1234/Package", inner),
        stream("ObjectPool/_1234/CompObj", enc("compobj")),
        stream("WordDocument", enc("G".repeat(6000))),
      ]),
    );
    expect(streams.map((s) => s.path).sort()).toEqual([
      "ObjectPool/_1234/CompObj",
      "ObjectPool/_1234/Package",
      "WordDocument",
    ]);
    expectSameBytes(
      streams.find((s) => s.path === "ObjectPool/_1234/Package")?.bytes,
      inner,
    );
  });

  it("round-trips every stream of a file needing several directory sectors", () => {
    // 40 entries at 4 per 512-byte directory sector needs 10 chained directory sectors, and 40 siblings make the red-black tree several levels deep.
    const inputs = Array.from({ length: 40 }, (_unused, index) =>
      stream(`Stream${index}`, enc(`payload ${index}`.repeat(index + 1))),
    );
    const streams = readCompoundFile(writeCompoundFile(inputs));
    expect(streams).toHaveLength(40);
    for (const input of inputs) {
      expectSameBytes(
        streams.find((s) => s.path === input.path)?.bytes,
        input.bytes,
      );
    }
  });

  it("round-trips a stream large enough to need several FAT sectors", () => {
    // A 512-byte sector's FAT maps 128 sectors, i.e. 64 KiB of file, so a 300 KiB stream forces the FAT itself to span several sectors and to reach its own fixed point against the total sector count.
    const payload = new Uint8Array(300 * 1024);
    for (let i = 0; i < payload.length; i++) {
      payload[i] = (i * 31 + 7) & 0xff;
    }
    const bytes = writeCompoundFile([stream("Workbook", payload)]);
    expect(u32(bytes, 0x2c)).toBeGreaterThan(1);
    expectSameBytes(readCompoundFile(bytes)[0]?.bytes, payload);
  });

  it("round-trips a file large enough to need a DIFAT sector chain", () => {
    // The header's own DIFAT array holds 109 FAT sector locations, each FAT sector mapping 128 sectors of 512 bytes: 6.875 MiB ([MS-CFB] 2.5). A stream past that forces the writer to spill into chained DIFAT sectors, which is squarely inside the size range a real .doc or .xls reaches.
    const payload = new Uint8Array(8 * 1024 * 1024);
    for (let i = 0; i < payload.length; i++) {
      payload[i] = (i * 17 + 3) & 0xff;
    }
    const bytes = writeCompoundFile([stream("WordDocument", payload)]);
    expect(u32(bytes, 0x2c)).toBeGreaterThan(109); // more FAT sectors than the header array can name
    expect(u32(bytes, 0x48)).toBeGreaterThan(0); // ... so DIFAT sectors exist
    expect(u32(bytes, 0x44)).not.toBe(ENDOFCHAIN); // ... and the header names the first of them
    const streams = readCompoundFile(bytes);
    expectSameBytes(streams[0]?.bytes, payload);
  });

  it("marks DIFAT sectors as DIFSECT in the FAT rather than chaining them there [MS-CFB] 2.5", () => {
    const payload = new Uint8Array(8 * 1024 * 1024);
    const bytes = writeCompoundFile([stream("WordDocument", payload)]);
    const fatSectorCount = u32(bytes, 0x2c);
    const difatSector = u32(bytes, 0x44);
    // The FAT is contiguous from sector 0 in this writer's layout, so the FAT entry describing the first DIFAT sector sits in the FAT sector holding index difatSector.
    const holder = u32(bytes, 0x4c + Math.floor(difatSector / 128) * 4);
    expect(u32(bytes, (holder + 1) * 512 + (difatSector % 128) * 4)).toBe(
      DIFSECT,
    );
    expect(u32(bytes, 512 + 0 * 4)).toBe(FATSECT);
    expect(fatSectorCount).toBeGreaterThan(109);
  });

  it("round-trips a version 4 file, mini and FAT paths both", () => {
    const small = enc("small under the cutoff");
    const large = enc("H".repeat(20000));
    const streams = readCompoundFile(
      writeCompoundFile([stream("Large", large), stream("Small", small)], {
        majorVersion: 4,
      }),
    );
    expectSameBytes(streams.find((s) => s.path === "Small")?.bytes, small);
    expectSameBytes(streams.find((s) => s.path === "Large")?.bytes, large);
  });

  it("re-writes what it read, byte-identically, so read -> write -> read is a fixed point", () => {
    const original = writeCompoundFile([
      stream("Workbook", enc("I".repeat(9000))),
      stream("Storage/Inner", enc("inner")),
      stream("Current User", enc("J".repeat(40))),
    ]);
    const rewritten = writeCompoundFile(readCompoundFile(original));
    expect(firstDifference(rewritten, original)).toBe(-1);
  });

  it("emits identical bytes regardless of the order the streams are supplied in", () => {
    // The directory's order is the format's own name ordering, not the caller's, so two callers building the same file from differently ordered lists must not produce different bytes.
    const a = writeCompoundFile([
      stream("Zeta", enc("z")),
      stream("Alpha", enc("a")),
      stream("Beta", enc("b")),
    ]);
    const b = writeCompoundFile([
      stream("Beta", enc("b")),
      stream("Zeta", enc("z")),
      stream("Alpha", enc("a")),
    ]);
    expect(firstDifference(a, b)).toBe(-1);
  });
});

describe("writeCompoundFile directory red-black trees [MS-CFB] 2.6.4", () => {
  it("orders siblings by name length first, then by uppercased code point", () => {
    // 'Z' and 'B' are both one code point, so they compare by character; 'AA' is longer and therefore greater than both, even though 'A' < 'B' < 'Z' alphabetically. readCompoundFile walks the tree in order, so its output order is the tree's own sorted order.
    const streams = readCompoundFile(
      writeCompoundFile([
        stream("AA", enc("1")),
        stream("Z", enc("2")),
        stream("B", enc("3")),
      ]),
    );
    expect(streams.map((s) => s.path)).toEqual(["B", "Z", "AA"]);
  });

  it("treats names differing only in case as the same sibling, and rejects the collision", () => {
    expect(() =>
      writeCompoundFile([stream("Table", enc("1")), stream("TABLE", enc("2"))]),
    ).toThrow(CompoundFileWriteError);
  });

  it("satisfies every red-black constraint, including black height, for a large sibling set", () => {
    const inputs = Array.from({ length: 63 }, (_unused, index) =>
      stream(`Entry${index}`, enc(`v${index}`)),
    );
    const entries = parseDirectory(writeCompoundFile(inputs));
    const root = entries[0];
    expect(root?.objectType).toBe(5);
    expect(root?.colour).toBe(1);
    expectRedBlackTree(entries, root?.child ?? NOSTREAM);
  });

  it("satisfies the red-black constraints for every storage's own sibling set, not just the root's", () => {
    const inputs = [
      ...Array.from({ length: 17 }, (_unused, index) =>
        stream(`Pool/Item${index}`, enc(`p${index}`)),
      ),
      ...Array.from({ length: 9 }, (_unused, index) =>
        stream(`Top${index}`, enc(`t${index}`)),
      ),
    ];
    const entries = parseDirectory(writeCompoundFile(inputs));
    for (const entry of entries) {
      if (entry.objectType === 1 || entry.objectType === 5) {
        expectRedBlackTree(entries, entry.child);
      }
    }
  });

  it("gives a lone sibling a black node rather than a red root", () => {
    const entries = parseDirectory(
      writeCompoundFile([stream("Only", enc("x"))]),
    );
    expect(entries[1]?.colour).toBe(1);
    expect(entries[1]?.left).toBe(NOSTREAM);
    expect(entries[1]?.right).toBe(NOSTREAM);
  });

  it("writes storage entries with a zeroed starting sector and size, as [MS-CFB] 2.6.1 requires", () => {
    const entries = parseDirectory(
      writeCompoundFile([stream("Pool/Inner", enc("x"))]),
    );
    const storage = entries.find((entry) => entry.objectType === 1);
    expect(storage?.name).toBe("Pool");
    expect(storage?.startSector).toBe(0);
    expect(storage?.size).toBe(0);
  });
});

describe("writeCompoundFile input validation", () => {
  it("rejects a name holding one of the characters [MS-CFB] 2.6.1 forbids", () => {
    for (const name of ["back\\slash", "colon:name", "bang!name"]) {
      expect(() => writeCompoundFile([stream(name, enc("x"))])).toThrow(
        CompoundFileWriteError,
      );
    }
  });

  it("accepts the control-prefixed names the office binary formats genuinely use", () => {
    // '\x05SummaryInformation' and '\x01CompObj' are real stream names; only '/', '\\', ':' and '!' are forbidden, so a reserved-range prefix must pass through untouched.
    const name = "SummaryInformation";
    const streams = readCompoundFile(
      writeCompoundFile([stream(name, enc("summary"))]),
    );
    expect(streams.map((s) => s.path)).toEqual([name]);
  });

  it("rejects a name longer than the 32 code points the directory entry holds", () => {
    const name = "N".repeat(32);
    expect(() => writeCompoundFile([stream(name, enc("x"))])).toThrow(
      `'${name}' is 32 UTF-16 code points, more than the 31 a directory entry's name field holds alongside its terminating null (in stream path ${JSON.stringify(name)})`,
    );
    expect(() =>
      writeCompoundFile([stream("N".repeat(31), enc("x"))]),
    ).not.toThrow();
  });

  it("rejects an empty path or an empty path segment", () => {
    for (const path of ["", "/Leading", "Trailing/", "Double//Segment"]) {
      expect(() => writeCompoundFile([stream(path, enc("x"))])).toThrow(
        `stream path ${JSON.stringify(path)} has an empty name segment; every segment must name a storage, and the last must name the stream`,
      );
    }
  });

  it("rejects the same path supplied twice", () => {
    expect(() =>
      writeCompoundFile([stream("Dup", enc("1")), stream("Dup", enc("2"))]),
    ).toThrow(
      `stream path "Dup" collides with 'Dup', which the file already holds in the same storage ([MS-CFB] 2.6.4 requires siblings to have unique names)`,
    );
  });

  it("rejects a path that needs one name to be both a storage and a stream", () => {
    expect(() =>
      writeCompoundFile([
        stream("Thing", enc("1")),
        stream("Thing/Inner", enc("2")),
      ]),
    ).toThrow(
      `stream path "Thing/Inner" needs 'Thing' to be a storage, but the file already holds a stream by that name`,
    );
    expect(() =>
      writeCompoundFile([
        stream("Thing/Inner", enc("2")),
        stream("Thing", enc("1")),
      ]),
    ).toThrow(CompoundFileWriteError);
  });

  it("names the offending path in the error it throws", () => {
    expect(() => writeCompoundFile([stream("bad:name", enc("x"))])).toThrow(
      /bad:name/,
    );
  });

  it("names every thrown error CompoundFileWriteError, not merely an instance of it", () => {
    let caught: unknown;
    try {
      writeCompoundFile([stream("bad:name", enc("x"))]);
    } catch (error) {
      caught = error;
    }
    expect((caught as Error).name).toBe("CompoundFileWriteError");
  });

  it("rejects a version 3 stream one byte past the 0x80000000 ceiling, naming its exact size", () => {
    // A real allocation, not a mock: V8 zero-fills a fresh Uint8Array lazily, so this is a fast, cheap way to prove the boundary and its thrown message against the writer's actual real input type, not a stand-in for it.
    const oversized = new Uint8Array(0x80000000 + 1);
    expect(() => writeCompoundFile([stream("Big", oversized)])).toThrow(
      'stream "Big" is 2147483649 bytes, past the 2147483648-byte ceiling [MS-CFB] 2.6.1 puts on a version 3 stream; write the file as version 4 instead',
    );
  });
});

describe("exceedsVersion3StreamCeiling", () => {
  it("is false for a version 3 stream at or under the ceiling", () => {
    expect(exceedsVersion3StreamCeiling(3, 0x80000000)).toBe(false);
    expect(exceedsVersion3StreamCeiling(3, 0)).toBe(false);
  });

  it("is true for a version 3 stream one byte past the ceiling", () => {
    expect(exceedsVersion3StreamCeiling(3, 0x80000001)).toBe(true);
  });

  it("is always false for version 4, whatever the byte length", () => {
    expect(exceedsVersion3StreamCeiling(4, 0x80000001)).toBe(false);
    expect(exceedsVersion3StreamCeiling(4, Number.MAX_SAFE_INTEGER)).toBe(
      false,
    );
  });
});

describe("highSizeWord", () => {
  it("is 0 for any size under 2^32", () => {
    expect(highSizeWord(0)).toBe(0);
    expect(highSizeWord(4294967295)).toBe(0);
  });

  it("divides by 2^32 and floors, not multiplies, for a size at and past the boundary", () => {
    expect(highSizeWord(4294967296)).toBe(1); // exactly 2^32
    expect(highSizeWord(4294967296 * 2 + 500)).toBe(2); // past it, with a nonzero low remainder
  });
});

describe("deepestDepth", () => {
  it("is 0 for a count of 0 or 1", () => {
    expect(deepestDepth(0)).toBe(0);
    expect(deepestDepth(1)).toBe(0);
  });

  it("is floor(log2(count)) for every count up to a few levels deep", () => {
    expect(deepestDepth(2)).toBe(1);
    expect(deepestDepth(3)).toBe(1);
    expect(deepestDepth(4)).toBe(2);
    expect(deepestDepth(7)).toBe(2);
    expect(deepestDepth(8)).toBe(3);
    expect(deepestDepth(63)).toBe(5);
    expect(deepestDepth(64)).toBe(6);
  });
});

describe("writeCompoundFile sibling-name case mapping", () => {
  it("sorts by the simple (single-code-point) uppercase mapping, not the lowercase one", () => {
    // The Kelvin sign (U+212A) uppercases to itself (0x212A) but lowercases to plain 'k' (0x6B) -- verified directly against V8's own Intl-backed toUpperCase/toLowerCase. Comparing it against 'L' (0x4C upper, 0x6C lower) gives opposite orderings under the two mappings: uppercase puts the Kelvin sign after 'L' (0x212A > 0x4C), lowercase would put it before (0x6B < 0x6C).
    const streams = readCompoundFile(
      writeCompoundFile([stream("L", enc("1")), stream("K", enc("2"))]),
    );
    expect(streams.map((s) => s.path)).toEqual(["L", "K"]);
  });

  it("leaves a code unit whose simple uppercase mapping expands to more than one character unchanged, rather than taking the expansion's first character", () => {
    // 'ß' (U+00DF) uppercases to the two-character string "SS" under JS's FULL case mapping; [MS-CFB] 2.6.4's own SIMPLE (single-code-point) mapping leaves such a code unit as itself (0xDF) instead. Compared against 'T' (0x54 upper): the real, unexpanded 0xDF sorts after 'T', but the expansion's first character 'S' (0x53) would sort before it.
    const streams = readCompoundFile(
      writeCompoundFile([stream("T", enc("1")), stream("ß", enc("2"))]),
    );
    expect(streams.map((s) => s.path)).toEqual(["T", "ß"]);
  });
});

describe("writeCompoundFile mini-stream sector allocation", () => {
  it("writes ENDOFCHAIN as a zero-length entry's own starting sector, not a mini-stream offset", () => {
    const entries = parseDirectory(
      writeCompoundFile([stream("Empty", new Uint8Array(0))]),
    );
    const entry = entries.find((e) => e.name === "Empty");
    expect(entry?.startSector).toBe(ENDOFCHAIN);
  });

  it("allocates each mini-resident stream's own starting mini sector sequentially, by its own byte length divided by the 64-byte mini sector, not multiplied by it", () => {
    // Three same-length names (so [MS-CFB] 2.6.4's length-first ordering leaves them in plain alphabetical, i.e. insertion, order) whose mini-sector counts (ceil(length / 64)) are each individually distinguishable: 1, 2, and 1 mini sectors. A multiplication instead of division would inflate the running total by orders of magnitude after the very first stream, corrupting every later stream's own starting mini sector.
    const entries = parseDirectory(
      writeCompoundFile([
        stream("Aaa", new Uint8Array(30)), // ceil(30/64) = 1 mini sector
        stream("Bbb", new Uint8Array(100)), // ceil(100/64) = 2 mini sectors
        stream("Ccc", new Uint8Array(10)), // ceil(10/64) = 1 mini sector
      ]),
    );
    const startSectorOf = (name: string): number | undefined =>
      entries.find((e) => e.name === name)?.startSector;
    expect(startSectorOf("Aaa")).toBe(0);
    expect(startSectorOf("Bbb")).toBe(1);
    expect(startSectorOf("Ccc")).toBe(3);
  });

  it("needs a second mini FAT sector once the mini stream passes 128 mini sectors, dividing not multiplying to compute it", () => {
    // entriesPerFatSector is sectorSize / 4 = 128 for a version 3 (512-byte-sector) file, so a mini stream of exactly 129 mini sectors needs ceil(129 / 128) = 2 mini FAT sectors, not 1 -- and a multiplication in that division would instead compute an enormous, clearly-wrong sector count.
    const miniSectorsNeeded = 129;
    const streams = Array.from(
      { length: miniSectorsNeeded },
      (_unused, i) => stream(`M${i}`, new Uint8Array(64)), // exactly one mini sector each
    );
    const bytes = writeCompoundFile(streams);
    const miniFatSectorCount = u32(bytes, 0x40);
    expect(miniFatSectorCount).toBe(2);
    const roundTripped = readCompoundFile(bytes);
    expect(roundTripped).toHaveLength(miniSectorsNeeded);
  });
});

describe("writeCompoundFile FAT, mini-FAT, and DIFAT region padding", () => {
  // 24 MiB forces three chained DIFAT sectors past the header's own 109-entry array ([MS-CFB] 2.5), not just one or two: the DIFAT-chaining loop's own next-sector arithmetic (difatStart + sector + 1) needs a NON-LAST sector at an index past 0 to distinguish from a subtly wrong variant, since at sector 0 every candidate formula agrees (any term multiplied, divided, or negated by 0 is 0), and a fixture with only two DIFAT sectors has no non-last sector other than 0.
  //
  // Built fresh inside each test, not shared via a describe-level beforeAll: Stryker's per-test coverage analysis only attributes code executed inside an it() body to that test -- a beforeAll hook runs outside every individual test's own tracked window, so a mutant reachable only through it (as this fixture's own DIFAT-chaining arithmetic is, nowhere else in this suite) gets no usable per-test coverage at all, confirmed directly against a live mutation run. Recomputing the same 24 MiB write per test costs a fraction of a second and buys correct attribution.
  const sectorSize = 512;
  const sectorOffset = (sector: number): number => (sector + 1) * sectorSize;
  function bigDifatFixture(): {
    bytes: Uint8Array<ArrayBuffer>;
    fatSectorCount: number;
    difatSectorCount: number;
    difatStart: number;
    miniFatSectorCount: number;
  } {
    const payload = new Uint8Array(24 * 1024 * 1024);
    const bytes = writeCompoundFile([stream("WordDocument", payload)]);
    return {
      bytes,
      fatSectorCount: u32(bytes, 0x2c),
      difatSectorCount: u32(bytes, 0x48),
      difatStart: u32(bytes, 0x44),
      miniFatSectorCount: u32(bytes, 0x40),
    };
  }

  it("needs more than one FAT sector and at least three chained DIFAT sectors for this fixture", () => {
    // Sanity check on the fixture itself before trusting the boundary assertions below against it: at least three DIFAT sectors are what makes the DIFAT-chaining loop's own per-sector index and next-pointer arithmetic observable at all (see the fixture's own comment above).
    const { fatSectorCount, difatSectorCount } = bigDifatFixture();
    expect(fatSectorCount).toBeGreaterThan(1);
    expect(difatSectorCount).toBeGreaterThanOrEqual(3);
  });

  it("marks every FAT sector as FATSECT and every DIFAT sector as DIFSECT in the FAT table itself", () => {
    // The FAT's own entry for each of its own sectors and each DIFAT sector is a role marker, never a chain continuation -- read directly from the FAT table (not merely inferred from the file round-tripping), since no reader ever follows a chain onto one of these sectors to notice a wrong marker there.
    const { bytes, fatSectorCount, difatSectorCount, difatStart } =
      bigDifatFixture();
    const entriesPerFatSector = sectorSize / 4;
    const fatEntry = (sector: number): number => {
      const holder = Math.floor(sector / entriesPerFatSector);
      return u32(
        bytes,
        sectorOffset(holder) + (sector % entriesPerFatSector) * 4,
      );
    };
    for (let sector = 0; sector < fatSectorCount; sector++) {
      expect(fatEntry(sector)).toBe(FATSECT);
    }
    for (
      let sector = difatStart;
      sector < difatStart + difatSectorCount;
      sector++
    ) {
      expect(fatEntry(sector)).toBe(DIFSECT);
    }
  });

  it("fills the FAT's own unused tail entries with FREESECT, past the file's real total sector count", () => {
    // The FAT addresses fatSectorCount * 128 sectors total (128 entries per 512-byte FAT sector); the file itself occupies exactly (bytes.length / sectorSize) - 1 real sectors (the header takes the first sectorSize bytes, uncounted). Every FAT entry beyond that real count is unused padding, and must read FREESECT. This writer lays FAT sectors out as physical sectors 0..fatSectorCount-1 (an identity mapping the header DIFAT array and any chained DIFAT sectors both merely restate), so the FAT sector holding a given sector's own entry is that sector's ordinal FAT-sector index directly, with no indirection needed.
    const { bytes, fatSectorCount } = bigDifatFixture();
    const entriesPerFatSector = sectorSize / 4;
    const totalRealSectors = bytes.length / sectorSize - 1;
    const totalAddressableSectors = fatSectorCount * entriesPerFatSector;
    expect(totalAddressableSectors).toBeGreaterThan(totalRealSectors); // otherwise this fixture has no padding tail left to check at all
    for (
      let sector = totalRealSectors;
      sector < totalAddressableSectors;
      sector++
    ) {
      const holder = Math.floor(sector / entriesPerFatSector);
      expect(
        u32(bytes, sectorOffset(holder) + (sector % entriesPerFatSector) * 4),
      ).toBe(FREESECT);
    }
  });

  it("chains every DIFAT sector correctly: each names a run of FAT sector indices then the next DIFAT sector or ENDOFCHAIN", () => {
    const { bytes, fatSectorCount, difatSectorCount, difatStart } =
      bigDifatFixture();
    const entriesPerFatSector = sectorSize / 4;
    const difatEntriesPerSector = entriesPerFatSector - 1;
    for (let sector = 0; sector < difatSectorCount; sector++) {
      const base = sectorOffset(difatStart + sector);
      for (let i = 0; i < difatEntriesPerSector; i++) {
        const fatIndex = 109 + sector * difatEntriesPerSector + i;
        if (fatIndex < fatSectorCount) {
          expect(u32(bytes, base + i * 4)).toBe(fatIndex);
        }
      }
      const terminator = u32(bytes, base + difatEntriesPerSector * 4);
      if (sector === difatSectorCount - 1) {
        expect(terminator).toBe(ENDOFCHAIN);
      } else {
        expect(terminator).toBe(difatStart + sector + 1);
      }
    }
  });

  it("needs no mini FAT sector at all when nothing is mini-resident", () => {
    // This fixture's one stream is well past the mini-stream cutoff, so miniSectorCount is 0 and miniFatSectorCount (ceil(0 / 128)) must be 0 too -- a division-to-multiplication mutant on that same ceil would instead compute a large, clearly-wrong sector count from a genuinely zero numerator.
    const { bytes, miniFatSectorCount } = bigDifatFixture();
    expect(miniFatSectorCount).toBe(0);
    expect(u32(bytes, 0x3c)).toBe(ENDOFCHAIN); // first mini FAT sector: none needed
  });

  it("fills the DIFAT region's own reserved header array slots with FREESECT past the real FAT sector count", () => {
    const { bytes, fatSectorCount } = bigDifatFixture();
    for (let i = fatSectorCount; i < 109; i++) {
      expect(u32(bytes, 0x4c + i * 4)).toBe(FREESECT);
    }
  });

  it("needs no chained DIFAT sector for exactly 109 FAT sectors, and exactly one past that", () => {
    // 109 is HEADER_DIFAT_ENTRIES itself: the header's own array holds that many FAT sector locations unaided, so a file needing precisely 109 must not chain a DIFAT sector, while one needing 110 must chain exactly one. Payload sizes derived from the writer's own fixed-point sector-count loop to land exactly on each side of the boundary.
    const atBoundary = writeCompoundFile([
      stream("A", new Uint8Array(7087104)),
    ]);
    expect(u32(atBoundary, 0x2c)).toBe(109); // fatSectorCount
    expect(u32(atBoundary, 0x48)).toBe(0); // difatSectorCount
    expect(u32(atBoundary, 0x44)).toBe(ENDOFCHAIN); // firstDifatSector: none needed

    const pastBoundary = writeCompoundFile([
      stream("A", new Uint8Array(7087616)),
    ]);
    expect(u32(pastBoundary, 0x2c)).toBe(110);
    expect(u32(pastBoundary, 0x48)).toBe(1);
    expect(u32(pastBoundary, 0x44)).not.toBe(ENDOFCHAIN);
  });
});
