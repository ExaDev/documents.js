import { PptFormatError } from "../errors";
import { type PptRecord } from "../record/tree";
import { RT_DocumentAtom } from "../record/types";

// DocumentAtom: the document-wide facts a reader needs before any slide -- above all the slide size, which every shape rectangle is positioned within. [MS-PPT] 2.4.2: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/121f2728-3497-4a0a-829e-6f416fee2ee6

// [MS-PPT] 2.4.2: "rh.recLen MUST be 0x00000028."
const DOCUMENT_ATOM_LEN = 0x00000028;

export interface PointStruct {
  readonly x: number;
  readonly y: number;
}

export interface DocumentAtom {
  // Slide dimensions in master units.
  readonly slideSize: PointStruct;
  // Notes and handout slide dimensions in master units.
  readonly notesSize: PointStruct;
  readonly notesMasterPersistIdRef: number;
  readonly handoutMasterPersistIdRef: number;
  readonly firstSlideNumber: number;
  readonly slideSizeType: number;
}

export function readDocumentAtom(record: PptRecord): DocumentAtom {
  if (record.header.recType !== RT_DocumentAtom) {
    throw new PptFormatError(
      `expected RT_DocumentAtom (0x${RT_DocumentAtom.toString(16)}), found record type 0x${record.header.recType.toString(16)}`,
    );
  }
  if (record.data.length < DOCUMENT_ATOM_LEN) {
    throw new PptFormatError(
      `DocumentAtom carries ${record.data.length} bytes, fewer than the mandated 0x${DOCUMENT_ATOM_LEN.toString(16)}`,
    );
  }
  const { data } = record;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    slideSize: { x: view.getInt32(0, true), y: view.getInt32(4, true) },
    notesSize: { x: view.getInt32(8, true), y: view.getInt32(12, true) },
    // Bytes 16-23 are serverZoom, a RatioStruct describing an OLE presentation zoom level with no bearing on the document's own content.
    notesMasterPersistIdRef: view.getUint32(24, true),
    handoutMasterPersistIdRef: view.getUint32(28, true),
    firstSlideNumber: view.getUint16(32, true),
    slideSizeType: view.getUint16(34, true),
  };
}
