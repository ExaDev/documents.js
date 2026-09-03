import { describe, expect, it } from "vitest";
import { readMarginPt, readPageForm } from "./page";
import { pointsFromWpu } from "./units";

// The two page dimensions of US Letter stated in WordPerfect Units, the unit every dimension in this format uses: 8.5 inches is 10200 WPU and 11 inches is 13200, at 1200 WPU to the inch.
const LETTER_WIDTH_WPU = 10200;
const LETTER_LENGTH_WPU = 13200;
const ONE_INCH_WPU = 1200;

function word(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

// The Form function's eighty-two-byte non-deletable region, laid out exactly as WPFF D1 Page states it: <matched form hash table index> 1, [matched form hash value] 2, [desired length] 2, [desired width] 2, <type> 1, <orientation> 1, <type name length> 1, [type name] x 36.
function formNonDeletable(options: {
  readonly lengthWpu: number;
  readonly widthWpu: number;
  readonly orientation?: number;
}): Uint8Array {
  const bytes = new Uint8Array(82);
  bytes.set(word(options.lengthWpu), 3);
  bytes.set(word(options.widthWpu), 5);
  bytes[8] = options.orientation ?? 0;
  return bytes;
}

describe("pointsFromWpu", () => {
  // "WPU stands for WordPerfect Unit, which is one 1200th of an inch", and a point is one 72nd, so an inch is 1200 WPU and 72 points at once.
  it("converts an inch of WordPerfect Units to seventy-two points", () => {
    expect(pointsFromWpu(ONE_INCH_WPU)).toBe(72);
  });

  it("converts a half inch exactly", () => {
    expect(pointsFromWpu(600)).toBe(36);
  });
});

describe("readPageForm", () => {
  it("reads US Letter's own width and length out of the Form function", () => {
    const form = readPageForm(
      formNonDeletable({
        lengthWpu: LETTER_LENGTH_WPU,
        widthWpu: LETTER_WIDTH_WPU,
      }),
    );
    expect(form).toEqual({ widthPt: 612, heightPt: 792, landscape: false });
  });

  // "<orientation> 0 = portrait, 1 = landscape". The flag is reported rather than applied: the SDK states the form's own width and length as two independent fields and says nothing about whether the pair is written before or after the rotation, so rotating them here would be inference rather than the file's own statement.
  it("reports a landscape orientation without rotating the stated dimensions", () => {
    const form = readPageForm(
      formNonDeletable({
        lengthWpu: LETTER_LENGTH_WPU,
        widthWpu: LETTER_WIDTH_WPU,
        orientation: 1,
      }),
    );
    expect(form).toEqual({ widthPt: 612, heightPt: 792, landscape: true });
  });

  it("declines a form whose non-deletable data is shorter than its own field list", () => {
    expect(readPageForm(new Uint8Array(20))).toBeUndefined();
  });

  it("declines a form that states no size", () => {
    expect(
      readPageForm(formNonDeletable({ lengthWpu: 0, widthWpu: 0 })),
    ).toBeUndefined();
  });
});

describe("readMarginPt", () => {
  // All four margin functions -- the Page group's top and bottom, the Column group's left and right -- share one "[size of non-deletable information = 2]" shape, so one reader serves them all.
  it("reads a one-inch margin as seventy-two points", () => {
    expect(readMarginPt(new Uint8Array(word(ONE_INCH_WPU)))).toBe(72);
  });

  it("declines a margin function with no room for its own word", () => {
    expect(readMarginPt(new Uint8Array([0x10]))).toBeUndefined();
  });
});
