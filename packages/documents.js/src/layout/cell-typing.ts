import type { ContentCellValue } from "document-schema.js";

// HEURISTIC CELL RE-TYPING: turning a spreadsheet cell's RENDERED text back into a typed value.
//
// READ THIS FIRST -- THIS IS PROBABILISTIC BEST-EFFORT RECOVERY, NOT A FIDELITY GUARANTEE. A rendered PDF genuinely never carries a spreadsheet cell's own typed value: a PDF page holds only the string the authoring application chose to print. Everything below is therefore inference from that string alone, and a string that looks exactly like a number may genuinely have BEEN a string in the source spreadsheet -- a part number, a version, a phone extension. Nothing in this module, or anywhere downstream of it, can tell those apart with certainty, and no amount of further heuristic would change that. Callers who need certainty must not use a PDF as their source; callers who need the printed form regardless of what was inferred always have it, because ContentSheetCell.displayText is a REQUIRED field carrying the rendered string verbatim, independent of value.kind (verified against document-schema.js's own ContentSheetCellSchema, and preserved through the write side by src/edit/ods/content.ts's appendCell, which assigns displayText AFTER value precisely so the value setter's own generic formatting cannot overwrite it).
//
// THE CONFIDENCE BAR: re-type only when the rendered string has exactly ONE defensible reading. That resolves to four concrete requirements, each of which exists because violating it produces a silently WRONG value rather than a merely unhelpful one:
//   1. Lossless -- the decimal must be exactly representable as a JS number (checked by round-tripping it, not by a digit-count limit). This is what keeps a 19-digit barcode a string instead of a number ending in the wrong digits.
//   2. Separator-unambiguous -- '.' is read as the decimal separator and ',' as the grouping separator, but a lone comma group ("1,234") is DECLINED, because the competing European reading of the identical string is 1.234, a thousandfold error. Two or more groups ("1,234,567"), or a group alongside a real decimal point ("1,234.50"), have no such competing reading and are accepted.
//   3. No leading zeros -- "007" and "01.5" are declined. A spreadsheet never prints a numeric value with a leading zero, so a leading zero is positive evidence of an identifier.
//   4. Role-unambiguous, for dates -- ISO ordering ("2024-01-15") or a named month ("15 Jan 2024") state which component is which. An all-numeric separated date ("01/02/2024") does not, and is declined regardless of whether one component happens to exceed 12 in that particular cell: resolving it per cell would type one column inconsistently, which is worse than typing none of it.
//
// WHAT IS DELIBERATELY OUT OF SCOPE: 'time'/'dateTime' (their ODF wire representation is an xsd:duration, "PT14H30M00S", so recovering one means inventing a duration encoding on top of an already-probabilistic parse), 'error' (a rendered "#DIV/0!" is a real, valid string in a real spreadsheet too), and formulas (nothing about a rendered value implies one was computed). A cell matching none of the rules below simply stays a string with no diagnostic at all -- a decline is reported only for the specific, named ambiguity classes this module actively detects and refuses.

export type CellTypeRule =
  | "boolean-literal"
  | "iso-date"
  | "named-month-date"
  | "plain-number"
  | "grouped-number"
  | "percentage"
  | "currency";

export type CellTypeDeclineReason =
  | "ambiguous-boolean-word"
  | "ambiguous-date-order"
  | "ambiguous-grouping-separator"
  | "leading-zero-digits"
  | "precision-loss";

export type CellTypeInferenceResult =
  | {
      readonly outcome: "retyped";
      readonly value: ContentCellValue;
      readonly rule: CellTypeRule;
    }
  | { readonly outcome: "declined"; readonly reason: CellTypeDeclineReason };

// One reported inference, positioned so a caller can find the cell it refers to. `outcome: 'retyped'` carries the value actually written; `outcome: 'declined'` carries the ambiguity that stopped it, and the cell is left a plain string.
export type CellTypeInference = {
  readonly sheetIndex: number;
  readonly row: number;
  readonly column: number;
  readonly displayText: string;
} & CellTypeInferenceResult;

export type CellTypeInferenceSink = (inference: CellTypeInference) => void;

