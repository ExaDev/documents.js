/**
 * A tokenizing classifier for Excel's number-format mini-language: the string carried by an xlsx style's `<numFmt formatCode="...">` and by a BIFF8 Format record's own stFormat, per ECMA-376 Part 1 SS18.8.30. [MS-XLS] 2.4.126 defers to that same section for how a BIFF8 Format record's string is interpreted (https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/300280fd-e4fe-4675-a924-4d383af48d3b) -- OOXML inherited the format codes from BIFF, so xlsx and .xls share the identical language rather than two similar ones. It answers exactly one question: what KIND of value does a numeric cell carrying this format actually hold -- a percentage, an amount of money, a date, a time of day, an elapsed duration, or a plain number? Extracted from ooxml.js's typed/xlsx/number-format.ts and xls-codec's number-format.ts, which had independently implemented the identical classifier (ExaDev/documents.js#848); this package is now the one shared implementation both depend on.
 *
 * This is a classifier, NOT a formatter: nothing here renders a value through a format code (that needs locale data, fill/alignment placeholder geometry, conditional-section evaluation, and colour handling neither consuming codec has asked for), only classifies one.
 *
 * Tokenizing rather than pattern-matching is load-bearing, not a stylistic preference -- every meaningful signal in this language is context-sensitive, and a regex over the raw string gets each of them wrong:
 *   * a 'd' inside "dollars" is literal text, not a day code, and so is every character inside a \-escape or an _x/*x placeholder;
 *   * '$' immediately followed by '-' inside a bracket is a LOCALE tag ([$-809], "English (United Kingdom)") carrying no currency meaning at all, while the same bracket with text before the dash ([$GBP-809], [$£-809]) genuinely is a currency marker -- one character apart, opposite meanings;
 *   * '[h]' is an elapsed-hours bucket (a duration that may exceed 24h) while a bare 'h' is an hour-of-day;
 *   * 'm' is minutes or months depending purely on the code runs around it;
 *   * and a ';' inside a quoted literal does not start a new section.
 */

/** A single lexical unit of a format code. 'literal' covers every construct whose payload is TEXT rather than format codes -- a "..." quoted run, a \x escape, and the payload character of an _x (reserve the width of x) or *x (repeat x to fill the cell) placeholder -- so nothing inside one is ever read as a date/time/numeric code. Its text is still SCANNED for a currency symbol, because a literal currency symbol is exactly how ECMA-376's own built-in accounting formats (42/44, `_("$"* #,##0_)`) mark money. */
export type NumberFormatToken =
  | { kind: "literal"; text: string }
  | { kind: "bracket"; body: string }
  | { kind: "separator" }
  | { kind: "code"; char: string };

/** Excel honours at most four sections (positive; negative; zero; text). A fifth would be malformed, and since this classifier reads only the first section it is dropped rather than guessed at. */
export const MAX_NUMBER_FORMAT_SECTIONS = 4;

// Mirrors String.prototype.charAt's own past-the-end contract (the empty string, not undefined) but over a CODE POINT array rather than UTF-16 units, so a rare astral currency symbol stays one token instead of splitting into two lone surrogates.
function at(chars: readonly string[], index: number): string {
  const char = chars[index];
  return char ?? "";
}

/** Lexes a raw format code into a flat sequence of {@link NumberFormatToken}s -- quoted literals, escape/placeholder literals, bracketed markers, section separators, and bare code characters, in source order. */
export function tokenizeNumberFormat(formatCode: string): NumberFormatToken[] {
  const chars = [...formatCode];
  const tokens: NumberFormatToken[] = [];
  let index = 0;
  while (index < chars.length) {
    const char = at(chars, index);
    if (char === '"') {
      // An unterminated quote runs to the end of the format code rather than throwing -- real producers never write one, but a malformed code must still tokenize into something classifiable. The search starts at index + 1, past the opening quote itself, or it would immediately find that same character. closeIndex is chars.length (not -1) for an unterminated quote, since indexOf naturally reports "not found" as -1 and there is no closing quote to find -- joining from index + 1 to chars.length is exactly "the rest of the string".
      const closeIndex = chars.indexOf('"', index + 1);
      const textEnd = closeIndex === -1 ? chars.length : closeIndex;
      const text = chars.slice(index + 1, textEnd).join("");
      index = textEnd + 1;
      tokens.push({ kind: "literal", text });
      continue;
    }
    if (char === "\\" || char === "_" || char === "*") {
      // \x renders x literally; _x reserves x's width without printing it; *x repeats x to fill the cell. All three consume the FOLLOWING character as a non-code payload, which is why `_(` never reads as an opening parenthesis code and `\-` (real LibreOffice output) never reads as a minus sign.
      tokens.push({ kind: "literal", text: at(chars, index + 1) });
      index += 2;
      continue;
    }
    if (char === "[") {
      // An unterminated bracket runs to the end of the format code, for the same reason an unterminated quote does above.
      const closeIndex = chars.indexOf("]", index + 1);
      const bodyEnd = closeIndex === -1 ? chars.length : closeIndex;
      const body = chars.slice(index + 1, bodyEnd).join("");
      index = bodyEnd + 1;
      tokens.push({ kind: "bracket", body });
      continue;
    }
    if (char === ";") {
      tokens.push({ kind: "separator" });
      index += 1;
      continue;
    }
    tokens.push({ kind: "code", char });
    index += 1;
  }
  return tokens;
}

