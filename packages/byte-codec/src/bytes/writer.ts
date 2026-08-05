// A chunked, growable byte-output builder: writes accumulate into a list of chunks rather than repeatedly reallocating and copying one growing buffer, which is O(n^2) for many small writes -- exactly the access pattern the PDF writer (one write per operator) and the PNG encoder (one write per scanline) both have.
export class ByteWriter {
  private readonly chunks: Uint8Array<ArrayBuffer>[] = [];
  private byteLength = 0;

  get length(): number {
    return this.byteLength;
  }

  writeBytes(bytes: Uint8Array<ArrayBuffer>): void {
    if (bytes.length === 0) {
      return;
    }
    this.chunks.push(bytes);
    this.byteLength += bytes.length;
  }

  writeByte(byte: number): void {
    this.writeBytes(new Uint8Array([byte]));
  }

  // Encodes `text` as UTF-8 (ASCII in practice, for the PDF/PNG syntax this writer produces) and appends it.
  writeAscii(text: string): void {
    this.writeBytes(new TextEncoder().encode(text));
  }

  toBytes(): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(this.byteLength);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

// Concatenates a list of byte chunks into one contiguous array without the O(n^2) cost of repeated single-chunk concatenation.
export function concatBytes(chunks: readonly Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const writer = new ByteWriter();
  for (const chunk of chunks) {
    writer.writeBytes(chunk);
  }
  return writer.toBytes();
}
