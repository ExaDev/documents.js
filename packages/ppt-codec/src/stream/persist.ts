import { PptFormatError } from "../errors";
import { type PptRecord, readRecordAt } from "../record/tree";
import { RT_PersistDirectoryAtom, RT_UserEditAtom } from "../record/types";

// The incremental-save layer: a .ppt file's PowerPoint Document stream is a sequence of appended user edits, each one a persist directory plus whatever persist objects that edit rewrote, and the newest edit's directory decides where every live object actually is. Nothing else in this package can find a single record until this resolves, which is why the persist directory is built before any content is read rather than lazily on first reference. [MS-PPT] 2.3.3 UserEditAtom: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/3ffb3fab-95de-4873-98aa-d508fbbac981 [MS-PPT] 2.3.4 PersistDirectoryAtom: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/d10a093d-860f-409c-b065-aeb24b830505 [MS-PPT] 2.3.5 PersistDirectoryEntry: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/6214b5a6-7ca2-4a86-8a0e-5fd3d3eff1c9 [MS-PPT] 2.1.2 PowerPoint Document Stream, whose "live record" process this file implements Part 1 and half of Part 2 of: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/1fc22d56-28f9-4818-bd45-67c2bf721ccf

// [MS-PPT] 2.3.3: "rh.recLen MUST be 0x0000001C or 0x00000020" -- the shorter form omits encryptSessionPersistIdRef, and the record's own length is the only thing that says which form it is. There is no flag bit.
const USER_EDIT_LEN_WITHOUT_ENCRYPT_SESSION = 0x0000001c;
const USER_EDIT_LEN_WITH_ENCRYPT_SESSION = 0x00000020;

export interface UserEdit {
  readonly lastSlideIdRef: number;
  // Offset of the previous user edit's UserEditAtom, or 0 when this is the oldest edit.
  readonly offsetLastEdit: number;
  readonly offsetPersistDirectory: number;
  readonly docPersistIdRef: number;
  readonly persistIdSeed: number;
  readonly encryptSessionPersistIdRef: number | undefined;
}

export function readUserEditAtom(record: PptRecord): UserEdit {
  if (record.header.recType !== RT_UserEditAtom) {
    throw new PptFormatError(
      `expected RT_UserEditAtom (0x${RT_UserEditAtom.toString(16)}) at offset ${record.offset}, found record type 0x${record.header.recType.toString(16)}`,
    );
  }
  const { recLen } = record.header;
  if (
    recLen !== USER_EDIT_LEN_WITHOUT_ENCRYPT_SESSION &&
    recLen !== USER_EDIT_LEN_WITH_ENCRYPT_SESSION
  ) {
    throw new PptFormatError(
      `UserEditAtom at offset ${record.offset} declares recLen 0x${recLen.toString(16)}, neither 0x${USER_EDIT_LEN_WITHOUT_ENCRYPT_SESSION.toString(16)} nor 0x${USER_EDIT_LEN_WITH_ENCRYPT_SESSION.toString(16)}`,
    );
  }
  const { data } = record;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    lastSlideIdRef: view.getUint32(0, true),
    // Bytes 4-7 are version (2), minorVersion (1) and majorVersion (1): build and format-version stamps the spec says to ignore, so they are read past rather than surfaced.
    offsetLastEdit: view.getUint32(8, true),
    offsetPersistDirectory: view.getUint32(12, true),
    docPersistIdRef: view.getUint32(16, true),
    persistIdSeed: view.getUint32(20, true),
    // Bytes 24-27 are lastView (2) and unused (2).
    encryptSessionPersistIdRef:
      recLen === USER_EDIT_LEN_WITH_ENCRYPT_SESSION
        ? view.getUint32(28, true)
        : undefined,
  };
}