// Currency symbols this module recognises, mapped to the ISO 4217 code they unambiguously imply. '$' and '¥' map to undefined DELIBERATELY: '$' is USD, CAD, AUD, NZD, HKD and more, and '¥' is both JPY and CNY, so naming one would be a guess where the KIND ('currency') is not a guess at all. ContentCellValue's currency variant models `currency` as optional for exactly this case.
const CURRENCY_SYMBOLS: ReadonlyMap<string, string | undefined> = new Map([
  ["$", undefined],
  ["¥", undefined],
  ["£", "GBP"],
  ["€", "EUR"],
  ["₹", "INR"],
  ["₩", "KRW"],
  ["₽", "RUB"],
]);

const MONTH_NAMES: ReadonlyMap<string, number> = new Map(
  [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ].flatMap((name, index) => [
    [name, index + 1] as const,
    [name.slice(0, 3), index + 1] as const,
  ]),
);

// A spreadsheet renders a real boolean as exactly TRUE or FALSE (LibreOffice Calc and Excel both, absent a custom number format) -- so these two words, and only these two, are direct evidence of a boolean cell.
const BOOLEAN_LITERALS: ReadonlyMap<string, boolean> = new Map([
  ["true", true],
  ["false", false],
]);

// "Yes"/"No" is the single most tempting false friend here, and is declined rather than accepted: no mainstream spreadsheet prints a boolean this way by default, so a "Yes" cell is far more likely to be genuine text (a survey answer, a status column) than a boolean. Declining it is the confidence bar being applied, not an omission -- and it is REPORTED, so a caller who knows their own source uses Yes/No booleans can act on it.
const AMBIGUOUS_BOOLEAN_WORDS: ReadonlySet<string> = new Set([
  "yes",
  "no",
  "y",
  "n",
  "on",
  "off",
]);

// U+00A0 NO-BREAK SPACE and U+202F NARROW NO-BREAK SPACE both appear in real rendered spreadsheet output (as a grouping separator in several locales, and around a currency symbol); trimming them alongside ordinary whitespace is what stops "£ 1234" or a trailing NBSP from silently defeating every rule below.
function normalizeWhitespace(text: string): string {
  return text.replace(/[\u00A0\u202F]/gu, " ").trim();
}

// The parsed number, but only when the decimal it came from survives the round trip exactly. Trailing fraction zeros are stripped from the canonical form first, since "42.50" and "42.5" are the same VALUE and only the former's own printed form differs -- that difference is displayText's job to preserve, not value's.
function exactlyRepresentable(canonicalDecimal: string): number | undefined {
  const parsed = Number(canonicalDecimal);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  const trimmed = canonicalDecimal.includes(".")
    ? canonicalDecimal.replace(/0+$/u, "").replace(/\.$/u, "")
    : canonicalDecimal;
  return String(parsed) === trimmed ? parsed : undefined;
}

interface NumericLiteral {
  readonly canonicalDecimal: string; // sign + digits + optional '.' + digits, grouping removed
  readonly grouped: boolean;
}

const PLAIN_NUMBER_PATTERN =
  /^(?<sign>[-+])?(?<integer>\d+)(?:\.(?<fraction>\d+))?$/u;
const GROUPED_NUMBER_PATTERN =
  /^(?<sign>[-+])?(?<lead>\d{1,3})(?<groups>(?:,\d{3})+)(?:\.(?<fraction>\d+))?$/u;

