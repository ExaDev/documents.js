import type * as Fflate from "fflate";
import { deflateSync, unzlibSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import {
  MAX_INFLATE_OUTPUT_BYTES,
  deflate,
  inflate,
  inflateTolerant,
} from "./flate";

vi.mock("fflate", async (importOriginal) => {
  const actual = await importOriginal<typeof Fflate>();
  return { ...actual, unzlibSync: vi.fn(actual.unzlibSync) };
});

const sample = new TextEncoder().encode(
  "the quick brown fox jumps over the lazy dog, ".repeat(20),
);

describe("deflate / inflate", () => {
  it("round-trip exactly", () => {
    expect(inflate(deflate(sample))).toEqual(sample);
  });

  it("inflate rejects raw (non-zlib-framed) DEFLATE data", () => {
    const raw = deflateSync(sample);
    expect(() => inflate(raw)).toThrow();
  });

  it("deflate output is genuinely zlib-framed (starts with a valid CMF/FLG header)", () => {
    const compressed = deflate(sample);
    // A zlib header's first byte's low nibble must be 8 (the DEFLATE compression method), and the 16-bit big-endian header must be a multiple of 31 — the check the zlib spec itself defines.
    expect(compressed[0]! & 0x0f).toBe(8);
    expect(((compressed[0]! << 8) + compressed[1]!) % 31).toBe(0);
  });

  it("an explicit level is actually passed through to zlibSync, not discarded", () => {
    // Level 0 is stored (no compression), so it round-trips correctly but produces output far larger than the default level's compressed size for this same, highly repetitive sample — a difference only observable if the level option genuinely reaches zlibSync rather than being dropped.
    const stored = deflate(sample, 0);
    const defaultLevel = deflate(sample);
    expect(stored.length).toBeGreaterThan(defaultLevel.length);
    expect(inflate(stored)).toEqual(sample);
  });
});

describe("inflate's output-size guard", () => {
  it("rejects a decompressed output over the configured byte limit", () => {
    // unzlibSync itself is mocked here rather than actually decompressing half a gigabyte: the guard only reads `.length`, and driving hundreds of megabytes of real (de)compression through every one of this package's mutation-tested mutants would multiply the whole suite's runtime for no genuine coverage this fake object doesn't already provide.
    vi.mocked(unzlibSync).mockReturnValueOnce({
      length: MAX_INFLATE_OUTPUT_BYTES + 1,
    } as unknown as ReturnType<typeof unzlibSync>);
    expect(() => inflate(new Uint8Array())).toThrow(
      `inflated output exceeds the ${MAX_INFLATE_OUTPUT_BYTES}-byte limit`,
    );
  });
});

describe("inflateTolerant", () => {
  it("succeeds directly on well-formed zlib data with recovered:false", () => {
    const result = inflateTolerant(deflate(sample));
    expect(result.recovered).toBe(false);
    expect(result.bytes).toEqual(sample);
  });

  it("recovers from a stream with leading whitespace bytes", () => {
    const compressed = deflate(sample);
    const padded = new Uint8Array(compressed.length + 2);
    padded.set([0x0a, 0x20], 0);
    padded.set(compressed, 2);
    const result = inflateTolerant(padded);
    expect(result.recovered).toBe(true);
    expect(result.bytes).toEqual(sample);
  });

  it("recovers raw (non-zlib-framed) DEFLATE data mislabelled as FlateDecode", () => {
    const raw = deflateSync(sample);
    const result = inflateTolerant(raw);
    expect(result.recovered).toBe(true);
    expect(result.bytes).toEqual(sample);
  });

  it("recovers partial output from a truncated stream rather than throwing outright", () => {
    const compressed = deflate(sample);
    const truncated = compressed.subarray(0, compressed.length - 4);
    const result = inflateTolerant(truncated);
    expect(result.recovered).toBe(true);
    expect(result.bytes.length).toBeGreaterThan(0);
  });

  it("throws when nothing at all can be recovered", () => {
    expect(() => inflateTolerant(new Uint8Array([1, 2, 3]))).toThrow();
  });
});

describe("inflateTolerant with an expected length", () => {
  const compressed = deflate(sample);
  const unhinted = inflateTolerant(compressed);

  it.each([
    ["exactly the output's length", sample.length],
    ["longer than the output", sample.length + 500],
    ["shorter than the output", sample.length - 1],
    ["zero", 0],
    ["not an integer", sample.length + 0.5],
    ["negative", -1],
  ])(
    "inflates to the same bytes when the expectation is %s",
    (_name, expected) => {
      const hinted = inflateTolerant(compressed, expected);
      expect(Array.from(hinted.bytes)).toEqual(Array.from(unhinted.bytes));
      expect(hinted.recovered).toBe(false);
    },
  );

  it("inflates into one buffer of the expected length, plus a byte that shows whether the stream ran past it", () => {
    vi.mocked(unzlibSync).mockClear();
    inflateTolerant(compressed, sample.length);
    expect(vi.mocked(unzlibSync)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(unzlibSync).mock.calls[0]?.[1]?.out?.length).toBe(
      sample.length + 1,
    );
  });

  it("does not act on an expectation the data could not meet, whatever a dictionary claims", () => {
    vi.mocked(unzlibSync).mockClear();
    const tiny = deflate(new Uint8Array(10));
    const result = inflateTolerant(tiny, tiny.length * 1032 + 1);
    expect(Array.from(result.bytes)).toEqual(Array.from(new Uint8Array(10)));
    expect(
      vi.mocked(unzlibSync).mock.calls.every((call) => call[1] === undefined),
    ).toBe(true);
  });

  it("recovers a damaged stream exactly as it would with no expectation", () => {
    const damaged = compressed.slice(0, compressed.length - 9);
    const hinted = inflateTolerant(damaged, sample.length);
    const plain = inflateTolerant(damaged);
    expect(Array.from(hinted.bytes)).toEqual(Array.from(plain.bytes));
    expect(hinted.recovered).toBe(plain.recovered);
  });
});
