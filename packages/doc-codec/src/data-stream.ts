// Accumulates the "Data" stream's own bytes across a whole write: every inline picture writeDocContent encounters (table/write.ts's flattenSectionBlocks) appends its own PICFAndOfficeArtData blob (pictures-write.ts's buildInlinePicture) here and gets back the offset that blob landed at, which is exactly what sprmCPicLocation's own operand needs to name. One instance is shared across the whole document -- not one per section -- because the Data stream itself is one contiguous stream regardless of how many sections or pictures a document has.
export class DataStreamBuilder {
  private readonly chunks: Uint8Array[] = [];
  private length = 0;

  /** Appends `bytes` and returns the offset they now occupy in the eventual stream. */
  append(bytes: Uint8Array): number {
    const offset = this.length;
    this.chunks.push(bytes);
    this.length += bytes.length;
    return offset;
  }

  /** The whole accumulated stream, empty when nothing was ever appended -- write.ts only adds a real "Data" stream to the compound file when this is non-empty, matching what a valid Word Binary File with no pictures needs (pictures.ts's own reader treats an absent Data stream as "no pictures", not malformed input). */
  build(): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(this.length);
    let cursor = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, cursor);
      cursor += chunk.length;
    }
    return out;
  }
}
