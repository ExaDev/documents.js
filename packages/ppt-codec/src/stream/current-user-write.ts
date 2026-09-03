import {
  asciiBytes,
  concatBytes,
  u8,
  u16le,
  u32le,
  utf16le,
  writeAtom,
} from "../record/write";
import { RT_CurrentUserAtom } from "../record/types";
import {
  CURRENT_USER_DOC_FILE_VERSION,
  CURRENT_USER_FIXED_SIZE,
  CURRENT_USER_HEADER_TOKEN_PLAIN,
} from "./current-user";

// The write-side mirror of readCurrentUserAtom: the sole record of the "Current User" stream. [MS-PPT] 2.3.2: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/940d5700-e4d7-4fc0-ab48-fed5dbc48bc1

// Written into both the ansiUserName and unicodeUserName fields -- cosmetic provenance a reader never inspects for anything this package projects into content, so a fixed producer name rather than a caller-supplied one keeps writePptStreams' own signature free of a parameter nothing downstream needs.
const PRODUCER_USER_NAME = "documents.js";
// [MS-PPT] 2.3.2 relVersion: "This field is unused and MUST be ignored." Written as 8 (matching this package's own synthetic-presentation fixture) since the value is unconstrained.
const REL_VERSION = 0x00000008;

export function writeCurrentUserAtom(
  offsetToCurrentEdit: number,
): Uint8Array<ArrayBuffer> {
  const ansiUserName = asciiBytes(PRODUCER_USER_NAME);
  return writeAtom(
    RT_CurrentUserAtom,
    concatBytes(
      u32le(CURRENT_USER_FIXED_SIZE),
      u32le(CURRENT_USER_HEADER_TOKEN_PLAIN),
      u32le(offsetToCurrentEdit),
      u16le(ansiUserName.length),
      u16le(CURRENT_USER_DOC_FILE_VERSION),
      u8(0x03), // release
      u8(0x00), // build
      u16le(0), // padding out CURRENT_USER_FIXED_SIZE's 20-byte fixed portion
      ansiUserName,
      u32le(REL_VERSION),
      utf16le(PRODUCER_USER_NAME),
    ),
  );
}
