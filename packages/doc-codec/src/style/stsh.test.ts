import { describe, expect, it } from "vitest";
import { DocFormatError } from "../errors";
import { decodeSprm, type Prl } from "../prop/sprm";
import {
  buildStshForStyles,
  headingLevelFromIstd,
  parseStsh,
  resolveStyleFormatting,
  STK,
  type StyleSheet,
} from "./stsh";

// A minimal, otherwise-empty Stshif (18 bytes): cstd, cbSTDBaseInFile, fStdStylenamesWritten, stiMaxWhenSaved, istdMaxFixedWhenSaved, nVerBuiltInNamesWhenSaved, ftcAsci, ftcFE, ftcOther, ftcBi, cbLSD.
function stshiBytes(cstd: number, cbStdBaseInFile: number): number[] {
  const push16 = (target: number[], value: number): void => {
    target.push(value & 0xff, (value >> 8) & 0xff);
  };
  const bytes: number[] = [];
  push16(bytes, cstd);
  push16(bytes, cbStdBaseInFile);
  push16(bytes, 0x0001);
  push16(bytes, 0);
  push16(bytes, 0x000f);
  push16(bytes, 0);
  push16(bytes, 0);
  push16(bytes, 0);
  push16(bytes, 0);
  push16(bytes, 0);
  push16(bytes, 4);
  return bytes;
}

function stshBytes(
  stshi: readonly number[],
  entries: readonly number[],
): Uint8Array {
  return new Uint8Array([
    stshi.length & 0xff,
    (stshi.length >> 8) & 0xff,
    ...stshi,
    ...entries,
  ]);
}

describe("parseStsh", () => {
  it("rejects an STSHI shorter than the fixed 18-byte Stshif", () => {
    const bytes = stshBytes([0x00, 0x00], []);
    expect(() => parseStsh(bytes)).toThrow(DocFormatError);
    expect(() => parseStsh(bytes)).toThrow(/shorter than the fixed 18-byte/);
  });

  it("accepts cbSTDBaseInFile 0x000A (no StdfPost2000)", () => {
    const bytes = stshBytes(stshiBytes(0, 0x000a), []);
    expect(() => parseStsh(bytes)).not.toThrow();
  });

  it("accepts cbSTDBaseInFile 0x0012 (with StdfPost2000)", () => {
    const bytes = stshBytes(stshiBytes(0, 0x0012), []);
    expect(() => parseStsh(bytes)).not.toThrow();
  });

  it("rejects a cbSTDBaseInFile that is neither of the two sizes [MS-DOC] permits", () => {
    const bytes = stshBytes(stshiBytes(0, 0x0009), []);
    expect(() => parseStsh(bytes)).toThrow(/neither of the two sizes/);
  });

  it("rejects a negative cbStd", () => {
    const bytes = stshBytes(stshiBytes(1, 0x000a), [0xff, 0xff]); // -1 as a signed int16.
    expect(() => parseStsh(bytes)).toThrow(/declares cbStd -1/);
  });

  it("reads an empty style-sheet hole (cbStd 0) as an undefined slot", () => {
    const bytes = stshBytes(stshiBytes(1, 0x000a), [0, 0]);
    const sheet = parseStsh(bytes);
    expect(sheet.styles).toHaveLength(1);
    expect(sheet.styles[0]).toBeUndefined();
  });

  it("round-trips a real style's identity and formatting via buildStshForStyles", () => {
    const bytes = buildStshForStyles(
      new Map([
        [0, "Normal"],
        [3, "MyStyle"],
      ]),
    );
    const sheet = parseStsh(bytes);
    expect(sheet.styles).toHaveLength(4);
    expect(sheet.styles[0]?.name).toBe("Normal");
    expect(sheet.styles[1]).toBeUndefined();
    expect(sheet.styles[2]).toBeUndefined();
    expect(sheet.styles[3]?.name).toBe("MyStyle");
    expect(sheet.styles[3]?.stk).toBe(STK.paragraph);
    expect(sheet.styles[3]?.istdBase).toBeUndefined();
  });

  it("round-trips style names of both odd and even character length, exercising both LPStd padding parities", () => {
    const bytes = buildStshForStyles(
      new Map([
        [0, "Odd"], // 3 characters.
        [1, "Even1"], // 5 characters -- still exercises the other STD-length parity from the total record size.
      ]),
    );
    const sheet = parseStsh(bytes);
    expect(sheet.styles[0]?.name).toBe("Odd");
    expect(sheet.styles[1]?.name).toBe("Even1");
  });
});

