import { describe, expect, it } from "vitest";
import { DocFormatError } from "../errors";
import { decodeSprm, type Prl } from "../prop/sprm";
import {
  buildStshForStyles,
  headingLevelFromIstd,
  mintStyleIstds,
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

  it("names the STSHI slice itself when cbStshi overruns the stream", () => {
    const bytes = new Uint8Array([0x05, 0x00]); // cbStshi = 5, but nothing follows the 2-byte prefix.
    expect(() => parseStsh(bytes)).toThrow(/STSH\.lpstshi\.stshi/);
  });

  it("accepts an STSHI of exactly the fixed 18-byte Stshif size, with nothing beyond it", () => {
    const stshi = stshiBytes(0, 0x000a).slice(0, 18); // the first 9 fields = 18 bytes; drop ftcBi/cbLSD.
    const bytes = stshBytes(stshi, []);
    expect(() => parseStsh(bytes)).not.toThrow();
  });

  it("names the STD slice itself when cbStd overruns the stream", () => {
    const bytes = stshBytes(stshiBytes(1, 0x000a), [0x05, 0x00]); // cbStd = 5, nothing following.
    expect(() => parseStsh(bytes)).toThrow(/STD for istd 0/);
  });

  it("names the style name slice itself when Xstz's own cch overruns its STD", () => {
    const std = [
      0,
      0, // word0: sti = 0.
      0,
      0, // word1: stk = 0, istdBase = 0 (unused by this error path).
      0,
      0,
      0,
      0,
      0,
      0, // filler up to cbStdBaseInFile's own offset (10).
      100,
      0, // cch = 100, far more than the 0 bytes actually following.
    ];
    const bytes = stshBytes(stshiBytes(1, 0x000a), [
      std.length & 0xff,
      (std.length >> 8) & 0xff,
      ...std,
    ]);
    expect(() => parseStsh(bytes)).toThrow(/name of the style at istd 0/);
  });

  it("names the UpxPapx slice itself when its own cbUpx overruns the STD", () => {
    const std = [
      0,
      0, // word0: sti = 0.
      STK.paragraph,
      0, // word1: stk = paragraph, istdBase = 0.
      0,
      0,
      0,
      0,
      0,
      0, // filler up to offset 10.
      0,
      0, // cch = 0 (empty name), at offset 10.
      0,
      0, // the Xstz's own null terminator, unread by readXstz but present so grLPUpxSwOffset (14) lines up.
      0x64,
      0x00, // UpxPapx's own cbUpx = 100 at offset 14, far more than the 0 bytes actually following.
    ];
    const bytes = stshBytes(stshiBytes(1, 0x000a), [
      std.length & 0xff,
      (std.length >> 8) & 0xff,
      ...std,
    ]);
    expect(() => parseStsh(bytes)).toThrow(
      /UpxPapx for the paragraph style at istd 0/,
    );
  });

  it("names the UpxChpx slice itself when its own cbUpx overruns the STD", () => {
    const std = [
      0,
      0, // word0: sti = 0.
      STK.paragraph,
      0, // word1: stk = paragraph, istdBase = 0.
      0,
      0,
      0,
      0,
      0,
      0, // filler up to offset 10.
      0,
      0, // cch = 0 (empty name).
      0,
      0, // Xstz's own null terminator.
      0,
      0, // UpxPapx's own cbUpx = 0 (an empty UpxPapx, so its own read cannot fail here).
      0x64,
      0x00, // UpxChpx's own cbUpx = 100, far more than the 0 bytes actually following.
    ];
    const bytes = stshBytes(stshiBytes(1, 0x000a), [
      std.length & 0xff,
      (std.length >> 8) & 0xff,
      ...std,
    ]);
    expect(() => parseStsh(bytes)).toThrow(
      /UpxChpx for the paragraph style at istd 0/,
    );
  });

  it("names the paragraph style's own grpprlPapx slice when UpxPapx's own istd prefix leaves less than 2 bytes", () => {
    const std = [
      0,
      0, // word0: sti = 0.
      STK.paragraph,
      0, // word1: stk = paragraph, istdBase = 0.
      0,
      0,
      0,
      0,
      0,
      0, // filler up to offset 10.
      0,
      0, // cch = 0 (empty name).
      0,
      0, // Xstz's own null terminator.
      1,
      0, // UpxPapx's own cbUpx = 1 — one byte, too short for UpxPapx's own 2-byte istd prefix.
      0xff, // UpxPapx's own 1-byte payload.
      0x00, // the format's own even-byte pad, since cbUpx (1) is odd.
      0,
      0, // UpxChpx's own cbUpx = 0 (empty, so its own read cannot fail here).
    ];
    const bytes = stshBytes(stshiBytes(1, 0x000a), [
      std.length & 0xff,
      (std.length >> 8) & 0xff,
      ...std,
    ]);
    expect(() => parseStsh(bytes)).toThrow(
      /grpprlPapx for the paragraph style at istd 0/,
    );
  });

  it("names the character style's own UpxChpx slice when its own cbUpx overruns the STD", () => {
    const std = [
      0,
      0, // word0: sti = 0.
      STK.character,
      0, // word1: stk = character, istdBase = 0.
      0,
      0,
      0,
      0,
      0,
      0, // filler up to offset 10.
      0,
      0, // cch = 0 (empty name).
      0,
      0, // Xstz's own null terminator.
      0x64,
      0x00, // UpxChpx's own cbUpx = 100, far more than the 0 bytes actually following.
    ];
    const bytes = stshBytes(stshiBytes(1, 0x000a), [
      std.length & 0xff,
      (std.length >> 8) & 0xff,
      ...std,
    ]);
    expect(() => parseStsh(bytes)).toThrow(
      /UpxChpx for the character style at istd 0/,
    );
  });

  it("advances past an odd-length STD's own even-byte pad before reading the next entry", () => {
    // Both entries are stk table (3): parseGrLPUpxSw returns immediately for a table/numbering style without reading anything past the name, so a minimal entry needs only StdfBase and an Xstz.
    const entry0 = [
      0,
      0, // word0: sti = 0.
      STK.table,
      0, // word1: stk = table, istdBase = 0.
      0,
      0,
      0,
      0,
      0,
      0, // filler up to offset 10.
      0,
      0, // cch = 0 (empty name).
      0xaa, // one extra byte inside this entry's own declared cbStd (13, odd) — unused by
      // a table-kind style, but its oddness means the format's own even-byte LPStd pad byte genuinely follows this entry, unlike every entry buildStshForStyles itself mints.
    ];
    const name1 = "OK";
    const entry1 = [
      0,
      0, // word0: sti = 0.
      STK.table,
      0, // word1: stk = table, istdBase = 0.
      0,
      0,
      0,
      0,
      0,
      0, // filler up to offset 10.
      name1.length,
      0, // cch = 2.
      ...Array.from(name1, (character) => character.charCodeAt(0)).flatMap(
        (code) => [code & 0xff, (code >> 8) & 0xff],
      ),
    ];
    const bytes = stshBytes(stshiBytes(2, 0x000a), [
      entry0.length & 0xff,
      (entry0.length >> 8) & 0xff,
      ...entry0,
      0x00, // the real pad byte an odd cbStd (13) requires before the next entry.
      entry1.length & 0xff,
      (entry1.length >> 8) & 0xff,
      ...entry1,
    ]);
    const sheet = parseStsh(bytes);
    expect(sheet.styles).toHaveLength(2);
    expect(sheet.styles[1]?.name).toBe("OK");
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
        [1, "Even1"], // 5 characters — still exercises the other STD-length parity from the total record size.
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
  it("resolves istd 0 to undefined — below the heading range", () => {
    expect(headingLevelFromIstd(0)).toBeUndefined();
  });

  it("resolves istd 1 to heading level 1, the bottom of the range", () => {
    expect(headingLevelFromIstd(1)).toBe(1);
  });

  it("resolves istd 9 to heading level 9, the top of the range", () => {
    expect(headingLevelFromIstd(9)).toBe(9);
  });

  it("resolves istd 10 to undefined — past the heading range", () => {
    expect(headingLevelFromIstd(10)).toBeUndefined();
  });
});

describe("mintStyleIstds", () => {
  it("mints istd 0 with no style name for a paragraph stating neither styleId nor headingLevel", () => {
    const { istds, styleNames } = mintStyleIstds([{}]);
    expect(istds).toEqual([0]);
    expect(styleNames.size).toBe(0);
  });

  it("mints a heading paragraph's own istd directly from its headingLevel, naming it by its styleId", () => {
    const { istds, styleNames } = mintStyleIstds([
      { styleId: "heading 1", headingLevel: 1 },
    ]);
    expect(istds).toEqual([1]);
    expect(styleNames.get(1)).toBe("heading 1");
  });

  it("defaults a heading paragraph's own style name to 'Heading N' when it states no styleId of its own", () => {
    const { istds, styleNames } = mintStyleIstds([{ headingLevel: 3 }]);
    expect(istds).toEqual([3]);
    expect(styleNames.get(3)).toBe("Heading 3");
  });

  it("keeps the first paragraph's own style name for a heading level a later paragraph names differently", () => {
    const { istds, styleNames } = mintStyleIstds([
      { headingLevel: 2 },
      { styleId: "Renamed Heading", headingLevel: 2 },
    ]);
    expect(istds).toEqual([2, 2]);
    expect(styleNames.get(2)).toBe("Heading 2");
  });

  it("treats headingLevel 0 as out of the heading range, falling back to the paragraph's own styleId", () => {
    const { istds, styleNames } = mintStyleIstds([
      { styleId: "Custom", headingLevel: 0 },
    ]);
    expect(istds).toEqual([10]);
    expect(styleNames.get(10)).toBe("Custom");
  });

  it("treats headingLevel 9 — the top of the heading range — as a genuine heading", () => {
    const { istds } = mintStyleIstds([{ headingLevel: 9 }]);
    expect(istds).toEqual([9]);
  });

  it("treats headingLevel 10 — past the top of the heading range — as an ordinary named style", () => {
    const { istds } = mintStyleIstds([{ styleId: "Custom", headingLevel: 10 }]);
    expect(istds).toEqual([10]);
  });

  it("mints istd 0 for a headingLevel-10 paragraph that states no styleId either", () => {
    const { istds, styleNames } = mintStyleIstds([{ headingLevel: 10 }]);
    expect(istds).toEqual([0]);
    expect(styleNames.size).toBe(0);
  });

  it("mints a fresh istd starting at 10 for the first ordinary named style, then reuses it for every later paragraph sharing that styleId", () => {
    const { istds, styleNames } = mintStyleIstds([
      { styleId: "Quote" },
      { styleId: "Quote" },
      { styleId: "Caption" },
    ]);
    expect(istds).toEqual([10, 10, 11]);
    expect(styleNames.get(10)).toBe("Quote");
    expect(styleNames.get(11)).toBe("Caption");
  });

  it("mints three distinct ordinary styles at three sequential istds, in first-use order", () => {
    const { istds } = mintStyleIstds([
      { styleId: "A" },
      { styleId: "B" },
      { styleId: "C" },
    ]);
    expect(istds).toEqual([10, 11, 12]);
  });

  it("mints a real entry for a styleId literally 'Normal', distinct from the istd-0 hole an absent styleId leaves", () => {
    const { istds, styleNames } = mintStyleIstds([{ styleId: "Normal" }, {}]);
    expect(istds).toEqual([10, 0]);
    expect(styleNames.get(10)).toBe("Normal");
    expect(styleNames.has(0)).toBe(false);
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

  it("writes every fixed STSHI header field [MS-DOC] mandates, not merely cbStshi", () => {
    const bytes = buildStshForStyles(new Map());
    const words: number[] = [];
    for (let index = 0; index < 11; index += 1) {
      const offset = 2 + index * 2;
      words.push((bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8));
    }
    expect(words).toEqual([
      0, // cstd.
      0x000a, // cbSTDBaseInFile (STDF_SIZE_WITHOUT_POST_2000).
      0x0001, // fStdStylenamesWritten — [MS-DOC] requires 1.
      0, // stiMaxWhenSaved.
      0x000f, // istdMaxFixedWhenSaved — [MS-DOC] requires 0x000F.
      0, // nVerBuiltInNamesWhenSaved.
      0, // ftcAsci.
      0, // ftcFE.
      0, // ftcOther.
      0, // ftcBi.
      4, // StshiLsd.cbLSD — [MS-DOC] requires 4.
    ]);
  });

  it("writes exactly one 24-byte style entry after the 24-byte STSHI header for a single-key map, with no trailing hole", () => {
    // STSHI header: a 2-byte cbStshi prefix plus the 22-byte, 11-word body above = 24 bytes. One istd-0 entry named "A": a 2-byte cbStd prefix plus a 22-byte STD (10-byte StdfBase, a 4-byte Xstz for a 1-character name, a 4-byte empty UpxPapx, a 2-byte empty UpxChpx) = 24 bytes, itself even so no trailing LPStd pad follows it.
    const bytes = buildStshForStyles(new Map([[0, "A"]]));
    expect(bytes.length).toBe(48);
  });
});
