// ZIP's first four bytes are either a local file header signature ("PK\x03\x04") or, for an archive with zero entries, the end-of-central-directory record signature ("PK\x05\x06") -- a valid archive's leading bytes are always one of these two. Multi-disk spanning markers ("PK\x07\x08") prefix only multi-volume archives, which this package does not accept.
const ZIP_LOCAL_FILE_HEADER_MAGIC = [0x50, 0x4b, 0x03, 0x04] as const;
const ZIP_END_OF_CENTRAL_DIRECTORY_MAGIC = [0x50, 0x4b, 0x05, 0x06] as const;

function startsWithMagic(bytes: Uint8Array, magic: readonly number[]): boolean {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
}

// v1 detects ZIP only; tar and gzip are deliberately out of scope (see README) and report 'unknown', never a false 'zip'.
export type ArchiveFormat = 'zip' | 'unknown';

export function isZipArchive(bytes: Uint8Array): boolean {
  return startsWithMagic(bytes, ZIP_LOCAL_FILE_HEADER_MAGIC) || startsWithMagic(bytes, ZIP_END_OF_CENTRAL_DIRECTORY_MAGIC);
}

export function detectArchiveFormat(bytes: Uint8Array): ArchiveFormat {
  return isZipArchive(bytes) ? 'zip' : 'unknown';
}
