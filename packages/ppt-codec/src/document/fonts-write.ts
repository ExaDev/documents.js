import {
  concatBytes,
  utf16le,
  writeAtom,
  writeContainer,
} from "../record/write";
import {
  RT_Environment,
  RT_FontCollection,
  RT_FontEntityAtom,
} from "../record/types";

// The write-side mirror of document/fonts.ts's readFontNames: one FontEntityAtom per document-wide typeface name, in the order a FontIndexRef indexes them by. [MS-PPT] FontCollectionContainer: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/88da04bf-6838-4f87-9a87-adf067543837 [MS-PPT] FontEntityAtom: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/b5946b70-2fbc-4f7b-a119-b31fcbeb1794

// [MS-PPT] FontEntityAtom's fixed 64-byte lfFaceName field -- matches fonts.ts's own FACE_NAME_BYTES. A name longer than the field can hold (31 UTF-16 code units plus a terminating null) is truncated to fit, the same lossy edge the reader's own 64-byte read already imposes on the way back.
const FACE_NAME_FIELD_BYTES = 64;

function writeFontEntityAtom(faceName: string): Uint8Array<ArrayBuffer> {
  const nameField = new Uint8Array(FACE_NAME_FIELD_BYTES);
  const encoded = utf16le(faceName);
  nameField.set(encoded.subarray(0, FACE_NAME_FIELD_BYTES - 2));
  // The 4 bytes following lfFaceName (panose/clipPrecision/quality/pitchAndFamily in a real producer's own FontEntityAtom) are left zero: readFaceName never reads past the name field, so nothing here depends on their value.
  return writeAtom(
    RT_FontEntityAtom,
    concatBytes(nameField, new Uint8Array(4)),
  );
}

// The document's Environment container holding its font collection, or undefined when no run in the document names a font family at all -- matching the reader's own tolerance of a missing Environment (readFontNames on an absent one already yields []).
export function writeEnvironment(
  fontNames: readonly string[],
): Uint8Array<ArrayBuffer> | undefined {
  if (fontNames.length === 0) {
    return undefined;
  }
  return writeContainer(RT_Environment, [
    writeContainer(RT_FontCollection, fontNames.map(writeFontEntityAtom)),
  ]);
}
