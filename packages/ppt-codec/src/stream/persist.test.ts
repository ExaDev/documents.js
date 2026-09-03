import { describe, expect, it } from "vitest";
import { PptFormatError } from "../errors";
import { readRecordAt } from "../record/tree";
import { RT_PersistDirectoryAtom, RT_UserEditAtom } from "../record/types";
import { atom, concatBytes, u8, u16le, u32le } from "../test-support/records";
import {
  buildPersistDirectory,
  readPersistDirectoryAtom,
  readUserEditAtom,
} from "./persist";

// Built from [MS-PPT] 2.3.3's own field table: lastSlideIdRef, version, minorVersion, majorVersion, offsetLastEdit, offsetPersistDirectory, docPersistIdRef, persistIdSeed, lastView, unused -- 28 bytes (0x1C) -- plus an optional 4-byte encryptSessionPersistIdRef that makes recLen 0x20 instead. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/3ffb3fab-95de-4873-98aa-d508fbbac981
function userEditAtom(options: {
  offsetLastEdit?: number;
  offsetPersistDirectory?: number;
  docPersistIdRef?: number;
  encryptSessionPersistIdRef?: number;
}): Uint8Array<ArrayBuffer> {
  const {
    offsetLastEdit = 0,
    offsetPersistDirectory = 0,
    docPersistIdRef = 1,
    encryptSessionPersistIdRef,
  } = options;
  return atom(
    RT_UserEditAtom,
    concatBytes(
      u32le(0x00000100),
      u16le(0x0000),
      u8(0x00),
      u8(0x03),
      u32le(offsetLastEdit),
      u32le(offsetPersistDirectory),
      u32le(docPersistIdRef),
      u32le(0x00000010),
      u16le(0x0001),
      u16le(0),
      encryptSessionPersistIdRef === undefined
        ? new Uint8Array(0)
        : u32le(encryptSessionPersistIdRef),
    ),
  );
}

// Built from [MS-PPT] 2.3.5's own layout: one 4-byte word packing persistId in bits 0-19 and cPersist in bits 20-31, then cPersist consecutive 4-byte stream offsets. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/6214b5a6-7ca2-4a86-8a0e-5fd3d3eff1c9
function persistDirectoryEntry(
  persistId: number,
  offsets: readonly number[],
): Uint8Array<ArrayBuffer> {
  return concatBytes(
    u32le((persistId & 0xfffff) | ((offsets.length & 0xfff) << 20)),
    ...offsets.map(u32le),
  );
}

function persistDirectoryAtom(
  ...entries: readonly Uint8Array<ArrayBuffer>[]
): Uint8Array<ArrayBuffer> {
  return atom(RT_PersistDirectoryAtom, concatBytes(...entries));
}

describe("readUserEditAtom", () => {
  it("reads the offsets that drive the edit chain and the persist directory lookup", () => {
    const bytes = userEditAtom({
      offsetLastEdit: 0x100,
      offsetPersistDirectory: 0x200,
      docPersistIdRef: 3,
    });
    expect(readUserEditAtom(readRecordAt(bytes, 0))).toEqual({
      lastSlideIdRef: 0x00000100,
      offsetLastEdit: 0x100,
      offsetPersistDirectory: 0x200,
      docPersistIdRef: 3,
      persistIdSeed: 0x00000010,
      encryptSessionPersistIdRef: undefined,
    });
  });

  it("reads encryptSessionPersistIdRef when recLen is 0x20 rather than 0x1C", () => {
    const bytes = userEditAtom({ encryptSessionPersistIdRef: 7 });
    expect(
      readUserEditAtom(readRecordAt(bytes, 0)).encryptSessionPersistIdRef,
    ).toBe(7);
  });

  it("rejects a record whose type is not RT_UserEditAtom", () => {
    expect(() =>
      readUserEditAtom(readRecordAt(atom(0x03e8, new Uint8Array(28)), 0)),
    ).toThrow(PptFormatError);
  });

  it("rejects a recLen the spec does not allow", () => {
    expect(() =>
      readUserEditAtom(
        readRecordAt(atom(RT_UserEditAtom, new Uint8Array(24)), 0),
      ),
    ).toThrow(PptFormatError);
  });
});