// Parses the bare numeric core of a cell (no currency symbol, no percent sign -- those are peeled off by their own rules before calling this). Returns a decline for the two ambiguity classes that LOOK like a valid number under this module's stated dot-decimal/comma-grouping convention but have a competing reading, and undefined for anything that simply is not numeric at all.
function parseNumericLiteral(
  text: string,
): NumericLiteral | { readonly declined: CellTypeDeclineReason } | undefined {
  const grouped = GROUPED_NUMBER_PATTERN.exec(text);
  if (grouped?.groups !== undefined) {
    const { sign, lead, groups, fraction } = grouped.groups;
    if (lead!.length > 1 && lead!.startsWith("0")) {
      return { declined: "leading-zero-digits" };
    }
    // A single comma group with no decimal point ("1,234") reads as 1234 under this module's own convention and as 1.234 under the European one -- a thousandfold difference with nothing in the string to settle it. Two or more groups, or a group plus a real decimal point, cannot be read the European way at all and are accepted.
    const groupCount = groups!.length / 4;
    if (groupCount === 1 && fraction === undefined) {
      return { declined: "ambiguous-grouping-separator" };
    }
    return {
      canonicalDecimal: `${sign === "-" ? "-" : ""}${lead}${groups!.replaceAll(",", "")}${fraction === undefined ? "" : `.${fraction}`}`,
      grouped: true,
    };
  }
  const plain = PLAIN_NUMBER_PATTERN.exec(text);
  if (plain?.groups === undefined) {
    return undefined;
  }
  const { sign, integer, fraction } = plain.groups;
  if (integer!.length > 1 && integer!.startsWith("0")) {
    return { declined: "leading-zero-digits" };
  }
  return {
    canonicalDecimal: `${sign === "-" ? "-" : ""}${integer}${fraction === undefined ? "" : `.${fraction}`}`,
    grouped: false,
  };
}

function isDecline(
  value:
    NumericLiteral | { readonly declined: CellTypeDeclineReason } | undefined,
): value is { readonly declined: CellTypeDeclineReason } {
  return value !== undefined && "declined" in value;
}

// A leading currency symbol, optionally preceded by the sign ("-£5.00", the form both Calc and Excel print for a negative currency in a non-accounting format). A TRAILING symbol is deliberately not recognised: the locales that print one also use ',' as their decimal separator, so accepting "1.234,50 €" would mean adopting the very convention rule 2 above declines.
const CURRENCY_PREFIX_PATTERN =
  /^(?<sign>-)?(?<symbol>[$£€¥₹₩₽])\s?(?<rest>.+)$/u;

function inferCurrency(text: string): CellTypeInferenceResult | undefined {
  const match = CURRENCY_PREFIX_PATTERN.exec(text);
  if (match?.groups === undefined) {
    return undefined;
  }
  const { sign, symbol, rest } = match.groups;
  const literal = parseNumericLiteral(rest!);
  if (isDecline(literal)) {
    return { outcome: "declined", reason: literal.declined };
  }
  if (literal === undefined) {
    return undefined;
  }
  const magnitude = exactlyRepresentable(literal.canonicalDecimal);
  if (magnitude === undefined) {
    return { outcome: "declined", reason: "precision-loss" };
  }
  return {
    outcome: "retyped",
    value: {
      kind: "currency",
      value: sign === "-" ? -magnitude : magnitude,
      currency: CURRENCY_SYMBOLS.get(symbol!),
    },
    rule: "currency",
  };
}

// ODF (and therefore ContentCellValue) stores a percentage as the FRACTION -- office:value="0.15" renders as "15%", exactly as src/edit/ods/cell.ts's own setter writes it back (`${value.value * 100}%`). The recovered value is divided by 100 here for that reason, not left as the printed magnitude.
const PERCENT_HUNDREDTHS = 100;

function inferPercentage(text: string): CellTypeInferenceResult | undefined {
  if (!text.endsWith("%")) {
    return undefined;
  }
  const literal = parseNumericLiteral(text.slice(0, -1).trimEnd());
  if (isDecline(literal)) {
    return { outcome: "declined", reason: literal.declined };
  }
  if (literal === undefined) {
    return undefined;
  }
  const magnitude = exactlyRepresentable(literal.canonicalDecimal);
  if (magnitude === undefined) {
    return { outcome: "declined", reason: "precision-loss" };
  }
  return {
    outcome: "retyped",
    value: { kind: "percentage", value: magnitude / PERCENT_HUNDREDTHS },
    rule: "percentage",
  };
}

const ISO_DATE_PATTERN = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u;
// "15 Jan 2024", "15 January 2024", "15-Jan-2024" -- day first, month named.
const DAY_MONTH_YEAR_PATTERN =
  /^(?<day>\d{1,2})[\s-](?<month>[A-Za-z]{3,9})\.?[\s-](?<year>\d{4})$/u;
