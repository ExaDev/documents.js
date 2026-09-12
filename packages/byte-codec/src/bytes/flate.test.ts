import type * as Fflate from "fflate";
import { unzlibSync, zlibSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import {
  MAX_INFLATE_OUTPUT_BYTES,
  deflate,
  inflate,
  inflateTolerant,
} from "./flate";

vi.mock("fflate", async (importOriginal) => {
  const actual = await importOriginal<typeof Fflate>();
  return {
    ...actual,
    zlibSync: vi.fn(actual.zlibSync),
    unzlibSync: vi.fn(actual.unzlibSync),
  };
});

describe("deflate/inflate round-trip", () => {
  it("inflates exactly what was deflated", () => {
    const original = new TextEncoder().encode("hello world, hello world");
    expect(Array.from(inflate(deflate(original)))).toEqual(
      Array.from(original),
    );
  });
});

describe("deflate's level option", () => {
  it("passes undefined options through to zlibSync when no level is given", () => {
    deflate(new Uint8Array([1, 2, 3]));
    expect(zlibSync).toHaveBeenLastCalledWith(
      expect.any(Uint8Array),
      undefined,
    );
  });

  it("wraps an explicit level in an options object rather than passing it bare", () => {
    deflate(new Uint8Array([1, 2, 3]), 9);
    expect(zlibSync).toHaveBeenLastCalledWith(expect.any(Uint8Array), {
      level: 9,
    });
  });

  it("treats level 0 as an explicit level rather than as absent", () => {
    deflate(new Uint8Array([1, 2, 3]), 0);
    expect(zlibSync).toHaveBeenLastCalledWith(expect.any(Uint8Array), {
      level: 0,
    });
  });
});

describe("inflate's output-size guard", () => {
  it("does not throw when the inflated output sits exactly at the limit", () => {
    const atLimit = {
      length: MAX_INFLATE_OUTPUT_BYTES,
    } as unknown as Uint8Array<ArrayBuffer>;
    vi.mocked(unzlibSync).mockReturnValueOnce(atLimit);
    expect(inflate(new Uint8Array(0))).toBe(atLimit);
  });

  it("throws once the inflated output exceeds the limit by a single byte", () => {
    const overLimit = {
      length: MAX_INFLATE_OUTPUT_BYTES + 1,
    } as unknown as Uint8Array<ArrayBuffer>;
    vi.mocked(unzlibSync).mockReturnValueOnce(overLimit);
    expect(() => inflate(new Uint8Array(0))).toThrow(
      `inflated output exceeds the ${MAX_INFLATE_OUTPUT_BYTES}-byte limit`,
    );
  });
});

describe("inflateTolerant", () => {
  it("returns recovered: false when the plain zlib stream inflates cleanly on the first try", () => {
    const original = new TextEncoder().encode("plain valid zlib stream");
    const result = inflateTolerant(deflate(original));
    expect(result.recovered).toBe(false);
    expect(Array.from(result.bytes)).toEqual(Array.from(original));
  });

  it("recovers by skipping leading whitespace bytes the plain inflate chokes on", () => {
    const original = new TextEncoder().encode("data behind stray whitespace");
    const zlibStream = deflate(original);
    // A leading space (0x20) makes the zlib header bytes invalid, so the first attempt inside inflateTolerant must throw before the whitespace-skip retry ever finds the real stream.
    const withLeadingWhitespace = new Uint8Array(zlibStream.length + 1);
    withLeadingWhitespace[0] = 0x20;
    withLeadingWhitespace.set(zlibStream, 1);

    const result = inflateTolerant(withLeadingWhitespace);
    expect(result.recovered).toBe(true);
    expect(Array.from(result.bytes)).toEqual(Array.from(original));
  });

  it("recovers raw (unwrapped) DEFLATE data mislabelled as a zlib stream", () => {
    // zlibSync's own internal raw-deflate writer, exposed indirectly: strip the 2-byte zlib header and 4-byte trailing Adler-32 checksum from a real zlib stream to get a raw DEFLATE payload with no wrapper -- exactly what some real-world producers mislabel as FlateDecode.
    const original = new TextEncoder().encode(
      "raw deflate payload, no zlib wrapper",
    );
    const zlibStream = deflate(original);
    const rawDeflate = zlibStream.subarray(2, zlibStream.length - 4);

    const result = inflateTolerant(rawDeflate);
    expect(result.recovered).toBe(true);
    expect(Array.from(result.bytes)).toEqual(Array.from(original));
  });

  it("recovers whatever decoded successfully from a truncated stream via the streaming fallback", () => {
    const original = new TextEncoder().encode(
      "a fairly long message so truncation leaves a real prefix behind that the streaming decoder can still emit before it fails on the missing tail",
    );
    const zlibStream = deflate(original, 0); // level 0 (stored blocks): a predictable, easily-truncatable framing
    const truncated = zlibStream.subarray(0, zlibStream.length - 4);

    const result = inflateTolerant(truncated);
    expect(result.recovered).toBe(true);
    expect(result.bytes.length).toBeGreaterThan(0);
    // Every byte the streaming decoder did emit must be a genuine, uncorrupted prefix of the original.
    expect(Array.from(result.bytes)).toEqual(
      Array.from(original.subarray(0, result.bytes.length)),
    );
  });

  it("throws when nothing at all can be recovered from completely invalid data", () => {
    const garbage = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    expect(() => inflateTolerant(garbage)).toThrow(
      "unable to inflate stream: no data could be recovered",
    );
  });
});
