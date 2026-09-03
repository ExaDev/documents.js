import { MAX_RECORD_DATA_SIZE } from "./record-types";

// The BIFF record framing, and nothing above it. [MS-XLS] 2.1.4 defines a record as exactly three components -- a two-byte unsigned record type, a two-byte unsigned record size, then `size` bytes of record data -- laid end to end with no padding, alignment, or terminator (https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/170e90ce-87d7-4758-9331-dcf14cd72388). Every multi-byte integer in the stream is little-endian, as [MS-XLS] 1.3.1 fixes for the whole format (https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/bc969080-8cb9-4dfe-afc0-059dfc43cd56).
//
// This layer deliberately does NOT merge Continue records into the record they continue, even though that is what "reading a record" ultimately has to mean. Continuation is not uniform: for most records a Continue's data simply appends, but for a record carrying an XLUnicodeRichExtendedString ([MS-XLS] 2.5.293, the SST case) a Continue that resumes mid-string re-states the string's own fHighByte flag in its first byte, which is framing belonging to the string rather than to the record. Blind concatenation would splice that flag byte into the character data and silently corrupt every string after the first continuation boundary -- the exact truncation-class bug that makes a naive BIFF reader look correct on small files and wrong on large ones. So the blocks are reported as written and each record's own reader decides how to join them; see biff/continued.ts for the reader that gets this right.

/** A single record as the stream carries it: its type from the enumeration ([MS-XLS] 2.3), and its data component, exactly `size` bytes long. */
export interface BiffRecord {
  readonly type: number;
  readonly data: Uint8Array<ArrayBuffer>;
  /** The record's own start offset in the stream. Carried because BoundSheet8's lbPlyPos ([MS-XLS] 2.4.28) addresses a sheet's substream by the byte offset of its BOF, so matching a sheet to its records means knowing where each record began. */
  readonly offset: number;
}

/** Thrown when a byte sequence cannot be read as the structure [MS-XLS] specifies, at any level from the record framing up to a record's own fields. */
export class BiffFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BiffFormatError";
  }
}

/** The four-byte record header: a two-byte type followed by a two-byte size. */
const HEADER_SIZE = 4;

/**
 * Splits a BIFF record stream into its records, in stream order.
 *
 * Every failure is thrown rather than tolerated, because there is no safe way to resume: a record's size field is the only thing that says where the next record begins, so a stream that stops making sense at one record makes no sense from there on, and returning the records read so far would be reporting a truncated workbook as a complete one.
 */
export function readRecords(
  stream: Uint8Array<ArrayBuffer>,
): readonly BiffRecord[] {
  const view = new DataView(
    stream.buffer,
    stream.byteOffset,
    stream.byteLength,
  );
  const records: BiffRecord[] = [];
  let offset = 0;
  while (offset < stream.length) {
    if (offset + HEADER_SIZE > stream.length) {
      throw new BiffFormatError(
        `record header at offset ${offset} runs past the end of the ${stream.length}-byte stream`,
      );
    }
    const type = view.getUint16(offset, true);
    const size = view.getUint16(offset + 2, true);
    if (size > MAX_RECORD_DATA_SIZE) {
      throw new BiffFormatError(
        `record 0x${type.toString(16)} at offset ${offset} declares ${size} bytes of data, above the ${MAX_RECORD_DATA_SIZE}-byte maximum`,
      );
    }
    const dataStart = offset + HEADER_SIZE;
    if (dataStart + size > stream.length) {
      throw new BiffFormatError(
        `record 0x${type.toString(16)} at offset ${offset} declares ${size} bytes of data, running past the end of the ${stream.length}-byte stream`,
      );
    }
    records.push({
      type,
      data: stream.slice(dataStart, dataStart + size),
      offset,
    });
    offset = dataStart + size;
  }
  return records;
}
