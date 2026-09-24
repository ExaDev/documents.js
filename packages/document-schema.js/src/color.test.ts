import { describe, expect, it } from "vitest";
import {
  COLOR_BLACK,
  ColorSchema,
  colorToRgbHex,
  rgbHexToColor,
} from "./color";

// Mirrors color.ts's own (private) HEX_BYTE_MAX: the divisor/multiplier between a 0..1 colour component and its 0..255 hex byte.
const HEX_BYTE_MAX = 255;
// The 0x80 byte "#ff0080"'s own green-then-blue digit pair decodes to, used across several fixtures below.
const MID_BYTE_HEX = 0x80;

describe("ColorSchema", () => {
  it("accepts a colour whose components are within 0..1", () => {
    expect(ColorSchema.safeParse({ r: 0, g: 0.5, b: 1 }).success).toBe(true);
  });

  it("rejects a component below 0 or above 1", () => {
    expect(ColorSchema.safeParse({ r: -0.01, g: 0, b: 0 }).success).toBe(false);
    expect(ColorSchema.safeParse({ r: 1.01, g: 0, b: 0 }).success).toBe(false);
  });
});

describe("COLOR_BLACK", () => {
  it("is exactly r=0, g=0, b=0", () => {
    expect(COLOR_BLACK).toStrictEqual({ r: 0, g: 0, b: 0 });
  });
});

describe("rgbHexToColor", () => {
  it("parses a 6-digit hex colour with a leading '#'", () => {
    expect(rgbHexToColor("#ff0080")).toStrictEqual({
      r: 1,
      g: 0,
      b: MID_BYTE_HEX / HEX_BYTE_MAX,
    });
  });

  it("parses a 6-digit hex colour with no leading '#'", () => {
    expect(rgbHexToColor("ff0080")).toStrictEqual({
      r: 1,
      g: 0,
      b: MID_BYTE_HEX / HEX_BYTE_MAX,
    });
  });

  it("is case-insensitive", () => {
    expect(rgbHexToColor("FF0080")).toStrictEqual(rgbHexToColor("ff0080"));
  });

  it("reads each byte from its own two-digit slice, not the whole 6-digit string", () => {
    // A value that would produce a completely different result if slice(0,2)/(2,4)/(4,6) collapsed to parsing the whole "digits" string for every channel.
    const blueByteHex = 0x03;
    const color = rgbHexToColor("010203");
    expect(color.r).toBe(0x01 / HEX_BYTE_MAX);
    expect(color.g).toBe(0x02 / HEX_BYTE_MAX);
    expect(color.b).toBe(blueByteHex / HEX_BYTE_MAX);
  });

  it("divides each byte by 255, not multiplies", () => {
    expect(rgbHexToColor("ffffff")).toStrictEqual({ r: 1, g: 1, b: 1 });
    expect(rgbHexToColor("000000")).toStrictEqual({ r: 0, g: 0, b: 0 });
  });

  it("throws with the offending value named, on a string too short to be 6 hex digits", () => {
    expect(() => rgbHexToColor("#fff")).toThrow(
      "not a 6-digit hex colour: #fff",
    );
  });

  it("throws on a string too long to be 6 hex digits", () => {
    expect(() => rgbHexToColor("#ff00801")).toThrow(
      "not a 6-digit hex colour: #ff00801",
    );
  });

  it("throws on non-hex characters", () => {
    expect(() => rgbHexToColor("#gggggg")).toThrow(
      "not a 6-digit hex colour: #gggggg",
    );
  });

  it("throws on a bare '#' with no digits at all", () => {
    expect(() => rgbHexToColor("#")).toThrow("not a 6-digit hex colour: #");
  });
});

describe("colorToRgbHex", () => {
  it("is the exact inverse of rgbHexToColor for a value that divides evenly", () => {
    expect(colorToRgbHex({ r: 1, g: 0, b: MID_BYTE_HEX / HEX_BYTE_MAX })).toBe(
      "ff0080",
    );
  });

  it("round-trips through rgbHexToColor for black and white", () => {
    expect(colorToRgbHex(rgbHexToColor("000000"))).toBe("000000");
    expect(colorToRgbHex(rgbHexToColor("ffffff"))).toBe("ffffff");
  });

  it("multiplies each component by 255 before rounding, not divides", () => {
    expect(colorToRgbHex({ r: 1, g: 1, b: 1 })).toBe("ffffff");
  });

  it("zero-pads a byte that hex-encodes to a single digit", () => {
    // 1/255 * 255 = 1, which toString(16) renders as the single character "1" — this only reads "01" back out if padStart actually pads with a leading zero.
    expect(colorToRgbHex({ r: 1 / HEX_BYTE_MAX, g: 0, b: 0 })).toBe("010000");
  });

  it("produces a lowercase 6-digit string with no leading '#'", () => {
    const hex = colorToRgbHex({ r: 1, g: 0, b: 0 });
    expect(hex).toBe("ff0000");
    expect(hex).not.toContain("#");
    expect(hex).toBe(hex.toLowerCase());
  });
});
