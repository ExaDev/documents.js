// Thrown when content cannot be expressed as a conformant BIFF8 byte stream: a record whose data would exceed the single-record 8224-byte ceiling ([MS-XLS] 2.1.4) with no Continue-chain splitting implemented, a string or format code longer than its own length field can hold, an error value with no BIFF8 code, or a date/time value with no serial representation in the epoch being written. A distinct class from BiffFormatError, which describes bytes that failed to parse -- this describes content the writer refuses to attempt, because a plausible-looking file that silently truncates or corrupts data is worse than an explicit failure.
export class BiffWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BiffWriteError";
  }
}
