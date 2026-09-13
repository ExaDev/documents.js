import { describe, expect, it } from "vitest";
import { readCompoundFile } from "../cfb/read";
import { compoundFile } from "./cfb";

// Direct coverage for the [MS-CFB] fixture builder itself (src/test-support/cfb.ts), independent of the ../cfb/read.test.ts and ../cfb/write.test.ts suites that consume it as a black box. Most of this builder's own logic is already exercised indirectly by those two suites reading back what it writes -- these cases target the specific internal decisions (sibling-node reuse, byte-exact header/directory-entry fields, loop boundaries) that a correct read-back alone cannot distinguish from a subtly wrong one.

const enc = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);

// Follows the directory's own FAT chain to its ENDOFCHAIN terminator, the same way read.ts would, rather than guessing a sector count from the total file length -- a sector that happens to hold mini-stream or mini-FAT content, not real directory rows, can otherwise be miscounted as one more directory sector by coincidence of its own leading byte.
function directorySectorCount(bytes: Uint8Array<ArrayBuffer>): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const directoryStart = view.getUint32(0x30, true);
  // FAT sector k always sits at physical sector k itself (this builder's own identity mapping, per its module comment), so FAT sector k's own bytes are at file offset (k + 1) * 512, and entry `sector`'s own slot is 4 * (sector mod 128) bytes into whichever FAT sector holds it.
  const fatEntry = (sector: number): number =>
    view.getUint32(
      (Math.floor(sector / 128) + 1) * 512 + (sector % 128) * 4,
      true,
    );
  let count = 1;
  let current = directoryStart;
  for (;;) {
    const next = fatEntry(current);
    if (next === 0xfffffffe) {
      break; // ENDOFCHAIN
    }
    current = next;
    count += 1;
  }
  return count;
}

function directoryEntryCount(bytes: Uint8Array<ArrayBuffer>): number {
  return (directorySectorCount(bytes) * 512) / 128;
}

// Reads back every directory entry's own name and object type directly from the bytes, in id order -- a lower-level probe than readCompoundFile, which only ever surfaces stream paths, never a storage's own presence or a duplicate name.
function directoryEntries(
  bytes: Uint8Array<ArrayBuffer>,
): { name: string; objectType: number }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const directoryStart = view.getUint32(0x30, true);
  const count = directoryEntryCount(bytes);
  const decoder = new TextDecoder("utf-16le");
  const entries: { name: string; objectType: number }[] = [];
  for (let id = 0; id < count; id++) {
    const base = (directoryStart + 1) * 512 + id * 128;
    const objectType = view.getUint8(base + 0x42);
    if (objectType === 0) {
      continue; // unallocated padding
    }
    const nameLength = view.getUint16(base + 0x40, true);
    const name = decoder.decode(
      bytes.subarray(base, base + Math.max(0, nameLength - 2)),
    );
    entries.push({ name, objectType });
  }
  return entries;
}

describe("compoundFile sibling reuse", () => {
  it("creates exactly one storage entry for a name shared by several stream paths, not one per path", () => {
    const bytes = compoundFile([
      { path: "Pool/First", bytes: enc("1") },
      { path: "Pool/Second", bytes: enc("2") },
      { path: "Pool/Third", bytes: enc("3") },
    ]);
    const poolEntries = directoryEntries(bytes).filter(
      (e) => e.name === "Pool",
    );
    expect(poolEntries).toHaveLength(1);
    expect(poolEntries[0]?.objectType).toBe(1); // storage
  });

  it("creates a separate storage entry for each distinctly-named top-level path, not a single shared one", () => {
    const bytes = compoundFile([
      { path: "Alpha/X", bytes: enc("1") },
      { path: "Beta/Y", bytes: enc("2") },
    ]);
    const entries = directoryEntries(bytes);
    expect(entries.filter((e) => e.name === "Alpha")).toHaveLength(1);
    expect(entries.filter((e) => e.name === "Beta")).toHaveLength(1);
  });

  it("never reuses a stream node as a storage, even when a later path needs the same name to be one", () => {
    // "Thing" is written first as a stream; "Thing/Inner" then needs an intermediate storage of the same name. The sibling-reuse search must skip the existing stream node (it is not a storage) and create a genuinely new storage entry instead, rather than silently reusing the wrong kind of node.
    const bytes = compoundFile([
      { path: "Thing", bytes: enc("leaf") },
      { path: "Thing/Inner", bytes: enc("nested") },
    ]);
    const thingEntries = directoryEntries(bytes).filter(
      (e) => e.name === "Thing",
    );
    expect(thingEntries).toHaveLength(2);
    expect(thingEntries.map((e) => e.objectType).sort()).toEqual([1, 2]); // one storage, one stream
    const streams = readCompoundFile(bytes);
    expect(streams.map((s) => s.path).sort()).toEqual(["Thing", "Thing/Inner"]);
  });
});

