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
});
