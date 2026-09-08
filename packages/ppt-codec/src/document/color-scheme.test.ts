import { describe, expect, it } from "vitest";
import {
  readSlideSchemeColorSchemeAtom,
  resolveSchemeColor,
} from "./color-scheme";
import { PptFormatError } from "../errors";
import { readRecordAt } from "../record/tree";
import { RT_ColorSchemeAtom, RT_DocumentAtom } from "../record/types";
import { concatBytes, writeAtom as atom } from "../record/write";

const SLIDE_SCHEME_REC_INSTANCE = 0x001;

function colorSchemeBytes(
  colors: readonly (readonly [number, number, number])[],
  recInstance: number = SLIDE_SCHEME_REC_INSTANCE,
): Uint8Array<ArrayBuffer> {
  return atom(
    RT_ColorSchemeAtom,
    concatBytes(
      ...colors.map(
        ([red, green, blue]) => new Uint8Array([red, green, blue, 0]),
      ),
    ),
    { recInstance },
  );
}

const EIGHT_COLORS: readonly (readonly [number, number, number])[] = [
  [0xff, 0xff, 0xff],
  [0x00, 0x00, 0x00],
  [0x80, 0x80, 0x80],
  [0x00, 0x00, 0x00],
  [0xe6, 0xf2, 0xff],
  [0x1a, 0x4b, 0x8c],
  [0x8c, 0x1a, 0x4b],
  [0x4b, 0x8c, 0x1a],
];

describe("readSlideSchemeColorSchemeAtom", () => {
  it("reads all 8 scheme slots in order", () => {
    const bytes = colorSchemeBytes(EIGHT_COLORS);
    const colors = readSlideSchemeColorSchemeAtom(readRecordAt(bytes, 0));
    expect(colors).toEqual(
      EIGHT_COLORS.map(([red, green, blue]) => ({ red, green, blue })),
    );
  });

  it("rejects a record that is not RT_ColorSchemeAtom", () => {
    const bytes = atom(RT_DocumentAtom, new Uint8Array(0x28));
    expect(() =>
      readSlideSchemeColorSchemeAtom(readRecordAt(bytes, 0)),
    ).toThrow(PptFormatError);
  });

  it("rejects a ColorSchemeAtom whose recInstance is not the slide-scheme's own 0x001", () => {
    const bytes = colorSchemeBytes(EIGHT_COLORS, 0x002);
    expect(() =>
      readSlideSchemeColorSchemeAtom(readRecordAt(bytes, 0)),
    ).toThrow(PptFormatError);
  });

  it("rejects a record with fewer than 8 scheme slots", () => {
    const bytes = colorSchemeBytes(EIGHT_COLORS.slice(0, 7));
    expect(() =>
      readSlideSchemeColorSchemeAtom(readRecordAt(bytes, 0)),
    ).toThrow(PptFormatError);
  });
});

describe("resolveSchemeColor", () => {
  const scheme = EIGHT_COLORS.map(([red, green, blue]) => ({
    red,
    green,
    blue,
  }));

  it("resolves a valid slot index to its colour", () => {
    expect(resolveSchemeColor(5, scheme)).toEqual({
      red: 0x1a,
      green: 0x4b,
      blue: 0x8c,
    });
  });

  it("throws for an index with no entry in the given scheme", () => {
    expect(() => resolveSchemeColor(8, scheme)).toThrow(PptFormatError);
  });
});