describe("compoundFile sibling right-links", () => {
  it("chains three siblings to each other, not merely each to the first", () => {
    const bytes = compoundFile([
      { path: "Pool/First", bytes: enc("1") },
      { path: "Pool/Second", bytes: enc("2") },
      { path: "Pool/Third", bytes: enc("3") },
    ]);
    const streams = readCompoundFile(bytes);
    expect(streams.map((s) => s.path).sort()).toEqual([
      "Pool/First",
      "Pool/Second",
      "Pool/Third",
    ]);
  });

  it("gives the last sibling in a chain NOSTREAM as its own right link, not a link to itself or the first", () => {
    const bytes = compoundFile([
      { path: "A", bytes: enc("1") },
      { path: "B", bytes: enc("2") },
    ]);
    const view = new DataView(bytes.buffer);
    const directoryStart = view.getUint32(0x30, true);
    // Entry 0 is root, entry 1 is A, entry 2 is B (insertion order, depth-first).
    const bRightLink = view.getUint32(
      (directoryStart + 1) * 512 + 2 * 128 + 0x48,
      true,
    );
    expect(bRightLink).toBe(0xffffffff); // NOSTREAM
  });
});

describe("compoundFile directory-entry byte layout", () => {
  it("writes the colour flag byte as 1 (black) for every entry", () => {
    const bytes = compoundFile([{ path: "A", bytes: enc("x") }]);
    const view = new DataView(bytes.buffer);
    const directoryStart = view.getUint32(0x30, true);
    // Root is id 0, A is id 1.
    expect(view.getUint8((directoryStart + 1) * 512 + 0 * 128 + 0x43)).toBe(1);
    expect(view.getUint8((directoryStart + 1) * 512 + 1 * 128 + 0x43)).toBe(1);
  });

  it("writes the header's own minor version field as 0x003E", () => {
    // [MS-CFB] 2.2 names this value for both major version 3 and 4, but real readers (including ../cfb/read.ts) never inspect it -- direct byte inspection is the only way to notice it going unwritten.
    const bytes = compoundFile([{ path: "A", bytes: enc("x") }]);
    expect(new DataView(bytes.buffer).getUint16(0x18, true)).toBe(0x3e);
  });

  it("writes the high 32 bits of a stream's size as zero", () => {
    const bytes = compoundFile([{ path: "A", bytes: enc("x".repeat(5000)) }]);
    const view = new DataView(bytes.buffer);
    const directoryStart = view.getUint32(0x30, true);
    expect(
      view.getUint32((directoryStart + 1) * 512 + 1 * 128 + 0x7c, true),
    ).toBe(0);
  });

  it("accepts the highest ASCII byte value (0x7F) in a name, and rejects the lowest non-ASCII one (0x80)", () => {
    // 0x7F (DEL) is the last code point checkedName's own > 0x7f test allows; a name built from it must round-trip. 0x80 is the first byte that test rejects.
    const highAscii = String.fromCharCode(0x7f);
    expect(() =>
      compoundFile([{ path: highAscii, bytes: enc("x") }]),
    ).not.toThrow();
    const nonAscii = String.fromCharCode(0x80);
    expect(() => compoundFile([{ path: nonAscii, bytes: enc("x") }])).toThrow(
      /non-empty ASCII/,
    );
  });
});

describe("compoundFile entry-path validation", () => {
  it("rejects a completely empty path, not just an empty segment within one", () => {
    expect(() => compoundFile([{ path: "", bytes: enc("x") }])).toThrow(
      /no empty segments/,
    );
  });
});

