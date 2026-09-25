// A little-endian field builder for one record's data, the write-side mirror of biff/cursor.ts's BlockCursor. Every multi-byte integer in a BIFF8 stream is little-endian ([MS-XLS] 1.3.1), so this is the one place that encoding is chosen — everything above it calls u8/u16/u32/f64/bytes and never touches a byte offset directly.
//
// Segments are kept as separate Uint8Array parts and concatenated once in build(), rather than pushed byte-by-byte into a single growing array or spread into it: a spread (`array.push(...bytes)`) blows the engine's argument-count limit for a large byte run (the same hazard biff/strings.ts's readCharacters comment notes for String.fromCharCode), which a shared string table's long strings can realistically reach.

// Little-endian byte assembly: each byte's own place value is 8 bits.
const BYTE_MASK = 0xff;
const WORD_MASK = 0xffff;
const BITS_PER_BYTE = 8;
const DOUBLE_BITS_PER_BYTE = 16;
const TRIPLE_BITS_PER_BYTE = 24;
const DOUBLE_BYTE_LENGTH = 8;
export class RecordBuilder {
  private readonly parts: Uint8Array<ArrayBuffer>[] = [];

  private pushBytes(...bytes: readonly number[]): this {
    this.parts.push(new Uint8Array(bytes));
    return this;
  }

  u8(value: number): this {
    return this.pushBytes(value & BYTE_MASK);
  }

  u16(value: number): this {
    const bits = value & WORD_MASK;
    return this.pushBytes(
      bits & BYTE_MASK,
      (bits >>> BITS_PER_BYTE) & BYTE_MASK,
    );
  }

  /** Composed with multiplication rather than `<< 24`, matching biff/cursor.ts's own u32 reader: a shift would produce a signed result for any value with the top bit set. */
  u32(value: number): this {
    const bits = value >>> 0;
    return this.pushBytes(
      bits & BYTE_MASK,
      (bits >>> BITS_PER_BYTE) & BYTE_MASK,
      (bits >>> DOUBLE_BITS_PER_BYTE) & BYTE_MASK,
      (bits >>> TRIPLE_BITS_PER_BYTE) & BYTE_MASK,
    );
  }

  i32(value: number): this {
    return this.u32(value >>> 0);
  }

  /** An Xnum ([MS-XLS] 2.5.342): a little-endian IEEE 754 double. */
  f64(value: number): this {
    const buffer = new ArrayBuffer(DOUBLE_BYTE_LENGTH);
    new DataView(buffer).setFloat64(0, value, true);
    this.parts.push(new Uint8Array(buffer));
    return this;
  }

  /** Appends raw bytes — for a field already encoded elsewhere (a packed bitfield word, a string's own byte run). */
  bytes(data: Uint8Array<ArrayBuffer>): this {
    this.parts.push(data);
    return this;
  }

  build(): Uint8Array<ArrayBuffer> {
    const total = this.parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of this.parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }
}
