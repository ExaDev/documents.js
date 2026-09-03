// Thrown when input claiming to be a PowerPoint 97-2003 binary file does not conform to [MS-PPT]: a record header that cannot be read, a record whose declared length runs past its container, a required stream that is absent, a persist reference with no directory entry, or an atom whose fixed size the spec mandates and the file disagrees with. A distinct error class (rather than a plain Error) because malformed-input detection is half this package's contract -- a consumer must be able to catch structural failure by name and decide its own degradation, rather than parse a message string. It deliberately does not wrap archive-codec's CompoundFileFormatError: a failure in the container below this format is that package's own failure, and re-labelling it would hide which layer actually rejected the file.
export class PptFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PptFormatError";
  }
}

// Thrown when a file is a structurally valid [MS-PPT] document that this package cannot read the content of because it is encrypted -- the CurrentUserAtom's headerToken says so ([MS-PPT] 2.3.2: 0xF3D1C4DF means "the file MUST be an encrypted document"). Separate from PptFormatError because the file is not malformed at all: it is well-formed and deliberately unreadable without a key, which is a different thing for a caller to report to a user than corruption.
export class PptEncryptedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PptEncryptedError";
  }
}
