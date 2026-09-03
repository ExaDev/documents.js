import { PptFormatError } from "../errors";

// The 8-byte header every [MS-PPT] record and every [MS-ODRAW] OfficeArt record carries, and the reason the format is a tree rather than a flat stream: recVer distinguishes a container (whose data is more records) from an atom (whose data is fields), and recLen bounds either one so an unknown record can be skipped without understanding it. [MS-PPT] 2.3.1: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/df201194-0cd0-4dfb-bf10-eea353d8eabc [MS-ODRAW] 2.2.1 defines the identical layout, which is what lets one reader walk across the boundary between the two specifications: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/5dc1b9ed-818c-436f-8a4f-905a7ebb1ba9

export const RECORD_HEADER_SIZE = 8;

// [MS-PPT] 2.3.1: "A value of 0xF specifies that the record is a container record." Every other recVer value marks an atom, and its meaning is the record type's own business (DocumentAtom requires 0x1, most atoms require 0x0).
export const CONTAINER_REC_VER = 0xf;

export interface RecordHeader {
  readonly recVer: number;
  readonly recInstance: number;
  readonly recType: number;
  // The length of the record's data, which begins immediately after the header. It does not include the header itself.
  readonly recLen: number;
}

export function readRecordHeader(
  bytes: Uint8Array<ArrayBuffer>,
  offset: number,
): RecordHeader {
  if (offset < 0) {
    throw new PptFormatError(
      `record header offset ${offset} is negative; a record cannot begin before the start of its stream`,
    );
  }
  if (offset + RECORD_HEADER_SIZE > bytes.length) {
    throw new PptFormatError(
      `record header at offset ${offset} needs ${RECORD_HEADER_SIZE} bytes but only ${bytes.length - offset} remain`,
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The version/instance word is one little-endian uint16 with recVer in bits 0-3 and recInstance in bits 4-15 -- the spec's packet diagram numbers bits big-endian while the value itself is little-endian ([MS-PPT] 1.3.1 Byte Ordering), so the split is by shift on the assembled value, never by reading the two bytes separately.
  const versionAndInstance = view.getUint16(offset, true);
  return {
    recVer: versionAndInstance & 0xf,
    recInstance: (versionAndInstance >> 4) & 0xfff,
    recType: view.getUint16(offset + 2, true),
    recLen: view.getUint32(offset + 4, true),
  };
}

export function isContainerRecord(header: RecordHeader): boolean {
  return header.recVer === CONTAINER_REC_VER;
}
