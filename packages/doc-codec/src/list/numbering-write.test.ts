import { describe, expect, it } from "vitest";
import { DocFormatError } from "../errors";
import type { NumberingDefinitions, NumberingLevel } from "./numbering";
import { buildNumberingTables, gatherListUsage } from "./numbering-write";

// Hand-built expected PlfLst/PlfLfo byte sequences, assembled directly from [MS-DOC] 2.9.226 (PlfLst)/2.9.191 (LSTF)/2.9.196 (LVL)/2.9.148 (LVLF)/2.9.343 (Xst)/2.9.225 (PlfLfo)/2.9.181 (LFO)'s own field tables, independently of numbering-write.ts's own implementation -- the identical convention numbering.test.ts states for its own reader-side fixtures (and table/decoration.test.ts for its writer-side ones), applied here to buildNumberingTables/gatherListUsage: a test asserting against these bytes is checking this module's own understanding of the spec, not agreement with a second copy of the same layout. write.test.ts's own "writeDocContent numbering" describe block already covers what a whole document does with a paragraph's own list membership through a full read-back round trip; every case here covers a real defect that a round trip through this package's own reader cannot catch, because the reader either ignores the byte in question entirely (rgistdPara) or folds it order-insensitively (an sprm's own position -- see prop/pap-write.test.ts) or reader-and-writer shared one wrong constant (fNoRestart's own bit).

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

/** One LSTF ([MS-DOC] 2.9.191) exactly as buildNumberingTables must emit it: lsid(4) + tplc(4, zero) + rgistdPara(18, nine 0x0FFF entries -- "MUST be set to 0x0FFF to specify that this level is not linked to a style", a real MUST this writer has to satisfy even though numbering.ts's own reader ignores the field entirely) + a flags byte (only fSimpleList, bit 0) + grfhic(1, zero). */
function expectedLstf(lsid: number, fSimpleList: boolean): number[] {
  const rgistdPara: number[] = [];
  for (let index = 0; index < 9; index += 1) {
    rgistdPara.push(...u16(0x0fff));
  }
  return [
    ...u32(lsid),
    ...u32(0), // tplc
    ...rgistdPara,
    fSimpleList ? 0x01 : 0x00,
    0x00, // grfhic
  ];
}

/** An Xst ([MS-DOC] 2.9.343): cch(2) then that many raw 16-bit code units, given here as already-substituted raw code points (a placeholder's own raw level-index code unit included) rather than as text plus separate placeholder positions -- the caller already knows exactly which bytes buildLevelXst must produce. */
function expectedXst(codeUnits: readonly number[]): number[] {
  return [...u16(codeUnits.length), ...codeUnits.flatMap((unit) => u16(unit))];
}

interface ExpectedLvlSpec {
  readonly startAt?: number;
  readonly nfc: number;
  readonly restart?: number; // sets the flags byte's bit 3 and ilvlRestartLim together
  readonly rgbxchNums?: readonly number[]; // one-based positions, unpadded; padded to 9 with 0
  readonly xstCodeUnits: readonly number[];
}

/** One LVL ([MS-DOC] 2.9.196) exactly as buildLvlBytes must emit it: a 28-byte LVLF with every field buildLvlBytes itself never sets (ixchFollow, dxaIndentSav, unused2, cbGrpprlChpx, cbGrpprlPapx, grfhic) left at 0 -- deliberately NOT numbering.test.ts's own reader-fixture convention of stating ixchFollow as a nonzero 0x02 to prove the reader ignores it, since this file pins what the WRITER actually produces, not what a lenient reader would tolerate -- followed immediately by its own Xst. */
function expectedLvl(spec: ExpectedLvlSpec): number[] {
  const rgbxchNumsPadded = [...(spec.rgbxchNums ?? [])];
  while (rgbxchNumsPadded.length < 9) {
    rgbxchNumsPadded.push(0);
  }
  const flags = spec.restart !== undefined ? 0x08 : 0x00;
  const lvlf = [
    ...u32(spec.startAt ?? 1),
    spec.nfc,
    flags,
    ...rgbxchNumsPadded,
    0x00, // ixchFollow
    ...u32(0), // dxaIndentSav
    ...u32(0), // unused2
    0x00, // cbGrpprlChpx
    0x00, // cbGrpprlPapx
    spec.restart ?? 0, // ilvlRestartLim
    0x00, // grfhic
  ];
  return [...lvlf, ...expectedXst(spec.xstCodeUnits)];
}

