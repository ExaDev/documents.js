import { MAX_RECORD_DATA_SIZE, RECORD_CONTINUE } from "./record-types";
import { BiffWriteError } from "./write-errors";

// The write-side mirror of biff/records.ts's readRecords: wraps one record's data in [MS-XLS] 2.1.4's three-component framing (a two-byte little-endian type, a two-byte little-endian size, then the data), and concatenates finished records into a stream.
//
// writeRecord itself still refuses an oversized single record outright rather than silently chaining it -- most record families genuinely never need a Continue chain, and for those a thrown error is the honest signal that something is wrong (an unbounded string, a runaway table) rather than a symptom this layer should paper over. writeRecordChain below is the one place this package chains for real: a record whose data comes from bytes a real producer already expects to split this way (MsoDrawing/MsoDrawingGroup's own Escher streams, per [MS-XLS] 2.4.180/2.4.179 and the MSODRAWING/MSODRAWINGGROUP productions), where refusing would mean this writer could never emit an image past 8224 bytes at all -- a limit no real spreadsheet respects.

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

/**
 * Splits `data` across a base record of `type` plus as many Continue records ([MS-XLS] 2.4.58) as it takes, each carrying up to MAX_RECORD_DATA_SIZE bytes -- the write-side mirror of biff/substreams.ts's groupRecords, which joins exactly this shape back together on read. `data` of MAX_RECORD_DATA_SIZE bytes or fewer still returns a single-element array (the base record alone), so a caller can always concatenate the result the same way regardless of whether a chain was actually needed.
 *
 * A Continue record's own data is the plain next slice of `data`, with no restated flag byte of its own: unlike an XLUnicodeRichExtendedString's fHighByte (biff/strings.ts's own concern), MsoDrawing/MsoDrawingGroup's Escher bytes carry no per-block header for a chain to restate, so simple concatenation IS the reassembly rule here -- confirmed against biff/substreams.ts's own groupRecords, which folds a plain Continue's block onto its base record verbatim rather than parsing anything out of it first.
 */
export function writeRecordChain(
  type: number,
  data: Uint8Array<ArrayBuffer>,
): readonly Uint8Array<ArrayBuffer>[] {
  const records: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  let recordType = type;
  do {
    const chunk = data.subarray(offset, offset + MAX_RECORD_DATA_SIZE);
    records.push(writeRecord(recordType, chunk));
    offset += chunk.length;
    recordType = RECORD_CONTINUE;
  } while (offset < data.length);
  return records;
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
