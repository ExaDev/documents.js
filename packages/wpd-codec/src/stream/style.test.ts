import { describe, expect, it } from "vitest";
import {
  isParagraphNumberDisplayOff,
  isParagraphNumberDisplayOn,
  isStyleScopeCloser,
  isStyleScopeOpener,
  readDisplayNumberLevel,
  readSystemStyleNumber,
  styleSemanticsFor,
} from "./style";

function opener(systemStyleNumber: number): Uint8Array {
  // "[size of non-deletable information = 3]": "[hash of this Begin On]" then "<system style number>".
  return new Uint8Array([0x34, 0x12, systemStyleNumber]);
}

describe("readSystemStyleNumber", () => {
  it("reads the system style number after the hash", () => {
    expect(readSystemStyleNumber(opener(68))).toBe(68);
  });

  // "<system style number (-1 if normal)>", written into one byte, so the sentinel arrives as 0xFF.
  it("declines the normal-style sentinel", () => {
    expect(readSystemStyleNumber(opener(0xff))).toBeUndefined();
  });

  it("declines a function with no room for the field", () => {
    expect(readSystemStyleNumber(new Uint8Array([0x00, 0x00]))).toBeUndefined();
  });
});

describe("styleSemanticsFor", () => {
  // "68 = heading level 1 style" through "75 = heading level 8 style".
  it.each([
    [68, 1],
    [69, 2],
    [75, 8],
  ])("maps system style %i to heading level %i", (systemStyle, level) => {
    expect(styleSemanticsFor(systemStyle)).toEqual({
      headingLevel: level,
      listLevel: undefined,
    });
  });

  // "52 = level 1 style (indented)" through "59 = level 8 style (indented)", and "60 = level 1 style (not indented)" through "67 = level 8 style (not indented)". ContentListMembership counts levels from zero, so the SDK's level 1 is level 0 here.
  it.each([
    [52, 0],
    [59, 7],
    [60, 0],
    [67, 7],
  ])("maps outline system style %i to list level %i", (systemStyle, level) => {
    expect(styleSemanticsFor(systemStyle)).toEqual({
      headingLevel: undefined,
      listLevel: level,
    });
  });

  // "31 = list" and "48 = bullets" name a flat list rather than a numbered outline depth.
  it.each([31, 48])(
    "maps system style %i to the outermost list level",
    (systemStyle) => {
      expect(styleSemanticsFor(systemStyle)).toEqual({
        headingLevel: undefined,
        listLevel: 0,
      });
    },
  );

  // Every other entry the SDK enumerates -- "1 = normal", "36 = footnote", "39 = header a", "35 = caption" -- names a region whose own construct this package does not lift, so it carries no structure rather than being forced onto the nearest thing that fits.
  it.each([1, 35, 36, 39])(
    "gives system style %i no structural meaning",
    (systemStyle) => {
      expect(styleSemanticsFor(systemStyle)).toBeUndefined();
    },
  );
});

describe("style scope pairing", () => {
  // "2 = Encased/paired function. Begin/On codes are mod 4=0 subfunctions ... followed immediately by Begin/Off, End/On and End/Off codes numbered consecutively", and "3 = Encased function. Begin/On codes are even subfunctions and End/Off codes are the next odd subfunction". So 0 opens and 3 closes; 4 opens and 9 closes; 10 opens and 11 closes.
  it.each([0, 4, 10])(
    "treats subfunction %i as a scope opener",
    (subfunction) => {
      expect(isStyleScopeOpener(subfunction)).toBe(true);
      expect(isStyleScopeCloser(subfunction)).toBe(false);
    },
  );

  it.each([3, 9, 11])(
    "treats subfunction %i as a scope closer",
    (subfunction) => {
      expect(isStyleScopeCloser(subfunction)).toBe(true);
      expect(isStyleScopeOpener(subfunction)).toBe(false);
    },
  );

  // The four intermediate subfunctions delimit the style's own before- and after-codes inside a region already open, so neither opens nor closes a scope of its own.
  it.each([1, 2, 5, 6, 7, 8])(
    "treats subfunction %i as neither opener nor closer",
    (subfunction) => {
      expect(isStyleScopeOpener(subfunction)).toBe(false);
      expect(isStyleScopeCloser(subfunction)).toBe(false);
    },
  );
});

describe("paragraph number display", () => {
  it("recognises the Paragraph Number Display pair", () => {
    expect(isParagraphNumberDisplayOn(0x0c)).toBe(true);
    expect(isParagraphNumberDisplayOff(0x0d)).toBe(true);
  });

  // The other members of the group display a page, chapter, box, footnote or endnote counter inside running text and carry no document structure.
  it.each([0x04, 0x0e, 0x10])(
    "does not treat subfunction %i as a paragraph number",
    (subfunction) => {
      expect(isParagraphNumberDisplayOn(subfunction)).toBe(false);
    },
  );

  // "[size of non-deletable information = 1] <level number to display (0 - n)>".
  it("reads the level number to display", () => {
    expect(readDisplayNumberLevel(new Uint8Array([2]))).toBe(2);
  });
});