describe("readPersistDirectoryAtom", () => {
  it("expands one entry into consecutive persist identifiers starting at persistId", () => {
    const bytes = persistDirectoryAtom(
      persistDirectoryEntry(1, [0x1000, 0x2000, 0x3000]),
    );
    expect([...readPersistDirectoryAtom(readRecordAt(bytes, 0))]).toEqual([
      [1, 0x1000],
      [2, 0x2000],
      [3, 0x3000],
    ]);
  });

  it("reads several entries whose persistId ranges are not contiguous", () => {
    const bytes = persistDirectoryAtom(
      persistDirectoryEntry(1, [0x1000]),
      persistDirectoryEntry(8, [0x8000, 0x9000]),
    );
    expect([...readPersistDirectoryAtom(readRecordAt(bytes, 0))]).toEqual([
      [1, 0x1000],
      [8, 0x8000],
      [9, 0x9000],
    ]);
  });

  it("reads a persistId that fills all 20 of its bits without bleeding into cPersist", () => {
    const bytes = persistDirectoryAtom(
      persistDirectoryEntry(0xffffe, [0x4000]),
    );
    expect([...readPersistDirectoryAtom(readRecordAt(bytes, 0))]).toEqual([
      [0xffffe, 0x4000],
    ]);
  });

  it("rejects an entry declaring cPersist 0, which the spec forbids", () => {
    const bytes = persistDirectoryAtom(persistDirectoryEntry(1, []));
    expect(() => readPersistDirectoryAtom(readRecordAt(bytes, 0))).toThrow(
      PptFormatError,
    );
  });

  it("rejects an entry whose offset array runs past the record", () => {
    const truncated = atom(
      RT_PersistDirectoryAtom,
      concatBytes(u32le(1 | (3 << 20)), u32le(0x1000)),
    );
    expect(() => readPersistDirectoryAtom(readRecordAt(truncated, 0))).toThrow(
      PptFormatError,
    );
  });
});

describe("buildPersistDirectory", () => {
  it("resolves a single-edit file's directory", () => {
    // A stream holding, in order: a persist directory at 0x00, then the user edit that points at it.
    const directory = persistDirectoryAtom(persistDirectoryEntry(1, [0x40]));
    const edit = userEditAtom({
      offsetPersistDirectory: 0,
      docPersistIdRef: 1,
    });
    const stream = concatBytes(directory, edit);
    const built = buildPersistDirectory(stream, directory.length);
    expect(built.currentEdit.docPersistIdRef).toBe(1);
    expect(built.directory.get(1)).toBe(0x40);
  });

  it("lets a newer edit's directory entry override an older edit's for the same persist id", () => {
    // Oldest first in the stream: directory A (persist 1 -> 0x10), edit A, directory B (persist 1 -> 0x20), edit B. The reader starts at edit B and walks back, and the spec's step 8.3 makes the later pair win.
    const directoryA = persistDirectoryAtom(persistDirectoryEntry(1, [0x10]));
    const editA = userEditAtom({ offsetPersistDirectory: 0 });
    const offsetEditA = directoryA.length;
    const offsetDirectoryB = offsetEditA + editA.length;
    const directoryB = persistDirectoryAtom(persistDirectoryEntry(1, [0x20]));
    const editB = userEditAtom({
      offsetLastEdit: offsetEditA,
      offsetPersistDirectory: offsetDirectoryB,
    });
    const stream = concatBytes(directoryA, editA, directoryB, editB);
    const built = buildPersistDirectory(
      stream,
      offsetDirectoryB + directoryB.length,
    );
    expect(built.directory.get(1)).toBe(0x20);
  });

  it("keeps an older edit's entry for a persist id the newer edit does not restate", () => {
    const directoryA = persistDirectoryAtom(
      persistDirectoryEntry(1, [0x10, 0x11]),
    );
    const editA = userEditAtom({ offsetPersistDirectory: 0 });
    const offsetEditA = directoryA.length;
    const offsetDirectoryB = offsetEditA + editA.length;
    const directoryB = persistDirectoryAtom(persistDirectoryEntry(1, [0x20]));
    const editB = userEditAtom({
      offsetLastEdit: offsetEditA,
      offsetPersistDirectory: offsetDirectoryB,
    });
    const stream = concatBytes(directoryA, editA, directoryB, editB);
    const built = buildPersistDirectory(
      stream,
      offsetDirectoryB + directoryB.length,
    );
    expect(built.directory.get(1)).toBe(0x20);
    expect(built.directory.get(2)).toBe(0x11);
  });

  it("rejects an offsetLastEdit that does not move backwards, which would cycle", () => {
    const directory = persistDirectoryAtom(persistDirectoryEntry(1, [0x40]));
    const offsetEdit = directory.length;
    const edit = userEditAtom({
      offsetLastEdit: offsetEdit,
      offsetPersistDirectory: 0,
    });
    expect(() =>
      buildPersistDirectory(concatBytes(directory, edit), offsetEdit),
    ).toThrow(PptFormatError);
  });

  it("rejects an offsetToCurrentEdit pointing at something other than a UserEditAtom", () => {
    const directory = persistDirectoryAtom(persistDirectoryEntry(1, [0x40]));
    expect(() => buildPersistDirectory(directory, 0)).toThrow(PptFormatError);
  });
});
