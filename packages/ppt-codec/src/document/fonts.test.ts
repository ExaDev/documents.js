import { describe, expect, it } from "vitest";
import { readRecordAt } from "../record/tree";
import {
  RT_Environment,
  RT_FontCollection,
  RT_FontEntityAtom,
  RT_SlideAtom,
} from "../record/types";
import {
  utf16le,
  writeAtom as atom,
  writeContainer as container,
} from "../record/write";
import { readFontNames } from "./fonts";

function fontEntityAtom(
  faceName: string,
  totalBytes = 64,
): Uint8Array<ArrayBuffer> {
  const nameField = new Uint8Array(totalBytes);
  nameField.set(utf16le(faceName).subarray(0, totalBytes));
  return atom(RT_FontEntityAtom, nameField);
}

function environmentWith(
  ...fontEntityAtoms: readonly Uint8Array<ArrayBuffer>[]
): Uint8Array<ArrayBuffer> {
  return container(RT_Environment, [
    container(RT_FontCollection, fontEntityAtoms),
  ]);
}

describe("readFontNames", () => {
  it("reads each FontEntityAtom's own null-terminated face name, in collection order", () => {
    const bytes = environmentWith(
      fontEntityAtom("Arial"),
      fontEntityAtom("Calibri"),
    );
    expect(readFontNames(readRecordAt(bytes, 0))).toEqual(["Arial", "Calibri"]);
  });

  it("returns an empty list for an Environment with no FontCollection at all", () => {
    const bytes = container(RT_Environment, []);
    expect(readFontNames(readRecordAt(bytes, 0))).toEqual([]);
  });

  it("skips a sibling record of some other type inside the FontCollection", () => {
    const bytes = container(RT_Environment, [
      container(RT_FontCollection, [
        atom(RT_SlideAtom, new Uint8Array(0)),
        fontEntityAtom("Arial"),
      ]),
    ]);
    expect(readFontNames(readRecordAt(bytes, 0))).toEqual(["Arial"]);
  });

  it("skips a FontEntityAtom shorter than the mandated 64-byte lfFaceName field", () => {
    const bytes = container(RT_Environment, [
      container(RT_FontCollection, [
        fontEntityAtom("Arial", 32),
        fontEntityAtom("Calibri"),
      ]),
    ]);
    expect(readFontNames(readRecordAt(bytes, 0))).toEqual(["Calibri"]);
  });

  it("stops a face name at its null terminator rather than reading the full 64-byte field as characters", () => {
    // A short name leaves most of the 64-byte field zero; the loop must stop at the first null unit, not append 32 null characters.
    const bytes = environmentWith(fontEntityAtom("Ab"));
    expect(readFontNames(readRecordAt(bytes, 0))).toEqual(["Ab"]);
  });

  it("reads a face name that fills the entire 64-byte field with no terminating null at all", () => {
    // 32 UTF-16 code units, exactly the field's own 64-byte capacity, with no null unit anywhere in it: the loop's own upper bound (FACE_NAME_BYTES), not a null terminator, is what must stop it here.
    const fullName = "A".repeat(31) + "B";
    const nameField = utf16le(fullName);
    expect(nameField).toHaveLength(64);
    const bytes = environmentWith(atom(RT_FontEntityAtom, nameField));
    expect(readFontNames(readRecordAt(bytes, 0))).toEqual([fullName]);
  });
});