/** Splits a token stream into sections at its top-level {@link NumberFormatToken} separators, capped at {@link MAX_NUMBER_FORMAT_SECTIONS}. A ';' inside a quoted literal or a bracket was already consumed as part of that token by {@link tokenizeNumberFormat}, so it can never split a section here. Always returns at least one section (an empty one for an empty format code). */
export function splitNumberFormatSections(
  tokens: readonly NumberFormatToken[],
): NumberFormatToken[][] {
  const sections: NumberFormatToken[][] = [];
  let current: NumberFormatToken[] = [];
  for (const token of tokens) {
    if (token.kind === "separator") {
      sections.push(current);
      current = [];
      continue;
    }
    current.push(token);
  }
  sections.push(current);
  return sections.slice(0, MAX_NUMBER_FORMAT_SECTIONS);
}

// The Unicode Currency_Symbol general category (Sc) IS the definition of "this character means money" -- $ £ € ¥ ₹ ฿ and every other one -- so it is tested directly rather than against a hand-listed subset that would silently omit whichever symbol a real file happens to use.
const CURRENCY_SYMBOL = /\p{Sc}/u;

function containsCurrencySymbol(text: string): boolean {
  return CURRENCY_SYMBOL.test(text);
}

/**
 * True when `marker` has the shape of an ISO 4217 alphabetic currency code: exactly three ASCII letters, case-insensitively.
 *
 * [$GBP-809] carries an ISO 4217 alphabetic code; [$£-809] and [$R$-416] carry a display SYMBOL instead. Only the three-ASCII-letter shape is treated as a code -- a consuming codec's own currency field is documented as the ISO 4217 code, so a symbol must leave it absent rather than have a code invented for it (there is no faithful symbol-to-code mapping: '$' alone is USD, CAD, AUD, and a dozen others). Exported (not just used internally by classifyBracket below) because a codec's own writer needs the identical predicate to decide whether a currency string it is about to write is a real ISO code or a symbol that cannot go inside a [$...] bracket -- ooxml.js's typed/xlsx/number-format.ts's currencyNumberFormat is exactly this case, and reusing this function rather than a second copy is what keeps the read and write sides from drifting on what counts as a valid code.
 */
export function isIsoCurrencyCodeShape(marker: string): boolean {
  if (marker.length !== 3) {
    return false;
  }
  for (const char of marker) {
    const upper = char.toUpperCase();
    if (upper < "A" || upper > "Z") {
      return false;
    }
  }
  return true;
}

type BracketMeaning =
  { kind: "elapsed" } | { kind: "currency"; code?: string } | { kind: "none" };

// An elapsed-time bucket is a bracket holding one repeated h/m/s and nothing else ([h], [hh], [mm], [ss]) -- the marker that the value is a DURATION, which may legitimately exceed 24 hours, rather than a time of day.
function isElapsedBracketBody(body: string): boolean {
  let letter: string | undefined;
  for (const char of body) {
    const lower = char.toLowerCase();
    if (letter === undefined) {
      if (lower !== "h" && lower !== "m" && lower !== "s") {
        return false;
      }
      letter = lower;
    } else if (lower !== letter) {
      return false;
    }
  }
  return letter !== undefined;
}

