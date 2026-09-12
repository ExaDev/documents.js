import { describe, expect, it } from "vitest";
import { childRecords, findChild, readRecordAt } from "../record/tree";
import { RT_Environment, RT_FontCollection } from "../record/types";
import { readFontNames } from "./fonts";
import { writeEnvironment } from "./fonts-write";

describe("writeEnvironment", () => {
  it("writes no Environment at all for an empty font collection", () => {
    expect(writeEnvironment([])).toBeUndefined();
  });

  it("round-trips one or more font names through readFontNames", () => {
    const bytes = writeEnvironment(["Arial", "Calibri"]);
    if (bytes === undefined) {
      throw new Error("expected a written Environment");
    }
    expect(readFontNames(readRecordAt(bytes, 0))).toEqual(["Arial", "Calibri"]);
  });

  it("truncates a face name past the 64-byte field's own 31-character capacity, rather than overrunning it", () => {
    const longName = "A".repeat(40);
    const bytes = writeEnvironment([longName]);
    if (bytes === undefined) {
      throw new Error("expected a written Environment");
    }
    expect(readFontNames(readRecordAt(bytes, 0))).toEqual(["A".repeat(31)]);
  });

  it("stamps the real RT_Environment/RT_FontCollection record types", () => {
    const bytes = writeEnvironment(["Arial"]);
    if (bytes === undefined) {
      throw new Error("expected a written Environment");
    }
    const record = readRecordAt(bytes, 0);
    expect(record.header.recType).toBe(RT_Environment);
    expect(childRecords(record)).toHaveLength(1);
    expect(findChild(childRecords(record), RT_FontCollection)).toBeDefined();
  });
});
