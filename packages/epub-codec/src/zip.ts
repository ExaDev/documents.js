import { unzipSync, zipSync, type Zippable } from "fflate";

// This package's own OCF ZIP layer, deliberately a third hand-written copy of the identical fixed-mtime/ordered-entries wrapper ooxml.js's and odf.js's own src/zip.ts each carry, not a dependency on archive-codec's structurally-identical zip/container.ts. Two reasons, stated once here since every sibling codec makes the same call independently:
//
// 1. Precedent. Every existing format codec in this family (ooxml.js, odf.js) hand-duplicates this exact wrapper rather than depending on a shared package for it -- odf.js's own README states the reasoning explicitly: keeping each codec's release cadence decoupled from a package it would otherwise need to bump in lockstep with. archive-codec itself mirrors rather than imports those two wrappers for the identical reason. A brand-new codec joining that family is the same case again, not a different one.
// 2. Determinism. archive-codec's own zip/container.ts -- checked directly, and NOT a dependency of this package -- does not set a fixed mtime on written entries (nothing in this family writes through it today, so the gap has never mattered before), so two builds of the identical EPUB straddling a DOS-timestamp second boundary would differ in bytes -- undermining exactly the byte-deterministic output ExaDev/documents.js#801 asks for (OCF's own mimetype-first/stored-uncompressed layout, matching the family's reproducible-serialisation doctrine). Reusing archive-codec's writer as-is would need a mtime-forwarding change to a package this codec would otherwise have no reason to depend on; hand-writing the ~15-line wrapper this family already has two copies of is simpler than either forking archive-codec's own contract or asking it to grow an option this codec is the only caller of.
//
// archive-codec remains genuinely useful elsewhere in this family (ZIP-in-ZIP walking, CFB reading) -- neither of which this package needs, since a flowable EPUB is a flat OCF container with no nested-archive or compound-file embedding to recurse into.

export interface ZipEntry {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly stored?: boolean;
}

// fflate is synchronous, isomorphic, and dependency-free.
export function unzipPackage(
  bytes: Uint8Array<ArrayBuffer>,
): Record<string, Uint8Array<ArrayBuffer>> {
  return unzipSync(bytes);
}

// The fixed entry timestamp every written EPUB carries. fflate's default mtime is the wall clock, which would make two serialisations of the same content differ in bytes whenever they straddle a 2-second DOS-timestamp boundary -- undermining the byte-layout determinism this module exists to pin (see zipPackage's own note). The DOS epoch minimum is the conventional reproducible-zip choice, matching ooxml.js's and odf.js's own identical constant: these are freshly built packages, never restorations of a producer's own archive, so no real timestamp is lost.
const FIXED_ENTRY_MTIME = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));

// Takes an ORDERED array of [path, entry] tuples, not a Record, so the caller controls the exact emission order deterministically. This is what makes OCF's "mimetype" part -- which must be the very first byte-for-byte entry in the zip, stored uncompressed (EPUB 3.3 section 6.3) -- possible to guarantee: a Record's key order surviving a Zod parse/round trip is not a guarantee this format's correctness can depend on, so src/write.ts builds this ordered array explicitly, with the mimetype entry hoisted to the front, before calling zipPackage. zipSync itself iterates a plain object's own string keys in insertion order (a JS-spec guarantee for non-integer-like keys), so building that object here, in the caller-supplied order, in a single synchronous pass, is what actually pins the resulting byte layout.
export function zipPackage(
  entries: readonly (readonly [string, ZipEntry])[],
): Uint8Array<ArrayBuffer> {
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
