import { PptFormatError } from "../errors";
import { readRecordAt } from "../record/tree";
import { RT_CurrentUserAtom } from "../record/types";

// The CurrentUserAtom, the only record in the "Current User" stream and the entry point to the whole file: its offsetToCurrentEdit is where a reader seeks in the PowerPoint Document stream to find the newest UserEditAtom, and therefore which of the file's appended incremental edits is the live one. [MS-PPT] 2.3.2: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/940d5700-e4d7-4fc0-ab48-fed5dbc48bc1

// [MS-PPT] 2.3.2 headerToken: "The file SHOULD NOT be an encrypted document."
export const CURRENT_USER_HEADER_TOKEN_PLAIN = 0xe391c05f;
// [MS-PPT] 2.3.2 headerToken: "The file MUST be an encrypted document."
export const CURRENT_USER_HEADER_TOKEN_ENCRYPTED = 0xf3d1c4df;

// [MS-PPT] 2.3.2 size: "It MUST be 0x00000014." -- the 20 bytes from size through unused, the portion preceding the variable-length ansiUserName.
export const CURRENT_USER_FIXED_SIZE = 0x00000014;
// [MS-PPT] 2.3.2 docFileVersion: "It MUST be 0x03F4." Exported so stream/current-user-write.ts's writeCurrentUserAtom stamps the identical mandated value this reader checks for, rather than a second copy of the same constant.
export const CURRENT_USER_DOC_FILE_VERSION = 0x03f4;

export interface CurrentUser {
  readonly offsetToCurrentEdit: number;
  readonly encrypted: boolean;
  readonly userName: string;
}

// Each byte is one printable ANSI character ([MS-PPT] 2.2.22 PrintableAnsiString), decoded here as Latin-1 by construction rather than through a TextDecoder: the string is a user name shown for provenance, and picking a code page for it would be guessing at a producer's locale the record does not record.
function decodeAnsi(bytes: Uint8Array<ArrayBuffer>): string {
  let text = "";
  for (const byte of bytes) {
    text += String.fromCharCode(byte);
  }
  return text;
}

function decodeUtf16Le(bytes: Uint8Array<ArrayBuffer>): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let text = "";
  for (let at = 0; at + 1 < bytes.length; at += 2) {
    text += String.fromCharCode(view.getUint16(at, true));
  }
  return text;
}

export function readCurrentUserAtom(
  streamBytes: Uint8Array<ArrayBuffer>,
): CurrentUser {
  const record = readRecordAt(streamBytes, 0);
  if (record.header.recType !== RT_CurrentUserAtom) {
    throw new PptFormatError(
      `Current User stream begins with record type 0x${record.header.recType.toString(16)}, not RT_CurrentUserAtom (0x${RT_CurrentUserAtom.toString(16)})`,
    );
  }
  const { data } = record;
  if (data.length < CURRENT_USER_FIXED_SIZE) {
    throw new PptFormatError(
      `CurrentUserAtom carries ${data.length} bytes of data, fewer than the ${CURRENT_USER_FIXED_SIZE}-byte fixed portion the record requires`,
    );
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const size = view.getUint32(0, true);
  if (size !== CURRENT_USER_FIXED_SIZE) {
    throw new PptFormatError(
      `CurrentUserAtom size field is 0x${size.toString(16)}, not the mandated 0x${CURRENT_USER_FIXED_SIZE.toString(16)}`,
    );
  }
  const headerToken = view.getUint32(4, true);
  if (
    headerToken !== CURRENT_USER_HEADER_TOKEN_PLAIN &&
    headerToken !== CURRENT_USER_HEADER_TOKEN_ENCRYPTED
  ) {
    throw new PptFormatError(
      `CurrentUserAtom headerToken is 0x${headerToken.toString(16)}, neither the plaintext 0x${CURRENT_USER_HEADER_TOKEN_PLAIN.toString(16)} nor the encrypted 0x${CURRENT_USER_HEADER_TOKEN_ENCRYPTED.toString(16)}`,
    );
  }
  const offsetToCurrentEdit = view.getUint32(8, true);
  const lenUserName = view.getUint16(12, true);
  const docFileVersion = view.getUint16(14, true);
  if (docFileVersion !== CURRENT_USER_DOC_FILE_VERSION) {
    throw new PptFormatError(
      `CurrentUserAtom docFileVersion is 0x${docFileVersion.toString(16)}, not the mandated 0x${CURRENT_USER_DOC_FILE_VERSION.toString(16)}`,
    );
  }

  // ansiUserName occupies lenUserName bytes immediately after the fixed portion, relVersion the 4 bytes after that, and unicodeUserName -- when present at all, which the spec makes optional -- exactly 2 * lenUserName bytes after relVersion. A short record is not a failure here: the Unicode name is simply absent.

  const ansiEnd = CURRENT_USER_FIXED_SIZE + lenUserName;
  if (ansiEnd > data.length) {
    throw new PptFormatError(
      `CurrentUserAtom declares a ${lenUserName}-byte ansiUserName that runs past the record's ${data.length} bytes`,
    );
  }
  const unicodeStart = ansiEnd + 4;
  const unicodeEnd = unicodeStart + lenUserName * 2;
  const userName =
    unicodeEnd <= data.length && lenUserName > 0
      ? decodeUtf16Le(data.subarray(unicodeStart, unicodeEnd))
      : decodeAnsi(data.subarray(CURRENT_USER_FIXED_SIZE, ansiEnd));

  return {
    offsetToCurrentEdit,
    encrypted: headerToken === CURRENT_USER_HEADER_TOKEN_ENCRYPTED,
    userName,
  };
}
