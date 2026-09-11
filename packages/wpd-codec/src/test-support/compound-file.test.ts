import { isCompoundFile, readCompoundFile } from "archive-codec";
import { describe, expect, it } from "vitest";
import { compoundFileWithStream } from "./compound-file";

// Direct round-trip coverage of the [MS-CFB] file this test-support builder writes, read back through archive-codec's own real reader rather than through this package's own container tests, which only ever exercise the small (mini-stream) case a genuine WordPerfect file needs. The builder also has a whole second code path -- a stream at or above the 4096-byte mini-stream cutoff, written through the FAT-chained "big stream" area instead -- that nothing else in this package's test suite ever reaches.
describe("compoundFileWithStream", () => {
  function readBack(name: string, stream: Uint8Array): Uint8Array {
    const file = compoundFileWithStream(name, stream);
    expect(isCompoundFile(file)).toBe(true);
    const streams = readCompoundFile(file);
    const found = streams.find((entry) => entry.path === name);
    expect(found).toBeDefined();
    return found?.bytes ?? new Uint8Array(0);
  }

  it("round-trips a small stream through the mini-stream area", () => {
    const content = new Uint8Array(100);
    for (let i = 0; i < content.length; i += 1) {
      content[i] = (i * 3) & 0xff;
    }
    expect(readBack("Small", content)).toEqual(content);
  });

  it("round-trips an empty stream", () => {
    expect(readBack("Empty", new Uint8Array(0))).toEqual(new Uint8Array(0));
  });

  // Exactly one byte below the mini-stream cutoff: the last length that still takes the mini-stream path.
  it("round-trips a stream one byte below the mini-stream cutoff", () => {
    const content = new Uint8Array(4095);
    for (let i = 0; i < content.length; i += 1) {
      content[i] = (i * 7) & 0xff;
    }
    expect(readBack("JustUnderCutoff", content)).toEqual(content);
  });

  // Exactly the mini-stream cutoff: the first length that must take the big-stream path instead.
  it("round-trips a stream exactly at the mini-stream cutoff, through the big-stream area", () => {
    const content = new Uint8Array(4096);
    for (let i = 0; i < content.length; i += 1) {
      content[i] = (i * 11) & 0xff;
    }
    expect(readBack("AtCutoff", content)).toEqual(content);
  });

  // Large enough to span several 512-byte sectors in the big-stream FAT chain, not just one.
  it("round-trips a multi-sector stream through the big-stream FAT chain", () => {
    const content = new Uint8Array(5000);
    for (let i = 0; i < content.length; i += 1) {
      content[i] = (i * 13) & 0xff;
    }
    expect(readBack("MultiSector", content)).toEqual(content);
  });

  // Large enough to also need more than one 64-byte mini-sector, exercising the mini-FAT chain rather than a single mini-sector.
  it("round-trips a stream spanning several mini-sectors", () => {
    const content = new Uint8Array(1000);
    for (let i = 0; i < content.length; i += 1) {
      content[i] = (i * 17) & 0xff;
    }
    expect(readBack("MultiMiniSector", content)).toEqual(content);
  });

  it("names the stream exactly as given, distinct from an unrelated name", () => {
    const file = compoundFileWithStream("MyStream", new Uint8Array([1, 2, 3]));
    const streams = readCompoundFile(file);
    expect(streams.map((entry) => entry.path)).toEqual(["MyStream"]);
  });
});
