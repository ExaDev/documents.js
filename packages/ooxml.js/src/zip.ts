import { unzipSync, zipSync } from 'fflate';

// fflate is synchronous, isomorphic, and dependency-free.
export function unzipPackage(bytes: Uint8Array<ArrayBuffer>): Record<string, Uint8Array<ArrayBuffer>> {
  return unzipSync(bytes);
}

export function zipPackage(parts: Record<string, Uint8Array<ArrayBuffer>>): Uint8Array<ArrayBuffer> {
  return zipSync(parts);
}
