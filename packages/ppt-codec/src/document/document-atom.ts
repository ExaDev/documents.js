import { PptFormatError } from "../errors";
import { type PptRecord } from "../record/tree";
import { RT_DocumentAtom } from "../record/types";

// DocumentAtom: the document-wide facts a reader needs before any slide — above all the slide size, which every shape rectangle is positioned within. [MS-PPT] 2.4.2: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/121f2728-3497-4a0a-829e-6f416fee2ee6

// [MS-PPT] 2.4.2: "rh.recLen MUST be 0x00000028."
const DOCUMENT_ATOM_LEN = 0x00000028;

// The hexadecimal radix every record-type diagnostic below formats its own field through.
const HEX_RADIX = 16;
// DocumentAtom's own field byte offsets ([MS-PPT] 2.4.2): slideSize.x/y, notesSize.x/y, then serverZoom's own 8 bytes (unread), then the two persist references and the two trailing 2-byte fields.
const SLIDE_SIZE_Y_OFFSET = 4;
const NOTES_SIZE_X_OFFSET = 8;
const NOTES_SIZE_Y_OFFSET = 12;
const NOTES_MASTER_PERSIST_ID_REF_OFFSET = 24;
const HANDOUT_MASTER_PERSIST_ID_REF_OFFSET = 28;
const FIRST_SLIDE_NUMBER_OFFSET = 32;
const SLIDE_SIZE_TYPE_OFFSET = 34;

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
      `expected RT_DocumentAtom (0x${RT_DocumentAtom.toString(HEX_RADIX)}), found record type 0x${record.header.recType.toString(HEX_RADIX)}`,
    );
  }
  if (record.data.length < DOCUMENT_ATOM_LEN) {
    throw new PptFormatError(
      `DocumentAtom carries ${record.data.length} bytes, fewer than the mandated 0x${DOCUMENT_ATOM_LEN.toString(HEX_RADIX)}`,
    );
  }
  const { data } = record;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    slideSize: {
      x: view.getInt32(0, true),
      y: view.getInt32(SLIDE_SIZE_Y_OFFSET, true),
    },
    notesSize: {
      x: view.getInt32(NOTES_SIZE_X_OFFSET, true),
      y: view.getInt32(NOTES_SIZE_Y_OFFSET, true),
    },
    // Bytes 16-23 are serverZoom, a RatioStruct describing an OLE presentation zoom level with no bearing on the document's own content.
    notesMasterPersistIdRef: view.getUint32(
      NOTES_MASTER_PERSIST_ID_REF_OFFSET,
      true,
    ),
    handoutMasterPersistIdRef: view.getUint32(
      HANDOUT_MASTER_PERSIST_ID_REF_OFFSET,
      true,
    ),
    firstSlideNumber: view.getUint16(FIRST_SLIDE_NUMBER_OFFSET, true),
    slideSizeType: view.getUint16(SLIDE_SIZE_TYPE_OFFSET, true),
  };
}