// "Jan 15, 2024", "January 15 2024" -- month named first.
const MONTH_DAY_YEAR_PATTERN =
  /^(?<month>[A-Za-z]{3,9})\.?[\s-](?<day>\d{1,2}),?[\s-](?<year>\d{4})$/u;
// Any all-numeric separated date: the ambiguity class this module refuses rather than guesses at.
const NUMERIC_SEPARATED_DATE_PATTERN = /^\d{1,4}[/.]\d{1,2}[/.]\d{1,4}$/u;

const MONTHS_PER_YEAR = 12;

// Calendar validity, so "2024-02-31" or "31 Feb 2024" is rejected outright rather than re-typed into a date no calendar has. Date.UTC normalises an out-of-range day into the following month, so comparing the components back is what actually detects one.
function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > MONTHS_PER_YEAR || day < 1) {
    return false;
  }
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

function isoDateValue(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function inferDate(text: string): CellTypeInferenceResult | undefined {
  const iso = ISO_DATE_PATTERN.exec(text);
  if (iso?.groups !== undefined) {
    const year = Number(iso.groups.year);
    const month = Number(iso.groups.month);
    const day = Number(iso.groups.day);
    return isRealCalendarDate(year, month, day)
      ? {
          outcome: "retyped",
          value: { kind: "date", value: isoDateValue(year, month, day) },
          rule: "iso-date",
        }
      : undefined;
  }
  const named =
    DAY_MONTH_YEAR_PATTERN.exec(text) ?? MONTH_DAY_YEAR_PATTERN.exec(text);
  if (named?.groups !== undefined) {
    const month = MONTH_NAMES.get(named.groups.month!.toLowerCase());
    if (month === undefined) {
      return undefined;
    }
    const year = Number(named.groups.year);
    const day = Number(named.groups.day);
    return isRealCalendarDate(year, month, day)
      ? {
          outcome: "retyped",
          value: { kind: "date", value: isoDateValue(year, month, day) },
          rule: "named-month-date",
        }
      : undefined;
  }
  return NUMERIC_SEPARATED_DATE_PATTERN.test(text)
    ? { outcome: "declined", reason: "ambiguous-date-order" }
    : undefined;
}

function inferBoolean(text: string): CellTypeInferenceResult | undefined {
  const lowered = text.toLowerCase();
  const literal = BOOLEAN_LITERALS.get(lowered);
  if (literal !== undefined) {
    return {
      outcome: "retyped",
      value: { kind: "boolean", value: literal },
      rule: "boolean-literal",
    };
  }
  return AMBIGUOUS_BOOLEAN_WORDS.has(lowered)
    ? { outcome: "declined", reason: "ambiguous-boolean-word" }
    : undefined;
}

function inferNumber(text: string): CellTypeInferenceResult | undefined {
  const literal = parseNumericLiteral(text);
  if (isDecline(literal)) {
    return { outcome: "declined", reason: literal.declined };
  }
  if (literal === undefined) {
    return undefined;
  }
  const value = exactlyRepresentable(literal.canonicalDecimal);
  if (value === undefined) {
    return { outcome: "declined", reason: "precision-loss" };
  }
  return {
    outcome: "retyped",
    value: { kind: "number", value },
    rule: literal.grouped ? "grouped-number" : "plain-number",
  };
}

// The rendered string a spreadsheet cell was recovered from, re-read as a typed value where -- and only where -- exactly one reading is defensible. Returns undefined when the text is not number/date/boolean-shaped at all, which is the ordinary case for genuine text and needs no diagnostic. Order matters only in that each rule peels off its own distinguishing marker (currency symbol, percent sign) before the bare-number rule sees the remainder; the rules are otherwise disjoint.
export function inferCellValue(
  displayText: string,
): CellTypeInferenceResult | undefined {
  const text = normalizeWhitespace(displayText);
  if (text.length === 0) {
    return undefined;
  }
  return (
    inferBoolean(text) ??
    inferDate(text) ??
    inferCurrency(text) ??
    inferPercentage(text) ??
    inferNumber(text)
  );
}
