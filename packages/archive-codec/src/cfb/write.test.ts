import { describe, expect, it } from "vitest";
import { type CompoundFileStream, readCompoundFile } from "./read";
import { CompoundFileWriteError, writeCompoundFile } from "./write";

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
    expect(() => writeCompoundFile([stream("N".repeat(32), enc("x"))])).toThrow(
      CompoundFileWriteError,
    );
    expect(() =>
      writeCompoundFile([stream("N".repeat(31), enc("x"))]),
    ).not.toThrow();
  });

  it("rejects an empty path or an empty path segment", () => {
    for (const path of ["", "/Leading", "Trailing/", "Double//Segment"]) {
      expect(() => writeCompoundFile([stream(path, enc("x"))])).toThrow(
        CompoundFileWriteError,
      );
    }
  });

  it("rejects the same path supplied twice", () => {
    expect(() =>
      writeCompoundFile([stream("Dup", enc("1")), stream("Dup", enc("2"))]),
    ).toThrow(CompoundFileWriteError);
  });

  it("rejects a path that needs one name to be both a storage and a stream", () => {
    expect(() =>
      writeCompoundFile([
        stream("Thing", enc("1")),
        stream("Thing/Inner", enc("2")),
      ]),
    ).toThrow(CompoundFileWriteError);
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
});