describe("compoundFile FAT chain lengths", () => {
  it("chains a stream needing exactly two sectors as two links, not one or three", () => {
    // 512-byte sectors; a 600-byte stream needs ceil(600/512) = 2 sectors. The chain() helper's own loop must mark exactly that many FAT entries (the last ENDOFCHAIN, every other pointing to the next), not one short (truncating real content) or one long (chaining into whatever sector follows).
    const bytes = compoundFile([{ path: "A", bytes: enc("x".repeat(600)) }]);
    const streams = readCompoundFile(bytes);
    expect(streams[0]?.bytes.length).toBe(600);
  });

  it("chains a mini-resident stream needing exactly two mini sectors as two links, not one or three", () => {
    // 64-byte mini sectors; a 100-byte stream needs ceil(100/64) = 2 mini sectors.
    const bytes = compoundFile([{ path: "A", bytes: enc("x".repeat(100)) }]);
    const streams = readCompoundFile(bytes);
    expect(streams[0]?.bytes.length).toBe(100);
  });
});

describe("compoundFile FAT and mini-FAT padding tails", () => {
  it("fills the FAT's own unused tail entries with FREESECT, past the file's real total sector count", () => {
    // Every chain() call but the very last is immediately followed by the next region's own chain() call, whose first write lands exactly where an off-by-one in the previous call would have -- overwriting it regardless. The very last call (the mini-FAT's own chain) has nothing after it, so an off-by-one there leaks into the FAT's own genuinely unused padding tail, which must still read FREESECT.
    const bytes = compoundFile([{ path: "A", bytes: enc("x".repeat(5000)) }]);
    const view = new DataView(bytes.buffer);
    const fatSectorCount = view.getUint32(0x2c, true);
    const entriesPerFatSector = 512 / 4;
    const totalRealSectors = bytes.length / 512 - 1;
    const totalAddressableSectors = fatSectorCount * entriesPerFatSector;
    expect(totalAddressableSectors).toBeGreaterThan(totalRealSectors);
    for (
      let sector = totalRealSectors;
      sector < totalAddressableSectors;
      sector++
    ) {
      const holder = Math.floor(sector / entriesPerFatSector);
      expect(
        view.getUint32(
          (holder + 1) * 512 + (sector % entriesPerFatSector) * 4,
          true,
        ),
      ).toBe(0xffffffff); // FREESECT
    }
  });

  it("marks every one of its own FAT sectors as FATSECT in the FAT table itself", () => {
    // Removing the fat[sector] = FATSECT loop entirely would leave every FAT sector reading back as FREESECT (its own initial fill value), since nothing else in this builder ever writes to those specific indices.
    const bytes = compoundFile([{ path: "A", bytes: enc("x".repeat(5000)) }]);
    const view = new DataView(bytes.buffer);
    const fatSectorCount = view.getUint32(0x2c, true);
    const entriesPerFatSector = 512 / 4;
    for (let sector = 0; sector < fatSectorCount; sector++) {
      const holder = Math.floor(sector / entriesPerFatSector);
      expect(
        view.getUint32(
          (holder + 1) * 512 + (sector % entriesPerFatSector) * 4,
          true,
        ),
      ).toBe(0xfffffffd); // FATSECT
    }
  });

  it("fills the mini-FAT's own unused tail entries with FREESECT, past the real mini sector count", () => {
    // The mini-FAT chain loop is the very last thing this builder writes into the miniFat array -- nothing follows it to overwrite an off-by-one, so its own padding tail is the direct witness.
    const bytes = compoundFile([{ path: "A", bytes: enc("x") }]); // 1 byte -> 1 real mini sector, needing 1 mini-FAT sector of mostly padding
    const view = new DataView(bytes.buffer);
    const miniFatStart = view.getUint32(0x3c, true);
    const miniFatSectorCount = view.getUint32(0x40, true);
    const entriesPerFatSector = 512 / 4;
    const realMiniSectors = 1;
    const totalAddressableMiniSlots = miniFatSectorCount * entriesPerFatSector;
    expect(totalAddressableMiniSlots).toBeGreaterThan(realMiniSectors);
    for (let slot = realMiniSectors; slot < totalAddressableMiniSlots; slot++) {
      const holder = miniFatStart + Math.floor(slot / entriesPerFatSector);
      expect(
        view.getUint32(
          (holder + 1) * 512 + (slot % entriesPerFatSector) * 4,
          true,
        ),
      ).toBe(0xffffffff); // FREESECT
    }
  });
});

