import { describe, expect, it } from "vitest";
import { DocFormatError } from "../errors";
import { applyCharacterSprms } from "./chp";
import { encodeCharacterGrpprl } from "./chp-write";
import { readGrpprl } from "./sprm";

// Round-trips a written grpprl straight back through the reader's own fold, so each assertion checks the property this writer's caller actually observes rather than the raw bytes.
function roundTrip(
  run: Parameters<typeof encodeCharacterGrpprl>[0],
  fonts: readonly string[] = [],
) {
  const bytes = encodeCharacterGrpprl(run, (name) => {
    const index = fonts.indexOf(name);
    return index === -1 ? 0 : index;
  });
  return applyCharacterSprms(readGrpprl(new Uint8Array(bytes)), {}, fonts);
}

describe("encodeCharacterGrpprl", () => {
  it("returns an empty grpprl for a run with no direct formatting at all", () => {
    expect(encodeCharacterGrpprl({}, () => 0)).toEqual([]);
  });

  it("round-trips bold, italic, and strike, each independently true and false", () => {
    expect(roundTrip({ bold: true }).bold).toBe(true);
    expect(roundTrip({ bold: false }).bold).toBe(false);
    expect(roundTrip({ italic: true }).italic).toBe(true);
    expect(roundTrip({ italic: false }).italic).toBe(false);
    expect(roundTrip({ strike: true }).strike).toBe(true);
    expect(roundTrip({ strike: false }).strike).toBe(false);
  });

  it("round-trips underline, true and false", () => {
    expect(roundTrip({ underline: true }).underline).toBe(true);
    expect(roundTrip({ underline: false }).underline).toBe(false);
  });

  it("round-trips a size in points, halved to half-points and back", () => {
    expect(roundTrip({ sizePt: 12 }).sizePt).toBe(12);
  });

  it("accepts sizePt 0, the lower bound of sprmCHps's own unsigned operand", () => {
    expect(() => encodeCharacterGrpprl({ sizePt: 0 }, () => 0)).not.toThrow();
    expect(roundTrip({ sizePt: 0 }).sizePt).toBe(0);
  });

  it("accepts the largest sizePt sprmCHps's unsigned 2-byte operand can hold", () => {
    const maxPt = 0xffff / 2;
    expect(roundTrip({ sizePt: maxPt }).sizePt).toBe(maxPt);
  });

  it("rejects a negative sizePt", () => {
    expect(() => encodeCharacterGrpprl({ sizePt: -1 }, () => 0)).toThrow(
      DocFormatError,
    );
    expect(() => encodeCharacterGrpprl({ sizePt: -1 }, () => 0)).toThrow(
      /outside the 0\.\.65535 range/,
    );
  });

  it("rejects a sizePt one half-point past sprmCHps's own maximum", () => {
    const tooLarge = (0xffff + 1) / 2;
    expect(() => encodeCharacterGrpprl({ sizePt: tooLarge }, () => 0)).toThrow(
      DocFormatError,
    );
  });

  it("round-trips a colour through the exact COLORREF sprm", () => {
    const color = { r: 0x11 / 255, g: 0x22 / 255, b: 0x33 / 255 };
    expect(roundTrip({ color })).toEqual({ color });
  });

  it("round-trips a font family through the caller's own font index", () => {
    expect(
      roundTrip({ fontFamily: "Arial" }, ["Calibri", "Arial"]).fontFamily,
    ).toBe("Arial");
  });

  it("writes every stated property together, in one grpprl", () => {
    const result = roundTrip(
      {
        bold: true,
        italic: true,
        underline: true,
        strike: true,
        sizePt: 10,
        color: { r: 1, g: 0, b: 0 },
        fontFamily: "Arial",
      },
      ["Arial"],
    );
    expect(result).toEqual({
      bold: true,
      italic: true,
      underline: true,
      strike: true,
      sizePt: 10,
      color: { r: 1, g: 0, b: 0 },
      fontFamily: "Arial",
    });
  });
});
