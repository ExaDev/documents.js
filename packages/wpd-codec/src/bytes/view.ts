import { WpdFormatError } from "../errors";

// Little-endian random-access reads over a WordPerfect file's bytes, with every read bounds-checked against the buffer rather than returning NaN or reading past the end.
//
// WordPerfect's own convention, stated once in the SDK's glossary and true of every field in the format: "The byte sequence of all multi-byte data types that are larger than a byte follows the Intel convention of placing the least-significant byte first." Sizes are byte (<>), short/16-bit ([]), and long/32-bit ({}), all unsigned unless a field says otherwise. Source: WPFF Document Structure, "Size Definitions".
//
// Deliberately not byte-codec's ByteReader: that is a purely sequential cursor built for PDF tokenising (peek/next/mark/reset) with no little-endian integer reads at all, whereas a WordPerfect prefix is random-access -- the header points at an index area, each index points at a packet elsewhere in the file, and the header points past both at the document area. Three named helpers over a DataView is the whole need; wrapping a sequential cursor to fake random access would be the larger thing, not the smaller one.

export function byteAt(bytes: Uint8Array, offset: number): number {
  const value = bytes[offset];
  if (value === undefined) {
    throw new WpdFormatError(
      `Byte read at offset ${offset} is past the end of a ${bytes.length}-byte file.`,
    );
  }
  return value;
}

export function uint16At(bytes: Uint8Array, offset: number): number {
  return byteAt(bytes, offset) | (byteAt(bytes, offset + 1) << 8);
}

export function uint32At(bytes: Uint8Array, offset: number): number {
  // Assembled through multiplication rather than `<< 24`, which would sign-extend a high bit set into a negative number. A WordPerfect long is unsigned unless its own field definition says otherwise.
  return (
    byteAt(bytes, offset) +
    byteAt(bytes, offset + 1) * 0x100 +
    byteAt(bytes, offset + 2) * 0x10000 +
    byteAt(bytes, offset + 3) * 0x1000000
  );
}

// A bounds-checked subarray. Returns a view onto the same buffer, not a copy: nothing in this package mutates the bytes it is handed, and copying every packet of a large prefix would be pure waste.
export function sliceAt(
  bytes: Uint8Array,
  offset: number,
  length: number,
): Uint8Array {
  if (offset < 0 || length < 0 || offset + length > bytes.length) {
    throw new WpdFormatError(
      `A ${length}-byte read at offset ${offset} does not fit inside a ${bytes.length}-byte file.`,
    );
  }
  return bytes.subarray(offset, offset + length);
}
