import { unzipSync, zipSync, type Zippable } from 'fflate';

// A single zip entry's bytes, plus whether it must be stored uncompressed (compression method 0, DEFLATE level 0) rather than deflated. ODF's mimetype part requires this -- see package-io/write.ts.
export interface ZipEntry {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly stored?: boolean;
}

// fflate is synchronous, isomorphic, and dependency-free.
export function unzipPackage(bytes: Uint8Array<ArrayBuffer>): Record<string, Uint8Array<ArrayBuffer>> {
  return unzipSync(bytes);
}

// The fixed entry timestamp every written zip carries. fflate's default mtime is the wall clock, which would make two serialisations of the same parts differ in bytes whenever they straddle a 2-second DOS-timestamp boundary -- undermining the byte-layout determinism this module exists to pin (see zipPackage's own note). The DOS epoch minimum is the conventional reproducible-zip choice: these are freshly built packages, never restorations of a producer's own archive, so no real timestamp is lost.
const FIXED_ENTRY_MTIME = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));

// Takes an ORDERED array of [path, entry] tuples, not a Record, so the caller controls the exact emission order deterministically. This is what makes ODF's "mimetype" part -- which must be the very first byte-for-byte entry in the zip, stored uncompressed -- possible to guarantee: a Record's key order surviving a Zod parse/round trip (see model/package.ts's PackageSchema, which stores parts in a z.record) is not a guarantee this format's correctness can depend on, so package-io/write.ts builds this ordered array explicitly, with the mimetype part (and META-INF/manifest.xml, if present) hoisted to the front, before calling zipPackage. zipSync itself iterates a plain object's own string keys in insertion order (a JS-spec guarantee for non-integer-like keys), so building that object here, in the caller-supplied order, in a single synchronous pass, is what actually pins the resulting byte layout.
export function zipPackage(entries: readonly (readonly [string, ZipEntry])[]): Uint8Array<ArrayBuffer> {
  const data: Zippable = {};
  for (const [path, entry] of entries) {
    if (entry.stored === true) {
      data[path] = [entry.bytes, { level: 0, mtime: FIXED_ENTRY_MTIME }];
    } else {
      data[path] = [entry.bytes, { mtime: FIXED_ENTRY_MTIME }];
    }
  }
  return zipSync(data);
}
