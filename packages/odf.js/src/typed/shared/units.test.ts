import { describe, expect, it } from "vitest";
import { parseOdfLength, formatOdfLength } from "./units";

// The cm-based fixtures below ("real LibreOffice output") are copied verbatim from a real style:paragraph-properties element produced by `soffice --headless --convert-to odt` (LibreOffice 26.2.5.2), the same fixture referenced by src/styles/properties.test.ts -- see that file's own top-of-file note.

describe("parseOdfLength", () => {
  it("parses every ODF length unit into points", () => {
    expect(parseOdfLength("12pt")).toBe(12);
    expect(parseOdfLength("1in")).toBe(72);
    expect(parseOdfLength("1pc")).toBe(12); // pica -- the unit most likely to be misremembered; 1pc = 12pt, not 6pt or 10pt.
    expect(parseOdfLength("2pc")).toBe(24);
    expect(parseOdfLength("100px")).toBe(75); // CSS reference pixel: 96px = 1in = 72pt.
    expect(parseOdfLength("96px")).toBe(72);
    expect(parseOdfLength("2.54cm")).toBeCloseTo(72, 10);
    expect(parseOdfLength("25.4mm")).toBeCloseTo(72, 10);
  });

  it("parses negative and fractional lengths", () => {
    expect(parseOdfLength("-0.5pt")).toBe(-0.5);
    expect(parseOdfLength(".5pt")).toBe(0.5);
  });

  it("parses real LibreOffice cm-based margins to the points the original pt-based CSS source specified", () => {
    // Fixture's CSS source was margin-top:12pt / margin-bottom:6pt / text-indent:18pt; LibreOffice re-expressed them in cm on round trip.
    expect(parseOdfLength("0.423cm")).toBeCloseTo(12, 1);
    expect(parseOdfLength("0.212cm")).toBeCloseTo(6, 1);
    expect(parseOdfLength("0.635cm")).toBeCloseTo(18, 1);
  });

  it("returns undefined for a malformed or unitless length", () => {
    expect(parseOdfLength("12")).toBeUndefined();
    expect(parseOdfLength("12em")).toBeUndefined();
    expect(parseOdfLength("auto")).toBeUndefined();
    expect(parseOdfLength("")).toBeUndefined();
    expect(parseOdfLength("12 pt")).toBeUndefined();
  });
});

describe("formatOdfLength", () => {
  it('defaults to "pt" when no unit is given', () => {
    expect(formatOdfLength(12)).toBe("12pt");
    expect(formatOdfLength(-4.5)).toBe("-4.5pt");
  });

  it("formats every unit, each round-tripping back through parseOdfLength to the original point value", () => {
    for (const unit of ["cm", "mm", "in", "pt", "pc", "px"] as const) {
      const formatted = formatOdfLength(72, unit);
      expect(formatted.endsWith(unit)).toBe(true);
      expect(parseOdfLength(formatted)).toBeCloseTo(72, 9);
    }
  });

  it("formats a known exact value per unit", () => {
    expect(formatOdfLength(72, "in")).toBe("1in");
    expect(formatOdfLength(12, "pc")).toBe("1pc");
    expect(formatOdfLength(72, "px")).toBe("96px");
  });
});

// The ODF `length` datatype has no exponent form (see units.ts's own LENGTH_PATTERN and the OASIS grammar it encodes), but JavaScript's own Number-to-string switches into one below 1e-6 and at/above 1e21. A length that came out as "-7.1e-15pt" was therefore spec-invalid ODF that this package's own reader silently rejected -- parseOdfTransform drops a translate() whose components don't parse, and parseBox returns undefined for an unrotated frame's own svg:x/svg:y, taking the whole shape with it. See typed/odp/write-round-trip.test.ts's own near-origin rotation sweep for the end-to-end statement of that failure.
describe("formatOdfLength: fixed-point decimal only, never exponent notation", () => {
  const EXPONENT_MAGNITUDES = [
    1e-7, 5.5e-8, 1e-15, -7.1e-15, 1.05e-20, 5e-324, 1e21, -1.2345e22, 1e300,
  ];

  it.each(EXPONENT_MAGNITUDES)(
    "formats %p without an exponent, and parseOdfLength reads it back to the identical double",
    (pt) => {
      const formatted = formatOdfLength(pt);
      expect(formatted).not.toMatch(/[eE]/);
      expect(parseOdfLength(formatted)).toBe(pt);
    },
  );

  it("leaves the plain-stringification spelling of an ordinary value untouched, trailing zeros included (there are none to trim)", () => {
    expect(formatOdfLength(0)).toBe("0pt");
    expect(formatOdfLength(12)).toBe("12pt");
    expect(formatOdfLength(-4.5)).toBe("-4.5pt");
    expect(formatOdfLength(0.000001)).toBe("0.000001pt");
    expect(formatOdfLength(1e-7)).toBe("0.0000001pt");
  });

  it("never emits an exponent for any translate() component the rotation inverse can produce, across a full turn of angles and several frames including ones at the page origin", () => {
    const frames = [
      { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      { xPt: 0, yPt: 0, widthPt: 1, heightPt: 1 },
      { xPt: 0.001, yPt: 0.001, widthPt: 200, heightPt: 80 },
      { xPt: -5, yPt: 3, widthPt: 40, heightPt: 40 },
    ];
    for (let deg = -360; deg <= 360; deg += 0.5) {
      const angleRad = (-deg * Math.PI) / 180;
      for (const frame of frames) {
        // typed/draw/write-shapes.ts's own frameGeometryAttrs, restated here so this file tests the FORMATTER against the real value distribution rather than importing the shape writer into a units test.
        const halfWidthPt = frame.widthPt / 2;
        const halfHeightPt = frame.heightPt / 2;
        const txPt =
          frame.xPt +
          halfWidthPt -
          halfWidthPt * Math.cos(angleRad) -
          halfHeightPt * Math.sin(angleRad);
        const tyPt =
          frame.yPt +
          halfHeightPt -
          halfHeightPt * Math.cos(angleRad) +
          halfWidthPt * Math.sin(angleRad);
        for (const pt of [txPt, tyPt]) {
          const formatted = formatOdfLength(pt);
          expect(formatted).not.toMatch(/[eE]/);
          expect(parseOdfLength(formatted)).toBe(pt);
        }
      }
    }
  });
});
