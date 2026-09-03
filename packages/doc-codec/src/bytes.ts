import { DocFormatError } from "./errors";

// Bounds-checked little-endian integer reads over a raw stream. Every [MS-DOC] structure is little-endian ([MS-DOC] 1.3.1 "all values are stored in little-endian byte order"), and every offset in the format is attacker-controlled data read out of the file itself -- an FKP page number, a Clx offset, a Plc element count -- so a read that runs past the end must fail loudly rather than return a partial or wrapped value. DataView already throws a RangeError for that; these wrappers exist to convert it into this package's own named error class with the offset that caused it, so a consumer catching DocFormatError catches every structural failure rather than two unrelated error types.

function checkRange(
  bytes: Uint8Array,
  offset: number,
  size: number,
  what: string,
): void {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new DocFormatError(
      `${what} read at offset ${offset}, which is not a non-negative integer`,
    );
  }
  if (offset + size > bytes.length) {
    throw new DocFormatError(
      `${what} read of ${size} bytes at offset ${offset} runs past the end of a ${bytes.length}-byte stream`,
    );
  }
}

export function readUint8(bytes: Uint8Array, offset: number): number {
  checkRange(bytes, offset, 1, "uint8");
  const value = bytes[offset];
  if (value === undefined) {
    throw new DocFormatError(`uint8 read at offset ${offset} found no byte`);
  }
  return value;
}

export function readUint16LE(bytes: Uint8Array, offset: number): number {
  checkRange(bytes, offset, 2, "uint16");
  return view(bytes).getUint16(offset, true);
}

export function readInt16LE(bytes: Uint8Array, offset: number): number {
  checkRange(bytes, offset, 2, "int16");
  return view(bytes).getInt16(offset, true);
}

export function readUint32LE(bytes: Uint8Array, offset: number): number {
  checkRange(bytes, offset, 4, "uint32");
  return view(bytes).getUint32(offset, true);
}

export function readInt32LE(bytes: Uint8Array, offset: number): number {
  checkRange(bytes, offset, 4, "int32");
  return view(bytes).getInt32(offset, true);
}

// A DataView over the array's own window of its buffer, not the whole buffer: a Uint8Array handed in by a caller is frequently already a subarray (archive-codec returns stream views), so ignoring byteOffset would silently read the wrong bytes.
function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

// A bounds-checked subarray. `what` names the structure whose declared size asked for the range, so a truncated file reports which of the FIB's dozens of offset/length pairs pointed outside the stream rather than only that some read failed.
export function slice(
  bytes: Uint8Array,
  offset: number,
  length: number,
  what: string,
): Uint8Array {
  if (!Number.isInteger(length) || length < 0) {
    throw new DocFormatError(
      `${what} declares a length of ${length}, which is not a non-negative integer`,
    );
  }
  checkRange(bytes, offset, length, what);
  return bytes.subarray(offset, offset + length);
}
