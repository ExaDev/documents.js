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

// The header's encryption word is non-zero. Corel's own wording: "nothing beyond the file header will be intelligible to an application program" -- so there is no partial read to offer, and this throws rather than returning the header alone. Source: WPFF Document Structure, "Encryption field".
export class WpdEncryptedDocumentError extends WpdFormatError {
  constructor(message: string) {
    super(message);
    this.name = "WpdEncryptedDocumentError";
  }
}

// The header's product type, file type, or major version is outside what this reader covers: WordPerfect (product 1) documents (file type 0x0A or 0x24) of major version 2, the single lineage Corel's SDK states is "structured the same" from WordPerfect 6.x through X6. A WP 5.x file carries the same file ID with a different major version, so it reaches this error rather than being misparsed as a 6.x file. Source: WPFF Document Structure, "Major Version and Minor Version Fields".
export class WpdUnsupportedVersionError extends WpdFormatError {
  constructor(message: string) {
    super(message);
    this.name = "WpdUnsupportedVersionError";
  }
}