describe("buildNumberingTables: LSTF", () => {
  it("writes rgistdPara as nine 0x0FFF entries, never zero", () => {
    // [MS-DOC] 2.9.191's own MUST: 0x0000 is not an available "unset" spelling for rgistdPara -- it names a real style (ISTD 0, "Normal") -- so a zeroed entry states a link this writer never intended, even though this package's own reader ignores the field either way.
    const definitions: NumberingDefinitions = {
      "1": { levels: { "0": { format: "bullet", text: "•", startAt: 1 } } },
    };
    const tables = buildNumberingTables(definitions);
    if (tables === undefined) throw new Error("expected numbering tables");
    const rgistdParaBytes = tables.plfLst.slice(2 + 8, 2 + 8 + 18);
    for (let index = 0; index < 9; index += 1) {
      expect(rgistdParaBytes[index * 2]).toBe(0xff);
      expect(rgistdParaBytes[index * 2 + 1]).toBe(0x0f);
    }
  });

  it("writes a whole simple-list PlfLst/PlfLfo byte for byte", () => {
    const definitions: NumberingDefinitions = {
      "1": { levels: { "0": { format: "bullet", text: "•", startAt: 1 } } },
    };
    const tables = buildNumberingTables(definitions);
    if (tables === undefined) throw new Error("expected numbering tables");

    const expectedLstfBytes = expectedLstf(1, true);
    const expectedLvlBytes = expectedLvl({
      nfc: 0x17, // msonfcBullet
      xstCodeUnits: ["•".charCodeAt(0)],
    });
    expect([...tables.plfLst]).toEqual([
      ...u16(1), // cLst
      ...expectedLstfBytes,
      ...expectedLvlBytes,
    ]);
    expect(tables.lcbPlfLst).toBe(2 + expectedLstfBytes.length);
    expect([...tables.plfLfo]).toEqual([
      ...u32(1), // lfoMac
      ...u32(1), // rgLfo[0].lsid, matching this list's own ilfo/lsid
      ...new Array<number>(12).fill(0), // unused1(4) + unused2(4) + clfolvl/ibstFltAutoNum/grfhic/unused3 (1 each)
      ...u32(0xffffffff), // rgLfoData[0].cp -- undefined/MUST-be-ignored per [MS-DOC] 2.9.149, 0xFFFFFFFF matching the spec's own worked example; no rgLfoLvl entries follow since clfolvl above is 0.
    ]);
  });

  it("writes one LFOData entry per LFO, parallel to rgLfo -- [MS-DOC] 2.9.225's own required shape, not merely a reader convenience", () => {
    // Confirms lcbPlfLfo (derived from plfLfo.length by write.ts) covers the appended rgLfoData too, not just rgLfo -- omitting it would leave fcPlfLfo+lcbPlfLfo landing exactly at rgLfo's own end, with nothing left for a real consumer's own list-formatting algorithm to read past it.
    const definitions: NumberingDefinitions = {
      "1": { levels: { "0": { format: "bullet", text: "•", startAt: 1 } } },
      "2": { levels: { "0": { format: "decimal", text: "%1.", startAt: 1 } } },
    };
    const tables = buildNumberingTables(definitions);
    if (tables === undefined) throw new Error("expected numbering tables");
    const lfoMacBytes = 4;
    const rgLfoBytes = 16 * 2;
    expect(tables.plfLfo.length).toBe(lfoMacBytes + rgLfoBytes + 4 * 2);
    const rgLfoDataOffset = lfoMacBytes + rgLfoBytes;
    expect([...tables.plfLfo.slice(rgLfoDataOffset)]).toEqual([
      ...u32(0xffffffff), // rgLfoData[0].cp
      ...u32(0xffffffff), // rgLfoData[1].cp
    ]);
  });
});

