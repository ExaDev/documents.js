import { MAX_RECORD_DATA_SIZE } from "./record-types";
import { BiffWriteError } from "./write-errors";

// The write-side mirror of biff/records.ts's readRecords: wraps one record's data in [MS-XLS] 2.1.4's three-component framing (a two-byte little-endian type, a two-byte little-endian size, then the data), and concatenates finished records into a stream.
//
// This layer deliberately does not implement Continue-record splitting: a record whose data would exceed the 8224-byte ceiling is refused outright rather than silently chained, matching this session's own convention of failing loudly instead of producing a plausible-looking but wrong file. See README's writer-scope section for what this means for a workbook carrying a very large shared string table.

const HEADER_SIZE = 4;

/** Wraps one record's data in its type/size header. Throws BiffWriteError if the data exceeds the single-record maximum, rather than splitting it across Continue records. */
export function writeRecord(
  type: number,
  data: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  if (data.length > MAX_RECORD_DATA_SIZE) {
    throw new BiffWriteError(
      `record 0x${type.toString(16)} would carry ${data.length} bytes of data, above the ${MAX_RECORD_DATA_SIZE}-byte maximum a single record can hold ([MS-XLS] 2.1.4); this writer does not split oversized records into Continue chains`,
    );
  }
  const out = new Uint8Array(HEADER_SIZE + data.length);
  const view = new DataView(out.buffer);
  view.setUint16(0, type, true);
  view.setUint16(2, data.length, true);
  out.set(data, HEADER_SIZE);
  return out;
}

/** Concatenates already-framed records (or any byte sequences) into one stream, in the order given. */
export function concatRecords(
  ...parts: readonly Uint8Array<ArrayBuffer>[]
): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
