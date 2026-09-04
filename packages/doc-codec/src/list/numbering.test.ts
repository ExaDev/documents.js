import { describe, expect, it } from "vitest";
import { buildFib } from "../test-support/fib";
import { parseFib } from "../fib/fib";
import { readNumberingDefinitions } from "./numbering";

// Hand-built PlfLst/PlfLfo byte sequences, assembled directly from [MS-DOC] 2.9.226 (PlfLst)/2.9.191 (LSTF)/2.9.196 (LVL)/2.9.148 (LVLF)/2.9.343 (Xst)/2.9.225 (PlfLfo)/2.9.181 (LFO)'s own field tables, independently of numbering.ts's own reader -- so a test asserting against these bytes is checking the reader's understanding of the spec, not agreement with a second copy of the same layout (the identical convention table/decoration.test.ts states for its own hand-built Brc80/Shd80 fixtures).

function u16(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}
function u32(value: number): number[] {
  return [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ];
}
function i32(value: number): number[] {
  return u32(value >>> 0);
}

/** One LSTF ([MS-DOC] 2.9.191): lsid(4) + tplc(4, zero -- UI-only) + rgistdPara(18, all 0x0FFF -- "no style linked") + a flags byte (only fSimpleList, bit 0) + grfhic(1, zero). */
function buildLstf(lsid: number, fSimpleList: boolean): number[] {
  const rgistdPara: number[] = [];
  for (let index = 0; index < 9; index += 1) {
    rgistdPara.push(...u16(0x0fff));
  }
  return [
    ...i32(lsid),
    ...u32(0), // tplc
    ...rgistdPara,
    fSimpleList ? 0x01 : 0x00, // A-F flags byte: only fSimpleList set
    0x00, // grfhic
  ];
}

interface XstPart {
  readonly char?: string;
  readonly placeholderLevel?: number;
}

/** An Xst ([MS-DOC] 2.9.343) plus the rgbxchNums positions a caller's own placeholder parts land at -- cch(2) then that many raw 16-bit code units, where a `{ placeholderLevel }` part writes the RAW zero-based level index as its own code unit rather than a literal character, exactly what [MS-DOC]'s own Xst field text describes ("Each placeholder is an unsigned 2-byte integer that specifies the zero-based level"). */
function buildXst(parts: readonly XstPart[]): {
  readonly bytes: number[];
  readonly rgbxchNums: number[];
} {
  const rgtchar: number[] = [];
  const rgbxchNums: number[] = [];
  parts.forEach((part, index) => {
    if (part.placeholderLevel !== undefined) {
      rgtchar.push(...u16(part.placeholderLevel));
      rgbxchNums.push(index + 1);
    } else {
      rgtchar.push(...u16((part.char ?? " ").charCodeAt(0)));
    }
  });
  return { bytes: [...u16(parts.length), ...rgtchar], rgbxchNums };
}

interface LvlSpec {
  readonly startAt?: number;
  readonly nfc: number;
  readonly restart?: number; // sets fNoRestart and ilvlRestartLim together
  readonly text: readonly XstPart[];
}

/** One LVL ([MS-DOC] 2.9.196): a 28-byte LVLF (iStartAt, nfc, the jc/flags byte, rgbxchNums, ixchFollow, dxaIndentSav, unused2, cbGrpprlChpx=0, cbGrpprlPapx=0, ilvlRestartLim, grfhic=0) with grpprlPapx/grpprlChpx both empty (this reader never decodes them, and a real 0-length case is the simplest fixture that still exercises the Xst offset arithmetic correctly) followed immediately by its own Xst. */
function buildLvl(spec: LvlSpec): number[] {
  const { bytes: xstBytes, rgbxchNums } = buildXst(spec.text);
  const rgbxchNumsPadded = [...rgbxchNums];
  while (rgbxchNumsPadded.length < 9) {
    rgbxchNumsPadded.push(0);
  }
  const fNoRestart = spec.restart !== undefined;
  const flags = fNoRestart ? 0x02 : 0x00;
  const lvlf = [
    ...i32(spec.startAt ?? 1),
    spec.nfc,
    flags,
    ...rgbxchNumsPadded,
    0x02, // ixchFollow: nothing follows the number text
    ...i32(0), // dxaIndentSav
    ...u32(0), // unused2
    0x00, // cbGrpprlChpx
    0x00, // cbGrpprlPapx
    spec.restart ?? 0, // ilvlRestartLim
    0x00, // grfhic
  ];
  return [...lvlf, ...xstBytes];
}

