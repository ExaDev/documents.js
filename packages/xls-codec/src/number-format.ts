// What KIND of value a numeric cell carrying a given number-format code actually holds -- a percentage, an amount of money, a date, a time of day, an elapsed duration, or a plain number. BIFF8 has no percentage, currency, date, or time CELL type: every one of those is stored as a bare number whose meaning lives entirely in the format its XF points at, so without this classification every date in a workbook reads back as a five-digit integer.
//
// The format mini-language itself is the one ECMA-376 Part 1 SS18.8.30 documents, which is not a coincidence: OOXML inherited it from BIFF, and [MS-XLS] 2.4.126 defers to that section for how a Format record's own stFormat string is interpreted (https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/300280fd-e4fe-4675-a924-4d383af48d3b). ooxml.js's typed/xlsx/number-format.ts classifies the same language for the same reason; the two are deliberately separate implementations rather than a shared one, because a format codec depending on a sibling format codec for shared semantics is exactly the coupling document-schema.js exists to remove -- extracting both into a foundation module is tracked as https://github.com/ExaDev/documents.js/issues/848.
//
// This is a classifier, NOT a formatter: nothing here renders a value through a format code (that needs locale data, placeholder geometry, conditional-section evaluation, and colour handling nothing in this ecosystem has asked for), only decides what kind of thing the value is.
//
// It tokenizes rather than pattern-matching, because every meaningful signal in this language is context-sensitive and a regex over the raw string gets each of them wrong: a 'd' inside "dollars" is literal text and not a day code; '[$-809]' is a locale tag carrying no currency meaning while '[$GBP-809]' is a real currency marker, one character apart; '[h]' is an elapsed-hours bucket while a bare 'h' is an hour of day; 'm' is minutes or months depending purely on the runs around it; and a ';' inside a quoted literal does not start a new section.

/** A single lexical unit. `literal` covers every construct whose payload is TEXT rather than format codes -- a quoted run, a `\x` escape, and the payload of an `_x` (reserve x's width) or `*x` (repeat x to fill) placeholder -- so nothing inside one is read as a date or numeric code. Its text is still scanned for a currency symbol, since that is exactly how the built-in accounting formats mark money. */
type Token =
  | { kind: "literal"; text: string }
  | { kind: "bracket"; body: string }
  | { kind: "separator" }
  | { kind: "code"; char: string };

/** Excel honours at most four sections (positive; negative; zero; text); a fifth is malformed and is dropped rather than guessed at. */
const MAX_SECTIONS = 4;

/** Mirrors String.prototype.charAt's past-the-end contract, but over a CODE POINT array, so a rare astral currency symbol stays one token instead of splitting into two lone surrogates. */
function at(chars: readonly string[], index: number): string {
  return chars[index] ?? "";
}

