import { describe, expect, it } from "vitest";
import { DocFormatError } from "./errors";
import {
  autoColorRefBytes,
  colorRefBytes,
  decorativeIcoColor,
  icoColor,
  nearestIco,
  readColorRef,
} from "./color";

describe("icoColor", () => {
  it("resolves 0x00 (fAuto) to undefined -- no concrete colour", () => {
    expect(icoColor(0x00)).toBeUndefined();
  });

  it("resolves a real palette entry to its exact RGB", () => {
    expect(icoColor(0x02)).toEqual({ r: 0, g: 0, b: 1 }); // blue
  });

  it("resolves the last real entry (0x10) without throwing", () => {
    expect(icoColor(0x10)).toEqual({
      r: 192 / 255,
      g: 192 / 255,
      b: 192 / 255,
    });
  });

  it("throws for the first value past the palette's own 0x11 bound", () => {
    expect(() => icoColor(0x11)).toThrow(DocFormatError);
    expect(() => icoColor(0x11)).toThrow(/0x11/);
  });
});

describe("decorativeIcoColor", () => {
  it("delegates to icoColor for an in-range value", () => {
    expect(decorativeIcoColor(0x02)).toEqual(icoColor(0x02));
  });

  it("resolves an out-of-range value to undefined rather than throwing", () => {
    expect(decorativeIcoColor(0x11)).toBeUndefined();
    expect(decorativeIcoColor(0xff)).toBeUndefined();
  });
});

describe("nearestIco", () => {
  it("finds an exact palette match", () => {
    expect(nearestIco({ r: 0, g: 1, b: 0 })).toBe(0x04); // green
  });

  it("distinguishes colours that differ only in their blue channel", () => {
    // 0x02 is pure blue (0,0,255); 0x01 is black (0,0,0). A colour of pure, saturated blue must resolve to 0x02, not 0x01, which only the blue-channel term in the squared-distance sum can decide.
    expect(nearestIco({ r: 0, g: 0, b: 1 })).toBe(0x02);
    expect(nearestIco({ r: 0, g: 0, b: 0 })).toBe(0x01);
  });

  it("breaks a tie between the published palette's own duplicate entries (0x0C and 0x0D) in favour of the lower index", () => {
    expect(nearestIco({ r: 0x80 / 255, g: 0, b: 0x80 / 255 })).toBe(0x0c);
  });

  it("never returns 0x00 (fAuto), even for a colour nearest to black", () => {
    expect(nearestIco({ r: 0, g: 0, b: 0 })).toBe(0x01);
  });

  it("picks the closer of two candidates rather than the first or last examined", () => {
    // Slightly nearer to white (0x08) than to silver (0x10).
    expect(nearestIco({ r: 0.99, g: 0.99, b: 0.99 })).toBe(0x08);
  });
});

describe("readColorRef", () => {
  it("reads a concrete COLORREF", () => {
    const bytes = new Uint8Array([0x11, 0x22, 0x33, 0x00]);
    expect(readColorRef(bytes, 0)).toEqual({
      r: 0x11 / 255,
      g: 0x22 / 255,
      b: 0x33 / 255,
    });
  });

  it("resolves cvAuto (fAuto set) to undefined regardless of its RGB bytes", () => {
    const bytes = new Uint8Array([0xaa, 0xbb, 0xcc, 0xff]);
    expect(readColorRef(bytes, 0)).toBeUndefined();
  });

  it("reads at a non-zero offset", () => {
    const bytes = new Uint8Array([0, 0, 0, 0, 0x10, 0x20, 0x30, 0x00]);
    expect(readColorRef(bytes, 4)).toEqual({
      r: 0x10 / 255,
      g: 0x20 / 255,
      b: 0x30 / 255,
    });
  });
});

describe("colorRefBytes", () => {
  it("writes red, green, blue, then a zero fAuto", () => {
    expect(
      colorRefBytes({ r: 0x11 / 255, g: 0x22 / 255, b: 0x33 / 255 }),
    ).toEqual([0x11, 0x22, 0x33, 0x00]);
  });

  it("rounds each component to the nearest byte", () => {
    expect(colorRefBytes({ r: 0.5, g: 1, b: 0 })).toEqual([128, 255, 0, 0]);
  });
});

describe("autoColorRefBytes", () => {
  it("writes zeroed components with fAuto set", () => {
    expect(autoColorRefBytes()).toEqual([0x00, 0x00, 0x00, 0xff]);
  });
});
