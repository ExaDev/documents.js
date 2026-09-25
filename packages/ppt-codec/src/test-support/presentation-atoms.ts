import {
  OfficeArtClientAnchor,
  OfficeArtFSP,
  RT_DocumentAtom,
  RT_FontEntityAtom,
  RT_SlideAtom,
  RT_SlidePersistAtom,
  RT_TextBytesAtom,
} from "../record/types";
import {
  asciiBytes,
  concatBytes,
  i16le,
  i32le,
  u16le,
  u32le,
  utf16le,
  writeAtom as atom,
} from "../record/write";

// Small [MS-PPT]/[MS-ODRAW] record builders syntheticPresentation composes into a whole document: the fixed-shape atoms (DocumentAtom, FontEntityAtom, SlidePersistAtom, TextBytesAtom, OfficeArtFSP, SlideAtom) and the one rectangle primitive (OfficeArtClientAnchor) every shape's anchor is built from.

// The four trailing bool1 flags (fSaveWithFonts/fOmitTitlePlace/fRightToLeft/fShowComments), all false: one byte each.
const DOCUMENT_ATOM_BOOL_FLAGS_BYTES = 4;

// [MS-PPT] 2.4.2 DocumentAtom's 40-byte body: slideSize and notesSize as PointStructs, serverZoom as a RatioStruct, two persist references, firstSlideNumber, slideSizeType, four bool1 bytes.
export function documentAtom(
  slideWidth: number,
  slideHeight: number,
): Uint8Array<ArrayBuffer> {
  return atom(
    RT_DocumentAtom,
    concatBytes(
      i32le(slideWidth),
      i32le(slideHeight),
      i32le(slideWidth),
      i32le(slideHeight),
      i32le(1),
      i32le(2),
      u32le(0),
      u32le(0),
      u16le(1),
      u16le(0),
      new Uint8Array(DOCUMENT_ATOM_BOOL_FLAGS_BYTES),
    ),
    { recVer: 0x1 },
  );
}

// [MS-PPT] FontEntityAtom's own fixed lfFaceName field, and the two trailing UTF-16 code units of it every name's own encoding is truncated to fit under, leaving a terminating null.
const FONT_ENTITY_NAME_FIELD_BYTES = 64;
const FONT_ENTITY_NAME_TERMINATOR_BYTES = 2;
// The 4 bytes following lfFaceName (panose/clipPrecision/quality/pitchAndFamily in a real producer's own FontEntityAtom), left zero since readFaceName never reads past the name field.
const FONT_ENTITY_TRAILING_BYTES = 4;

export function fontEntityAtom(faceName: string): Uint8Array<ArrayBuffer> {
  const name = new Uint8Array(FONT_ENTITY_NAME_FIELD_BYTES);
  name.set(
    utf16le(faceName).subarray(
      0,
      FONT_ENTITY_NAME_FIELD_BYTES - FONT_ENTITY_NAME_TERMINATOR_BYTES,
    ),
  );
  return atom(
    RT_FontEntityAtom,
    concatBytes(name, new Uint8Array(FONT_ENTITY_TRAILING_BYTES)),
  );
}

export function slidePersistAtom(
  persistIdRef: number,
  cTexts: number,
  slideId: number,
): Uint8Array<ArrayBuffer> {
  return atom(
    RT_SlidePersistAtom,
    concatBytes(
      u32le(persistIdRef),
      u32le(0),
      i32le(cTexts),
      u32le(slideId),
      u32le(0),
    ),
  );
}

export function textBytesAtom(text: string): Uint8Array<ArrayBuffer> {
  return atom(RT_TextBytesAtom, asciiBytes(text));
}

export function fsp(spid: number, flags: number): Uint8Array<ArrayBuffer> {
  return atom(OfficeArtFSP, concatBytes(u32le(spid), u32le(flags)), {
    recVer: 0x2,
  });
}

// placeholderTypes ([MS-PPT] 2.5.2): 8 one-byte placeholder-type slots, unread by this package's own reader.
const SLIDE_ATOM_PLACEHOLDER_TYPES_BYTES = 8;

// [MS-PPT] 2.5.2's 0x18-byte SlideAtom, recVer 0x2 — geom and placeholderTypes are irrelevant to this reader (shapes come from the drawing tree, not this array) and are left zero; only masterIdRef/notesIdRef, the two fields readSlideAtom actually surfaces, carry real values.
export function slideAtom(
  masterIdRef: number,
  notesIdRef: number,
): Uint8Array<ArrayBuffer> {
  return atom(
    RT_SlideAtom,
    concatBytes(
      i32le(0), // geom
      new Uint8Array(SLIDE_ATOM_PLACEHOLDER_TYPES_BYTES), // placeholderTypes
      u32le(masterIdRef),
      u32le(notesIdRef),
      u16le(0), // slideFlags
      u16le(0), // unused
    ),
    { recVer: 0x2 },
  );
}

export function clientAnchor(
  top: number,
  left: number,
  right: number,
  bottom: number,
): Uint8Array<ArrayBuffer> {
  return atom(
    OfficeArtClientAnchor,
    concatBytes(i16le(top), i16le(left), i16le(right), i16le(bottom)),
  );
}
