import { isCompoundFile } from '../cfb/detect';
import { startsWithMagic } from '../magic';

// ZIP's first four bytes are either a local file header signature ("PK\x03\x04") or, for an archive with zero entries, the end-of-central-directory record signature ("PK\x05\x06") -- a valid archive's leading bytes are always one of these two. Multi-disk spanning markers ("PK\x07\x08") prefix only multi-volume archives, which this package does not accept.
const ZIP_LOCAL_FILE_HEADER_MAGIC = [0x50, 0x4b, 0x03, 0x04] as const;
const ZIP_END_OF_CENTRAL_DIRECTORY_MAGIC = [0x50, 0x4b, 0x05, 0x06] as const;

// Detects the container formats this package reads: ZIP and the classic OLE compound file. tar and gzip remain deliberately out of scope (see README) and report 'unknown', never a false 'zip' or 'cfb'.
export type ArchiveFormat = 'zip' | 'cfb' | 'unknown';

export function isZipArchive(bytes: Uint8Array): boolean {
  return startsWithMagic(bytes, ZIP_LOCAL_FILE_HEADER_MAGIC) || startsWithMagic(bytes, ZIP_END_OF_CENTRAL_DIRECTORY_MAGIC);
}

export function detectArchiveFormat(bytes: Uint8Array): ArchiveFormat {
  if (isZipArchive(bytes)) {
    return 'zip';
  }
  return isCompoundFile(bytes) ? 'cfb' : 'unknown';
}
