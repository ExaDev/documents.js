import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import {
  localFileHeaderNames,
  localHeaderCompressionMethod,
  readUint16LE,
  readUint32LE,
} from "./zip";

// Coverage for the little-endian readers and local-file-header walkers this package's own test suites lean on to verify byte-exact ZIP layout. Built and tested independently of fflate's own zipSync/unzipSync, since these exist specifically to check what fflate produces rather than to duplicate it.

// One ZIP local file header (PK\x03\x04) plus its own filename, extra field, and (stored, uncompressed) data -- built by hand so a non-zero extra-field length can be exercised, which fflate's own zipSync never emits for a plain entry.
function localFileHeader(
  name: string,
  data: Uint8Array,
  extraFieldLength: number,
): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const extra = new Uint8Array(extraFieldLength).fill(0xee); // arbitrary, non-zero filler so a misplaced read would carry visibly wrong bytes
  const header = new Uint8Array(
    30 + nameBytes.length + extra.length + data.length,
  );
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true); // local file header signature
  view.setUint16(4, 20, true); // version needed
  view.setUint16(6, 0, true); // general-purpose flags
  view.setUint16(8, 0, true); // compression method: stored
  view.setUint16(10, 0, true); // mod time
  view.setUint16(12, 0, true); // mod date
  view.setUint32(14, 0, true); // CRC-32 (unchecked by these test-support readers)
  view.setUint32(18, data.length, true); // compressed size (== uncompressed size, stored)
  view.setUint32(22, data.length, true); // uncompressed size
  view.setUint16(26, nameBytes.length, true); // filename length
  view.setUint16(28, extra.length, true); // extra field length
  header.set(nameBytes, 30);
  header.set(extra, 30 + nameBytes.length);
  header.set(data, 30 + nameBytes.length + extra.length);
  return header;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

describe("readUint16LE / readUint32LE", () => {
  it("reads a little-endian uint16", () => {
    expect(readUint16LE(new Uint8Array([0x34, 0x12]), 0)).toBe(0x1234);
  });

  it("reads a little-endian uint32", () => {
    expect(readUint32LE(new Uint8Array([0x78, 0x56, 0x34, 0x12]), 0)).toBe(
      0x12345678,
    );
  });

  it("reads at a non-zero offset", () => {
    expect(readUint16LE(new Uint8Array([0xff, 0x34, 0x12]), 1)).toBe(0x1234);
    expect(
      readUint32LE(new Uint8Array([0xff, 0x78, 0x56, 0x34, 0x12]), 1),
    ).toBe(0x12345678);
  });

  it("throws when a uint16 read would run past the end of the bytes", () => {
    expect(() => readUint16LE(new Uint8Array([0x01]), 0)).toThrow();
    expect(() => readUint16LE(new Uint8Array([0x01, 0x02]), 1)).toThrow();
  });

  it("throws when a uint32 read would run past the end of the bytes", () => {
    expect(() => readUint32LE(new Uint8Array([0x01, 0x02, 0x03]), 0)).toThrow();
    expect(() =>
      readUint32LE(new Uint8Array([0x01, 0x02, 0x03, 0x04]), 1),
    ).toThrow();
  });
});

describe("localFileHeaderNames / localHeaderCompressionMethod", () => {
  it("lists names and methods for a real fflate-produced archive", () => {
    const bytes = zipSync({ "a.txt": new TextEncoder().encode("hi") });
    expect(localFileHeaderNames(bytes)).toEqual(["a.txt"]);
    expect(localHeaderCompressionMethod(bytes, 0)).toBe(8); // fflate deflates by default
  });

  it("stops cleanly, without over-reading, when the local headers run exactly to the end of the bytes", () => {
    // A real archive's central directory follows its local headers, so `offset` never naturally lands exactly on `bytes.length` inside the loop -- constructed here directly so that boundary is genuinely exercised, rather than merely assumed safe.
    const entry = localFileHeader("only.txt", new TextEncoder().encode("x"), 0);
    expect(() => localFileHeaderNames(entry)).not.toThrow();
    expect(localFileHeaderNames(entry)).toEqual(["only.txt"]);
    expect(() => localHeaderCompressionMethod(entry, 0)).not.toThrow();
  });

  it("skips a non-zero extra field to find the next entry's own header", () => {
    const first = localFileHeader(
      "first.txt",
      new TextEncoder().encode("aaaa"),
      4, // a non-zero extra field length fflate itself never emits
    );
    const second = localFileHeader(
      "second.txt",
      new TextEncoder().encode("bb"),
      0,
    );
    const bytes = concat(first, second);
    expect(localFileHeaderNames(bytes)).toEqual(["first.txt", "second.txt"]);
    expect(localHeaderCompressionMethod(bytes, 1)).toBe(0); // reaching the SECOND header at all proves the first one's extra field was skipped correctly, not just its name parsed
  });

  it("throws naming the requested entry index when the archive holds fewer entries than that", () => {
    const bytes = zipSync({ "a.txt": new TextEncoder().encode("hi") });
    expect(() => localHeaderCompressionMethod(bytes, 3)).toThrow(
      "no local file header at entry index 3",
    );
  });

  it("throws the same named-index error, rather than an out-of-bounds read, when the requested index is past the last header and nothing (not even a central directory) follows it", () => {
    // Distinct from the previous case: there the loop exits by a signature mismatch against trailing central-directory bytes (offset still short of bytes.length); here there is nothing after the one local header at all, so the loop's own length check is what must stop it exactly at bytes.length, cleanly, before ever reading past it.
    const entry = localFileHeader("only.txt", new TextEncoder().encode("x"), 0);
    expect(() => localHeaderCompressionMethod(entry, 1)).toThrow(
      "no local file header at entry index 1",
    );
  });

  it("stops at a signature mismatch rather than misreading whatever bytes happen to follow as another header", () => {
    // The "fewer entries than the archive holds" case above can never actually distinguish a missing signature check: both a signature mismatch and simply running out of bytes end up at the identical throw, since its message names only the requested entryIndex, never anything the loop itself observed. This instead places 40 zero bytes -- long enough to read as a well-formed (if nonsensical) header, but not starting with the local-file-header magic -- right after one real entry, so a walk that skipped the signature check would treat them as a second header, find its own compression-method field there (0, since every byte is 0), and return that instead of throwing.
    const first = localFileHeader("only.txt", new TextEncoder().encode("x"), 0);
    const notAHeader = new Uint8Array(40);
    const bytes = concat(first, notAHeader);
    expect(() => localHeaderCompressionMethod(bytes, 1)).toThrow(
      "no local file header at entry index 1",
    );
  });
});
