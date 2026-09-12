import { describe, expect, it } from "vitest";
import {
  AlignmentSchema,
  DEFAULT_LAYOUT_FONT,
  LayoutFontSchema,
  TextDirectionSchema,
} from "./style";

describe("AlignmentSchema", () => {
  it("accepts every alignment keyword", () => {
    for (const value of ["left", "center", "right", "justify"]) {
      expect(AlignmentSchema.safeParse(value).success).toBe(true);
    }
  });

  it("rejects a keyword outside the closed vocabulary", () => {
    expect(AlignmentSchema.safeParse("middle").success).toBe(false);
  });
});

describe("TextDirectionSchema", () => {
  it("accepts ltr and rtl", () => {
    expect(TextDirectionSchema.safeParse("ltr").success).toBe(true);
    expect(TextDirectionSchema.safeParse("rtl").success).toBe(true);
  });

  it("rejects a value outside the two-member vocabulary", () => {
    expect(TextDirectionSchema.safeParse("ttb").success).toBe(false);
  });
});

describe("LayoutFontSchema", () => {
  it("accepts the normal/bold weight pair and rejects a third weight", () => {
    const base = { family: "Arial", weight: "normal", style: "normal" };
    expect(
      LayoutFontSchema.safeParse({ ...base, weight: "normal" }).success,
    ).toBe(true);
    expect(
      LayoutFontSchema.safeParse({ ...base, weight: "bold" }).success,
    ).toBe(true);
    expect(
      LayoutFontSchema.safeParse({ ...base, weight: "heavy" }).success,
    ).toBe(false);
  });

  it("accepts the normal/italic style pair and rejects a third style", () => {
    const base = { family: "Arial", weight: "normal", style: "normal" };
    expect(
      LayoutFontSchema.safeParse({ ...base, style: "normal" }).success,
    ).toBe(true);
    expect(
      LayoutFontSchema.safeParse({ ...base, style: "italic" }).success,
    ).toBe(true);
    expect(
      LayoutFontSchema.safeParse({ ...base, style: "oblique" }).success,
    ).toBe(false);
  });

  it("requires a string family", () => {
    expect(
      LayoutFontSchema.safeParse({
        family: "Times",
        weight: "normal",
        style: "normal",
      }).success,
    ).toBe(true);
    expect(
      LayoutFontSchema.safeParse({
        family: 7,
        weight: "normal",
        style: "normal",
      }).success,
    ).toBe(false);
  });
});

describe("DEFAULT_LAYOUT_FONT", () => {
  it("is exactly Helvetica, normal weight, normal style", () => {
    expect(DEFAULT_LAYOUT_FONT).toStrictEqual({
      family: "Helvetica",
      weight: "normal",
      style: "normal",
    });
  });

  it("validates against LayoutFontSchema itself", () => {
    expect(LayoutFontSchema.safeParse(DEFAULT_LAYOUT_FONT).success).toBe(true);
  });
});