function classifyBracket(body: string): BracketMeaning {
  if (body.startsWith("$")) {
    const rest = body.slice(1);
    // The single most error-prone distinction in this whole language: '$' immediately followed by '-' is a locale-only tag, NOT currency. Real LibreOffice output writes [$-809] on date, time, and percentage formats alike -- reading those as currency would misclassify most of a styled workbook.
    const dashIndex = rest.indexOf("-");
    const marker = dashIndex === -1 ? rest : rest.slice(0, dashIndex);
    if (marker === "") {
      return { kind: "none" };
    }
    return isIsoCurrencyCodeShape(marker)
      ? { kind: "currency", code: marker.toUpperCase() }
      : { kind: "currency" };
  }
  // Everything else a bracket can hold -- a colour ([Red]), a condition ([<=100]), a locale/calendar modifier ([ENG], [DBNum1]) -- carries no value-kind information at all.
  return isElapsedBracketBody(body) ? { kind: "elapsed" } : { kind: "none" };
}

// A run of consecutive identical code characters ('yyyy', 'mm', ':'), plus the one multi-character code that is not a repeated letter: an AM/PM (or A/P) marker, recorded under the synthetic letter 'ampm'. Grouping into runs is what makes 'mmm' (always a month name) distinguishable from 'mm' (ambiguous), and what the minutes-vs-months resolution below scans over.
interface CodeRun {
  letter: string;
  length: number;
}

const AMPM_MARKERS: readonly string[] = ["am/pm", "a/p"];
const AMPM_LETTER = "ampm";

function matchesAt(
  chars: readonly string[],
  index: number,
  marker: string,
): boolean {
  return [...marker].every(
    (char, offset) => at(chars, index + offset).toLowerCase() === char,
  );
}

function codeRunsOf(section: readonly NumberFormatToken[]): CodeRun[] {
  const chars = section
    .filter((token) => token.kind === "code")
    .map((token) => token.char);
  const runs: CodeRun[] = [];
  let index = 0;
  while (index < chars.length) {
    const marker = AMPM_MARKERS.find((candidate) =>
      matchesAt(chars, index, candidate),
    );
    if (marker !== undefined) {
      runs.push({ letter: AMPM_LETTER, length: marker.length });
      index += marker.length;
      continue;
    }
    const char = at(chars, index).toLowerCase();
    let length = 0;
    // A plain array read past its own length is `undefined`, not a throw, and `undefined?.toLowerCase()` short-circuits to `undefined` -- which can never equal `char` (always a real, non-empty character here) -- so this single condition already stops the loop at the array's own end with no separate bounds check needed.
    while (chars[index + length]?.toLowerCase() === char) {
      length += 1;
    }
    runs.push({ letter: char, length });
    index += length;
  }
  return runs;
}

// The date/time letters an ambiguous 'm' looks past its neighbours for. 'm' itself is excluded: an unresolved 'm' carries no information for resolving another one, so `hh:mm:mm` resolves both against the 'hh', not against each other.
const RESOLVING_LETTERS: readonly string[] = ["y", "d", "h", "s"];

function nearestResolvingLetter(
  runs: readonly CodeRun[],
  from: number,
  step: number,
): string | undefined {
  // A plain array read at any out-of-range index (negative or beyond the end) is `undefined`, never a throw, so checking the run itself is exactly the same test that already decides whether the walk has run off either end -- no separate bounds check is needed to keep it from reading forever.
  let index = from + step;
  for (let run = runs[index]; run !== undefined; run = runs[index]) {
    if (RESOLVING_LETTERS.includes(run.letter)) {
      return run.letter;
    }
    index += step;
  }
  return undefined;
}

// Excel's own minutes-vs-months rule, the language's other genuinely ambiguous code: 'm'/'mm' is minutes when the nearest preceding date/time code is an hour or the nearest following one is a second, and a month otherwise. 'mmm' and longer are always month names (January/Jan/J), never minutes, so only runs of one or two are ever ambiguous. This is what makes `yyyy-mm-dd hh:mm:ss` resolve its two identical 'mm' runs oppositely -- month for the first (between 'yyyy' and 'dd'), minutes for the second (after 'hh').
function monthRunIsMinutes(runs: readonly CodeRun[], index: number): boolean {
  return (
    nearestResolvingLetter(runs, index, -1) === "h" ||
    nearestResolvingLetter(runs, index, 1) === "s"
  );
}

