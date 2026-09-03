import { concatBytes, u8, u16le, u32le, writeAtom } from "../record/write";
import { RT_PersistDirectoryAtom, RT_UserEditAtom } from "../record/types";

// The write-side mirror of stream/persist.ts: a single-edit persist layer, since this writer never appends an incremental edit -- every persist object it writes is stated once, by one UserEditAtom pointing at one PersistDirectoryAtom that covers the whole document in its first (and only) edit. [MS-PPT] 2.3.3 UserEditAtom: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/3ffb3fab-95de-4873-98aa-d508fbbac981 [MS-PPT] 2.3.4 PersistDirectoryAtom: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/d10a093d-860f-409c-b065-aeb24b830505 [MS-PPT] 2.3.5 PersistDirectoryEntry: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/6214b5a6-7ca2-4a86-8a0e-5fd3d3eff1c9

export interface PersistDirectoryEntryToWrite {
  readonly persistId: number;
  readonly offset: number;
}

// One PersistDirectoryEntry per input entry (cPersist always 1), rather than packing contiguous persist ids into fewer, wider runs the way a real producer's incremental edits naturally would: a fixed cPersist of 1 needs no packed-run bookkeeping, has no ceiling to hit (the packed cPersist field is only 12 bits), and readPersistDirectoryAtom already reads a directory with as many entries as it is given -- one run per entry is exactly as valid a directory as one run per contiguous group.
export function writePersistDirectoryAtom(
  entries: readonly PersistDirectoryEntryToWrite[],
): Uint8Array<ArrayBuffer> {
  const data = concatBytes(
    ...entries.map((entry) =>
      concatBytes(
        // persistId occupies bits 0-19, cPersist bits 20-31 of one little-endian word -- see stream/persist.ts's own readPersistDirectoryAtom comment on the shift-and-mask split this mirrors.
        u32le((entry.persistId & 0xfffff) | (1 << 20)),
        u32le(entry.offset),
      ),
    ),
  );
  return writeAtom(RT_PersistDirectoryAtom, data);
}

export interface UserEditFields {
  readonly lastSlideIdRef: number;
  readonly offsetLastEdit: number;
  readonly offsetPersistDirectory: number;
  readonly docPersistIdRef: number;
  readonly persistIdSeed: number;
}

// [MS-PPT] 2.3.3's 0x1C-byte (no encryptSessionPersistIdRef) UserEditAtom -- version/minorVersion/majorVersion stamped with the same PowerPoint-97-2003 values (0, 0x00, 0x03) this package's own synthetic-presentation fixtures already use, since the reader ignores the field entirely and no other value would change what round-trips.
export function writeUserEditAtom(
  fields: UserEditFields,
): Uint8Array<ArrayBuffer> {
  return writeAtom(
    RT_UserEditAtom,
    concatBytes(
      u32le(fields.lastSlideIdRef),
      u16le(0), // version
      u8(0x00), // minorVersion
      u8(0x03), // majorVersion
      u32le(fields.offsetLastEdit),
      u32le(fields.offsetPersistDirectory),
      u32le(fields.docPersistIdRef),
      u32le(fields.persistIdSeed),
      u16le(0), // lastView
      u16le(0), // unused
    ),
  );
}