describe("buildNumberingTables: LVLF flags byte", () => {
  it("sets bit 3 (0x08) for fNoRestart, not bit 1 (0x02) -- 0x02 is jc's own bit, never decoded", () => {
    // A dense multi-level list, since ilvlRestartLim's own [MS-DOC] 2.9.148 constraint -- it MUST be <= the level's own zero-based index -- means level 0 alone could only ever restart at 0; level 2's own restart:2 needs two shallower filler levels to exist first.
    const levels: Record<string, NumberingLevel> = {};
    for (let level = 0; level < 9; level += 1) {
      levels[String(level)] = { format: "bullet", text: "•", startAt: 1 };
    }
    levels["2"] = { format: "bullet", text: "•", startAt: 1, restart: 2 };
    const definitions: NumberingDefinitions = { "1": { levels } };
    const tables = buildNumberingTables(definitions);
    if (tables === undefined) throw new Error("expected numbering tables");
    const bulletLevelBytes = expectedLvl({
      nfc: 0x17, // msonfcBullet
      xstCodeUnits: ["•".charCodeAt(0)],
    }).length;
    const lvlfOffset = 2 + 28 + bulletLevelBytes * 2; // past cLst + the one LSTF + levels 0 and 1
    const flagsByte = tables.plfLst[lvlfOffset + 5];
    expect(flagsByte).toBe(0x08);
    expect(tables.plfLst[lvlfOffset + 26]).toBe(2); // ilvlRestartLim
  });

  it("leaves the flags byte at 0 when the level names no restart", () => {
    const definitions: NumberingDefinitions = {
      "1": { levels: { "0": { format: "decimal", text: "%1.", startAt: 1 } } },
    };
    const tables = buildNumberingTables(definitions);
    if (tables === undefined) throw new Error("expected numbering tables");
    const lvlfOffset = 2 + 28;
    expect(tables.plfLst[lvlfOffset + 5]).toBe(0x00);
  });
});

describe("buildNumberingTables: level text and format", () => {
  it("encodes a level's own custom numbering text verbatim, not a synthesized '%1.' default", () => {
    const definitions: NumberingDefinitions = {
      "1": {
        levels: { "0": { format: "decimal", text: "%1)", startAt: 1 } },
      },
    };
    const tables = buildNumberingTables(definitions);
    if (tables === undefined) throw new Error("expected numbering tables");
    const expectedLvlBytes = expectedLvl({
      nfc: 0x00,
      rgbxchNums: [1],
      xstCodeUnits: [0, ")".charCodeAt(0)], // placeholder for level 0 (raw code unit 0), then a literal ')'
    });
    expect([...tables.plfLst.slice(2 + 28)]).toEqual(expectedLvlBytes);
  });

  it("encodes a multi-placeholder custom text (ancestor-level numbering) across several rgbxchNums entries", () => {
    // Level 1 (one-based index 2) is the shallowest level [MS-DOC] 2.9.148 permits two placeholders on -- level 0 permits only one (see the "refuses..." test below), so this level's own two-placeholder text lives on level 1, filled out to the required dense nine-level shape.
    const levels: Record<string, NumberingLevel> = {};
    for (let level = 0; level < 9; level += 1) {
      levels[String(level)] = { format: "bullet", text: "•", startAt: 1 };
    }
    levels["1"] = { format: "upperRoman", text: "%1.%2)", startAt: 1 };
    const definitions: NumberingDefinitions = { "1": { levels } };
    const tables = buildNumberingTables(definitions);
    if (tables === undefined) throw new Error("expected numbering tables");
    const level0Bytes = expectedLvl({
      nfc: 0x17, // msonfcBullet
      xstCodeUnits: ["•".charCodeAt(0)],
    });
    const expectedLvlBytes = expectedLvl({
      nfc: 0x01, // msonfcUpperRoman
      rgbxchNums: [1, 3],
      xstCodeUnits: [0, ".".charCodeAt(0), 1, ")".charCodeAt(0)],
    });
    const offset = 2 + 28 + level0Bytes.length;
    expect([
      ...tables.plfLst.slice(offset, offset + expectedLvlBytes.length),
    ]).toEqual(expectedLvlBytes);
  });

  it("refuses a level whose own text names more placeholders than rgbxchNums' fixed nine-entry array can hold", () => {
    const text = Array.from(
      { length: 10 },
      (_unused, index) => `%${index + 1}`,
    ).join("");
    const definitions: NumberingDefinitions = {
      "1": { levels: { "0": { format: "decimal", text, startAt: 1 } } },
    };
    expect(() => buildNumberingTables(definitions)).toThrow(
      /names 10 placeholders/,
    );
    expect(() => buildNumberingTables(definitions)).toThrow(DocFormatError);
  });

  it("refuses a level naming more placeholders than [MS-DOC] 2.9.148 permits for its own zero-based level, even within rgbxchNums' own nine-entry array", () => {
    // Level 0 (one-based index 1) permits at most one placeholder -- two, while still well inside the fixed nine-entry array, exceeds the tighter per-level bound this specific level actually has.
    const definitions: NumberingDefinitions = {
      "1": {
        levels: { "0": { format: "decimal", text: "%1.%2)", startAt: 1 } },
      },
    };
    expect(() => buildNumberingTables(definitions)).toThrow(
      /at level 0 names 2 placeholders/,
    );
    expect(() => buildNumberingTables(definitions)).toThrow(/limit of 1/);
    expect(() => buildNumberingTables(definitions)).toThrow(DocFormatError);
  });

  it("encodes format 'none' as nfc 0xFF, the sentinel numbering.ts's own reader special-cases before consulting MSONFC at all", () => {
    const definitions: NumberingDefinitions = {
      "1": { levels: { "0": { format: "none", text: "", startAt: 1 } } },
    };
    const tables = buildNumberingTables(definitions);
    if (tables === undefined) throw new Error("expected numbering tables");
    const lvlfOffset = 2 + 28;
    expect(tables.plfLst[lvlfOffset + 4]).toBe(0xff);
  });

  it("names ContentListMembership's own six real format values in its refusal message, not NFC_BY_FORMAT's full internal MSONFC key list", () => {
    const definitions: NumberingDefinitions = {
      "1": {
        levels: { "0": { format: "not-a-real-format", text: "x", startAt: 1 } },
      },
    };
    expect(() => buildNumberingTables(definitions)).toThrow(
      /"bullet","decimal","lowerLetter","upperLetter","lowerRoman","upperRoman"/,
    );
    // The old message enumerated every one of NFC_BY_FORMAT's ~59 internal MSONFC-derived keys; a format this writer never emits by hand (e.g. a MSONFC string ContentListMembership.format can't even carry) must not appear.
    expect(() => buildNumberingTables(definitions)).not.toThrow(/hebrew/);
  });

  it("refuses a placeholder position beyond rgbxchNums' own 8-bit range, rather than silently truncating it mod 256", () => {
    const text = `${"a".repeat(255)}%1.`; // the placeholder's own one-based position lands at 256.
    const definitions: NumberingDefinitions = {
      "1": { levels: { "0": { format: "decimal", text, startAt: 1 } } },
    };
    expect(() => buildNumberingTables(definitions)).toThrow(
      /character position 256/,
    );
    expect(() => buildNumberingTables(definitions)).toThrow(DocFormatError);
  });
});

