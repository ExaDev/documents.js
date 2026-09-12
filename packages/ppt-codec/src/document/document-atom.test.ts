import { describe, expect, it } from "vitest";
import { PptFormatError } from "../errors";
import { readRecordAt } from "../record/tree";
import { RT_DocumentAtom, RT_SlideAtom } from "../record/types";
import {
  i32le,
  u16le,
  u32le,
  writeAtom as atom,
  concatBytes,
} from "../record/write";
import { readDocumentAtom } from "./document-atom";

function documentAtomBytes(
  overrides: {
    slideSize?: readonly [number, number];
    notesSize?: readonly [number, number];
    notesMasterPersistIdRef?: number;
    handoutMasterPersistIdRef?: number;
    firstSlideNumber?: number;
    slideSizeType?: number;
  } = {},
): Uint8Array<ArrayBuffer> {
  const [sx, sy] = overrides.slideSize ?? [9144000, 6858000];
  const [nx, ny] = overrides.notesSize ?? [9144000, 6858000];
  return atom(
    RT_DocumentAtom,
    concatBytes(
      i32le(sx),
      i32le(sy),
      i32le(nx),
      i32le(ny),
      i32le(1), // serverZoom numerator
      i32le(2), // serverZoom denominator
      u32le(overrides.notesMasterPersistIdRef ?? 0),
      u32le(overrides.handoutMasterPersistIdRef ?? 0),
      u16le(overrides.firstSlideNumber ?? 1),
      u16le(overrides.slideSizeType ?? 0),
      new Uint8Array(4),
    ),
    { recVer: 0x1 },
  );
}

describe("readDocumentAtom", () => {
  it("reads slideSize and notesSize as independent PointStructs", () => {
    const bytes = documentAtomBytes({
      slideSize: [720, 540],
      notesSize: [800, 600],
    });
    const info = readDocumentAtom(readRecordAt(bytes, 0));
    expect(info.slideSize).toEqual({ x: 720, y: 540 });
    expect(info.notesSize).toEqual({ x: 800, y: 600 });
  });

  it("reads notesMasterPersistIdRef, handoutMasterPersistIdRef, firstSlideNumber and slideSizeType from their own fixed offsets", () => {
    const bytes = documentAtomBytes({
      notesMasterPersistIdRef: 5,
      handoutMasterPersistIdRef: 6,
      firstSlideNumber: 3,
      slideSizeType: 2,
    });
    const info = readDocumentAtom(readRecordAt(bytes, 0));
    expect(info.notesMasterPersistIdRef).toBe(5);
    expect(info.handoutMasterPersistIdRef).toBe(6);
    expect(info.firstSlideNumber).toBe(3);
    expect(info.slideSizeType).toBe(2);
  });

  it("rejects a record whose type is not RT_DocumentAtom", () => {
    const bytes = atom(RT_SlideAtom, new Uint8Array(0x28));
    expect(() => readDocumentAtom(readRecordAt(bytes, 0))).toThrow(
      PptFormatError,
    );
    expect(() => readDocumentAtom(readRecordAt(bytes, 0))).toThrow(
      `expected RT_DocumentAtom (0x${RT_DocumentAtom.toString(16)}), found record type 0x${RT_SlideAtom.toString(16)}`,
    );
  });

  it("rejects a DocumentAtom shorter than the mandated 0x28 bytes", () => {
    const bytes = atom(RT_DocumentAtom, new Uint8Array(0x20), {
      recVer: 0x1,
    });
    expect(() => readDocumentAtom(readRecordAt(bytes, 0))).toThrow(
      PptFormatError,
    );
    expect(() => readDocumentAtom(readRecordAt(bytes, 0))).toThrow(
      "DocumentAtom carries 32 bytes, fewer than the mandated 0x28",
    );
  });
});
