// Parses a MathML length attribute value (mspace's width/height/depth, mtable's columnspacing/rowspacing, mfrac's linethickness, ...) into points at `fontSizePt`. MathML3 (https://www.w3.org/TR/MathML3/chapter2.html#fund.units) permits a signed number followed by a unit -- em/ex (font-relative), px/in/cm/mm/pt/pc (absolute), a bare '%' (percentage of fontSizePt), or one of the seven named "MathSpace" keywords (thickmathspace etc.) -- or a bare unitless number, which MathML treats as 'em'. Returns undefined for anything this parser doesn't recognise (an empty string, a malformed number, an unknown unit) rather than throwing -- callers fall back to their own construct-specific default, the same "unsupported input degrades, it doesn't crash layout" policy the rest of this module follows.
const NAMED_MATH_SPACES: ReadonlyMap<string, number> = new Map([
  // In em, per MathML3's own defined values (an arithmetic progression from 1/18em to 6/18em).
  ["veryverythinmathspace", 1 / 18],
  ["verythinmathspace", 2 / 18],
  ["thinmathspace", 3 / 18],
  ["mediummathspace", 4 / 18],
  ["thickmathspace", 5 / 18],
  ["verythickmathspace", 6 / 18],
  ["veryverythickmathspace", 7 / 18],
]);

// ex (x-height) has no reliable per-font measurement in this module's own MathFontMetrics port (see metrics.ts's own note on why only advance width, italic correction, and top-accent attachment are exposed per glyph, not a general ink bounding box) -- 0.5em is the same fixed approximation CSS itself falls back to when a real x-height is unavailable.
const EX_APPROXIMATION_OF_EM = 0.5;

const LENGTH_PATTERN =
  /^([+-]?[0-9]*\.?[0-9]+)\s*(em|ex|px|in|cm|mm|pt|pc|%)?$/;
const PX_PER_INCH = 96;
const PT_PER_INCH = 72;
const CM_PER_INCH = 2.54;
const MM_PER_INCH = 25.4;
const PC_PER_INCH = 6;

export function parseMathLength(
  value: string,
  fontSizePt: number,
): number | undefined {
  const trimmed = value.trim();
  const named = NAMED_MATH_SPACES.get(trimmed);
  if (named !== undefined) {
    return named * fontSizePt;
  }

  const match = LENGTH_PATTERN.exec(trimmed);
  if (match === null) {
    return undefined;
  }
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) {
    return undefined;
  }
  const unit = match[2] ?? "em"; // a bare number is 'em' per the MathML3 spec

  switch (unit) {
    case "em":
      return amount * fontSizePt;
    case "ex":
      return amount * fontSizePt * EX_APPROXIMATION_OF_EM;
    case "%":
      return (amount / 100) * fontSizePt;
    case "pt":
      return amount;
    case "px":
      return (amount / PX_PER_INCH) * PT_PER_INCH;
    case "in":
      return amount * PT_PER_INCH;
    case "cm":
      return (amount / CM_PER_INCH) * PT_PER_INCH;
    case "mm":
      return (amount / MM_PER_INCH) * PT_PER_INCH;
    case "pc":
      return (amount / PC_PER_INCH) * PT_PER_INCH;
    default:
      return undefined;
  }
}
