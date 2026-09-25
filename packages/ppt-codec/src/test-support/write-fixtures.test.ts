import { describe, expect, it } from "vitest";
import { writeAtom } from "../record/write";
import { readRecordAt } from "../record/tree";
import { RT_SlideListWithText } from "../record/types";
import { requireRecord } from "./write-fixtures";

const NO_BYTES = new Uint8Array(new ArrayBuffer(0));

describe("requireRecord", () => {
  it("names what was missing when the lookup found nothing", () => {
    expect(() => requireRecord(undefined, "slide list")).toThrow(
      "the writer produced no slide list",
    );
  });

  it("returns the record itself when the lookup succeeded", () => {
    const record = readRecordAt(writeAtom(RT_SlideListWithText, NO_BYTES), 0);
    expect(requireRecord(record, "slide list")).toBe(record);
  });
});
