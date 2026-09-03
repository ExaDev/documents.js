import { PptFormatError } from "../errors";
import {
  RECORD_HEADER_SIZE,
  type RecordHeader,
  isContainerRecord,
  readRecordHeader,
} from "./header";

// The record-tree walk [MS-PPT] is built around. Every record is located by its own offset within the stream it came from rather than by a copy of its bytes, because the format's cross-references are stream offsets: a persist directory entry, a UserEditAtom's offsetLastEdit, and a CurrentUserAtom's offsetToCurrentEdit all name a position in the PowerPoint Document stream, and a reader that had already sliced its records apart could no longer honour them.

export interface PptRecord {
  readonly header: RecordHeader;
  // Offset of this record's header within `stream`.
  readonly offset: number;
  // Offset of this record's data within `stream` -- always `offset + RECORD_HEADER_SIZE`, kept explicit so a caller reading fields never has to re-derive it.
  readonly dataOffset: number;
  // This record's data alone: a view over `stream`, not a copy.
  readonly data: Uint8Array<ArrayBuffer>;
  // The whole stream this record was read from, so a nested read stays offset-addressable.
  readonly stream: Uint8Array<ArrayBuffer>;
}

export function readRecordAt(
  bytes: Uint8Array<ArrayBuffer>,
  offset: number,
): PptRecord {
  const header = readRecordHeader(bytes, offset);
  const dataOffset = offset + RECORD_HEADER_SIZE;
  const end = dataOffset + header.recLen;
  if (end > bytes.length) {
    throw new PptFormatError(
      `record 0x${header.recType.toString(16)} at offset ${offset} declares ${header.recLen} bytes of data but only ${bytes.length - dataOffset} remain in the stream`,
    );
  }
  return {
    header,
    offset,
    dataOffset,
    data: bytes.subarray(dataOffset, end),
    stream: bytes,
  };
}

// Reads consecutive sibling records filling exactly [start, end). A record extending past `end` is a structural failure rather than a truncation to tolerate: `end` is always a boundary the format itself declared (a container's recLen, or a stream's length), so a child crossing it means the two disagree.
export function readRecordSequence(
  bytes: Uint8Array<ArrayBuffer>,
  start: number,
  end: number,
): PptRecord[] {
  const records: PptRecord[] = [];
  let at = start;
  while (at < end) {
    if (at + RECORD_HEADER_SIZE > end) {
      throw new PptFormatError(
        `record sequence ending at ${end} has a trailing ${end - at}-byte fragment, too short for the ${RECORD_HEADER_SIZE}-byte record header`,
      );
    }
    const record = readRecordAt(bytes, at);
    const recordEnd = record.dataOffset + record.header.recLen;
    if (recordEnd > end) {
      throw new PptFormatError(
        `record 0x${record.header.recType.toString(16)} at offset ${at} ends at ${recordEnd}, past the ${end} its container allows`,
      );
    }
    records.push(record);
    at = recordEnd;
  }
  return records;
}

// A container's children. An atom has none by definition -- its data is fields, not records -- so this returns nothing for one rather than trying to parse field bytes as a record sequence.
export function childRecords(record: PptRecord): PptRecord[] {
  if (!isContainerRecord(record.header)) {
    return [];
  }
  return readRecordSequence(
    record.stream,
    record.dataOffset,
    record.dataOffset + record.header.recLen,
  );
}

export function findChild(
  records: readonly PptRecord[],
  recType: number,
): PptRecord | undefined {
  return records.find((record) => record.header.recType === recType);
}

export function findChildren(
  records: readonly PptRecord[],
  recType: number,
): PptRecord[] {
  return records.filter((record) => record.header.recType === recType);
}

// Every record of a type anywhere beneath `root`, in document order. Used where the spec's own child ordering is looser than a fixed field list -- the OfficeArt shape tree, whose group containers nest to arbitrary depth.
export function findDescendants(root: PptRecord, recType: number): PptRecord[] {
  const found: PptRecord[] = [];
  for (const child of childRecords(root)) {
    if (child.header.recType === recType) {
      found.push(child);
    }
    found.push(...findDescendants(child, recType));
  }
  return found;
}