/** What a format code says the value is. 'elapsedTime' is kept distinct from 'time' because a duration may exceed 24 hours and so has no wall-clock spelling. */
export type NumberFormatClass =
  | { kind: "number" }
  | { kind: "text" }
  | { kind: "percentage" }
  | { kind: "currency"; code?: string }
  | { kind: "date" }
  | { kind: "time" }
  | { kind: "dateTime" }
  | { kind: "elapsedTime" };

const PLAIN_NUMBER: NumberFormatClass = { kind: "number" };

// The numeric-placeholder codes: digit placeholders ('0' required, '#' suppressed, '?' space-padded), the decimal separator, the thousands separator, and scientific notation's own exponent introducer (handled at its 'e' run below, since a bare 'e' also occurs inside the literal word "General").
const NUMERIC_CODES: readonly string[] = ["0", "#", "?", ".", ","];

interface SectionSignals {
  hasDate: boolean;
  hasTime: boolean;
  hasElapsed: boolean;
  hasPercent: boolean;
  hasNumeric: boolean;
  hasText: boolean;
  hasCurrency: boolean;
  currencyCode?: string;
}

function collectSignals(section: readonly NumberFormatToken[]): SectionSignals {
  const signals: SectionSignals = {
    hasDate: false,
    hasTime: false,
    hasElapsed: false,
    hasPercent: false,
    hasNumeric: false,
    hasText: false,
    hasCurrency: false,
  };
  for (const token of section) {
    if (token.kind === "literal" && containsCurrencySymbol(token.text)) {
      signals.hasCurrency = true;
    }
    if (token.kind === "bracket") {
      const meaning = classifyBracket(token.body);
      if (meaning.kind === "elapsed") {
        signals.hasElapsed = true;
      }
      if (meaning.kind === "currency") {
        signals.hasCurrency = true;
        // The first currency bracket carrying a real ISO code wins; a format with two of them is malformed, and the leading one is the one a reader would see.
        signals.currencyCode ??= meaning.code;
      }
    }
  }
  const runs = codeRunsOf(section);
  runs.forEach((run, index) => {
    if (run.letter === "y" || run.letter === "d") {
      signals.hasDate = true;
      return;
    }
    if (
      run.letter === "h" ||
      run.letter === "s" ||
      run.letter === AMPM_LETTER
    ) {
      signals.hasTime = true;
      return;
    }
    if (run.letter === "m") {
      // A run that resolves to minutes here doesn't need its own hasTime = true: monthRunIsMinutes only returns true when an 'h' precedes or an 's' follows this run in the same section, and that neighbouring run's own turn through this same forEach already sets hasTime via the h/s branch above. Only the month case needs a signal set from here at all.
      if (!(run.length <= 2 && monthRunIsMinutes(runs, index))) {
        signals.hasDate = true;
      }
      return;
    }
    if (run.letter === "e") {
      // 'E+'/'E-' is scientific notation; a bare 'e' with no sign after it is just a letter of the literal word "General" (numFmtId 0, and whatever a producer redefines a custom id as).
      const next = runs[index + 1];
      signals.hasNumeric =
        signals.hasNumeric || next?.letter === "+" || next?.letter === "-";
      return;
    }
    if (run.letter === "%") {
      signals.hasPercent = true;
      return;
    }
    if (run.letter === "@") {
      signals.hasText = true;
      return;
    }
    if (NUMERIC_CODES.includes(run.letter)) {
      signals.hasNumeric = true;
      return;
    }
    if (containsCurrencySymbol(run.letter)) {
      // A bare, unbracketed, unquoted currency symbol -- ECMA-376's own built-in ids 5-8 (`$#,##0_);($#,##0)`) are exactly this shape.
      signals.hasCurrency = true;
    }
  });
  return signals;
}