describe("buildNumberingTables: iStartAt and ilvlRestartLim range validation", () => {
  it("refuses a negative iStartAt", () => {
    const definitions: NumberingDefinitions = {
      "1": { levels: { "0": { format: "decimal", text: "%1.", startAt: -1 } } },
    };
    expect(() => buildNumberingTables(definitions)).toThrow(/startAt -1/);
    expect(() => buildNumberingTables(definitions)).toThrow(DocFormatError);
  });

  it("refuses an iStartAt beyond [MS-DOC] 2.9.148's own 0x7FFF ceiling", () => {
    const definitions: NumberingDefinitions = {
      "1": {
        levels: { "0": { format: "decimal", text: "%1.", startAt: 0x8000 } },
      },
    };
    expect(() => buildNumberingTables(definitions)).toThrow(/startAt 32768/);
    expect(() => buildNumberingTables(definitions)).toThrow(DocFormatError);
  });

  it("refuses an ilvlRestartLim greater than the level's own zero-based index", () => {
    // Level 0's own maximum valid restart is 0 -- restart:1 names a level deeper than the LVL that carries it, which [MS-DOC] 2.9.148 never permits.
    const definitions: NumberingDefinitions = {
      "1": {
        levels: {
          "0": { format: "decimal", text: "%1.", startAt: 1, restart: 1 },
        },
      },
    };
    expect(() => buildNumberingTables(definitions)).toThrow(
      /restart value 1 is outside the 0\.\.0 range/,
    );
    expect(() => buildNumberingTables(definitions)).toThrow(DocFormatError);
  });
});

describe("gatherListUsage feeding buildNumberingTables", () => {
  it("produces bytes identical to a hand-built NumberingDefinitions for the same paragraph usage", () => {
    const usage = gatherListUsage([
      { numId: "7", level: 0, format: "lowerLetter" },
    ]);
    expect(usage.ilfoByNumId.get("7")).toBe(1);
    const tables = buildNumberingTables(usage.definitions);
    if (tables === undefined) throw new Error("expected numbering tables");
    const expectedLvlBytes = expectedLvl({
      nfc: 0x04, // msonfcLowerLetter
      rgbxchNums: [1],
      xstCodeUnits: [0, ".".charCodeAt(0)],
    });
    expect([...tables.plfLst.slice(2 + 28)]).toEqual(expectedLvlBytes);
  });

  it("returns undefined -- no PlfLst/PlfLfo at all -- for a document with no list membership", () => {
    expect(buildNumberingTables({})).toBeUndefined();
    expect(gatherListUsage([undefined, undefined]).definitions).toEqual({});
  });
});
