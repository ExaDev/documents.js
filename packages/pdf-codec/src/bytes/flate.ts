import { Unzlib, inflateSync, unzlibSync, zlibSync } from "fflate";
import { isAsciiWhitespace } from "./reader";
import { concatBytes } from "./writer";

// The only file in the package that imports fflate — the direct analogue of ooxml.js's own src/zip.ts ("a thin wrapper over fflate's zipSync/unzipSync, isomorphic and dependency-free"). PDF's FlateDecode filter and PNG's IDAT payload both use zlib-framed DEFLATE (RFC 1950 — a 2-byte header plus a trailing Adler-32 checksum) — that is zlibSync/unzlibSync, NOT fflate's deflateSync/inflateSync, which are raw DEFLATE (RFC 1951) with no wrapper. Emitting or expecting the wrong framing produces a stream every conformant PDF/PNG reader rejects.

const BYTES_PER_KIB = 1024;
const KIB_PER_MIB = 1024;
// The chosen ceiling for a single inflate call's decompressed output, in mebibytes.
const MAX_INFLATE_OUTPUT_MIB = 512;

// Guards every call in this module against a maliciously or accidentally huge decompressed output — both PDF and PNG streams here come from arbitrary, potentially adversarial input.
export const MAX_INFLATE_OUTPUT_BYTES =
  MAX_INFLATE_OUTPUT_MIB * KIB_PER_MIB * BYTES_PER_KIB;

// The largest expected length acted on, in mebibytes: past it a stream is inflated into a growable buffer, as with no expectation. A dictionary can state any size up to its stream's deflate bound, and in a Worker isolate an allocation that size ends the isolate rather than throwing into the catch below, so a buffer bought on a dictionary's word alone stays small enough to survive. 32 MiB holds an 11-megapixel RGB image's samples.
const MAX_EXPECTED_LENGTH_MIB = 32;

export const MAX_EXPECTED_LENGTH_BYTES =
  MAX_EXPECTED_LENGTH_MIB * KIB_PER_MIB * BYTES_PER_KIB;

// The most a deflate stream can expand: a 258-byte match costs at least two bits, so each input byte decodes to at most 1032 bytes (zlib's own technical details give the same limit).
const DEFLATE_MAX_EXPANSION = 1032;

export type DeflateLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export function deflate(
  data: Uint8Array<ArrayBuffer>,
  level?: DeflateLevel,
): Uint8Array<ArrayBuffer> {
  return zlibSync(data, level === undefined ? undefined : { level });
}

export function inflate(
  data: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const out = unzlibSync(data);
  if (out.length > MAX_INFLATE_OUTPUT_BYTES) {
    throw new Error(
      `inflated output exceeds the ${MAX_INFLATE_OUTPUT_BYTES}-byte limit`,
    );
  }
  return out;
}

export interface InflateResult {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly recovered: boolean;
}

// A tolerant inflate for the read path: real-world PDF/PNG streams occasionally carry a leading whitespace byte, are mistakenly raw-DEFLATE under a zlib-labelled filter, or are truncated. Tries, in order: a plain inflate(); skipping leading whitespace and retrying; raw inflateSync (some producers mislabel raw DEFLATE as FlateDecode); and finally the streaming Unzlib class, which emits chunks as they're produced, so a mid-stream truncation still yields whatever decoded successfully before the failure (`recovered: true`) rather than nothing at all.
// Inflates straight into a buffer as long as the caller expects the output to be, plus one byte. A stream that decodes to no more than expectedLength bytes is then decoded once, with no buffer growth and no trimming copy, to exactly the bytes inflate returns (fflate writes the same bytes whatever buffer it writes them into). A stream that decodes to fewer bytes is copied into a buffer of its own length. Undefined when the stream does not decode or does not fit, which the spare byte filling up is how a too-long stream shows, for the caller to inflate it as before.
function inflateIntoExpectedLength(
  data: Uint8Array<ArrayBuffer>,
  expectedLength: number,
): Uint8Array<ArrayBuffer> | undefined {
  // An expectation the data could not possibly meet is not acted on: deflate expands at most DEFLATE_MAX_EXPANSION-fold, so a dictionary claiming a huge image over a tiny stream never buys a huge buffer. One that overstates what a stream holds still buys a buffer of the stated size, but never one past MAX_EXPECTED_LENGTH_BYTES, nor a larger one than a stream of the same length that really does decode that far costs without an expectation.
  if (
    !Number.isInteger(expectedLength) ||
    expectedLength < 0 ||
    expectedLength > MAX_EXPECTED_LENGTH_BYTES ||
    expectedLength > data.length * DEFLATE_MAX_EXPANSION
  ) {
    return undefined;
  }
  try {
    const out = unzlibSync(data, { out: new Uint8Array(expectedLength + 1) });
    if (out.length > expectedLength) {
      return undefined;
    }
    // A stream shorter than expected is copied out, so the buffer sized for the expectation is not kept alive behind a view onto its start.
    return out.length === expectedLength ? out : out.slice();
  } catch {
    return undefined;
  }
}

/**
 * Inflates a zlib stream, recovering what it can from a damaged one.
 * @param data - The zlib stream.
 * @param expectedLength - How long the caller expects the output to be (an image's rows of samples), if it knows. A stream that decodes to at most this many bytes is decoded into one buffer of that size (for an expectation of at most `MAX_EXPECTED_LENGTH_BYTES`), rather than one grown by doubling and then trimmed, which for a large image is most of what inflating it costs in memory; the bytes are the same either way, and a stream that does not fit is inflated as if no length were given.
 * @returns The inflated bytes, and whether recovery was needed.
 */
export function inflateTolerant(
  data: Uint8Array<ArrayBuffer>,
  expectedLength?: number,
): InflateResult {
  if (expectedLength !== undefined) {
    const sized = inflateIntoExpectedLength(data, expectedLength);
    if (sized !== undefined) {
      return { bytes: sized, recovered: false };
    }
  }
  try {
    return { bytes: inflate(data), recovered: false };
  } catch {
    // fall through to the recovery ladder below
  }

  let offset = 0;
  while (offset < data.length && isAsciiWhitespace(data[offset])) {
    offset++;
  }
  if (offset > 0) {
    try {
      return { bytes: inflate(data.subarray(offset)), recovered: true };
    } catch {
      // fall through
    }
  }

  try {
    return { bytes: inflateSync(data), recovered: true };
  } catch {
    // fall through
  }

  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const unzlib = new Unzlib((chunk) => {
    chunks.push(chunk);
  });
  try {
    // Pushed as NOT final: fflate only flushes decoded output incrementally as it's produced when a push is not marked as the stream's end — marking truncated data `final: true` instead makes it run the end-of-stream/checksum finalisation path, which throws atomically before emitting anything at all (verified empirically against fflate 0.8.3). Since this is already the last-resort recovery tier, skipping checksum verification here is an acceptable trade.
    unzlib.push(data, false);
  } catch {
    // whatever chunks were emitted before the throw are still valid partial output
  }
  if (chunks.length === 0) {
    throw new Error("unable to inflate stream: no data could be recovered");
  }
  return { bytes: concatBytes(chunks), recovered: true };
}