// One PersistDirectoryAtom's own entries, expanded from the compressed run form the record stores them in: an entry names a starting persist identifier and an array of offsets, and the i-th offset belongs to persistId + i.
export function readPersistDirectoryAtom(
  record: PptRecord,
): Map<number, number> {
  if (record.header.recType !== RT_PersistDirectoryAtom) {
    throw new PptFormatError(
      `expected RT_PersistDirectoryAtom (0x${RT_PersistDirectoryAtom.toString(16)}) at offset ${record.offset}, found record type 0x${record.header.recType.toString(16)}`,
    );
  }
  const { data } = record;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const entries = new Map<number, number>();
  let at = 0;
  while (at < data.length) {
    if (at + 4 > data.length) {
      throw new PptFormatError(
        `PersistDirectoryAtom at offset ${record.offset} has a ${data.length - at}-byte trailing fragment, too short for a PersistDirectoryEntry header word`,
      );
    }
    const packed = view.getUint32(at, true);
    // persistId occupies bits 0-19 and cPersist bits 20-31 of one little-endian word; a shift-and-mask split is the only reading that keeps a 20-bit persistId out of cPersist's bits.
    const persistId = packed & 0xfffff;
    const cPersist = (packed >>> 20) & 0xfff;
    if (cPersist === 0) {
      throw new PptFormatError(
        `PersistDirectoryEntry at offset ${record.dataOffset + at} declares cPersist 0x000, but the spec requires at least 0x001`,
      );
    }
    at += 4;
    const offsetsEnd = at + cPersist * 4;
    if (offsetsEnd > data.length) {
      throw new PptFormatError(
        `PersistDirectoryEntry at offset ${record.dataOffset + at - 4} declares ${cPersist} offsets, which run past the atom's ${data.length} bytes`,
      );
    }
    for (let i = 0; i < cPersist; i++) {
      entries.set(persistId + i, view.getUint32(at + i * 4, true));
    }
    at = offsetsEnd;
  }
  return entries;
}

export interface PersistDirectory {
  // Every live persist identifier mapped to its offset in the PowerPoint Document stream.
  readonly directory: ReadonlyMap<number, number>;
  // The newest user edit -- the one CurrentUserAtom pointed at, whose docPersistIdRef names the live DocumentContainer.
  readonly currentEdit: UserEdit;
}

// Implements [MS-PPT] 2.1.2's Part 1 verbatim: walk the UserEditAtom chain back from the current edit collecting each edit's PersistDirectoryAtom, then apply those directories oldest-first so a newer edit's entry replaces an older one's for the same persist identifier. Applying them in the order they were found -- newest first -- would invert that and resurrect superseded objects.
export function buildPersistDirectory(
  streamBytes: Uint8Array<ArrayBuffer>,
  offsetToCurrentEdit: number,
): PersistDirectory {
  const edits: UserEdit[] = [];
  let at = offsetToCurrentEdit;
  // The chain is bounded without a visited set: the spec requires each offsetLastEdit to be strictly less than its own atom's offset, so enforcing that makes every step move towards the start of the stream and the walk terminate.
  while (true) {
    const edit = readUserEditAtom(readRecordAt(streamBytes, at));
    edits.push(edit);
    if (edit.offsetLastEdit === 0) {
      break;
    }
    if (edit.offsetLastEdit >= at) {
      throw new PptFormatError(
        `UserEditAtom at offset ${at} points at a previous edit at offset ${edit.offsetLastEdit}, which is not earlier in the stream; the edit chain would cycle`,
      );
    }
    at = edit.offsetLastEdit;
  }

  const directory = new Map<number, number>();
  for (const edit of [...edits].reverse()) {
    for (const [persistId, offset] of readPersistDirectoryAtom(
      readRecordAt(streamBytes, edit.offsetPersistDirectory),
    )) {
      directory.set(persistId, offset);
    }
  }

  const currentEdit = edits[0];
  if (currentEdit === undefined) {
    throw new PptFormatError(
      "the user edit chain produced no edits, so no document persist object can be located",
    );
  }
  return { directory, currentEdit };
}

// Resolves one persist identifier to the record it names. A missing identifier is a structural failure rather than an absent optional: the reference came from a live record, so the object it names must exist in the directory the same file built.
export function resolvePersistObject(
  streamBytes: Uint8Array<ArrayBuffer>,
  directory: ReadonlyMap<number, number>,
  persistId: number,
  describe: string,
): PptRecord {
  const offset = directory.get(persistId);
  if (offset === undefined) {
    throw new PptFormatError(
      `${describe} references persist object ${persistId}, which the persist directory does not contain`,
    );
  }
  return readRecordAt(streamBytes, offset);
}