function tokenize(formatCode: string): Token[] {
  const chars = [...formatCode];
  const tokens: Token[] = [];
  let index = 0;
  while (index < chars.length) {
    const char = at(chars, index);
    if (char === '"') {
      // An unterminated quote runs to the end rather than throwing: real producers never write one, but a malformed code must still classify as something.
      let text = "";
      index += 1;
      while (index < chars.length && at(chars, index) !== '"') {
        text += at(chars, index);
        index += 1;
      }
      index += 1;
      tokens.push({ kind: "literal", text });
      continue;
    }
    if (char === "\\" || char === "_" || char === "*") {
      // All three consume the FOLLOWING character as a non-code payload, which is why `_(` never reads as a parenthesis code and `\-` never as a minus sign.
      tokens.push({ kind: "literal", text: at(chars, index + 1) });
      index += 2;
      continue;
    }
    if (char === "[") {
      let body = "";
      index += 1;
      while (index < chars.length && at(chars, index) !== "]") {
        body += at(chars, index);
        index += 1;
      }
      index += 1;
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

/** Splits on separator tokens only: a ';' inside a quote or bracket was already consumed as part of that token, so it can never split a section here. */
function splitSections(tokens: readonly Token[]): Token[][] {
  const sections: Token[][] = [];
  let current: Token[] = [];
  for (const token of tokens) {
    if (token.kind === "separator") {
      sections.push(current);
      current = [];
      continue;
    }
    current.push(token);
  }
  sections.push(current);
  return sections.slice(0, MAX_SECTIONS);
}

/** The Unicode Currency_Symbol category IS the definition of "this character means money", so it is tested directly rather than against a hand-listed subset that would omit whichever symbol a real file happens to use. */
const CURRENCY_SYMBOL = /\p{Sc}/u;

/** `[$GBP-809]` carries an ISO 4217 code; `[$£-809]` carries a display symbol instead. Only the three-ASCII-letter shape counts as a code, because ContentCellValue's `currency` field is documented as the ISO code and there is no faithful symbol-to-code mapping ('$' alone is USD, CAD, AUD and a dozen others). */
function isIsoCurrencyCodeShape(marker: string): boolean {
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

/** An elapsed-time bucket is a bracket holding one repeated h/m/s and nothing else -- the marker that the value is a DURATION, which may legitimately exceed 24 hours, rather than a time of day. */
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
    // The single most error-prone distinction in the language: '$' immediately followed by '-' is a LOCALE tag, not currency. Real producers write [$-809] on date, time, and percentage formats alike, and reading those as currency would misclassify most of a styled workbook.
    const dashIndex = rest.indexOf("-");
    const marker = dashIndex === -1 ? rest : rest.slice(0, dashIndex);
    if (marker === "") {
      return { kind: "none" };
    }
    return isIsoCurrencyCodeShape(marker)
      ? { kind: "currency", code: marker.toUpperCase() }
      : { kind: "currency" };
  }
  // Everything else a bracket holds -- a colour ([Red]), a condition ([<=100]), a calendar modifier ([DBNum1]) -- carries no value-kind information.
  return isElapsedBracketBody(body) ? { kind: "elapsed" } : { kind: "none" };
}

/** A run of consecutive identical code characters, plus the one multi-character code that is not a repeated letter: an AM/PM (or A/P) marker, recorded under the synthetic letter 'ampm'. Grouping into runs is what makes 'mmm' (always a month name) distinguishable from 'mm' (ambiguous). */
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

function codeRunsOf(section: readonly Token[]): CodeRun[] {
  const chars: string[] = [];
  for (const token of section) {
    if (token.kind === "code") {
      chars.push(token.char);
    }
  }
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
    while (
      index + length < chars.length &&
      at(chars, index + length).toLowerCase() === char
    ) {
      length += 1;
    }
    runs.push({ letter: char, length });
    index += length;
  }
  return runs;
}

/** The letters an ambiguous 'm' looks past its neighbours for. 'm' itself is excluded: an unresolved 'm' carries no information for resolving another, so `hh:mm:mm` resolves both against the 'hh'. */
const RESOLVING_LETTERS: readonly string[] = ["y", "d", "h", "s"];

function nearestResolvingLetter(
  runs: readonly CodeRun[],
  from: number,
  step: number,
): string | undefined {
  for (
    let index = from + step;
    index >= 0 && index < runs.length;
    index += step
  ) {
    const run = runs[index];
    if (run !== undefined && RESOLVING_LETTERS.includes(run.letter)) {
      return run.letter;
    }
  }
  return undefined;
}

/** Excel's minutes-vs-months rule: 'm'/'mm' is minutes when the nearest preceding date/time code is an hour or the nearest following one is a second, and a month otherwise. 'mmm' and longer are always month names. This is what makes `yyyy-mm-dd hh:mm:ss` resolve its two identical 'mm' runs oppositely. */
function monthRunIsMinutes(runs: readonly CodeRun[], index: number): boolean {
  return (
    nearestResolvingLetter(runs, index, -1) === "h" ||
    nearestResolvingLetter(runs, index, 1) === "s"
  );
}

/** What a format code says the value is. `elapsedTime` is kept distinct from `time` because a duration may exceed 24 hours and so has no wall-clock spelling in the schema. */
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

/** Digit placeholders ('0' required, '#' suppressed, '?' space-padded), the decimal and thousands separators. Scientific notation's 'e' is handled at its own run, since a bare 'e' also occurs inside the literal word "General". */
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

function collectSignals(section: readonly Token[]): SectionSignals {
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
    if (token.kind === "literal" && CURRENCY_SYMBOL.test(token.text)) {
      signals.hasCurrency = true;
    }
    if (token.kind === "bracket") {
      const meaning = classifyBracket(token.body);
      if (meaning.kind === "elapsed") {
        signals.hasElapsed = true;
      }
      if (meaning.kind === "currency") {
        signals.hasCurrency = true;
        // The first bracket carrying a real ISO code wins; a format with two is malformed, and the leading one is what a reader would see.
        if (signals.currencyCode === undefined && meaning.code !== undefined) {
          signals.currencyCode = meaning.code;
        }
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
      if (run.length <= 2 && monthRunIsMinutes(runs, index)) {
        signals.hasTime = true;
      } else {
        signals.hasDate = true;
      }
      return;
    }
    if (run.letter === "e") {
      // 'E+'/'E-' is scientific notation; a bare 'e' with no sign after it is just a letter of the literal word "General".
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
    if (CURRENCY_SYMBOL.test(run.letter)) {
      // A bare, unbracketed, unquoted currency symbol -- the built-in ids 5-8 (`$#,##0_);($#,##0)`) are exactly this shape.
      signals.hasCurrency = true;
    }
  });
  return signals;
}

/** Precedence when a format carries several signals at once, most specific first: an elapsed-time bracket beats everything (the only marker separating a duration from a time of day); any date code beats any time code (a format with both is a genuine combined date-and-time); a percent sign beats a currency marker (`[$GBP-809]0.00%` is still a percentage); and a text placeholder only wins when the section has no numeric placeholder to be a number with. */
function classifySection(section: readonly Token[]): NumberFormatClass {
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
    const code = signals.currencyCode;
    return code === undefined
      ? { kind: "currency" }
      : { kind: "currency", code };
  }
  if (signals.hasText && !signals.hasNumeric) {
    return { kind: "text" };
  }
  return PLAIN_NUMBER;
}

/** Classifies a format code, reading the FIRST section only. Sections two through four are the negative/zero/text renderings of the same underlying value: they differ in colour, parentheses, and literal text, never in what kind of thing the cell holds, and a cell whose value happens to be negative must not classify differently from the identical cell holding a positive one. */
export function classifyNumberFormat(formatCode: string): NumberFormatClass {
  const first = splitSections(tokenize(formatCode))[0];
  return first === undefined ? PLAIN_NUMBER : classifySection(first);
}

/**
 * The built-in format codes, which a file never writes into its own Format records and every reader is expected to know.
 *
 * [MS-XLS] 2.4.126 constrains a Format record's own ifmt to 5-8, 23-26, 41-44, 63-66, and 164-382, so an XF pointing at any other identifier resolves through this table instead. The codes are ECMA-376 Part 1 SS18.8.30's table, which BIFF8 and xlsx share.
 *
 * Ids 23-36 are deliberately absent: that table leaves them reserved, and inventing codes for them would fabricate a mapping no specification defines -- an XF pointing at one resolves to no code at all, which the caller reports as absent rather than silently substituting General. These strings are fed through the SAME classifyNumberFormat as a producer-declared code, never a second table of pre-decided kinds, so the two feeds cannot drift apart.
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
