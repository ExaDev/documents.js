// ODF measurement-unit conversion, the shared foundation every future odt/ods/odp/odg reader (and this package's own existing style-property parser) needs. Unlike OOXML's integer EMU/twip/half-point units, an ODF length is a physical-unit STRING directly in the XML -- style:page-layout-properties's fo:page-width="21.001cm", a paragraph's fo:margin-left="0.5in", fo:font-size="12pt" -- so parsing is the real job here, not just multiplying by a fixed factor. document-schema.js's own Box/PageSize/Margins schemas (and this package's StyleProperties) are all pt-based throughout, so "points" is this module's one canonical output/input unit.
//
// Every unit and conversion constant below was verified against real style:page-layout-properties/style:paragraph-properties/style:text-properties output from LibreOffice 26.2 (via `soffice --headless --convert-to odt/ods/ods` on hand-built fixtures, and directly from LibreOffice's own bundled .ott/.ots template packages under /Applications/LibreOffice.app/Contents/Resources/template/**) and cross-checked against the OASIS ODF `length` datatype (datypic.com's ODF schema reference; pattern `-?(\d+(\.\d+)?|\.\d+)(cm|mm|in|pt|pc|px)`). Two things are easy to get wrong by guessing rather than checking:
// - pc (pica) is 12pt, not 6pt or 10pt -- the one of these six units most likely to be misremembered. This is a fixed, universal typographic constant (1 pica = 12 points, independent of ODF), not something LibreOffice-specific to verify further.
// - px has no natural "points per pixel" ratio of its own; ODF (like CSS) assumes the CSS reference pixel, 96px = 1in = 72pt, so 1px = 0.75pt. This is the same assumption properties.ts's own original parseLength established and this module now supersedes -- see this file's own test suite for the LibreOffice-round-trip evidence.
// - cm/mm/in/pt are exact physical-unit ratios (1in = 2.54cm = 25.4mm exactly, per the international yard-and-pound agreement since 1959; 1in = 72pt, the standard PostScript/DTP point this package's own model already uses throughout), not approximations.

export type LengthUnit = "cm" | "mm" | "in" | "pt" | "pc" | "px";

// ODF's `length` datatype: a (possibly negative, possibly fractional) number immediately followed by one of these six unit suffixes.
const LENGTH_PATTERN = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(cm|mm|in|pt|pc|px)$/;

const POINTS_PER_INCH = 72; // The standard PostScript/DTP point -- exact by definition, not measured.
const POINTS_PER_PICA = 12; // 1 pica = 12 points -- a fixed typographic constant, independent of any physical unit system.
const CM_PER_INCH = 2.54; // Exact, per the international yard-and-pound agreement (1959).
const MM_PER_INCH = 25.4; // = CM_PER_INCH * 10, exact for the same reason.
const CSS_REFERENCE_PIXELS_PER_INCH = 96; // The CSS reference pixel (and ODF's own assumption for px): 96px = 1in.

function unitToPtFactor(unit: LengthUnit): number {
  switch (unit) {
    case "pt":
      return 1;
    case "in":
      return POINTS_PER_INCH;
    case "cm":
      return POINTS_PER_INCH / CM_PER_INCH;
    case "mm":
      return POINTS_PER_INCH / MM_PER_INCH;
    case "pc":
      return POINTS_PER_PICA;
    case "px":
      return POINTS_PER_INCH / CSS_REFERENCE_PIXELS_PER_INCH;
  }
}

function isLengthUnit(value: string): value is LengthUnit {
  return (
    value === "cm" ||
    value === "mm" ||
    value === "in" ||
    value === "pt" ||
    value === "pc" ||
    value === "px"
  );
}

// Parses an ODF length value (any of its six valid units) into points, or undefined if the string doesn't match the ODF `length` grammar at all. Liberal on read -- an adopted real-world document may use any unit -- deliberately paired with formatOdfLength below, whose own default output unit is "pt" (this package's own writers always emit pt, avoiding a unit-conversion rounding step entirely -- see properties.ts's own note on why).
export function parseOdfLength(value: string): number | undefined {
  const match = LENGTH_PATTERN.exec(value);
  if (match === null) {
    return undefined;
  }
  const numeric = match[1];
  const unit = match[2];
  if (numeric === undefined || unit === undefined || !isLengthUnit(unit)) {
    return undefined;
  }
  return Number(numeric) * unitToPtFactor(unit);
}

// JavaScript's own Number-to-string switches to EXPONENT notation outside a fixed magnitude window (below 1e-6, or at/above 1e21) -- `${-7.1e-15}` is "-7.1e-15", not "-0.0000000000000071". The ODF `length` datatype has NO exponent form at all (see LENGTH_PATTERN above, and the OASIS grammar it encodes), so a bare template-literal stringification silently emits spec-invalid ODF for any small-magnitude length. That is not a theoretical range: a rotated shape's own draw:transform translate() components are trig-derived (typed/draw/write-shapes.ts's frameGeometryAttrs), so a shape rotated about a point near the page origin routinely lands a component at 1e-15-ish rounding dust rather than a clean 0. The consequence on the way back in is silent and total: parseOdfTransform drops a translate() whose components don't parse (so the shape moves to the pivot), and parseBox returns undefined for an unrotated frame whose svg:x/svg:y don't parse (so readDrawFrame drops the shape entirely).
//
// The fix belongs here, on the write side, not in LENGTH_PATTERN: widening the reader to accept an exponent would make this package read its own invalid output back correctly while every other ODF consumer still saw a length outside the datatype. expandExponential below re-positions the decimal point in the digits Number-to-string ALREADY chose (the shortest round-tripping representation), so it is an exact re-spelling rather than a rounding step -- and since those digits never carry a trailing fractional zero, neither does the result, matching the plain-stringification style of every ordinary value.
function expandExponential(text: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(text);
  if (match === null) {
    return text;
  }
  const [, sign, integerDigits, fractionDigits, exponent] = match;
  if (
    sign === undefined ||
    integerDigits === undefined ||
    exponent === undefined
  ) {
    return text;
  }
  const digits = `${integerDigits}${fractionDigits ?? ""}`;
  // Where the decimal point lands within `digits` once the exponent is applied: left of every digit (a pure fraction needing leading zeros), right of every digit (an integer needing trailing zeros), or between two of them.
  const pointIndex = integerDigits.length + Number(exponent);
  if (pointIndex <= 0) {
    return `${sign}0.${"0".repeat(-pointIndex)}${digits}`;
  }
  if (pointIndex >= digits.length) {
    return `${sign}${digits}${"0".repeat(pointIndex - digits.length)}`;
  }
  return `${sign}${digits.slice(0, pointIndex)}.${digits.slice(pointIndex)}`;
}

// The reverse of parseOdfLength: formats a point value as an ODF length string in the given unit (default "pt", matching this package's own writers' always-pt convention). No rounding is applied -- the conversion is an exact IEEE-754 division, so the result may carry more decimal places than a human would type by hand (real LibreOffice output does the same, e.g. "0.423cm" for a value that didn't originate in cm); a caller that wants a specific display precision is responsible for rounding the input pt value itself before calling this. The output is always fixed-point decimal, never exponent notation -- see expandExponential above for why that is a correctness requirement rather than a formatting preference.
export function formatOdfLength(pt: number, unit: LengthUnit = "pt"): string {
  const value = pt / unitToPtFactor(unit);
  return `${expandExponential(`${value}`)}${unit}`;
}
