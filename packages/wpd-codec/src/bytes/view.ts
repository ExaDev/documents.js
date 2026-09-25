import { WpdFormatError } from "../errors";

// Little-endian random-access reads over a WordPerfect file's bytes, with every read bounds-checked against the buffer rather than returning NaN or reading past the end.
//
// WordPerfect's own convention, stated once in the SDK's glossary and true of every field in the format: "The byte sequence of all multi-byte data types that are larger than a byte follows the Intel convention of placing the least-significant byte first." Sizes are byte (<>), short/16-bit ([]), and long/32-bit ({}), all unsigned unless a field says otherwise. Source: WPFF Document Structure, "Size Definitions".
//
// Deliberately not byte-codec's ByteReader: that is a purely sequential cursor built for PDF tokenising (peek/next/mark/reset) with no little-endian integer reads at all, whereas a WordPerfect prefix is random-access — the header points at an index area, each index points at a packet elsewhere in the file, and the header points past both at the document area. Three named helpers over a DataView is the whole need; wrapping a sequential cursor to fake random access would be the larger thing, not the smaller one.

const BITS_PER_BYTE = 8;
// The largest value a signed 16-bit two's-complement integer can hold, and the span (2^16) subtracted to reinterpret a value above it as negative.
const INT16_MAX = 0x7fff;
const UINT16_SPAN = 0x10000;
// Byte place values for assembling a 32-bit little-endian integer through multiplication: byte 1 is worth 256^1, byte 2 is 256^2, byte 3 is 256^3.
const BYTE_1_PLACE_VALUE = 0x100;
const BYTE_2_PLACE_VALUE = 0x10000;
const BYTE_3_PLACE_VALUE = 0x1000000;
const BYTE_1_OFFSET = 1;
const BYTE_2_OFFSET = 2;
const BYTE_3_OFFSET = 3;

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
  return (
    byteAt(bytes, offset) |
    (byteAt(bytes, offset + BYTE_1_OFFSET) << BITS_PER_BYTE)
  );
}

// A signed 16-bit read: uint16At's own bit pattern, reinterpreted as two's complement whenever the sign bit is set. WordPerfect states most shorts as WPUs or counts, always unsigned by the glossary's own default, but a handful of fields (a table formula's cell# row/column) are explicitly signed.
export function int16At(bytes: Uint8Array, offset: number): number {
  const value = uint16At(bytes, offset);
  return value > INT16_MAX ? value - UINT16_SPAN : value;
}

export function uint32At(bytes: Uint8Array, offset: number): number {
  // Assembled through multiplication rather than `<< 24`, which would sign-extend a high bit set into a negative number. A WordPerfect long is unsigned unless its own field definition says otherwise.
  return (
    byteAt(bytes, offset) +
    byteAt(bytes, offset + BYTE_1_OFFSET) * BYTE_1_PLACE_VALUE +
    byteAt(bytes, offset + BYTE_2_OFFSET) * BYTE_2_PLACE_VALUE +
    byteAt(bytes, offset + BYTE_3_OFFSET) * BYTE_3_PLACE_VALUE
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