// Precedence when a format carries several signals at once, most specific first: an elapsed-time bracket beats everything (it is the only marker distinguishing a duration from a time of day); any date code beats any time code (a format with both is a genuine combined date-and-time, which a consuming codec models as its own 'dateTime' kind rather than collapsing onto 'date'); a percent sign beats a currency marker (`[$GBP-809]0.00%` is a percentage of an amount, still a percentage); and a text placeholder only wins when the section has no numeric placeholder to be a number with.
function classifySection(
  section: readonly NumberFormatToken[],
): NumberFormatClass {
  const signals = collectSignals(section);
  if (signals.hasElapsed) {
    return { kind: "elapsedTime" };
  }
  if (signals.hasDate) {
    return signals.hasTime ? { kind: "dateTime" } : { kind: "date" };
  }
  if (signals.hasTime) {
    return { kind: "time" };
  }
  if (signals.hasPercent) {
    return { kind: "percentage" };
  }
  if (signals.hasCurrency) {
    // A code of undefined here is indistinguishable from omitting the field entirely (property access, JSON.stringify, and toEqual all treat them alike), so there's no need to branch on its presence.
    return { kind: "currency", code: signals.currencyCode };
  }
  if (signals.hasText && !signals.hasNumeric) {
    return { kind: "text" };
  }
  return PLAIN_NUMBER;
}

/**
 * Classifies a raw Excel number-format code (an xlsx `<numFmt formatCode>` string, a BIFF8 Format record's stFormat, or one of {@link BUILTIN_NUMBER_FORMATS}) into the {@link NumberFormatClass} of value it says a numeric cell holds.
 *
 * Classification reads the FIRST section only. Sections two through four are the negative/zero/text renderings of the same underlying value -- they can differ in colour, parentheses, and literal text, but never in what kind of thing the cell holds, and a cell whose value happens to be negative must not classify differently from the identical cell holding a positive one.
 */
export function classifyNumberFormat(formatCode: string): NumberFormatClass {
  const first = splitNumberFormatSections(tokenizeNumberFormat(formatCode))[0];
  return first === undefined ? PLAIN_NUMBER : classifySection(first);
}

/**
 * The built-in format codes ECMA-376 Part 1 SS18.8.30 documents (never written into a file's own <numFmts>/Format records, and every reader is expected to know).
 *
 * [MS-XLS] 2.4.126 constrains a BIFF8 Format record's own ifmt to 5-8, 23-26, 41-44, 63-66, and 164-382, so an XF pointing at any other identifier resolves through this table instead; xlsx resolves the same identifiers through its own <cellXfs><xf> the same way. Ids 23-36 are deliberately absent: that table leaves them reserved, and inventing codes for them would fabricate a mapping no specification defines -- an XF pointing at one resolves to no code at all, which a caller reports as absent rather than silently substituting General.
 *
 * These strings are fed through the SAME classifyNumberFormat above as a producer-declared code, never a second lookup table of pre-decided kinds, so the two feeds can never drift apart. Two spellings of ids 5-8 circulate in reproductions of this table (bare `$#,##0` and quoted `"$"#,##0`); both classify identically here, since a currency symbol is recognised as a bare code character and inside a literal alike.
 */
export const BUILTIN_NUMBER_FORMATS: ReadonlyMap<number, string> = new Map<
  number,
  string
>([
  [0, "General"],
  [1, "0"],
  [2, "0.00"],
  [3, "#,##0"],
  [4, "#,##0.00"],
  [5, "$#,##0_);($#,##0)"],
  [6, "$#,##0_);[Red]($#,##0)"],
  [7, "$#,##0.00_);($#,##0.00)"],
  [8, "$#,##0.00_);[Red]($#,##0.00)"],
  [9, "0%"],
  [10, "0.00%"],
  [11, "0.00E+00"],
  [12, "# ?/?"],
  [13, "# ??/??"],
  [14, "mm-dd-yy"],
  [15, "d-mmm-yy"],
  [16, "d-mmm"],
  [17, "mmm-yy"],
  [18, "h:mm AM/PM"],
  [19, "h:mm:ss AM/PM"],
  [20, "h:mm"],
  [21, "h:mm:ss"],
  [22, "m/d/yy h:mm"],
  [37, "#,##0 ;(#,##0)"],
  [38, "#,##0 ;[Red](#,##0)"],
  [39, "#,##0.00;(#,##0.00)"],
  [40, "#,##0.00;[Red](#,##0.00)"],
  [41, '_(* #,##0_);_(* \\(#,##0\\);_(* "-"_);_(@_)'],
  [42, '_("$"* #,##0_);_("$"* \\(#,##0\\);_("$"* "-"_);_(@_)'],
  [43, '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)'],
  [44, '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)'],
  [45, "mm:ss"],
  [46, "[h]:mm:ss"],
  [47, "mmss.0"],
  [48, "##0.0E+0"],
  [49, "@"],
]);