describe("resolveStyleFormatting", () => {
  function sheet(
    styles: ReadonlyMap<number, StyleSheet["styles"][number]>,
  ): StyleSheet {
    const max = styles.size === 0 ? -1 : Math.max(...styles.keys());
    const array: StyleSheet["styles"][number][] = [];
    for (let index = 0; index <= max; index += 1) {
      array.push(styles.get(index));
    }
    return { styles: array };
  }

  it("returns empty formatting when the given istd names no style", () => {
    const resolved = resolveStyleFormatting({ styles: [] }, 0);
    expect(resolved.paragraphPrls).toEqual([]);
    expect(resolved.characterPrls).toEqual([]);
  });

  it("returns a style's own formatting when it has no base", () => {
    const prl: Prl = { sprm: decodeSprm(0x2a30), operand: new Uint8Array([1]) };
    const styleSheet = sheet(
      new Map([
        [
          0,
          {
            istd: 0,
            sti: 0,
            stk: STK.paragraph,
            istdBase: undefined,
            name: "Normal",
            grpprlPapx: [prl],
            grpprlChpx: undefined,
          },
        ],
      ]),
    );
    const resolved = resolveStyleFormatting(styleSheet, 0);
    expect(resolved.paragraphPrls).toEqual([prl]);
    expect(resolved.characterPrls).toEqual([]);
  });

  it("applies the base style's own formatting first, so the derived style's later entry wins on the same property", () => {
    const basePrl: Prl = {
      sprm: decodeSprm(0x2a30),
      operand: new Uint8Array([0]),
    };
    const derivedPrl: Prl = {
      sprm: decodeSprm(0x2a30),
      operand: new Uint8Array([1]),
    };
    const styleSheet = sheet(
      new Map([
        [
          0,
          {
            istd: 0,
            sti: 0,
            stk: STK.paragraph,
            istdBase: undefined,
            name: "Normal",
            grpprlPapx: [basePrl],
            grpprlChpx: undefined,
          },
        ],
        [
          1,
          {
            istd: 1,
            sti: 0,
            stk: STK.paragraph,
            istdBase: 0,
            name: "Derived",
            grpprlPapx: [derivedPrl],
            grpprlChpx: undefined,
          },
        ],
      ]),
    );
    const resolved = resolveStyleFormatting(styleSheet, 1);
    // Base applied first, then derived, so a reader applying "last Prl wins" ends on the derived style's own value.
    expect(resolved.paragraphPrls).toEqual([basePrl, derivedPrl]);
  });

  it("throws when an istdBase chain loops back on itself", () => {
    const styleSheet = sheet(
      new Map([
        [
          0,
          {
            istd: 0,
            sti: 0,
            stk: STK.paragraph,
            istdBase: 1,
            name: "A",
            grpprlPapx: undefined,
            grpprlChpx: undefined,
          },
        ],
        [
          1,
          {
            istd: 1,
            sti: 0,
            stk: STK.paragraph,
            istdBase: 0,
            name: "B",
            grpprlPapx: undefined,
            grpprlChpx: undefined,
          },
        ],
      ]),
    );
    expect(() => resolveStyleFormatting(styleSheet, 0)).toThrow(DocFormatError);
    expect(() => resolveStyleFormatting(styleSheet, 0)).toThrow(/loops back/);
  });

  it("carries characterPrls alone for a style whose own grpprlPapx is undefined", () => {
    const chpxPrl: Prl = {
      sprm: decodeSprm(0x2a30),
      operand: new Uint8Array([1]),
    };
    const styleSheet = sheet(
      new Map([
        [
          0,
          {
            istd: 0,
            sti: 0,
            stk: STK.character,
            istdBase: undefined,
            name: "CharStyle",
            grpprlPapx: undefined,
            grpprlChpx: [chpxPrl],
          },
        ],
      ]),
    );
    const resolved = resolveStyleFormatting(styleSheet, 0);
    expect(resolved.paragraphPrls).toEqual([]);
    expect(resolved.characterPrls).toEqual([chpxPrl]);
  });
});

describe("headingLevelFromIstd", () => {
  it("resolves istd 0 to undefined -- below the heading range", () => {
    expect(headingLevelFromIstd(0)).toBeUndefined();
  });

  it("resolves istd 1 to heading level 1, the bottom of the range", () => {
    expect(headingLevelFromIstd(1)).toBe(1);
  });

  it("resolves istd 9 to heading level 9, the top of the range", () => {
    expect(headingLevelFromIstd(9)).toBe(9);
  });

  it("resolves istd 10 to undefined -- past the heading range", () => {
    expect(headingLevelFromIstd(10)).toBeUndefined();
  });
});

describe("buildStshForStyles", () => {
  it("mints a zero-style STSH for an empty names map", () => {
    const bytes = buildStshForStyles(new Map());
    const sheet = parseStsh(bytes);
    expect(sheet.styles).toHaveLength(0);
  });

  it("sizes cstd from the highest named istd, leaving lower unnamed istds as holes", () => {
    const bytes = buildStshForStyles(new Map([[2, "Third"]]));
    const sheet = parseStsh(bytes);
    expect(sheet.styles).toHaveLength(3);
    expect(sheet.styles[0]).toBeUndefined();
    expect(sheet.styles[1]).toBeUndefined();
    expect(sheet.styles[2]?.name).toBe("Third");
  });
});
