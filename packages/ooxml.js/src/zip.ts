import { unzipSync, zipSync, type Zippable, type ZipOptions } from 'fflate';

// fflate is synchronous, isomorphic, and dependency-free.
export function unzipPackage(bytes: Uint8Array<ArrayBuffer>): Record<string, Uint8Array<ArrayBuffer>> {
  return unzipSync(bytes);
}

// The fixed entry timestamp every written zip carries. fflate's default mtime is the wall clock, which would make two serialisations of the same parts differ in bytes whenever they straddle a 2-second DOS-timestamp boundary -- and byte-identical output for identical input is a load-bearing invariant here, not polish: the docx writer deduplicates copy-pasted embedded objects by comparing their serialised payloads, so a wall-clock timestamp leaking into those bytes silently splits one shared embeddings part into duplicates. The DOS epoch minimum is the conventional reproducible-zip choice: these are freshly built packages, never restorations of a producer's own archive, so no real timestamp is lost.
const FIXED_ENTRY_MTIME = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));

export function zipPackage(parts: Record<string, Uint8Array<ArrayBuffer>>): Uint8Array<ArrayBuffer> {
  const data: Zippable = {};
  for (const [path, bytes] of Object.entries(parts)) {
    const options: ZipOptions = { mtime: FIXED_ENTRY_MTIME };
    data[path] = [bytes, options];
  }
  return zipSync(data);
}
