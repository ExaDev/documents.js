import { describe, expect, it } from "vitest";
import { readInt32LE, readUint16LE } from "../bytes";
import { DocFormatError } from "../errors";
import type { NumberingDefinitions } from "./numbering";
import { buildNumberingTables, gatherListUsage } from "./numbering-write";

const SIMPLE_LEVEL = { format: "decimal", text: "%1.", startAt: 1 } as const;

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
    // "1" and "01" are distinct string keys (Object.keys never canonicalises "01" the way it does a true integer-index key like "1"), but Number("1") === Number("01") === 1 -- so both would mint the identical lsid, violating [MS-DOC] 2.9.147's "MUST be unique for each LSTF" and making numbering.ts's own lsid-matching readNumberingDefinitions unable to tell the two lists apart.
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
});