describe("compoundFile header DIFAT array padding", () => {
  it("fills every one of the header's 109 DIFAT entries, the real FAT sector indices then FREESECT", () => {
    const bytes = compoundFile([{ path: "A", bytes: enc("x") }]);
    const view = new DataView(bytes.buffer);
    const fatSectorCount = view.getUint32(0x2c, true);
    expect(fatSectorCount).toBeGreaterThan(0);
    for (let i = 0; i < fatSectorCount; i++) {
      expect(view.getUint32(0x4c + i * 4, true)).toBe(i);
    }
    for (let i = fatSectorCount; i < 109; i++) {
      expect(view.getUint32(0x4c + i * 4, true)).toBe(0xffffffff);
    }
  });
});

describe("compoundFile stream size partitioning", () => {
  it("allocates no FAT-resident data sector at all for a file holding only one mini-resident stream", () => {
    // A stream this small being also (wrongly) counted among the "big" (FAT-resident) partition would allocate an extra, entirely unused data sector for it -- unobservable through read-back (the entry's own startSector still correctly points into the mini stream), but it inflates the file's own total size. 1 FAT sector + 1 directory sector + 1 mini-stream sector + 1 mini-FAT sector is the true minimum for this fixture.
    const bytes = compoundFile([{ path: "A", bytes: enc("x") }]);
    expect(bytes.length).toBe(512 * (1 + 1 + 1 + 1 + 1)); // header + 4 sectors
  });
});

describe("compoundFile mini-FAT sector boundary", () => {
  it("keeps a single stream's chain intact even when it straddles the 128-entry mini-FAT-sector boundary", () => {
    // 126 one-mini-sector filler streams occupy mini sectors 0-125; a 4-mini-sector stream right after them occupies 126-129, so its own chain entries at local indices 126, 127 sit in the first mini-FAT sector and 128, 129 in the second. Every filler stream's own chain entry is ENDOFCHAIN, so a bug that copies the wrong 512-byte chunk into the second mini-FAT sector (duplicating the first, or reading from the wrong offset within the combined buffer) would still read back as ENDOFCHAIN there too if this stream's own real values did not differ from mini sector to mini sector -- filling each of its own four mini sectors with a distinct byte value makes that corruption visible as wrong (truncated or shuffled) content instead.
    const fillerCount = 126;
    const filler = Array.from({ length: fillerCount }, (_unused, i) => ({
      path: `Filler${i}`,
      bytes: new Uint8Array(64).fill(1),
    }));
    const bigBytes = new Uint8Array(64 * 4);
    for (let miniSector = 0; miniSector < 4; miniSector++) {
      bigBytes.fill(miniSector + 10, miniSector * 64, (miniSector + 1) * 64);
    }
    const bytes = compoundFile([...filler, { path: "Big", bytes: bigBytes }]);
    expect(new DataView(bytes.buffer).getUint32(0x40, true)).toBe(2); // sanity: needs two mini-FAT sectors
    const streams = readCompoundFile(bytes);
    expect(streams.find((s) => s.path === "Big")?.bytes).toEqual(bigBytes);
  });
});

describe("compoundFile directory sector count", () => {
  it("needs exactly two directory sectors for a fixture with more than four real entries", () => {
    // 4 entries per 512-byte directory sector; root plus 5 streams is 6 real entries, needing 2 sectors -- the directorySectorCount loop's own boundary matters here, not merely whether one sector is enough.
    const bytes = compoundFile(
      Array.from({ length: 5 }, (_unused, i) => ({
        path: `S${i}`,
        bytes: enc("x"),
      })),
    );
    expect(directoryEntryCount(bytes)).toBe(8); // 2 sectors * 4 entries
  });
});
