import { describe, expect, it } from "vitest";

import {
  NORMAL_FONT_FIELDS,
  cellFontDiffersFromNormal,
  contentFontOf,
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
    expect(readBack(writeFontRecord(fields))).toStrictEqual(fields);
  });

  it("writes the Normal font's own fields verbatim", () => {
    expect(readBack(writeFontRecord(NORMAL_FONT_FIELDS))).toStrictEqual(
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

  it("accepts a height and a name length sitting exactly on dyHeight's and fontName's own boundaries, not just short of them", () => {
    // 20/8191/1/31 are the field's own documented MUSTs (>= 20/<= 8191/>= 1/<= 31), not the one-past values the sibling test throws on, so the four checks above must each be a strict boundary rather than an off-by-one — 21/8190/2/30 could not distinguish `>=`/`<=` from `>`/`<` the way exactly-on-the-edge values do.
    expect(() =>
      writeFontRecord({ ...NORMAL_FONT_FIELDS, heightTwips: 20 }),
    ).not.toThrow();
    expect(() =>
      writeFontRecord({ ...NORMAL_FONT_FIELDS, heightTwips: 8191 }),
    ).not.toThrow();
    expect(() =>
      writeFontRecord({ ...NORMAL_FONT_FIELDS, name: "A" }),
    ).not.toThrow();
    expect(() =>
      writeFontRecord({ ...NORMAL_FONT_FIELDS, name: "A".repeat(31) }),
    ).not.toThrow();
  });

  it("accepts a height of exactly 0 even though it sits outside dyHeight's own 20-8191 range", () => {
    // heightTwips 0 is the one value this check lets through despite failing the range test outright — proving the exception is real, and not merely the range check never firing, needs a height that WOULD throw under the range alone (0 is well below 20) to still pass.
    expect(() =>
      writeFontRecord({ ...NORMAL_FONT_FIELDS, heightTwips: 0 }),
    ).not.toThrow();
  });

  it("names the field, the offending value, and the allowed range in each refusal's own message", () => {
    expect(() =>
      writeFontRecord({ ...NORMAL_FONT_FIELDS, heightTwips: 19 }),
    ).toThrow(/font height 19 twips is outside the 20-8191 range/);
    expect(() => writeFontRecord({ ...NORMAL_FONT_FIELDS, name: "" })).toThrow(
      /font name "" is 0 UTF-16 code units, outside the 1-31/,
    );
  });

  it("writes exactly cch characters of the font name, not one more", () => {
    // fontNameBytes' own for loop must stop at name.length, not run one iteration past it: an off-by-one there would append a spurious extra UTF-16 unit (charCodeAt past the end reads as NaN, which the record builder's own u16 coerces to 0) two bytes long, growing the record beyond what a correctly-written one needs — invisible to a round trip through this package's own reader, which stops reading the name at cch regardless (and invisible too to a bare LENGTH DIFFERENCE between two names of different lengths, since a constant one-unit overshoot shifts both by the identical two bytes). Only the record's own absolute total length, for one fixed name, pins the real byte count down.
    const record = writeFontRecord({ ...NORMAL_FONT_FIELDS, name: "AB" });

    // 4 (record header: type + size) + 14 (Font's own fixed fields) + 2 (fontNameBytes' own cch + flags) + 2*2 (one uncompressed UTF-16 unit per character).
    expect(record.length).toBe(4 + 14 + 2 + 2 * 2);
  });
});

describe("contentFontOf", () => {
  it("states no colour when the cell's own icv is the same index the baseline font already carries, even where a real colour would resolve", () => {
    // The comparison is on the raw icv, not the colour it resolves to: two fonts sharing the SAME index state no colour of their own, regardless of whether resolveColor would happily produce one for it.
    const font: XfFontFields = {
      ...NORMAL_FONT_FIELDS,
      colorIcv: NORMAL_FONT_FIELDS.colorIcv,
    };
    const resolveColor = () => ({ r: 1, g: 0, b: 0 });

    expect(
      contentFontOf(font, NORMAL_FONT_FIELDS, resolveColor)?.color,
    ).toBeUndefined();
  });

  it("states the resolved colour when the cell's own icv genuinely differs from the baseline's", () => {
    const font: XfFontFields = {
      ...NORMAL_FONT_FIELDS,
      colorIcv: NORMAL_FONT_FIELDS.colorIcv + 1,
    };
    const resolveColor = (icv: number) =>
      icv === font.colorIcv ? { r: 0, g: 1, b: 0 } : undefined;

    expect(
      contentFontOf(font, NORMAL_FONT_FIELDS, resolveColor)?.color,
    ).toStrictEqual({
      r: 0,
      g: 1,
      b: 0,
    });
  });
});

describe("xfFontFieldsOf", () => {
  /** A palette resolution standing in for the real plan: enough to prove which properties survive, since the plan's own exact icv assignment is write.ts's concern. */
  const icvOf = (color: { readonly r: number }) => (color.r === 1 ? 10 : 12);

  it("normalises an absent, empty, or all-default font to the Normal font's own fields", () => {
    expect(xfFontFieldsOf(undefined, icvOf)).toStrictEqual(NORMAL_FONT_FIELDS);
    expect(xfFontFieldsOf({}, icvOf)).toStrictEqual(NORMAL_FONT_FIELDS);
    expect(
      xfFontFieldsOf({ bold: false, fontFamily: "Arial", sizePt: 10 }, icvOf),
    ).toStrictEqual(NORMAL_FONT_FIELDS);
  });

  it("resolves each stated property and defaults each unstated one", () => {
    expect(
      xfFontFieldsOf(
        { bold: true, fontFamily: "Courier New", sizePt: 12 },
        icvOf,
      ),
    ).toStrictEqual({
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
