import { describe, expect, it } from "vitest";
import type { ContentListMembership } from "document-schema.js";
import { readInt32LE, readUint16LE, readUint32LE } from "../bytes";
import { DocFormatError } from "../errors";
import type { NumberingDefinitions } from "./numbering";
import { buildNumberingTables, gatherListUsage } from "./numbering-write";

const SIMPLE_LEVEL = { format: "decimal", text: "%1.", startAt: 1 } as const;

describe("gatherListUsage", () => {
  it("skips a paragraph with no list membership at all", () => {
    const usage = gatherListUsage([undefined]);
    expect(usage.ilfoByNumId.size).toBe(0);
    expect(usage.definitions).toEqual({});
  });

  it("mints ilfos in first-occurrence order, one per distinct numId", () => {
    const usage = gatherListUsage([
      { numId: "b", level: 0, format: "decimal" },
      { numId: "a", level: 0, format: "decimal" },
      { numId: "b", level: 0, format: "decimal" },
    ]);
    expect(usage.ilfoByNumId.get("b")).toBe(1);
    expect(usage.ilfoByNumId.get("a")).toBe(2);
  });

  it("throws when a paragraph names a level past the fixed nine-level range", () => {
    const memberships: ContentListMembership[] = [
      { numId: "1", level: 9, format: "decimal" },
    ];
    expect(() => gatherListUsage(memberships)).toThrow(DocFormatError);
    expect(() => gatherListUsage(memberships)).toThrow(/level 9/);
  });

  it("accepts level 8, the top of the fixed nine-level range", () => {
    const memberships: ContentListMembership[] = [
      { numId: "1", level: 8, format: "decimal" },
    ];
    expect(() => gatherListUsage(memberships)).not.toThrow();
  });

  it("defaults an unstated format to 'decimal'", () => {
    const usage = gatherListUsage([{ numId: "1", level: 0 }]);
    expect(usage.definitions["1"]?.levels["0"]?.format).toBe("decimal");
  });

  it("gives a single level-0 use exactly one level, a simple list", () => {
    const usage = gatherListUsage([
      { numId: "1", level: 0, format: "decimal" },
    ]);
    expect(Object.keys(usage.definitions["1"]?.levels ?? {})).toEqual(["0"]);
  });

  it("fills every one of the nine levels once any level past 0 is used, even ones no paragraph actually used", () => {
    const usage = gatherListUsage([
      { numId: "1", level: 3, format: "decimal" },
    ]);
    const levels = usage.definitions["1"]?.levels ?? {};
    expect(
      Object.keys(levels)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    // The actually-used level keeps its own stated format; every filler level gets the default.
    expect(levels["3"]?.format).toBe("decimal");
    expect(levels["0"]?.format).toBe("decimal");
  });

  it("keeps each distinct level of the same list separately, at the format each paragraph stated for it", () => {
    const usage = gatherListUsage([
      { numId: "1", level: 0, format: "decimal" },
      { numId: "1", level: 1, format: "bullet" },
    ]);
    expect(usage.definitions["1"]?.levels["0"]?.format).toBe("decimal");
    expect(usage.definitions["1"]?.levels["1"]?.format).toBe("bullet");
  });

  it("does not re-mint a level already recorded for this list from a later paragraph naming the identical level", () => {
    const usage = gatherListUsage([
      { numId: "1", level: 0, format: "decimal" },
      { numId: "1", level: 0, format: "bullet" },
    ]);
    // First occurrence wins — the level is already present, so the second paragraph's own format is never consulted.
    expect(usage.definitions["1"]?.levels["0"]?.format).toBe("decimal");
  });

  it("gives each level's own default text the numbered '%N.' placeholder form, one-based from its zero-based level", () => {
    const usage = gatherListUsage([
      { numId: "1", level: 3, format: "decimal" },
    ]);
    expect(usage.definitions["1"]?.levels["3"]?.text).toBe("%4.");
    expect(usage.definitions["1"]?.levels["0"]?.text).toBe("%1.");
  });

  it("gives a bullet-format level the bullet glyph as its own default text, not a numbered placeholder", () => {
    const usage = gatherListUsage([{ numId: "1", level: 0, format: "bullet" }]);
    expect(usage.definitions["1"]?.levels["0"]?.text).toBe("•");
  });
});

describe("buildNumberingTables", () => {
  it("returns undefined for an empty definitions map, so writeDocContent can skip both fc/lcb pairs", () => {
    expect(buildNumberingTables({})).toBeUndefined();
  });

  it("writes one LSTF/LFO pair per definition, each carrying the definition's own key as its lsid", () => {
    const definitions: NumberingDefinitions = {
      "1": { levels: { "0": SIMPLE_LEVEL } },
      "2": { levels: { "0": SIMPLE_LEVEL } },
    };
    const tables = buildNumberingTables(definitions);
    if (tables === undefined) {
      throw new Error("expected buildNumberingTables to return real tables");
    }
    // cLst (u16) then two 28-byte LSTFs, each starting with its own 4-byte lsid.
    expect(readUint16LE(tables.plfLst, 0)).toBe(2);
    expect(readInt32LE(tables.plfLst, 2)).toBe(1);
    expect(readInt32LE(tables.plfLst, 2 + 28)).toBe(2);
    // lfoMac (u32) then two 16-byte LFOs, each starting with its own 4-byte lsid.
    expect(readInt32LE(tables.plfLfo, 0)).toBe(2);
    expect(readInt32LE(tables.plfLfo, 4)).toBe(1);
    expect(readInt32LE(tables.plfLfo, 4 + 16)).toBe(2);
  });

  it("rejects definition keys that collide once converted to a number, even though they are distinct object keys", () => {
    // "1" and "01" are distinct string keys (Object.keys never canonicalises "01" the way it does a true integer-index key like "1"), but Number("1") === Number("01") === 1 — so both would mint the identical lsid, violating [MS-DOC] 2.9.147's "MUST be unique for each LSTF" and making numbering.ts's own lsid-matching readNumberingDefinitions unable to tell the two lists apart.
    const definitions: NumberingDefinitions = {
      "1": { levels: { "0": SIMPLE_LEVEL } },
      "01": { levels: { "0": SIMPLE_LEVEL } },
    };
    expect(() => buildNumberingTables(definitions)).toThrow(DocFormatError);
    expect(() => buildNumberingTables(definitions)).toThrow(/lsid/);
  });

  it("never mints a colliding key from gatherListUsage's own output, so the collision above is reachable only through a hand-built NumberingDefinitions", () => {
    const usage = gatherListUsage([
      { numId: "a", level: 0, format: "decimal" },
      { numId: "b", level: 0, format: "decimal" },
      { numId: "c", level: 0, format: "decimal" },
    ]);
    expect(() => buildNumberingTables(usage.definitions)).not.toThrow();
  });

  it("writes ilfos in ascending order regardless of the definitions map's own key order", () => {
    const definitions: NumberingDefinitions = {
      "5": { levels: { "0": SIMPLE_LEVEL } },
      "2": { levels: { "0": SIMPLE_LEVEL } },
    };
    const tables = buildNumberingTables(definitions);
    if (tables === undefined) {
      throw new Error("expected buildNumberingTables to return real tables");
    }
    expect(readInt32LE(tables.plfLst, 2)).toBe(2);
    expect(readInt32LE(tables.plfLst, 2 + 28)).toBe(5);
  });

  it("sorts ilfos numerically even for keys large enough that JS's own object key enumeration would not reorder them", () => {
    // Every key below is at or past 2^32 - 1, so it is not a canonical array-index key — unlike "5"/"2" above, plain-object enumeration here preserves this descending insertion order rather than auto-sorting it, so this is the one case that genuinely depends on buildNumberingTables' own explicit ilfo sort.
    const definitions: NumberingDefinitions = {
      "5000000002": { levels: { "0": SIMPLE_LEVEL } },
      "5000000001": { levels: { "0": SIMPLE_LEVEL } },
      "5000000000": { levels: { "0": SIMPLE_LEVEL } },
    };
    const tables = buildNumberingTables(definitions);
    if (tables === undefined) {
      throw new Error("expected buildNumberingTables to return real tables");
    }
    expect(readUint32LE(tables.plfLst, 2)).toBe(5000000000 >>> 0);
    expect(readUint32LE(tables.plfLst, 2 + 28)).toBe(5000000001 >>> 0);
    expect(readUint32LE(tables.plfLst, 2 + 56)).toBe(5000000002 >>> 0);
  });

  it("writes a multi-byte lsid across all four of its own bytes, not just the first", () => {
    const definitions: NumberingDefinitions = {
      "16909060": { levels: { "0": SIMPLE_LEVEL } }, // 0x01020304 — exercises every byte position writeUint32LE writes.
    };
    const tables = buildNumberingTables(definitions);
    if (tables === undefined) {
      throw new Error("expected buildNumberingTables to return real tables");
    }
    expect(readUint32LE(tables.plfLst, 2)).toBe(16909060);
    expect(readUint32LE(tables.plfLfo, 4)).toBe(16909060);
  });

  it("throws when a definition's own key is a non-canonical numeric string with no canonical counterpart", () => {
    // "01" alone (no colliding "1" key) parses to lsid 1, but String(1) is "1", not "01" — so the definitions object genuinely has no entry at the key this function looks the definition back up by.
    const definitions: NumberingDefinitions = {
      "01": { levels: { "0": SIMPLE_LEVEL } },
    };
    expect(() => buildNumberingTables(definitions)).toThrow(
      /lost a definition for an ilfo/,
    );
  });

  it("rejects a level set that is neither a lone level 0 nor a dense 0..8 run", () => {
    const definitions: NumberingDefinitions = {
      "1": { levels: { "0": SIMPLE_LEVEL, "1": SIMPLE_LEVEL } },
    };
    expect(() => buildNumberingTables(definitions)).toThrow(
      /there is no partial shape to write/,
    );
  });

  it("rejects a single-level definition whose one level is not level 0", () => {
    const definitions: NumberingDefinitions = {
      "1": { levels: { "3": SIMPLE_LEVEL } },
    };
    expect(() => buildNumberingTables(definitions)).toThrow(
      /there is no partial shape to write/,
    );
  });

  it("rejects a nine-entry level set that skips level 8 in favour of level 9, even though it still has nine entries", () => {
    const levels: Record<string, typeof SIMPLE_LEVEL> = {};
    for (const level of [0, 1, 2, 3, 4, 5, 6, 7, 9]) {
      levels[String(level)] = SIMPLE_LEVEL;
    }
    const definitions: NumberingDefinitions = { "1": { levels } };
    expect(() => buildNumberingTables(definitions)).toThrow(
      /there is no partial shape to write/,
    );
  });

  it("accepts a dense nine-level definition", () => {
    const levels: Record<string, typeof SIMPLE_LEVEL> = {};
    for (let level = 0; level < 9; level += 1) {
      levels[String(level)] = SIMPLE_LEVEL;
    }
    const definitions: NumberingDefinitions = { "1": { levels } };
    expect(() => buildNumberingTables(definitions)).not.toThrow();
  });

  it("throws when a level's own key is a non-canonical numeric string with no canonical counterpart", () => {
    // "00" alone parses to level 0, but String(0) is "0", not "00" — so the level set genuinely has no entry at the key this function looks it back up by.
    const definitions: NumberingDefinitions = {
      "1": { levels: { "00": SIMPLE_LEVEL } },
    };
    expect(() => buildNumberingTables(definitions)).toThrow(
      /lost a level its own key list just named/,
    );
  });

  it("rejects a level format with no MSONFC mapping this writer can state, naming a real format that does round-trip", () => {
    const definitions: NumberingDefinitions = {
      "1": {
        levels: {
          "0": { format: "not-a-real-format", text: "%1.", startAt: 1 },
        },
      },
    };
    expect(() => buildNumberingTables(definitions)).toThrow(
      /has no \[MS-OSHARED\] 2\.2\.1\.3 MSONFC mapping this writer can state — only .*"decimal".* round-trip/,
    );
  });

  it("writes a level's own restart rule, both the no-restart flag and the restart-limit level", () => {
    const definitions: NumberingDefinitions = {
      "1": {
        levels: {
          "0": { format: "decimal", text: "%1.", startAt: 1, restart: 3 },
        },
      },
    };
    const tables = buildNumberingTables(definitions);
    if (tables === undefined) {
      throw new Error("expected buildNumberingTables to return real tables");
    }
    const lvlOffset = 2 + 28;
    expect(tables.plfLst[lvlOffset + 5]).toBe(0x02); // LVLF_FLAG_NO_RESTART.
    expect(tables.plfLst[lvlOffset + 26]).toBe(3); // ilvlRestartLim.
  });

  it("leaves the no-restart flag and restart-limit level both zero when the level states no restart rule", () => {
    const definitions: NumberingDefinitions = {
      "1": { levels: { "0": SIMPLE_LEVEL } },
    };
    const tables = buildNumberingTables(definitions);
    if (tables === undefined) {
      throw new Error("expected buildNumberingTables to return real tables");
    }
    const lvlOffset = 2 + 28;
    expect(tables.plfLst[lvlOffset + 5]).toBe(0);
    expect(tables.plfLst[lvlOffset + 26]).toBe(0);
  });

  it("round-trips a level's own non-default startAt", () => {
    const definitions: NumberingDefinitions = {
      "1": {
        levels: { "0": { format: "decimal", text: "%1.", startAt: 5 } },
      },
    };
    const tables = buildNumberingTables(definitions);
    if (tables === undefined) {
      throw new Error("expected buildNumberingTables to return real tables");
    }
    // plfLst layout: cLst (2) + one 28-byte LSTF, then the LVL array starts. iStartAt is the LVLF's own first 4 bytes.
    const lvlOffset = 2 + 28;
    expect(readInt32LE(tables.plfLst, lvlOffset)).toBe(5);
  });

  it("writes lcbPlfLst covering cLst plus the LSTF array alone, not the appended LVL array", () => {
    const definitions: NumberingDefinitions = {
      "1": { levels: { "0": SIMPLE_LEVEL } },
    };
    const tables = buildNumberingTables(definitions);
    if (tables === undefined) {
      throw new Error("expected buildNumberingTables to return real tables");
    }
    expect(tables.lcbPlfLst).toBe(2 + 28);
    expect(tables.plfLst.length).toBeGreaterThan(tables.lcbPlfLst);
  });
});
