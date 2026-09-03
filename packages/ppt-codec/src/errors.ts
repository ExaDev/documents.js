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

// Thrown on the write path when the caller's content asks for something ppt-codec's writer cannot express: a document that is not a presentation, slides that do not share the one slide size [MS-PPT]'s DocumentAtom states for the whole presentation, or similar. Distinct from both errors above -- the input is neither malformed bytes (PptFormatError) nor an unreadable-but-valid file (PptEncryptedError), it is well-formed content whose shape sits outside this writer's deliberately narrower scope, documented in the README's write-scope section. A block kind the writer does not represent (an image, a table, a construct marker) is not this error: it is silently dropped from the written text body, the same documented-gap convention the reader already uses for its own unsupported constructs.
export class PptUnsupportedContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PptUnsupportedContentError";
  }
}
