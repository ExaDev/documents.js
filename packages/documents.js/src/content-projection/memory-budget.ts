/** Why a part was not processed. */
export type SkipReason = "exceeds-memory-budget";

/**
 * The memory one XML part costs while it is processed, and what its result keeps afterwards, both per byte of the part's uncompressed size. `transient` covers the decoded string, the scanner's work and the canonical form being built; `retained` is what a projection keeps (resolved cell text, word counts), and is zero for a pass that keeps only digests.
 *
 * The factors are measured on synthetic parts by `scripts/measure-memory-factors.mjs` in this package, which prints the same two numbers from a fresh run, so a change to the scanner or to what a projection keeps is re-derived instead of guessed. They count the process's resident memory, not the V8 heap alone: Node holds a large decoded string and every inflated part outside the heap. Each is the measured maximum across the script's synthetic parts, rounded up to a whole number.
 */
export interface MemoryFactors {
  readonly transientBytesPerByte: number;
  readonly retainedBytesPerByte: number;
}

/**
 * Accounts a caller-chosen memory allowance across the parts of one package. Parts are processed one at a time, so a part is admitted when the allowance still covers its transient cost on top of everything the earlier parts retained; otherwise it is skipped and the skip is recorded. The caller names the allowance (it knows its own heap limit), so no default is invented here.
 */
export class MemoryBudget {
  readonly #allowance: number;
  #retained = 0;

  constructor(allowanceBytes: number) {
    if (!Number.isFinite(allowanceBytes) || allowanceBytes <= 0) {
      throw new RangeError("memoryBudgetBytes must be a positive number");
    }
    this.#allowance = allowanceBytes;
  }

  /** Reserves the retained cost and returns true when the part fits; returns false and reserves nothing otherwise. */
  admit(partBytes: number, factors: MemoryFactors): boolean {
    const retained = partBytes * factors.retainedBytesPerByte;
    const peak =
      this.#retained + retained + partBytes * factors.transientBytesPerByte;
    if (peak > this.#allowance) {
      return false;
    }
    this.#retained += retained;
    return true;
  }
}

/** The factors for `canonicalizeOpcPackage`, which keeps only digests. */
export const CANONICALISATION_FACTORS: MemoryFactors = {
  transientBytesPerByte: 58,
  retainedBytesPerByte: 0,
};

/** The factors for the content projections, which keep resolved text and counts. */
export const PROJECTION_FACTORS: MemoryFactors = {
  transientBytesPerByte: 8,
  retainedBytesPerByte: 4,
};

/**
 * The factors for digesting a part that is not XML. Structural, not measured: the inflated part, the copy handed to the digest and the inflater's own output buffer are each one byte per byte, and nothing is retained but a fixed-width digest.
 */
export const BINARY_DIGEST_FACTORS: MemoryFactors = {
  transientBytesPerByte: 3,
  retainedBytesPerByte: 0,
};
