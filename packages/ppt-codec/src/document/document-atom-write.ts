import type { PageSize } from "document-schema.js";
import { concatBytes, i32le, u16le, u32le, writeAtom } from "../record/write";
import { RT_DocumentAtom } from "../record/types";
import { pointsToMasterUnits } from "../units";

// The write-side mirror of readDocumentAtom: [MS-PPT] 2.4.2's 40-byte DocumentAtom, recVer 0x1. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/121f2728-3497-4a0a-829e-6f416fee2ee6

export function writeDocumentAtom(size: PageSize): Uint8Array<ArrayBuffer> {
  const width = pointsToMasterUnits(size.widthPt);
  const height = pointsToMasterUnits(size.heightPt);
  return writeAtom(
    RT_DocumentAtom,
    concatBytes(
      i32le(width),
      i32le(height), // slideSize
      i32le(width),
      i32le(height), // notesSize -- this writer has no separate notes geometry to state (see the README's write-scope note on speaker notes), so it mirrors the slide size rather than stating a value nothing produced
      i32le(1),
      i32le(2), // serverZoom RatioStruct -- an OLE presentation zoom hint read.ts's DocumentAtom interface carries but never projects into anything this writer's own output depends on
      u32le(0), // notesMasterPersistIdRef -- no master is written (see README write-scope note)
      u32le(0), // handoutMasterPersistIdRef -- likewise
      u16le(1), // firstSlideNumber
      u16le(0), // slideSizeType: 0 = on-screen show, [MS-PPT] 2.13.28 SlideSizeTypeEnum
      new Uint8Array(4), // fSaveWithFonts/fOmitTitlePlace/fRightToLeft/fShowComments bool1 flags, all false
    ),
    { recVer: 0x1 },
  );
}
