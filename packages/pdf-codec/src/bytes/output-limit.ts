/**
 * Thrown by a bounded decoder the moment its output would grow past the limit its caller set, before that output is materialised. It names only the limit, because a byte-level decoder knows nothing about the document the bytes came from: `decodeStream` (src/filters.ts) catches it at the one place a decode stage runs and reports the refusal as a `PdfDecodeBudgetError` carrying the stream's object number and filters.
 */
export class OutputLimitExceededError extends Error {
  readonly maxOutputBytes: number;

  constructor(maxOutputBytes: number) {
    super(
      `decoded output would exceed the ${String(maxOutputBytes)}-byte limit`,
    );
    this.name = "OutputLimitExceededError";
    this.maxOutputBytes = maxOutputBytes;
  }
}
