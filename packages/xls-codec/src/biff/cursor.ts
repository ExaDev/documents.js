import { BiffFormatError } from "./records";

/** u8()'s own context label — reused, not restated, by take()'s per-byte copy loop below: once take()'s own upfront remainingTotal() check has passed, that loop's nextByte() call can never actually run out (there are provably at least `count` bytes left across the blocks it is about to walk), so its label has nothing of its own to name and borrows the one real caller's already-exercised text instead of building an independent, permanently unobservable template literal every copy. */
const U8_CONTEXT = "u8";

// A field-reading cursor over one record's data, or over a base record's data followed by its Continue records' ([MS-XLS] 2.4.58) — one sequence of blocks read as if it were contiguous, while still knowing where each block ends.
//
// Both halves of that matter. Reads span a block boundary transparently, because a record's fields do not stop where a Continue happens to split them. But the boundary stays observable, because for a string ([MS-XLS] 2.5.293) the first byte after a boundary is a re-stated fHighByte flag rather than character data — so the string reader needs to ask "did I just cross into a new block?" mid-field. A plain concatenation of the blocks would answer that question with silence and splice the flag byte into the text; see biff/strings.ts for the reader that consumes the boundary correctly.

export class BlockCursor {
  private readonly blocks: readonly Uint8Array<ArrayBuffer>[];
  private blockIndex = 0;
  private offset = 0;

  constructor(blocks: readonly Uint8Array<ArrayBuffer>[]) {
    this.blocks = blocks;
    // No settle() call here: every public method below (hasMore, remainingInBlock, blockPosition, nextByte) already calls it as its own first step, so a freshly constructed cursor needs no separate normalisation pass before its first use — one that ran here would only ever redo what the first real call does anyway.
  }

  /** Advances past any exhausted or empty blocks, so the cursor always rests either on a readable byte or past the end of the last block. A Continue carrying no data is legal and must not read as the end of the record. */
  private settle(): void {
    while (
      this.blockIndex < this.blocks.length &&
      this.offset >= (this.blocks[this.blockIndex]?.length ?? 0)
    ) {
      this.blockIndex += 1;
      this.offset = 0;
    }
  }

  private nextByte(context: string): number {
    this.settle();
    // One absence check covers both ways this can run out: no block left at all, or (impossible in practice, since settle() above already guarantees offset < block.length whenever a block IS left, but not a distinction noUncheckedIndexedAccess's own typing can see) an in-range block with nothing at this offset. Folding them into the optional-chained lookup's own single undefined case is what keeps this to one throw and one reachable message, rather than a second copy the first branch already made unreachable.
    const byte = this.blocks[this.blockIndex]?.[this.offset];
    if (byte === undefined) {
      throw new BiffFormatError(
        `${context} runs past the end of the record data`,
      );
    }
    this.offset += 1;
    return byte;
  }

  /** Whether any unread byte remains, in this block or a later one. */
  hasMore(): boolean {
    this.settle();
    return this.blockIndex < this.blocks.length;
  }

  /** How many unread bytes remain in the block the cursor currently rests in — the distance to the next continuation boundary, which a string's character run must not cross without consuming a new flag byte. */
  remainingInBlock(): number {
    this.settle();
    const block = this.blocks[this.blockIndex];
    return block === undefined ? 0 : block.length - this.offset;
  }

  /** The index of the block the cursor currently rests in, so a caller can detect that a read crossed into a new one. */
  blockPosition(): number {
    this.settle();
    return this.blockIndex;
  }

  u8(): number {
    return this.nextByte(U8_CONTEXT);
  }

  u16(): number {
    const low = this.nextByte("u16");
    const high = this.nextByte("u16");
    return low | (high << 8);
  }

  u32(): number {
    // Composed with multiplication rather than `<< 24`, which would produce a signed result for any value with the top bit set.
    const low = this.u16();
    const high = this.u16();
    return low + high * 0x10000;
  }

  i32(): number {
    return this.u32() | 0;
  }

  /** A signed 16-bit integer, sign-extended by shifting the raw value out of and back into the low 16 bits — what XTI's itabFirst/itabLast ([MS-XLS] 2.5.344) and a handful of other structures carry. */
  i16(): number {
    return (this.u16() << 16) >> 16;
  }

  /** An Xnum ([MS-XLS] 2.5.342): a little-endian IEEE 754 double. */
  f64(): number {
    const raw = this.take(8);
    return new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getFloat64(
      0,
      true,
    );
  }

  /** Total unread bytes across the current block and every block after it — what a length-prefixed field's own prefix must be checked against before that many bytes are allocated, so a record cannot claim a length far larger than the data actually behind it. remainingInBlock() is read FIRST and the later blocks sliced off `this.blockIndex` only afterwards, so a cursor sitting exactly on an exhausted block (offset === that block's own length, reached mid-read rather than only at construction) settles before either figure is taken — computing the slice first would capture the stale, pre-settle index instead. */
  private remainingTotal(): number {
    const inCurrentBlock = this.remainingInBlock();
    const rest = this.blocks
      .slice(this.blockIndex + 1)
      .reduce((sum, block) => sum + block.length, 0);
    return inCurrentBlock + rest;
  }

  /** The next `count` bytes, copied out. Spans block boundaries. Rejects a `count` larger than the data actually remaining before allocating, so a length-prefixed field taken from untrusted input (e.g. CFEx's own `cbDxf`) cannot force a multi-gigabyte allocation from a tiny record. */
  take(count: number): Uint8Array<ArrayBuffer> {
    if (count > this.remainingTotal()) {
      throw new BiffFormatError(
        `${count}-byte run requests more data than remains in the record`,
      );
    }
    const out = new Uint8Array(count);
    for (let index = 0; index < count; index += 1) {
      out[index] = this.nextByte(U8_CONTEXT);
    }
    return out;
  }

  /** Advances `count` bytes without materialising them — for a field this package reads past rather than reads. */
  skip(count: number): void {
    for (let index = 0; index < count; index += 1) {
      this.nextByte(`${count}-byte skip`);
    }
  }
}
