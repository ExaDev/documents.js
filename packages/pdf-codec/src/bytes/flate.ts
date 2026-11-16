import { Inflate, Unzlib, inflateSync, unzlibSync, zlibSync } from "fflate";
import { OutputLimitExceededError } from "./output-limit";
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

// DEFLATE's largest expansion per input byte: a dynamic-Huffman block can give one length symbol (a 258-byte match) and its distance one bit each, so two bits of input yield 258 bytes of output, 1032 bytes per input byte (RFC 1951 3.2.5).
const MAX_DEFLATE_EXPANSION = 1032;
// The smallest input slice fed to the streaming inflater, so a nearly spent limit does not cost one push per input byte: one slice can then overshoot the limit by at most this many bytes times MAX_DEFLATE_EXPANSION (258 KiB), plus whatever a few buffered header bytes expand to.
const MIN_BOUNDED_SLICE_BYTES = 256;

type StreamingInflater = Inflate | Unzlib;

interface BoundedAttempt {
  readonly chunks: Uint8Array<ArrayBuffer>[];
  // Set when the inflater threw part-way (corrupt or truncated data), with `chunks` holding what it emitted before then.
  readonly failed: boolean;
}

// Feeds `data` to a streaming inflater in slices no larger than the remaining limit can absorb at DEFLATE's maximum expansion, so output is checked as it is produced and the limit stops the decode before it can materialise much more than the limit: an output that would pass `maxOutputBytes` throws OutputLimitExceededError out of the ondata callback, through the push. `final` is passed with the last slice, which is what makes the inflater verify the end of the stream (see inflateTolerant's last tier for why recovery passes false).
function boundedInflateAttempt(
  inflater: StreamingInflater,
  data: Uint8Array,
  final: boolean,
  maxOutputBytes: number,
): BoundedAttempt {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let produced = 0;
  inflater.ondata = (chunk) => {
    produced += chunk.length;
    if (produced > maxOutputBytes) {
      throw new OutputLimitExceededError(maxOutputBytes);
    }
    chunks.push(chunk);
  };
  let offset = 0;
  try {
    do {
      const slice = Math.max(
        MIN_BOUNDED_SLICE_BYTES,
        Math.floor((maxOutputBytes - produced) / MAX_DEFLATE_EXPANSION),
      );
      const end = Math.min(data.length, offset + slice);
      inflater.push(data.subarray(offset, end), final && end === data.length);
      offset = end;
    } while (offset < data.length);
  } catch (error) {
    if (error instanceof OutputLimitExceededError) {
      throw error;
    }
    return { chunks, failed: true };
  }
  return { chunks, failed: false };
}

// One of inflateTolerant's whole-stream tiers under a limit: the streaming inflater decodes it with the limit enforced as output appears; if that fails for any other reason, the tier's own synchronous function decides, as it does in inflateTolerant, since fflate's synchronous inflaters accept some ends of stream (a stream cut off inside its header or its final block) that the streaming ones reject. The streaming attempt failed having produced no more than the limit, and both decode the same bits up to where it failed, so the synchronous decode does a bounded amount of work, and its output is checked against the limit too. Undefined when the tier fails.
function boundedTier(
  inflater: StreamingInflater,
  inflateWhole: (data: Uint8Array) => Uint8Array<ArrayBuffer>,
  data: Uint8Array<ArrayBuffer>,
  maxOutputBytes: number,
): Uint8Array<ArrayBuffer> | undefined {
  const attempt = boundedInflateAttempt(inflater, data, true, maxOutputBytes);
  if (!attempt.failed) {
    return concatBytes(attempt.chunks);
  }
  let whole: Uint8Array<ArrayBuffer>;
  try {
    whole = inflateWhole(data);
  } catch {
    return undefined;
  }
  if (whole.length > maxOutputBytes) {
    throw new OutputLimitExceededError(maxOutputBytes);
  }
  return whole;
}

/**
 * inflateTolerant's recovery ladder with an output limit: the same four tiers in the same order (zlib, zlib after leading whitespace, raw DEFLATE, then whatever a truncated zlib stream yields), each decoding incrementally so it stops as soon as its output would pass `maxOutputBytes` rather than after materialising it. A tier that fails for any other reason falls through exactly as inflateTolerant's does, and its output is discarded. A tier whose output passes the limit refuses the stream there, even when it would have failed later and a later tier would have produced less: whether it succeeds is only known by finishing it, which is the work the limit exists to prevent, so the refusal errs on the side of the bound. The last tier feeds the stream in slices, so on a truncated stream it can recover a longer prefix of the decoded data than inflateTolerant's single push does; that output is still a prefix of the stream's own decoding, within the limit.
 * @param data - the zlib-framed (or mislabelled raw) DEFLATE stream
 * @param maxOutputBytes - the most bytes the decoded output may hold
 * @returns the decoded bytes, and whether any tier past the first produced them
 * @throws OutputLimitExceededError as soon as a tier's output would pass `maxOutputBytes`
 * @throws Error when no tier recovers any data, as inflateTolerant does
 */
export function inflateTolerantBounded(
  data: Uint8Array<ArrayBuffer>,
  maxOutputBytes: number,
): InflateResult {
  const plain = boundedTier(new Unzlib(), unzlibSync, data, maxOutputBytes);
  if (plain !== undefined) {
    return { bytes: plain, recovered: false };
  }

  let offset = 0;
  while (offset < data.length && isAsciiWhitespace(data[offset])) {
    offset++;
  }
  if (offset > 0) {
    const skipped = boundedTier(
      new Unzlib(),
      unzlibSync,
      data.subarray(offset),
      maxOutputBytes,
    );
    if (skipped !== undefined) {
      return { bytes: skipped, recovered: true };
    }
  }

  const raw = boundedTier(new Inflate(), inflateSync, data, maxOutputBytes);
  if (raw !== undefined) {
    return { bytes: raw, recovered: true };
  }

  const partial = boundedInflateAttempt(
    new Unzlib(),
    data,
    false,
    maxOutputBytes,
  );
  if (partial.chunks.length === 0) {
    throw new Error("unable to inflate stream: no data could be recovered");
  }
  return { bytes: concatBytes(partial.chunks), recovered: true };
}
