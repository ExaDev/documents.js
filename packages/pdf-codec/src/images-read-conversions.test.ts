import { describe, expect, it } from "vitest";

import { cmykToRgbByte, sampleFromPalette, scaleToByte } from "./images-read";

// The byte-level conversion helpers pinned on exact outputs for representative inputs, including every boundary each one branches on. These formulas are the whole colour fidelity of the CMYK and palette read paths: a swapped operand or an inverted subtraction here shifts every pixel of every CMYK image the reader emits, so each is asserted outright rather than through an end-to-end fixture whose tolerance could absorb the error.
describe("cmykToRgbByte", () => {
  it("maps no ink to full white", () => {
    expect(cmykToRgbByte(0, 0, 0, 0)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("maps full black ink to black, on every channel", () => {
    expect(cmykToRgbByte(0, 0, 0, 1)).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("maps full cyan ink to red, leaving the other channels untouched by it", () => {
    expect(cmykToRgbByte(1, 0, 0, 0)).toEqual({ r: 0, g: 255, b: 255 });
  });

  it("maps full magenta ink to green and full yellow ink to blue, each through its own channel", () => {
    expect(cmykToRgbByte(0, 1, 0, 0)).toEqual({ r: 255, g: 0, b: 255 });
    expect(cmykToRgbByte(0, 0, 1, 0)).toEqual({ r: 255, g: 255, b: 0 });
  });

  it("halves each channel independently at half ink, with no black", () => {
    expect(cmykToRgbByte(0.5, 0.5, 0.5, 0)).toEqual({
      r: 128,
      g: 128,
      b: 128,
    });
  });

  it("applies the black plate multiplicatively to every channel, not additively", () => {
    // Half cyan at half black: (1 - 0.5) * (1 - 0.5) = 0.25 of full red.
    expect(cmykToRgbByte(0.5, 0, 0, 0.5)).toEqual({ r: 64, g: 128, b: 128 });
  });

  it("rounds rather than truncating", () => {
    // (1 - 0.3) * 255 = 178.5, which must round to 179, not floor to 178.
    expect(cmykToRgbByte(0.3, 0.3, 0.3, 0)).toEqual({
      r: 179,
      g: 179,
      b: 179,
    });
  });
});

describe("sampleFromPalette", () => {
  it("reads a gray palette entry once and fans it to all three channels", () => {
    const sample = sampleFromPalette({ kind: "gray" }, new Uint8Array([77]), 0);
    expect(sample).toEqual({ r: 77, g: 77, b: 77 });
  });

  it("reads an rgb palette entry's own three consecutive bytes", () => {
    const lookup = new Uint8Array([10, 20, 30, 40, 50, 60]);
    expect(sampleFromPalette({ kind: "rgb" }, lookup, 0)).toEqual({
      r: 10,
      g: 20,
      b: 30,
    });
    expect(sampleFromPalette({ kind: "rgb" }, lookup, 3)).toEqual({
      r: 40,
      g: 50,
      b: 60,
    });
  });

  it("converts a cmyk palette entry's own four consecutive bytes through the ink formula", () => {
    // lookup[0..3] = full cyan, no magenta, no yellow, no black -> pure red.
    const lookup = new Uint8Array([255, 0, 0, 0]);
    expect(sampleFromPalette({ kind: "cmyk" }, lookup, 0)).toEqual({
      r: 0,
      g: 255,
      b: 255,
    });
  });

  it("reads the cmyk black plate from the fourth byte of the entry, not the third", () => {
    // 128/255 is just under half ink; (1 - 128/255) * 255 = 127 after rounding.
    const lookup = new Uint8Array([0, 0, 0, 128]);
    expect(sampleFromPalette({ kind: "cmyk" }, lookup, 0)).toEqual({
      r: 127,
      g: 127,
      b: 127,
    });
  });
});

describe("scaleToByte", () => {
  it("returns a byte-ranged sample unchanged when the source maximum already is the byte maximum", () => {
    expect(scaleToByte(200, 255, false)).toBe(200);
  });

  it("scales a wider sample down by the ratio of the maxima, rounding to nearest", () => {
    // Half of a 16-bit sample range, scaled to 8 bits.
    expect(scaleToByte(32768, 65535, false)).toBe(128);
  });

  it("inverts an inverted-decoder sample about the source maximum before scaling", () => {
    // An inverted decoder reports 0 for what is really the maximum white.
    expect(scaleToByte(0, 65535, true)).toBe(255);
    expect(scaleToByte(65535, 65535, true)).toBe(0);
  });

  it("keeps the inversion in the source's own units, not the byte's", () => {
    // Inverting 128 of 255 about 255 yields 127, which needs no scaling; the same input inverted about 255 after scaling to bytes would be unchanged at 128.
    expect(scaleToByte(128, 255, true)).toBe(127);
  });
});
