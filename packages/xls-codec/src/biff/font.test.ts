import { describe, expect, it } from "vitest";

import {
  NORMAL_FONT_FIELDS,
  cellFontDiffersFromNormal,
  readFontRecord,
  writeFontRecord,
  xfFontFieldsOf,
  type XfFontFields,
} from "./font";
import { BiffWriteError } from "./write-errors";
import { groupRecords, type RecordGroup } from "./substreams";
import { readRecords } from "./records";

/** Runs a written Font record through the real framing and grouping passes, so a test exercises the same path a file does. */
function readBack(record: Uint8Array<ArrayBuffer>): XfFontFields {
  const groups: readonly RecordGroup[] = groupRecords(readRecords(record));
  const first = groups[0];
  if (first === undefined) {
    throw new Error("written Font record produced no record group");
  }
  return readFontRecord(first);
}

describe("writeFontRecord", () => {
  it("round-trips every field through this package's own reader", () => {
    const fields: XfFontFields = {
      name: "Courier New",
      heightTwips: 240,
      bold: true,
      italic: true,
      strikeout: true,
      underline: true,
      colorIcv: 10,
    };
    expect(readBack(writeFontRecord(fields))).toEqual(fields);
  });

  it("writes the Normal font's own fields verbatim", () => {
    expect(readBack(writeFontRecord(NORMAL_FONT_FIELDS))).toEqual(
      NORMAL_FONT_FIELDS,
    );
  });

  it("always writes fHighByte=1 for the font name, per [MS-XLS] 2.4.122's own unconditional requirement", () => {
    // The name field starts after the record's 14-byte fixed prefix, so its flags byte sits at offset 15 (14 + cch's own byte).
    const [parsed] = readRecords(writeFontRecord(NORMAL_FONT_FIELDS));
    expect(parsed?.data[15]).toBe(0x01);
  });

  it("refuses a height outside dyHeight's own 20-8191 range and a name outside fontName's own 1-31 characters", () => {
    expect(() =>
      writeFontRecord({ ...NORMAL_FONT_FIELDS, heightTwips: 19 }),
    ).toThrow(BiffWriteError);
    expect(() =>
      writeFontRecord({ ...NORMAL_FONT_FIELDS, heightTwips: 8192 }),
    ).toThrow(BiffWriteError);
    expect(() => writeFontRecord({ ...NORMAL_FONT_FIELDS, name: "" })).toThrow(
      BiffWriteError,
    );
    expect(() =>
      writeFontRecord({
        ...NORMAL_FONT_FIELDS,
        name: "A".repeat(32),
      }),
    ).toThrow(BiffWriteError);
  });
});

describe("xfFontFieldsOf", () => {
  /** A palette resolution standing in for the real plan: enough to prove which properties survive, since the plan's own exact icv assignment is write.ts's concern. */
  const icvOf = (color: { readonly r: number }) => (color.r === 1 ? 10 : 12);

  it("normalises an absent, empty, or all-default font to the Normal font's own fields", () => {
    expect(xfFontFieldsOf(undefined, icvOf)).toEqual(NORMAL_FONT_FIELDS);
    expect(xfFontFieldsOf({}, icvOf)).toEqual(NORMAL_FONT_FIELDS);
    expect(
      xfFontFieldsOf({ bold: false, fontFamily: "Arial", sizePt: 10 }, icvOf),
    ).toEqual(NORMAL_FONT_FIELDS);
  });

  it("resolves each stated property and defaults each unstated one", () => {
    expect(
      xfFontFieldsOf(
        { bold: true, fontFamily: "Courier New", sizePt: 12 },
        icvOf,
      ),
    ).toEqual({
      ...NORMAL_FONT_FIELDS,
      bold: true,
      name: "Courier New",
      heightTwips: 240,
    });
  });
});

describe("cellFontDiffersFromNormal", () => {
  it("answers false for a font that merely restates the Normal font's own values", () => {
    expect(cellFontDiffersFromNormal({})).toBe(false);
    expect(cellFontDiffersFromNormal({ bold: false })).toBe(false);
    expect(cellFontDiffersFromNormal({ fontFamily: "Arial" })).toBe(false);
    expect(cellFontDiffersFromNormal({ sizePt: 10 })).toBe(false);
  });

  it("answers true for each property that genuinely differs", () => {
    expect(cellFontDiffersFromNormal({ bold: true })).toBe(true);
    expect(cellFontDiffersFromNormal({ italic: true })).toBe(true);
    expect(cellFontDiffersFromNormal({ underline: true })).toBe(true);
    expect(cellFontDiffersFromNormal({ strike: true })).toBe(true);
    expect(cellFontDiffersFromNormal({ fontFamily: "Courier New" })).toBe(true);
    expect(cellFontDiffersFromNormal({ sizePt: 12 })).toBe(true);
    expect(cellFontDiffersFromNormal({ color: { r: 1, g: 0, b: 0 } })).toBe(
      true,
    );
  });
});
