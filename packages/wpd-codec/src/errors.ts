// Every failure this package raises is a subclass of WpdFormatError, so a caller can catch one type and still discriminate on the specific cause. Nothing here is recoverable-by-fallback: a WordPerfect file whose prefix or function stream does not conform is malformed input, and returning a partial document that looks complete would hide exactly the corruption the caller needs to see.
export class WpdFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WpdFormatError";
  }
}

// The file's first four bytes are not the -1,"WPC" file ID (0xFF 0x57 0x50 0x43) that every WordPerfect 5.0-and-later document carries, and no PerfectOffice_MAIN stream inside an OLE compound wrapper carried it either. Source: WPFF Document Structure, "File ID Field".
export class WpdNotAWordPerfectFileError extends WpdFormatError {
  constructor(message: string) {
    super(message);
    this.name = "WpdNotAWordPerfectFileError";
  }
}

// The header's encryption word is non-zero and the caller supplied no password. Corel's own wording: "nothing beyond the file header will be intelligible to an application program" -- so there is no partial read to offer, and this throws rather than returning the header alone. Source: WPFF Document Structure, "Encryption field".
export class WpdEncryptedDocumentError extends WpdFormatError {
  constructor(message: string) {
    super(message);
    this.name = "WpdEncryptedDocumentError";
  }
}

// A password was supplied for an encrypted document, but the 16-bit checksum the header's encryption word carries does not match the checksum of that password (see src/container/encryption.ts for where both come from). The message deliberately names both readings of a mismatch, because the header word cannot distinguish them: either the password is wrong, or the file uses WordPerfect 9-and-later "enhanced encryption" -- a different, unpublished cipher whose header word is not a standard-mode password checksum -- which this reader does not support at all.
export class WpdWrongPasswordError extends WpdFormatError {
  // The header's own word and the password's computed checksum, carried so a caller can distinguish the two mismatch readings only a human can settle (retry with another password vs an unsupported file) without parsing the message.
  constructor(
    readonly headerEncryptionWord: number,
    readonly passwordChecksum: number,
  ) {
    super(
      `The header's encryption word (0x${headerEncryptionWord.toString(16)}) does not match this password's checksum (0x${passwordChecksum.toString(16)}): either the password is wrong, or the file uses the enhanced encryption mode (WordPerfect 9 and later), which this reader does not support.`,
    );
    this.name = "WpdWrongPasswordError";
  }
}

// The header's product type, file type, or major version is outside what this reader covers: WordPerfect (product 1) documents (file type 0x0A or 0x24) of major version 2, the single lineage Corel's SDK states is "structured the same" from WordPerfect 6.x through X6. A WP 5.x file carries the same file ID with a different major version, so it reaches this error rather than being misparsed as a 6.x file. Source: WPFF Document Structure, "Major Version and Minor Version Fields".
export class WpdUnsupportedVersionError extends WpdFormatError {
  constructor(message: string) {
    super(message);
    this.name = "WpdUnsupportedVersionError";
  }
}