interface LstfWithLevels {
  readonly lsid: number;
  readonly levels: readonly LvlSpec[]; // 1 entry for a simple list, 9 for a multi-level one
}

/** PlfLst ([MS-DOC] 2.9.226): cLst(2, signed) then that many 28-byte LSTF entries, followed IMMEDIATELY (not accounted for by lcbPlfLst) by the appended LVL array in LSTF order -- exactly what FibRgFcLcb97's own fcPlfLst field text describes. Returns the two pieces separately since the caller has to place them at fc and fc+lcb respectively, with nothing in between. */
function buildPlfLst(entries: readonly LstfWithLevels[]): {
  readonly plfLst: number[];
  readonly appendedLvls: number[];
} {
  const cLst = i32(entries.length).slice(0, 2); // cLst is a signed 16-bit count per the spec's own field table
  const rgLstf = entries.flatMap((entry) =>
    buildLstf(entry.lsid, entry.levels.length === 1),
  );
  const appendedLvls = entries.flatMap((entry) =>
    entry.levels.flatMap((level) => buildLvl(level)),
  );
  return { plfLst: [...cLst, ...rgLstf], appendedLvls };
}

/** PlfLfo ([MS-DOC] 2.9.225), rgLfo only ([MS-DOC] 2.9.181's own LFO: lsid(4) + unused1(4) + unused2(4) + clfolvl(1)=0 + ibstFltAutoNum(1)=0 + grfhic(1)=0 + unused3(1)) -- this reader never reads rgLfoData (see numbering.ts's own top comment), so the fixture never builds one either; a real file's own lcbPlfLfo would cover rgLfoData too, but nothing in this reader's own contract depends on that extra length being present. */
function buildPlfLfo(lsids: readonly number[]): number[] {
  const rgLfo = lsids.flatMap((lsid) => [
    ...i32(lsid),
    ...u32(0), // unused1
    ...u32(0), // unused2
    0x00, // clfolvl
    0x00, // ibstFltAutoNum
    0x00, // grfhic
    0x00, // unused3
  ]);
  return [...i32(lsids.length), ...rgLfo];
}

/** Assembles a Table stream carrying exactly one PlfLst and one PlfLfo, back to back at arbitrary (but real) offsets, and a Fib whose fcPlfLst/fcPlfLfo point at them -- the minimum a real document needs for readNumberingDefinitions to have anything to resolve. */
function tableStreamWithNumbering(
  entries: readonly LstfWithLevels[],
  lsids: readonly number[],
): { readonly table: Uint8Array; readonly fib: ReturnType<typeof parseFib> } {
  const { plfLst, appendedLvls } = buildPlfLst(entries);
  const plfLfo = buildPlfLfo(lsids);

  const plfLstOffset = 16; // arbitrary non-zero start, proving the reader honours fc rather than assuming 0
  const plfLstBytes = [...plfLst, ...appendedLvls];
  const plfLfoOffset = plfLstOffset + plfLstBytes.length + 8; // a gap, proving the reader does not assume PlfLfo immediately follows PlfLst's own appended LVLs

  const table = new Uint8Array(plfLfoOffset + plfLfo.length);
  table.set(plfLstBytes, plfLstOffset);
  table.set(plfLfo, plfLfoOffset);

  const fib = parseFib(
    buildFib({
      fcPlfLst: plfLstOffset,
      lcbPlfLst: plfLst.length, // NOT including appendedLvls, matching lcbPlfLst's own documented meaning
      fcPlfLfo: plfLfoOffset,
      lcbPlfLfo: plfLfo.length,
    }),
  );
  return { table, fib };
}

