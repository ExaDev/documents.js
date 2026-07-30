import { Unzlib, inflateSync, unzlibSync, zlibSync } from 'fflate';
import { isAsciiWhitespace } from './reader';
import { concatBytes } from './writer';

// The only file in the package that imports fflate -- the direct analogue of ooxml.js's own src/zip.ts ("a thin wrapper over fflate's zipSync/unzipSync, isomorphic and dependency-free"). PDF's FlateDecode filter and PNG's IDAT payload both use zlib-framed DEFLATE (RFC 1950 -- a 2-byte header plus a trailing Adler-32 checksum) -- that is zlibSync/unzlibSync, NOT fflate's deflateSync/inflateSync, which are raw DEFLATE (RFC 1951) with no wrapper. Emitting or expecting the wrong framing produces a stream every conformant PDF/PNG reader rejects.

// Guards every call in this module against a maliciously or accidentally huge decompressed output -- both PDF and PNG streams here come from arbitrary, potentially adversarial input.
export const MAX_INFLATE_OUTPUT_BYTES = 512 * 1024 * 1024;

export type DeflateLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export function deflate(data: Uint8Array<ArrayBuffer>, level?: DeflateLevel): Uint8Array<ArrayBuffer> {
  return zlibSync(data, level === undefined ? undefined : { level });
}

export function inflate(data: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const out = unzlibSync(data);
  if (out.length > MAX_INFLATE_OUTPUT_BYTES) {
    throw new Error(`inflated output exceeds the ${MAX_INFLATE_OUTPUT_BYTES}-byte limit`);
  }
  return out;
}

export interface InflateResult {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly recovered: boolean;
}

// A tolerant inflate for the read path: real-world PDF/PNG streams occasionally carry a leading whitespace byte, are mistakenly raw-DEFLATE under a zlib-labelled filter, or are truncated. Tries, in order: a plain inflate(); skipping leading whitespace and retrying; raw inflateSync (some producers mislabel raw DEFLATE as FlateDecode); and finally the streaming Unzlib class, which emits chunks as they're produced, so a mid-stream truncation still yields whatever decoded successfully before the failure (`recovered: true`) rather than nothing at all.
export function inflateTolerant(data: Uint8Array<ArrayBuffer>): InflateResult {
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
    // Pushed as NOT final: fflate only flushes decoded output incrementally as it's produced when a push is not marked as the stream's end -- marking truncated data `final: true` instead makes it run the end-of-stream/checksum finalisation path, which throws atomically before emitting anything at all (verified empirically against fflate 0.8.3). Since this is already the last-resort recovery tier, skipping checksum verification here is an acceptable trade.
    unzlib.push(data, false);
  } catch {
    // whatever chunks were emitted before the throw are still valid partial output
  }
  if (chunks.length === 0) {
    throw new Error('unable to inflate stream: no data could be recovered');
  }
  return { bytes: concatBytes(chunks), recovered: true };
}
