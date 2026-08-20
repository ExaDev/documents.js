import { unzipSync, zipSync, type Zippable } from 'fflate';

// A single zip entry's bytes, plus whether it must be stored uncompressed (compression method 0, DEFLATE level 0) rather than deflated. Formats with a fixed-offset identity part need this -- ODF's mimetype entry is the family's live example (see odf.js). archive-codec's own reading imposes no such layout, but the container keeps the family's stored-entry capability so a shared consumer can build those packages through this one wrapper unchanged.
export interface ZipEntry {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly stored?: boolean;
}

// fflate is synchronous, isomorphic, and dependency-free. The returned Record makes no ordering promise and collapses duplicate entry paths (Record keys); the ordered-tuple write side below is this package's byte-layout-ordering surface.
export function unzipPackage(bytes: Uint8Array<ArrayBuffer>): Record<string, Uint8Array<ArrayBuffer>> {
  return unzipSync(bytes);
}

// Takes an ORDERED array of [path, entry] tuples, not a Record, so the caller controls the exact emission order deterministically. This is what lets a format pin "this part must be the very first entry in the zip" (ODF's mimetype, stored uncompressed): a Record's key order surviving a JSON parse/round trip is not a guarantee a format's correctness can depend on, so the caller builds this ordered array explicitly and zipSync iterates the object built here, in the caller-supplied order, in a single synchronous pass -- zipSync iterates a plain object's own string keys in insertion order, a JS-spec guarantee for non-integer-like keys, which is what actually pins the resulting byte layout.
export function zipPackage(entries: readonly (readonly [string, ZipEntry])[]): Uint8Array<ArrayBuffer> {
  const data: Zippable = {};
  for (const [path, entry] of entries) {
    if (entry.stored === true) {
      data[path] = [entry.bytes, { level: 0 }];
    } else {
      data[path] = entry.bytes;
    }
  }
  return zipSync(data);
}