describe("readNumberingDefinitions", () => {
  it("returns no definitions at all for a document with no PlfLst/PlfLfo (the common case)", () => {
    const fib = parseFib(buildFib());
    expect(readNumberingDefinitions(new Uint8Array(0), fib)).toEqual({});
  });

  it("resolves a simple one-level bulleted list", () => {
    const { table, fib } = tableStreamWithNumbering(
      [
        {
          lsid: 1000,
          levels: [
            {
              nfc: 0x17, // msonfcBullet
              text: [{ char: "•" }],
            },
          ],
        },
      ],
      [1000],
    );
    const definitions = readNumberingDefinitions(table, fib);
    expect(definitions).toEqual({
      "1": { levels: { "0": { format: "bullet", text: "•", startAt: 1 } } },
    });
  });

  it("resolves a simple one-level decimal list with a '%1.' placeholder template", () => {
    const { table, fib } = tableStreamWithNumbering(
      [
        {
          lsid: 2000,
          levels: [
            {
              nfc: 0x00, // msonfcArabic
              startAt: 3,
              text: [{ placeholderLevel: 0 }, { char: "." }],
            },
          ],
        },
      ],
      [2000],
    );
    const definitions = readNumberingDefinitions(table, fib);
    expect(definitions).toEqual({
      "1": { levels: { "0": { format: "decimal", text: "%1.", startAt: 3 } } },
    });
  });

  it("resolves a nine-level multi-level list, each level its own format and placeholder level", () => {
    const levels: LvlSpec[] = [
      { nfc: 0x00, text: [{ placeholderLevel: 0 }, { char: ")" }] }, // decimal
      {
        nfc: 0x01, // upperRoman
        text: [
          { placeholderLevel: 0 },
          { char: "." },
          { placeholderLevel: 1 },
          { char: ")" },
        ],
      },
      ...Array.from(
        { length: 7 },
        (): LvlSpec => ({ nfc: 0x02, text: [{ placeholderLevel: 2 }] }), // lowerRoman, one placeholder each for levels 2-8
      ),
    ];
    const { table, fib } = tableStreamWithNumbering(
      [{ lsid: 3000, levels }],
      [3000],
    );
    const definitions = readNumberingDefinitions(table, fib);
    expect(Object.keys(definitions["1"]?.levels ?? {})).toHaveLength(9);
    expect(definitions["1"]?.levels["0"]).toEqual({
      format: "decimal",
      text: "%1)",
      startAt: 1,
    });
    expect(definitions["1"]?.levels["1"]).toEqual({
      format: "upperRoman",
      text: "%1.%2)",
      startAt: 1,
    });
    expect(definitions["1"]?.levels["8"]).toEqual({
      format: "lowerRoman",
      text: "%3",
      startAt: 1,
    });
  });

  it("resolves ilvlRestartLim only when fNoRestart is set, and leaves it absent otherwise", () => {
    // A non-simple LSTF always carries exactly nine LVLs ([MS-DOC]'s own fSimpleList field text), even though only the first two are asserted on here -- levels 2-8 are trivial filler with no restart state of their own.
    const levels: LvlSpec[] = [
      { nfc: 0x00, restart: 2, text: [{ placeholderLevel: 0 }] },
      { nfc: 0x00, text: [{ placeholderLevel: 1 }] }, // no restart field: fNoRestart clear
      ...Array.from({ length: 7 }, (): LvlSpec => ({
        nfc: 0x00,
        text: [{ char: "." }],
      })),
    ];
    const { table, fib } = tableStreamWithNumbering(
      [{ lsid: 4000, levels }],
      [4000],
    );
    const definitions = readNumberingDefinitions(table, fib);
    expect(definitions["1"]?.levels["0"]?.restart).toBe(2);
    expect(definitions["1"]?.levels["1"]?.restart).toBeUndefined();
  });

  it("maps nfc 0xFF to format 'none' for a level with no number sequence at all", () => {
    const { table, fib } = tableStreamWithNumbering(
      [{ lsid: 5000, levels: [{ nfc: 0xff, text: [] }] }],
      [5000],
    );
    const definitions = readNumberingDefinitions(table, fib);
    expect(definitions["1"]?.levels["0"]?.format).toBe("none");
  });

  it("keys definitions by the one-based ilfo (rgLfo's own array position), not by lsid", () => {
    // Two lists; the second LFO entry (ilfo 2) points at the FIRST LSTF's lsid, proving resolution goes through lsid matching rather than positional coincidence.
    const { table, fib } = tableStreamWithNumbering(
      [
        { lsid: 10, levels: [{ nfc: 0x00, text: [{ char: "A" }] }] },
        { lsid: 20, levels: [{ nfc: 0x00, text: [{ char: "B" }] }] },
      ],
      [20, 10],
    );
    const definitions = readNumberingDefinitions(table, fib);
    expect(definitions["1"]?.levels["0"]?.text).toBe("B");
    expect(definitions["2"]?.levels["0"]?.text).toBe("A");
  });

  it("throws on an unrecognised MSONFC value", () => {
    const { table, fib } = tableStreamWithNumbering(
      [{ lsid: 6000, levels: [{ nfc: 0x50, text: [] }] }],
      [6000],
    );
    expect(() => readNumberingDefinitions(table, fib)).toThrow(
      /not a recognised MSONFC value/,
    );
  });
});
