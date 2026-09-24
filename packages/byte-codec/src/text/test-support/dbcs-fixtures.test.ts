import { describe, expect, it } from "vitest";
import { UndecodableTextError } from "../decode";
import type { DbcsTable } from "../dbcs-tables";
import {
  expectMalformed,
  firstDefinedPointer,
  firstGapPointer,
} from "./dbcs-fixtures";

// Direct coverage of this file's own helpers, split out from decode-dbcs.test.ts/decode-dbcs-chinese.test.ts (which only exercise them indirectly, through real decoder behaviour). expectMalformed and the firstDefinedPointer/firstGapPointer boundary search both have failure branches no real decoder call ever takes, so those branches need a test that constructs the failure directly rather than hoping a decoder test happens to trigger them.

/** A table with no astral overflow at all, built from a string of real code points and REPLACEMENT_CHARACTER (0xfffd) gap markers so a test can place a defined/undefined pointer exactly where it needs one. */
function tableFrom(codeUnits: string): DbcsTable {
  return { codeUnits, astral: new Map() };
}

describe("expectMalformed", () => {
  it("passes through when action throws UndecodableTextError with every named substring in its message", () => {
    expect(() => {
      expectMalformed(
        () => {
          throw new UndecodableTextError("malformed", "big5 lead byte 0xff");
        },
        "big5",
        "0xff",
      );
    }).not.toThrow();
  });

  it("fails when action does not throw at all", () => {
    expect(() => {
      expectMalformed(() => undefined);
    }).toThrow(/expected decodeText to throw UndecodableTextError/);
  });

  it("fails when action throws something other than UndecodableTextError, even when its message happens to match every named substring", () => {
    // The substring named here ("big5") is deliberately present in the thrown message: a mismatched substring would fail expectMalformed's own check on its own, which would prove nothing about whether the instanceof check specifically still runs.
    expect(() => {
      expectMalformed(() => {
        throw new Error("big5 lead byte 0xff");
      }, "big5");
    }).toThrow();
  });

  it("fails when the thrown message is missing a named substring", () => {
    expect(() => {
      expectMalformed(() => {
        throw new UndecodableTextError("malformed", "big5 lead byte 0xff");
      }, "gb18030");
    }).toThrow();
  });
});

describe("firstDefinedPointer", () => {
  it("skips a leading gap to return the first pointer that is actually defined", () => {
    const table = tableFrom("�A");
    expect(firstDefinedPointer(table)).toBe(1);
  });

  it("returns -1 when every pointer in the table is a gap", () => {
    const table = tableFrom("���");
    expect(firstDefinedPointer(table)).toBe(-1);
  });
});

describe("firstGapPointer", () => {
  it("skips a leading defined pointer to return the first actual gap", () => {
    const table = tableFrom("A�");
    expect(firstGapPointer(table)).toBe(1);
  });

  it("returns -1 when every pointer in the table is defined", () => {
    const table = tableFrom("ABC");
    expect(firstGapPointer(table)).toBe(-1);
  });
});
