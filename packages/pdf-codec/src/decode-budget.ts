import { PdfParseError } from "./diagnostics";

/**
 * The stream a decode was charged for: its indirect object number when it has one (undefined for an inline image, or a stream a caller built itself), and its `/Filter` chain in order.
 */
export interface PdfDecodeSource {
  readonly objectNumber: number | undefined;
  readonly filters: readonly string[];
}

/**
 * A decode refused because its output would have taken the document past its decode budget (`maxDecodedBytes` on `readPdf`, `renderPdfPage` or `openPdfDocument`, or a `PdfDecodeBudget` handed to `decodeStream`). It is the throw tier for "too much work", not for a malformed file: the stream may be perfectly well formed, so a caller can tell the two apart by class (or by its code, `pdf/decode-budget-exceeded`) and retry with a larger budget, or refuse the file, as it chooses.
 *
 * `maxDecodedBytes` is the budget, `decodedBytes` what the document had already decoded before this stream, `objectNumber` the refused stream's object number (undefined for an inline image) and `filters` its `/Filter` chain.
 */
export class PdfDecodeBudgetError extends PdfParseError {
  readonly maxDecodedBytes: number;
  readonly decodedBytes: number;
  readonly objectNumber: number | undefined;
  readonly filters: readonly string[];

  constructor(
    maxDecodedBytes: number,
    decodedBytes: number,
    source: PdfDecodeSource,
  ) {
    const stream =
      source.objectNumber === undefined
        ? "an inline stream"
        : `stream object ${String(source.objectNumber)}`;
    const chain =
      source.filters.length === 0 ? "no filter" : source.filters.join(", ");
    super(
      "pdf/decode-budget-exceeded",
      `decoding ${stream} (${chain}) would take this document past its ${String(maxDecodedBytes)}-byte decode budget, of which ${String(decodedBytes)} bytes were already spent`,
    );
    this.name = "PdfDecodeBudgetError";
    this.maxDecodedBytes = maxDecodedBytes;
    this.decodedBytes = decodedBytes;
    this.objectNumber = source.objectNumber;
    this.filters = source.filters;
  }
}

/**
 * A running total of the bytes a document's stream decoding has produced, against a fixed maximum. Every filter stage's output is charged (a stream under `[/ASCII85Decode /FlateDecode]` pays for both stages), and every decode is charged when it happens, so a stream decoded twice (one font program two font dictionaries name) pays twice, while one decoded once and cached (an object stream) pays once.
 *
 * Once a decode has been refused the budget is spent: every later decode with any output is refused too, so a conversion cannot carry on past the first refusal even through a caller that caught the error.
 */
export class PdfDecodeBudget {
  readonly maxDecodedBytes: number;
  #decodedBytes = 0;
  #spent = false;

  /**
   * @param maxDecodedBytes - the most bytes decoding may produce, a non-negative safe integer
   * @throws RangeError when `maxDecodedBytes` is negative, fractional, or not a safe integer
   */
  constructor(maxDecodedBytes: number) {
    if (!Number.isSafeInteger(maxDecodedBytes) || maxDecodedBytes < 0) {
      throw new RangeError(
        `maxDecodedBytes must be a non-negative safe integer, not ${String(maxDecodedBytes)}`,
      );
    }
    this.maxDecodedBytes = maxDecodedBytes;
  }

  /** The bytes charged so far. */
  get decodedBytes(): number {
    return this.#decodedBytes;
  }

  /** The bytes the next decode may still produce: zero once a decode has been refused. */
  get remainingBytes(): number {
    return this.#spent ? 0 : this.maxDecodedBytes - this.#decodedBytes;
  }

  /**
   * Charges one decode's output.
   * @param bytes - the bytes the decode produced, or is about to produce when its size is known in advance
   * @param source - the stream being decoded, named in the error
   * @throws PdfDecodeBudgetError when `bytes` is more than `remainingBytes`, after which the budget is spent
   */
  charge(bytes: number, source: PdfDecodeSource): void {
    if (bytes > this.remainingBytes) {
      this.refuse(source);
    }
    this.#decodedBytes += bytes;
  }

  /**
   * Refuses a decode whose output is known to pass the budget, or cannot be bounded at all, and spends the budget.
   * @param source - the stream being decoded, named in the error
   * @throws PdfDecodeBudgetError always
   */
  refuse(source: PdfDecodeSource): never {
    this.#spent = true;
    throw new PdfDecodeBudgetError(
      this.maxDecodedBytes,
      this.#decodedBytes,
      source,
    );
  }
}
