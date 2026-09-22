// Thrown when input claiming to be a Word Binary File does not conform to [MS-DOC]: a bad FIB signature, a structure whose declared size does not divide into a whole number of elements, an offset outside the stream it is declared to live in, or a feature this reader deliberately refuses rather than guessing at (an encrypted document). A distinct error class — rather than a plain Error — because malformed-input detection is half of a binary parser's contract: a consumer must be able to catch structural failure by name and decide its own degradation, rather than parse a message string. Mirrors archive-codec's CompoundFileFormatError, which this package's own container layer already throws.
export class DocFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocFormatError";
  }
}

// Thrown for a document this reader understands structurally but cannot yet convert — distinct from DocFormatError, which means the bytes are wrong. The split matters to a consumer: a DocFormatError is a broken or non-.doc file and there is nothing to retry, while a DocUnsupportedError names a real [MS-DOC] feature this package has not implemented, so the same bytes may convert after a later release. Silent degradation is never the alternative: this package refuses loudly rather than emitting a document whose content quietly differs from the file's.
export class DocUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocUnsupportedError";
  }
}

// Narrows a value a caller has already proven cannot genuinely be undefined at its own call site, throwing loudly rather than silently substituting a sentinel if that proof is ever wrong — the writer-side counterpart to this package's read-side malformed-input checks, for an invariant the writer's own logic maintains rather than one the input bytes could violate. Exported for this package's own tests only: a real caller reaches it only where its own invariant already holds, never through input a caller could make fail.
export function assertDefined<T>(
  value: T | undefined,
  message: string,
): asserts value is T {
  if (value === undefined) {
    throw new DocFormatError(message);
  }
}
