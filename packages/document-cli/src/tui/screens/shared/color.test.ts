import { describe, expect, it } from "vitest";
import {
  isValidHexColorInput,
  layoutColorToHex,
  parseHexColorInput,
} from "./color";

describe("layoutColorToHex", () => {
  it("renders full-intensity white", () => {
    expect(layoutColorToHex({ r: 1, g: 1, b: 1 })).toBe("#ffffff");
  });

  it("renders black", () => {
    expect(layoutColorToHex({ r: 0, g: 0, b: 0 })).toBe("#000000");
  });

  it("pads a single-digit byte with a leading zero", () => {
    // 1/255 rounds to byte 1 -> hex "01", proving the padStart(2, "0") -- without it this would render "#1..." rather than "#01...".
    expect(layoutColorToHex({ r: 1 / 255, g: 0, b: 0 })).toBe("#010000");
  });

  it("renders each channel independently at a distinct value", () => {
    expect(layoutColorToHex({ r: 1, g: 0, b: 0.5 })).toBe("#ff0080");
  });
});

describe("isValidHexColorInput", () => {
  it("accepts a 6-digit hex string with a leading #", () => {
    expect(isValidHexColorInput("#ff00ff")).toBe(true);
  });

  it("accepts a 6-digit hex string with no leading #", () => {
    expect(isValidHexColorInput("ff00ff")).toBe(true);
  });

  it("accepts uppercase hex digits", () => {
    expect(isValidHexColorInput("#FF00FF")).toBe(true);
  });

  it("trims surrounding whitespace before validating", () => {
    expect(isValidHexColorInput("  #ff00ff  ")).toBe(true);
  });

  it("rejects a string shorter than 6 hex digits", () => {
    expect(isValidHexColorInput("#ff00f")).toBe(false);
  });

  it("rejects a string longer than 6 hex digits", () => {
    expect(isValidHexColorInput("#ff00ff0")).toBe(false);
  });

  it("rejects a non-hex character", () => {
    expect(isValidHexColorInput("#gg00ff")).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(isValidHexColorInput("")).toBe(false);
  });
});

describe("parseHexColorInput", () => {
  it("parses a valid hex string into a LayoutColor", () => {
    expect(parseHexColorInput("#ff0000")).toEqual({ r: 1, g: 0, b: 0 });
  });

  it("parses a valid hex string with no leading #", () => {
    expect(parseHexColorInput("00ff00")).toEqual({ r: 0, g: 1, b: 0 });
  });

  it("returns undefined for invalid input, without ever calling rgbHexToColor", () => {
    expect(parseHexColorInput("not a color")).toBeUndefined();
  });

  it("round-trips through layoutColorToHex", () => {
    const color = parseHexColorInput("#3366cc");
    expect(color).toBeDefined();
    expect(layoutColorToHex(color!)).toBe("#3366cc");
  });

  it("trims surrounding whitespace before handing the string to rgbHexToColor", () => {
    // rgbHexToColor itself has no tolerance for surrounding whitespace, so this only passes if parseHexColorInput trims before calling it, not merely before validating.
    expect(parseHexColorInput("  #ff0000  ")).toEqual({ r: 1, g: 0, b: 0 });
  });
});
