import { unzipSync, zipSync } from 'fflate';

// fflate is synchronous, isomorphic, and dependency-free. Its bundled types predate generic TypedArrays and report Uint8Array<ArrayBufferLike>, but it only ever allocates a regular ArrayBuffer backing store, so its results are safe to narrow.
export function unzipPackage(bytes: Uint8Array<ArrayBuffer>): Record<string, Uint8Array<ArrayBuffer>> {
  return unzipSync(bytes) as Record<string, Uint8Array<ArrayBuffer>>;
}

export function zipPackage(parts: Record<string, Uint8Array<ArrayBuffer>>): Uint8Array<ArrayBuffer> {
  return zipSync(parts) as Uint8Array<ArrayBuffer>;
}
